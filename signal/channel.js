'use strict';
/**
 * signal/channel.js — Signal 渠道内嵌（主进程）。
 *
 * 与 src/webchannels.js（WhatsApp/Telegram 网页版）并列：把 Signal 会话承载进
 * 主窗口内容区。区别在于 Signal 渲染器是本地 background.html（旧海拓源码），
 * 且依赖 signal/index.js 挂载的旧海拓主进程后端（IPC/sql/libsignal/websocket）。
 *
 * 当前阶段（P3/P4 过渡）：
 *  - bundle 后端是单 profile 单例（--caisheng-profile 只读一次），故本模块当前
 *    只承载主账号会话；多账号并发同进程需把 bundle 模块级状态按 profile 化（P4）。
 *  - 渲染器按 signal/index.js#rendererPreferences 的 webPreferences 启动。
 */
const { WebContentsView, ipcMain, app } = require('electron');
const path = require('node:path');
const signal = require('./index.js');
const profiles = require('./profiles.js');
const { accountAllowed } = require('../src/channel-identity');

let access = null;
function getAccess() {
  if (!access) access = require('../runtime-access');
  return access;
}

const ACCOUNT_ID_RE = /^[^\s/\\]{1,128}$/;
let getMainWindow = () => null;
const openings = new Map();
const views = new Map(); // accountId -> { view }
let registered = false;
let lifecycle = 0;
const accountEpochs = new Map();

function mainWindow() {
  const win = getMainWindow();
  return win && !win.isDestroyed() ? win : null;
}

function trustedOnly(event) {
  const win = mainWindow();
  return Boolean(win && event && event.sender === win.webContents && getAccess().trusted(event));
}

function signalAllowed(event, accountId) {
  if (!trustedOnly(event)) return false;
  const acc = getAccess();
  if (!acc.can('account')) return false;
  if (typeof accountId !== 'string' || !ACCOUNT_ID_RE.test(accountId)) return false;
  return accountAllowed(acc.current(), accountId);
}

function clampBounds(rect) {
  if (!rect || typeof rect !== 'object') return null;
  const x = Math.round(Number(rect.x) || 0);
  const y = Math.round(Number(rect.y) || 0);
  const width = Math.round(Number(rect.width) || 0);
  const height = Math.round(Number(rect.height) || 0);
  if (width < 1 || height < 1) return null;
  return { x, y, width, height };
}

function destroy(accountId) {
  accountEpochs.set(accountId, (accountEpochs.get(accountId) || 0) + 1);
  const identity = getAccess().current();
  if (identity) signal.closeProfile(profiles.profileForAccount(accountId, identity.scope)).catch(() => {});
  const entry = views.get(accountId);
  if (!entry) return;
  const win = mainWindow();
  if (win) {
    try { win.contentView.removeChildView(entry.view); } catch { /* 已移除则忽略 */ }
  }
  profiles.unbindWebContents(entry.view.webContents);
  try {
    if (!entry.view.webContents.isDestroyed()) entry.view.webContents.close();
  } catch { /* 关闭失败不阻断 */ }
  views.delete(accountId);
  if (entry.profile) signal.closeProfile(entry.profile).catch(() => {});
}

function destroyAll() {
  lifecycle++;
  for (const id of Array.from(views.keys())) destroy(id);
  openings.clear();
  signal.closeAllProfiles().catch(() => {});
}

async function createView(accountId) {
  const epoch = accountEpochs.get(accountId) || 0;
  const generation = lifecycle;
  const win = mainWindow();
  if (!win) return { ok: false, error: '主窗口不可用' };

  const existing = views.get(accountId);
  if (existing && !existing.view.webContents.isDestroyed()) {
    return { ok: true, created: false };
  }

  const identity = getAccess().current();
  const revision = getAccess().revision();
  const entry = await signal.prepareProfile(identity.scope, accountId);
  if (generation !== lifecycle || epoch !== (accountEpochs.get(accountId) || 0) || getAccess().revision() !== revision || getAccess().current()?.scope !== identity.scope || mainWindow() !== win) {
    await signal.closeProfile(entry.profile);
    return { ok: false, error: '身份或主窗口已变更' };
  }
  try { if (!signal.isMounted()) signal.mount({ profile: 'signal-main' }); }
  catch (error) { await signal.closeProfile(entry.profile); throw error; }
  const profile = entry.profile;
  const view = new WebContentsView({ webPreferences: { ...signal.rendererPreferences(profile), partition: 'persist:haituo-' + profile } });
  const wc = view.webContents;
  // 绑定 webContents -> profile，供 bundle 内 SQL 客户端按 event.sender 路由（P4）
  profiles.bindWebContents(wc, profile);
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  wc.on('will-navigate', (event) => event.preventDefault());

  view.setVisible(false);
  win.contentView.addChildView(view);
  views.set(accountId, { view, profile });

  try {
    await wc.loadFile(path.join(signal.ROOT, 'background.html'));
    if (getAccess().revision() !== revision || wc.isDestroyed()) return { ok: false, error: '会话已关闭' };
    return { ok: true, created: true };
  } catch {
    destroy(accountId);
    return { ok: false, error: 'Signal 页面加载失败' };
  }
}

function init(options = {}) {
  if (typeof options.getMainWindow === 'function') getMainWindow = options.getMainWindow;

  if (!registered) {
    registered = true;
    app.on('before-quit', destroyAll);
    getAccess().onChange(destroyAll);
  } else {
    return;
  }

  ipcMain.handle('signal:open', async (event, accountId) => {
    if (!signalAllowed(event, accountId)) return { ok: false, error: '无权限' };
    if (openings.has(accountId)) return openings.get(accountId);
    const operation = createView(accountId).catch(() => ({ ok: false, error: 'Signal 初始化失败，请检查系统密钥与数据库运行依赖' }));
    openings.set(accountId, operation);
    try { return await operation; }
    finally { if (openings.get(accountId) === operation) openings.delete(accountId); }
  });
  ipcMain.handle('signal:setBounds', (event, accountId, rect) => {
    if (!signalAllowed(event, accountId)) return { ok: false, error: '无权限' };
    const entry = views.get(accountId);
    if (!entry || entry.view.webContents.isDestroyed()) return { ok: true };
    const bounds = clampBounds(rect);
    if (bounds) entry.view.setBounds(bounds);
    return { ok: true };
  });
  ipcMain.handle('signal:setVisible', (event, accountId, visible) => {
    if (!signalAllowed(event, accountId)) return { ok: false, error: '无权限' };
    const entry = views.get(accountId);
    if (!entry || entry.view.webContents.isDestroyed()) return { ok: true };
    entry.view.setVisible(Boolean(visible));
    if (visible) entry.view.webContents.send('activate');
    return { ok: true };
  });
  ipcMain.handle('signal:destroyAll', (event) => {
    if (!trustedOnly(event)) return { ok: false, error: '无权限' };
    destroyAll();
    return { ok: true };
  });
  ipcMain.handle('signal:refresh', (event, accountId) => {
    if (!signalAllowed(event, accountId)) return { ok: false, error: '无权限' };
    const entry = views.get(accountId);
    if (!entry || entry.view.webContents.isDestroyed()) return { ok: false, error: '会话未启动' };
    entry.view.webContents.reload();
    return { ok: true };
  });
  ipcMain.handle('signal:sleep', (event, accountId) => {
    if (!signalAllowed(event, accountId)) return { ok: false, error: '无权限' };
    destroy(accountId);
    return { ok: true };
  });
}

module.exports = { init, destroyAll };
