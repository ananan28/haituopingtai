const { app, BrowserWindow, safeStorage } = require('electron');
const path = require('path');
const pkg = require('./package.json');
const auth = require('./auth');
const { registerIpc } = require('./ipc');
const screenshot = require('./screenshot');
const access = require('./runtime-access');
const appSettings = require('./app-settings');
const webchannels = require('./src/webchannels');
const signalHost = require('./signal-host');

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
  win.on('close', (event) => {
    if (appSettings.shouldMinimizeToTray()) { event.preventDefault(); win.hide(); }
  });
  win.on('closed', () => { if (mainWin === win) { mainWin = null; access.bindWindow(null); } });
  // 旧海拓 Signal 宿主窗口跟随主窗口（移动/缩放/显隐/最小化都重新跟随）
  win.on('move', () => signalHost.refresh());
  win.on('resize', () => signalHost.refresh());
  win.on('show', () => signalHost.refresh());
  win.on('hide', () => signalHost.refresh());
  win.on('minimize', () => signalHost.refresh());
  win.on('restore', () => signalHost.refresh());
  access.bindWindow(win.webContents);
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
  return win;
}

app.whenReady().then(() => {
  appSettings.init({ getMainWindow: () => mainWin, createWindow, brand: BRAND_NAME });
  auth.init(path.join(app.getPath('userData'), 'session.json'), safeStorage);
  registerIpc();
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

  // 旧海拓 Signal 独立进程：启动后让它的原生窗口跟随/嵌入平台主窗口（永不脱窗）。
  signalHost.init({ getMainWindow: () => mainWin });
  signalHost.launch();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  signalHost.close();
});

app.on('window-all-closed', () => {
  if (process.platform === 'darwin') return;
  if (!appSettings.shouldMinimizeToTray()) app.quit();
});
