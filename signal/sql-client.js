'use strict';
const { Worker } = require('node:worker_threads');
const path = require('node:path');

// The Signal SQL worker already implements init/close/removeDB/sqlCall.
// Keep one private worker per profile; no main-profile fallback or shared DB handle.
class ProfileSqlClient {
  constructor({ workerPath = path.join(__dirname, 'bundles/workers/sql.js'), workerFactory = file => new Worker(file), timeout = 30000 } = {}) {
    this.worker = workerFactory(workerPath);
    this.timeout = timeout;
    this.sequence = 0;
    this.pending = new Map();
    this.state = 'new';
    this.paused = false;
    this.waitingWrites = [];
    this.exited = new Promise(resolve => this.worker.once('exit', resolve));
    this.worker.on('message', value => {
      if (value.type === 'log') return;
      if (value.type === 'walCheckpointNeeded') {
        if (this.state === 'ready') this.request({ type: 'walCheckpoint', reason: value.reason }).catch(() => {});
        return;
      }
      const job = this.pending.get(value.seq);
      if (!job) return;
      this.pending.delete(value.seq);
      clearTimeout(job.timer);
      if (value.error) job.reject(new Error(value.error.message || 'Signal SQL operation failed'));
      else job.resolve(value.response);
    });
    this.worker.on('error', () => this.fail(new Error('Signal SQL worker failed')));
    this.worker.on('exit', () => {
      if (this.state !== 'closing' && this.state !== 'closed') this.fail(new Error('Signal SQL worker exited'));
      else this.failPending(new Error('Signal SQL client closed'));
    });
  }
  failPending(error) {
    for (const job of this.pending.values()) { clearTimeout(job.timer); job.reject(error); }
    this.pending.clear();
    for (const job of this.waitingWrites) job.reject(error);
    this.waitingWrites = [];
  }
  fail(error) { this.state = 'failed'; this.failPending(error); this.worker.terminate().catch(() => {}); }
  request(request, timeout = this.timeout) {
    if (['failed', 'closed'].includes(this.state)) return Promise.reject(new Error('Signal SQL client unavailable'));
    return new Promise((resolve, reject) => {
      const seq = ++this.sequence;
      const timer = setTimeout(() => this.fail(new Error('Signal SQL request timed out')), timeout);
      this.pending.set(seq, { resolve, reject, timer });
      try { this.worker.postMessage({ seq, request }); }
      catch { this.fail(new Error('Signal SQL worker unavailable')); }
    });
  }
  async initialize(options) {
    if (this.initialization) return this.initialization;
    if (this.state !== 'new') throw new Error('Signal SQL client cannot initialize');
    this.state = 'initializing';
    this.initialization = this.request({ type: 'init', options, isPrimary: true }, Math.max(this.timeout, 120000)).then(() => {
      if (this.state !== 'initializing') throw new Error('Signal profile initialization cancelled');
      this.state = 'ready';
    });
    return this.initialization;
  }
  async call(type, method, data, encoding) {
    if (this.initialization) await this.initialization;
    if (this.state !== 'ready') throw new Error('Signal SQL client is not ready');
    if (typeof method !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,127}$/.test(method)) throw new Error('Invalid SQL method');
    if (type === 'sqlCall:write' && this.paused) await new Promise((resolve, reject) => this.waitingWrites.push({ resolve, reject }));
    if (this.state !== 'ready') throw new Error('Signal profile closed');
    const value = await this.request({ type, method, encoding, ...(encoding === 'js' ? { args: data } : { data }) });
    return value.result;
  }
  sqlRead(method, ...args) { return this.call('sqlCall:read', method, args, 'js'); }
  sqlWrite(method, ...args) { return this.call('sqlCall:write', method, args, 'js'); }
  sqlReadSerialized(method, data) { return this.call('sqlCall:read', method, data, 'serialized'); }
  sqlWriteSerialized(method, data) { return this.call('sqlCall:write', method, data, 'serialized'); }
  pauseWriteAccess() { if (this.paused) throw new Error('Already paused'); this.paused = true; }
  resumeWriteAccess() {
    this.paused = false;
    for (const job of this.waitingWrites.splice(0)) job.resolve();
  }
  async removeDB() {
    if (this.state !== 'ready') throw new Error('Signal SQL client is not ready');
    await this.request({ type: 'removeDB' });
    await this.close();
  }
  close() {
    if (this.closing) return this.closing;
    this.closing = (async () => {
      if (['new', 'initializing', 'failed'].includes(this.state)) {
        this.state = 'closed';
        this.failPending(new Error('Signal profile closed'));
        await this.worker.terminate();
        return;
      }
      this.state = 'closing';
      this.failPending(new Error('Signal profile closed'));
      try { await this.request({ type: 'close' }, 5000); }
      catch { /* Worker may already have exited. */ }
      finally { this.state = 'closed'; await this.worker.terminate(); }
    })();
    return this.closing;
  }
}
module.exports = { ProfileSqlClient };
