'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { storageToken, accountAllowed } = require('../src/channel-identity');
const profiles = require('../signal/profiles');

test('storage identities distinguish punctuation, user scope, channel and delimiter boundaries', () => {
  const identities = [
    ['server:a', 'signal', 'a:b'], ['server:a', 'signal', 'a-b'],
    ['server:b', 'signal', 'a:b'], ['server:a', 'whatsapp', 'a:b'],
    ['a:b', 'c', 'd'], ['a', 'b:c', 'd']
  ];
  assert.equal(new Set(identities.map(x => storageToken(...x))).size, identities.length);
  assert.equal(storageToken(...identities[0]), storageToken(...identities[0]));
  for (const invalid of [undefined, '', 4, {}, 'x'.repeat(513)]) {
    assert.throws(() => storageToken(invalid, 'signal', 'a'));
  }
});

test('authorization requires an exact server account ID; demo and suffix aliases denied', () => {
  const identity = { demo: false, accountIds: ['tenant:a'] };
  assert.ok(accountAllowed(identity, 'tenant:a'));
  for (const id of ['a', 'other:tenant:a', 'tenant:b', '../a', 'a/b', null]) {
    assert.equal(accountAllowed(identity, id), false);
  }
  assert.equal(accountAllowed({ ...identity, demo: true }, 'tenant:a'), false);
  assert.equal(accountAllowed(null, 'tenant:a'), false);
});

test('Signal profile IDs are stable, scoped, bounded and cannot escape storage root', () => {
  const id = profiles.profileForAccount('a:b', 'server:user');
  assert.match(id, /^signal-[a-f0-9]{48}$/);
  assert.equal(id, profiles.profileForAccount('a:b', 'server:user'));
  assert.notEqual(id, profiles.profileForAccount('a-b', 'server:user'));
  assert.notEqual(id, profiles.profileForAccount('a:b', 'server:other'));
  assert.equal(profiles.userDataForProfile(id, '/data'), path.join('/data', 'Haituo', 'SignalProfiles', id));
  for (const value of ['../escape', 'signal-../../escape', '', null]) {
    assert.throws(() => profiles.userDataForProfile(value, '/data'));
  }
});

test('Signal sender mappings disappear when a view is destroyed', () => {
  const wc = Object.assign(new EventEmitter(), { id: 55, isDestroyed: () => false });
  profiles.bindWebContents(wc, 'signal-test');
  assert.equal(profiles.profileForWebContents(wc), 'signal-test');
  wc.emit('destroyed');
  assert.equal(profiles.profileForWebContents(wc), null);
});

function fixture(file) {
  const handlers = new Map();
  const app = new EventEmitter();
  let identity = { scope: 'server:one', demo: false, accountIds: ['a:b'] };
  let onChange;
  const access = { trusted: () => true, can: () => true, current: () => identity, revision: () => identity?.scope, onChange: fn => { onChange = fn; } };
  const created = [];
  class View {
    constructor(options) {
      this.options = options;
      this.visible = false;
      let closed = false;
      const wc = new EventEmitter();
      Object.assign(wc, {
        id: created.length + 1, isDestroyed: () => closed,
        close: () => { closed = true; wc.emit('destroyed'); },
        setWindowOpenHandler() {}, setUserAgent() {}, send() {},
        loadURL: async () => {}, loadFile: async () => {}, reload: () => { this.reloads = (this.reloads || 0) + 1; }
      });
      this.webContents = wc;
      created.push(this);
    }
    setVisible(value) { this.visible = value; }
    setBounds(value) { this.bounds = value; }
  }
  const wc = { send() {} };
  const children = new Set();
  const win = { isDestroyed: () => false, webContents: wc,
    contentView: { addChildView: v => children.add(v), removeChildView: v => children.delete(v) } };
  const module = { exports: {} };
  const signal = { ROOT: '/signal', mount() {}, isMounted: () => true, rendererPreferences: () => ({}),
    prepareProfile: async (scope, id) => ({ profile: profiles.profileForAccount(id, scope) }),
    closeProfile: async () => {}, closeAllProfiles: async () => {} };
  const context = { module, exports: module.exports, __dirname: path.dirname(path.join(__dirname, '..', file)), URL, console,
    require(name) {
      if (name === 'electron') return { WebContentsView: View, ipcMain: { handle: (id, fn) => {
        assert.equal(handlers.has(id), false, 'duplicate IPC handler'); handlers.set(id, fn);
      } }, app };
      if (name === '../runtime-access') return access;
      if (name.endsWith('channel-identity')) return { storageToken, accountAllowed };
      if (name === './index.js') return signal;
      if (name === './profiles.js') return profiles;
      if (name === 'node:path') return path;
      throw Error('Unexpected dependency: ' + name);
    }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context, { filename: file });
  const api = module.exports;
  api.init({ getMainWindow: () => win });
  api.init({ getMainWindow: () => win }); // Reinitialization must not register duplicate IPC handlers.
  const prefix = file.startsWith('signal/') ? 'signal' : 'webchannels';
  return { api, created, children, handlers, event: { sender: wc },
    call: (method, ...args) => handlers.get(prefix + ':' + method)({ sender: wc }, ...args),
    switchIdentity: value => { identity = value; onChange(); }, app };
}

for (const file of ['src/webchannels.js', 'signal/channel.js']) {
  test(file + ': demo and suffix account IDs cannot create network views', async () => {
    const f = fixture(file);
    assert.equal(((await f.call('open', 'b', 'whatsapp'))).ok, false);
    f.switchIdentity({ scope: 'demo:owner', demo: true, accountIds: ['a:b'] });
    assert.equal((await f.call('open', 'a:b', 'whatsapp')).ok, false);
    assert.equal(f.created.length, 0);
  });
  test(file + ': identity switch closes all active and hidden views', async () => {
    const f = fixture(file);
    assert.equal((await f.call('open', 'a:b', 'whatsapp')).ok, true);
    f.call('setVisible', 'a:b', true);
    assert.equal(f.created[0].visible, true);
    f.switchIdentity({ scope: 'server:two', demo: false, accountIds: ['a:b'] });
    assert.equal(f.created[0].webContents.isDestroyed(), true);
    assert.equal(f.children.size, 0);
    assert.equal((await f.call('open', 'a:b', 'whatsapp')).ok, true);
    if (file.startsWith('src/')) assert.notEqual(f.created[0].options.webPreferences.partition, f.created[1].options.webPreferences.partition);
    f.call('destroyAll');
    assert.equal(f.created[1].webContents.isDestroyed(), true);
  });
  test(file + ': refresh reloads the existing renderer and sleep releases it', async () => {
    const f = fixture(file);
    await f.call('open', 'a:b', 'whatsapp');
    f.call('refresh', 'a:b');
    assert.equal(f.created.length, 1);
    assert.equal(f.created[0].reloads, 1);
    f.call('sleep', 'a:b');
    assert.equal(f.created[0].webContents.isDestroyed(), true);
    if (file.startsWith('signal/')) assert.equal(profiles.profileForWebContents(f.created[0].webContents), null);
  });
}

test('web channel cannot silently reuse a view from a different provider', async () => {
  const f = fixture('src/webchannels.js');
  assert.equal((await f.call('open', 'a:b', 'whatsapp')).ok, true);
  assert.equal((await f.call('open', 'a:b', 'telegram-a')).ok, false);
  assert.equal(f.created.length, 1);
});
