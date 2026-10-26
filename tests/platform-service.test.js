'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createTranslator,requestId}=require('../platform-translation');
const user='10000000-0000-0000-0000-000000000001';
const input={requestId:'20000000-0000-0000-0000-000000000001',accountId:'30000000-0000-0000-0000-000000000001',conversationId:'123@c.us',messageId:'m1',question:'Hello 👩🏽‍💻',language:'zh-CN'};
test('HTTP translation service validates identity/input before reserve, uses source-derived cost and settles once',async()=>{
  const {createHandler}=await import('../supabase/functions/platform-translate/core.mjs');
  const calls=[];
  const handler=createHandler({authenticate:async t=>t==='valid'?{id:user}:null,
    releaseExpired:async()=>{},reserve:async v=>{calls.push(['reserve',v]);return{state:'execute',lease:'lease'};},
    finish:async v=>{calls.push(['finish',v]);return{state:'succeeded',text:v.text,provider:v.provider};},
    translate:async()=>{calls.push(['model']);return{text:'你好',provider:'platform'};}});
  const call=(body=input,token='valid')=>handler(new Request('https://test.invalid',{method:'POST',headers:{authorization:'Bearer '+token},body:JSON.stringify(body)}));
  assert.equal((await call(input,'invalid')).status,401);assert.equal(calls.length,0);
  assert.equal((await call({...input,userId:user,chars:1,apiKey:'forged'})).status,400);assert.equal(calls.length,0);
  assert.equal((await call()).status,200);assert.equal(calls[0][1].chars,[...input.question].length);
  assert.equal(calls[0][1].userId,user);assert.equal(calls[2][1].success,true);
});
test('cached replay avoids provider and failed model releases hold, while ambiguous settlement never refunds',async()=>{
  const {createHandler}=await import('../supabase/functions/platform-translate/core.mjs');
  let state='succeeded',failModel=false,failFinish=false;const calls=[];
  const handler=createHandler({authenticate:async()=>({id:user}),releaseExpired:async()=>{},
    reserve:async()=>({state,lease:'lease',text:'cached',provider:'platform'}),
    translate:async()=>{calls.push('model');if(failModel)throw Error();return{text:'new',provider:'platform'};},
    finish:async v=>{calls.push(v.success?'settle':'refund');if(failFinish)throw Error();return{state:'failed'};}});
  const call=()=>handler(new Request('https://test.invalid',{method:'POST',headers:{authorization:'Bearer valid'},body:JSON.stringify(input)}));
  assert.equal((await call()).status,200);assert.deepEqual(calls,[]);
  state='reserved';assert.equal((await call()).status,409);assert.deepEqual(calls,[]);
  state='execute';failModel=true;assert.equal((await call()).status,502);assert.deepEqual(calls,['model','refund']);
  calls.length=0;failModel=false;failFinish=true;assert.equal((await call()).status,503);assert.deepEqual(calls,['model','settle']);
});
test('server-only model chain falls back and never forwards API errors or client endpoints',async()=>{
  const {createProviderChain}=await import('../supabase/functions/platform-translate/core.mjs');
  const calls=[];
  const chain=createProviderChain([{id:'primary',url:'https://a.invalid/chat',key:'test-only-a',model:'m'},
    {id:'backup',url:'https://b.invalid/chat',key:'test-only-b',model:'m'}],async(url,options)=>{
    calls.push([url,options]);return calls.length===1?new Response('failure',{status:503}):Response.json({choices:[{message:{content:'你好'}}]});
  });
  assert.deepEqual(await chain({text:'Hello',language:'zh-CN'}),{text:'你好',provider:'backup'});
  assert.equal(calls.length,2);assert.equal(calls[1][1].redirect,'error');
  assert.throws(()=>createProviderChain([{id:'x',url:'http://a.invalid',key:'x',model:'x'}]));
});
test('desktop adapter invokes only platform function, binds identity and discards post-logout results',async()=>{
  let identity={scope:'server:'+user,demo:false,local:false,accountIds:[input.accountId]},revision=1,finish;
  const calls=[];const access={current:()=>identity,revision:()=>revision,can:()=>true};
  const translate=createTranslator({access,getClient:()=>({functions:{invoke:async(name,args)=>{
    calls.push([name,args]);return new Promise(resolve=>{finish=resolve;});}}})});
  const value={...input,scope:identity.scope};const pending=translate(value);
  identity=null;revision++;finish({data:{ok:true,text:'stale',provider:'platform'}});
  await assert.rejects(pending);assert.equal(calls[0][0],'platform-translate');
  assert.equal(calls[0][1].body.question,input.question);assert.equal(calls[0][1].body.scope,undefined);
  assert.equal(requestId(value.scope,value),requestId(value.scope,value));
  assert.notEqual(requestId(value.scope,value),requestId(value.scope,{...value,question:'edit'}));
});
