'use strict';
// Real sandbox preload + Chromium DOM + SQLite. HTTPS is handled entirely by
// this isolated test session; no WhatsApp account, network or real chats used.
const { app, BrowserWindow, WebContentsView, ipcMain, session } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { TranslationCache, register } = require('../src/translation-cache');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'haituo-wa-electron-'));
app.setPath('userData', path.join(directory, 'app'));
let win, store;
const html = '<!doctype html><html><body><div id="main"><div data-id="false_123@c.us_A"><div class="message-in"><div data-pre-plain-text="[10:01] Alice:"><span class="selectable-text">Hello</span></div></div></div></div></body></html>';
async function waitFor(wc, expression) {
  const end = Date.now() + 15000;
  while (Date.now() < end) {
    if (await wc.executeJavaScript(expression)) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error('Timed out: ' + expression);
}
app.whenReady().then(async () => {
  store = new TranslationCache(path.join(directory, 'cache'));
  const identity = { scope: 'local:workspace', local: true, demo: false, accountIds: ['wa:a'] };
  const binding = { scope: identity.scope, accountId: 'wa:a', channel: 'whatsapp' };
  store.savePortTranslationCache({ ...binding, conversationId: '123@c.us', language: 'zh-CN', messageId: 'false_123@c.us_A', question: 'Hello', answer: '你好', provider: 'test-fixture' });
  const isolated = session.fromPartition('wa-cache-test-' + Date.now());
  let networkRequests = 0, reads = 0;
  isolated.protocol.handle('https', request => {
    assert.equal(new URL(request.url).origin, 'https://web.whatsapp.com');
    networkRequests++; return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
  });
  const originalLoad = store.loadPortTranslationCache.bind(store);
  store.loadPortTranslationCache = input => { reads++; return originalLoad(input); };
  win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  win.setSize(1280, 820);
  const view = new WebContentsView({ webPreferences: { session: isolated, sandbox: true, contextIsolation: true, nodeIntegration: false,
    preload: path.join(__dirname, '../src/whatsapp-cache-preload.js') } });
  win.contentView.addChildView(view); view.setBounds({ x: 0, y: 0, width: 1280, height: 820 });
  const wc = view.webContents;
  const errors = []; wc.on('preload-error', (_e, _file, error) => errors.push(String(error)));
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  register({ app, ipcMain, store, access: { current: () => identity, revision: () => 1, can: p => p === 'account',
    onChange() {}, authorize() { throw new Error('Offline cache must not authorize over network'); } },
    resolve: e => e.sender === wc && e.senderFrame === wc.mainFrame && new URL(e.senderFrame.url).origin === 'https://web.whatsapp.com' ? binding : null });
  await wc.loadURL('https://web.whatsapp.com/');
  await waitFor(wc, 'document.querySelector("[data-haituo-translation]")?.textContent === "你好"');
  assert.equal(reads, 1);
  const result = await wc.executeJavaScript(`(async () => {
    const main = document.querySelector('#main'); const source = main.innerHTML;
    main.innerHTML = source.replace(/<div data-haituo-translation[\\s\\S]*?<\\/div>/g, '');
    await Promise.resolve(); await Promise.resolve();
    return { text: main.querySelector('[data-haituo-translation]')?.textContent,
      count: main.querySelectorAll('[data-haituo-translation]').length,
      ready: main.classList.contains('translationCacheReady'), bridge: typeof window.haituo };
  })()`);
  assert.deepEqual(result, { text: '你好', count: 1, ready: true, bridge: 'undefined' });
  assert.equal(reads, 1, 'Virtualized replacement must not read disk or invoke translation');
  store.close(); // Reopen SQLite via the next preload, simulating a cold cache.
  await wc.reload();
  await waitFor(wc, 'document.querySelector("[data-haituo-translation]")?.textContent === "你好"');
  assert.equal(reads, 2); assert.deepEqual(errors, []);
  assert.equal(networkRequests, 2, 'Only fixture document loads, no translation network request');
  console.log('PASS WhatsApp real Chromium: sandbox preload, isolated SQLite cold reload, synchronous observer reattach, no page bridge or translation network.');
  wc.close(); win.destroy(); store.close(); app.exit(0);
}).catch(error => { console.error(error); try { store?.close(); win?.destroy(); } catch {} app.exit(1); });
app.on('will-quit', () => { try { fs.rmSync(directory, { recursive: true, force: true }); } catch {} });
