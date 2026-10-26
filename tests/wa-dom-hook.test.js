'use strict';
const test=require('node:test'),assert=require('node:assert/strict');const{install}=require('../src/wa-dom-hook');
test('CDP setup stops an existing load, attaches, enables Page and installs with runImmediately before caller navigation',async()=>{
  const calls=[];const wc={isLoading:()=>true,stop:()=>calls.push('stop'),debugger:{isAttached:()=>false,attach:v=>calls.push(['attach',v]),
    sendCommand:async(name,value)=>{calls.push([name,value]);return{};}}};
  await install(wc);calls.push('loadURL');
  assert.deepEqual(calls.slice(0,3),['stop',['attach','1.3'],['Page.enable',undefined]]);
  assert.equal(calls[3][0],'Page.addScriptToEvaluateOnNewDocument');assert.equal(calls[3][1].runImmediately,true);
  assert.ok(calls[3][1].source.includes('replaceChildren'));assert.equal(calls[4],'loadURL');
});
test('CDP attachment or command failure leaves the primary preload path available',async()=>{
  for(const commandFails of [false,true]){
    const wc={isLoading:()=>false,debugger:{isAttached:()=>commandFails,attach(){throw Error('unavailable');},sendCommand:async()=>{throw Error('no target');}}};
    assert.equal((await install(wc)).preloadFallback,true);
  }
});
