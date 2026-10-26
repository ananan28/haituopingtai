'use strict';
const { DatabaseSync } = require('node:sqlite');
const { mkdirSync } = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

function text(value, name, max, empty = false) {
  if (typeof value !== 'string' || (!empty && !value) || value.length > max || value.includes('\0')) {
    throw new TypeError('Invalid ' + name);
  }
  return value;
}
function sourceHash(body) { return createHash('sha256').update(body).digest('hex'); }
function key(value) {
  return {
    accountId: text(value?.accountId, 'accountId', 128),
    channel: text(value?.channel, 'channel', 64),
    conversationId: text(value?.conversationId, 'conversationId', 512),
    id: text(value?.id, 'messageId', 512)
  };
}
function message(value) {
  const keys = key(value);
  const body = text(value.body, 'body', 100000, true);
  if (!['in', 'out'].includes(value.direction)) throw new TypeError('Invalid direction');
  if (!Number.isSafeInteger(value.timestamp) || value.timestamp < 0) throw new TypeError('Invalid timestamp');
  return { ...keys, body, direction: value.direction, timestamp: value.timestamp,
    sender: text(value.sender || '', 'sender', 512, true),
    avatar: text(value.avatar || '', 'avatar', 64, true),
    displayTime: text(value.displayTime || '', 'displayTime', 128, true),
    sourceHash: sourceHash(body) };
}

class MessageStore {
  constructor(directory) { this.directory = directory; this.databases = new Map(); }
  database(scope) {
    text(scope, 'scope', 512);
    if (this.databases.has(scope)) return this.databases.get(scope);
    mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const file = path.join(this.directory, createHash('sha256').update(scope).digest('hex') + '.sqlite');
    const db = new DatabaseSync(file);
    db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS messages (
        account_id TEXT NOT NULL, channel TEXT NOT NULL, conversation_id TEXT NOT NULL,
        message_id TEXT NOT NULL, timestamp INTEGER NOT NULL, record TEXT NOT NULL CHECK(json_valid(record)),
        PRIMARY KEY(account_id, channel, conversation_id, message_id)
      ) STRICT;
      CREATE INDEX IF NOT EXISTS messages_history ON messages(account_id, channel, conversation_id, timestamp, message_id);`);
    this.databases.set(scope, db);
    return db;
  }
  put(scope, value) {
    const m = message(value), db = this.database(scope);
    const old = this.get(scope, m);
    // A delivery retry or metadata refresh must not erase an existing translation.
    const record = { ...m, translation: old?.sourceHash === m.sourceHash ? old.translation : null };
    db.prepare(`INSERT INTO messages VALUES(?,?,?,?,?,?) ON CONFLICT(account_id,channel,conversation_id,message_id)
      DO UPDATE SET timestamp=excluded.timestamp, record=excluded.record`).run(m.accountId, m.channel, m.conversationId, m.id, m.timestamp, JSON.stringify(record));
    return record;
  }
  get(scope, value) {
    const k = key(value);
    const row = this.database(scope).prepare(`SELECT record FROM messages WHERE account_id=? AND channel=? AND conversation_id=? AND message_id=?`)
      .get(k.accountId, k.channel, k.conversationId, k.id);
    return row ? JSON.parse(row.record) : null;
  }
  translate(scope, value) {
    const k = key(value), db = this.database(scope);
    const hash = text(value.sourceHash, 'sourceHash', 64);
    if (!/^[a-f0-9]{64}$/.test(hash)) throw new TypeError('Invalid sourceHash');
    const translation = { text: text(value.text, 'translation', 200000),
      language: text(value.language, 'language', 64), provider: text(value.provider, 'provider', 128),
      demo: value.demo === true };
    // Compare-and-swap in SQL also protects against a second connection editing the message.
    const result = db.prepare(`UPDATE messages SET record=json_set(record,'$.translation',json(?))
      WHERE account_id=? AND channel=? AND conversation_id=? AND message_id=? AND json_extract(record,'$.sourceHash')=?`)
      .run(JSON.stringify(translation), k.accountId, k.channel, k.conversationId, k.id, hash);
    if (result.changes !== 1) throw new Error('Message changed or was removed');
    return this.get(scope, k);
  }
  list(scope, value) {
    const account = text(value?.accountId, 'accountId', 128), channel = text(value?.channel, 'channel', 64);
    const conversation = text(value?.conversationId, 'conversationId', 512);
    const limit = value.limit === undefined ? 100 : value.limit;
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new TypeError('Invalid page limit');
    const cursor = value.before;
    if (cursor && (!Number.isSafeInteger(cursor.timestamp) || cursor.timestamp < 0)) throw new TypeError('Invalid cursor');
    if (cursor) text(cursor.id, 'cursor.id', 512);
    const rows = cursor
      ? this.database(scope).prepare(`SELECT record FROM messages WHERE account_id=? AND channel=? AND conversation_id=?
          AND (timestamp < ? OR (timestamp = ? AND message_id < ?)) ORDER BY timestamp DESC,message_id DESC LIMIT ?`)
        .all(account, channel, conversation, cursor.timestamp, cursor.timestamp, cursor.id, limit)
      : this.database(scope).prepare(`SELECT record FROM messages WHERE account_id=? AND channel=? AND conversation_id=?
          ORDER BY timestamp DESC,message_id DESC LIMIT ?`).all(account, channel, conversation, limit);
    return rows.reverse().map(row => JSON.parse(row.record));
  }
  close() {
    for (const db of this.databases.values()) db.close();
    this.databases.clear();
  }
}
module.exports = { MessageStore, sourceHash };
