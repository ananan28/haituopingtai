'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { TranslationCache, messageKey, register } = require('../src/translation-cache');

const base = { scope: 'local:workspace', accountId: 'wa:a', channel: 'whatsapp', conversationId: '123@c.us',
  language: 'zh-CN', messageId: 'false_123@c.us_A', question: 'Hello', answer: '你好', provider: 'platform-test' };
function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'haituo-wa-cache-'));
  const store = new TranslationCache(directory);
  t.after(() => { store.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  return { store, directory };
}
test('per-port SQLite persists whole conversation translations across a full close/reopen', t => {
  const { store, directory } = fixture(t);
  for (let i = 0; i < 220; i++) store.savePortTranslationCache({ ...base, messageId: 'm' + i, question: 'source ' + i, answer: '译文 ' + i });
  store.close();
  const rows = store.loadPortTranslationCache(base);
  assert.equal(rows.length, 220); assert.ok(rows.every(r => r.answer.startsWith('译文 ')));
  assert.equal(fs.readdirSync(directory).filter(f => f.endsWith('.sqlite')).length, 1);
});
test('scope, port, channel, conversation and target language never leak cached translations', t => {
  const { store } = fixture(t); store.savePortTranslationCache(base);
  for (const [field, value] of Object.entries({ scope: 'other', accountId: 'wa:b', channel: 'whatsapp-business', conversationId: '456@c.us', language: 'fr' })) {
    assert.equal(store.loadPortTranslationCache({ ...base, [field]: value }).length, 0, field);
  }
});
test('duplicate text has separate message bindings; edits replace only the edited binding', t => {
  const { store } = fixture(t);
  store.savePortTranslationCache(base);
  store.savePortTranslationCache({ ...base, messageId: 'B' });
  store.savePortTranslationCache({ ...base, question: 'Changed', answer: '已编辑' });
  const rows = store.loadPortTranslationCache(base);
  assert.equal(rows.length, 2);
  assert.equal(rows.find(r => r.key === messageKey(base)).answer, '已编辑');
  assert.equal(rows.find(r => r.key === 'id:B').answer, '你好');
});
test('stable fallback includes metadata and Unicode source; invalid descriptors fail before opening storage', t => {
  const { store } = fixture(t);
  const v = { ...base, messageId: '', metadata: '[10:01] Alice:', question: '你好 👩🏽‍💻' };
  assert.match(messageKey(v), /^fallback:[a-f0-9]{64}$/);
  assert.notEqual(messageKey(v), messageKey({ ...v, metadata: '[10:02] Alice:' }));
  store.savePortTranslationCache(v);
  assert.equal(store.loadPortTranslationCache(base)[0].key, messageKey(v));
  for (const field of ['scope','accountId','channel','conversationId','language','question','answer','provider']) {
    assert.throws(() => store.savePortTranslationCache({ ...base, [field]: '' }), field);
  }
  assert.throws(() => store.savePortTranslationCache({ ...v, metadata: '' }));
});

function ipcFixture(translator) {
  const handlers = new Map(), calls = [], listeners = [];
  let identity = { scope: 'server:one', demo: false, local: false, accountIds: ['wa:a'] }, revision = 1;
  const sender = {}, entry = { scope: identity.scope, accountId: 'wa:a', channel: 'whatsapp' };
  const access = { current: () => identity, revision: () => revision, can: () => true,
    authorize: async () => ({ ok: true }), onChange: fn => listeners.push(fn) };
  const store = { close() {}, loadPortTranslationCache(value) { calls.push(['load', value]); return []; },
    savePortTranslationCache(value) { calls.push(['save', value]); return value; } };
  register({ ipcMain: { handle: (name, fn) => handlers.set(name, fn) }, app: new EventEmitter(), access, store, translator,
    resolve: event => event === sender ? entry : null });
  return { calls, access, handlers, call: (method, value = base, event = sender) => handlers.get('webchannels:' + method)(event, value),
    change(value) { identity = value; revision++; listeners.forEach(fn => fn()); } };
}
test('cache IPC binds scope/account/channel to sender; unbound pages cannot load or save', () => {
  const f = ipcFixture();
  assert.equal(f.call('loadPortTranslationCache', base, {}).ok, false);
  assert.equal(f.call('loadPortTranslationCache', { ...base, scope: 'attacker', accountId: 'other', channel: 'telegram' }).ok, true);
  assert.equal(f.calls[0][1].scope, 'server:one'); assert.equal(f.calls[0][1].accountId, 'wa:a');
  assert.equal(f.calls[0][1].channel, 'whatsapp');
  assert.equal(f.handlers.has('webchannels:savePortTranslationCache'), false);
});
test('offline local cache reads do not authorize over network, and translation stays unavailable', async () => {
  const f = ipcFixture(async () => { throw new Error('must not call'); });
  f.change({ scope: 'server:one', demo: false, local: true, accountIds: ['wa:a'] });
  f.access.authorize = () => { throw new Error('no network'); };
  const loaded = f.call('loadPortTranslationCache');
  assert.equal(loaded.ok, true); assert.equal(loaded.enabled, false);
  assert.equal((await f.call('translateMessage')).ok, false);
});
test('quota denial and an identity switch during translation cannot write a result', async () => {
  let finish;
  const f = ipcFixture(() => new Promise(resolve => { finish = resolve; }));
  f.access.authorize = async () => ({ ok: false });
  assert.equal((await f.call('translateMessage')).ok, false); assert.equal(f.calls.length, 0);
  f.access.authorize = async () => ({ ok: true });
  const pending = f.call('translateMessage'); await Promise.resolve();
  f.change({ scope: 'server:two', demo: false, accountIds: ['wa:a'] });
  finish({ text: '迟到的译文', provider: 'platform' });
  assert.equal((await pending).ok, false); assert.equal(f.calls.length, 0);
});
test('only host translator output is saved after authorization; renderer answers are ignored', async () => {
  const f = ipcFixture(async () => ({ text: '主进程译文', provider: 'platform' }));
  const result = await f.call('translateMessage', { ...base, answer: 'forged', provider: 'forged' });
  assert.equal(result.ok, true); assert.equal(f.calls[0][1].answer, '主进程译文');
  assert.equal(f.calls[0][1].provider, 'platform');
});
