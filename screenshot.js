const {
  app,
  BrowserWindow,
  clipboard,
  desktopCapturer,
  globalShortcut,
  ipcMain,
  nativeImage,
  screen
} = require('electron');
const path = require('path');
const { pathToFileURL } = require('url');
const access = require('./runtime-access');

const HOTKEY = 'Alt+Shift+S';
const MODES = new Set(['copy', 'extract', 'translate', 'edit']);
const MAX_PNG_URL = 24 * 1024 * 1024;
const MAX_IMAGE_SIDE = 16384;
const MAX_IMAGE_PIXELS = 32 * 1024 * 1024;
const OVERLAY_URL = pathToFileURL(path.join(__dirname, 'src', 'capture.html')).href;

let getMainWindow = () => null;
let overlay = null;
let pendingShot = null;
let opening = null;
let defaultMode = 'translate';
let hotkeyRegistered = false;
let unsubscribe = null;

function denied(error = '当前身份没有截屏权限或截屏会话已失效') {
  return { ok: false, error };
}

function mainWindow() {
  const win = getMainWindow();
  return win && !win.isDestroyed() ? win : null;
}

function mainAllowed(event) {
  const win = mainWindow();
  return Boolean(win && event && event.sender === win.webContents
    && access.trusted(event) && access.can('screenshot'));
}

function captureSession() {
  const identity = access.current();
  if (!identity || !access.can('screenshot')) return null;
  return { revision: access.revision(), scope: identity.scope };
}

function sessionValid(session) {
  const identity = access.current();
  return Boolean(session && identity && access.can('screenshot')
    && session.revision === access.revision() && session.scope === identity.scope);
}

function overlayAllowed(event) {
  return Boolean(overlay && !overlay.isDestroyed() && event
    && event.sender === overlay.webContents && event.senderFrame
    && event.senderFrame === overlay.webContents.mainFrame
    && event.senderFrame.url === OVERLAY_URL && sessionValid(pendingShot));
}

function safeImageSize(width, height) {
  return width > 0 && height > 0 && width <= MAX_IMAGE_SIDE && height <= MAX_IMAGE_SIDE
    && width * height <= MAX_IMAGE_PIXELS;
}

function decodePng(dataUrl) {
  if (typeof dataUrl !== 'string' || dataUrl.length > MAX_PNG_URL
    || !dataUrl.startsWith('data:image/png;base64,')) return null;
  const encoded = dataUrl.slice(22);
  if (encoded.length < 44 || encoded.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return null;
  // Inspect IHDR before native decoding, including dimensions of highly compressed images.
  const header = Buffer.from(encoded.slice(0, 44), 'base64');
  if (header.length < 33 || header.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a'
    || header.readUInt32BE(8) !== 13 || header.toString('ascii', 12, 16) !== 'IHDR'
    || !safeImageSize(header.readUInt32BE(16), header.readUInt32BE(20))) return null;
  try {
    const image = nativeImage.createFromDataURL(dataUrl);
    if (image.isEmpty()) return null;
    const size = image.getSize();
    return safeImageSize(size.width, size.height) ? image : null;
  } catch { return null; }
}

async function grabPrimaryDisplay(session) {
  if (!sessionValid(session)) throw new Error('截屏会话已失效');
  const display = screen.getPrimaryDisplay();
  const size = display.size;
  const scale = display.scaleFactor || 1;
  const width = Math.round(size.width * scale);
  const height = Math.round(size.height * scale);
  if (!safeImageSize(width, height)) throw new Error('屏幕尺寸超出安全范围');
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width, height }
  });
  if (!sessionValid(session)) throw new Error('截屏会话已失效');
  const source = sources.find((s) => String(s.display_id) === String(display.id)) || sources[0];
  if (!source || source.thumbnail.isEmpty()) throw new Error('未能捕获屏幕画面');
  const image = source.thumbnail.toDataURL();
  if (!decodePng(image)) throw new Error('屏幕图片超出安全范围或格式无效');
  return { image, bounds: display.bounds, scale };
}

async function openOverlay() {
  const session = captureSession();
  if (!session) return denied();
  if (overlay && !overlay.isDestroyed()) {
    if (sessionValid(pendingShot)) {
      overlay.show();
      overlay.focus();
      return { ok: true, existing: true };
    }
    closeOverlay();
  }
  if (opening && sessionValid(opening.session)) return opening.promise;

  const request = { session, promise: null };
  opening = request;
  request.promise = (async () => {
    let win = null;
    try {
      const shot = await grabPrimaryDisplay(session);
      if (opening !== request || !sessionValid(session)) return denied();
      const { x, y, width, height } = shot.bounds;
      win = new BrowserWindow({
        x, y, width, height,
        frame: false,
        resizable: false,
        movable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        skipTaskbar: true,
        alwaysOnTop: true,
        show: false,
        backgroundColor: '#000000',
        webPreferences: {
          preload: path.join(__dirname, 'src', 'capture-preload.js'),
          contextIsolation: true,
          nodeIntegration: false
        }
      });
      overlay = win;
      pendingShot = { image: shot.image, scale: shot.scale, defaultMode, hotkey: HOTKEY, ...session };
      win.setMenu(null);
      win.setAlwaysOnTop(true, 'screen-saver');
      win.on('closed', () => {
        if (overlay !== win) return;
        overlay = null;
        pendingShot = null;
      });
      win.once('ready-to-show', () => {
        if (overlay !== win || win.isDestroyed() || !sessionValid(session)) return;
        win.show();
        win.focus();
      });
      await win.loadFile(path.join(__dirname, 'src', 'capture.html'));
      if (overlay !== win || !sessionValid(session)) return denied();
      return { ok: true };
    } catch (err) {
      if (win && overlay === win) closeOverlay();
      return sessionValid(session) ? denied('无法截屏: ' + (err.message || err)) : denied();
    } finally {
      if (opening === request) opening = null;
    }
  })();
  return request.promise;
}

function closeOverlay() {
  const win = overlay;
  opening = null;
  overlay = null;
  pendingShot = null;
  if (win && !win.isDestroyed()) win.destroy();
}

function completeCapture(event, payload) {
  if (!overlayAllowed(event)) return denied();
  const session = pendingShot;
  const mode = payload && payload.mode;
  if (!MODES.has(mode)) return denied('截屏模式无效');
  const image = payload && payload.image;
  const decoded = decodePng(image);
  if (!decoded) return denied('选区 PNG 图片无效或超出安全范围');
  if (!sessionValid(session)) return denied();

  let copied = false;
  if (mode === 'copy') {
    try { clipboard.writeImage(decoded); copied = true; }
    catch { return denied('图片剪贴板写入失败'); }
  }
  const result = {
    ok: true, mode, image, copied, capturedAt: Date.now(),
    revision: session.revision, scope: session.scope
  };
  closeOverlay();
  if (!sessionValid(session)) return denied();
  const win = mainWindow();
  if (win) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    win.webContents.send('screenshot:result', result);
  }
  return { ok: true, copied };
}

function register() {
  ipcMain.handle('screenshot:start', (event, mode) => {
    if (!mainAllowed(event)) return denied();
    if (mode !== undefined && !MODES.has(mode)) return denied('截屏模式无效');
    if (MODES.has(mode)) defaultMode = mode;
    return openOverlay();
  });
  ipcMain.handle('screenshot:setDefault', (event, mode) => {
    if (!mainAllowed(event)) return denied();
    if (!MODES.has(mode)) return denied('截屏模式无效');
    defaultMode = mode;
    return { ok: true, mode: defaultMode };
  });
  ipcMain.handle('screenshot:overlay:ready', (event) => overlayAllowed(event) ? pendingShot : denied());
  ipcMain.handle('screenshot:overlay:complete', completeCapture);
  ipcMain.handle('screenshot:overlay:cancel', (event) => {
    if (!overlayAllowed(event)) return denied();
    closeOverlay();
    const win = mainWindow();
    if (win) win.focus();
    return { ok: true };
  });
  ipcMain.handle('clipboard:writeImage', (event, dataUrl) => {
    if (!mainAllowed(event)) return denied();
    const image = decodePng(dataUrl);
    if (!image) return denied('PNG 图片无效或超出安全范围');
    try { clipboard.writeImage(image); return { ok: true }; }
    catch { return denied('图片剪贴板写入失败'); }
  });
  ipcMain.handle('screenshot:status', (event) => mainAllowed(event)
    ? { ok: true, hotkeyRegistered, hotkey: HOTKEY, defaultMode } : denied());

  try {
    hotkeyRegistered = globalShortcut.register(HOTKEY, () => { void openOverlay(); });
  } catch {
    hotkeyRegistered = false;
  }
  if (!hotkeyRegistered) console.warn('[截图] 快捷键注册失败:', HOTKEY);
  app.on('will-quit', () => {
    closeOverlay();
    if (unsubscribe) unsubscribe();
    globalShortcut.unregisterAll();
  });
}

function init(options) {
  if (options && typeof options.getMainWindow === 'function') getMainWindow = options.getMainWindow;
  if (unsubscribe) unsubscribe();
  unsubscribe = access.onChange(() => {
    defaultMode = 'translate';
    closeOverlay();
  });
  register();
}

module.exports = { init, openOverlay, HOTKEY };
