'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
function fixture() {
  const calls = [], module = { exports: {} };
  const auth = { clearLocalSession: async () => calls.push('clear'),
    getSession: async () => { calls.push('restore'); return { ok: true, user: { id: 'verified-owner', role: 'owner', email: 'owner@test.invalid' } }; },
    signIn: async () => { calls.push('signin'); return { ok: true, user: { id: 'verified-owner', role: 'owner', email: 'owner@test.invalid' } }; },
    signOut: async () => { calls.push('signout'); return { ok: true }; }, resumeRefresh() {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../runtime-access.js'), 'utf8'), { module, exports: module.exports, __dirname: path.join(__dirname, '..'),
    require: name => name === './auth' ? auth : require(name) });
  return { access: module.exports, calls, auth };
}

test('local channels receive a frozen separate identity with no server authority', async () => {
  const f = fixture();
  const result = await f.access.enterLocal();
  assert.equal(result.ok, true); assert.equal(result.user.local, true); assert.equal(result.user.demo, false);
  assert.equal(result.user.role, 'user'); assert.equal(result.user.scope, 'local:workspace');
  assert.ok(Object.isFrozen(result.user)); assert.ok(Object.isFrozen(result.user.accountIds));
  assert.equal(result.user.accountIds.length, 5);
  for (const permission of ['staff:manage', 'quota:allocate', 'role:manage', 'recharge', 'providers', 'order:view', 'translate']) assert.equal(f.access.can(permission), false);
  assert.equal(f.access.can('account'), true);
  for (const permission of ['account', 'staff:manage', 'providers', 'role:manage']) assert.equal((await f.access.authorize(permission)).ok, false);
  assert.deepEqual(f.calls, ['clear']);
});

test('local restore/signout never fetch or revoke a remote session', async () => {
  const f = fixture(); await f.access.enterLocal();
  assert.equal((await f.access.restore()).user.local, true);
  f.access.invalidate(); assert.equal(f.access.current().local, true);
  assert.equal((await f.access.signOut()).ok, true); assert.equal(f.access.current(), null);
  assert.deepEqual(f.calls, ['clear']);
});

test('verified server users must sign out before switching to local identity', async () => {
  const f = fixture();
  assert.equal((await f.access.authenticate('signIn', 'owner@test.invalid', 'password')).ok, true);
  assert.equal((await f.access.enterLocal()).ok, false);
  assert.equal(f.access.current().id, 'verified-owner');
});

test('local identities cannot authenticate as a server role without explicitly signing out', async () => {
  const f = fixture(); await f.access.enterLocal();
  assert.equal((await f.access.authenticate('signIn', 'owner@test.invalid', 'password')).ok, false);
  assert.deepEqual(f.calls, ['clear']);
  await f.access.signOut(); await f.access.authenticate('signIn', 'owner@test.invalid', 'password');
  assert.equal(f.access.current().local, undefined); assert.equal(f.access.current().role, 'owner');
});

test('offline demo and networked local workspace never share account IDs or storage scope', async () => {
  const f = fixture(); const demo = (await f.access.enterDemo('owner')).user;
  const local = (await f.access.enterLocal()).user;
  assert.notEqual(demo.scope, local.scope);
  assert.equal(demo.accountIds.some(id => local.accountIds.includes(id)), false);
  const again = (await f.access.enterDemo('staff')).user;
  assert.equal(again.demo, true); assert.equal(again.local, undefined);
});
