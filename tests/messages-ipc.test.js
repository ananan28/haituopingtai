'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { init } = require('../messages-ipc');

function fixture() {
  const handlers = new Map(), calls = [], listeners = [];
  let revision = 1;
  let identity = { scope: 'demo:owner', demo: true, accountIds: ['demo:a'] };
  const access = { trusted: e => e === event, can: () => true, current: () => identity,
    revision: () => revision, onChange: fn => listeners.push(fn),
    authorize: async () => ({ ok: true, revision }) };
  const event = {};
  const store = Object.fromEntries(['put', 'list', 'translate', 'close'].map(method => [method, (...args) => { calls.push([method, ...args]); return method === 'list' ? [] : {}; }]));
  init({ app: new EventEmitter(), ipcMain: { handle: (name, fn) => handlers.set(name, fn) }, access, store });
  return { access, calls, event, call: (method, value, e = event) => handlers.get('messages:' + method)(e, value),
    change: value => { identity = value; revision++; for (const fn of listeners) fn(); } };
}

test('untrusted senders and unassigned accounts cannot touch message storage', async () => {
  const f = fixture();
  for (const method of ['put', 'list', 'translate']) {
    assert.equal((await f.call(method, { accountId: 'demo:a' }, {})).ok, false);
    assert.equal((await f.call(method, { accountId: 'a' })).ok, false);
  }
  assert.deepEqual(f.calls, []);
});

test('demo local records use verified identity scope and require no network authorization', async () => {
  const f = fixture();
  f.access.authorize = () => { throw new Error('Demo must not request server authorization'); };
  const result = await f.call('put', { accountId: 'demo:a', scope: 'server:other' });
  assert.equal(result.ok, true); assert.equal(f.calls[0][1], 'demo:owner');
});

test('real identities are reauthorized and renderer-provided scopes are ignored', async () => {
  const f = fixture();
  f.change({ scope: 'server:user', demo: false, accountIds: ['a'] });
  let authorizations = 0;
  f.access.authorize = async () => { authorizations++; return { ok: true }; };
  assert.equal((await f.call('list', { accountId: 'a', scope: 'server:owner' })).ok, true);
  assert.equal(authorizations, 1); assert.equal(f.calls.at(-1)[1], 'server:user');
  f.access.authorize = async () => ({ ok: false });
  assert.equal((await f.call('put', { accountId: 'a' })).ok, false);
});

test('identity switch during authorization discards access to the previous identity', async () => {
  const f = fixture();
  f.change({ scope: 'server:one', demo: false, accountIds: ['a'] });
  let resolve;
  f.access.authorize = () => new Promise(r => { resolve = r; });
  const pending = f.call('list', { accountId: 'a' });
  f.change({ scope: 'server:two', demo: false, accountIds: ['a'] });
  resolve({ ok: true });
  assert.equal((await pending).ok, false);
  assert.ok(f.calls.every(call => call[0] === 'close'));
});

test('identity switch in demo await boundary cannot return old messages or reopen old database', async () => {
  const f = fixture();
  const pending = f.call('list', { accountId: 'demo:a' });
  f.change(null);
  assert.equal((await pending).ok, false);
  assert.ok(f.calls.every(call => call[0] === 'close'));
});

test('translation writes require translate permission and matching demo provenance', async () => {
  const f = fixture();
  assert.equal((await f.call('translate', { accountId: 'demo:a', demo: false })).ok, false);
  assert.equal((await f.call('translate', { accountId: 'demo:a', demo: true })).ok, true);
  f.access.can = permission => permission !== 'translate';
  assert.equal((await f.call('translate', { accountId: 'demo:a', demo: true })).ok, false);
});
