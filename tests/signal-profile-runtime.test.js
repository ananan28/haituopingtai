'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { ProfileRuntime, profileKey } = require('../signal/profile-runtime');
const { nativeChecks } = require('./signal-native-checks');

const encryptionKey = crypto.randomBytes(32);
const secure = {
  isEncryptionAvailable: () => true,
  encryptString(value) { const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey, iv); return Buffer.concat([iv, cipher.update(value), cipher.final(), cipher.getAuthTag()]); },
  decryptString(bytes) { const cipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey, bytes.subarray(0, 12)); cipher.setAuthTag(bytes.subarray(-16)); return Buffer.concat([cipher.update(bytes.subarray(12, -16)), cipher.final()]).toString(); }
};
async function directory(t) { const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'haituo-profile-test-')); t.after(() => fs.rm(dir, { recursive: true, force: true })); return dir; }
function clients() {
  const created = [];
  return { created, factory: () => {
    const client = { state: 'new', async initialize(options) { this.options = options; this.state = 'ready'; }, async close() { this.state = 'closed'; } };
    created.push(client); return client;
  } };
}

test('SQL keys are encrypted, stable after reload, and distinct for each profile', async t => {
  const dir = await directory(t);
  const a = await profileKey(path.join(dir, 'a'), secure), b = await profileKey(path.join(dir, 'b'), secure);
  assert.notEqual(a, b); assert.equal(await profileKey(path.join(dir, 'a'), secure), a);
  assert.equal((await fs.readFile(path.join(dir, 'a/sql-key.json'), 'utf8')).includes(a), false);
});

test('concurrent first use converges on one encrypted SQL key without overwriting it', async t => {
  const dir = await directory(t);
  const values = await Promise.all(Array.from({ length: 8 }, () => profileKey(dir, secure)));
  assert.equal(new Set(values).size, 1);
});

test('unavailable encryption and missing/corrupt existing keys fail closed', async t => {
  const dir = await directory(t);
  await assert.rejects(profileKey(dir, { isEncryptionAvailable: () => false }));
  await fs.mkdir(path.join(dir, 'sql')); await fs.writeFile(path.join(dir, 'sql/db.sqlite'), 'existing encrypted data');
  await assert.rejects(profileKey(dir, secure), /without its key/);
  await fs.writeFile(path.join(dir, 'sql-key.json'), '{broken');
  await assert.rejects(profileKey(dir, secure));
  assert.equal(await fs.readFile(path.join(dir, 'sql/db.sqlite'), 'utf8'), 'existing encrypted data');
});

test('simultaneous opens share one initialization; different identities get different clients', async () => {
  const f = clients(), runtime = new ProfileRuntime({ directory: '/local', clientFactory: f.factory, keyFor: async () => 'a'.repeat(64) });
  const [a, same, b] = await Promise.all([runtime.open('one', 'account'), runtime.open('one', 'account'), runtime.open('two', 'account')]);
  assert.equal(a, same); assert.notEqual(a.client, b.client); assert.equal(f.created.length, 2);
  assert.equal(a.client.options.appVersion, require('../signal/package.json').version);
  assert.throws(() => runtime.client('unknown')); await runtime.closeAll();
});

test('identity switch while a key is loading prevents worker creation', async () => {
  const f = clients(); let release;
  const runtime = new ProfileRuntime({ directory: '/local', clientFactory: f.factory, keyFor: () => new Promise(resolve => { release = resolve; }) });
  const pending = runtime.open('one', 'account');
  const rejected = assert.rejects(pending, /changed/);
  const closed = runtime.closeAll(); release('a'.repeat(64));
  await Promise.all([rejected, closed]); assert.equal(f.created.length, 0); assert.equal(runtime.entries.size, 0);
});

test('failed initialization closes the worker and can be retried without poisoning the registry', async () => {
  const f = clients(); let fail = true;
  const runtime = new ProfileRuntime({ directory: '/local', keyFor: async () => 'a'.repeat(64), clientFactory: () => {
    const client = f.factory(); const init = client.initialize.bind(client);
    client.initialize = async options => { if (fail) throw new Error('Migration failed'); return init(options); }; return client;
  } });
  await assert.rejects(runtime.open('one', 'account'), /Migration failed/);
  assert.equal(f.created[0].state, 'closed'); assert.equal(runtime.entries.size, 0);
  fail = false; const result = await runtime.open('one', 'account'); assert.equal(result.client.state, 'ready'); await runtime.closeAll();
});

test('real native Signal workers persist separate encrypted databases (local AES test key adapter)', async () => {
  await nativeChecks(secure);
});
