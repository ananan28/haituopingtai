'use strict';
// Local-only tests: production source is evaluated with an explicit dependency allowlist.
// No real Electron, Supabase, dotenv, storage, child process, OCR, or network is loaded.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { pathToFileURL } = require('node:url');
const { createHash } = require('node:crypto');
const ROOT = __dirname;
const FILES = ['runtime-access.js', 'auth.js', 'ipc.js', 'preload.js', 'screenshot.js', 'main.js', 'src/capture-preload.js', 'distribution.js'];
const sources = Object.fromEntries(FILES.map(file => [file, fs.readFileSync(path.join(ROOT, file), 'utf8')]));
const tests = [];
const results = [];
const safetyViolations = [];
class HarnessError extends Error {}
function test(name, fn, refs = []) { tests.push({ name, fn, refs }); }
function check(ok, message) { assert.ok(ok, message); }
function equal(a, b, message) { assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), message); }
function denied(result) { check(result && result.ok === false, `Expected denial, got ${JSON.stringify(result)}`); }
function accepted(result) { check(result && result.ok === true, `Expected success, got ${JSON.stringify(result)}`); }
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function flush() { for (let i = 0; i < 24; i++) await Promise.resolve(); }
async function reachedCall(fixture, method) {
  for (let i = 0; i < 32 && !fixture.calls.some(c => c[0] === method); i++) await flush();
  check(fixture.calls.some(c => c[0] === method), 'Expected call before advancing fake clock: ' + method);
  await flush();
}
function line(file, text) {
  const i = sources[file].split('\n').findIndex(s => s.includes(text));
  if (i < 0) throw new HarnessError(`Missing source anchor: ${file}: ${text}`);
  return `${path.join(ROOT, file)}:${i + 1}`;
}
function clock() {
  let now = 0, next = 0;
  const timers = new Map();
  return {
    setTimeout(fn, delay) { const id = ++next; timers.set(id, { fn, at: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    async advance(ms) {
      now += ms;
      for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.fn(); }
      await flush();
    }
  };
}
function load(file, deps, globals = {}) {
  const module = { exports: {} };
  const context = vm.createContext({
    module, exports: module.exports, __dirname: ROOT, __filename: path.join(ROOT, file),
    require(id) {
      if (!Object.hasOwn(deps, id)) throw new HarnessError(`Blocked unmocked dependency ${file} -> ${id}`);
      return deps[id];
    },
    process: { env: {}, argv: [], platform: 'test-no-subprocess' },
    console: { log() {}, warn() {}, error() {} }, Buffer,
    ...globals
  });
  new vm.Script(sources[file], { filename: path.join(ROOT, file) }).runInContext(context);
  return module.exports;
}
const USER = role => ({ id: 'server-' + role, email: role + '@example.invalid', role, accountIds: [], accounts: [] });
const session = role => ({ ok: true, user: USER(role) });
function runtime(authOverrides = {}) {
  const calls = [];
  const auth = {
    getSession: async () => { calls.push('getSession'); return { ok: true, user: null }; },
    signIn: async () => { calls.push('signIn'); return session('user'); },
    signUp: async () => { calls.push('signUp'); return { ok: true, needsEmailConfirm: true }; },
    signOut: async () => { calls.push('signOut'); return { ok: true }; },
    clearLocalSession: async () => { calls.push('clearLocalSession'); },
    pauseRefresh: () => calls.push('pauseRefresh'), resumeRefresh: () => calls.push('resumeRefresh'),
    isConfigured: () => true, ...authOverrides
  };
  const access = load('runtime-access.js', { path, url: { pathToFileURL }, './auth': auth });
  return { access, auth, calls };
}
const SESSION_KEY = 'sb-offline-auth-token';
const tokenSession = (user, tag = 'dormant') => ({ user, access_token: 'FAKE_ACCESS_' + tag, refresh_token: 'FAKE_REFRESH_' + tag });
const fakeSafeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: value => Buffer.from('VM-ONLY:' + value),
  decryptString: bytes => {
    const value = bytes.toString();
    if (!value.startsWith('VM-ONLY:')) throw new Error('fake decryption failure');
    return value.slice(8);
  }
};
function memoryFs(initial = {}) {
  // These absolute names are Map keys only. No fake adapter method delegates to real fs.
  const sessionFile = path.join(path.parse(ROOT).root, '__runtime_security_memory_only__', 'session.json');
  const tmp = sessionFile + '.tmp', directory = path.dirname(sessionFile);
  const files = new Map([[sessionFile, JSON.stringify(initial)]]);
  const calls = [], hooks = {}, violations = [];
  function bounded(ok, message) {
    if (!ok) { const error = new HarnessError(message); violations.push(error); safetyViolations.push(error); throw error; }
  }
  async function before(method, args) {
    bounded(calls.length < 1000, 'Fake fs operation limit exceeded');
    const allowed = method === 'mkdir' ? [directory] : [sessionFile, tmp];
    bounded(typeof args[0] === 'string' && allowed.includes(args[0]), `Blocked fake fs path: ${method} ${args[0]}`);
    if (method === 'rename') bounded(args[0] === tmp && args[1] === sessionFile, 'Unexpected fake fs rename');
    calls.push([method, ...args]);
    if (hooks[method]) await hooks[method](...args);
  }
  const fsp = {
    async readFile(...args) {
      await before('readFile', args);
      if (!files.has(args[0])) throw Object.assign(new Error('fake ENOENT'), { code: 'ENOENT' });
      return files.get(args[0]);
    },
    async mkdir(...args) { await before('mkdir', args); },
    async writeFile(...args) {
      await before('writeFile', args);
      bounded(typeof args[1] === 'string' && Buffer.byteLength(args[1]) <= 65536, 'Fake fs content limit exceeded');
      files.set(args[0], args[1]);
      bounded(files.size <= 2, 'Fake fs file limit exceeded');
    },
    async rename(...args) {
      await before('rename', args);
      if (!files.has(args[0])) throw Object.assign(new Error('fake missing temporary file'), { code: 'ENOENT' });
      files.set(args[1], files.get(args[0])); files.delete(args[0]);
    },
    async chmod(...args) { await before('chmod', args); }
  };
  return { fsp, sessionFile, tmp, files, calls, hooks, violations,
    persisted: () => {
      const envelope = files.has(sessionFile) ? JSON.parse(files.get(sessionFile)) : {};
      return envelope.version === 1 ? JSON.parse(fakeSafeStorage.decryptString(Buffer.from(envelope.encrypted, 'base64'))) : envelope;
    },
    raw: () => files.get(sessionFile) || '' };
}
function authFixture(options = {}) {
  const time = clock();
  const calls = [];
  const initialUser = options.stored === undefined ? { ...USER('owner'), user_metadata: { role: 'owner' } } : options.stored;
  const memory = options.memory || memoryFs(initialUser ? { [SESSION_KEY]: JSON.stringify(tokenSession(initialUser)) } : {});
  const verified = options.verified === undefined ? USER('user') : options.verified;
  let profile = options.profile === undefined ? { role: 'user' } : options.profile;
  let storage, clientOptions;
  const behavior = {
    // Exercise the production adapter captured from createClient; no independent saved-session variable.
    getSession: async () => {
      const value = await storage.getItem(SESSION_KEY);
      return { data: { session: value ? JSON.parse(value) : null }, error: null };
    },
    getUser: async () => ({ data: { user: verified }, error: null }),
    role: async () => ({ data: profile, error: null }),
    staff: async () => ({ data: { channel_allowlist: [], char_quota: 0, char_used: 0, status: 'active' }, error: null }),
    audit: async () => ({ data: [], error: null }),
    rpc: async () => ({ data: { ok: true }, error: null }),
    signIn: async () => {
      await storage.setItem(SESSION_KEY, JSON.stringify(tokenSession(verified, 'fresh-login')));
      return { data: { user: verified }, error: null };
    },
    signOut: async () => { await storage.removeItem(SESSION_KEY); return { error: null }; },
    signUp: async () => ({ data: { user: verified, session: null }, error: null }),
    pause: () => {}, resume: () => {},
    ...options.behavior
  };
  const client = {
    auth: {
      getSession: (...args) => { calls.push(['getSession', ...args]); return behavior.getSession(...args); },
      getUser: (...args) => { calls.push(['getUser', ...args]); return behavior.getUser(...args); },
      signInWithPassword: (...args) => { calls.push(['signIn', ...args]); return behavior.signIn(...args); },
      signOut: (...args) => { calls.push(['signOut', ...args]); return behavior.signOut(...args); },
      signUp: (...args) => { calls.push(['signUp', ...args]); return behavior.signUp(...args); },
      stopAutoRefresh: () => { calls.push(['pause']); return behavior.pause(); },
      startAutoRefresh: () => { calls.push(['resume']); return behavior.resume(); },
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } })
    },
    rpc(name, params) { calls.push(['rpc', name]); return behavior.rpc(name, params); },
    from(table) {
      calls.push(['from', table]);
      const chain = {
        select(column) { calls.push(['select', column]); return chain; },
        eq(column, id) { calls.push(['eq', column, id]); return chain; },
        in() { return chain; }, order() { return chain; }, limit() { return chain; },
        single: () => behavior.role(),
        maybeSingle: () => behavior.staff(),
        then(resolve) {
          const rows = table === 'audit_logs' ? [] : table === 'staff_accounts' ? [] : [];
          return Promise.resolve(resolve({ data: rows, error: null }));
        }
      };
      return chain;
    }
  };
  const auth = load('auth.js', {
    '@supabase/supabase-js': { createClient(url, key, config) {
      check(url === 'https://offline.invalid' && key === 'fake-not-a-credential');
      storage = config.auth.storage; clientOptions = config;
      calls.push(['createClient']); return client;
    } },
    ws: class NoNetwork { constructor() { throw new HarnessError('Network forbidden'); } }, 'fs/promises': memory.fsp, path,
    dotenv: { config: () => { calls.push(['dotenv-stub-no-read']); return {}; } }
  }, {
    process: { env: options.unconfigured ? {} : { SUPABASE_URL: 'https://offline.invalid', SUPABASE_ANON_KEY: 'fake-not-a-credential' }, argv: [] },
    setTimeout: time.setTimeout, clearTimeout: time.clearTimeout
  });
  auth.init(memory.sessionFile, options.safeStorage === undefined ? fakeSafeStorage : options.safeStorage);
  return { auth, client, calls, behavior, time, memory, storage, clientOptions,
    setProfile(value) { profile = value; },
    getStored() { const value = memory.persisted()[SESSION_KEY]; return value ? JSON.parse(value).user : null; } };
}
function eventFor(url = pathToFileURL(path.join(ROOT, 'src', 'index.html')).href) {
  const mainFrame = { url };
  return { sender: { mainFrame }, senderFrame: mainFrame };
}
const STAFF_METHODS = ['listStaff', 'createStaff', 'suspendStaff', 'deleteStaff', 'assignChannel', 'allocateChars', 'resetPassword', 'listAudit'];
// [IPC channel, 权限点] —— 用于逐通道验证 fail-closed
const STAFF_CHANNELS = [
  ['staff:list', 'staff:manage'], ['staff:create', 'staff:manage'], ['staff:suspend', 'staff:manage'],
  ['staff:delete', 'staff:manage'], ['staff:assignChannel', 'staff:manage'],
  ['staff:allocateChars', 'quota:allocate'], ['password:reset', 'password:reset'], ['audit:list', 'audit:read']
];
const CHANNEL_METHOD = Object.fromEntries(STAFF_CHANNELS.map(([ch], i) => [ch, STAFF_METHODS[i]]));
function ipcFixture(rt = runtime(), withScreenshot = false) {
  const handlers = new Map(), calls = [], behavior = {};
  const event = eventFor();
  rt.access.bindWindow(event.sender);
  check(rt.access.trusted(event), 'Trusted fixture must reach authorization, not fail origin checks');
  const electron = {
    ipcMain: { handle(channel, fn) {
      if (handlers.has(channel)) throw new HarnessError(`Duplicate IPC handler ${channel}`);
      handlers.set(channel, fn);
    } },
    clipboard: { writeText: (...args) => calls.push(['clipboard', ...args]), writeImage: () => calls.push(['writeImage']) },
    BrowserWindow: Object.assign(function () { throw new HarnessError('GUI construction forbidden'); }, {
      fromWebContents: () => ({ minimize() { calls.push(['minimize']); }, isMaximized: () => false,
        maximize() { calls.push(['maximize']); }, unmaximize() {}, close() { calls.push(['close']); } })
    }),
    app: { on() {} }, globalShortcut: { register: () => true, unregisterAll() {} },
    nativeImage: { createFromDataURL() { throw new HarnessError('Native image access forbidden'); } },
    desktopCapturer: { getSources() { throw new HarnessError('Desktop capture forbidden'); } }, screen: {}
  };
  const distribution = Object.fromEntries(STAFF_METHODS.map(name => [name, async (...args) => {
    calls.push([name, ...args]); return behavior[name] ? behavior[name](...args) : { ok: true, marker: name };
  }]));
  const ocr = { recognize: async (...args) => { calls.push(['ocr', ...args]); return behavior.ocr ? behavior.ocr(...args) : { ok: true, text: 'PRIVATE_OCR_RESULT' }; } };
  const realtimeConfig = { attach: async () => ({ ok: true }), snapshot: async () => ({ ok: true, config: {} }), detach: () => {}, setConfig: async (...args) => { calls.push(['realtimeConfig.setConfig', ...args]); return { ok: true }; } };
  const { registerIpc } = load('ipc.js', {
    electron, './auth': rt.auth, './runtime-access': rt.access, './distribution': distribution, './ocr': ocr, './realtime-config': realtimeConfig,
    child_process: { execFile() { throw new HarnessError('Subprocess forbidden'); } },
    util: { promisify: fn => fn }
  });
  registerIpc();
  if (withScreenshot) {
    const screenshot = load('screenshot.js', { electron, path, url: { pathToFileURL }, './runtime-access': rt.access });
    screenshot.init({ getMainWindow: () => ({ isDestroyed: () => false, webContents: event.sender }) });
  }
  async function invoke(channel, ...args) {
    if (!handlers.has(channel)) throw new HarnessError('Unknown channel ' + channel);
    return handlers.get(channel)(event, ...args);
  }
  return { ...rt, handlers, calls, behavior, event, invoke };
}
const COMMON = ['home', 'account', 'accounts', 'usage', 'appearance', 'other', 'about', 'logout'];
const TRANSLATE = ['translate', 'basic-translate', 'advanced-translate', 'screenshot'];
const EXPECTED = {
  owner: [...COMMON, ...TRANSLATE, 'recharge', 'system', 'tg', 'catalog', 'account-edit', 'account-delete',
    'providers', 'announcements', 'writing', 'proxy', 'fingerprint',
    'staff:manage', 'quota:allocate', 'account:suspend', 'password:reset', 'audit:read', 'order:view', 'role:manage', 'pricing'],
  admin: [...COMMON, ...TRANSLATE, 'system', 'announcements', 'providers', 'pricing', 'catalog', 'account-edit',
    'staff:manage', 'quota:allocate', 'account:suspend', 'password:reset', 'audit:read', 'order:view'],
  user: [...COMMON, ...TRANSLATE, 'recharge', 'catalog', 'account-edit', 'account-delete',
    'staff:manage', 'quota:allocate', 'password:reset', 'order:view'],
  staff: [...COMMON, 'translate', 'basic-translate', 'password:reset']
};
const LABELS = { owner: '所有者', admin: '管理员', user: '商户 / 代理', staff: '员工子账号' };
for (const role of Object.keys(EXPECTED)) {
  test(`demo ${role}: fixed descriptor, scope, label, permissions, accounts`, async () => {
    const { access, calls } = runtime();
    const result = await access.enterDemo(role); accepted(result);
    equal(result.user, { id: 'demo-' + role, email: role + '@demo.local', role, label: LABELS[role], demo: true,
      revision: 1, scope: 'demo:' + role, permissions: EXPECTED[role],
      accountIds: role === 'staff' ? ['demo:wa-lea'] : ['demo:wa-lea', 'demo:tg-chen', 'demo:wa-group', 'demo:sg-sophie'] });
    equal(calls, ['clearLocalSession']);
  });
  test(`demo ${role}: identity, permissions and account IDs immutable`, async () => {
    const { access } = runtime(); const { user } = await access.enterDemo(role);
    for (const value of [user, user.permissions, user.accountIds]) check(Object.isFrozen(value));
    for (const mutate of [() => { user.role = 'owner'; }, () => user.permissions.push('ungranted'),
      () => user.permissions.splice(0), () => { user.accountIds[0] = 'foreign'; }, () => { user.permissions = ['agent']; }]) {
      // Array methods originate in the VM realm, so instanceof host TypeError is invalid.
      assert.throws(mutate, error => error && error.name === 'TypeError');
    }
    equal(access.current().permissions, EXPECTED[role]); check(!access.can('ungranted'));
  });
  for (const [channel] of STAFF_CHANNELS) test(`demo ${role}: direct IPC blocks ${channel} before backend`, async () => {
    const rt = runtime(); const f = ipcFixture(rt); accepted(await f.invoke('auth:demo', role));
    denied(await f.invoke(channel, 'victim@example.invalid', 'owner@example.invalid'));
    equal(f.calls, []); equal(rt.calls, ['clearLocalSession']);
  });
}
for (const role of ['root', 'OWNER', 'merchant', '', '__proto__', 'constructor', null, undefined, 0, {}, [], ['owner'], ['staff']]) {
  test(`invalid demo role rejected: ${JSON.stringify(role)}`, async () => {
    const f = ipcFixture(); denied(await f.invoke('auth:demo', role)); check(f.access.current() === null);
  }, [['runtime-access.js', "if (typeof role !== 'string' || !Object.hasOwn(RULES, role))"]]);
}
for (const role of ['owner', 'admin', 'user', 'staff']) {
  for (const operation of ['signIn', 'getSession']) test(`auth ${operation}: verified server ${role} accepted`, async () => {
    const a = authFixture({ profile: { role }, verified: { ...USER(role), user_metadata: { role: 'staff' } } });
    const result = await a.auth[operation]('test@example.invalid', 'not-a-real-password'); accepted(result);
    equal(result.user.role, role); check(a.calls.some(c => c[0] === 'eq' && c[2] === USER(role).id));
    if (operation === 'getSession') check(a.calls.some(c => c[0] === 'getUser'));
  });
  test(`runtime ${role}: verified restore and login identities immutable`, async () => {
    const a = authFixture({ profile: { role }, verified: USER(role) }); const r = runtime(a.auth);
    accepted(await r.access.restore()); equal(r.access.current().role, role); equal(r.access.current().accountIds, []);
    check(Object.isFrozen(r.access.current()) && Object.isFrozen(r.access.current().permissions));
    accepted(await r.access.authenticate('signIn', 'test@example.invalid', 'not-a-real-password'));
    equal(r.access.current().scope, 'server:' + USER(role).id); check(!r.access.isDemo());
  });
  for (const [channel, perm] of STAFF_CHANNELS) test(`server ${role}: direct IPC ${channel} permission matrix`, async () => {
    const a = authFixture({ profile: { role }, verified: USER(role) }); const f = ipcFixture(runtime(a.auth));
    const allowed = EXPECTED[role].includes(perm);
    const args = channel === 'staff:allocateChars' ? ['staff-1', 20] : channel === 'password:reset' ? ['staff-1', 'secret6'] : ['test@example.invalid'];
    const result = await f.invoke(channel, ...args);
    if (allowed) { accepted(result); equal(f.calls.map(c => c[0]), [CHANNEL_METHOD[channel]]); }
    else { denied(result); equal(f.calls, []); }
  });
}
for (const badRole of [null, {}, { role: null }, { role: 'merchant' }, { role: 'OWNER' }, { role: ['owner'] }]) {
  for (const op of ['signIn', 'getSession']) test(`auth ${op}: invalid/missing profile ${JSON.stringify(badRole)} fails closed`, async () => {
    const a = authFixture({ profile: badRole }); const result = await a.auth[op]('test@example.invalid', 'not-a-real-password');
    denied(result); check(result.user === null);
  });
}
for (const op of ['signIn', 'getSession']) {
  for (const mode of ['error', 'reject', 'timeout']) test(`auth ${op}: role ${mode}, no merchant fallback`, async () => {
    const a = authFixture({ behavior: { role: mode === 'error' ? async () => ({ data: { role: 'owner' }, error: { message: 'offline' } })
      : mode === 'reject' ? async () => { throw new Error('fake network unavailable'); } : () => new Promise(() => {}) } });
    const pending = a.auth[op]('test@example.invalid', 'not-a-real-password');
    await flush();
    if (mode === 'timeout') { await reachedCall(a, 'from'); await a.time.advance(5000); }
    const result = await pending; denied(result); check(result.user === null);
  });
  test(`auth ${op}: user_metadata cannot upgrade verified profile user`, async () => {
    const a = authFixture({ verified: { ...USER('user'), role: 'owner', user_metadata: { role: 'owner', permissions: ['agent'] } }, profile: { role: 'user' } });
    const result = await a.auth[op]('test@example.invalid', 'not-a-real-password'); accepted(result); equal(result.user.role, 'user');
  });
}
for (const mode of ['missing', 'error', 'reject', 'timeout']) test(`auth restore: server getUser ${mode} denies local owner`, async () => {
  const behavior = { getUser: mode === 'missing' ? async () => ({ data: { user: null }, error: null })
    : mode === 'error' ? async () => ({ data: { user: USER('owner') }, error: { message: 'revoked' } })
      : mode === 'reject' ? async () => { throw new Error('offline'); } : () => new Promise(() => {}) };
  const a = authFixture({ behavior, profile: { role: 'owner' } }); const pending = a.auth.getSession();
  await flush(); if (mode === 'timeout') await a.time.advance(8000);
  const result = await pending; denied(result); check(result.user === null); check(!a.calls.some(c => c[0] === 'from'));
});
test('auth: local session ID/role ignored; profile belongs to getUser verified ID', async () => {
  const a = authFixture({ stored: { ...USER('owner'), user_metadata: { role: 'owner' } }, verified: USER('user'), profile: { role: 'user' } });
  const result = await a.auth.getSession(); accepted(result); equal(result.user, USER('user'));
  equal(a.calls.filter(c => c[0] === 'eq'), [['eq', 'id', 'server-user'], ['eq','active',true]]);
});
test('runtime plus auth: local owner metadata cannot grant owner-only permissions', async () => {
  const a = authFixture({ profile: { role: 'user' }, verified: { ...USER('user'), user_metadata: { role: 'owner' } } });
  const f = ipcFixture(runtime(a.auth));
  denied(await f.invoke('audit:list'));
  equal(f.calls, []); equal(f.access.current().role, 'user');
});
for (const role of ['merchant', undefined]) {
  test(`runtime: untrusted role from auth stub ${String(role)} rejected on login and restore`, async () => {
    const f = runtime({ getSession: async () => session(role), signIn: async () => session(role) });
    const result = await f.access.restore(); check(!result.user && !f.access.current());
    denied(await f.access.authenticate('signIn', 'test@example.invalid', 'fake-password'));
    denied(await f.access.authorize('staff:manage')); check(f.access.current() === null);
  });
}
test('unconfigured auth: cannot login/authorize and does not create network client', async () => {
  const a = authFixture({ unconfigured: true }); denied(await a.auth.signIn('test@example.invalid', 'fake-password'));
  const f = ipcFixture(runtime(a.auth)); denied(await f.invoke('staff:list'));
  check(!a.calls.some(c => c[0] === 'createClient')); equal(f.calls, []);
});
for (const mode of ['missing-profile', 'getSession-reject', 'getUser-reject', 'role-error', 'role-timeout', 'verification-timeout']) {
  test(`integrated auth/runtime/IPC: ${mode} blocks every distribution before backend`, async () => {
    for (const [channel] of STAFF_CHANNELS) {
      const behavior = {};
      if (mode === 'getSession-reject') behavior.getSession = async () => { throw new Error('fake local auth failure'); };
      if (mode === 'getUser-reject') behavior.getUser = async () => { throw new Error('fake verification network failure'); };
      if (mode === 'role-error') behavior.role = async () => ({ data: { role: 'owner' }, error: { message: 'fake network error' } });
      if (mode === 'role-timeout') behavior.role = () => new Promise(() => {});
      if (mode === 'verification-timeout') behavior.getUser = () => new Promise(() => {});
      const a = authFixture({ behavior, profile: mode === 'missing-profile' ? null : { role: 'owner' } });
      const f = ipcFixture(runtime(a.auth)); const pending = f.invoke(channel);
      await flush();
      if (mode === 'role-timeout') { await reachedCall(a, 'from'); await a.time.advance(5000); }
      if (mode === 'verification-timeout') { await reachedCall(a, 'getUser'); await a.time.advance(8000); }
      denied(await pending); equal(f.calls, []); check(!f.access.current());
    }
  });
}
const originCases = {
  https: () => eventFor('https://attacker.invalid/index.html'),
  data: () => eventFor('data:text/html,spoof'),
  otherFile: () => eventFor(pathToFileURL(path.join(ROOT, 'src', 'capture.html')).href),
  query: () => eventFor(pathToFileURL(path.join(ROOT, 'src', 'index.html')).href + '?spoof=1'),
  fragment: () => eventFor(pathToFileURL(path.join(ROOT, 'src', 'index.html')).href + '#spoof'),
  iframeSameURL: () => { const e = eventFor(); e.senderFrame = { url: e.senderFrame.url }; return e; },
  iframeForeignURL: () => { const e = eventFor(); e.senderFrame = { url: 'https://attacker.invalid' }; return e; },
  mismatchedSender: () => { const e = eventFor(); e.sender = eventFor().sender; return e; },
  noSenderFrame: () => { const e = eventFor(); e.senderFrame = null; return e; }
};
for (const [name, makeEvent] of Object.entries(originCases)) test(`IPC ${name}: every registered handler denied before side effects`, async () => {
  const f = ipcFixture(runtime(), true); accepted(await f.access.enterDemo('owner'));
  const bad = makeEvent();
  // Keep the sender bound so URL/frame negatives cannot pass merely due to the new sender check.
  Object.assign(f.event.sender, bad.sender);
  bad.sender = f.event.sender;
  check(!f.access.trusted(bad));
  const before = f.access.revision();
  for (const [channel, handler] of f.handlers) denied(await handler(bad, 'owner', 'fake-password'));
  equal(f.calls, []); equal(f.access.revision(), before);
});
test('IPC: exact file URL and matching main frame accepted', async () => {
  const f = ipcFixture(); check(f.access.trusted(f.event)); accepted(await f.invoke('auth:demo', 'owner'));
  accepted(await f.invoke('clipboard:write', 'local-test')); equal(f.calls, [['clipboard', 'local-test']]);
});
test('IPC: another WebContents with same URL must not impersonate app main window', async () => {
  const f = ipcFixture(runtime({ getSession: async () => session('owner') }), true);
  accepted(await f.access.restore()); const otherWebContents = eventFor();
  check(otherWebContents.sender !== f.event.sender);
  // Screenshot pins its sender to the configured main window; general IPC should too.
  denied(await f.handlers.get('screenshot:status')(otherWebContents));
  const result = await f.handlers.get('staff:list')(otherWebContents);
  check(!result.ok && f.calls.length === 0,
    `Different same-URL WebContents accepted: result=${JSON.stringify(result)}, backendCalls=${JSON.stringify(f.calls)}`);
}, [['runtime-access.js', 'return event.sender === mainContents'], ['ipc.js', 'if (!access.trusted(event))']]);
for (const transition of ['demo', 'signout', 'invalidate', 'login']) {
  test(`race: pending restore invalidated by ${transition}`, async () => {
    const d = deferred(); const f = runtime({ getSession: () => d.promise });
    const pending = f.access.restore(); const before = f.access.revision();
    if (transition === 'demo') accepted(await f.access.enterDemo('staff'));
    if (transition === 'signout') accepted(await f.access.signOut());
    if (transition === 'invalidate') f.access.invalidate();
    if (transition === 'login') accepted(await f.access.authenticate('signIn', 'test@example.invalid', 'fake-password'));
    check(f.access.revision() > before); d.resolve(session('owner')); denied(await pending);
    check(f.access.current()?.role !== 'owner');
  });
  test(`race: pending authorize invalidated by ${transition}`, async () => {
    const d = deferred(); const f = runtime({ getSession: () => d.promise });
    const pending = f.access.authorize('staff:manage');
    if (transition === 'demo') accepted(await f.access.enterDemo('owner'));
    if (transition === 'signout') accepted(await f.access.signOut());
    if (transition === 'invalidate') f.access.invalidate();
    if (transition === 'login') accepted(await f.access.authenticate('signIn', 'test@example.invalid', 'fake-password'));
    d.resolve(session('owner')); denied(await pending);
  });
}
for (const transition of ['demo', 'signout']) test(`race: direct distribution awaiting authorize vs ${transition}, no backend call`, async () => {
  const d = deferred(); const f = ipcFixture(runtime({ getSession: () => d.promise }));
  const pending = f.invoke('staff:allocateChars', 'victim', 20);
  if (transition === 'demo') accepted(await f.invoke('auth:demo', 'owner'));
  else accepted(await f.invoke('auth:signout'));
  d.resolve(session('owner')); denied(await pending); equal(f.calls, []);
});
for (const method of ['signIn', 'signUp']) test(`race: pending ${method} serializes login/signup/demo/signout/restore`, async () => {
  const d = deferred(); const f = runtime({ [method]: () => d.promise });
  const pending = f.access.authenticate(method, 'test@example.invalid', 'fake-password');
  const rev = f.access.revision();
  for (const next of ['signIn', 'signUp']) denied(await f.access.authenticate(next, 'test@example.invalid', 'fake-password'));
  denied(await f.access.enterDemo('owner')); denied(await f.access.signOut());
  const restored = await f.access.restore(); check(!restored.user); denied(await f.access.authorize('staff:manage'));
  equal(f.access.revision(), rev); d.resolve(method === 'signIn' ? session('user') : { ok: true, needsEmailConfirm: true });
  accepted(await pending); equal(f.access.current()?.role || null, method === 'signIn' ? 'user' : null);
});
test('race: signout in flight blocks all authentication and dormant restore', async () => {
  const d = deferred(); const f = runtime({ getSession: async () => session('owner'), signOut: () => d.promise });
  accepted(await f.access.restore()); const before = f.access.revision(); const pending = f.access.signOut();
  check(f.access.revision() > before); check(!f.access.current()); denied(await f.access.enterDemo('owner'));
  denied(await f.access.authenticate('signIn', 'test@example.invalid', 'fake-password'));
  check(!(await f.access.restore()).user); denied(await f.access.authorize('staff:manage'));
  d.resolve({ ok: true }); accepted(await pending); check(!(await f.access.restore()).user);
});
test('race: server invalidation during pending login must discard late identity', async () => {
  const d = deferred(); const f = runtime({ signIn: () => d.promise });
  const pending = f.access.authenticate('signIn', 'test@example.invalid', 'fake-password');
  const before = f.access.revision(); f.access.invalidate(); d.resolve(session('owner'));
  const result = await pending;
  denied(result); check(f.access.revision() > before); check(f.access.current() === null);
}, [['runtime-access.js', 'if (demo || local) return;'], ['runtime-access.js', "if (method === 'signIn' && result.ok"]]);
test('race: newer verification denial must stop older authorize and backend mutation', async () => {
  const d = deferred(); let n = 0;
  const f = ipcFixture(runtime({ getSession: () => ++n === 1 ? d.promise : Promise.resolve({ ok: false, user: null, error: 'revoked' }) }));
  const old = f.invoke('staff:allocateChars', 'victim', 20);
  denied(await f.access.restore()); d.resolve(session('owner'));
  const result = await old;
  check(!result.ok && f.calls.length === 0 && !f.access.current(),
    `Older authorization survived newer denial: result=${JSON.stringify(result)}, backendCalls=${JSON.stringify(f.calls)}, role=${f.access.current()?.role}`);
}, [['runtime-access.js', 'if (current) { current = null; changed(); }'], ['runtime-access.js', 'const stamp = generation;']]);
test('revision: failed re-verification clears existing identity and invalidates verdict', async () => {
  const f = runtime({ getSession: async () => session('owner') });
  const verdict = await f.access.authorize('staff:manage'); accepted(verdict);
  f.auth.getSession = async () => ({ ok: false, user: null }); denied(await f.access.authorize('staff:manage'));
  check(f.access.revision() > verdict.revision); check(!f.access.current());
});
test('revision: changed server ID or role denies current call, next verified call succeeds', async () => {
  const f = runtime({ getSession: async () => session('owner') }); accepted(await f.access.authorize('role:manage'));
  const before = f.access.revision(); f.auth.getSession = async () => session('user');
  denied(await f.access.authorize('recharge')); check(f.access.revision() > before);
  accepted(await f.access.authorize('recharge')); denied(await f.access.authorize('role:manage'));
});
test('revision: same server identity remains stable across repeated verification', async () => {
  const f = runtime({ getSession: async () => session('owner') }); const first = await f.access.authorize('staff:manage'); accepted(first);
  accepted(await f.access.authorize('staff:manage')); equal(first.revision, f.access.revision());
});
test('revision: demo transitions notify listeners; unsubscribe works', async () => {
  const f = runtime(); const seen = []; const stop = f.access.onChange(() => seen.push(f.access.revision()));
  await f.access.enterDemo('owner'); await f.access.enterDemo('staff'); await f.access.signOut(); equal(seen, [1, 2, 3]);
  stop(); await f.access.enterDemo('user'); equal(seen, [1, 2, 3]);
});
for (const op of ['staff', 'ocr']) {
  for (const transition of ['signout', 'invalidate', 'login', 'demoAfterSignout']) test(`stale ${op} async result dropped after ${transition}`, async () => {
    const f = ipcFixture(runtime({ getSession: async () => session('owner') })); accepted(await f.access.restore());
    const d = deferred(); f.behavior[op === 'staff' ? 'listStaff' : 'ocr'] = () => d.promise;
    const pending = f.invoke(op === 'staff' ? 'staff:list' : 'ocr:recognize', 'data:image/png;base64,STUB');
    await flush(); equal(f.calls.length, 1);
    if (transition === 'signout' || transition === 'demoAfterSignout') accepted(await f.access.signOut());
    if (transition === 'demoAfterSignout') accepted(await f.access.enterDemo('owner'));
    if (transition === 'invalidate') f.access.invalidate();
    if (transition === 'login') accepted(await f.access.authenticate('signIn', 'new@example.invalid', 'fake-password'));
    d.resolve({ ok: true, secret: 'STALE_PRIVATE_RESULT' }); const result = await pending;
    denied(result); check(!JSON.stringify(result).includes('STALE_PRIVATE_RESULT'));
  });
  test(`${op}: unchanged identity receives legitimate async result`, async () => {
    const f = ipcFixture(runtime({ getSession: async () => session('owner') })); accepted(await f.access.restore());
    accepted(await f.invoke(op === 'staff' ? 'staff:list' : 'ocr:recognize', 'STUB'));
  });
}
test('OCR: demo role switch invalidates in-flight result', async () => {
  const f = ipcFixture(); await f.access.enterDemo('owner'); const d = deferred(); f.behavior.ocr = () => d.promise;
  const pending = f.invoke('ocr:recognize', 'STUB'); await flush(); equal(f.calls.length, 1);
  await f.access.enterDemo('staff'); d.resolve({ ok: true, text: 'STALE_TEXT' }); denied(await pending);
});
test('OCR: logged-out and demo staff denied before recognizer runs', async () => {
  const f = ipcFixture(); denied(await f.invoke('ocr:recognize', 'STUB')); await f.access.enterDemo('staff');
  denied(await f.invoke('ocr:recognize', 'STUB')); equal(f.calls, []);
});
test('demo: server login/signup blocked without reaching auth', async () => {
  const f = runtime(); await f.access.enterDemo('owner');
  for (const op of ['signIn', 'signUp']) denied(await f.access.authenticate(op, 'test@example.invalid', 'fake-password'));
  equal(f.calls, ['clearLocalSession']);
});
test('demo: cannot replace already active real server identity', async () => {
  const f = runtime({ getSession: async () => session('owner') }); accepted(await f.access.restore());
  const before = f.access.revision(); denied(await f.access.enterDemo('owner')); equal(f.access.revision(), before); check(!f.access.isDemo());
});
test('demo logout: dormant real session cannot restore in same runtime', async () => {
  const a = authFixture({ profile: { role: 'owner' }, verified: USER('owner') }); const f = ipcFixture(runtime(a.auth));
  accepted(await f.invoke('auth:demo', 'owner')); accepted(await f.invoke('auth:signout'));
  for (let i = 0; i < 3; i++) { check(!(await f.invoke('auth:session')).user); denied(await f.invoke('staff:list')); }
  check(!a.calls.some(c => c[0] === 'getSession')); equal(f.calls, []);
});
test('demo logout: dormant session cannot restore after runtime restart', async () => {
  const a = authFixture({ profile: { role: 'owner' }, verified: USER('owner') });
  const first = runtime(a.auth); accepted(await first.access.enterDemo('staff')); accepted(await first.access.signOut());
  // Reconstruct auth AND runtime over the same fake files, not merely the suspended adapter.
  const second = authFixture({ memory: a.memory, profile: { role: 'owner' }, verified: USER('owner') });
  const restarted = runtime(second.auth); const result = await restarted.access.restore();
  check(!result.user && !restarted.access.current(), 'Dormant real owner session restored after demo logout/restart');
  equal(a.memory.persisted(), {}); check(!second.calls.some(c => c[0] === 'getUser'));
}, [['runtime-access.js', 'let allowRestore = true;'], ['runtime-access.js', 'if (wasDemo) return { ok: true };']]);
test('demo logout: fresh explicit server login re-enables verified restore only', async () => {
  const f = runtime({ getSession: async () => session('user') }); await f.access.enterDemo('owner'); await f.access.signOut();
  check(!(await f.access.restore()).user); accepted(await f.access.authenticate('signIn', 'test@example.invalid', 'fake-password'));
  accepted(await f.access.restore()); equal(f.access.current().role, 'user');
});
test('auth signout: local-only scope removes stub saved session', async () => {
  const a = authFixture(); accepted(await a.auth.signOut()); equal(a.calls.find(c => c[0] === 'signOut'), ['signOut', { scope: 'local' }]);
  check(a.getStored() === null);
});
test('auth signout: resolved client error must not be reported as success', async () => {
  const a = authFixture({ behavior: { signOut: async () => ({ error: { message: 'fake storage failure' } }) } });
  denied(await a.auth.signOut());
}, [['auth.js', "client.auth.signOut({ scope: 'local' })"]]);
test('preload: exact bridge routes, listener cleanup, no generic IPC escape', async () => {
  const exposed = [], invoked = [], listeners = new Map();
  load('preload.js', { electron: {
    contextBridge: { exposeInMainWorld: (name, value) => exposed.push([name, value]) },
    ipcRenderer: {
      invoke: async (...args) => { invoked.push(args); return { ok: true }; },
      on: (channel, fn) => listeners.set(channel, fn),
      removeListener: (channel, fn) => { check(listeners.get(channel) === fn); listeners.delete(channel); }
    }
  } });
  equal(exposed.length, 1); equal(exposed[0][0], 'haituo'); const bridge = exposed[0][1];
  const keys = Object.keys(bridge);
  const allowedGroups = ['brand', 'system', 'auth', 'staff', 'clipboard', 'ocr', 'screenshot', 'windowControls', 'channel', 'realtimeConfig', 'appSettings', 'webchannels', 'signal', 'messages'];
  check(keys.every((k) => allowedGroups.includes(k)), 'Unexpected bridge group: ' + JSON.stringify(keys));
  for (const g of ['auth', 'staff', 'clipboard', 'ocr', 'screenshot', 'windowControls']) check(keys.includes(g), 'Missing bridge group ' + g);
  const routes = {
    'system.fonts': 'system:fonts', 'auth.status': 'auth:status', 'auth.signUp': 'auth:signup', 'auth.signIn': 'auth:signin',
    'auth.signOut': 'auth:signout', 'auth.enterDemo': 'auth:demo', 'auth.getSession': 'auth:session',
    'staff.list': 'staff:list', 'staff.create': 'staff:create', 'staff.suspend': 'staff:suspend', 'staff.remove': 'staff:delete',
    'staff.assignChannel': 'staff:assignChannel', 'staff.allocateChars': 'staff:allocateChars', 'staff.resetPassword': 'password:reset', 'staff.audit': 'audit:list',
    'clipboard.write': 'clipboard:write', 'clipboard.writeImage': 'clipboard:writeImage', 'ocr.recognize': 'ocr:recognize',
    'screenshot.start': 'screenshot:start', 'screenshot.setDefault': 'screenshot:setDefault', 'screenshot.status': 'screenshot:status',
    'windowControls.minimize': 'window:minimize', 'windowControls.toggleMaximize': 'window:toggleMaximize', 'windowControls.close': 'window:close'
  };
  const f = ipcFixture(runtime(), true);
  for (const [key, channel] of Object.entries(routes)) {
    const [group, method] = key.split('.'); await bridge[group][method]('arg1', 'arg2');
    equal(invoked.at(-1)[0], channel); check(f.handlers.has(channel));
  }
  // Signal 渠道处理器由 signal/channel.js 注册（非 ipc.js），仅校验桥接通道名。
  for (const [key, channel] of Object.entries({ 'signal.open': 'signal:open', 'signal.setBounds': 'signal:setBounds', 'signal.setVisible': 'signal:setVisible', 'signal.sleep': 'signal:sleep' })) {
    const [group, method] = key.split('.'); await bridge[group][method]('arg1', 'arg2');
    equal(invoked.at(-1)[0], channel);
  }
  for (const [group, method, channel] of [['auth', 'onAuthStateChange', 'auth:state'], ['screenshot', 'onResult', 'screenshot:result']]) {
    let received; const off = bridge[group][method](value => { received = value; }); listeners.get(channel)({}, 'payload');
    equal(received, 'payload'); off(); check(!listeners.has(channel));
  }
});
test('IPC inventory: no wallet/payment/recharge/debit handlers or preload calls', () => {
  const f = ipcFixture(runtime(), true);
  const channels = [...f.handlers.keys()];
  check(['staff:list', 'staff:create', 'staff:allocateChars', 'password:reset', 'audit:list', 'system:fonts', 'ocr:recognize', 'clipboard:write', 'window:close', 'screenshot:start'].every((c) => channels.includes(c)), 'Missing required handler: ' + JSON.stringify(channels));
  check(!channels.some(c => /wallet|payment|recharge|debit|checkout|withdraw|balance|transfer/i.test(c)));
  for (const file of FILES) {
    for (const match of sources[file].matchAll(/(?:handle|withWindow|invoke|send|on)\s*\(\s*['"]([^'"]+)['"]/g)) {
      check(!/wallet|payment|recharge|debit|checkout|withdraw|balance|transfer/i.test(match[1]), `${file}: ${match[1]}`);
    }
  }
});
// Preserve the complete original inventory above; all extensions are counted separately.
const ORIGINAL_TEST_COUNT = tests.length;
if (ORIGINAL_TEST_COUNT !== 183) throw new HarnessError(`Original inventory changed: ${ORIGINAL_TEST_COUNT}/183`);
const STORAGE_REFS = [['auth.js', 'function createFileStorage'], ['auth.js', 'async function clearLocalSession']];
const DEMO_REFS = [['runtime-access.js', 'async function enterDemo'], ['runtime-access.js', 'function invalidate']];
const VERIFY_REFS = [['runtime-access.js', 'const request = ++verification;'], ['runtime-access.js', 'request !== verification']];
function noPersistedTokens(a) {
  equal(a.memory.persisted(), {});
  check(!/FAKE_ACCESS_|FAKE_REFRESH_/.test(a.memory.raw()), 'Persisted fake credentials survived clear');
  check(!a.memory.files.has(a.memory.tmp), 'Atomic update left temporary file behind');
}
async function cannotRestoreFromFiles(memory) {
  const a = authFixture({ memory, profile: { role: 'owner' }, verified: USER('owner') });
  const f = ipcFixture(runtime(a.auth));
  const start = memory.calls.length;
  const result = await f.invoke('auth:session');
  accepted(result); check(!result.user && !f.access.current());
  check(memory.calls.slice(start).some(c => c[0] === 'readFile'), 'Restart must actually read the fake persisted file');
  check(!a.calls.some(c => c[0] === 'getUser' || c[0] === 'from'), 'Absent token must not reach server verification');
  for (const [channel] of STAFF_CHANNELS) denied(await f.invoke(channel));
  equal(f.calls, []);
  return a;
}
function holdFs(memory, method) {
  const entered = deferred(), release = deferred();
  memory.hooks[method] = async () => {
    delete memory.hooks[method]; entered.resolve(); await release.promise;
  };
  return { entered: entered.promise, release: () => release.resolve() };
}

test('storage: capture production createClient adapter and read real fake-file tokens', async () => {
  const a = authFixture();
  check(a.storage === a.clientOptions.auth.storage);
  equal(Object.keys(a.storage).sort(), ['getItem', 'setItem', 'removeItem', 'clear', 'resume'].sort());
  equal({ ...a.clientOptions.auth, storage: null }, { storage: null, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false });
  equal(JSON.parse(await a.storage.getItem(SESSION_KEY)), tokenSession({ ...USER('owner'), user_metadata: { role: 'owner' } }));
  check(a.memory.calls.some(c => c[0] === 'readFile' && c[1] === a.memory.sessionFile));
}, STORAGE_REFS);

test('storage: clearLocalSession pauses refresh and empties every persisted token', async () => {
  const a = authFixture(); await a.storage.setItem('other-token', 'FAKE_REFRESH_other');
  await a.auth.clearLocalSession(); noPersistedTokens(a);
  equal(await a.storage.getItem(SESSION_KEY), null);
  equal(a.calls.filter(c => ['pause', 'signOut', 'getUser', 'getSession'].includes(c[0])), [['pause']]);
  const writes = a.memory.calls.filter(c => c[0] === 'writeFile');
  equal(JSON.parse(writes.at(-1)[2]), {});
  check(writes.every(c => c[3].mode === 0o600));
  check(a.memory.calls.filter(c => c[0] === 'chmod').every(c => c[2] === 0o600));
}, STORAGE_REFS);

test('storage: stale writes after clear cannot persist or restore across fresh auth module', async () => {
  const a = authFixture(); await a.auth.clearLocalSession();
  const operations = a.memory.calls.length;
  await Promise.all(Array.from({ length: 12 }, (_, i) => a.storage.setItem(SESSION_KEY, JSON.stringify(tokenSession(USER('owner'), 'stale-' + i)))));
  noPersistedTokens(a); equal(a.memory.calls.length, operations);
  equal(await a.storage.getItem(SESSION_KEY), null);
  await cannotRestoreFromFiles(a.memory);
}, STORAGE_REFS);

test('storage: resumeRefresh alone cannot unsuspend cleared storage', async () => {
  const a = authFixture(); await a.auth.clearLocalSession(); a.auth.resumeRefresh();
  await a.storage.setItem(SESSION_KEY, JSON.stringify(tokenSession(USER('owner'), 'stale-refresh')));
  noPersistedTokens(a); equal(await a.storage.getItem(SESSION_KEY), null);
  await cannotRestoreFromFiles(a.memory);
}, STORAGE_REFS);

for (const operation of ['signIn', 'signUp']) test(`storage: only explicit ${operation} re-enables fresh client writes`, async () => {
  const a = authFixture({ verified: USER('user'), profile: { role: 'user' } });
  await a.auth.clearLocalSession();
  await a.storage.setItem(SESSION_KEY, JSON.stringify(tokenSession(USER('owner'), 'stale')));
  noPersistedTokens(a);
  a.behavior[operation] = async () => {
    await a.storage.setItem(SESSION_KEY, JSON.stringify(tokenSession(USER('user'), 'explicit-' + operation)));
    return { data: { user: USER('user'), session: tokenSession(USER('user'), 'explicit-' + operation) }, error: null };
  };
  accepted(await a.auth[operation]('user@example.invalid', 'fake-password'));
  const saved = JSON.parse(a.memory.persisted()[SESSION_KEY]);
  equal(saved, tokenSession(USER('user'), 'explicit-' + operation));
  const restarted = authFixture({ memory: a.memory, verified: USER('user'), profile: { role: 'user' } });
  const result = await runtime(restarted.auth).access.restore(); accepted(result); equal(result.user.role, 'user');
  check(restarted.calls.some(c => c[0] === 'getUser'));
}, STORAGE_REFS);

for (const method of ['signIn', 'signUp']) test(`storage: stale write submitted while suspended stays dropped across failed explicit ${method}`, async () => {
  const a = authFixture({ profile: { role: 'owner' }, verified: USER('owner'), behavior: {
    [method]: async () => ({ data: { user: null, session: null }, error: { message: 'fake rejected credentials' } })
  } });
  const oldToken = a.memory.persisted()[SESSION_KEY]; const f = ipcFixture(runtime(a.auth));
  accepted(await f.invoke('auth:demo', 'staff')); noPersistedTokens(a);
  accepted(await f.invoke('auth:signout')); // Offline logout must not resume dormant server storage.
  // Submit while still suspended; explicit login resumes before this queued callback gets a turn.
  const staleWrite = a.storage.setItem(SESSION_KEY, oldToken);
  const login = await f.invoke(method === 'signIn' ? 'auth:signin' : 'auth:signup', 'wrong@example.invalid', 'fake-wrong-password');
  denied(login); check(!f.access.current()); await staleWrite;
  const restarted = authFixture({ memory: a.memory, profile: { role: 'owner' }, verified: USER('owner') });
  const result = await runtime(restarted.auth).access.restore();
  check(!a.memory.persisted()[SESSION_KEY] && !result.user,
    `Write submitted during suspension survived failed ${method}: login.ok=${login.ok}, persisted=${Boolean(a.memory.persisted()[SESSION_KEY])}, restartedRole=${result.user?.role || null}`);
}, [['auth.js', 'setItem: (key, value) => mutate'], ['auth.js', 'if (suspended) return;'], ['auth.js', 'async function ' + method + '(']]);

test('storage: clear awaits asynchronous refresh pause before completing', async () => {
  const d = deferred(); const a = authFixture({ behavior: { pause: () => d.promise } });
  let done = false;
  const clearing = a.auth.clearLocalSession().then(() => { done = true; });
  await flush(); check(!done); check(a.memory.raw().includes('FAKE_REFRESH_dormant'));
  d.resolve(); await clearing; noPersistedTokens(a);
}, STORAGE_REFS);

test('storage: concurrent atomic set/remove operations preserve unrelated keys without tmp collisions', async () => {
  const a = authFixture({ stored: null });
  await Promise.all(Array.from({ length: 16 }, (_, i) => a.storage.setItem('key-' + i, 'value-' + i)));
  equal(a.memory.persisted(), Object.fromEntries(Array.from({ length: 16 }, (_, i) => ['key-' + i, 'value-' + i])));
  await Promise.all([a.storage.removeItem('key-0'), a.storage.setItem('key-16', 'value-16'), a.storage.removeItem('key-3')]);
  const expected = Object.fromEntries(Array.from({ length: 17 }, (_, i) => ['key-' + i, 'value-' + i]));
  delete expected['key-0']; delete expected['key-3']; equal(a.memory.persisted(), expected);
  check(!a.memory.files.has(a.memory.tmp));
  const atomic = a.memory.calls.filter(c => ['writeFile', 'rename', 'chmod'].includes(c[0])).map(c => c[0]);
  equal(atomic, Array.from({ length: 19 }, () => ['writeFile', 'rename', 'chmod']).flat());
}, STORAGE_REFS);

for (const stage of ['readFile', 'mkdir', 'writeFile', 'rename', 'chmod']) test(`storage: clear serializes behind in-flight ${stage} and drops queued stale writes`, async () => {
  const a = authFixture(); const gate = holdFs(a.memory, stage);
  const old = a.storage.setItem(SESSION_KEY, JSON.stringify(tokenSession(USER('owner'), 'old-in-flight')));
  await gate.entered;
  const queued = a.storage.setItem('queued-token', 'FAKE_REFRESH_queued');
  let done = false;
  const clear = a.auth.clearLocalSession().then(() => { done = true; });
  await flush(); check(!done, 'Clear returned before an older atomic operation finished');
  const late = a.storage.setItem(SESSION_KEY, JSON.stringify(tokenSession(USER('owner'), 'late')));
  gate.release(); await Promise.all([old, queued, clear, late]);
  noPersistedTokens(a); equal(await a.storage.getItem(SESSION_KEY), null);
  await cannotRestoreFromFiles(a.memory);
}, STORAGE_REFS);

test('storage: reads wait for pending atomic clear rather than seeing old tokens', async () => {
  const a = authFixture(); const gate = holdFs(a.memory, 'rename');
  const clear = a.auth.clearLocalSession(); await gate.entered;
  let done = false;
  const read = a.storage.getItem(SESSION_KEY).then(value => { done = true; return value; });
  await flush(); check(!done); gate.release(); await clear;
  equal(await read, null); noPersistedTokens(a);
}, STORAGE_REFS);

test('storage: clear during pending read never returns the old token', async () => {
  const a = authFixture(); const gate = holdFs(a.memory, 'readFile');
  const read = a.storage.getItem(SESSION_KEY); await gate.entered;
  await a.auth.clearLocalSession(); gate.release(); equal(await read, null); noPersistedTokens(a);
}, STORAGE_REFS);

test('storage: rejected atomic update does not poison subsequent serialized clear', async () => {
  const a = authFixture();
  a.memory.hooks.rename = () => { delete a.memory.hooks.rename; throw new Error('fake rename failure'); };
  await assert.rejects(a.storage.setItem('new', 'value'), /fake rename failure/);
  await a.auth.clearLocalSession(); noPersistedTokens(a); await cannotRestoreFromFiles(a.memory);
}, STORAGE_REFS);

for (const state of ['missing', 'malformed']) test(`storage: ${state} session file has no dormant session and can be cleared`, async () => {
  const memory = memoryFs();
  if (state === 'missing') memory.files.delete(memory.sessionFile);
  else memory.files.set(memory.sessionFile, '{not-json');
  const a = authFixture({ memory }); equal(await a.storage.getItem(SESSION_KEY), null);
  const result = await a.auth.getSession(); accepted(result); check(!result.user);
  await a.auth.clearLocalSession(); noPersistedTokens(a);
}, STORAGE_REFS);

for (const stage of ['mkdir', 'writeFile', 'rename']) test(`demo: real adapter ${stage} failure denies demo without erasing evidence`, async () => {
  const a = authFixture(); const original = a.memory.raw(); const f = ipcFixture(runtime(a.auth));
  a.memory.hooks[stage] = () => { throw new Error('fake clear failure at ' + stage); };
  const before = f.access.revision(); denied(await f.invoke('auth:demo', 'owner'));
  check(!f.access.current() && !f.access.isDemo()); check(f.access.revision() > before);
  equal(a.memory.raw(), original); // Do not pretend that a failed physical clear succeeded.
  await a.storage.setItem(SESSION_KEY, JSON.stringify(tokenSession(USER('owner'), 'stale')));
  equal(a.memory.raw(), original); equal(await a.storage.getItem(SESSION_KEY), null);
  check(!(await f.invoke('auth:session')).user);
  for (const [channel] of STAFF_CHANNELS) denied(await f.invoke(channel));
  equal(f.calls, []);
  delete a.memory.hooks[stage]; accepted(await f.invoke('auth:demo', 'staff'));
  noPersistedTokens(a); await cannotRestoreFromFiles(a.memory);
}, [...DEMO_REFS, ...STORAGE_REFS]);

test('demo: rejected clear stub never publishes identity and releases busy for retry', async () => {
  const f = runtime({ clearLocalSession: async () => { throw new Error('fake clear rejection'); } });
  denied(await f.access.enterDemo('owner')); check(!f.access.current() && !f.access.isDemo());
  check(!(await f.access.restore()).user); denied(await f.access.authorize('staff:manage'));
  f.auth.clearLocalSession = async () => {}; accepted(await f.access.enterDemo('staff'));
}, DEMO_REFS);

test('demo: pending clear publishes no identity and blocks all other authentication', async () => {
  const d = deferred(); const f = runtime({ clearLocalSession: () => d.promise });
  const before = f.access.revision(); const pending = f.access.enterDemo('owner');
  check(f.access.revision() > before); check(!f.access.current() && !f.access.isDemo());
  denied(await f.access.enterDemo('staff')); denied(await f.access.signOut());
  for (const method of ['signIn', 'signUp']) denied(await f.access.authenticate(method, 'test@example.invalid', 'fake-password'));
  check(!(await f.access.restore()).user); denied(await f.access.authorize('staff:manage')); equal(f.calls, []);
  d.resolve(); accepted(await pending); check(f.access.isDemo()); equal(f.access.current().role, 'owner');
}, DEMO_REFS);

for (const result of ['resolve', 'reject']) test(`demo: invalidation during pending clear discards ${result} outcome`, async () => {
  const d = deferred(); const f = runtime({ clearLocalSession: () => d.promise });
  const pending = f.access.enterDemo('owner'); const rev = f.access.revision();
  f.access.invalidate(); check(f.access.revision() > rev);
  if (result === 'resolve') d.resolve(); else d.reject(new Error('fake failed clear'));
  denied(await pending); check(!f.access.current() && !f.access.isDemo());
  check(!(await f.access.restore()).user); denied(await f.access.authorize('staff:manage'));
  f.auth.clearLocalSession = async () => {}; accepted(await f.access.enterDemo('staff'));
}, DEMO_REFS);

test('demo: invalidated real adapter clear still removes tokens but never grants identity', async () => {
  const a = authFixture(); const f = ipcFixture(runtime(a.auth)); const gate = holdFs(a.memory, 'rename');
  const pending = f.invoke('auth:demo', 'owner'); await gate.entered;
  check(!f.access.current() && !f.access.isDemo()); f.access.invalidate(); gate.release();
  denied(await pending); check(!f.access.current() && !f.access.isDemo()); noPersistedTokens(a);
  await cannotRestoreFromFiles(a.memory);
}, [...DEMO_REFS, ...STORAGE_REFS]);

test('demo: completed entry alone removes dormant tokens before logout or process restart', async () => {
  const a = authFixture(); const f = ipcFixture(runtime(a.auth));
  accepted(await f.invoke('auth:demo', 'owner')); noPersistedTokens(a);
  check(!a.calls.some(c => ['signOut', 'getSession', 'getUser', 'from'].includes(c[0])));
  await cannotRestoreFromFiles(a.memory);
}, [...DEMO_REFS, ...STORAGE_REFS]);

for (const method of ['signIn', 'signUp']) test(`login: invalidated pending ${method} denies late success and requires explicit retry`, async () => {
  const d = deferred(); const f = runtime({ [method]: () => d.promise });
  const pending = f.access.authenticate(method, 'test@example.invalid', 'fake-password');
  const before = f.access.revision(); f.access.invalidate();
  d.resolve(method === 'signIn' ? session('owner') : { ok: true, needsEmailConfirm: true });
  denied(await pending); check(f.access.revision() > before); check(!f.access.current());
  check(!(await f.access.restore()).user); denied(await f.access.authorize('staff:manage'));
  check(!f.calls.includes('resumeRefresh'));
  f.auth.signIn = async () => session('user');
  accepted(await f.access.authenticate('signIn', 'test@example.invalid', 'fake-password')); equal(f.access.current().role, 'user');
}, [['runtime-access.js', 'if (stamp !== generation) return denied'], ['runtime-access.js', 'function invalidate']]);

for (const mode of ['resolved-error', 'rejected-error']) test(`signout: ${mode} remains failure while clearing actual persisted tokens`, async () => {
  const a = authFixture({ behavior: { signOut: async () => {
    if (mode === 'rejected-error') throw new Error('fake remote revoke failure');
    return { error: { message: 'fake remote revoke failure' } };
  } } });
  const f = ipcFixture(runtime(a.auth)); accepted(await f.access.restore());
  const result = await f.invoke('auth:signout'); denied(result); check(typeof result.error === 'string' && result.error.length > 0);
  check(!f.access.current()); noPersistedTokens(a);
  equal(a.calls.find(c => c[0] === 'signOut'), ['signOut', { scope: 'local' }]);
  check(a.calls.some(c => c[0] === 'pause'));
  await a.storage.setItem(SESSION_KEY, JSON.stringify(tokenSession(USER('owner'), 'late-refresh')));
  noPersistedTokens(a); await cannotRestoreFromFiles(a.memory);
}, [['auth.js', 'async function signOut'], ['auth.js', 'await clearLocalSession();']]);

for (const stage of ['mkdir', 'writeFile', 'rename']) test(`signout: failed ${stage} clear never reports successful logout through IPC`, async () => {
  const a = authFixture({ behavior: { signOut: async () => ({ error: null }) } });
  const f = ipcFixture(runtime(a.auth)); accepted(await f.access.restore());
  a.memory.hooks[stage] = () => { throw new Error('fake persistence failure'); };
  denied(await f.invoke('auth:signout')); check(!f.access.current());
  check(!(await f.invoke('auth:session')).user); denied(await f.invoke('staff:list')); equal(f.calls, []);
  equal(await a.storage.getItem(SESSION_KEY), null);
}, [['auth.js', 'await clearLocalSession();'], ['ipc.js', '服务暂不可用']]);

test('signout: pending physical clear keeps runtime busy until atomic rename finishes', async () => {
  const a = authFixture({ behavior: { signOut: async () => ({ error: null }) } });
  const f = ipcFixture(runtime(a.auth)); accepted(await f.access.restore()); const gate = holdFs(a.memory, 'rename');
  const pending = f.invoke('auth:signout'); await gate.entered; check(!f.access.current());
  denied(await f.invoke('auth:demo', 'owner')); denied(await f.invoke('auth:signin', 'test@example.invalid', 'fake-password'));
  check(!(await f.invoke('auth:session')).user); denied(await f.invoke('staff:list')); equal(f.calls, []);
  gate.release(); accepted(await pending); noPersistedTokens(a);
}, [['runtime-access.js', 'async function signOut'], ...STORAGE_REFS]);

for (const mode of ['unbound', 'sameURL-other', 'previously-bound']) test(`trusted: ${mode} webContents denied by every handler with zero auth/backend effects`, async () => {
  const rt = runtime(); const f = ipcFixture(rt, true); accepted(await f.access.enterDemo('owner'));
  let bad = eventFor();
  if (mode === 'unbound') { bad = f.event; f.access.bindWindow(null); }
  if (mode === 'previously-bound') { bad = f.event; f.access.bindWindow(eventFor().sender); }
  check(!f.access.trusted(bad)); const before = f.access.revision(), authCalls = rt.calls.slice();
  for (const [channel, handler] of f.handlers) denied(await handler(bad, 'owner', 'fake-password'));
  equal(f.calls, []); equal(rt.calls, authCalls); equal(f.access.revision(), before);
}, [['runtime-access.js', 'return event.sender === mainContents'], ['ipc.js', 'if (!access.trusted(event))']]);

test('main wiring: binds actual main contents before loading and forwards SIGNED_OUT invalidation', async () => {
  const rt = runtime(); const windows = [], callbacks = new Map(); let ready, authState;
  const auth = { ...rt.auth, init() {}, onAuthStateChange(cb) { authState = cb; } };
  function FakeWindow() {
    const event = eventFor(); const listeners = new Map();
    this.on = (name, fn) => listeners.set('window:' + name, fn);
    this.isDestroyed = () => false;
    this.webContents = Object.assign(event.sender, { setWindowOpenHandler(fn) { this.openHandler = fn; },
      on(name, fn) { listeners.set(name, fn); }, send() {} });
    this.loadFile = file => {
      equal(file, path.join(ROOT, 'src', 'index.html')); check(rt.access.trusted(event), 'main must bind before loading');
      equal(this.webContents.openHandler(), { action: 'deny' });
      let prevented = false; listeners.get('will-navigate')({ preventDefault() { prevented = true; } }); check(prevented);
    };
    windows.push(this);
  }
  FakeWindow.getAllWindows = () => windows;
  load('main.js', { path, './package.json': { name: 'offline-test', version: '0.0.0' }, './auth': auth,
    './runtime-access': rt.access, './ipc': { registerIpc() {} }, './screenshot': { init() {} },
    './app-settings': { windowBackground: () => '#16181d', shouldMinimizeToTray: () => false, init: () => {} },
    './src/webchannels': { init: () => {} },
    './signal/channel': { init: () => {} },
    './messages-ipc': { init: () => {} },
    './src/translation-store': {init:()=>{},flush:()=>{}},
    electron: { BrowserWindow: FakeWindow, app: { setName() {}, getPath: () => path.parse(ROOT).root,
      whenReady: () => ({ then(fn) { ready = fn; } }), on: (name, fn) => callbacks.set(name, fn), quit() {} } } });
  ready(); equal(windows.length, 1);
  const d = deferred(); rt.auth.signIn = () => d.promise;
  const pending = rt.access.authenticate('signIn', 'test@example.invalid', 'fake-password');
  authState('SIGNED_OUT', null); d.resolve(session('owner')); denied(await pending); check(!rt.access.current());
}, [['main.js', 'access.bindWindow(win.webContents);'], ['main.js', "if (event === 'SIGNED_OUT') access.invalidate();"]]);

const COMPLETION_ORDERS = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
for (const latest of ['owner', 'user', 'denied', 'rejected', 'empty']) {
  for (const order of COMPLETION_ORDERS) test(`verification queue: latest ${latest} wins completion order ${order.join('-')}`, async () => {
    const requests = [deferred(), deferred(), deferred()]; let n = 0;
    const f = runtime({ getSession: () => requests[n++].promise });
    const pending = requests.map(() => f.access.restore()); equal(n, 3);
    let newestCompleted = false;
    for (const index of order) {
      if (index === 2) {
        newestCompleted = true;
        if (latest === 'rejected') requests[index].reject(new Error('fake verification failure'));
        else requests[index].resolve(latest === 'denied' ? { ok: false, user: null, error: 'revoked' }
          : latest === 'empty' ? { ok: true, user: null } : session(latest));
      } else requests[index].resolve(index === 0 ? session('owner') : { ok: false, user: null, error: 'older denial' });
      const result = await pending[index];
      if (index !== 2 || ['denied', 'rejected'].includes(latest)) denied(result); else accepted(result);
      const expected = newestCompleted && ['owner', 'user'].includes(latest) ? latest : null;
      equal(f.access.current()?.role || null, expected,
        `Completion ${index} overwrote latest ${latest}; order=${order}, result=${JSON.stringify(result)}`);
    }
  }, VERIFY_REFS);
}

for (const latest of ['success', 'denied', 'rejected']) test(`verification queue: ${latest} supersedes older authorized backend mutations`, async () => {
  const requests = [deferred(), deferred(), deferred()]; let n = 0;
  const f = ipcFixture(runtime({ getSession: () => requests[n++].promise }));
  const old = f.invoke('staff:allocateChars', 'victim', 20);
  const middle = f.invoke('staff:delete', 'victim');
  const newest = f.access.restore(); equal(n, 3);
  if (latest === 'rejected') requests[2].reject(new Error('fake verification rejected'));
  else requests[2].resolve(latest === 'success' ? session('user') : { ok: false, user: null, error: 'revoked' });
  const result = await newest; if (latest === 'success') accepted(result); else denied(result);
  requests[0].resolve(session('owner')); requests[1].resolve(session('owner'));
  denied(await old); denied(await middle); equal(f.calls, []);
  equal(f.access.current()?.role || null, latest === 'success' ? 'user' : null);
}, [...VERIFY_REFS, ['ipc.js', 'const verdict = await access.authorize(permission);']]);

test('auth restore: initial SDK session lookup timeout releases unauthenticated UI', async () => {
  const a = authFixture({ behavior: { getSession: () => new Promise(() => {}) } });
  const pending = a.auth.getSession();
  await flush(); await a.time.advance(8000);
  denied(await pending);
  check(!a.calls.some(c => c[0] === 'getUser'));
}, [['auth.js', 'session restore timeout']]);

// Keep the previously passing 241 tests intact; encryption extensions start here.
const BASELINE_TEST_COUNT = tests.length;
if (BASELINE_TEST_COUNT !== 258) throw new HarnessError(`Baseline inventory changed: ${BASELINE_TEST_COUNT}/258`);
const ENCRYPTION_REFS = [['auth.js', 'const requireEncryption ='], ['auth.js', 'const write = async (obj)']];
const MIGRATION_REFS = [['auth.js', 'if (loaded.legacy)'], ['auth.js', 'return suspended || version !== epoch ? null']];
function encryptedFixtureMap(data) {
  // Deliberately reversible VM fixture, NOT cryptography or a native safeStorage claim.
  return { version: 1, encrypted: fakeSafeStorage.encryptString(JSON.stringify(data)).toString('base64') };
}
function watchedSafeStorage(overrides = {}) {
  const calls = [];
  const provider = { ...fakeSafeStorage, ...overrides };
  const api = Object.fromEntries(Object.entries(provider).map(([name, fn]) => [name, (...args) => {
    calls.push([name, ...args]); return fn(...args);
  }]));
  return { api, calls };
}
function assertEncryptedWrites(memory) {
  // Include EVERY attempted write, even if a later write/rename hook throws.
  const writes = memory.calls.filter(c => c[0] === 'writeFile');
  for (const [, file, text, options] of writes) {
    equal(file, memory.tmp); equal(options.mode, 0o600);
    check(!/FAKE_ACCESS_|FAKE_REFRESH_|VM-ONLY:|sb-offline-auth-token/.test(text), 'Plaintext credential material reached writeFile');
    const obj = JSON.parse(text);
    if (Object.keys(obj).length === 0) { equal(obj, {}); continue; }
    equal(Object.keys(obj).sort(), ['encrypted', 'version']); equal(obj.version, 1);
    check(typeof obj.encrypted === 'string' && obj.encrypted.length > 0, 'Empty ciphertext persisted');
    const bytes = Buffer.from(obj.encrypted, 'base64'); equal(bytes.toString('base64'), obj.encrypted);
    const plain = JSON.parse(fakeSafeStorage.decryptString(bytes));
    check(plain && typeof plain === 'object' && !Array.isArray(plain));
    check(Object.keys(plain).length > 0 && Object.values(plain).every(value => typeof value === 'string'));
  }
  return writes;
}
function noServerCalls(a) {
  check(!a.calls.some(c => ['signIn', 'signUp', 'getUser', 'from', 'resume', 'signOut'].includes(c[0])), 'Unexpected server/authentication operation');
}
function explicitStorageDenial(result) {
  denied(result); check(!result.user);
  check(typeof result.error === 'string' && result.error.includes('系统安全存储'), 'Expected an explicit secure-storage error');
  check(!/FAKE_ACCESS_|FAKE_REFRESH_/.test(JSON.stringify(result)), 'Storage error leaked token material');
}
async function rejectsStorage(pending) {
  await assert.rejects(pending, error => {
    equal(error.code, 'SESSION_STORAGE');
    check(!/FAKE_ACCESS_|FAKE_REFRESH_/.test(error.message)); return true;
  });
}
const legacyMap = () => ({
  [SESSION_KEY]: JSON.stringify(tokenSession({ ...USER('owner'), user_metadata: { role: 'owner' } }, 'legacy')),
  'other-project-session': JSON.stringify(tokenSession(USER('user'), 'other-project')),
  'pkce-verifier': 'FAKE_REFRESH_pkce-verifier', 'empty-value': '', 'ordinary-setting': 'keep-me'
});

test('encryption: every nonempty set/remove write is an envelope, including temporary writes', async () => {
  const secure = watchedSafeStorage(), a = authFixture({ stored: null, safeStorage: secure.api });
  const first = JSON.stringify(tokenSession(USER('user'), 'first'));
  await a.storage.setItem(SESSION_KEY, first);
  await a.storage.setItem('other', 'FAKE_REFRESH_second');
  await a.storage.setItem(SESSION_KEY, JSON.stringify(tokenSession(USER('user'), 'replacement')));
  await a.storage.removeItem(SESSION_KEY);
  equal(a.memory.persisted(), { other: 'FAKE_REFRESH_second' });
  await a.storage.removeItem('other');
  equal(a.memory.persisted(), {});
  await a.storage.setItem('empty-value', '');
  equal(a.memory.persisted(), { 'empty-value': '' });
  await a.auth.clearLocalSession(); noPersistedTokens(a);
  const writes = assertEncryptedWrites(a.memory); equal(writes.length, 7);
  const encrypted = writes.map(c => JSON.parse(c[2])).filter(obj => obj.version === 1);
  equal(secure.calls.filter(c => c[0] === 'encryptString').map(c => c[1]),
    encrypted.map(obj => fakeSafeStorage.decryptString(Buffer.from(obj.encrypted, 'base64'))));
  equal(encrypted.length, 5);
}, ENCRYPTION_REFS);

for (const method of ['signIn', 'signUp']) test(`encryption: explicit ${method} persists only encrypted fake SDK tokens`, async () => {
  const a = authFixture({ stored: null });
  a.behavior[method] = async () => {
    const token = tokenSession(USER('user'), method);
    await a.storage.setItem(SESSION_KEY, JSON.stringify(token));
    return { data: { user: USER('user'), session: token }, error: null };
  };
  accepted(await a.auth[method]('user@example.invalid', 'fake-password'));
  equal(JSON.parse(a.memory.persisted()[SESSION_KEY]), tokenSession(USER('user'), method));
  // 登录前先清空旧会话（空 {} 明文外写）+ 新令牌加密写，共两次；任何非空写必须是加密信封。
  const writes = assertEncryptedWrites(a.memory);
  equal(writes.length, 2);
  equal(writes.map(c => JSON.parse(c[2])).filter(obj => obj.version === 1).length, 1);
  check(!a.memory.files.has(a.memory.tmp));
}, ENCRYPTION_REFS);

for (const key of [SESSION_KEY, 'absent-key']) test(`encryption: legacy getItem ${key} migrates every map entry before returning`, async () => {
  const data = legacyMap(), memory = memoryFs(data), secure = watchedSafeStorage();
  const a = authFixture({ memory, safeStorage: secure.api });
  equal(await a.storage.getItem(key), data[key] ?? null);
  equal(memory.persisted(), data); equal(assertEncryptedWrites(memory).length, 1);
  equal(secure.calls.filter(c => c[0] === 'encryptString').map(c => JSON.parse(c[1])), [data]);
  equal(memory.calls.filter(c => ['writeFile', 'rename', 'chmod'].includes(c[0])).map(c => c[0]), ['writeFile', 'rename', 'chmod']);
  for (const [entry, value] of Object.entries(data)) equal(await a.storage.getItem(entry), value);
  equal(assertEncryptedWrites(memory).length, 1); noServerCalls(a);
}, MIGRATION_REFS);

test('encryption: concurrent legacy reads migrate once without losing unrelated entries', async () => {
  const data = legacyMap(), a = authFixture({ memory: memoryFs(data) });
  const keys = Array.from({ length: 12 }, (_, i) => Object.keys(data)[i % Object.keys(data).length]);
  equal(await Promise.all(keys.map(key => a.storage.getItem(key))), keys.map(key => data[key]));
  equal(a.memory.persisted(), data); equal(assertEncryptedWrites(a.memory).length, 1);
}, MIGRATION_REFS);

test('encryption: migration rereads serialized state after a concurrent writer changes the map', async () => {
  const data = legacyMap(), a = authFixture({ memory: memoryFs(data) });
  let queued;
  a.memory.hooks.readFile = () => {
    delete a.memory.hooks.readFile;
    queued = a.storage.setItem('concurrent', 'FAKE_REFRESH_concurrent');
  };
  equal(await a.storage.getItem(SESSION_KEY), data[SESSION_KEY]); await queued;
  equal(a.memory.persisted(), { ...data, concurrent: 'FAKE_REFRESH_concurrent' });
  equal(assertEncryptedWrites(a.memory).length, 1);
}, MIGRATION_REFS);

test('encryption: legacy token remains withheld until encrypted atomic rename completes', async () => {
  const data = legacyMap(), a = authFixture({ memory: memoryFs(data) });
  const gate = holdFs(a.memory, 'rename'); let done = false;
  const pending = a.storage.getItem(SESSION_KEY).then(value => { done = true; return value; });
  await gate.entered; check(!done); equal(a.memory.persisted(), data);
  equal(assertEncryptedWrites(a.memory).length, 1);
  check(!/FAKE_ACCESS_|FAKE_REFRESH_/.test(a.memory.files.get(a.memory.tmp)));
  gate.release(); equal(await pending, data[SESSION_KEY]); equal(a.memory.persisted(), data);
  check(!a.memory.files.has(a.memory.tmp));
}, MIGRATION_REFS);

test('encryption: already encrypted getItem decrypts without rewriting or re-encrypting', async () => {
  const data = legacyMap(), secure = watchedSafeStorage();
  const a = authFixture({ memory: memoryFs(encryptedFixtureMap(data)), safeStorage: secure.api });
  const original = a.memory.raw();
  equal(await a.storage.getItem(SESSION_KEY), data[SESSION_KEY]);
  equal(await a.storage.getItem('empty-value'), ''); equal(await a.storage.getItem('absent'), null);
  equal(a.memory.raw(), original); equal(assertEncryptedWrites(a.memory), []);
  equal(secure.calls.filter(c => c[0] === 'encryptString'), []);
  equal(secure.calls.filter(c => c[0] === 'decryptString').length, 3);
}, ENCRYPTION_REFS);

for (const role of ['user', 'staff']) test(`encryption: fresh auth/runtime restart decrypts but trusts only server ${role}`, async () => {
  const first = authFixture({ stored: null });
  await first.storage.setItem(SESSION_KEY, JSON.stringify(tokenSession({ ...USER('owner'), user_metadata: { role: 'owner' } }, 'restart')));
  const secure = watchedSafeStorage();
  const a = authFixture({ memory: first.memory, safeStorage: secure.api, verified: USER(role), profile: { role } });
  check(a.storage !== first.storage && a.auth !== first.auth);
  const r = runtime(a.auth), result = await r.access.restore(); accepted(result);
  equal(result.user.id, USER(role).id); equal(result.user.role, role); equal(result.user.scope, 'server:' + USER(role).id);
  equal(a.calls.filter(c => c[0] === 'eq'), role === 'staff'
    ? [['eq', 'id', USER(role).id], ['eq', 'id', USER(role).id], ['eq','active',true]]
    : [['eq', 'id', USER(role).id], ['eq','active',true]]);
  equal(a.calls.filter(c => c[0] === 'getUser').length, 1);
  equal(secure.calls.filter(c => c[0] === 'decryptString').length, 1);
  check(!/FAKE_ACCESS_|FAKE_REFRESH_/.test(JSON.stringify(result)));
  equal(assertEncryptedWrites(a.memory).length, 1);
}, ENCRYPTION_REFS);

for (const mode of ['missing-user', 'revoked', 'rejected', 'invalid-profile']) test(`encryption: encrypted restart cannot authorize with ${mode} server verification`, async () => {
  const first = authFixture({ stored: null });
  await first.storage.setItem(SESSION_KEY, JSON.stringify(tokenSession(USER('owner'), 'unverified')));
  const behavior = mode === 'invalid-profile' ? {} : { getUser: async () => {
    if (mode === 'rejected') throw new Error('fake unavailable verification');
    return { data: { user: mode === 'missing-user' ? null : USER('owner') }, error: mode === 'revoked' ? { message: 'fake revoked' } : null };
  } };
  const a = authFixture({ memory: first.memory, behavior, profile: { role: mode === 'invalid-profile' ? 'merchant' : 'owner' } });
  const f = ipcFixture(runtime(a.auth)); denied(await f.invoke('staff:list'));
  check(!f.access.current()); equal(f.calls, []); check(a.calls.some(c => c[0] === 'getUser'));
  equal(assertEncryptedWrites(a.memory).length, 1);
}, ENCRYPTION_REFS);

const UNAVAILABLE_ENCRYPTION = {
  missing: () => null,
  unavailable: () => ({ ...fakeSafeStorage, isEncryptionAvailable: () => false }),
  basic_text: () => ({ ...fakeSafeStorage, getSelectedStorageBackend: () => 'basic_text' })
};
for (const [state, makeProvider] of Object.entries(UNAVAILABLE_ENCRYPTION)) {
  for (const method of ['signIn', 'signUp']) test(`encryption: ${state} preflight blocks ${method} directly and over IPC without network`, async () => {
    for (const viaIpc of [false, true]) {
      const a = authFixture({ safeStorage: makeProvider() });
      const f = ipcFixture(runtime(a.auth));
      const result = viaIpc ? await f.invoke(method === 'signIn' ? 'auth:signin' : 'auth:signup', 'user@example.invalid', 'fake-password')
        : await a.auth[method]('user@example.invalid', 'fake-password');
      explicitStorageDenial(result); noServerCalls(a); equal(f.calls, []); check(!f.access.current());
      // 登录前必须清空旧会话（写 {}，无明文凭据），失败不得留下上一身份可恢复令牌。
      noPersistedTokens(a);
      equal(assertEncryptedWrites(a.memory).map(c => JSON.parse(c[2])), [{}]);
      check(!a.memory.files.has(a.memory.tmp));
      // 失败后存储保持暂停：后续任意 setItem 被丢弃，仍无法留下凭据。
      await a.storage.setItem(SESSION_KEY, JSON.stringify(tokenSession(USER('owner'), 'blocked-resume')));
      noPersistedTokens(a); noServerCalls(a);
      equal(assertEncryptedWrites(a.memory).map(c => JSON.parse(c[2])), [{}]);
    }
  }, ENCRYPTION_REFS);
  for (const format of ['legacy', 'encrypted']) test(`encryption: ${state} ${format} restore returns explicit error and no token`, async () => {
    const data = legacyMap(), memory = memoryFs(format === 'legacy' ? data : encryptedFixtureMap(data));
    const a = authFixture({ memory, safeStorage: makeProvider() }), original = memory.raw();
    await rejectsStorage(a.storage.getItem(SESSION_KEY));
    explicitStorageDenial(await a.auth.getSession()); noServerCalls(a);
    equal(memory.raw(), original); equal(assertEncryptedWrites(memory), []);
    check(!memory.files.has(memory.tmp));
  }, ENCRYPTION_REFS);
  for (const format of ['legacy', 'encrypted', 'corrupt']) test(`encryption: ${state} still permits local clear and offline demo from ${format} storage`, async () => {
    for (const action of ['clear', 'demo']) {
      const data = legacyMap(), memory = memoryFs(format === 'legacy' ? data : encryptedFixtureMap(data));
      if (format === 'corrupt') memory.files.set(memory.sessionFile, '{broken ciphertext');
      const a = authFixture({ memory, safeStorage: makeProvider() }), f = ipcFixture(runtime(a.auth));
      if (action === 'clear') await a.auth.clearLocalSession();
      else {
        accepted(await f.invoke('auth:demo', 'staff')); check(f.access.isDemo());
        accepted(await f.invoke('auth:signout')); check(!f.access.current());
      }
      noPersistedTokens(a); noServerCalls(a); equal(f.calls, []);
      equal(assertEncryptedWrites(memory).map(c => JSON.parse(c[2])), [{}]);
      check(!memory.calls.some(c => c[0] === 'readFile'), 'Clearing must not depend on decrypting damaged data');
      const restarted = authFixture({ memory, safeStorage: makeProvider() });
      const result = await restarted.auth.getSession(); accepted(result); equal(result.user, null); noServerCalls(restarted);
    }
  }, ENCRYPTION_REFS);
}

for (const mode of ['throw', 'undefined', 'null']) {
  for (const operation of ['setItem', 'getItem-migration', 'removeItem']) test(`encryption: encryptString ${mode} rejects ${operation} without plaintext writes or token return`, async () => {
    const secure = watchedSafeStorage({ encryptString: () => {
      if (mode === 'throw') throw new Error('fake encryption failure FAKE_ACCESS_must-not-leak');
      return mode === 'null' ? null : undefined;
    } });
    const data = legacyMap(), a = authFixture({ memory: memoryFs(data), safeStorage: secure.api });
    const original = a.memory.raw();
    const pending = operation === 'setItem' ? a.storage.setItem('new', 'FAKE_REFRESH_new')
      : operation === 'removeItem' ? a.storage.removeItem('ordinary-setting') : a.storage.getItem(SESSION_KEY);
    await rejectsStorage(pending); equal(a.memory.raw(), original); equal(assertEncryptedWrites(a.memory), []);
    explicitStorageDenial(await a.auth.getSession()); noServerCalls(a);
    equal(assertEncryptedWrites(a.memory), []); check(!a.memory.files.has(a.memory.tmp));
    await a.auth.clearLocalSession(); noPersistedTokens(a); equal(assertEncryptedWrites(a.memory).length, 1);
  }, ENCRYPTION_REFS);
}

for (const operation of ['setItem', 'getItem-migration']) test(`encryption: empty encryption Buffer rejects ${operation} before persistence or token return`, async () => {
  const a = authFixture({ safeStorage: { ...fakeSafeStorage, encryptString: () => Buffer.alloc(0) } });
  const original = a.memory.raw();
  // Assert the contract even if production resolves: retain a reproducible regression failure, not an expected-failure pass.
  const pending = operation === 'setItem' ? a.storage.setItem('new', 'FAKE_REFRESH_empty-encryption') : a.storage.getItem(SESSION_KEY);
  const outcome = await pending.then(value => ({ value }), error => ({ error }));
  check(outcome.error?.code === 'SESSION_STORAGE',
    `Expected SESSION_STORAGE for empty ciphertext; resolved=${!outcome.error}, tokenReturned=${typeof outcome.value === 'string'}, writes=${a.memory.calls.filter(c => c[0] === 'writeFile').length}, envelope=${a.memory.raw()}`);
  equal(a.memory.raw(), original); equal(assertEncryptedWrites(a.memory), []);
}, ENCRYPTION_REFS);

const INVALID_ENVELOPES = {
  'version-zero': () => ({ ...encryptedFixtureMap(legacyMap()), version: 0 }),
  'wrong-version': () => ({ ...encryptedFixtureMap(legacyMap()), version: 2 }),
  'string-version': () => ({ ...encryptedFixtureMap(legacyMap()), version: '1' }),
  'missing-version': () => ({ encrypted: encryptedFixtureMap(legacyMap()).encrypted }),
  'missing-ciphertext': () => ({ version: 1 }),
  'empty-ciphertext': () => ({ version: 1, encrypted: '' }),
  'nonstring-ciphertext': () => ({ version: 1, encrypted: 123 }),
  'invalid-base64': () => ({ version: 1, encrypted: '***not-base64***' }),
  'noncanonical-base64': () => ({ version: 1, encrypted: Buffer.from('VM-ONLY:{}').toString('base64').replace(/=+$/, '') }),
  'base64-whitespace': () => ({ version: 1, encrypted: encryptedFixtureMap(legacyMap()).encrypted + '\n' }),
  'tampered-prefix': () => ({ version: 1, encrypted: Buffer.from('XM-ONLY:' + JSON.stringify(legacyMap())).toString('base64') }),
  'plaintext-disguised-as-ciphertext': () => ({ version: 1, encrypted: Buffer.from(JSON.stringify(legacyMap())).toString('base64') }),
  'decrypt-invalid-json': () => ({ version: 1, encrypted: fakeSafeStorage.encryptString('{truncated').toString('base64') }),
  'decrypt-array': () => encryptedFixtureMap([JSON.stringify(tokenSession(USER('owner')))]),
  'decrypt-null': () => encryptedFixtureMap(null),
  'decrypt-nonstring-entry': () => encryptedFixtureMap({ [SESSION_KEY]: tokenSession(USER('owner')) })
};
for (const [name, makeEnvelope] of Object.entries(INVALID_ENVELOPES)) test(`encryption: ${name} never returns a token or falls back to plaintext`, async () => {
  const memory = memoryFs(makeEnvelope()), a = authFixture({ memory }), original = memory.raw();
  await rejectsStorage(a.storage.getItem(SESSION_KEY)); explicitStorageDenial(await a.auth.getSession());
  noServerCalls(a); equal(memory.raw(), original); equal(assertEncryptedWrites(memory), []);
  await rejectsStorage(a.storage.setItem('new', 'FAKE_REFRESH_new'));
  equal(memory.raw(), original); equal(assertEncryptedWrites(memory), []);
  await a.auth.clearLocalSession(); noPersistedTokens(a); equal(assertEncryptedWrites(memory).length, 1);
}, ENCRYPTION_REFS);

test('encryption: decryptString failure rejects valid-looking envelope and redacts sensitive error', async () => {
  const memory = memoryFs(encryptedFixtureMap(legacyMap()));
  const a = authFixture({ memory, safeStorage: { ...fakeSafeStorage, decryptString: () => { throw new Error('FAKE_ACCESS_bad-key-or-tamper'); } } });
  await rejectsStorage(a.storage.getItem(SESSION_KEY)); explicitStorageDenial(await a.auth.getSession());
  noServerCalls(a); equal(assertEncryptedWrites(memory), []);
  await a.auth.clearLocalSession(); noPersistedTokens(a); equal(assertEncryptedWrites(memory).length, 1);
}, ENCRYPTION_REFS);

for (const stage of ['mkdir', 'writeFile', 'rename']) test(`encryption: failed legacy migration ${stage} withholds tokens, never writes plaintext, and clears safely`, async () => {
  const data = legacyMap(), a = authFixture({ memory: memoryFs(data) }), original = a.memory.raw();
  a.memory.hooks[stage] = () => { throw new Error('fake migration failure at ' + stage); };
  await assert.rejects(a.storage.getItem(SESSION_KEY), /fake migration failure/);
  const result = await a.auth.getSession(); denied(result); equal(result.user, null); noServerCalls(a);
  equal(a.memory.raw(), original); assertEncryptedWrites(a.memory);
  delete a.memory.hooks[stage]; await a.auth.clearLocalSession(); noPersistedTokens(a);
  assertEncryptedWrites(a.memory); await cannotRestoreFromFiles(a.memory);
}, MIGRATION_REFS);

for (const stage of ['initial-read', 'migration-reread', 'mkdir', 'writeFile', 'rename', 'chmod']) test(`encryption: clear racing legacy migration at ${stage} cannot return or resurrect tokens`, async () => {
  const a = authFixture({ memory: memoryFs(legacyMap()) });
  let gate;
  if (stage === 'migration-reread') {
    const entered = deferred(), release = deferred(); let reads = 0;
    a.memory.hooks.readFile = async () => {
      if (++reads === 2) { delete a.memory.hooks.readFile; entered.resolve(); await release.promise; }
    };
    gate = { entered: entered.promise, release: () => release.resolve() };
  } else gate = holdFs(a.memory, stage === 'initial-read' ? 'readFile' : stage);
  const pending = a.storage.getItem(SESSION_KEY); await gate.entered;
  const clearing = a.auth.clearLocalSession(); await flush();
  const stale = a.storage.setItem(SESSION_KEY, JSON.stringify(tokenSession(USER('owner'), 'late-migration')));
  gate.release(); equal(await pending, null); await Promise.all([clearing, stale]);
  noPersistedTokens(a); assertEncryptedWrites(a.memory); await cannotRestoreFromFiles(a.memory);
}, [...MIGRATION_REFS, ...STORAGE_REFS]);

test('encryption: failed in-flight migration cannot poison a queued clear or resurrect tokens', async () => {
  const a = authFixture({ memory: memoryFs(legacyMap()) });
  const entered = deferred(), release = deferred();
  a.memory.hooks.rename = async () => {
    delete a.memory.hooks.rename; entered.resolve(); await release.promise; throw new Error('fake migration rename rejected');
  };
  const pending = assert.rejects(a.storage.getItem(SESSION_KEY), /fake migration rename rejected/);
  await entered.promise; const clearing = a.auth.clearLocalSession(); await flush(); release.resolve();
  await Promise.all([pending, clearing]); noPersistedTokens(a); assertEncryptedWrites(a.memory);
  await cannotRestoreFromFiles(a.memory);
}, [...MIGRATION_REFS, ...STORAGE_REFS]);

test('encryption: clear then explicit resume invalidates older legacy read even after suspension ends', async () => {
  const a = authFixture({ memory: memoryFs(legacyMap()) }), gate = holdFs(a.memory, 'readFile');
  const old = a.storage.getItem(SESSION_KEY); await gate.entered;
  await a.auth.clearLocalSession();
  accepted(await a.auth.signIn('user@example.invalid', 'fake-password'));
  gate.release(); equal(await old, null);
  equal(JSON.parse(a.memory.persisted()[SESSION_KEY]), tokenSession(USER('user'), 'fresh-login'));
  assertEncryptedWrites(a.memory);
  const restarted = authFixture({ memory: a.memory, verified: USER('user'), profile: { role: 'user' } });
  const result = await restarted.auth.getSession(); accepted(result); equal(result.user, USER('user'));
}, MIGRATION_REFS);

test('encryption: main passes the exact safeStorage dependency to auth only after ready', () => {
  let ready; const initCalls = [], secure = watchedSafeStorage();
  const stop = new Error('VM-only stop after auth init; never construct a window');
  const fakeDirectory = path.join(path.parse(ROOT).root, '__runtime_security_memory_only__');
  load('main.js', { path, './package.json': { name: 'offline-test', version: '0.0.0' },
    './auth': { init: (...args) => initCalls.push(args) }, './runtime-access': {}, './screenshot': {},
    './app-settings': { windowBackground: () => '#16181d', shouldMinimizeToTray: () => false, init: () => {} },
    './src/webchannels': { init: () => {} },
    './signal/channel': { init: () => {} },
    './messages-ipc': { init: () => {} },
    './src/translation-store': {init:()=>{},flush:()=>{}},
    './ipc': { registerIpc: () => { throw stop; } },
    electron: { safeStorage: secure.api, BrowserWindow: function () { throw new HarnessError('GUI forbidden'); },
      app: { setName() {}, getPath(name) { equal(name, 'userData'); return fakeDirectory; },
        whenReady: () => ({ then(fn) { ready = fn; } }), on() {} } }
  });
  equal(initCalls, []); assert.throws(() => ready(), error => error === stop);
  equal(initCalls.length, 1); equal(initCalls[0][0], path.join(fakeDirectory, 'session.json'));
  check(initCalls[0][1] === secure.api, 'main omitted or replaced electron.safeStorage'); equal(secure.calls, []);
}, [['main.js', 'auth.init(path.join(app.getPath(\'userData\'), \'session.json\'), safeStorage);']]);

// ---- 独立验收新增阻断回归：真实 staff RPC 延迟切换 + 失败登录清旧会话 ----

function delayedRpcClient() {
  const calls = [];
  let releaseRpc; const rpcGate = new Promise((resolve) => { releaseRpc = resolve; });
  const client = {
    rpc(name, params) {
      calls.push(['rpc', name, params]);
      return rpcGate.then(() => ({ data: { ok: true }, error: null }));
    }
  };
  return { client, calls, releaseRpc };
}

test('staff RPC: identity switch mid-flight discards the result after the write', async () => {
  const delayed = delayedRpcClient();
  const dist = load('distribution.js', { './auth': { getClient: () => delayed.client } });
  let identityValid = true;
  const pending = dist.allocateChars('staff-1', 20, () => identityValid);
  await flush();
  identityValid = false; // 身份在 RPC 挂起期间切换
  delayed.releaseRpc();
  const result = await pending;
  denied(result); equal(result.error, '身份已切换，写操作已取消');
  check(delayed.calls.some((c) => c[0] === 'rpc' && c[1] === 'allocate_chars'));
}, [['distribution.js', 'function switched(guard)'], ['distribution.js', 'if (switched(guard)) return { ok: false, error: SWITCHED };']]);

test('staff RPC: valid guard permits the authorized write', async () => {
  const delayed = delayedRpcClient();
  const dist = load('distribution.js', { './auth': { getClient: () => delayed.client } });
  delayed.releaseRpc();
  accepted(await dist.allocateChars('staff-1', 20, () => true));
  check(delayed.calls.some((c) => c[0] === 'rpc' && c[1] === 'allocate_chars'));
}, [['distribution.js', 'function switched(guard)']]);

test('staff via real ipc: guard forwards and discards after identity switch', async () => {
  const delayed = delayedRpcClient();
  const dist = load('distribution.js', { './auth': { getClient: () => delayed.client } });
  const rt = runtime({
    getSession: async () => session('owner'),
    signIn: async () => ({ ok: false, error: 'fake rejected credentials' })
  });
  const handlers = new Map();
  const event = eventFor();
  rt.access.bindWindow(event.sender);
  const electron = {
    ipcMain: { handle(name, fn) { handlers.set(name, fn); } },
    clipboard: { writeText() {}, writeImage() {} },
    BrowserWindow: { fromWebContents: () => ({ minimize() {}, isMaximized: () => false, maximize() {}, unmaximize() {}, close() {} }) },
    app: { on() {} }
  };
  const { registerIpc } = load('ipc.js', { electron, './auth': rt.auth, './runtime-access': rt.access, './distribution': dist,
    './ocr': { recognize: async () => ({ ok: true }) }, './realtime-config': { attach: async () => ({ ok: true }), snapshot: async () => ({ ok: true, config: {} }), detach: () => {}, setConfig: async () => ({ ok: true }) },
    child_process: { execFile() { throw new HarnessError('Subprocess forbidden'); } }, util: { promisify: (fn) => fn } });
  registerIpc();
  const invoke = (channel, ...args) => handlers.get(channel)(event, ...args);
  const pending = invoke('staff:allocateChars', 'staff-1', 20);
  for (let i = 0; i < 32 && !delayed.calls.some((c) => c[0] === 'rpc'); i++) await flush();
  check(delayed.calls.some((c) => c[0] === 'rpc'), 'Allocate RPC never reached the gated client');
  const transition = rt.access.authenticate('signIn', 'other@example.invalid', 'fake-password');
  delayed.releaseRpc();
  denied(await pending);
  await transition;
}, [['ipc.js', 'const guard = () => revision === access.revision() && !access.isDemo();'], ['distribution.js', 'function switched(guard)']]);

test('auth: failed switch clears prior session so restart cannot restore the old owner', async () => {
  const a = authFixture({ profile: { role: 'owner' }, verified: USER('owner'), behavior: {
    signIn: async () => ({ data: { user: null, session: null }, error: { message: 'fake rejected credentials' } })
  } });
  const f = ipcFixture(runtime(a.auth));
  accepted(await f.invoke('auth:session')); equal(f.access.current().role, 'owner');
  denied(await f.invoke('auth:signin', 'other@example.invalid', 'fake-wrong-password'));
  check(!f.access.current());
  noPersistedTokens(a);
  const restarted = authFixture({ memory: a.memory, profile: { role: 'owner' }, verified: USER('owner') });
  const result = await runtime(restarted.auth).access.restore();
  accepted(result); check(!result.user);
  check(!restarted.getStored(), 'Old owner credential survived a failed account switch');
}, [['auth.js', 'async function beginFreshAuth'], ['auth.js', 'await clearLocalSession();']]);

(async () => {
  // Validate every evidence anchor up front, including passing regressions.
  for (const entry of tests) for (const [file, anchor] of entry.refs) line(file, anchor);
  for (const entry of tests) {
    let watchdog;
    try {
      await Promise.race([
        Promise.resolve().then(entry.fn),
        new Promise((_, reject) => { watchdog = setTimeout(() => reject(new HarnessError('Harness watchdog: unresolved test')), 2000); })
      ]);
      if (safetyViolations.length) throw safetyViolations[0];
      results.push({ status: 'PASS', name: entry.name });
      console.log('PASS ' + entry.name);
    } catch (error) {
      const harness = error instanceof HarnessError || error?.name !== 'AssertionError';
      const status = harness ? 'HARNESS_ERROR' : 'FAIL';
      const refs = entry.refs.map(([file, anchor]) => line(file, anchor));
      results.push({ status, name: entry.name, message: error.message, refs });
      console.log(status + ' ' + entry.name + '\n  ' + error.message + (refs.length ? '\n  ' + refs.join('\n  ') : ''));
      if (harness) console.log(error.stack);
    } finally { clearTimeout(watchdog); }
  }
  const changed = FILES.filter(file => fs.readFileSync(path.join(ROOT, file), 'utf8') !== sources[file]);
  const summary = { PASS: results.filter(r => r.status === 'PASS').length, FAIL: results.filter(r => r.status === 'FAIL').length,
    HARNESS_ERROR: results.filter(r => r.status === 'HARNESS_ERROR').length, TOTAL: results.length,
    ORIGINAL_PASS: results.slice(0, ORIGINAL_TEST_COUNT).filter(r => r.status === 'PASS').length, ORIGINAL_TOTAL: ORIGINAL_TEST_COUNT,
    EXTENDED_PASS: results.slice(ORIGINAL_TEST_COUNT).filter(r => r.status === 'PASS').length, EXTENDED_TOTAL: results.length - ORIGINAL_TEST_COUNT,
    BASELINE_PASS: results.slice(0, BASELINE_TEST_COUNT).filter(r => r.status === 'PASS').length, BASELINE_TOTAL: BASELINE_TEST_COUNT,
    ENCRYPTION_PASS: results.slice(BASELINE_TEST_COUNT).filter(r => r.status === 'PASS').length, ENCRYPTION_TOTAL: results.length - BASELINE_TEST_COUNT,
    SOURCE_CHANGED_DURING_RUN: changed };
  console.log('\nSUMMARY ' + JSON.stringify(summary));
  for (const file of ['runtime-access.js', 'auth.js', 'ipc.js', 'preload.js']) console.log('SOURCE ' + file + ' sha256=' + createHash('sha256').update(sources[file]).digest('hex'));
  console.log('FAILURES ' + JSON.stringify(results.filter(r => r.status !== 'PASS'), null, 2));
  console.log('Local stub tests only; no live Supabase/payment, no GUI, no credential/.env reads, no SQL debit correctness claim.');
  process.exitCode = summary.FAIL || summary.HARNESS_ERROR || changed.length ? 1 : 0;
})().catch(error => { console.error('HARNESS_FATAL', error); process.exitCode = 2; });
