'use strict';
// Main world only: create a slot and synchronously notify the isolated preload.
// No Node, account identifiers, translations, SQL, IPC or network in this hook.
function mainWorldHook(){
  const marker=Symbol.for('haituo.wa.dom-hooks.v1');if(globalThis[marker])return;globalThis[marker]=true;
  let busy=false;
  const selector='.message-in, .message-out';
  function notify(){
    if(busy)return;busy=true;
    try{
      const root=document.querySelector('#main');
      if(root)for(const node of root.querySelectorAll(selector)){
        const body=[...node.querySelectorAll('[data-pre-plain-text]')].find(el=>!el.closest('[data-testid="quoted-message"]'));
        if(!body?.querySelector('.selectable-text')||node.querySelector('[data-ht-slot]'))continue;
        const slot=document.createElement('div');slot.className='ht-translation-slot';slot.setAttribute('data-ht-slot','1');
        slot.setAttribute('data-ht-translation','1');slot.setAttribute('data-ht-state','unknown');body.appendChild(slot);
      }
      document.dispatchEvent(new Event('ht-wa-dom-change'));
    }finally{busy=false;}
  }
  function method(proto,name){
    const d=Object.getOwnPropertyDescriptor(proto,name);if(!d?.value)return;
    Object.defineProperty(proto,name,{...d,value:function(...args){const result=Reflect.apply(d.value,this,args);notify();return result;}});
  }
  function setter(proto,name){
    const d=Object.getOwnPropertyDescriptor(proto,name);if(!d?.set)return;
    Object.defineProperty(proto,name,{...d,set:function(value){Reflect.apply(d.set,this,[value]);notify();}});
  }
  for(const name of ['appendChild','insertBefore','replaceChild','removeChild'])method(Node.prototype,name);
  for(const proto of [Element.prototype,Document.prototype,DocumentFragment.prototype])for(const name of ['replaceChildren','append','prepend'])method(proto,name);
  for(const proto of [Element.prototype,CharacterData.prototype])for(const name of ['before','after','replaceWith','remove'])method(proto,name);
  method(Range.prototype,'insertNode');method(Element.prototype,'insertAdjacentHTML');
  for(const name of ['textContent','nodeValue'])setter(Node.prototype,name);
  setter(CharacterData.prototype,'data');for(const name of ['innerHTML','outerHTML'])setter(Element.prototype,name);
  for(const name of ['setAttribute','removeAttribute'])method(Element.prototype,name);
}
async function install(wc){
  if(wc.isLoading?.())wc.stop();
  try{if(!wc.debugger.isAttached())wc.debugger.attach('1.3');}
  catch{return{preloadFallback:true};}
  const setup=(async()=>{
    await wc.debugger.sendCommand('Page.enable');
    return wc.debugger.sendCommand('Page.addScriptToEvaluateOnNewDocument',{source:'('+mainWorldHook.toString()+')();',runImmediately:true});
  })();
  // New views may not yet have a Page target. Preload is the primary path;
  // the same ordered CDP chain finishes as the target becomes available.
  let timer;
  try{return await Promise.race([setup,new Promise(resolve=>{timer=setTimeout(()=>resolve({preloadFallback:true}),1500);})]);}
  catch{return{preloadFallback:true};}
  finally{clearTimeout(timer);setup.catch(()=>{});}
}
module.exports={mainWorldHook,install};
