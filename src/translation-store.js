'use strict';
const { DatabaseSync } = require('node:sqlite');
const { mkdirSync, existsSync } = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const norm = s => String(s || '').normalize('NFKC').replace(/\s+/gu,' ').trim();
const sourceHash = s => createHash('sha256').update(norm(s)).digest('hex');
function text(value,name,max=512,empty=false) {
  if(typeof value!=='string' || (!empty&&!value) || value.length>max || value.includes('\0'))throw new TypeError('Invalid '+name);
  return value;
}
function address(v,chat=true) {
  const a={accountId:text(v?.accountId,'account'),platform:text(v?.platform,'platform',64),portId:text(v?.portId,'port',128)};
  if(!['whatsapp','whatsapp-pure','whatsapp-business'].includes(a.platform))throw new Error('WhatsApp only');
  if(chat)a.chatId=text(v?.chatId,'chat');
  return a;
}
const cacheKey = v => JSON.stringify([v.accountId,v.platform,v.chatId,v.lang,v.sourceHash]);
const sentKey = v => JSON.stringify([v.accountId,v.platform,v.portId,v.chatId,v.sentKey]);

class TranslationStore {
  constructor(file,{debounceMs=2000}={}) {
    this.file=file;this.debounceMs=debounceMs;this.db=null;this.pending=new Map();this.sent=new Map();this.hits=new Map();this.timer=null;
  }
  database() {
    if(this.db)return this.db;
    mkdirSync(path.dirname(this.file),{recursive:true,mode:0o700});
    const db=new DatabaseSync(this.file);
    db.exec('PRAGMA journal_mode=WAL;PRAGMA busy_timeout=3000;PRAGMA foreign_keys=ON;');
    db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY,applied_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS translation_cache(
        id INTEGER PRIMARY KEY AUTOINCREMENT,account_id TEXT NOT NULL,platform TEXT NOT NULL DEFAULT 'whatsapp',
        chat_id TEXT NOT NULL,lang TEXT NOT NULL,source_hash TEXT NOT NULL,source_text TEXT NOT NULL,answer TEXT NOT NULL,
        source_revision TEXT NOT NULL,updated_at INTEGER NOT NULL,
        UNIQUE(account_id,platform,chat_id,lang,source_hash));
      CREATE INDEX IF NOT EXISTS idx_tc_lookup ON translation_cache(account_id,platform,chat_id,lang,source_hash);
      CREATE TABLE IF NOT EXISTS port_translation(account_id TEXT NOT NULL,platform TEXT NOT NULL DEFAULT 'whatsapp',
        port_id TEXT NOT NULL,chat_id TEXT NOT NULL,translation_id INTEGER NOT NULL REFERENCES translation_cache(id) ON DELETE CASCADE,
        hits INTEGER NOT NULL DEFAULT 0,last_used_at INTEGER NOT NULL,
        PRIMARY KEY(account_id,platform,port_id,chat_id,translation_id));
      CREATE TABLE IF NOT EXISTS sent_input_source(id INTEGER PRIMARY KEY AUTOINCREMENT,account_id TEXT NOT NULL,
        platform TEXT NOT NULL DEFAULT 'whatsapp',port_id TEXT NOT NULL,chat_id TEXT NOT NULL,sent_key TEXT NOT NULL,
        source_text TEXT NOT NULL,sent_text TEXT NOT NULL DEFAULT '',created_at INTEGER NOT NULL,
        UNIQUE(account_id,platform,port_id,chat_id,sent_key));
      CREATE TABLE IF NOT EXISTS legacy_imports(account_id TEXT NOT NULL,platform TEXT NOT NULL,port_id TEXT NOT NULL,
        PRIMARY KEY(account_id,platform,port_id));
      INSERT OR IGNORE INTO schema_migrations VALUES(1,CAST(strftime('%s','now') AS INTEGER)*1000);
      COMMIT;`);
    this.db=db;return db;
  }
  schedule() {
    if(this.timer)return;
    this.timer=setTimeout(()=>{this.timer=null;try{this.flush();}catch{this.schedule();}},this.debounceMs);
    this.timer.unref?.();
  }
  put(v) {
    const a=address(v),lang=text(v.lang,'language',64),sourceText=text(v.sourceText,'source',100000);
    const hash=sourceHash(sourceText),revision=text(v.sourceRevision,'revision',64);
    if(revision!==hash)throw new Error('Source revision mismatch');
    const row={...a,lang,sourceHash:hash,sourceText,answer:text(v.answer,'answer',200000,true),sourceRevision:hash,updatedAt:Date.now(),id:null};
    const key=cacheKey(row),old=this.pending.get(key);
    row.ports=new Set([...(old?.ports||[]),a.portId]);
    this.pending.set(key,row);this.schedule();return this.publicRow(row);
  }
  publicRow(row) {
    if(!row)return null;
    return {id:row.id,chatId:row.chatId,lang:row.lang,sourceHash:row.sourceHash,sourceText:row.sourceText,
      answer:row.answer,sourceRevision:row.sourceRevision,updatedAt:row.updatedAt,hits:row.hits||0,lastUsedAt:row.lastUsedAt||0};
  }
  get(v) {
    const a=address(v),lang=text(v.lang,'language',64),hash=text(v.sourceHash,'hash',64);
    if(!/^[a-f0-9]{64}$/.test(hash))throw new Error('Invalid hash');
    const pending=this.pending.get(cacheKey({...a,lang,sourceHash:hash}));
    if(pending)return this.publicRow(pending);
    return this.database().prepare(`SELECT id,chat_id AS chatId,lang,source_hash AS sourceHash,source_text AS sourceText,
      answer,source_revision AS sourceRevision,updated_at AS updatedAt FROM translation_cache
      WHERE account_id=? AND platform=? AND chat_id=? AND lang=? AND source_hash=?`).get(a.accountId,a.platform,a.chatId,lang,hash)||null;
  }
  loadSnapshot(v) {
    const a=address(v,false),limit=v.limit??1000;
    if(!Number.isInteger(limit)||limit<1||limit>1000)throw new Error('Invalid snapshot size');
    if(v.chatId!==undefined)text(v.chatId,'chat');
    this.flush();
    const filter=v.chatId?' AND c.chat_id=?':'';
    const args=[a.accountId,a.platform,a.portId,...(v.chatId?[v.chatId]:[]),limit];
    const rows=this.database().prepare(`SELECT c.id,c.chat_id AS chatId,c.lang,c.source_hash AS sourceHash,c.source_text AS sourceText,
      c.answer,c.source_revision AS sourceRevision,c.updated_at AS updatedAt,p.hits,p.last_used_at AS lastUsedAt
      FROM translation_cache c JOIN port_translation p ON p.translation_id=c.id AND p.account_id=c.account_id
        AND p.platform=c.platform AND p.chat_id=c.chat_id
      WHERE p.account_id=? AND p.platform=? AND p.port_id=?${filter}
      ORDER BY p.hits DESC,p.last_used_at DESC,c.updated_at DESC LIMIT ?`).all(...args);
    const sent=this.database().prepare(`SELECT sent_key AS sentKey,source_text AS sourceText,sent_text AS sentText,
      chat_id AS chatId,created_at AS createdAt FROM sent_input_source
      WHERE account_id=? AND platform=? AND port_id=?${v.chatId?' AND chat_id=?':''} ORDER BY created_at DESC LIMIT ?`).all(...args);
    return {rows,sent};
  }
  hit(v) {
    const a=address(v);
    if(!Number.isSafeInteger(v.translationId)||v.translationId<1)throw new Error('Invalid translation ID');
    const key=JSON.stringify([a.accountId,a.platform,a.portId,a.chatId,v.translationId]);
    const old=this.hits.get(key);
    this.hits.set(key,{...a,translationId:v.translationId,count:(old?.count||0)+1,time:Date.now()});this.schedule();
  }
  putSentSource(v) {
    const a=address(v),sourceText=text(v.sourceText,'source',100000),key=norm(text(v.sentKey,'sent key',100000));
    if(key!==norm(sourceText))throw new Error('Sent key must match original');
    const row={...a,sentKey:key,sourceText,sentText:text(v.sentText||'','sent text',200000,true),createdAt:Date.now()};
    this.sent.set(sentKey(row),row);this.schedule();return row;
  }
  getSentSource(v) {
    const a=address(v),key=norm(text(v.sentKey,'sent key',200000));
    for(const row of [...this.sent.values()].reverse())if(row.accountId===a.accountId&&row.platform===a.platform&&row.portId===a.portId&&row.chatId===a.chatId
      &&(row.sentKey===key||norm(row.sentText)===key))return {...row};
    return this.database().prepare(`SELECT sent_key AS sentKey,source_text AS sourceText,sent_text AS sentText,created_at AS createdAt
      FROM sent_input_source WHERE account_id=? AND platform=? AND port_id=? AND chat_id=? AND (sent_key=? OR sent_text=?)
      ORDER BY created_at DESC LIMIT 1`).get(a.accountId,a.platform,a.portId,a.chatId,key,key)||null;
  }
  flush() {
    if(this.timer){clearTimeout(this.timer);this.timer=null;}
    if(!this.pending.size&&!this.sent.size&&!this.hits.size)return;
    const db=this.database();db.exec('BEGIN IMMEDIATE');
    try {
      for(const v of this.pending.values()){
        const row=db.prepare(`INSERT INTO translation_cache(account_id,platform,chat_id,lang,source_hash,source_text,answer,source_revision,updated_at)
          VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(account_id,platform,chat_id,lang,source_hash)
          DO UPDATE SET source_text=excluded.source_text,answer=excluded.answer,source_revision=excluded.source_revision,updated_at=excluded.updated_at
          RETURNING id`).get(v.accountId,v.platform,v.chatId,v.lang,v.sourceHash,v.sourceText,v.answer,v.sourceRevision,v.updatedAt);
        for(const port of v.ports)db.prepare(`INSERT INTO port_translation VALUES(?,?,?,?,?,0,?)
          ON CONFLICT(account_id,platform,port_id,chat_id,translation_id) DO UPDATE SET last_used_at=excluded.last_used_at`)
          .run(v.accountId,v.platform,port,v.chatId,row.id,v.updatedAt);
      }
      for(const v of this.sent.values())db.prepare(`INSERT INTO sent_input_source(account_id,platform,port_id,chat_id,sent_key,source_text,sent_text,created_at)
        VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(account_id,platform,port_id,chat_id,sent_key)
        DO UPDATE SET source_text=excluded.source_text,sent_text=excluded.sent_text,created_at=excluded.created_at`)
        .run(v.accountId,v.platform,v.portId,v.chatId,v.sentKey,v.sourceText,norm(v.sentText),v.createdAt);
      for(const v of this.hits.values())db.prepare(`UPDATE port_translation SET hits=hits+?,last_used_at=?
        WHERE account_id=? AND platform=? AND port_id=? AND chat_id=? AND translation_id=?`)
        .run(v.count,v.time,v.accountId,v.platform,v.portId,v.chatId,v.translationId);
      db.exec('COMMIT');this.pending.clear();this.sent.clear();this.hits.clear();
    }catch(error){db.exec('ROLLBACK');throw error;}
  }
  importLegacy(v,file) {
    const a=address(v,false),db=this.database();
    if(!existsSync(file)||db.prepare('SELECT 1 FROM legacy_imports WHERE account_id=? AND platform=? AND port_id=?').get(a.accountId,a.platform,a.portId))return;
    const old=new DatabaseSync(file,{readOnly:true});let rows;
    try{rows=old.prepare(`SELECT m.conversation AS chatId,m.lang,c.question AS sourceText,c.answer
      FROM translationMessages m JOIN translateCache c ON c.lang=m.lang AND c.question=m.question`).all();}finally{old.close();}
    for(const row of rows)this.put({...a,...row,sourceRevision:sourceHash(row.sourceText)});
    this.flush();db.prepare('INSERT OR IGNORE INTO legacy_imports VALUES(?,?,?)').run(a.accountId,a.platform,a.portId);
  }
  close(){this.flush();this.db?.close();this.db=null;}
}
let shared;
function init(app){if(!shared)shared=new TranslationStore(path.join(app.getPath('userData'),'translation-cache.db'));return shared;}
function flush(){shared?.flush();}
module.exports={TranslationStore,norm,sourceHash,cacheKey,init,flush};
