'use strict';
const { app, BrowserWindow, WebContentsView, safeStorage, ipcMain, nativeTheme, clipboard, systemPreferences } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { ProfileRuntime } = require('../signal/profile-runtime');
const profiles = require('../signal/profiles');
const signal = require('../signal/index.js');
let runtime, directory, win;
const views = [];
app.disableHardwareAcceleration();
setTimeout(() => { console.error('Signal embedded UI watchdog expired'); app.exit(1); }, 90000).unref();
process.on('uncaughtException', error => { console.error(error); app.exit(1); });
const localKey = crypto.randomBytes(32);
const localEncryption = { isEncryptionAvailable: () => true,
  encryptString(value) { const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', localKey, iv); return Buffer.concat([iv, c.update(value), c.final(), c.getAuthTag()]); },
  decryptString(value) { const c = crypto.createDecipheriv('aes-256-gcm', localKey, value.subarray(0, 12)); c.setAuthTag(value.subarray(-16)); return Buffer.concat([c.update(value.subarray(12, -16)), c.final()]).toString(); } };
const report = { checks: [], errors: [] };
async function run() {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'haituo-signal-view-'));
  app.setPath('userData', directory);
  const identity = { scope: 'test:signal-ui', demo: false, accountIds: ['one', 'two'] };
  const access = { current: () => identity, revision: () => 1, can: () => true };
  runtime = new ProfileRuntime({ directory: path.join(directory, 'profiles'), safeStorage: safeStorage.isEncryptionAvailable() ? safeStorage : localEncryption });
  require('../signal/service').mount({ electron: { app, ipcMain, nativeTheme, clipboard, systemPreferences }, runtime, profiles, access });
  win = new BrowserWindow({ width: 1200, height: 800, show: false, webPreferences: { offscreen: true, backgroundThrottling: false } });
  win.setSize(1200, 800);
  for (const accountId of identity.accountIds) {
    console.log('Opening native profile', accountId);
    const entry = await runtime.open(identity.scope, accountId);
    console.log('Native profile ready', accountId);
    const view = new WebContentsView({ webPreferences: { ...signal.rendererPreferences(entry.profile), partition: 'persist:test-' + entry.profile } });
    views.push(view); profiles.bindWebContents(view.webContents, entry.profile);
    view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    view.webContents.on('preload-error', (_event, _file, error) => { report.errors.push(error.message); console.error('Signal preload error', error); });
    view.webContents.on('console-message', (_event, details, message) => {
      const value = typeof details === 'object' ? details.message : message;
      if (String(value).includes('Uncaught')) report.errors.push(String(value).slice(0, 2000));
    });
    win.contentView.addChildView(view); view.setBounds({ x: 0, y: 0, width: 1200, height: 800 });
    await view.webContents.loadFile(path.join(signal.ROOT, 'background.html'));
    view.webContents.send('activate');
    const state = await view.webContents.executeJavaScript(`(async()=>{const end=Date.now()+20000;while(Date.now()<end){const text=document.body.innerText;const splash=!!document.querySelector('.app-loading-screen--before-app-load');if(typeof window.startApp==='function'&&!splash&&text.trim())return {bridge:true,text:text.slice(0,2000),splash};await new Promise(r=>setTimeout(r,100));}return {context:!!window.SignalContext,text:document.body.innerText.slice(0,2000),html:document.querySelector('#app-container')?.innerHTML.slice(0,2500),splash:!!document.querySelector('.app-loading-screen--before-app-load')};})()`);
    console.log('Signal view state', accountId, JSON.stringify(state));
    if (entry.errors?.length) console.error('Signal stack errors', JSON.stringify(entry.errors));
    assert.ok(!state.splash, 'Signal renderer must advance past its initial splash');
    assert.equal(state.bridge, true, 'Signal preload must expose its real startApp bridge');
    assert.ok(state.text.trim(), 'Signal must render an actual installer or conversation UI');
    report.checks.push(accountId + ': real Signal renderer initialized in a host view');
    view.setVisible(false);
  }
  assert.equal(BrowserWindow.getAllWindows().length, 1, 'No independent Signal window may be created');
  assert.equal(report.errors.length, 0, 'No unhandled renderer or preload errors');
  assert.equal(views.length, 2);
  assert.notEqual(views[0].webContents.session, views[1].webContents.session);
  report.checks.push('two isolated views inside one host window; no legacy desktop main loaded');
}
app.whenReady().then(run).then(async () => {
  console.log('PASS Signal embedded UI: ' + JSON.stringify(report));
  for (const view of views) if (!view.webContents.isDestroyed()) view.webContents.close();
  await runtime.closeAll();
  win?.destroy();
  await fs.rm(directory, { recursive: true, force: true }); app.exit(0);
}, async error => {
  console.error(error, JSON.stringify(report));
  for (const view of views) if (!view.webContents.isDestroyed()) view.webContents.close();
  if (runtime) await runtime.closeAll(); win?.destroy(); app.exit(1);
});
