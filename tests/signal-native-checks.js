'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { ProfileRuntime } = require('../signal/profile-runtime');

async function nativeChecks(safeStorage) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'haituo-signal-p4-'));
  const runtime = new ProfileRuntime({ directory, safeStorage });
  try {
    const [a, b] = await Promise.all([runtime.open('server:merchant-one', 'signal:account'), runtime.open('server:merchant-two', 'signal:account')]);
    assert.notEqual(a.profile, b.profile);
    assert.notEqual(a.client.worker.threadId, b.client.worker.threadId);
    await Promise.all([
      a.client.sqlWrite('createOrUpdateItem', { id: 'haituo-test-identity', value: 'profile-one-private' }),
      b.client.sqlWrite('createOrUpdateItem', { id: 'haituo-test-identity', value: 'profile-two-private' })
    ]);
    assert.equal((await a.client.sqlRead('getItemById', 'haituo-test-identity')).value, 'profile-one-private');
    assert.equal((await b.client.sqlRead('getItemById', 'haituo-test-identity')).value, 'profile-two-private');
    console.log('PASS native Signal: two SQLCipher workers with the same item ID remain isolated.');
    const db = await fs.readFile(path.join(directory, a.profile, 'sql/db.sqlite'));
    assert.notEqual(db.subarray(0, 16).toString(), 'SQLite format 3\0');
    assert.equal(db.includes(Buffer.from('profile-one-private')), false);
    console.log('PASS native Signal: database content is encrypted.');
    const firstWorker = a.client.worker;
    await runtime.close(a.profile);
    assert.equal(firstWorker.threadId, -1);
    assert.throws(() => runtime.client(a.profile));
    const reopened = await runtime.open('server:merchant-one', 'signal:account');
    assert.equal((await reopened.client.sqlRead('getItemById', 'haituo-test-identity')).value, 'profile-one-private');
    assert.equal((await b.client.sqlRead('getItemById', 'haituo-test-identity')).value, 'profile-two-private');
    console.log('PASS native Signal: account close/reopen preserves its key and data without closing another account.');
    await runtime.closeAll();
    assert.equal(runtime.entries.size, 0);
    console.log('PASS native Signal: identity shutdown terminates all profile workers.');
  } finally {
    await runtime.closeAll();
    await fs.rm(directory, { recursive: true, force: true });
  }
}
module.exports = { nativeChecks };
