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

const HOTKEY = 'Alt+Shift+S';
const MODES = new Set(['copy', 'extract', 'translate', 'edit']);

let getMainWindow = () => null;
let overlay = null;
let pendingShot = null;
let defaultMode = 'translate';
let hotkeyRegistered = false;

function mainWindow() {
  const win = getMainWindow();
  return win && !win.isDestroyed() ? win : null;
}

async function grabPrimaryDisplay() {
  const display = screen.getPrimaryDisplay();
  const size = display.size;
  const scale = display.scaleFactor || 1;
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: {
      width: Math.round(size.width * scale),
      height: Math.round(size.height * scale)
    }
  });
  const source = sources.find((s) => String(s.display_id) === String(display.id)) || sources[0];
  if (!source || source.thumbnail.isEmpty()) throw new Error('未能捕获屏幕画面');
  return {
    image: source.thumbnail.toDataURL(),
    bounds: display.bounds,
    scale
  };
}

async function openOverlay() {
  if (overlay && !overlay.isDestroyed()) {
    overlay.show();
    overlay.focus();
    return { ok: true, existing: true };
  }

  let shot;
  try {
    shot = await grabPrimaryDisplay();
  } catch (err) {
    return { ok: false, error: '无法截屏: ' + (err.message || err) };
  }

  pendingShot = {
    image: shot.image,
    scale: shot.scale,
    defaultMode,
    hotkey: HOTKEY
  };

  const { x, y, width, height } = shot.bounds;
  overlay = new BrowserWindow({
    x,
    y,
    width,
    height,
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
  overlay.setMenu(null);
  overlay.setAlwaysOnTop(true, 'screen-saver');
  overlay.on('closed', () => {
    overlay = null;
    pendingShot = null;
  });
  overlay.loadFile(path.join(__dirname, 'src', 'capture.html'));
  overlay.once('ready-to-show', () => {
    if (!overlay) return;
    overlay.show();
    overlay.focus();
  });
  return { ok: true };
}

function closeOverlay() {
  if (overlay && !overlay.isDestroyed()) overlay.destroy();
  overlay = null;
  pendingShot = null;
}

async function completeCapture(payload) {
  if (!pendingShot) return { ok: false, error: '截屏会话已失效' };
  const mode = MODES.has(payload && payload.mode) ? payload.mode : 'edit';
  const image = payload && typeof payload.image === 'string' ? payload.image : '';
  if (!/^data:image\/png;base64,/.test(image)) {
    return { ok: false, error: '选区图片无效' };
  }

  let copied = false;
  if (mode === 'copy') {
    const img = nativeImage.createFromDataURL(image);
    if (!img.isEmpty()) {
      clipboard.writeImage(img);
      copied = true;
    }
  }

  const result = {
    ok: true,
    mode,
    image,
    copied,
    capturedAt: Date.now()
  };

  closeOverlay();

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
  ipcMain.handle('screenshot:start', async (e, mode) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win || win === overlay) return { ok: false, error: '不可用' };
    if (MODES.has(mode)) defaultMode = mode;
    return openOverlay();
  });

  ipcMain.handle('screenshot:setDefault', (_e, mode) => {
    if (MODES.has(mode)) defaultMode = mode;
    return { ok: true, mode: defaultMode };
  });

  ipcMain.handle('screenshot:overlay:ready', () => pendingShot);

  ipcMain.handle('screenshot:overlay:complete', (e, payload) => {
    if (!overlay || e.sender !== overlay.webContents) return { ok: false, error: '来源无效' };
    return completeCapture(payload);
  });

  ipcMain.handle('screenshot:overlay:cancel', (e) => {
    if (!overlay || e.sender !== overlay.webContents) return { ok: false, error: '来源无效' };
    closeOverlay();
    const win = mainWindow();
    if (win) win.focus();
    return { ok: true };
  });

  ipcMain.handle('clipboard:writeImage', (_e, dataUrl) => {
    if (!/^data:image\/png;base64,/.test(String(dataUrl || ''))) {
      return { ok: false, error: '图片格式无效' };
    }
    const img = nativeImage.createFromDataURL(dataUrl);
    if (img.isEmpty()) return { ok: false, error: '图片为空' };
    clipboard.writeImage(img);
    return { ok: true };
  });

  ipcMain.handle('screenshot:status', () => ({ hotkeyRegistered, hotkey: HOTKEY, defaultMode }));

  try {
    hotkeyRegistered = globalShortcut.register(HOTKEY, () => {
      openOverlay();
    });
  } catch (err) {
    hotkeyRegistered = false;
  }
  if (!hotkeyRegistered) console.warn('[截图] 快捷键注册失败:', HOTKEY);

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
  });
}

function init(options) {
  if (options && typeof options.getMainWindow === 'function') {
    getMainWindow = options.getMainWindow;
  }
  register();
}

module.exports = { init, openOverlay, HOTKEY };
