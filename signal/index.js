'use strict';
/**
 * signal/index.js — Signal 渠道后端挂载模块（源码级融合，同进程）。
 *
 * Signal 使用宿主服务 + 独立 SQL worker；不加载旧海拓主进程入口：
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
const { ProfileRuntime } = require('./profile-runtime');
let runtime;
function getRuntime() {
  if (!runtime) {
    const { app, safeStorage } = require('electron');
    runtime = new ProfileRuntime({ directory: path.join(app.getPath('userData'), 'SignalProfiles'), safeStorage });
  }
  return runtime;
}
function prepareProfile(scope, accountId) { return getRuntime().open(scope, accountId); }
function closeProfile(profile) { return runtime ? runtime.close(profile) : Promise.resolve(); }
function closeAllProfiles() { return runtime ? runtime.closeAll() : Promise.resolve(); }

let loaded = false;

function mount() {
  if (loaded) return false;
  require('./service').mount({ electron: require('electron'), runtime: getRuntime(), profiles, access: require('../runtime-access') });
  loaded = true;
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
    preload: path.join(SIGNAL_ROOT, 'preload.js'),
    additionalArguments: profile && profile !== 'signal-main' ? ['--caisheng-renderer-profile=' + profile] : []
  };
}

module.exports = { mount, isMounted, rendererPreferences, ROOT: SIGNAL_ROOT, NATIVE, prepareProfile, closeProfile, closeAllProfiles };
