'use strict';
const path=require('node:path');
const {storageToken}=require('./channel-identity');
const {init,sourceHash}=require('./translation-store');
function register({app,ipcMain,access,resolve,store=init(app),translator=null}){
  const translate=translator || require('../platform-translation').createTranslator({access,getClient:()=>require('../auth').getClient()});
  const imported=new WeakSet();
  function context(event,value={}){
    const entry=resolve(event),identity=access.current();
    if(!entry||!identity||identity.demo||!access.can('account')||identity.scope!==entry.scope||!identity.accountIds?.includes(entry.accountId)
      ||!['whatsapp','whatsapp-pure','whatsapp-business'].includes(entry.channel))throw new Error('Port denied');
    if(!value||typeof value!=='object'||['accountId','platform','scope','portId'].some(k=>Object.hasOwn(value,k)))throw new Error('Renderer identity rejected');
    const address={accountId:storageToken(identity.scope,'wa-account',entry.accountId),platform:entry.channel,portId:entry.accountId};
    if(!imported.has(entry)){
      store.importLegacy(address,path.join(app.getPath('userData'),'translation-cache',storageToken(entry.scope,entry.channel,entry.accountId)+'.sqlite'));
      imported.add(entry);
    }
    return{entry,address,revision:access.revision()};
  }
  function snapshot(event,value={}){
    const c=context(event,value);return{ok:true,...store.loadSnapshot({...value,...c.address}),lang:'zh-CN'};
  }
  const operations={
    'translation:cache:load':snapshot,
    'translation:cache:get':(event,value)=>{const c=context(event,value);return{ok:true,row:store.get({...value,...c.address})};},
    'translation:cache:put':(event,value)=>{const c=context(event,value);store.put({...value,...c.address});store.flush();return{ok:true,row:store.get({...value,...c.address,sourceHash:value.sourceRevision})};},
    'translation:cache:hit':(event,value)=>{const c=context(event,value);store.hit({...value,...c.address});return{ok:true};},
    'translation:sent:get':(event,value)=>{const c=context(event,value);return{ok:true,row:store.getSentSource({...value,...c.address})};},
    'translation:sent:put':(event,value)=>{const c=context(event,value);const row=store.putSentSource({...value,...c.address});store.flush();return{ok:true,row};},
    'translation:flush':(event,value)=>{context(event,value);store.flush();return{ok:true};}
  };
  for(const [name,fn]of Object.entries(operations))ipcMain.handle(name,async(event,value)=>{
    try{return fn(event,value);}catch{return{ok:false,error:'此端口的译文缓存操作失败'};}
  });
  // Hydrate synchronously in preload, before any page script or first paint.
  ipcMain.on('translation:cache:load',(event,value)=>{
    try{event.returnValue=snapshot(event,value);}catch{event.returnValue={ok:false,rows:[],sent:[],error:'缓存预热失败'};}
  });
  for(const name of ['translation:flush','translation:cache:hit'])ipcMain.on(name,(event,value)=>{try{operations[name](event,value);}catch{}});
  ipcMain.handle('translation:request',async(event,value)=>{
    try{
      const c=context(event,value);
      if(typeof value.sourceText!=='string'||value.sourceText.length>100000||!value.sourceText||sourceHash(value.sourceText)!==value.sourceRevision)throw new Error('Revision mismatch');
      const old=store.get({...value,...c.address,sourceHash:value.sourceRevision});
      if(old)return{ok:true,row:old}; // Cached requests never reach a model.
      if(access.current().local||!access.can('translate'))throw new Error('Translation denied');
      const verdict=await access.authorize('translate');
      const valid=()=>access.revision()===c.revision&&access.current()?.scope===c.entry.scope&&resolve(event)===c.entry&&access.can('translate');
      if(!verdict.ok||!valid())throw new Error('Identity changed');
      const input={accountId:c.entry.accountId,scope:c.entry.scope,conversationId:value.chatId,question:value.sourceText,
        language:value.lang,messageId:value.messageId||'',metadata:value.metadata||''};
      const result=await(typeof translate==='function'?translate(input):translate.translate(input));
      if(!valid())throw new Error('Identity changed');
      store.put({...value,...c.address,answer:result.text});
      // A success is acknowledged only after an atomic local commit. Debounce
      // remains for hit metadata; completed paid translations are not at risk
      // in a two-second pending buffer.
      store.flush();
      return{ok:true,row:store.get({...value,...c.address,sourceHash:value.sourceRevision})};
    }catch{return{ok:false,error:'翻译失败，请重试或检查字符额度'};}
  });
  access.onChange(()=>store.flush());app.on('before-quit',()=>store.flush());
  return store;
}
module.exports={register};
