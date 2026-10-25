'use strict';
// Host-owned Signal services. Never load the former desktop application's main
// entrypoint, window manager, updater, child-process launcher or global SQL client.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const ROOT = __dirname;
const read = file => JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
const config = { ...read('config/default.json'), ...read('config/production.json'), ...read('config/local-production.json') };
const signalPackage = read('package.json');
// Use bundled canonical names when the optional localized download is unavailable.
// Chat startup must not depend on an extra emoji-index HTTP request.
const emojiIndex = Buffer.from(JSON.stringify(Object.entries(read('build/emoji-data.json').emojis).map(([emoji, item], rank) => ({
  emoji, shortName: item.shortName, rank, tags: [...new Set([item.shortName, ...item.shortName.split('_'), ...(item.shortNameAlts || []), ...(item.emoticon ? [item.emoticon] : []), ...(item.emoticonAlts || [])])]
}))));
let mounted = false;

function mount({ electron, runtime, profiles, access }) {
  if (mounted) return;
  const { app, ipcMain, nativeTheme, clipboard, systemPreferences } = electron;
  const senderEntry = event => {
    const identity = access.current();
    if (!event?.senderFrame || event.senderFrame !== event.sender?.mainFrame || !identity || identity.demo || !access.can('account')) throw new Error('Signal sender denied');
    const url = event.senderFrame.url;
    if (url && url !== pathToFileURL(path.join(ROOT, 'background.html')).href) throw new Error('Signal frame denied');
    const profile = profiles.profileForWebContents(event.sender);
    const entry = runtime.entries.get(profile);
    if (!entry || entry.scope !== identity.scope || !identity.accountIds.includes(entry.accountId)) throw new Error('Signal account denied');
    runtime.client(profile); // Unknown, closed and initializing profiles never fall back to another account.
    return entry;
  };
  const sync = (name, fn) => ipcMain.on(name, event => {
    try { const entry = senderEntry(event); event.returnValue = fn(entry, event); }
    catch { event.returnValue = null; }
  });
  const handle = (name, fn) => ipcMain.handle(name, async (event, ...args) => {
    const entry = senderEntry(event);
    const generation = access.revision();
    const result = await fn(entry, event, ...args);
    if (generation !== access.revision() || runtime.entries.get(entry.profile) !== entry) throw new Error('Signal identity changed');
    return result;
  });
  const on = (name, fn) => ipcMain.on(name, (event, ...args) => {
    try { fn(senderEntry(event), event, ...args); } catch { /* Unbound renderer cannot affect host state. */ }
  });
  sync('native-theme:init', () => ({ shouldUseDarkColors: nativeTheme.shouldUseDarkColors, shouldUseHighContrastColors: nativeTheme.shouldUseHighContrastColors }));
  nativeTheme.on('updated', () => {
    for (const wc of electron.webContents?.getAllWebContents?.() || []) {
      if (profiles.profileForWebContents(wc)) wc.send('native-theme:changed', { shouldUseDarkColors: nativeTheme.shouldUseDarkColors, shouldUseHighContrastColors: nativeTheme.shouldUseHighContrastColors });
    }
  });
  const preferredLocales = app.getPreferredSystemLanguages().flatMap(locale => {
    try { return Intl.getCanonicalLocales(locale.replace(/_/g, '-')); } catch { return []; }
  });
  sync('get-config', entry => ({
    ...config, name: 'Signal', version: signalPackage.version,
    availableLocales: read('build/available-locales.json'), resolvedTranslationsLocale: 'en',
    resolvedTranslationsLocaleDirection: 'ltr', hourCyclePreference: 'h23',
    preferredSystemLocales: preferredLocales.length ? preferredLocales : ['en'], localeOverride: null,
    environment: 'production', isMockTestEnvironment: false, ciMode: false, ciForceUnprocessed: false,
    devTools: false, dnsFallback: read('build/dns-fallback.json'), disableIPv6: false,
    disableScreenSecurity: false, nodeVersion: process.versions.node,
    hostname: os.hostname(), osRelease: os.release(), osVersion: os.version(),
    proxyUrl: undefined, cdnUrl0: config.cdn['0'], cdnUrl2: config.cdn['2'], cdnUrl3: config.cdn['3'],
    reducedMotionSetting: false, theme: nativeTheme.shouldUseDarkColors ? 'dark' : 'light',
    appStartInitialSpellcheckSetting: true, crashDumpsPath: app.getPath('crashDumps'), homePath: app.getPath('home'),
    installPath: ROOT, userDataPath: path.join(runtime.directory, entry.profile),
    isMainWindowFullScreen: false, isMainWindowMaximized: false, argv: JSON.stringify([])
  }));
  sync('locale-data', () => read('_locales/en/messages.json'));
  sync('locale-display-names', () => read('build/locale-display-names.json'));
  sync('country-display-names', () => read('build/country-display-names.json'));
  sync('get-user-data-path', entry => path.join(runtime.directory, entry.profile));
  sync('OS.getClassName', () => process.platform === 'win32' ? 'Windows' : process.platform === 'darwin' ? 'macOS' : 'Linux');

  for (const [name, method] of [['sql-channel:read', 'sqlReadSerialized'], ['sql-channel:write', 'sqlWriteSerialized']]) {
    handle(name, async (entry, _event, methodName, data) => {
      try { return { ok: true, value: await entry.client[method](methodName, data) }; }
      catch (error) { return { ok: false, error: { name: error.name, message: error.message } }; }
    });
  }
  handle('pause-sql-writes', entry => entry.client.pauseWriteAccess());
  handle('resume-sql-writes', entry => entry.client.resumeWriteAccess());
  handle('sql-channel:remove-db', async entry => { await entry.client.removeDB(); await runtime.close(entry.profile); });
  handle('erase-sql-key', () => { throw new Error('Database key deletion requires explicit account removal'); });

  const settings = ['contentProtection', 'localeOverride', 'spellCheck', 'systemTraySetting', 'themeSetting', 'mediaPermissions', 'mediaCameraPermissions'];
  for (const name of settings) {
    handle('settings:get:' + name, async entry => {
      const item = await entry.client.sqlRead('getItemById', 'haituo:setting:' + name);
      if (item) return item.value;
      if (name === 'themeSetting') return nativeTheme.shouldUseDarkColors ? 'dark' : 'light';
      if (name === 'spellCheck') return true;
      if (name === 'mediaPermissions' || name === 'mediaCameraPermissions') return false;
      return undefined;
    });
    handle('settings:set:' + name, async (entry, event, value) => {
      if (Buffer.byteLength(JSON.stringify(value ?? null)) > 4096) throw new Error('Setting too large');
      await entry.client.sqlWrite('createOrUpdateItem', { id: 'haituo:setting:' + name, value });
      event.sender.send('preferences-changed');
    });
  }
  handle('get-auto-launch', () => false);
  handle('getZoomFactor', (_entry, event) => event.sender.getZoomFactor());
  handle('getMainWindowStats', () => ({ windowCount: 1, mainWindowExists: true, mainWindowIsFullScreen: false }));
  handle('getMenuOptions', () => ({ development: false, includeSetup: true }));
  handle('get-media-access-status', (_entry, _event, type) => ['microphone', 'camera', 'screen'].includes(type) ? systemPreferences.getMediaAccessStatus(type) : 'denied');
  handle('OptionalResourceService:getData', (_entry, _event, id) => {
    if (id === 'emoji-font.woff2') return fs.readFileSync(path.join(ROOT, 'fonts/emoji.woff2'));
    if (typeof id === 'string' && /^emoji-index-[a-zA-Z-]+\.json$/.test(id)) return emojiIndex;
    throw new Error('Unknown optional Signal resource');
  });
  handle('fetch-log', () => 'Signal embedded channel');
  handle('DebugLogs.getLogs', () => 'Signal embedded channel');
  handle('crash-reports:get-count', () => 0);
  handle('windows-notifications:clear-all', () => {});
  handle('windows-notifications:show', () => { throw new Error('Notifications are managed by the platform'); });
  handle('executeMenuRole', (_entry, event, role) => {
    if (!['copy', 'cut', 'paste', 'selectAll', 'undo', 'redo'].includes(role)) throw new Error('Menu role denied');
    event.sender[role]();
  });
  on('setZoomFactor', (_entry, event, value) => { if (Number.isFinite(value) && value >= 0.5 && value <= 3) event.sender.setZoomFactor(value); });
  on('SignalClipboard.clear', () => clipboard.clear());
  on('SignalClipboard.copyTextTemporarily', (_entry, _event, text) => { if (typeof text === 'string' && text.length <= 100000) clipboard.writeText(text); });
  on('signal:renderer-error', (entry, _event, value) => {
    if (typeof value === 'string') (entry.errors ||= []).push(value.slice(0, 12000));
  });
  handle('caisheng:get-translation-config', () => ({ nativeTheme: nativeTheme.shouldUseDarkColors ? 'dark' : 'light', incomingEnabled: false, outgoingEnabled: false, autoTranslate: false }));
  handle('cleanup-orphaned-attachments', () => {});
  handle('ensure-file-permissions', async entry => {
    if (process.platform !== 'win32') await fs.promises.chmod(path.join(runtime.directory, entry.profile), 0o700);
  });
  on('signal-app-loaded', (entry, event) => { entry.appLoaded = true; event.sender.send('ci:event', 'app-loaded', {}); });
  for (const name of ['add-setup-menu-items', 'remove-setup-menu-items', 'ready-for-updates', 'start-tracking-query-stats', 'stop-tracking-query-stats', 'set-is-call-active', 'update-tray-icon', 'set-badge-count', 'set-auto-hide-menu-bar', 'set-menu-bar-visibility', 'show-window', 'title-bar-double-click', 'preferences-changed', 'draw-attention']) on(name, () => {});
  // No legacy caisheng launch/refresh IPC is registered: all account creation is host-owned.
  mounted = true;
}
module.exports = { mount };
