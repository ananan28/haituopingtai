const { app, BrowserWindow, safeStorage } = require('electron');
const path = require('path');
const pkg = require('./package.json');
const auth = require('./auth');
const { registerIpc } = require('./ipc');
const screenshot = require('./screenshot');
const access = require('./runtime-access');
const appSettings = require('./app-settings');
const webchannels = require('./src/webchannels');
const signalChannel = require('./signal/channel');
const messages = require('./messages-ipc');
const translationStore = require('./src/translation-store');

// 品牌唯一来源：package.json 的 productName
const BRAND_NAME = pkg.productName || pkg.name;
const BRAND_VERSION = pkg.version;

app.setName(BRAND_NAME);
let mainWin = null;

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1024,
    minHeight: 640,
    title: BRAND_NAME,
    frame: false,
    backgroundColor: appSettings.windowBackground(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      additionalArguments: [
        '--haituo-brand=' + encodeURIComponent(BRAND_NAME),
        '--haituo-version=' + encodeURIComponent(BRAND_VERSION)
      ]
    }
  });

  mainWin = win;
  win.on('hide',()=>translationStore.flush());
  win.on('close', (event) => {
    if (appSettings.shouldMinimizeToTray()) { event.preventDefault(); win.hide(); }
  });
  win.on('closed', () => { if (mainWin === win) { mainWin = null; access.bindWindow(null); } });
  access.bindWindow(win.webContents);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
  return win;
}

app.whenReady().then(() => {
  translationStore.init(app);
  appSettings.init({ getMainWindow: () => mainWin, createWindow, brand: BRAND_NAME });
  auth.init(path.join(app.getPath('userData'), 'session.json'), safeStorage);
  registerIpc();
  messages.init({ app, ipcMain: require('electron').ipcMain, access });
  console.log('[' + BRAND_NAME + '] Supabase 已配置:', auth.isConfigured(), '| 会话文件:', path.join(app.getPath('userData'), 'session.json'));

  // 认证状态变化（登录 / 退出 / token 失效）转发给渲染层
  auth.onAuthStateChange((event, email) => {
    if (access.isDemo()) return;
    if (event === 'SIGNED_OUT') access.invalidate();
    if (mainWin && !mainWin.isDestroyed()) mainWin.webContents.send('auth:state', { event, email });
  });

  createWindow();
  screenshot.init({ getMainWindow: () => mainWin });
  webchannels.init({ getMainWindow: () => mainWin });
  signalChannel.init({ getMainWindow: () => mainWin });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform === 'darwin') return;
  if (!appSettings.shouldMinimizeToTray()) app.quit();
});
app.on('before-quit',()=>translationStore.flush());
