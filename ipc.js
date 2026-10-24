const { ipcMain } = require('electron');
const auth = require('./auth');

// 账号 IPC 通道：把渲染层请求转发给 Supabase Auth 模块
function registerIpc() {
  const handle = (channel, fn) =>
    ipcMain.handle(channel, async (_e, ...args) => {
      try {
        return await fn(...args);
      } catch (err) {
        return { ok: false, error: '服务内部错误: ' + err.message };
      }
    });

  handle('auth:status', () => ({ configured: auth.isConfigured() }));
  handle('auth:signup', (email, password) => auth.signUp(email, password));
  handle('auth:signin', (email, password) => auth.signIn(email, password));
  handle('auth:signout', () => auth.signOut());
  handle('auth:session', () => auth.getSession());
}

module.exports = { registerIpc };
