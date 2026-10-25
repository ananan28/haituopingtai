'use strict';
/**
 * signal/index.js — Signal 渠道后端挂载模块（源码级融合，同进程）。
 *
 * 把旧海拓（Signal Desktop 分支）主进程 bundle 以"模块"形式挂进平台主进程：
 *  - 不 spawn 独立进程、不做子窗口/原生窗口跟随；
 *  - 每账号 = 同一进程内一个 Signal 会话（WebContentsView + 独立 persist 分区，见 P3）。
 *
 * 原生依赖（@signalapp/@indutny/node-gyp-build/...）位于 signal/node_modules，
 * 主进程与渲染器 preload 均按 Node 标准解析，无需额外钩子。
 * dev(isPackaged=false) 下 locale 读 messages.json，已随源码从 keys.json+values.json 生成。
 */
const path = require('node:path');

const SIGNAL_ROOT = __dirname;
const NATIVE = path.join(SIGNAL_ROOT, 'node_modules');
const profiles = require('./profiles');

let loaded = false;

function mount(opts = {}) {
  if (loaded) return false;
  const { app } = require('electron');
  // bundle 内 config/构建脚本用 app.getAppPath() 定位 config/build/_locales
  try { app.getAppPath = () => SIGNAL_ROOT; } catch (_) { /* 只读则忽略，交由调用方保证路径 */ }

  const profile = typeof opts.profile === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(opts.profile) ? opts.profile : 'signal-main';
  if (!process.argv.some((a) => a.startsWith('--caisheng-profile='))) {
    process.argv.push('--caisheng-profile=' + profile);
  }

  require(path.join(SIGNAL_ROOT, 'bundles', 'main.js'));
  loaded = true;
  // bundle 内 __profileForSender 通过此钩子按 event.sender 路由 SQL 客户端到对应 profile
  global.__haituoSignalProfileFor = (wc) => profiles.profileForWebContents(wc);
  return true;
}

function isMounted() {
  return loaded;
}

// Signal 渲染器（background.html）在 WebContentsView 中承载所需的 webPreferences
// （与 bundle 主窗口一致：sandbox:false，contextIsolation:true —— preload 用 contextBridge 暴露 startApp）。
function rendererPreferences(profile) {
  return {
    nodeIntegration: false,
    nodeIntegrationInWorker: false,
    webviewTag: true,
    sandbox: false,
    contextIsolation: true,
    spellcheck: true,
    preload: path.join(SIGNAL_ROOT, 'bundles', 'preload', 'wrapper.js'),
    additionalArguments: profile && profile !== 'signal-main' ? ['--caisheng-renderer-profile=' + profile] : []
  };
}

module.exports = { mount, isMounted, rendererPreferences, ROOT: SIGNAL_ROOT, NATIVE };
