'use strict';
const { DatabaseSync } = require('node:sqlite');
const { mkdirSync } = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { storageToken } = require('./channel-identity');

function text(value, name, max = 100000) {
  if (typeof value !== 'string' || !value || value.length > max || value.includes('\0')) throw new TypeError('Invalid ' + name);
  return value;
}
function address(value) {
  return { scope: text(value?.scope, 'scope', 512), accountId: text(value?.accountId, 'accountId', 128),
    channel: text(value?.channel, 'channel', 64), conversationId: text(value?.conversationId, 'conversationId', 512),
    language: text(value?.language, 'language', 64) };
}
function hash(value) { return createHash('sha256').update(value).digest('hex'); }
function messageKey(value) {
  const question = text(value?.question, 'question');
  if (value.messageId) return 'id:' + text(value.messageId, 'messageId', 1024);
  return 'fallback:' + hash(JSON.stringify([text(value.metadata, 'metadata', 2048), question]));
}

// One SQLite database per verified identity + channel + port. Translations and
// message bindings are separate: repeated source text can reuse work without
// making different message IDs (or conversations) the same message.
class TranslationCache {
  constructor(directory) { this.directory = directory; this.databases = new Map(); }
  database(value) {
    const token = storageToken(value.scope, value.channel, value.accountId);
    if (this.databases.has(token)) return this.databases.get(token);
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const db = new DatabaseSync(path.join(this.directory, token + '.sqlite'));
    db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS translateCache (
        lang TEXT NOT NULL, question TEXT NOT NULL, answer TEXT NOT NULL, provider TEXT NOT NULL,
        PRIMARY KEY(lang, question)
      ) STRICT;
      CREATE UNIQUE INDEX IF NOT EXISTS translateCache_lang_question_unique_index ON translateCache(lang,question);
      CREATE TABLE IF NOT EXISTS translationMessages (
        conversation TEXT NOT NULL, message_key TEXT NOT NULL, lang TEXT NOT NULL, question TEXT NOT NULL,
        PRIMARY KEY(conversation,message_key,lang),
        FOREIGN KEY(lang,question) REFERENCES translateCache(lang,question)
      ) STRICT;
      PRAGMA foreign_keys=ON;`);
    this.databases.set(token, db);
    return db;
  }
  savePortTranslationCache(value) {
    const a = address(value), key = messageKey(value), question = text(value.question, 'question');
    const answer = text(value.answer, 'answer', 200000), provider = text(value.provider, 'provider', 128);
    const db = this.database(a);
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare(`INSERT INTO translateCache VALUES(?,?,?,?) ON CONFLICT(lang,question)
        DO UPDATE SET answer=excluded.answer,provider=excluded.provider`).run(a.language, question, answer, provider);
      db.prepare(`INSERT INTO translationMessages VALUES(?,?,?,?) ON CONFLICT(conversation,message_key,lang)
        DO UPDATE SET question=excluded.question`).run(a.conversationId, key, a.language, question);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    return { key, question, answer, provider, language: a.language };
  }
  loadPortTranslationCache(value) {
    const a = address(value);
    return this.database(a).prepare(`SELECT m.message_key AS key,m.question,c.answer,c.provider,m.lang AS language
      FROM translationMessages m JOIN translateCache c ON c.lang=m.lang AND c.question=m.question
      WHERE m.conversation=? AND m.lang=? ORDER BY m.message_key`).all(a.conversationId, a.language);
  }
  close() { for (const db of this.databases.values()) db.close(); this.databases.clear(); }
}

function register({ ipcMain, app, access, resolve, store = new TranslationCache(path.join(app.getPath('userData'), 'translation-cache')), translator = null }) {
  function context(event) {
    const entry = resolve(event);
    const identity = access.current();
    if (!entry || !identity || identity.demo || !access.can('account') || entry.scope !== identity.scope
      || !identity.accountIds?.includes(entry.accountId) || !entry.channel.startsWith('whatsapp')) throw new Error('Port denied');
    return { ...entry, revision: access.revision() };
  }
  function current(event, captured) {
    const entry = context(event);
    if (entry.revision !== captured.revision || entry.scope !== captured.scope || entry.accountId !== captured.accountId) throw new Error('Port changed');
  }
  ipcMain.handle('webchannels:loadPortTranslationCache', (event, value) => {
    try {
      const entry = context(event);
      // Scope/account/channel are always derived from the bound main-frame sender.
      const records = store.loadPortTranslationCache({ ...value, scope: entry.scope, accountId: entry.accountId, channel: entry.channel });
      return { ok: true, records, enabled: Boolean(translator) && access.can('translate') && !access.current().local };
    } catch { return { ok: false, error: '无法读取此端口的译文缓存' }; }
  });
  ipcMain.handle('webchannels:translateMessage', async (event, value) => {
    try {
      const entry = context(event);
      if (!translator || access.current().local || !access.can('translate')) throw new Error('Platform translation unavailable');
      const input = { ...value, scope: entry.scope, accountId: entry.accountId, channel: entry.channel };
      address(input); messageKey(input);
      const verdict = await access.authorize('translate');
      current(event, entry);
      if (!verdict.ok || !access.can('translate')) throw new Error('Quota denied');
      // Only a host-owned, quota-accounting service may produce a saved result.
      // No save IPC accepts answers, provider URLs or API keys from a web page.
      const result = await translator(input);
      current(event, entry);
      if (!access.can('translate')) throw new Error('Quota changed');
      const record = store.savePortTranslationCache({ ...input, answer: result.text, provider: result.provider });
      return { ok: true, record };
    } catch { return { ok: false, error: '平台翻译服务不可用或字符额度不足' }; }
  });
  access.onChange(() => store.close());
  app.on('before-quit', () => store.close());
  return store;
}
module.exports = { TranslationCache, register, messageKey };
