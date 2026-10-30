'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {spawn}=require('node:child_process');
const {TranslationStore,norm,sourceHash}=require('../src/translation-store');
const {PortMemory}=require('../src/wa-memory');
const base={accountId:'identity:a',platform:'whatsapp',portId:'port:a',chatId:'123@c.us',lang:'zh-CN',sourceText:'Hello',answer:'你好',sourceRevision:sourceHash('Hello')};
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ht-wa-local-')),file=path.join(dir,'translation-cache.db'),store=new TranslationStore(file);
  t.after(()=>{store.close();fs.rmSync(dir,{recursive:true,force:true});});return{dir,file,store};}
test('normalized content keys reuse translations without message IDs and remain isolated across identities/chats/channels/languages',t=>{
  const {store}=fixture(t);
  const source='Ｈｅｌｌｏ\n  world';const value={...base,sourceText:source,sourceRevision:sourceHash(source)};
  store.put(value);store.put({...value,sourceText:'Hello world',answer:'你好世界'});
  assert.equal(store.pending.size,1);assert.equal(store.get({...base,sourceHash:sourceHash('Hello  world')}).answer,'你好世界');
  assert.equal(norm(source),'Hello world');
  for(const[field,val]of Object.entries({accountId:'identity:b',platform:'whatsapp-business',chatId:'456@c.us',lang:'fr'}))assert.equal(store.get({...base,[field]:val,sourceHash:sourceHash('Hello world')}),null);
  assert.throws(()=>store.put({...base,sourceRevision:'0'.repeat(64)}));
});
test('debounced writes are immediately readable in memory, flush persists empty/hit records and schema migration is idempotent',t=>{
  const {store,file}=fixture(t);store.put(base);assert.equal(fs.existsSync(file),false);assert.equal(store.get({...base,sourceHash:base.sourceRevision}).answer,'你好');
  store.put({...base,sourceText:'No translation',sourceRevision:sourceHash('No translation'),answer:''});
  store.flush();store.close();
  const rows=store.loadSnapshot(base).rows;assert.equal(rows.length,2);assert.ok(rows.some(r=>r.answer===''));
  assert.equal(store.database().prepare('SELECT count(*) AS n FROM schema_migrations').get().n,1);
  assert.equal(store.database().prepare('PRAGMA foreign_keys').get().foreign_keys,1);
  assert.equal(store.database().prepare('PRAGMA busy_timeout').get().timeout,3000);
});
test('port snapshots exclude other port bindings; hits cannot mutate another account',t=>{
  const {store}=fixture(t);store.put(base);const r=store.loadSnapshot(base).rows[0];
  assert.equal(store.loadSnapshot({...base,portId:'port:b'}).rows.length,0);
  store.hit({...base,translationId:r.id});store.hit({...base,accountId:'forged',translationId:r.id});store.flush();
  assert.equal(store.loadSnapshot(base).rows[0].hits,1);
});
test('sent input source survives close/reopen and matches original key or actually sent translated text',t=>{
  const {store}=fixture(t);const v={...base,sentKey:'你好',sourceText:'你好',sentText:'Hello'};
  store.putSentSource(v);assert.equal(store.getSentSource({...base,sentKey:'Hello'}).sourceText,'你好');store.close();
  assert.equal(store.getSentSource({...base,sentKey:'  Hello\n'}).sourceText,'你好');
  assert.equal(store.getSentSource({...base,accountId:'other',sentKey:'Hello'}),null);
  assert.throws(()=>store.putSentSource({...v,sentKey:'forged'}));
});
test('legacy port SQLite import is read-only and idempotent, converted into normalized chat-scoped rows',t=>{
  const {store,dir}=fixture(t),oldFile=path.join(dir,'old.sqlite'),old=new DatabaseSync(oldFile);
  old.exec('CREATE TABLE translateCache(lang TEXT,question TEXT,answer TEXT);CREATE TABLE translationMessages(conversation TEXT,lang TEXT,question TEXT);');
  old.prepare('INSERT INTO translateCache VALUES(?,?,?)').run('zh-CN','Ｈｅｌｌｏ','旧译文');
  old.prepare('INSERT INTO translationMessages VALUES(?,?,?)').run(base.chatId,'zh-CN','Ｈｅｌｌｏ');old.close();
  const bytes=fs.readFileSync(oldFile);store.importLegacy(base,oldFile);store.importLegacy(base,oldFile);
  assert.deepEqual(fs.readFileSync(oldFile),bytes);assert.equal(store.loadSnapshot(base).rows.length,1);
  assert.equal(store.get({...base,sourceHash:sourceHash('Hello')}).answer,'旧译文');
});
test('memory cache enforces entry/byte limits and protects visible records during eviction',()=>{
  const memory=new PortMemory({maxEntries:3,maxBytes:2048});memory.set('pinned',{answer:'keep'});memory.pin(['pinned']);
  for(let i=0;i<100;i++)memory.set('k'+i,{answer:'x'.repeat(100),updatedAt:i});
  assert.equal(memory.get('pinned').answer,'keep');assert.equal(memory.entries.size,3);assert.ok(memory.bytes<=2048);
  assert.equal(memory.set('huge',{answer:'x'.repeat(3000)}),false);assert.ok(memory.bytes<=2048);
});
test('killing a writer mid-transaction leaves a complete old value and intact port relation',async t=>{
  const {store,file}=fixture(t);store.put(base);store.flush();store.close();
  const child=spawn(process.execPath,['-e',`const{DatabaseSync}=require('node:sqlite');const d=new DatabaseSync(process.argv[1]);
    d.exec('PRAGMA journal_mode=WAL;BEGIN IMMEDIATE');d.prepare('UPDATE translation_cache SET answer=?').run('partial-new');
    process.stdout.write('READY\\n');setInterval(()=>{},1000);`,file],{stdio:['ignore','pipe','pipe']});
  await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('Writer did not become ready')),10000);
    child.stdout.on('data',chunk=>{if(String(chunk).includes('READY')){clearTimeout(timeout);resolve();}});child.once('error',reject);});
  const exited=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGKILL');await exited;
  assert.equal(store.loadSnapshot(base).rows[0].answer,'你好');assert.equal(store.database().prepare('PRAGMA integrity_check').get().integrity_check,'ok');
});
