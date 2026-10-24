const { app, BrowserWindow } = require('electron');
const path = require('path');
const auth = require('./auth');
const { registerIpc } = require('./ipc');

app.setName('海拓');

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 800,
    minHeight: 560,
    title: '海拓',
    backgroundColor: '#16181d',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.loadFile(path.join(__dirname, 'src', 'index.html'));
  return win;
}

app.whenReady().then(() => {
  auth.init(path.join(app.getPath('userData'), 'session.json'));
  registerIpc();
  console.log('[海拓] Supabase 已配置:', auth.isConfigured(), '| 会话文件:', path.join(app.getPath('userData'), 'session.json'));

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
