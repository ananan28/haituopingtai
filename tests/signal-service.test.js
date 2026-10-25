'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const v8 = require('node:v8');
const { mount } = require('../signal/service');

test('Signal host service verifies profile ownership and never routes an unknown sender to the main account', async () => {
  const handlers = new Map(), events = new Map(), calls = [];
  let revision = 1, identity = { scope: 'server:one', demo: false, accountIds: ['a'] };
  const frame = { url: pathToFileURL(path.join(__dirname, '../signal/background.html')).href };
  const sender = { mainFrame: frame, getZoomFactor: () => 1, send() {} };
  const event = { sender, senderFrame: frame };
  const client = { state: 'ready', sqlReadSerialized: async (method, bytes) => { calls.push([method, v8.deserialize(bytes)]); return v8.serialize({ id: 'a', value: 'private' }); } };
  const entry = { profile: 'signal-test', scope: 'server:one', accountId: 'a', client };
  const runtime = { directory: '/isolated', entries: new Map([['signal-test', entry]]), client(profile) { if (profile !== entry.profile || client.state !== 'ready') throw new Error('Unknown profile'); return client; } };
  const nativeTheme = Object.assign(new EventEmitter(), { shouldUseDarkColors: true });
  mount({ electron: { app: { getPreferredSystemLanguages: () => ['C', 'en_US'], getPath: name => '/host/' + name },
    ipcMain: { on: (name, fn) => events.set(name, fn), handle: (name, fn) => handlers.set(name, fn) }, nativeTheme,
    clipboard: {}, systemPreferences: {} }, runtime,
    profiles: { profileForWebContents: wc => wc === sender ? 'signal-test' : null },
    access: { current: () => identity, revision: () => revision, can: () => true } });
  events.get('get-config')(event);
  assert.equal(event.returnValue.userDataPath, path.join('/isolated', 'signal-test'));
  assert.deepEqual(event.returnValue.preferredSystemLocales, ['en-US']);
  assert.equal(event.returnValue.version, require('../signal/package.json').version);
  assert.equal(handlers.has('caisheng:launch-signal-profile'), false);
  assert.equal(handlers.has('caisheng:show-settings-window'), false);
  const policy = await handlers.get('caisheng:get-translation-config')(event);
  assert.equal(policy.autoTranslateIncoming, false); assert.equal(policy.provider, 'platform'); assert.equal(policy.apiKey, '');
  await assert.rejects(handlers.get('caisheng:translate')(event), /尚未接入/);
  const data = v8.serialize(['key']);
  const result = await handlers.get('sql-channel:read')(event, 'getItemById', data);
  assert.equal(v8.deserialize(result.value).value, 'private');
  assert.equal(calls.length, 1);
  for (const bad of [{ sender: {}, senderFrame: frame }, { sender, senderFrame: {} }, { sender, senderFrame: null }]) {
    await assert.rejects(handlers.get('sql-channel:read')(bad, 'getItemById', data));
  }
  identity = { scope: 'server:other', demo: false, accountIds: ['a'] };
  await assert.rejects(handlers.get('sql-channel:read')(event, 'getItemById', data));
  identity = { scope: 'server:one', demo: false, accountIds: [] };
  await assert.rejects(handlers.get('sql-channel:read')(event, 'getItemById', data));
  identity = { scope: 'server:one', demo: true, accountIds: ['a'] };
  await assert.rejects(handlers.get('sql-channel:read')(event, 'getItemById', data));
  assert.equal(calls.length, 1);
  identity = { scope: 'server:one', demo: false, accountIds: ['a'] };
  frame.url = 'https://other.invalid'; events.get('get-config')(event); assert.equal(event.returnValue, null);
  frame.url = pathToFileURL(path.join(__dirname, '../signal/background.html')).href;
  let release; client.sqlReadSerialized = () => new Promise(resolve => { release = resolve; });
  const pending = handlers.get('sql-channel:read')(event, 'getItemById', data);
  revision++; release(v8.serialize('old private data')); await assert.rejects(pending, /changed/);
  client.state = 'closed'; events.get('get-config')(event); assert.equal(event.returnValue, null);
});
