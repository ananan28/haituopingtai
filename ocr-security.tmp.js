'use strict';

// Local-only tests. OCR runs in a VM with an exact dependency allowlist;
// only this test and ocr.js are read from disk. No real OCR or other I/O.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { deflateSync } = require('node:zlib');
const source = readFileSync(path.join(__dirname, 'ocr.js'), 'utf8');
const PREFIX = 'data:image/png;base64,';
const MAX_URL = 24 * 1024 * 1024;
const MAX_RESULT = 1024 * 1024;
const MAX_TEXT = 512 * 1024;
const ROOT = 'C:\\fake workspace';
const TEMP = 'C:\\fake temp\\OCR space';

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const bytes = Buffer.alloc(data.length + 12);
  bytes.writeUInt32BE(data.length, 0);
  bytes.write(type, 4, 'ascii');
  data.copy(bytes, 8);
  bytes.writeUInt32BE(crc32(bytes.subarray(4, -4)), bytes.length - 4);
  return bytes;
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(1, 0);
ihdr.writeUInt32BE(1, 4);
ihdr[8] = 8;
ihdr[9] = 6;
// A complete, CRC-correct, non-annotated 1x1 RGBA PNG.
const original = Buffer.concat([
  Buffer.from('89504e470d0a1a0a', 'hex'),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(Buffer.from([0, 255, 0, 0, 255]))),
  chunk('IEND', Buffer.alloc(0))
]);
const url = (bytes) => PREFIX + bytes.toString('base64');
const valid = url(original);
function headerFixture({ width = 1, height = 1, depth = 8, color = 6, compression = 0, filter = 0, interlace = 0 } = {}) {
  // Dimension/format boundary fixtures exercise header validation, not decoding.
  const bytes = Buffer.from(original);
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  bytes[24] = depth;
  bytes[25] = color;
  bytes[26] = compression;
  bytes[27] = filter;
  bytes[28] = interlace;
  bytes.writeUInt32BE(crc32(bytes.subarray(12, 29)), 29);
  return url(bytes);
}
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function harness(initial = {}) {
  const state = {
    raw: JSON.stringify({ ok: true, lang: 'en-US', lines: ['Original text', '', '第二行'] }),
    events: [], allocations: [], childCalls: [], images: [], parses: 0,
    ...initial
  };
  const event = (name) => state.events.push(name);
  function fail(name) {
    if (state.fail === name) {
      state.fail = null;
      throw new Error(`${name} failed`);
    }
  }
  let directory;
  const fakeFs = Object.freeze({
    async mkdtemp(prefix) {
      event('mkdtemp');
      assert.equal(prefix, path.win32.join(TEMP, 'haituo-ocr-'));
      if (state.mkdirGate) await state.mkdirGate.promise;
      fail('mkdtemp');
      directory = prefix + 'fake-' + state.events.filter((e) => e === 'mkdtemp').length;
      return directory;
    },
    async writeFile(filename, bytes) {
      event('writeFile');
      assert.equal(filename, path.win32.join(directory, 'shot.png'));
      assert.ok(Buffer.isBuffer(bytes));
      fail('writeFile');
      state.images.push(Buffer.from(bytes));
    },
    async open(filename, flags) {
      event('open');
      assert.equal(filename, path.win32.join(directory, 'result.json'));
      assert.equal(flags, 'r');
      if (state.missing) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      fail('open');
      const contents = Buffer.from(state.raw, 'utf8');
      return Object.freeze({
        async read(buffer, offset, length, position) {
          event('read');
          fail('read');
          assert.equal(buffer.length, MAX_RESULT + 1);
          assert.equal(offset, position);
          assert.equal(length, buffer.length - offset);
          const bytesRead = Math.min(length, Math.max(0, contents.length - position), state.chunkSize || Infinity);
          contents.copy(buffer, offset, position, position + bytesRead);
          state.readBytes = (state.readBytes || 0) + bytesRead;
          return { bytesRead };
        },
        async close() { event('close'); fail('close'); }
      });
    },
    async rm(filename, options) {
      event('rm');
      assert.equal(typeof filename, 'string');
      assert.equal(options.recursive, true);
      assert.equal(options.force, true);
      if (state.cleanupGate) await state.cleanupGate.promise;
      fail('rm');
      if (state.rmFailAlways) throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' });
    }
  });
  const dependencies = Object.freeze({
    'fs/promises': fakeFs,
    os: Object.freeze({ tmpdir: () => TEMP }),
    path: Object.freeze({ join: path.win32.join }),
    child_process: Object.freeze({
      execFile(executable, args, options, callback) {
        event('execFile');
        state.childCalls.push({ executable, args, options });
        assert.equal(executable, 'powershell.exe');
        assert.deepEqual(Array.from(args), [
          '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
          path.win32.join(ROOT, 'assets', 'ocr.ps1'),
          '-ImagePath', path.win32.join(directory, 'shot.png'),
          '-OutPath', path.win32.join(directory, 'result.json')
        ]);
        assert.equal(options.windowsHide, true);
        assert.equal(options.timeout, 25000);
        assert.equal(options.maxBuffer, 256 * 1024);
        assert.equal(options.shell, undefined);
        fail('execFile');
        const finish = () => callback(state.childError || null, '', state.stderr || '');
        if (state.childGate) state.childGate.promise.then(finish);
        else queueMicrotask(finish);
      }
    })
  });
  const sandbox = {
    module: { exports: {} },
    __dirname: ROOT,
    process: Object.freeze({ platform: state.platform || 'win32' }),
    Buffer: Object.freeze({
      from(value, encoding) {
        state.allocations.push(['from', encoding]);
        fail('decode');
        return Buffer.from(value, encoding);
      },
      alloc(length) {
        state.allocations.push(['alloc', length]);
        fail('alloc');
        return Buffer.alloc(length);
      }
    }),
    JSON: Object.freeze({ parse(raw) { state.parses++; return JSON.parse(raw); } }),
    require(name) {
      assert.ok(Object.hasOwn(dependencies, name), `VM dependency denied: ${name}`);
      return dependencies[name];
    }
  };
  vm.runInNewContext(source, sandbox, {
    filename: 'ocr.js', timeout: 5000,
    contextCodeGeneration: { strings: false, wasm: false }
  });
  return { state, recognize: sandbox.module.exports.recognize };
}

const tests = [];
function test(name, run) { tests.push({ name, run }); }
async function rejectedBeforeAllocation(value) {
  const { state, recognize } = harness();
  const result = await recognize(value);
  assert.equal(result.ok, false);
  assert.equal(typeof result.error, 'string');
  assert.deepEqual(state.events, [], 'invalid input must not touch fs or child_process');
  assert.deepEqual(state.allocations, [], 'invalid input must not allocate/decode buffers');
  assert.equal((await recognize(valid)).ok, true, 'invalid input must release the slot');
}

for (const [name, value] of [
  ['undefined', undefined], ['null', null], ['boolean', true], ['number', 7], ['bigint', 1n],
  ['symbol', Symbol('png')], ['boxed string', new String(valid)], ['array', [valid]],
  ['object with throwing coercion', { toString() { throw new Error('must not coerce'); } }]
]) test(`reject nonstring ${name}`, () => rejectedBeforeAllocation(value));

test('reject oversized URL before allocation', () => rejectedBeforeAllocation(PREFIX + 'A'.repeat(MAX_URL)));
for (const [name, value] of [
  ['empty', ''], ['wrong media type', valid.replace('image/png', 'image/jpeg')],
  ['uppercase header', valid.replace('image/png', 'image/PNG')],
  ['extra header parameter', valid.replace(';base64', ';charset=utf-8;base64')],
  ['missing comma', valid.replace(',', '')], ['leading whitespace', ' ' + valid],
  ['whitespace in payload', valid.slice(0, 30) + '\n' + valid.slice(30)],
  ['trailing newline', valid + '\n'], ['missing padding/quartet', valid.slice(0, -1)],
  ['embedded equals', valid.slice(0, 30) + '=' + valid.slice(31)],
  ['excess padding', valid + '===='], ['URL-safe alphabet', PREFIX + '_'.repeat(44)],
  ['no payload', PREFIX], ['short header', url(original.subarray(0, 32))]
]) test(`reject malformed data URL: ${name}`, () => rejectedBeforeAllocation(value));

for (const bytesLength of [34, 35]) {
  test(`reject noncanonical pad bits (${bytesLength % 3} remainder)`, async () => {
    const canonical = url(original.subarray(0, bytesLength));
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const index = canonical.indexOf('=') - 1;
    const changed = canonical.slice(0, index) + alphabet[alphabet.indexOf(canonical[index]) + 1] + canonical.slice(index + 1);
    assert.deepEqual(Buffer.from(changed.slice(PREFIX.length), 'base64'), Buffer.from(canonical.slice(PREFIX.length), 'base64'));
    await rejectedBeforeAllocation(changed);
  });
}
for (const [name, mutate] of [
  ['signature', (b) => { b[0] = 0; }],
  ['IHDR length small', (b) => b.writeUInt32BE(12, 8)],
  ['IHDR length huge', (b) => b.writeUInt32BE(0xffffffff, 8)],
  ['IHDR not first', (b) => b.write('IDAT', 12)]
]) test(`reject bad PNG ${name}`, async () => {
  const bytes = Buffer.from(original);
  mutate(bytes);
  await rejectedBeforeAllocation(url(bytes));
});
for (const [name, values] of [
  ['zero width', { width: 0 }], ['zero height', { height: 0 }],
  ['width limit', { width: 16385 }], ['height limit', { height: 16385 }],
  ['unsigned width', { width: 0xffffffff }], ['signed-bit height', { height: 0x80000000 }],
  ['pixel limit', { width: 8192, height: 4097 }],
  ['huge pixel count', { width: 16384, height: 16384 }],
  ['zero depth', { depth: 0 }], ['unsupported color', { color: 5 }],
  ['invalid RGB depth', { color: 2, depth: 4 }], ['invalid palette depth', { color: 3, depth: 16 }],
  ['compression', { compression: 1 }], ['filter', { filter: 1 }], ['interlace', { interlace: 2 }]
]) test(`reject PNG header ${name}`, () => rejectedBeforeAllocation(headerFixture(values)));

test('valid complete PNG: preserve original bytes, fixed command and return shape', async () => {
  const { state, recognize } = harness({ chunkSize: 7 });
  const result = await recognize(valid);
  assert.equal(result.ok, true);
  assert.equal(result.lang, 'en-US');
  assert.deepEqual(Array.from(result.lines), ['Original text', '第二行']);
  assert.deepEqual(state.images, [original]);
  assert.equal(state.childCalls.length, 1);
  assert.equal(state.events.at(-2), 'close');
  assert.equal(state.events.at(-1), 'rm');
  assert.equal((await recognize(valid)).ok, true);
});
for (const values of [
  { width: 16384, height: 2048 }, { width: 2048, height: 16384 }, { width: 8192, height: 4096 }
]) test(`accept header dimension/pixel boundary ${values.width}x${values.height}`, async () => {
  assert.equal((await harness().recognize(headerFixture(values))).ok, true);
});
for (const [color, depths] of [[0, [1, 2, 4, 8, 16]], [2, [8, 16]], [3, [1, 2, 4, 8]], [4, [8, 16]], [6, [8, 16]]]) {
  for (const depth of depths) test(`accept standard PNG header color=${color} depth=${depth}`, async () => {
    assert.equal((await harness().recognize(headerFixture({ color, depth, interlace: 1 }))).ok, true);
  });
}

test('accept largest canonical encoded URL within 24 MiB and reject next quartet', async () => {
  const payloadLength = Math.floor((MAX_URL - PREFIX.length) / 4) * 4;
  const bytes = Buffer.alloc(payloadLength / 4 * 3);
  original.copy(bytes);
  const within = url(bytes);
  assert.ok(within.length <= MAX_URL);
  assert.ok(within.length + 4 > MAX_URL);
  const h = harness();
  assert.equal((await h.recognize(within)).ok, true);
  assert.deepEqual(h.state.images[0], bytes);
  await rejectedBeforeAllocation(within + 'AAAA');
});

test('single slot is acquired before first await; concurrent callers fail fast', async () => {
  const gate = deferred();
  const { state, recognize } = harness({ mkdirGate: gate });
  const first = recognize(valid);
  assert.deepEqual(state.events, ['mkdtemp']);
  const busy = await Promise.all(Array.from({ length: 20 }, () => recognize(valid)));
  assert.ok(busy.every((r) => r.ok === false && /正忙/.test(r.error)));
  assert.deepEqual(state.events, ['mkdtemp']);
  assert.deepEqual(state.allocations, []);
  gate.resolve();
  assert.equal((await first).ok, true);
  assert.equal((await recognize(valid)).ok, true);
});

test('slot remains busy while child is running', async () => {
  const gate = deferred();
  const { state, recognize } = harness({ childGate: gate });
  const first = recognize(valid);
  for (let i = 0; i < 10 && !state.childCalls.length; i++) await Promise.resolve();
  assert.equal(state.childCalls.length, 1);
  assert.match((await recognize(valid)).error, /正忙/);
  assert.equal(state.childCalls.length, 1);
  gate.resolve();
  assert.equal((await first).ok, true);
  assert.equal((await recognize(valid)).ok, true);
});

test('slot stays held until cleanup settles', async () => {
  const gate = deferred();
  const { state, recognize } = harness({ cleanupGate: gate });
  const first = recognize(valid);
  for (let i = 0; i < 30 && !state.events.includes('rm'); i++) await Promise.resolve();
  assert.ok(state.events.includes('rm'));
  assert.match((await recognize(valid)).error, /正忙/);
  gate.resolve();
  assert.equal((await first).ok, true);
  assert.equal((await recognize(valid)).ok, true);
});

for (const phase of ['mkdtemp', 'decode', 'writeFile', 'execFile', 'open', 'alloc', 'read', 'close']) {
  test(`${phase} failure returns error, cleans up and releases slot`, async () => {
    const { state, recognize } = harness({ fail: phase });
    const result = await recognize(valid);
    assert.equal(result.ok, false);
    assert.equal(result.error, `${phase} failed`);
    assert.equal(state.events.filter((e) => e === 'rm').length, phase === 'mkdtemp' ? 0 : 1);
    if (['alloc', 'read', 'close'].includes(phase)) assert.equal(state.events.filter((e) => e === 'close').length, 1);
    if (['mkdtemp', 'decode', 'writeFile'].includes(phase)) assert.equal(state.childCalls.length, 0);
    assert.equal((await recognize(valid)).ok, true);
  });
}
for (const [name, childError, stderr] of [
  ['timeout', Object.assign(new Error('killed'), { killed: true }), ''],
  ['process exit', new Error('exit 1'), '  OCR process failed  '],
  ['spawn error', new Error('spawn ENOENT'), ''],
  ['maxBuffer', Object.assign(new Error('stdout maxBuffer length exceeded'), { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' }), ''],
  ['bounded stderr', new Error('exit 1'), 'x'.repeat(MAX_RESULT)]
]) test(`${name} cleans up and releases slot`, async () => {
  const { state, recognize } = harness({ childError, stderr });
  const result = await recognize(valid);
  assert.equal(result.ok, false);
  assert.ok(result.error.length <= 4096);
  assert.equal(result.error, name === 'timeout' ? 'OCR 超时' : (stderr || childError.message).slice(0, 4096).trim());
  assert.deepEqual(state.events, ['mkdtemp', 'writeFile', 'execFile', 'rm']);
  state.childError = null;
  state.stderr = '';
  assert.equal((await recognize(valid)).ok, true);
});

test('cleanup failure does not mask success or retain slot', async () => {
  const { recognize } = harness({ fail: 'rm' });
  assert.equal((await recognize(valid)).ok, true);
  assert.equal((await recognize(valid)).ok, true);
});
test('cleanup failure does not mask child error or retain slot', async () => {
  const { state, recognize } = harness({ fail: 'rm', childError: new Error('child failed') });
  assert.equal((await recognize(valid)).error, 'child failed');
  state.childError = null;
  assert.equal((await recognize(valid)).ok, true);
});

for (const [name, raw] of [
  ['empty file', ''], ['malformed JSON', '{'], ['null', 'null'], ['JSON array', '[]'],
  ['JSON string', '"text"'], ['OCR-reported failure', '{"ok":false,"error":"unavailable"}'],
  ['oversized text', JSON.stringify({ ok: true, lines: ['x'.repeat(MAX_TEXT + 1)] })],
  ['aggregate text limit', JSON.stringify({ ok: true, lines: ['x'.repeat(MAX_TEXT), 'x'] })],
  ['too many lines', JSON.stringify({ ok: true, lines: Array(10001).fill('x') })],
  ['object line', JSON.stringify({ ok: true, lines: [{ text: 'no coercion' }] })],
  ['nested array line', JSON.stringify({ ok: true, lines: [['no coercion']] })],
  ['oversized language', JSON.stringify({ ok: true, lang: 'x'.repeat(129) })],
  ['object language', JSON.stringify({ ok: true, lang: {} })]
]) test(`reject result ${name}, close file, cleanup, reuse slot`, async () => {
  const { state, recognize } = harness({ raw });
  assert.equal((await recognize(valid)).ok, false);
  assert.equal(state.events.at(-2), 'close');
  assert.equal(state.events.at(-1), 'rm');
  state.raw = '{"ok":true,"lines":[]}';
  assert.equal((await recognize(valid)).ok, true);
});

test('result bytes are capped before parsing even with partial reads', async () => {
  const { state, recognize } = harness({ raw: ' '.repeat(MAX_RESULT * 2), chunkSize: 12345 });
  const result = await recognize(valid);
  assert.equal(result.ok, false);
  assert.match(result.error, /大小限制/);
  assert.equal(state.readBytes, MAX_RESULT + 1);
  assert.equal(state.parses, 0);
  assert.equal(state.events.at(-2), 'close');
  assert.equal(state.events.at(-1), 'rm');
  state.raw = '{"ok":true}';
  assert.equal((await recognize(valid)).ok, true);
});
test('exact result byte cap is accepted', async () => {
  const raw = '{"ok":true}';
  assert.equal((await harness({ raw: raw + ' '.repeat(MAX_RESULT - raw.length) }).recognize(valid)).ok, true);
});
test('exact text, language and line count caps are accepted', async () => {
  const raw = JSON.stringify({ ok: true, lang: 'x'.repeat(128), lines: ['x'.repeat(MAX_TEXT - 9999), ...Array(9999).fill('x')] });
  const result = await harness({ raw }).recognize(valid);
  assert.equal(result.ok, true);
  assert.equal(result.lines.length, 10000);
  assert.equal(result.lines.reduce((sum, line) => sum + line.length, 0), MAX_TEXT);
});
test('OCR-reported error text is bounded', async () => {
  const result = await harness({ raw: JSON.stringify({ ok: false, error: 'x'.repeat(100000) }) }).recognize(valid);
  assert.equal(result.ok, false);
  assert.equal(result.error.length, 4096);
});
test('missing output is handled and releases slot', async () => {
  const { state, recognize } = harness({ missing: true });
  assert.equal((await recognize(valid)).error, 'OCR 进程未返回结果');
  assert.equal(state.events.at(-1), 'rm');
  state.missing = false;
  assert.equal((await recognize(valid)).ok, true);
});
test('unsupported platform performs no allocation or I/O', async () => {
  const { state, recognize } = harness({ platform: 'linux' });
  assert.equal((await recognize(valid)).ok, false);
  assert.deepEqual(state.events, []);
  assert.deepEqual(state.allocations, []);
});

const signature = Buffer.from('89504e470d0a1a0a', 'hex');
for (const [name, png] of [
  ['signature + IHDR only', Buffer.concat([signature, chunk('IHDR', ihdr)])],
  ['no IDAT chunk', Buffer.concat([signature, chunk('IHDR', ihdr), chunk('IEND', Buffer.alloc(0))])]
]) test(`reject PNG missing IDAT/IEND: ${name}`, async () => {
  const { state, recognize } = harness();
  const result = await recognize(url(png));
  assert.equal(result.ok, false);
  assert.match(result.error, /数据块不完整/);
  assert.equal(state.childCalls.length, 0, 'incomplete PNG must not reach the OCR subprocess');
  assert.equal((await recognize(valid)).ok, true, 'incomplete PNG must release the slot');
});

test('reject PNG IHDR CRC mismatch before allocation', async () => {
  const bad = Buffer.from(original);
  bad.writeUInt32BE((crc32(bad.subarray(12, 29)) ^ 1) >>> 0, 29);
  await rejectedBeforeAllocation(url(bad));
});

test('persistent cleanup failure reports, releases slot, and retries next run', async () => {
  const h = harness({ rmFailAlways: true });
  const first = await h.recognize(valid);
  assert.equal(first.ok, true);
  assert.equal(first.cleanupFailed, true);
  assert.equal(h.state.events.filter((e) => e === 'rm').length, 3, 'bounded retry attempts per run');
  h.state.rmFailAlways = false;
  const second = await h.recognize(valid);
  assert.equal(second.ok, true);
  assert.equal(second.cleanupFailed, undefined);
  assert.equal(h.state.events.filter((e) => e === 'rm').length, 5, 'sweep retries the leftover dir next run');
});

test('persistent cleanup failure on error path still reports and releases slot', async () => {
  const h = harness({ rmFailAlways: true, childError: new Error('child failed') });
  const first = await h.recognize(valid);
  assert.equal(first.ok, false);
  assert.equal(first.error, 'child failed');
  assert.equal(first.cleanupFailed, true);
  h.state.rmFailAlways = false; h.state.childError = null;
  assert.equal((await h.recognize(valid)).ok, true);
});

(async () => {
  let passed = 0;
  for (const { name, run } of tests) {
    try {
      await run();
      passed++;
      console.log(`PASS ${name}`);
    } catch (error) {
      console.error(`FAIL ${name}`);
      throw error;
    }
  }
  console.log(`RESULT: ${passed}/${tests.length} local VM security tests passed; no live services or real OCR/filesystem side effects.`);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
