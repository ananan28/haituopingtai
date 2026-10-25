process.stdout.on('error', () => {});
process.stderr.on('error', () => {});
const { app, BrowserWindow, globalShortcut, clipboard } = require('electron');
const fs = require('fs');
const path = require('path');
const os = require('os');
const OUT = path.join(os.tmpdir(), 'haituo-012-preview');
fs.mkdirSync(OUT, { recursive: true });
app.disableHardwareAcceleration();
app.commandLine.appendSwitch('force-device-scale-factor', '1');
const restartIndex = process.argv.indexOf('--verify-restart');
const profile = restartIndex >= 0 ? process.argv[restartIndex + 1] : path.join(os.tmpdir(), 'haituo-012-profile-' + Date.now());
app.setPath('userData', profile);
let businessCalls = 0;
const authStub = { isConfigured: () => false, getSession: async () => ({ ok: true, user: null }), pauseRefresh() {}, resumeRefresh() {}, clearLocalSession: async () => {}, signOut: async () => ({ ok: true }), signIn: async () => ({ ok: false, error: '未配置服务器' }), signUp: async () => ({ ok: false, error: '未配置服务器' }) };
require.cache[require.resolve('./auth')] = { exports: authStub };
require.cache[require.resolve('./distribution')] = { exports: Object.fromEntries(['listStaff', 'createStaff', 'suspendStaff', 'deleteStaff', 'assignChannel', 'allocateChars', 'resetPassword', 'listAudit', 'list', 'create', 'suspend', 'remove', 'audit'].map((name) => [name, () => { businessCalls += 1; throw new Error('Unexpected real business call'); }])) };
globalShortcut.register = () => false;
clipboard.writeText = () => {};
clipboard.writeImage = () => {};
const checks = [];
const errors = [];
let win;
let focused = false;
function check(name, ok, detail) {
  checks.push({ name, ok: Boolean(ok), detail });
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail === undefined ? '' : ' ' + JSON.stringify(detail)));
}
async function js(body) {
  const result = await win.webContents.executeJavaScript('(async()=>{' + body + '})()');
  await win.webContents.executeJavaScript(`(async()=>{const deadline=Date.now()+12000;while(document.querySelector('[data-history-loading]')){if(Date.now()>deadline)throw Error('Message history load timeout');await new Promise(r=>setTimeout(r,20));}})()`);
  return result;
}
async function wait(expr, timeout = 12000) {
  await js(`const deadline=Date.now()+${timeout}; while(!(${expr})){ if(Date.now()>deadline)throw new Error(${JSON.stringify('Timeout: ' + expr)}); await new Promise(r=>setTimeout(r,60)); }`);
}
async function click(sel) { await js(`const el=document.querySelector(${JSON.stringify(sel)});if(!el)throw new Error('Missing '+${JSON.stringify(sel)});el.click();`); }
async function fill(sel, value) { await js(`const el=document.querySelector(${JSON.stringify(sel)});el.value=${JSON.stringify(value)};el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));`); }
async function shot(name) {
  await js('await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));');
  const image = await win.webContents.capturePage();
  fs.writeFileSync(path.join(OUT, name + '.png'), image.toPNG());
  const size = image.getSize();
  check('capture ' + name, !image.isEmpty() && size.width >= 1024 && size.height >= 640, size);
}
async function login(role) {
  await fill('#demo-role', role);
  await click('#demo-login');
  await wait(`HaituoAccess.get()?.role===${JSON.stringify(role)} && document.querySelector('#app-view').classList.contains('is-active')`);
}
async function logout() {
  await click('#user-trigger');
  await click('[data-user-action="logout"]');
  await wait(`!HaituoAccess.get() && document.querySelector('#auth-view').classList.contains('is-active')`);
}
async function run() {
  require('./ipc').registerIpc();
  require('./messages-ipc').init({ app, ipcMain: require('electron').ipcMain, access: require('./runtime-access') });
  // Non-Windows runners cannot enumerate Windows fonts. Keep UI rendering deterministic;
  // authorization of the production font handler is covered by runtime-security.
  if (process.platform !== 'win32') {
    const { ipcMain } = require('electron');
    ipcMain.removeHandler('system:fonts');
    ipcMain.handle('system:fonts', (event) => {
      const access = require('./runtime-access');
      return access.trusted(event) && access.can('appearance')
        ? { ok: true, fonts: ['Arial'] } : { ok: false, error: '无权限' };
    });
  }
  const pkg = require('./package.json');
  win = new BrowserWindow({ width: 1280, height: 820, frame: false, show: false, webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, offscreen: true, backgroundThrottling: false, additionalArguments: ['--haituo-brand=' + encodeURIComponent(pkg.productName), '--haituo-version=' + encodeURIComponent(pkg.version)] } });
  win.setSize(1280, 820);
  require('./runtime-access').bindWindow(win.webContents);
  win.on('focus', () => { focused = true; });
  win.webContents.on('console-message', (_e, level, message) => { if (level >= 3) errors.push(message); });
  win.webContents.on('render-process-gone', (_e, detail) => errors.push(JSON.stringify(detail)));
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  require('./app-settings').registerIpc();
  require('./screenshot').init({ getMainWindow: () => win });
  require('./src/webchannels').init({ getMainWindow: () => win });
  require('./signal/channel').init({ getMainWindow: () => win });
  await win.loadFile(path.join(__dirname, 'src', 'index.html'));
  await wait(`!document.querySelector('#demo-login').disabled && typeof HaituoStudio.resetSession==='function'`);
  check('startup enters explicit offline owner preview', await js(`return HaituoAccess.get()?.demo===true&&HaituoAccess.get()?.role==='owner'&&document.querySelector('#app-view').classList.contains('is-active');`));
  await logout();
  if (restartIndex >= 0) {
    check('restart sign-out clears preview identity', await js(`return !HaituoAccess.get()&&document.querySelector('#auth-view').classList.contains('is-active');`));
    await login('user');
    await js(`selectAccount('demo:wa-lea');`);
    await wait(`getComputedStyle(document.querySelector('.em-bubble')).fontFamily.includes('Arial')`);
    check('process restart preserves merchant draft and colors', await js(`return document.querySelector('#em-input').value.includes('retained draft')&&getComputedStyle(document.querySelector('.em-bubble')).backgroundColor==='rgb(34, 51, 68)';`));
    await logout(); await login('staff'); await js(`selectAccount('demo:wa-lea');`);
    check('process restart preserves staff draft separately', await js(`return document.querySelector('#em-input').value==='staff-only draft'&&getComputedStyle(document.querySelector('.em-bubble')).backgroundColor!=='rgb(34, 51, 68)';`));
    check('restart remains hidden and offline', !focused && !win.isVisible() && businessCalls === 0 && errors.length === 0);
    return;
  }
  check('four offline personas', await js(`return document.querySelector('#demo-role').options.length===4;`));
  check('unauthenticated provider denied', await js(`HaituoStudio.openProviderPanel();return document.querySelector('#provider-modal').hidden;`));
  await shot('01-login');
  await login('user');
  check('merchant default home', await js(`return state.view==='home' && document.querySelector('h1').textContent.includes('商户');`));
  check('merchant home links scoped to grants', await js(`return !document.querySelector('[data-platform-page="providers"]')&&!document.querySelector('[data-platform-page="announcements"]')&&!!document.querySelector('[data-platform-page="staff"]');`));
  await shot('02-merchant-home');
  check('tampered role cannot authorize route or action', await js(`state.role='owner';localStorage.setItem('role','owner');localStorage.setItem('haituo.role','owner');selectPage('permissions');HaituoStudio.openProviderPanel();openModal('provider-modal');return state.view==='home'&&document.querySelector('#provider-modal').hidden&&!HaituoAccess.can('role:manage')&&!HaituoAccess.can('providers');`));
  check('demo direct business IPC denied', await js(`const d=haituo.staff;const res=await Promise.all([d.list(),d.create({p_owner:'x',p_email:'a@example.invalid',p_password:'123456',p_channels:[],p_quota:0,p_note:''}),d.suspend('x'),d.remove('x'),d.assignChannel('x',[]),d.allocateChars('x',100),d.resetPassword('x','123456'),d.audit()]);return res.every(r=>!r.ok);`));
  await click('#user-trigger');
  await wait(`state.view==='me'`);
  check('personal center opens from user trigger', await js(`return state.view==='me'&&document.querySelector('#content').textContent.includes('个人中心')&&!!document.querySelector('.personal-profile')&&document.querySelector('#user-menu').hidden;`));
  await shot('17-personal-center');
  await js(`selectAccount('demo:wa-lea');`);
  await fill('#em-input', '<img src=x onerror="window.__xss=1"> retained draft');
  await click('[data-tool="home"]');
  await js(`selectAccount('demo:wa-lea');`);
  check('home retains selected account and draft', await js(`return state.activeId==='demo:wa-lea' && document.querySelector('#em-input').value.includes('retained draft') && !window.__xss;`));
  await js(`selectPage('appearance');`);
  await wait(`document.querySelector('#appearance-font').options.length>1`, 15000);
  check('installed fonts enumerated', await js(`return document.querySelector('#appearance-font').options.length>1;`));
  await fill('#appearance-account', 'demo:wa-lea');
  await fill('#appearance-font', 'Arial');
  await fill('#appearance-size', '18');
  await fill('#appearance-incoming', '#223344');
  await fill('#appearance-outgoing', '#654321');
  await fill('#appearance-text', '#fefefe');
  await fill('#appearance-translation', '#abcdef');
  await click('#appearance-save');
  check('valid appearance saves', await js(`return document.querySelector('#appearance-status').textContent.includes('已保存');`));
  await shot('03-appearance');
  await fill('#appearance-outgoing', 'url(x)');
  await click('#appearance-save');
  check('color injection rejected', await js(`return document.querySelector('#appearance-status').textContent.includes('保存失败') && HaituoPlatform.read('appearance',{},'demo:wa-lea').outgoing==='#654321';`));
  await fill('#appearance-outgoing', '#654321');
  await js(`const o=document.createElement('option');o.value='Arial; background:url(x)';o.textContent=o.value;document.querySelector('#appearance-font').appendChild(o);document.querySelector('#appearance-font').value=o.value;`);
  await click('#appearance-save');
  check('forged font rejected', await js(`return document.querySelector('#appearance-status').textContent.includes('保存失败');`));
  await js(`selectAccount('demo:wa-lea');`);
  check('appearance affects actual conversation', await js(`const b=getComputedStyle(document.querySelector('.em-bubble'));return b.backgroundColor==='rgb(34, 51, 68)'&&b.fontSize==='18px'&&b.fontFamily.includes('Arial');`));
  await shot('04-custom-conversation');
  await fill('#em-input', 'persisted bilingual message 90817');
  await click('.em-send');
  await wait(`document.querySelector('.em-messages').textContent.includes('persisted bilingual message 90817')`);
  check('outgoing message is persisted with its translation in one record', await js(`const r=await haituo.messages.list({accountId:'demo:wa-lea',channel:'whatsapp',conversationId:'demo-conversation'});return r.ok&&r.records.some(m=>m.body==='persisted bilingual message 90817'&&m.translation?.text);`));
  await js(`selectPage('home');selectAccount('demo:wa-lea');`);
  check('reopening conversation restores one bilingual message without duplicate rows', await js(`const rows=[...document.querySelectorAll('[data-message-id]')].filter(e=>e.querySelector('.em-bubble')?.textContent==='persisted bilingual message 90817');return rows.length===1&&!!rows[0].querySelector('.em-tr');`));
  await fill('#em-input', '<img src=x onerror="window.__xss=1"> retained draft');

  await js(`selectPage('appearance');`);
  await wait(`document.querySelector('#appearance-font').options.length>1`);
  await fill('#appearance-account', 'demo:tg-chen');
  await fill('#appearance-incoming', '#334455');
  await click('#appearance-save');
  check('appearance independent between accounts', await js(`return HaituoPlatform.read('appearance',{},'demo:wa-lea').incoming==='#223344'&&HaituoPlatform.read('appearance',{},'demo:tg-chen').incoming==='#334455';`));
  await click('#appearance-reset');
  check('reset affects selected account only', await js(`return HaituoPlatform.read('appearance',{},'demo:tg-chen').incoming==='#1a1d24'&&HaituoPlatform.read('appearance',{},'demo:wa-lea').incoming==='#223344';`));
  await fill('#appearance-account', '');
  await fill('#appearance-font', 'Arial');
  await fill('#appearance-size', '16');
  await click('#appearance-save');
  check('shell typography applies', await js(`return getComputedStyle(document.querySelector('#app-view')).fontSize==='16px'&&getComputedStyle(document.querySelector('#app-view')).fontFamily.includes('Arial');`));
  await click('#appearance-reset');
  await js(`selectAccount('demo:wa-lea');openEditAccount(activeAccount());`);
  await fill('#edit-avatar', '<b>');
  await js(`editForm.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));applyMode('vertical',false);`);
  check('custom avatar overrides official artwork without HTML', await js(`return [...document.querySelectorAll('[data-account="demo:wa-lea"] .ch-tile, .em-tile')].every(e=>!e.querySelector('img')&&!e.querySelector('b')&&e.textContent.includes('<b>'));`));
  await shot('15-vertical-custom-avatar');
  await js(`openEditAccount(activeAccount());`);
  await fill('#edit-avatar', '');
  await js(`editForm.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));`);
  check('clearing custom avatar restores official artwork', await js(`return [...document.querySelectorAll('[data-channel="whatsapp"].ch-tile')].every(e=>!!e.querySelector('img'));`));
  await js(`applyMode('horizontal',false);window.__departingInput=document.querySelector('#em-input');selectPage('recharge');`);
  check('payments disabled no fake orders', await js(`return [...document.querySelectorAll('.platform-packages button')].every(b=>b.disabled)&&document.querySelector('#content').textContent.includes('暂无真实订单')&&!document.querySelector('#content').textContent.includes('已到账');`));
  await shot('05-recharge');
  await js(`openCatalog();`);
  check('full channel catalog', await js(`return document.querySelectorAll('.cat-card').length===38;`));
  if (await js(`return !!window.HaituoChannelIcons;`)) {
    await wait(`[...document.querySelectorAll('#catalog-grid img')].every(i=>i.complete)`);
    check('all local official icons decode', await js(`return [...document.querySelectorAll('#catalog-grid img')].every(i=>i.naturalWidth>0);`));
    check('K A distinction retained', await js(`return document.querySelector('[data-channel-id="telegram-k"]').textContent.includes('K')&&document.querySelector('[data-channel-id="telegram-a"]').textContent.includes('A');`));
    check('retired channel explicit', await js(`return document.querySelector('[data-channel-id="skype"]').textContent.includes('停运');`));
  }
  await shot('06-catalog');
  await js(`openConfig(CATALOG.find(c=>c.id==='custom'));`);
  await fill('#cfg-url', 'javascript:alert(1)');
  await js(`channelForm.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));`);
  check('URL script rejected', await js(`return !document.querySelector('#channel-config').hidden && JSON.parse(readStorage(STORAGE.drafts,'[]')).length===0;`));
  await fill('#cfg-url', 'https://example.invalid/service');
  await js(`channelForm.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true}));`);
  check('valid URL saves draft only', await js(`return document.querySelector('#channel-config').hidden&&state.accounts.length===4&&JSON.parse(readStorage(STORAGE.drafts,'[]')).length===1;`));
  await js(`HaituoStudio.openDemoStudio('translate');`);
  await wait(`HaituoStudio.getState().shots===1&&HaituoStudio.getState().chars>0`);
  check('screenshot has 12 tool groups including history', await js(`return HAITUO_SCREENSHOT.tools.length===12&&HAITUO_SCREENSHOT.tools.filter(t=>t.id!=='history').every(t=>document.querySelector('[data-shot-tool="'+t.id+'"]'))&&!!document.querySelector('[data-undo]')&&!!document.querySelector('[data-redo]');`));
  await shot('07-screenshot');
  await js(`window.__draw=(x,y,endX=x,endY=y)=>{const c=document.querySelector('#shot-canvas');const r=c.getBoundingClientRect();for(const [type,px,py] of [['pointerdown',x,y],['pointermove',endX,endY],['pointerup',endX,endY]]) c.dispatchEvent(new PointerEvent(type,{bubbles:true,button:0,pointerId:9,clientX:r.left+px*r.width,clientY:r.top+py*r.height}));};`);
  for (const tool of ['pen','highlighter','arrow','rect','rounded','ellipse','number','pointer']) {
    await click('[data-shot-tool="' + tool + '"]');
    check('draw ' + tool, await js(`const n=HaituoStudio.getState().strokes;__draw(.15,.15,.4,.4);return HaituoStudio.getState().strokes===n+1&&HaituoStudio.getState().types.includes(${JSON.stringify(tool)});`));
  }
  await click('[data-undo]');
  check('undo removes latest mark', await js(`return HaituoStudio.getState().strokes===7;`));
  await click('[data-redo]');
  check('redo restores latest mark', await js(`return HaituoStudio.getState().strokes===8;`));
  await click('[data-shot-tool="text"]');
  await js(`__draw(.5,.5);`);
  await fill('#shot-text-input', 'Annotation <b>');
  await js(`document.querySelector('#shot-text-input').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));`);
  check('canvas text annotation', await js(`return HaituoStudio.getState().types.includes('text')&&!document.querySelector('#shot-stage b');`));
  await click('[data-shot-tool="mosaic"]');
  await click('[data-mosaic-mode="region"]');
  await js(`__draw(.65,.65,.85,.85);`);
  check('region mosaic is grayscale', await js(`const c=document.querySelector('#shot-canvas');const p=c.getContext('2d').getImageData(Math.floor(c.width*.75),Math.floor(c.height*.75),1,1).data;return HaituoStudio.getState().types.includes('mosaic')&&p[0]===p[1]&&p[1]===p[2];`));
  await click('[data-shot-tool="eraser"]');
  check('eraser removes annotation', await js(`const n=HaituoStudio.getState().strokes;__draw(.15,.15);return HaituoStudio.getState().strokes<n;`));
  await click('[data-undo]');
  check('eraser undo restores annotations', await js(`return HaituoStudio.getState().strokes===10;`));
  check('invalid image cannot enter studio', await js(`const n=HaituoStudio.getState().shots;const result=HaituoStudio.openStudio({image:'data:image/svg+xml,<svg onload="alert(1)"/>'});return result===false&&HaituoStudio.getState().shots===n;`));
  await shot('16-screenshot-annotations');
  await logout();
  check('logout clears studio and cached content', await js(`return HaituoStudio.getState().shots===0&&HaituoStudio.getUsage().chars===0&&document.querySelector('#content').children.length===0&&document.querySelector('#shot-canvas').width===0;`));
  await login('staff');
  check('staff assigned one account', await js(`return state.accounts.length===1&&state.accounts[0].id==='demo:wa-lea';`));
  check('staff page denied without staff:manage', await js(`selectPage('staff');return state.view==='home';`));
  check('departed composer cannot write new identity draft', await js(`__departingInput.value='STALE PRIVATE DRAFT';__departingInput.dispatchEvent(new Event('input',{bubbles:true}));return HaituoPlatform.read('draft','','demo:wa-lea')==='';`));
  check('staff recharge screenshot providers denied', await js(`selectPage('recharge');selectAccount('demo:tg-chen');HaituoStudio.openDemoStudio('translate');return state.view==='home'&&state.activeId==='demo:wa-lea'&&!HaituoStudio.isOpen()&&!HaituoAccess.can('providers');`));
  check('staff direct screenshot OCR IPC denied', await js(`const a=await haituo.screenshot.start('translate');const b=await haituo.ocr.recognize('data:image/png;base64,AA==');return !a.ok&&!b.ok;`));
  check('staff storage cannot read unassigned account', await js(`return HaituoPlatform.write('draft','forbidden','demo:tg-chen')===false&&HaituoPlatform.read('draft',null,'demo:tg-chen')===null;`));
  await shot('08-staff-home');
  await js(`selectPage('usage');`);
  check('staff quota consistent', await js(`return document.querySelector('#content').textContent.includes('50,000')&&document.querySelector('#content').textContent.includes('46,800')&&quotaFor(state.accounts[0]).total===50000;`));
  await shot('09-staff-quota');
  await js(`selectAccount('demo:wa-lea');`);
  check('merchant draft and colors isolated from staff', await js(`return document.querySelector('#em-input').value===''&&getComputedStyle(document.querySelector('.em-bubble')).backgroundColor!=='rgb(34, 51, 68)';`));
  await fill('#em-input', 'staff-only draft');
  await logout();
  await login('admin');
  check('admin grant matrix', await js(`return HaituoAccess.can('announcements')&&HaituoAccess.can('staff:manage')&&HaituoAccess.can('audit:read')&&!HaituoAccess.can('role:manage');`));
  await js(`selectPage('announcements');`);
  await fill('#announcement-draft', '<img src=x onerror="window.__xss=1">');
  await click('#announcement-save');
  check('announcement XSS escaped unpublished', await js(`return !document.querySelector('#announcement-preview img')&&!window.__xss&&document.querySelector('#announcement-status').textContent.includes('未发布');`));
  await shot('10-admin-announcement');
  check('permission center denied without role:manage', await js(`selectPage('permissions');return state.view==='announcements';`));
  await logout();
  await login('owner');
  await shot('12-owner-home');
  await js(`selectPage('staff');`);
  await wait(`state.view==='staff'`);
  check('staff management reachable for staff:manage', await js(`return state.view==='staff'&&document.querySelector('#content').textContent.includes('员工子账号');`));
  await shot('18-staff-management');
  await js(`selectPage('permissions');`);
  check('permission center owner-only reachable', await js(`return state.view==='permissions'&&document.querySelector('#content').textContent.includes('权限中心')&&document.querySelector('#content').textContent.includes('所有者');`));
  await shot('19-permission-center');
  await js(`HaituoStudio.openProviderPanel();`);
  check('owner provider preview accessible', await js(`return !document.querySelector('#provider-modal').hidden&&document.querySelector('#provider-modal').textContent.includes('未发布');`));
  await shot('13-owner-model-preview');
  await logout();
  await login('user');
  await js(`selectAccount('demo:wa-lea');`);
  check('merchant draft and appearance persist reentry', await js(`return document.querySelector('#em-input').value.includes('retained draft')&&getComputedStyle(document.querySelector('.em-bubble')).backgroundColor==='rgb(34, 51, 68)';`));
  await win.webContents.session.flushStorageData();
  await win.loadFile(path.join(__dirname, 'src', 'index.html'));
  await wait(`HaituoAccess.get()?.role==='owner'&&document.querySelector('#app-view').classList.contains('is-active')`);
  await logout();
  await login('user');
  await js(`selectAccount('demo:wa-lea');`);
  check('renderer reload retains persisted bilingual message', await js(`const row=[...document.querySelectorAll('[data-message-id]')].find(e=>e.querySelector('.em-bubble')?.textContent==='persisted bilingual message 90817');return !!row?.querySelector('.em-tr');`));
  check('renderer reload retains scoped draft', await js(`return document.querySelector('#em-input').value.includes('retained draft');`));
  await logout();
  win.setSize(1024, 640);
  check('minimum window login reachable by scroll', await js(`const c=document.querySelector('.auth-card');c.scrollTop=c.scrollHeight;const r=document.querySelector('#demo-login').getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;`));
  await shot('14-login-minimum');
  await login('owner');
  await click('[data-local-workspace]');
  await wait(`HaituoAccess.get()?.local===true&&state.accounts.length===5`);
  check('local workspace exposes real channels without server privileges', await js(`return state.accounts.every(a=>!a.demo&&a.local)&&!HaituoAccess.can('staff:manage')&&!HaituoAccess.can('recharge')&&!HaituoAccess.can('providers')&&document.querySelector('#role-badge').textContent.includes('无服务器权限');`));
  check('local workspace cannot call staff backend', await js(`const r=await haituo.staff.list();return !r.ok;`));
  await logout();
  check('zero business calls', businessCalls === 0, businessCalls);
  check('window never focused', !focused && !win.isVisible(), { focused, visible: win.isVisible() });
  check('no renderer errors', errors.length === 0, errors);
}
app.whenReady().then(run).catch((err) => { check('harness completed', false, err.stack); console.error(err.stack); }).finally(() => {
  fs.writeFileSync(path.join(OUT, restartIndex >= 0 ? 'restart-results.json' : 'results.json'), JSON.stringify({ checks, errors, businessCalls, focused, profile }, null, 2));
  console.log('RESULT ' + checks.filter(c => c.ok).length + '/' + checks.length + ' ' + OUT);
  console.log('PROFILE ' + profile);
  if (win && !win.isDestroyed()) win.destroy();
  app.exit(checks.every(c => c.ok) ? 0 : 1);
});
