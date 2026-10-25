'use strict';
/**
 * signal/index.js — Signal 渠道后端挂载模块（源码级融合，同进程）。
 *
 * 把旧海拓（Signal Desktop 分支）主进程 bundle 以"模块"形式挂进平台主进程：
 *  - 不 spawn 独立进程、不做子窗口/原生窗口跟随；
 *  - 每账号 = 同一进程内一个 Signal 会话（WebContentsView + 独立 persist 分区，见 P3）。
 *
 * 本模块只负责"让 bundle 能 require 且启动不崩"（P0）：
 *  1. @signalapp/@indutny 原生依赖解析到 signal/native-modules；
 *  2. bundle 内 app.getAppPath() 指向 signal/（config/build/_locales 按旧布局解析）；
 *  3. dev(isPackaged=false) 下 locale 读 messages.json，已随源码从 keys.json+values.json 生成。
 */
const path = require('node:path');
const fs = require('node:fs');
const Module = require('node:module');

const SIGNAL_ROOT = __dirname;
const NATIVE = path.join(SIGNAL_ROOT, 'native-modules');

let origResolve = null;
function installResolution() {
  if (origResolve) return;
  origResolve = Module._resolveFilename;
  Module._resolveFilename = function (request, parent, isMain, options) {
    if (typeof request === 'string' && (request.startsWith('@signalapp/') || request.startsWith('@indutny/'))) {
      const candidate = path.join(NATIVE, request);
      const hit = [candidate, candidate + '.js', path.join(candidate, 'package.json')].some((p) => fs.existsSync(p));
      if (hit) return origResolve.call(this, candidate, parent, isMain, options);
    }
    return origResolve.call(this, request, parent, isMain, options);
  };
}

let loaded = false;

function mount(opts = {}) {
  if (loaded) return false;
  installResolution();
  const { app } = require('electron');
  // bundle 内 config/构建脚本用 app.getAppPath() 定位 config/build/_locales
  try { app.getAppPath = () => SIGNAL_ROOT; } catch (_) { /* 只读则忽略，交由调用方保证路径 */ }

  const profile = typeof opts.profile === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(opts.profile) ? opts.profile : 'signal-main';
  if (!process.argv.some((a) => a.startsWith('--caisheng-profile='))) {
    process.argv.push('--caisheng-profile=' + profile);
  }

  require(path.join(SIGNAL_ROOT, 'bundles', 'main.js'));
  loaded = true;
  return true;
}

function isMounted() {
  return loaded;
}

module.exports = { mount, isMounted, ROOT: SIGNAL_ROOT, NATIVE };
