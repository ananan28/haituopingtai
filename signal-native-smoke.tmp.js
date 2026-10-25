'use strict';
// Signal 原生 ABI 冒烟：在平台 Electron 44.1.0（ELECTRON_RUN_AS_NODE=1）下，
// 尝试加载旧海拓源树里的 libsignal-client / sqlcipher / ringrtc 原生 .node，
// 验证 ABI(modules=149) 匹配、可被平台直接 require。
// 只读、无网络、无 Supabase、无 GUI、不写任何文件。
const path = require('node:path');
const fs = require('node:fs');

const OLD = process.env.HAITUO_SIGNAL_PROBE || 'C:/Users/AQ28n/AppData/Local/Temp/haituo-signal-probe';
const root = path.join(OLD, 'src', 'app', 'node_modules');

if (!fs.existsSync(root)) {
  console.log('SKIP 旧海拓源树不存在：' + root + '（用 HAITUO_SIGNAL_PROBE 指定路径后重跑）');
  process.exit(0);
}

const results = [];
function report(name, ok, detail) {
  results.push({ name, ok: Boolean(ok), detail });
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? '  ' + JSON.stringify(detail) : ''));
}

console.log('electron abi modules=' + process.versions.modules + ' node=' + process.versions.node + ' napi=' + process.versions.napi);

const targets = [
  ['libsignal-client', path.join(root, '@signalapp', 'libsignal-client', 'prebuilds', 'win32-x64', '@signalapp+libsignal-client.node')],
  ['sqlcipher', path.join(root, '@signalapp', 'sqlcipher', 'prebuilds', 'win32-x64', '@signalapp+sqlcipher.node')],
  ['ringrtc', path.join(root, '@signalapp', 'ringrtc', 'build', 'win32', 'libringrtc-x64.node')]
];

for (const [name, file] of targets) {
  if (!fs.existsSync(file)) { report(name + ' present', false, 'missing ' + file); continue; }
  report(name + ' present', true, fs.statSync(file).size + ' bytes');
  try {
    const mod = require(file);
    report(name + ' load', true, typeof mod === 'object' ? Object.keys(mod).slice(0, 5) : typeof mod);
  } catch (e) {
    report(name + ' load', false, String((e && e.message) || e).slice(0, 300));
  }
}

// 摘要
const pass = results.filter((r) => r.ok).length;
console.log('RESULT ' + pass + '/' + results.length);
process.exit(results.every((r) => r.ok) ? 0 : 1);
