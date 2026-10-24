const { app, BrowserWindow } = require('electron');
const path = require('path');
const pkg = require('./package.json');
const auth = require('./auth');
const { registerIpc } = require('./ipc');

// 品牌唯一来源：package.json 的 productName
const BRAND_NAME = pkg.productName || pkg.name;
const BRAND_VERSION = pkg.version;

app.setName(BRAND_NAME);

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 1024,
    minHeight: 640,
    title: BRAND_NAME,
    frame: false,
    backgroundColor: '#16181d',
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

  win.loadFile(path.join(__dirname, 'src', 'index.html'));
  return win;
}

app.whenReady().then(() => {
  auth.init(path.join(app.getPath('userData'), 'session.json'));
  registerIpc();
  console.log('[' + BRAND_NAME + '] Supabase 已配置:', auth.isConfigured(), '| 会话文件:', path.join(app.getPath('userData'), 'session.json'));

  // 认证状态变化（登录 / 退出 / token 失效）转发给渲染层
  auth.onAuthStateChange((event, email) => {
    for (const w of BrowserWindow.getAllWindows()) {
      w.webContents.send('auth:state', { event, email });
    }
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
