const { ipcMain, clipboard, BrowserWindow } = require('electron');
const auth = require('./auth');
const distribution = require('./distribution');
const ocr = require('./ocr');
const access = require('./runtime-access');
const realtimeConfig = require('./realtime-config');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execute = promisify(execFile);

function registerIpc() {
  const handle = (channel, fn) =>
    ipcMain.handle(channel, async (event, ...args) => {
      if (!access.trusted(event)) return { ok: false, error: '不受信任的调用来源' };
      try {
        return await fn(...args);
      } catch {
        return { ok: false, error: '服务暂不可用，操作结果未确认，请核对后重试' };
      }
    });

  handle('auth:status', () => ({ configured: auth.isConfigured() }));
  handle('auth:signup', (email, password) => access.authenticate('signUp', email, password));
  handle('auth:signin', (email, password) => access.authenticate('signIn', email, password));
  handle('auth:signout', () => access.signOut());
  handle('auth:session', () => access.restore());
  handle('auth:demo', (role) => access.enterDemo(role));

  const protectedCall = (permission, fn) => async (...args) => {
    const verdict = await access.authorize(permission);
    if (!verdict.ok) return verdict;
    const revision = verdict.revision;
    const guard = () => revision === access.revision() && !access.isDemo();
    if (!guard()) return { ok: false, error: '身份已切换' };
    const result = await fn(...args, guard);
    return guard() ? result : { ok: false, error: '身份已切换，结果已丢弃' };
  };
  handle('staff:list', protectedCall('staff:manage', () => distribution.listStaff()));
  handle('staff:create', protectedCall('staff:manage', (...args) => distribution.createStaff(...args)));
  handle('staff:suspend', protectedCall('staff:manage', (...args) => distribution.suspendStaff(...args)));
  handle('staff:delete', protectedCall('staff:manage', (...args) => distribution.deleteStaff(...args)));
  handle('staff:assignChannel', protectedCall('staff:manage', (...args) => distribution.assignChannel(...args)));
  handle('staff:allocateChars', protectedCall('quota:allocate', (staffId, chars, guard) => {
    const n = Number(chars);
    if (!Number.isSafeInteger(n) || n <= 0) return { ok: false, error: '分配字符数无效' };
    return distribution.allocateChars(staffId, n, guard);
  }));
  handle('password:reset', protectedCall('password:reset', (targetId, password, guard) => {
    if (typeof password !== 'string' || password.length < 6 || password.length > 1024) return { ok: false, error: '密码至少 6 位' };
    return distribution.resetPassword(targetId, password, guard);
  }));
  handle('audit:list', protectedCall('audit:read', () => distribution.listAudit()));

  // ---- 远程配置同步（Realtime postgres_changes）----
  // 订阅：登录（非演示）后渲染层调用，返回当前快照并建立转发；事件经 realtime-config:event 推送
  ipcMain.handle('realtime-config:subscribe', async (event) => {
    if (!access.trusted(event)) return { ok: false, error: '不受信任的调用来源' };
    if (access.isDemo()) return { ok: false, error: '离线演示无远程配置' };
    try {
      return await realtimeConfig.attach(event.sender);
    } catch {
      return { ok: false, error: '服务暂不可用，操作结果未确认，请核对后重试' };
    }
  });
  // 快照：离线/启动时拉取最新（任意登录身份可读自己可见的配置）
  handle('realtime-config:snapshot', protectedCall('home', () => realtimeConfig.snapshot()));
  // 退订
  handle('realtime-config:unsubscribe', () => { realtimeConfig.detach(); return { ok: true }; });
  // 写配置：仅 owner/admin（服务端 RPC 亦二次校验角色）
  handle('realtime-config:set', async (key, value, scope) => {
    const verdict = await access.authorize('providers');
    if (!verdict.ok) return verdict;
    const role = access.current() && access.current().role;
    if (role !== 'owner' && role !== 'admin') return { ok: false, error: '只有所有者/管理员能修改平台配置' };
    const revision = verdict.revision;
    const guard = () => revision === access.revision() && !access.isDemo();
    if (!guard()) return { ok: false, error: '身份已切换' };
    const result = await realtimeConfig.setConfig(key, value, scope, guard);
    return guard() ? result : { ok: false, error: '身份已切换，结果已丢弃' };
  });

  handle('system:fonts', async () => {
    if (!access.can('appearance')) return { ok: false, error: '请先登录或进入演示' };
    if (process.platform !== 'win32') return { ok: true, fonts: [] };
    const { stdout } = await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      '[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new(); Add-Type -AssemblyName System.Drawing; (New-Object System.Drawing.Text.InstalledFontCollection).Families.Name | ConvertTo-Json -Compress'],
    { windowsHide: true, timeout: 10000, maxBuffer: 1024 * 1024 });
    const fonts = JSON.parse(stdout.replace(/^\uFEFF/, ''));
    return { ok: true, fonts: (Array.isArray(fonts) ? fonts : [fonts]).filter((f) => typeof f === 'string' && /^[\p{L}\p{N} _.-]{1,80}$/u.test(f)) };
  });

  // 系统剪贴板
  handle('clipboard:write', (text) => {
    if (!access.can('home')) return { ok: false, error: '请先登录' };
    if (typeof text !== 'string' || text.length > 1000000) return { ok: false, error: '文字长度无效' };
    clipboard.writeText(text);
    return { ok: true };
  });

  // 截屏 OCR：识别原图，标注层不参与识别
  handle('ocr:recognize', async (dataUrl) => {
    if (!access.can('screenshot')) return { ok: false, error: '没有截屏识别权限' };
    const revision = access.revision();
    const result = await ocr.recognize(dataUrl);
    return revision === access.revision() ? result : { ok: false, error: '身份已切换，识别结果已丢弃' };
  });

  // 自绘标题栏的窗口控制
  const withWindow = (channel, fn) =>
    ipcMain.handle(channel, (e) => {
      if (!access.trusted(e)) return { ok: false, error: '不受信任的调用来源' };
      const win = BrowserWindow.fromWebContents(e.sender);
      if (!win) return { ok: false, error: '窗口不存在' };
      return fn(win);
    });

  withWindow('window:minimize', (win) => {
    win.minimize();
    return { ok: true };
  });
  withWindow('window:toggleMaximize', (win) => {
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
    return { ok: true, maximized: win.isMaximized() };
  });
  withWindow('window:close', (win) => {
    win.close();
    return { ok: true };
  });
}

module.exports = { registerIpc };
