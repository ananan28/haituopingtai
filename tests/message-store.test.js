'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { MessageStore, sourceHash } = require('../message-store');

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'haituo-message-test-'));
  const store = new MessageStore(directory);
  t.after(() => { store.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const record = { accountId: 'a:b', channel: 'signal', conversationId: 'chat:1', id: 'msg:1', body: 'Hello 123', direction: 'in', timestamp: 1000, sender: 'Alice' };
  const translation = { ...record, sourceHash: sourceHash(record.body), text: '你好 123', language: 'zh-CN', provider: 'test', demo: false };
  return { store, directory, record, translation };
}

test('source and translation survive a close/reopen as one message object', t => {
  const { store, record, translation } = fixture(t);
  store.put('server:one', record);
  store.translate('server:one', translation);
  store.close();
  const [loaded] = store.list('server:one', record);
  assert.equal(loaded.body, record.body);
  assert.equal(loaded.translation.text, '你好 123');
  assert.equal(loaded.sourceHash, translation.sourceHash);
});

test('replayed message events preserve a completed translation and never duplicate rows', t => {
  const { store, record, translation } = fixture(t);
  store.put('server:one', record); store.translate('server:one', translation);
  for (let i = 0; i < 10; i++) store.put('server:one', record);
  const loaded = store.list('server:one', record);
  assert.equal(loaded.length, 1); assert.equal(loaded[0].translation.text, translation.text);
});

test('edited source clears old translation and rejects delayed results for the previous source', t => {
  const { store, record, translation } = fixture(t);
  store.put('server:one', record); store.translate('server:one', translation);
  store.put('server:one', { ...record, body: 'Edited 456' });
  assert.throws(() => store.translate('server:one', translation), /changed/);
  const loaded = store.get('server:one', record);
  assert.equal(loaded.body, 'Edited 456'); assert.equal(loaded.translation, null);
});

test('identity, account, channel and conversation never share message IDs', t => {
  const { store, record, translation } = fixture(t);
  store.put('server:one', record); store.translate('server:one', translation);
  for (const other of [{ accountId: 'a-b' }, { channel: 'whatsapp' }, { conversationId: 'chat:2' }]) {
    assert.deepEqual(store.list('server:one', { ...record, ...other }), []);
    assert.equal(store.get('server:one', { ...record, ...other }), null);
  }
  assert.deepEqual(store.list('server:two', record), []);
  assert.deepEqual(store.list('demo:owner', record), []);
});

test('pagination is stable with identical timestamps and resumes without missing or repeated IDs', t => {
  const { store, record } = fixture(t);
  for (let i = 0; i < 8; i++) store.put('server:one', { ...record, id: String(i) });
  const ids = [];
  let before;
  do {
    const page = store.list('server:one', { ...record, limit: 3, before });
    if (!page.length) break;
    ids.push(...page.map(m => m.id));
    before = { timestamp: page[0].timestamp, id: page[0].id };
  } while (true);
  assert.equal(new Set(ids).size, 8); assert.equal(ids.length, 8);
});

test('second database connection cannot attach a stale translation after a source edit', t => {
  const { store, directory, record, translation } = fixture(t);
  store.put('server:one', record);
  const other = new MessageStore(directory);
  try {
  other.put('server:one', { ...record, body: 'Edited elsewhere' });
  assert.throws(() => store.translate('server:one', translation));
  assert.equal(other.get('server:one', record).translation, null);
  } finally { other.close(); }
});

test('parameterized message content round trips quotes, SQL-like strings, HTML and Unicode', t => {
  const { store, record } = fixture(t);
  const value = { ...record, id: "'; DROP TABLE messages;--", body: '<script>您好 😀</script>\n"quoted"' };
  store.put('server:one', value);
  assert.equal(store.get('server:one', value).body, value.body);
  assert.equal(store.list('server:one', value).length, 1);
});

test('invalid input and unbounded pages fail without deleting existing records', t => {
  const { store, record, translation } = fixture(t);
  store.put('server:one', record);
  for (const input of [{ body: null }, { id: '' }, { body: 'a'.repeat(100001) }, { direction: 'sideways' }, { timestamp: NaN }]) {
    assert.throws(() => store.put('server:one', { ...record, ...input }));
  }
  for (const limit of [0, -1, 201, Infinity, '100']) assert.throws(() => store.list('server:one', { ...record, limit }));
  assert.throws(() => store.translate('server:one', { ...translation, sourceHash: 'invalid' }));
  assert.equal(store.list('server:one', record).length, 1);
});
