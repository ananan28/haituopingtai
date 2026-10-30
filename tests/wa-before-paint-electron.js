'use strict';
// Real Electron, native SQLite, isolated preload and CDP main-world insertion
// hooks. All chats/models here are explicitly local fixtures, not real accounts.
const {app,BrowserWindow,WebContentsView,ipcMain,session,contentTracing}=require('electron');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {TranslationStore,sourceHash}=require('../src/translation-store');
const {storageToken}=require('../src/channel-identity');const {register}=require('../src/wa-ipc');const hooks=require('../src/wa-dom-hook');
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'ht-wa-frames-'));
const out=path.resolve('artifacts/whatsapp');fs.mkdirSync(out,{recursive:true});app.setPath('userData',path.join(dir,'app'));
const identity={scope:'server:local-fixture',accountIds:['port:a','port:b'],demo:false,local:false};
const bindings=new Map(),views=[];let win,store,modelCalls=0;const preloadErrors=[];
let stage='startup';const watchdog=setTimeout(()=>{console.error('WA test timed out at '+stage);app.exit(1);},60000);watchdog.unref();
const account=port=>storageToken(identity.scope,'wa-account',port);
const address=port=>({accountId:account(port),platform:'whatsapp',portId:port,chatId:'123@c.us',lang:'zh-CN'});
const bubble=(text,id,dir='in')=>`<div data-id="false_123@c.us_${id}"><div class="message-${dir}"><div data-pre-plain-text="[10:01] Alice:"><span class="selectable-text">${text}</span></div></div></div>`;
function html(port){return `<!doctype html><html><head><style>body{background:#121923;color:#edf1f7;font:16px sans-serif;margin:16px}.message-in,.message-out{padding:12px;margin:8px;background:#26334a;border-radius:9px;max-width:540px}h2{color:#b8a5ff}.message-out{margin-left:90px;background:#4b387b}</style></head><body><h2>海拓商业版 · 本地夹具 / LOCAL FIXTURE</h2><p>非真实账号 · 本机数据库与绘制前缓存验证</p><div id="main" data-chat-id="123@c.us"></div><script>
window.samples=[];window.expectedPrefix=${JSON.stringify(port==='port:a'?'译文：':'账号B：')};
window.markup=${bubble.toString()};
window.make=(text,id,dir='in')=>{const wrapper=document.createElement('div');wrapper.innerHTML=window.markup(text,id,dir);return wrapper.firstElementChild;};
window.sample=(kind='sync')=>{let bare=0,duplicates=0;for(const n of document.querySelectorAll('.message-in,.message-out')){const text=n.querySelector('.selectable-text')?.textContent;if(!/^Message \\d+$/.test(text||''))continue;
 const slots=n.querySelectorAll('[data-ht-slot]');if(slots.length!==1)duplicates++;if(slots[0]?.dataset.htState!=='hit'||slots[0]?.textContent!==window.expectedPrefix+text)bare++;}
 window.samples.push({kind,time:performance.now(),bare,duplicates});};
window.live=true;function frame(){if(!window.live)return;window.sample('raf');requestAnimationFrame(frame);}requestAnimationFrame(frame);
document.querySelector('#main').appendChild(window.make('Message 0','initial'));
window.syncInitial=document.querySelector('[data-ht-slot]')?.textContent;
</script></body></html>`;}
async function wait(wc,expression){const end=Date.now()+15000;while(Date.now()<end){if(await wc.executeJavaScript(expression))return;await new Promise(r=>setTimeout(r,25));}throw Error('Timeout: '+expression);}
async function create(port){
  const s=session.fromPartition('ht-wa-frame-'+port+Date.now());s.protocol.handle('https',r=>{
    assert.equal(new URL(r.url).origin,'https://web.whatsapp.com');return new Response(html(port),{headers:{'content-type':'text/html; charset=utf-8'}});
  });
  const view=new WebContentsView({webPreferences:{session:s,preload:path.join(__dirname,'../src/wa-preload.js'),contextIsolation:true,nodeIntegration:false,sandbox:false,backgroundThrottling:false,offscreen:true}});
  views.push(view);win.contentView.addChildView(view);view.setBounds({x:port==='port:a'?0:640,y:0,width:640,height:820});
  const wc=view.webContents;bindings.set(wc.id,{view,accountId:port,scope:identity.scope,channel:'whatsapp'});
  wc.on('preload-error',(_e,_file,error)=>{preloadErrors.push(String(error));console.error('WA preload error',error);});wc.setWindowOpenHandler(()=>({action:'deny'}));
  wc.on('console-message',details=>{if(details.level==='error')console.error('WA page error',details.message);});
  wc.on('did-start-navigation',()=>store.flush());wc.on('destroyed',()=>bindings.delete(wc.id));
  stage=port+':hooks';console.log('WA fixture hook setup: '+port);await hooks.install(wc);
  stage=port+':navigation';console.log('WA fixture navigation: '+port);await wc.loadURL('https://web.whatsapp.com/');
  stage=port+':initial-check';await wait(wc,'window.syncInitial !== undefined');
  console.log('WA fixture initialized: '+port+', offscreen='+wc.isOffscreen());
  return wc;
}
app.whenReady().then(async()=>{
  stage='seed';console.log('WA fixture: preparing local store');
  store=new TranslationStore(path.join(app.getPath('userData'),'translation-cache.db'));
  for(const port of ['port:a','port:b'])for(let i=0;i<1000;i++){
    const text='Message '+i;store.put({...address(port),sourceText:text,sourceRevision:sourceHash(text),answer:(port==='port:a'?'译文：':'账号B：')+text});
  }
  store.putSentSource({...address('port:a'),sentKey:'原始中文',sourceText:'原始中文',sentText:'Already sent English'});store.flush();
  const access={current:()=>identity,revision:()=>1,can:()=>true,onChange(){},authorize:async()=>({ok:true})};
  register({app,ipcMain,store,access,resolve:event=>{const entry=bindings.get(event?.sender?.id);
    if(!entry||event.sender!==entry.view.webContents||event.senderFrame!==event.sender.mainFrame)return null;
    try{return new URL(event.senderFrame.url).origin==='https://web.whatsapp.com'?entry:null;}catch{return null;}},
    translator:{translate:async v=>{modelCalls++;await new Promise(r=>setTimeout(r,300));return{text:'首次译文：'+v.question};}}});
  win=new BrowserWindow({show:false,width:1280,height:820,webPreferences:{offscreen:true,backgroundThrottling:false}});win.setSize(1280,820);
  stage='tracing';console.log('WA fixture: starting trace');
  await contentTracing.startRecording({included_categories:['devtools.timeline','blink','cc','disabled-by-default-devtools.screenshot'],recording_mode:'record-until-full'});
  stage='first-view';console.log('WA fixture: creating views');
  const a=await create('port:a'),b=await create('port:b');
  assert.equal(await a.executeJavaScript('window.syncInitial'),'译文：Message 0');
  assert.equal(await b.executeJavaScript('window.syncInitial'),'账号B：Message 0');assert.equal(modelCalls,0);
  stage='1000-message-frames';const methods=await a.executeJavaScript(`(async()=>{
    const main=document.querySelector('#main'),checks=[];
    const verify=name=>{window.sample();const s=window.samples.at(-1);if(s.bare||s.duplicates)throw Error(name+JSON.stringify(s));checks.push(name);};
    const clear=()=>main.replaceChildren();
    clear();main.appendChild(make('Message 1','a'));verify('appendChild');
    clear();main.insertBefore(make('Message 2','b'),null);verify('insertBefore');
    main.replaceChild(make('Message 3','c'),main.firstElementChild);verify('replaceChild');
    main.replaceChildren(make('Message 4','d'));verify('replaceChildren');
    clear();main.append(make('Message 5','e'));verify('append');
    main.prepend(make('Message 6','f'));verify('prepend');
    main.firstElementChild.before(make('Message 7','g'));verify('before');
    main.firstElementChild.after(make('Message 8','h'));verify('after');
    main.firstElementChild.replaceWith(make('Message 9','i'));verify('replaceWith');
    const fragment=document.createDocumentFragment();fragment.append(make('Message 10','j'));main.replaceChildren(fragment);verify('DocumentFragment');
    const range=document.createRange();range.selectNodeContents(main);range.collapse(false);range.insertNode(make('Message 11','k'));verify('Range.insertNode');
    let text=main.querySelector('.selectable-text');text.textContent='Message 12';verify('textContent');
    text.firstChild.nodeValue='Message 13';verify('nodeValue');text.firstChild.data='Message 14';verify('data');
    main.innerHTML=markup('Message 15','l');verify('innerHTML');
    main.firstElementChild.outerHTML=markup('Message 16','m');verify('outerHTML');
    main.insertAdjacentHTML('beforeend',markup('Message 17','n'));verify('insertAdjacentHTML');
    // 1000 content keys, changing IDs, a 20-message virtualized viewport.
    for(let start=0;start<1000;start+=10){const f=document.createDocumentFragment();for(let i=start;i<Math.min(1000,start+20);i++)f.append(make('Message '+i,'virtual-'+i));main.replaceChildren(f);verify('virtual-'+start);await new Promise(requestAnimationFrame);}
    return checks;
  })()`);
  assert.equal(modelCalls,0,'Cached 1000-message traversal must never call translation');
  fs.writeFileSync(path.join(out,'cached-bubbles.png'),(await a.capturePage()).toPNG());
  const copy=await a.executeJavaScript(`(()=>{const node=document.querySelector('.message-in');const r=document.createRange();r.selectNodeContents(node);const s=getSelection();s.removeAllRanges();s.addRange(r);const data=new DataTransfer();const e=new ClipboardEvent('copy',{bubbles:true,cancelable:true,clipboardData:data});node.dispatchEvent(e);return data.getData('text/plain');})()`);
  assert.ok(copy.includes('Message'));assert.ok(!copy.includes('译文：'));
  await a.executeJavaScript(`document.querySelector('#main').replaceChildren(make('Fresh source','new'));`);
  assert.equal(await a.executeJavaScript(`Boolean(document.querySelector('[data-ht-slot] svg circle[stroke-dasharray="42 15"]'))`),true);
  fs.writeFileSync(path.join(out,'inline-spinner.png'),(await a.capturePage()).toPNG());
  await wait(a,`document.querySelector('[data-ht-state="hit"]')?.textContent === '首次译文：Fresh source'`);assert.equal(modelCalls,1);
  fs.writeFileSync(path.join(out,'first-translation.png'),(await a.capturePage()).toPNG());
  await a.executeJavaScript(`document.querySelector('#main').replaceChildren(make('Already sent English','out','out'));`);
  await wait(a,`document.querySelector('[data-ht-slot]')?.textContent === '原文：原始中文'`);assert.equal(modelCalls,1);
  const samples=await a.executeJavaScript('window.live=false;window.samples');const rafSamples=samples.filter(s=>s.kind==='raf');assert.ok(rafSamples.length>=100);assert.ok(samples.every(s=>s.bare===0&&s.duplicates===0));
  store.flush();store.close();const finish=new Promise(resolve=>a.once('did-finish-load',resolve));a.reload();await finish;
  assert.equal(await a.executeJavaScript('window.syncInitial'),'译文：Message 0');assert.equal(modelCalls,1);
  await a.executeJavaScript(`document.querySelector('#main').replaceChildren(make('Fresh source','reopened'));`);
  await wait(a,`document.querySelector('[data-ht-slot]')?.textContent === '首次译文：Fresh source'`);assert.equal(modelCalls,1);
  assert.deepEqual(preloadErrors,[]);
  const trace=await contentTracing.stopRecording(path.join(out,'before-paint-trace.json'));
  const evidence={environment:'LOCAL FIXTURE, NOT REAL WHATSAPP ACCOUNT',electron:process.versions.electron,methods,samples,modelCalls,
    rafSamples:rafSamples.length,cachedModelCalls:0,preloadErrors,trace:path.basename(trace),realAccount:'UNTESTED',realOfflineHistory:'UNTESTED',realForwardQuoteSearch:'UNTESTED'};
  fs.writeFileSync(path.join(out,'frame-evidence.json'),JSON.stringify(evidence,null,2));
  console.log('PASS WA before-paint local fixture: '+methods.length+' insertion checks, '+rafSamples.length+' rAF samples, zero bare/duplicate cached frames, zero cached model calls; cold reload, isolated accounts, sent-source and copy checks. Real account UNTESTED.');
  for(const v of views)v.webContents.close();win.destroy();store.close();app.exit(0);
}).catch(async error=>{console.error(error);try{await contentTracing.stopRecording(path.join(out,'failure-trace.json'));}catch{}
  try{for(const v of views)if(!v.webContents.isDestroyed())v.webContents.close();win?.destroy();store?.close();}catch{}app.exit(1);});
