'use strict';
const test=require('node:test'),assert=require('node:assert/strict');const {EventEmitter}=require('node:events');
const {register}=require('../src/wa-ipc');const {sourceHash}=require('../src/translation-store');
function fixture(translator=null){
  const handlers=new Map(),events=new Map(),calls=[];let identity={scope:'server:a',demo:false,local:false,accountIds:['port:a']},revision=1;
  const entry={accountId:'port:a',scope:identity.scope,channel:'whatsapp'},event={};
  const store={importLegacy(){},flush(){calls.push(['flush']);},loadSnapshot:v=>{calls.push(['load',v]);return{rows:[],sent:[]};},
    get:v=>{calls.push(['get',v]);return null;},put:v=>{calls.push(['put',v]);return v;},hit:v=>calls.push(['hit',v]),
    getSentSource:()=>null,putSentSource:v=>v};
  const access={current:()=>identity,can:()=>true,revision:()=>revision,onChange(){},authorize:async()=>({ok:true})};
  register({app:Object.assign(new EventEmitter(),{getPath:()=>'/fixture'}),ipcMain:{handle:(n,f)=>handlers.set(n,f),on:(n,f)=>events.set(n,f)},access,
    resolve:e=>e===event?entry:null,store,translator});
  return{handlers,events,calls,event,store,access,call:(name,value={},e=event)=>handlers.get(name)(e,value),change:v=>{identity=v;revision++;}};
}
test('cache/sent routes reject unbound senders and renderer-supplied identities, including forged ports',async()=>{
  const f=fixture();for(const name of ['translation:cache:load','translation:cache:get','translation:cache:put','translation:cache:hit','translation:sent:get','translation:sent:put']){
    assert.equal((await f.call(name,{},{})).ok,false);
    for(const field of ['accountId','scope','platform','portId'])assert.equal((await f.call(name,{[field]:'forged'})).ok,false);
  }assert.equal(f.calls.length,0);
});
test('bootstrap is synchronous, identity comes from host binding and cache reads never require network',()=>{
  const f=fixture();f.access.authorize=()=>{throw Error('No network');};
  f.events.get('translation:cache:load')(f.event,{});assert.equal(f.event.returnValue.ok,true);
  assert.notEqual(f.calls[0][1].accountId,'port:a');assert.equal(f.calls[0][1].portId,'port:a');assert.equal(f.calls[0][1].platform,'whatsapp');
});
test('new messages retain the platform translator and commit locally before success',async()=>{
  let calls=0;const f=fixture({translate:async()=>{calls++;return{text:'no'};}});
  assert.equal((await f.call('translation:request',{chatId:'c',lang:'zh-CN',sourceText:'Hello',sourceRevision:sourceHash('Hello')})).ok,true);
  assert.equal(calls,1);const write=f.calls.findIndex(c=>c[0]==='put');assert.ok(write>=0);assert.equal(f.calls[write+1][0],'flush');
});
test('cache hit never calls a model; identity switch discards a delayed translated result',async()=>{
  let finish,calls=0;const f=fixture({localContentOnly:true,translate:()=>{calls++;return new Promise(r=>{finish=r;});}});
  const value={chatId:'c',lang:'zh-CN',sourceText:'Hello',sourceRevision:sourceHash('Hello')};
  f.store.get=()=>({answer:'cached'});assert.equal((await f.call('translation:request',value)).row.answer,'cached');assert.equal(calls,0);
  f.store.get=()=>null;const pending=f.call('translation:request',value);await Promise.resolve();f.change(null);finish({text:'late'});
  assert.equal((await pending).ok,false);assert.ok(!f.calls.some(c=>c[0]==='put'));
});
test('default adapter invokes the existing 0.1.7 platform-translate function with host-bound account and commits its answer',async()=>{
  const authPath=require.resolve('../auth'),old=require.cache[authPath],calls=[];
  require.cache[authPath]={exports:{getClient:()=>({functions:{invoke:async(name,args)=>{
    calls.push([name,args]);return{data:{ok:true,text:'平台译文',provider:'platform'}};
  }}})}};
  try{
    const f=fixture();const value={chatId:'chat',lang:'zh-CN',sourceText:'Hello',sourceRevision:sourceHash('Hello'),messageId:'msg'};
    assert.equal((await f.call('translation:request',value)).ok,true);
    assert.equal(calls[0][0],'platform-translate');assert.equal(calls[0][1].body.accountId,'port:a');
    assert.equal(calls[0][1].body.question,'Hello');assert.equal(calls[0][1].body.conversationId,'chat');
    assert.equal(f.calls.find(c=>c[0]==='put')[1].answer,'平台译文');assert.ok(f.calls.some(c=>c[0]==='flush'));
  }finally{if(old)require.cache[authPath]=old;else delete require.cache[authPath];}
});
