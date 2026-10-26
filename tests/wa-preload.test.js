'use strict';
const test=require('node:test'),assert=require('node:assert/strict');const{parseHTML}=require('linkedom');
const{install,hash}=require('../src/wa-preload');
const tick=()=>new Promise(r=>setImmediate(r));
const source='Hello';
const markup=(body=source,id='false_123@c.us_A')=>`<div data-id="${id}"><div class="message-in"><div data-pre-plain-text="[10:01] Alice:"><span class="selectable-text">${body}</span></div></div></div>`;
const row={id:1,chatId:'123@c.us',lang:'zh-CN',sourceText:source,sourceHash:hash(source),sourceRevision:hash(source),answer:'你好'};
function fixture(t,{rows=[row],invoke}={}){
  const{document,window}=parseHTML('<html><head></head><body><div id="main">'+markup()+'</div></body></html>'),calls=[];
  const api=install({document,window,MutationObserver:window.MutationObserver,bootstrap:{ok:true,rows,sent:[]},
    send(){},invoke:(name,value)=>{calls.push([name,value]);return invoke?invoke(name,value):Promise.resolve(name.endsWith(':load')?{ok:true,rows,sent:[]}:{ok:true,row:null});}});
  t.after(()=>api.stop());return{document,window,api,calls,root:document.querySelector('#main'),slot:()=>document.querySelector('[data-ht-slot]')};
}
test('warm hit is synchronous on first scan and repeated normalized text shares cache regardless of message IDs',async t=>{
  const f=fixture(t);assert.equal(f.slot().dataset.htState,'hit');assert.equal(f.slot().textContent,'你好');
  f.root.innerHTML=markup('Ｈｅｌｌｏ','false_123@c.us_B')+markup(' Hello  ','false_123@c.us_C');f.api.scan();
  assert.equal(f.document.querySelectorAll('[data-ht-state="hit"]').length,2);
  await tick();assert.ok(f.calls.every(([name])=>name==='translation:cache:load'));
});
test('new text has inline SVG spinner; successful result replaces it in the same slot',async t=>{
  let finish;const f=fixture(t,{rows:[],invoke:async(name)=>{
    if(name.endsWith(':load'))return{ok:true,rows:[],sent:[]};if(name.endsWith(':get'))return{ok:true,row:null};
    return new Promise(r=>{finish=r;});
  }});
  const slot=f.slot();assert.ok(slot.querySelector('circle[stroke-dasharray="42 15"]'));await tick();
  finish({ok:true,row});await tick();assert.equal(f.slot(),slot);assert.equal(slot.textContent,'你好');assert.equal(slot.querySelector('svg'),null);
});
test('edited sources cannot display old translation; empty cache values never request translation',async t=>{
  const f=fixture(t);f.document.querySelector('.selectable-text').textContent='Edited';f.api.scan();
  assert.ok(!f.slot().textContent.includes('你好'));assert.ok(f.slot().querySelector('svg'));
  const empty=fixture(t,{rows:[{...row,answer:''}]});assert.equal(empty.slot().dataset.htState,'empty');await tick();
  assert.ok(empty.calls.every(([name])=>name==='translation:cache:load'));
});
test('chat/language switch never reuses old translations and removes duplicate slots synchronously',async t=>{
  const f=fixture(t);f.slot().after(f.slot().cloneNode(true));f.api.scan();assert.equal(f.document.querySelectorAll('[data-ht-slot]').length,1);
  f.api.setLanguage('fr');assert.ok(!f.slot().textContent.includes('你好'));
  f.root.innerHTML=markup(source,'false_456@c.us_A');f.api.scan();assert.ok(!f.slot().textContent.includes('你好'));await tick();
});
test('source markup is unmodified and model output is always plain text',t=>{
  const f=fixture(t,{rows:[{...row,answer:'<img src=x onerror=alert(1)>'}]});
  assert.equal(f.document.querySelector('.selectable-text').textContent,'Hello');assert.equal(f.slot().querySelector('img'),null);
});
