const { ipcMain } = require('electron');
const auth = require('./auth');
const distribution = require('./distribution');

// IPC 通道：把渲染层请求转发给对应模块
function registerIpc() {
  const handle = (channel, fn) =>
    ipcMain.handle(channel, async (_e, ...args) => {
      try {
        return await fn(...args);
      } catch (err) {
        return { ok: false, error: '服务内部错误: ' + err.message };
      }
    });

  // 账号
  handle('auth:status', () => ({ configured: auth.isConfigured() }));
  handle('auth:signup', (email, password) => auth.signUp(email, password));
  handle('auth:signin', (email, password) => auth.signIn(email, password));
  handle('auth:signout', () => auth.signOut());
  handle('auth:session', () => auth.getSession());

  // 分销
  handle('distribution:listProfiles', () => distribution.listProfiles());
  handle('distribution:promoteToAgent', (email, rate) => distribution.promoteToAgent(email, rate));
  handle('distribution:demoteAgent', (userId) => distribution.demoteAgent(userId));
  handle('distribution:assignAgent', (userEmail, agentEmail) => distribution.assignAgent(userEmail, agentEmail));
  handle('distribution:listMyUsers', () => distribution.listMyUsers());
}

module.exports = { registerIpc };
