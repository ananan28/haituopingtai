'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { profileForAccount } = require('./profiles');
const { ProfileSqlClient } = require('./sql-client');
const SIGNAL_VERSION = require('./package.json').version;

async function profileKey(directory, safeStorage) {
  if (!safeStorage?.isEncryptionAvailable()) throw new Error('System key encryption is unavailable');
  const file = path.join(directory, 'sql-key.json');
  async function read() {
    const data = await fs.readFile(file, 'utf8');
    if (data.length > 4096) throw new Error('Invalid Signal key file');
    const record = JSON.parse(data);
    if (record.version !== 1 || typeof record.ciphertext !== 'string') throw new Error('Invalid Signal key file');
    const key = safeStorage.decryptString(Buffer.from(record.ciphertext, 'base64'));
    if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('Invalid Signal SQL key');
    return key;
  }
  try { return await read(); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  try { await fs.access(path.join(directory, 'sql/db.sqlite')); throw new Error('Signal database exists without its key; refusing to replace it'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const key = randomBytes(32).toString('hex');
  const envelope = JSON.stringify({ version: 1, ciphertext: safeStorage.encryptString(key).toString('base64') });
  const temporary = file + '.' + randomBytes(12).toString('hex') + '.tmp';
  await fs.writeFile(temporary, envelope, { flag: 'wx', mode: 0o600 });
  try { await fs.link(temporary, file); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  finally { await fs.unlink(temporary).catch(() => {}); }
  return read();
}

class ProfileRuntime {
  constructor({ directory, safeStorage, clientFactory = () => new ProfileSqlClient(), keyFor = profileKey }) {
    this.directory = directory; this.safeStorage = safeStorage;
    this.clientFactory = clientFactory; this.keyFor = keyFor;
    this.entries = new Map(); this.closures = new Map(); this.generation = 0;
  }
  async open(scope, accountId) {
    const profile = profileForAccount(accountId, scope);
    const generation = this.generation;
    if (this.closures.has(profile)) await this.closures.get(profile);
    if (generation !== this.generation) throw new Error('Signal identity changed');
    const current = this.entries.get(profile);
    if (current) return current.ready;
    const entry = { profile, scope, accountId, client: null, generation: this.generation };
    this.entries.set(profile, entry);
    entry.ready = (async () => {
      try {
        const configDir = path.join(this.directory, profile);
        const key = await this.keyFor(configDir, this.safeStorage);
        if (this.entries.get(profile) !== entry || entry.generation !== this.generation) throw new Error('Signal identity changed');
        entry.client = this.clientFactory();
        await entry.client.initialize({ appVersion: SIGNAL_VERSION, configDir, key });
        if (this.entries.get(profile) !== entry || entry.generation !== this.generation) throw new Error('Signal identity changed');
        return entry;
      } catch (error) {
        if (entry.client) await entry.client.close().catch(() => {});
        if (this.entries.get(profile) === entry) this.entries.delete(profile);
        throw error;
      }
    })();
    return entry.ready;
  }
  client(profile) {
    const entry = this.entries.get(profile);
    if (!entry?.client || entry.generation !== this.generation || entry.client.state !== 'ready') throw new Error('Unknown or unavailable Signal profile');
    return entry.client;
  }
  close(profile) {
    if (this.closures.has(profile)) return this.closures.get(profile);
    const entry = this.entries.get(profile);
    if (!entry) return Promise.resolve();
    this.entries.delete(profile);
    const closing = (async () => {
      if (entry.client) await entry.client.close();
      try { await entry.ready; } catch { /* Cancelled initialization closes its worker. */ }
      if (entry.client) await entry.client.close();
    })();
    this.closures.set(profile, closing);
    closing.finally(() => { if (this.closures.get(profile) === closing) this.closures.delete(profile); }).catch(() => {});
    return closing;
  }
  async closeAll() {
    this.generation++;
    const entries = [...this.entries.keys()];
    await Promise.all([...this.closures.values(), ...entries.map(profile => this.close(profile))]);
  }
}
module.exports = { ProfileRuntime, profileKey };
