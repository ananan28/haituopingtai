'use strict';
const keyFor=(chatId,lang,hash)=>JSON.stringify([chatId,lang,hash]);
class PortMemory {
  constructor({maxEntries=1000,maxBytes=8*1024*1024}={}){this.maxEntries=maxEntries;this.maxBytes=maxBytes;this.entries=new Map();this.pinned=new Set();this.bytes=0;}
  set(key,value){
    const old=this.entries.get(key);if(old)this.bytes-=old.bytes;
    const bytes=Buffer.byteLength(JSON.stringify(value),'utf8')+Buffer.byteLength(key,'utf8');
    this.entries.set(key,{value,bytes,hits:old?.hits||value.hits||0,used:Date.now(),age:value.updatedAt||value.createdAt||Date.now()});this.bytes+=bytes;
    while(this.entries.size>this.maxEntries||this.bytes>this.maxBytes){
      const choices=[...this.entries].filter(([k])=>!this.pinned.has(k)).sort(([,a],[,b])=>a.hits-b.hits||a.used-b.used||a.age-b.age);
      const candidate=choices[0]||[key,this.entries.get(key)];
      if(!candidate[1])break;
      this.entries.delete(candidate[0]);this.bytes-=candidate[1].bytes;
      if(candidate[0]===key)return false;
    }
    return this.entries.has(key);
  }
  get(key){const entry=this.entries.get(key);if(!entry)return undefined;entry.hits++;entry.used=Date.now();return entry.value;}
  pin(keys){this.pinned=new Set(keys);}
  clear(){this.entries.clear();this.pinned.clear();this.bytes=0;}
  sent(chatId,key){for(const entry of this.entries.values()){const r=entry.value;if(r.kind==='sent'&&r.chatId===chatId&&(r.sentKey===key||r.sentText===key))return r;}return undefined;}
}
module.exports={PortMemory,keyFor};
