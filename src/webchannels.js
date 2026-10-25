// WhatsApp / Telegram 网页版渠道内嵌（主进程）。
// 每渠道账号一个 WebContentsView + 独立 persist session 分区，登录态互不串。
// 本模块只在主进程被 main.js 引入；纯函数（channelUrl / partitionFor / siteAllowed）无 electron 依赖，便于单测。
const { WebContentsView, ipcMain, app } = require('electron');

// 延迟引入 runtime-access：本文件顶层保持无副作用，避免单测时加载 auth/dotenv。
let access = null;
function getAccess() {
  if (!access) access = require('../runtime-access');
  return access;
}

// 渠道 → 官方网页版地址（白名单，渲染层不可传任意 URL）。
const CHANNEL_URLS = Object.freeze({
  whatsapp: 'https://web.whatsapp.com/',
  'whatsapp-pure': 'https://web.whatsapp.com/',
  'whatsapp-business': 'https://web.whatsapp.com/',
  telegram: 'https://web.telegram.org/k/',
  'telegram-k': 'https://web.telegram.org/k/',
  'telegram-a': 'https://web.telegram.org/a/'
});

// 账号 ID 允许 scope 前缀（如 demo:wa-lea）；仅排除路径分隔符与空白，防分区名注入。
const ACCOUNT_ID_RE = /^[^\s/\\]{1,128}$/;
const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36';

function channelUrl(channel) {
  return CHANNEL_URLS[channel] || null;
}

// 每个账号一个独立持久分区：accountId 唯一 → 分区唯一 → 登录态/Cookie 不串。
// 清理 ':' 等特殊字符避免分区名歧义（demo:wa-lea → demo-wa-lea），对同一账号保持稳定。
function partitionFor(accountId) {
  return 'persist:haituo-web-' + String(accountId).replace(/[^a-zA-Z0-9._-]/g, '-');
}

// 导航白名单：只允许停留在渠道站点及其子域内，防内嵌视图被导航到任意站点。
function siteAllowed(channel, hostname) {
  const url = channelUrl(channel);
  if (!url || typeof hostname !== 'string') return false;
  try {
    const domain = new URL(url).hostname.replace(/^www\./, '').split('.').slice(-2).join('.');
    return hostname === domain || hostname.endsWith('.' + domain);
  } catch {
    return false;
  }
}

let getMainWindow = () => null;
const views = new Map(); // accountId -> { view, channel, url }
let registered = false;

function mainWindow() {
  const win = getMainWindow();
  return win && !win.isDestroyed() ? win : null;
}

function trustedOnly(event) {
  const win = mainWindow();
  return Boolean(win && event && event.sender === win.webContents && getAccess().trusted(event));
}

function webAllowed(event, accountId) {
  if (!trustedOnly(event)) return false;
  const acc = getAccess();
  if (!acc.can('account')) return false;
  if (typeof accountId !== 'string' || !ACCOUNT_ID_RE.test(accountId)) return false;
  const identity = acc.current();
  if (!identity || !Array.isArray(identity.accountIds)) return false;
  // 兼容 scope 前缀（demo:wa-lea 与 wa-lea 互认），不同身份用不同分区，天然隔离。
  return identity.accountIds.some((id) => id === accountId
    || String(id).endsWith(':' + accountId)
    || accountId.endsWith(':' + String(id)));
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

function notify(accountId, type, detail) {
  const win = mainWindow();
  if (win) win.webContents.send('webchannels:event', { accountId, type, detail });
}

function destroy(accountId) {
  const entry = views.get(accountId);
  if (!entry) return;
  const win = mainWindow();
  if (win) {
    try { win.contentView.removeChildView(entry.view); } catch { /* 已移除则忽略 */ }
  }
  try {
    if (!entry.view.webContents.isDestroyed()) entry.view.webContents.close();
  } catch { /* 关闭失败不阻断 */ }
  views.delete(accountId);
}

function destroyAll() {
  for (const id of Array.from(views.keys())) destroy(id);
}

function createView(accountId, channel) {
  const url = channelUrl(channel);
  if (!url) return { ok: false, error: '不支持的渠道' };
  const win = mainWindow();
  if (!win) return { ok: false, error: '主窗口不可用' };

  const existing = views.get(accountId);
  if (existing && !existing.view.webContents.isDestroyed()) {
    return { ok: true, url, created: false };
  }

  const view = new WebContentsView({
    webPreferences: {
      partition: partitionFor(accountId),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false
    }
  });

  const wc = view.webContents;
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  wc.on('will-navigate', (event, navUrl) => {
    let host = '';
    try { host = new URL(navUrl).hostname; } catch { /* 非法 URL 拒绝 */ }
    if (!siteAllowed(channel, host)) event.preventDefault();
  });
  wc.setUserAgent(CHROME_UA);

  wc.on('did-finish-load', () => notify(accountId, 'did-finish-load'));
  wc.on('did-fail-load', (_e, code, desc, _url, isMainFrame) => {
    if (isMainFrame) notify(accountId, 'did-fail-load', { code, desc });
  });

  view.setVisible(false);
  win.contentView.addChildView(view);
  views.set(accountId, { view, channel, url });

  wc.loadURL(url).catch(() => notify(accountId, 'did-fail-load', { code: -1, desc: '加载失败' }));

  return { ok: true, url, created: true };
}

function init(options = {}) {
  if (typeof options.getMainWindow === 'function') getMainWindow = options.getMainWindow;

  if (!registered) {
    registered = true;
    app.on('before-quit', destroyAll);
  }

  ipcMain.handle('webchannels:open', (event, accountId, channel) => {
    if (!webAllowed(event, accountId)) return { ok: false, error: '无权限' };
    return createView(accountId, channel);
  });
  ipcMain.handle('webchannels:setBounds', (event, accountId, rect) => {
    if (!webAllowed(event, accountId)) return { ok: false, error: '无权限' };
    const entry = views.get(accountId);
    if (!entry || entry.view.webContents.isDestroyed()) return { ok: true };
    const bounds = clampBounds(rect);
    if (bounds) entry.view.setBounds(bounds);
    return { ok: true };
  });
  ipcMain.handle('webchannels:setVisible', (event, accountId, visible) => {
    if (!webAllowed(event, accountId)) return { ok: false, error: '无权限' };
    const entry = views.get(accountId);
    if (!entry || entry.view.webContents.isDestroyed()) return { ok: true };
    entry.view.setVisible(Boolean(visible));
    return { ok: true };
  });
  ipcMain.handle('webchannels:sleep', (event, accountId) => {
    if (!webAllowed(event, accountId)) return { ok: false, error: '无权限' };
    destroy(accountId);
    return { ok: true };
  });
  ipcMain.handle('webchannels:refresh', (event, accountId) => {
    if (!webAllowed(event, accountId)) return { ok: false, error: '无权限' };
    const entry = views.get(accountId);
    if (!entry || entry.view.webContents.isDestroyed()) return { ok: true };
    entry.view.webContents.reload();
    return { ok: true };
  });
  ipcMain.handle('webchannels:destroyAll', (event) => {
    if (!trustedOnly(event)) return { ok: false, error: '无权限' };
    destroyAll();
    return { ok: true };
  });
}

module.exports = { init, channelUrl, partitionFor, siteAllowed, CHANNEL_URLS, destroyAll };
