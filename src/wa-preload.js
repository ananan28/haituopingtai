'use strict';
const {ipcRenderer,webFrame}=require('electron');
const {mainWorldHook}=require('./wa-dom-hook');
const {createHash}=require('node:crypto');
const {PortMemory,keyFor}=require('./wa-memory');
const norm=s=>String(s||'').normalize('NFKC').replace(/\s+/gu,' ').trim();
const hash=s=>createHash('sha256').update(norm(s)).digest('hex');
const translatable=s=>Boolean(s&&s.length<=100000&&/\p{L}/u.test(s));
function install({document,window,MutationObserver,invoke,send,bootstrap={ok:true,rows:[],sent:[]},memory=new PortMemory()}){
  let root=null,chat=null,language=bootstrap.lang||'zh-CN',generation=0,busy=false,stopped=false;
  const pending=new Map(),failures=new Map(),timers=new Set(),chatLoads=new Set(),knownMissing=new Set(),sentMissing=new Set();
  function remember(snapshot){
    for(const r of snapshot.rows||[])memory.set(keyFor(r.chatId,r.lang,r.sourceHash),r);
    for(const r of snapshot.sent||[]){
      const key='sent:'+JSON.stringify([r.chatId,r.sentKey]);
      // A background snapshot refresh must not evict warmed translation rows
      // just to admit an invisible sent-source entry. Visible outgoing bubbles
      // fetch and pin their own source when needed.
      if(!memory.entries.has(key)&&memory.entries.size>=memory.maxEntries)continue;
      memory.set(key,{...r,kind:'sent'});
    }
  }
  remember(bootstrap);
  function style(){
    if(!document.documentElement||document.getElementById('ht-wa-cache-style'))return;
    const el=document.createElement('style');el.id='ht-wa-cache-style';el.textContent=`
      @keyframes ht-spin{to{transform:rotate(360deg)}}
      .ht-translation-slot{display:block;text-align:right;color:inherit;user-select:none;white-space:pre-wrap;overflow-wrap:anywhere;
        margin-top:4px;padding-top:4px;border-top:1px solid #7c5cf044;font-size:14px;line-height:1.4;visibility:visible}
      .ht-translation-slot[data-ht-state="empty"]{display:none}
      .ht-translation-slot svg{width:20px;height:20px;animation:ht-spin 1s linear infinite;vertical-align:middle}
      .ht-translation-slot button{color:inherit;font:inherit;background:transparent;border:1px solid currentColor;border-radius:4px;cursor:pointer}
      [data-ht-cache-check="1"] .selectable-text{visibility:hidden}
      [data-ht-cache-check="1"] .ht-translation-slot{visibility:visible}`;
    (document.head||document.documentElement).appendChild(el);
  }
  function describe(node){
    const body=[...node.querySelectorAll('[data-pre-plain-text]')].find(el=>!el.closest('[data-testid="quoted-message"]'));
    const texts=body?[...body.querySelectorAll('.selectable-text')].filter(t=>!t.closest('[data-ht-slot]')&&!t.closest('[data-testid="quoted-message"]')):[];
    if(!texts.length)return null;
    const source=texts.map(t=>t.textContent).join('\n'),question=norm(source);
    if(!translatable(question))return null;
    const owner=node.closest('[data-id]')||node.querySelector('[data-id]');
    return{body,source,question,hash:hash(question),messageId:owner?.getAttribute('data-id')||'',metadata:body.getAttribute('data-pre-plain-text')||'',out:node.classList.contains('message-out')};
  }
  function chatFor(list){
    const explicit=root?.getAttribute('data-chat-id')||root?.getAttribute('data-jid');if(explicit)return explicit;
    const ids=new Set(list.map(n=>describe(n)?.messageId.match(/^(?:true|false)_([^_]+)_/)?.[1]).filter(Boolean));
    return ids.size===1?[...ids][0]:null;
  }
  function slotFor(node,item){
    const slots=[...node.querySelectorAll('[data-ht-slot]')];let slot=slots.shift();slots.forEach(s=>s.remove());
    if(!slot){slot=document.createElement('div');slot.className='ht-translation-slot';slot.dataset.htSlot='1';slot.dataset.htTranslation='1';item.body.appendChild(slot);}
    if(slot.parentElement!==item.body)item.body.appendChild(slot);
    return slot;
  }
  function state(slot,value,key){slot.dataset.htState=value;slot.dataset.htKey=key;}
  function spinner(slot,value,key){
    if(slot.dataset.htState===value&&slot.dataset.htKey===key&&slot.querySelector('svg'))return;
    state(slot,value,key);const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg'),circle=document.createElementNS(ns,'circle');
    svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');
    for(const [k,v]of Object.entries({cx:12,cy:12,r:9,fill:'none',stroke:'currentColor','stroke-width':3,'stroke-dasharray':'42 15'}))circle.setAttribute(k,String(v));
    svg.appendChild(circle);slot.replaceChildren(svg);
  }
  function show(slot,record,key,sent=false){
    const value=sent?'原文：'+record.sourceText:record.answer;
    const target=value?'hit':'empty';
    if(slot.dataset.htState!==target||slot.dataset.htKey!==key||slot.textContent!==value){
      state(slot,target,key);slot.classList.toggle('translationCacheHit',target==='hit');
      const text=document.createElement('span');text.textContent=value;slot.replaceChildren(...(value?[text]:[]));
    }
  }
  function near(node){const r=node.getBoundingClientRect?.();return !r||r.height===0||r.bottom>-(window.innerHeight||820)&&r.top<2*(window.innerHeight||820);}
  function fail(key,error){
    const value=failures.get(key)||{count:0};value.count++;value.error=error;value.retryAt=Date.now()+2000;failures.set(key,value);
    if(value.count<3){const timer=setTimeout(()=>{timers.delete(timer);if(stopped)return;value.retryAt=0;scan();},2000);timers.add(timer);}
  }
  function errorSlot(slot,key,info){
    if(slot.dataset.htState==='error'&&slot.dataset.htError===String(info.count))return;
    state(slot,'error',key);slot.dataset.htError=String(info.count);
    const label=document.createElement('span');label.textContent=info.count<3&&info.retryAt>Date.now()?'翻译失败，2秒后重试 ':'翻译失败 ';
    const button=document.createElement('button');button.type='button';button.textContent='重试';button.addEventListener('click',event=>{
      event.preventDefault();event.stopPropagation();failures.delete(key);knownMissing.delete(key);slot.removeAttribute('data-ht-error');scan();
    });slot.replaceChildren(label,button);
  }
  function lookup(item,key){
    if(pending.has(key))return;
    const epoch=generation,chatId=chat,lang=language;
    const job=(async()=>{
      if(item.out&&!sentMissing.has(key)){
        const sent=await invoke('translation:sent:get',{chatId,sentKey:norm(item.source)});
        if(stopped||epoch!==generation)return;
        if(!sent.ok)throw new Error('回译缓存读取失败');
        if(sent.row){const sentKey='sent:'+JSON.stringify([chatId,sent.row.sentKey]);memory.pinned.add(sentKey);
          if(!memory.set(sentKey,{...sent.row,chatId,kind:'sent'}))throw new Error('回译缓存容量不足');return;}
        sentMissing.add(key);if(sentMissing.size>1000)sentMissing.delete(sentMissing.values().next().value);
      }
      if(!knownMissing.has(key)){
        const cached=await invoke('translation:cache:get',{chatId,lang,sourceHash:item.hash});
        if(stopped||epoch!==generation)return;
        if(!cached.ok)throw new Error(cached.error||'缓存读取失败');
        if(cached.row){if(!memory.set(key,cached.row))throw new Error('缓存容量不足');return;}
        knownMissing.add(key);
        if(knownMissing.size>1000)knownMissing.delete(knownMissing.values().next().value);
        scan();
      }
      const result=await invoke('translation:request',{chatId,lang,sourceText:item.source,sourceRevision:item.hash,messageId:item.messageId,metadata:item.metadata});
      if(stopped||epoch!==generation)return;
      if(!result.ok)throw new Error(result.error||'翻译服务暂不可用');
      if(!memory.set(key,result.row))throw new Error('缓存容量不足');
      knownMissing.delete(key);failures.delete(key);
    })();
    pending.set(key,job);job.catch(error=>{if(epoch===generation&&!stopped)fail(key,error.message);}).finally(()=>{if(pending.get(key)===job)pending.delete(key);if(epoch===generation&&!stopped)scan();});
  }
  function loadChat(id){
    const loadKey=JSON.stringify([id,language]);if(!id||chatLoads.has(loadKey))return;
    chatLoads.add(loadKey);const epoch=generation;
    invoke('translation:cache:load',{chatId:id,limit:1000}).then(result=>{
      if(stopped||epoch!==generation)return;
      if(result.ok){remember(result);scan();}else chatLoads.delete(loadKey);
    }).catch(()=>chatLoads.delete(loadKey));
  }
  function scan(){
    if(stopped||busy)return;busy=true;
    try{
      style();const next=document.querySelector('#main');root=next;
      if(!root)return;
      const nodes=[...root.querySelectorAll('.message-in,.message-out')],id=chatFor(nodes);
      if(id!==chat){chat=id;generation++;pending.clear();failures.clear();loadChat(id);}
      const descriptions=nodes.map(node=>({node,item:describe(node)}));
      memory.pin(descriptions.filter(v=>v.item&&near(v.node)).map(v=>keyFor(chat,language,v.item.hash)));
      for(const {node,item}of descriptions){
        if(!item){node.querySelectorAll('[data-ht-slot]').forEach(s=>s.remove());node.removeAttribute('data-ht-cache-check');continue;}
        const slot=slotFor(node,item),key=keyFor(chat,language,item.hash),oldKey=slot.dataset.htKey;
        const sent=item.out?memory.sent(chat,norm(item.source)):undefined;
        if(sent){node.removeAttribute('data-ht-cache-check');show(slot,sent,key,true);continue;}
        const record=memory.get(key);
        if(record&&record.sourceRevision===item.hash){
          node.removeAttribute('data-ht-cache-check');show(slot,record,key);
          if(record.id&&!record.hitReported){record.hitReported=true;send('translation:cache:hit',{chatId:chat,translationId:record.id});}
          continue;
        }
        const info=failures.get(key);
        if(info&&(info.count>=3||info.retryAt>Date.now())){node.removeAttribute('data-ht-cache-check');errorSlot(slot,key,info);continue;}
        // A cold/evicted record is checked before exposing its source, so a known
        // translated bubble can never paint as source-only while disk catches up.
        node.toggleAttribute('data-ht-cache-check',!knownMissing.has(key));
        if(node.hasAttribute('data-ht-cache-check'))node.setAttribute('data-ht-cache-check','1');
        spinner(slot,oldKey&&oldKey!==key?'stale':'unknown',key);
        if(chat&&near(node))lookup(item,key);
      }
    }finally{busy=false;}
  }
  function ownMutation(m){const el=m.target.nodeType===1?m.target:m.target.parentElement;
    return Boolean(el?.closest('[data-ht-slot]')||el?.id==='ht-wa-cache-style'
      ||m.type==='childList'&&[...m.addedNodes,...m.removedNodes].length&&[...m.addedNodes,...m.removedNodes].every(n=>n.nodeType===1&&(n.matches('[data-ht-slot]')||n.id==='ht-wa-cache-style')));}
  const observer=new MutationObserver(list=>{if(!list.every(ownMutation))scan();});
  const observe=()=>{observer.observe(document,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['data-id','data-pre-plain-text','data-chat-id','data-jid']});scan();};
  document.addEventListener('ht-wa-dom-change',scan);document.addEventListener('DOMContentLoaded',observe,{once:true});observe();
  const flush=()=>send('translation:flush',{});
  const onVisibility=()=>{if(document.visibilityState==='hidden')flush();};
  document.addEventListener('visibilitychange',onVisibility);window.addEventListener('pagehide',flush);
  window.addEventListener('scroll',scan,true);
  function copy(event){
    const selection=window.getSelection?.();if(!selection?.rangeCount||!root)return;
    const range=selection.getRangeAt(0);const common=range.commonAncestorContainer;
    if(!root.contains(common.nodeType===1?common:common.parentElement)&&!range.intersectsNode?.(root))return;
    const clone=range.cloneContents();clone.querySelectorAll('[data-ht-slot]').forEach(s=>s.remove());
    if(event.clipboardData){event.preventDefault();event.stopImmediatePropagation();event.clipboardData.setData('text/plain',clone.textContent||'');}
  }
  document.addEventListener('copy',copy,true);
  return{scan,memory,flush,
    setLanguage(lang){if(typeof lang!=='string'||!/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(lang))throw new Error('Invalid language');language=lang;generation++;pending.clear();failures.clear();loadChat(chat);scan();},
    async recordSent(value){const result=await invoke('translation:sent:put',value);if(result.ok){const key='sent:'+JSON.stringify([value.chatId,norm(value.sourceText)]);memory.pinned.add(key);memory.set(key,{...value,sentKey:norm(value.sourceText),sentText:norm(value.sentText),kind:'sent'});scan();}return result;},
    stop(){stopped=true;generation++;observer.disconnect();for(const timer of timers)clearTimeout(timer);memory.clear();flush();document.removeEventListener('ht-wa-dom-change',scan);document.removeEventListener('copy',copy,true);document.removeEventListener('visibilitychange',onVisibility);window.removeEventListener('pagehide',flush);window.removeEventListener('scroll',scan,true);}
  };
}
if(typeof window!=='undefined'&&process.isMainFrame&&location.origin==='https://web.whatsapp.com'){
  mainWorldHook();
  webFrame.executeJavaScript('('+mainWorldHook.toString()+')();').catch(()=>{});
  const bootstrap=ipcRenderer.sendSync('translation:cache:load',{});
  const api=install({document,window,MutationObserver,bootstrap,invoke:(name,value)=>ipcRenderer.invoke(name,value),send:(name,value)=>ipcRenderer.send(name,value)});
  ipcRenderer.on('translation:language',(_event,language)=>api.setLanguage(language));
  ipcRenderer.on('translation:sent:confirmed',(_event,value)=>api.recordSent(value));
}
module.exports={install,norm,hash,translatable};
