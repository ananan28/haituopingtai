'use strict';

// 应用设置（主进程）：主题 / 自动更新 / 开机自启动 / 关闭行为。
// 设置持久化到 userData/app-settings.json；IPC 通道在 registerIpc() 内注册。
// 本模块独立于渠道/窗口/登录逻辑，main.js 仅在生命周期区做最小接入。

const { app, ipcMain, nativeTheme, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const access = require('./runtime-access');

const DEFAULTS = Object.freeze({
  theme: 'dark',            // 'dark' | 'light' | 'system'
  autoUpdate: true,         // 自动检查/下载更新（发布前自测通过才推包）
  openAtLogin: false,       // 开机自启动
  closeBehavior: 'quit'     // 'tray' | 'quit'
});
const THEMES = ['dark', 'light', 'system'];
const CLOSE_BEHAVIORS = ['tray', 'quit'];
const LIGHT_BG = '#f2f3f7';
const DARK_BG = '#16181d';

// 16x16 品牌色托盘图标（运行时生成，避免引入二进制资源）。
const TRAY_ICON_B64 = 'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAH0lEQVR4nGOoifnwnxLMMGoADQ1AByPRgIGPhRFkAADPztpve72B2gAAAABJRU5ErkJggg==';

let settings = { ...DEFAULTS };
let tray = null;
let quitting = false;
let brand = '海拓商业版';
let mainWinRef = null;
let autoUpdater = null;

function settingsPath() {
  return path.join(app.getPath('userData'), 'app-settings.json');
}

function sanitize(raw) {
  const out = { ...DEFAULTS };
  if (!raw || typeof raw !== 'object') return out;
  if (THEMES.includes(raw.theme)) out.theme = raw.theme;
  if (typeof raw.autoUpdate === 'boolean') out.autoUpdate = raw.autoUpdate;
  if (typeof raw.openAtLogin === 'boolean') out.openAtLogin = raw.openAtLogin;
  if (CLOSE_BEHAVIORS.includes(raw.closeBehavior)) out.closeBehavior = raw.closeBehavior;
  return out;
}

function load() {
  try {
    settings = sanitize(JSON.parse(fs.readFileSync(settingsPath(), 'utf8')));
  } catch {
    settings = { ...DEFAULTS };
  }
  return settings;
}

function persist() {
  try {
    fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2));
    return true;
  } catch {
    return false;
  }
}

function effectiveTheme() {
  return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
}

function windowBackground() {
  return effectiveTheme() === 'light' ? LIGHT_BG : DARK_BG;
}

function applyTheme() {
  try { nativeTheme.themeSource = settings.theme; } catch { /* 平台不支持时忽略 */ }
  broadcastTheme();
}

function broadcastTheme() {
  const win = mainWinRef && mainWinRef.getMainWindow();
  if (win && !win.isDestroyed()) win.webContents.send('app-settings:theme', { theme: effectiveTheme() });
}

function applyOpenAtLogin() {
  // 开发态（未打包）不写注册表，避免把 electron.exe 注册成开机项污染开发机；安装版生效。
  if (!app.isPackaged) return;
  try { app.setLoginItemSettings({ openAtLogin: settings.openAtLogin }); } catch { /* 平台不支持时忽略 */ }
}

function showMainWindow() {
  if (!mainWinRef) return;
  let win = mainWinRef.getMainWindow();
  if (!win || win.isDestroyed()) {
    if (typeof mainWinRef.createWindow === 'function') win = mainWinRef.createWindow();
  }
  if (!win || win.isDestroyed()) return;
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function ensureTray() {
  if (tray) return tray;
  try {
    const icon = nativeImage.createFromDataURL('data:image/png;base64,' + TRAY_ICON_B64);
    tray = new Tray(icon);
    tray.setToolTip(brand);
    tray.on('click', showMainWindow);
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: '显示主界面', click: showMainWindow },
      { type: 'separator' },
      { label: '退出', click: () => { quitting = true; app.quit(); } }
    ]));
  } catch {
    tray = null;
  }
  return tray;
}

function destroyTray() {
  if (!tray) return;
  try { tray.destroy(); } catch { /* 忽略 */ }
  tray = null;
}

function syncTray() {
  if (settings.closeBehavior === 'tray') ensureTray();
  else destroyTray();
}

function shouldMinimizeToTray() {
  return settings.closeBehavior === 'tray' && !quitting;
}

/* ---------- 自动更新（electron-updater） ---------- */

function getAutoUpdater() {
  if (!autoUpdater) {
    try { autoUpdater = require('electron-updater').autoUpdater; } catch { autoUpdater = null; }
  }
  return autoUpdater;
}

function sendUpdateState(payload) {
  const win = mainWinRef && mainWinRef.getMainWindow();
  if (win && !win.isDestroyed()) win.webContents.send('app-settings:update-state', payload);
}

function wireAutoUpdater() {
  if (!app.isPackaged) return; // 开发态不接更新通道
  const au = getAutoUpdater();
  if (!au) return;
  au.autoDownload = settings.autoUpdate;
  au.autoInstallOnAppQuit = true;
  if (au.listenerCount('checking-for-update') === 0) {
    au.on('checking-for-update', () => sendUpdateState({ state: 'checking' }));
    au.on('update-available', (info) => sendUpdateState({ state: 'available', version: info && info.version }));
    au.on('update-not-available', () => sendUpdateState({ state: 'not-available' }));
    au.on('download-progress', (p) => sendUpdateState({ state: 'downloading', percent: p && p.percent }));
    au.on('update-downloaded', (info) => sendUpdateState({ state: 'downloaded', version: info && info.version }));
    au.on('error', (err) => sendUpdateState({ state: 'error', message: String(err && err.message || err) }));
  }
}

function checkForUpdates() {
  if (!app.isPackaged) return { ok: false, error: '开发模式不检查更新；打包发布后才可用' };
  const au = getAutoUpdater();
  if (!au) return { ok: false, error: '更新组件未安装' };
  if (!settings.autoUpdate) return { ok: false, error: '已关闭自动更新' };
  try { au.checkForUpdates().catch(() => {}); return { ok: true }; }
  catch { return { ok: false, error: '检查更新失败' }; }
}

/* ---------- IPC ---------- */

function registerIpc() {
  const handle = (channel, fn) =>
    ipcMain.handle(channel, async (event, ...args) => {
      if (!access.trusted(event)) return { ok: false, error: '不受信任的调用来源' };
      try { return await fn(...args); } catch { return { ok: false, error: '服务暂不可用' }; }
    });

  handle('app-settings:get', () => ({
    ok: true,
    settings: { ...settings },
    effectiveTheme: effectiveTheme(),
    platform: process.platform,
    packaged: app.isPackaged,
    version: app.getVersion()
  }));

  handle('app-settings:set', (partial) => {
    const next = sanitize({ ...settings, ...(partial && typeof partial === 'object' ? partial : {}) });
    const themeChanged = next.theme !== settings.theme;
    settings = next;
    const saved = persist();
    if (themeChanged) applyTheme();
    applyOpenAtLogin();
    syncTray();
    if (autoUpdater) autoUpdater.autoDownload = settings.autoUpdate;
    return { ok: saved, settings: { ...settings }, effectiveTheme: effectiveTheme() };
  });

  handle('app-settings:checkUpdate', () => checkForUpdates());
}

/* ---------- 初始化 ---------- */

function init(options) {
  options = options || {};
  mainWinRef = options;
  brand = options.brand || brand;
  load();
  applyTheme();
  applyOpenAtLogin();
  syncTray();
  wireAutoUpdater();
  registerIpc();

  // 跟随系统时，系统深浅色变化实时同步给渲染层。
  nativeTheme.on('updated', broadcastTheme);
  app.on('before-quit', () => { quitting = true; });
}

module.exports = {
  init,
  load,
  windowBackground,
  effectiveTheme,
  shouldMinimizeToTray,
  showMainWindow,
  ensureTray,
  destroyTray,
  registerIpc
};
