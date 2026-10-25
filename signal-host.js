'use strict';
/**
 * signal-host.js
 *
 * 宿主旧海拓 Signal 桌面端（独立 Electron 进程），并让它的原生窗口"跟随 / 嵌入"
 * 新平台主窗口。完全复用旧海拓自身的模式：
 *
 *   独立进程 + 独立原生窗口跟随主窗口（HaituoWindowHelper.exe follow）
 *
 * 原理：HaituoWindowHelper.exe 把子窗口设为主窗口的 owned 窗口
 * （GWLP_HWNDPARENT），然后以 1ms 周期读取主窗口客户区、用 SetWindowPos 把子窗口
 * 钉在主窗口客户区内 —— 视觉上"内嵌"，且主窗口最小化/移动/缩放时子窗口永不脱窗。
 *
 * 注意（诚实边界）：跨进程无法做到真正的"同一窗口内嵌"（把 Signal 渲染进平台
 * renderer）。旧海拓自己也只是"独立进程 + 原生窗口跟随"，这里沿用同一机制。
 */
const { app, screen } = require('electron');
const { spawn, execFile } = require('child_process');
const path = require('path');
const fs = require('fs');

const LOG = (...a) => console.log('[signal-host]', ...a);
const WARN = (...a) => console.warn('[signal-host]', ...a);

let getMainWindow = null; // () => BrowserWindow | null
let child = null;         // 海拓 exe 子进程
let follower = null;      // HaituoWindowHelper.exe follow 子进程
let followerSignature = '';
let launched = false;
let closing = false;
let discoveredHandle = 0;
let followRetry = 0;
let followTimer = null;
let launchedAt = 0;

// ---------------------------------------------------------------------------
// 路径与参数解析
// ---------------------------------------------------------------------------

function resolveHaituoExe() {
  const candidates = [];
  if (process.env.HAITUO_SIGNAL_EXE) candidates.push(process.env.HAITUO_SIGNAL_EXE);
  const local = process.env.LOCALAPPDATA;
  if (local) candidates.push(path.join(local, 'Programs', '海拓', '海拓.exe'));
  if (process.env.ProgramFiles) candidates.push(path.join(process.env.ProgramFiles, '海拓', '海拓.exe'));
  const pf86 = process.env['ProgramFiles(x86)'];
  if (pf86) candidates.push(path.join(pf86, '海拓', '海拓.exe'));
  // 开发期兜底：直接指向刚构建出的 win-unpacked 产物（见构建说明）。
  candidates.push(path.join('C:', 'Users', 'AQ28n', 'AppData', 'Local', 'Temp', 'haituo-signal-probe', 'windows', 'out', 'win-unpacked', '海拓.exe'));
  for (const c of candidates) {
    if (!c) continue;
    try { if (fs.existsSync(c)) return c; } catch (_) { /* ignore */ }
  }
  return null;
}

function resolveHelper() {
  if (process.env.HAITUO_SIGNAL_HELPER) return process.env.HAITUO_SIGNAL_HELPER;
  return path.join(__dirname, 'assets', 'HaituoWindowHelper.exe');
}

// 内边距（DIP）：默认只让出平台 46px 标题栏（保留最小化/最大化/关闭按钮）。
function resolveInsets() {
  const raw = process.env.HAITUO_SIGNAL_INSETS || '0,46,0,0';
  const nums = String(raw).split(',').map((n) => Number(String(n).trim()));
  if (nums.length !== 4 || !nums.every(Number.isFinite)) return { left: 0, top: 46, right: 0, bottom: 0 };
  return { left: nums[0], top: nums[1], right: nums[2], bottom: nums[3] };
}

// ---------------------------------------------------------------------------
// 窗口句柄（HWND）
// ---------------------------------------------------------------------------

function getParentHandle(win) {
  if (!win || win.isDestroyed()) return null;
  try {
    const buf = win.getNativeWindowHandle();
    if (!buf || !buf.length) return null;
    const h = buf.length >= 8 ? buf.readBigUInt64LE() : BigInt(buf.readUInt32LE());
    return h.toString();
  } catch (_) {
    return null;
  }
}

// 跨进程发现海拓主窗口句柄：用 PowerShell 读 Get-Process -Id <pid> 的 MainWindowHandle。
// child.pid 即 Electron 浏览器进程（主窗口所属进程）。
function getMainWindowHandle(pid) {
  return new Promise((resolve) => {
    if (!pid) return resolve(0);
    const script = '(Get-Process -Id ' + Number(pid) + ' -ErrorAction SilentlyContinue).MainWindowHandle';
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 10000 }, (err, stdout) => {
      if (err) return resolve(0);
      const h = parseInt(String(stdout || '').trim(), 10);
      resolve(Number.isFinite(h) && h > 0 ? h : 0);
    });
  });
}

// 显式显示/隐藏海拓窗口（托盘最小化时同步，避免 Signal 窗口脱窗残留）。
function setChildVisible(visible) {
  const h = discoveredHandle;
  if (!h) return;
  const sw = visible ? 5 : 0; // SW_SHOW / SW_HIDE
  const def = '[DllImport("user32.dll")] public static extern bool ShowWindow(System.IntPtr h, int n);';
  const script = "Add-Type -Name U -Namespace W -MemberDefinition '" + def + "'; [W.U]::ShowWindow([IntPtr]" + h + ', ' + sw + ') | Out-Null';
  execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 10000 }, () => {});
}

// ---------------------------------------------------------------------------
// 原生窗口跟随
// ---------------------------------------------------------------------------

function stopFollower() {
  const f = follower;
  follower = null;
  followerSignature = '';
  if (f && !f.killed) {
    try { f.kill(); } catch (_) { /* ignore */ }
  }
}

// 启动/刷新跟随进程。签名不变则跳过（避免频繁重启 helper）。
function startFollower(childHandle, parentHandle) {
  if (!childHandle || !parentHandle) return false;
  const win = getMainWindow && getMainWindow();
  if (!win || win.isDestroyed()) return false;

  const insets = resolveInsets();
  let scale = 1;
  try {
    const contentBounds = win.getContentBounds();
    const d = screen.getDisplayMatching(contentBounds);
    if (d && Number.isFinite(d.scaleFactor) && d.scaleFactor > 0) scale = d.scaleFactor;
  } catch (_) { /* ignore */ }

  const left = Math.round(insets.left * scale);
  const top = Math.round(insets.top * scale);
  const right = Math.round(insets.right * scale);
  const bottom = Math.round(insets.bottom * scale);
  const signature = childHandle + ':' + parentHandle + ':' + left + ':' + top + ':' + right + ':' + bottom;

  if (signature === followerSignature && follower && !follower.killed) return true;

  stopFollower();
  const helper = resolveHelper();
  if (!helper || !fs.existsSync(helper)) {
    WARN('HaituoWindowHelper.exe 缺失：', helper);
    return false;
  }
  followerSignature = signature;
  follower = spawn(helper, ['follow', childHandle, parentHandle, String(left), String(top), String(right), String(bottom)], { windowsHide: true, stdio: 'ignore' });
  follower.on('error', (e) => {
    WARN('原生窗口跟随失败：', e && e.message);
    if (follower) { follower = null; followerSignature = ''; }
  });
  follower.once('exit', () => { if (follower) { follower = null; followerSignature = ''; } });
  follower.unref();
  return true;
}

// ---------------------------------------------------------------------------
// 发现 + 跟随
// ---------------------------------------------------------------------------

function discoverAndFollow() {
  if (!launched || !child || closing) return;
  const win = getMainWindow && getMainWindow();
  if (!win || win.isDestroyed()) return;

  const parentHandle = getParentHandle(win);
  if (!parentHandle) {
    followTimer = setTimeout(discoverAndFollow, 500);
    return;
  }

  if (discoveredHandle) {
    startFollower(String(discoveredHandle), parentHandle);
    return;
  }

  if (followRetry > 60) { // 约 60s 仍未发现主窗口
    WARN('未发现海拓主窗口句柄，放弃跟随（进程可能仍在启动）。');
    return;
  }
  followRetry += 1;
  getMainWindowHandle(child.pid).then((h) => {
    if (!launched || !child || closing) return;
    if (h) {
      discoveredHandle = h;
      followRetry = 0;
      LOG('发现海拓主窗口句柄', h);
      startFollower(String(h), parentHandle);
      // 主窗口当前可见性同步给子窗口
      setChildVisible(win.isVisible() && !win.isMinimized());
    } else {
      followTimer = setTimeout(discoverAndFollow, 1000);
    }
  });
}

// ---------------------------------------------------------------------------
// 生命周期
// ---------------------------------------------------------------------------

function init(opts) {
  if (opts && typeof opts.getMainWindow === 'function') getMainWindow = opts.getMainWindow;
}

function launch() {
  if (launched) return false;
  if (process.platform !== 'win32') { WARN('Signal 宿主仅支持 Windows。'); return false; }

  const exe = resolveHaituoExe();
  if (!exe) {
    WARN('未找到海拓 海拓.exe。设置 HAITUO_SIGNAL_EXE 指向已安装/已构建的海拓主程序。');
    return false;
  }
  const win = getMainWindow && getMainWindow();
  if (!win || win.isDestroyed()) { WARN('平台主窗口尚未就绪。'); return false; }

  closing = false;
  launched = true;
  discoveredHandle = 0;
  followRetry = 0;
  launchedAt = Date.now();

  const args = [];
  if (process.env.HAITUO_SIGNAL_ARGS) {
    for (const a of String(process.env.HAITUO_SIGNAL_ARGS).split(/\s+/)) if (a) args.push(a);
  }

  child = spawn(exe, args, { windowsHide: false, stdio: 'ignore' });
  LOG('已启动海拓 Signal 进程', exe, 'pid=', child.pid);
  child.once('exit', (code, sig) => {
    LOG('海拓进程退出', code, sig);
    if (child) { child = null; }
    stopFollower();
    discoveredHandle = 0;
    launched = false;
  });
  child.on('error', (e) => {
    WARN('海拓进程启动失败：', e && e.message);
    child = null;
    launched = false;
  });

  discoverAndFollow();
  return true;
}

function refresh() {
  if (!launched) return;
  discoverAndFollow();
  syncVisibility();
}

// 主窗口显示/隐藏/最小化时同步子窗口可见性（托盘最小化不脱窗）。
function syncVisibility() {
  if (!discoveredHandle) return;
  const win = getMainWindow && getMainWindow();
  if (!win || win.isDestroyed()) return;
  setChildVisible(win.isVisible() && !win.isMinimized());
}

function close() {
  closing = true;
  if (followTimer) { clearTimeout(followTimer); followTimer = null; }
  stopFollower();
  const c = child;
  child = null;
  launched = false;
  discoveredHandle = 0;
  if (!c || c.killed) return;

  const pid = c.pid;
  // 优雅关闭（向海拓主窗口发 WM_CLOSE），3s 后兜底强杀。
  const script = '(Get-Process -Id ' + Number(pid) + ' -ErrorAction SilentlyContinue) | ForEach-Object { $_.CloseMainWindow() | Out-Null }';
  execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 8000 }, () => {
    setTimeout(() => {
      if (c && !c.killed) { try { c.kill(); } catch (_) { /* ignore */ } }
    }, 3000);
  });
}

function isRunning() { return launched && !!child; }

module.exports = { init, launch, refresh, close, isRunning };
