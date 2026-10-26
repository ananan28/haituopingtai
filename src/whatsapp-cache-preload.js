'use strict';
// Sandboxed, isolated-world preload. No bridge is exposed to WhatsApp scripts.
const { ipcRenderer } = require('electron');

function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const length = Math.ceil((bytes.length + 9) / 64) * 64;
  const data = new Uint8Array(length); data.set(bytes); data[bytes.length] = 128;
  const view = new DataView(data.buffer);
  view.setUint32(length - 8, Math.floor(bytes.length / 0x20000000));
  view.setUint32(length - 4, bytes.length * 8 >>> 0);
  const k = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
  const h = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
  const rotate = (n, b) => n >>> b | n << 32 - b;
  const w = new Int32Array(64);
  for (let offset = 0; offset < length; offset += 64) {
    for (let i = 0; i < 64; i++) {
      if (i < 16) w[i] = view.getInt32(offset + i * 4);
      else { const x = w[i-15], y = w[i-2]; w[i] = w[i-16] + (rotate(x,7)^rotate(x,18)^x>>>3) + w[i-7] + (rotate(y,17)^rotate(y,19)^y>>>10) | 0; }
    }
    let [a,b,c,d,e,f,g,j] = h;
    for (let i = 0; i < 64; i++) {
      const t = j + (rotate(e,6)^rotate(e,11)^rotate(e,25)) + (e&f^~e&g) + k[i] + w[i] | 0;
      const u = (rotate(a,2)^rotate(a,13)^rotate(a,22)) + (a&b^a&c^b&c) | 0;
      j=g; g=f; f=e; e=d+t|0; d=c; c=b; b=a; a=t+u|0;
    }
    [a,b,c,d,e,f,g,j].forEach((n,i) => { h[i] = h[i] + n | 0; });
  }
  return h.map(n => (n >>> 0).toString(16).padStart(8,'0')).join('');
}

function stableKey({ messageId, metadata, question }) {
  return messageId ? 'id:' + messageId : 'fallback:' + sha256(JSON.stringify([metadata, question]));
}

function hasWhatsAppTranslatableTextContent(question) {
  return typeof question === 'string' && question.length <= 100000 && /\p{L}/u.test(question);
}

function install({ document, MutationObserver, invoke }) {
  let root = null, observer = null, conversation = null, generation = 0, ready = false, enabled = false;
  let language = 'zh-CN', mode = 'both', records = new Map();
  const pending = new Map(), attempted = new Set();
  function nodes() { return root ? [...root.querySelectorAll('.message-in, .message-out')] : []; }
  function describe(node) {
    // Only the native text body, never quoted messages, image captions or our translation.
    const body = [...node.querySelectorAll('[data-pre-plain-text]')].find(el => !el.closest('[data-testid="quoted-message"]'));
    const text = body?.querySelector('.selectable-text');
    if (!text || text.closest('[data-testid="quoted-message"]')) return null;
    const question = text.textContent?.trim();
    if (!hasWhatsAppTranslatableTextContent(question)) return null;
    const owner = node.closest('[data-id]') || node.querySelector('[data-id]');
    const messageId = owner?.getAttribute('data-id') || '';
    const metadata = body.getAttribute('data-pre-plain-text') || '';
    if (!messageId && !metadata) return null;
    return { question, messageId, metadata, key: stableKey({ question, messageId, metadata }) };
  }
  function chatId(list) {
    const explicit = root?.getAttribute('data-chat-id') || root?.getAttribute('data-jid');
    if (explicit) return explicit;
    const ids = new Set(list.map(node => describe(node)?.messageId.match(/^(?:true|false)_([^_]+)_/)?.[1]).filter(Boolean));
    // Never use a display name: different contacts can have identical names.
    return ids.size === 1 ? [...ids][0] : null;
  }
  function render(node, item) {
    let own = node.querySelector('[data-haituo-translation]');
    const record = records.get(item.key);
    if (!record || record.question !== item.question || record.language !== language || mode === 'original') {
      if (own) own.remove();
      return;
    }
    if (own?.getAttribute('data-source') === item.key && own.textContent === record.answer) return;
    if (own) own.remove();
    own = document.createElement('div');
    own.setAttribute('data-haituo-translation', ''); own.setAttribute('data-source', item.key);
    own.className = 'translationCacheHit';
    own.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere;color:inherit;opacity:.85;border-top:1px solid #7c5cf055;margin-top:4px;padding-top:4px;font-size:14px;';
    own.textContent = record.answer; // Never interpret model output as HTML.
    const body = [...node.querySelectorAll('[data-pre-plain-text]')].find(el => !el.closest('[data-testid="quoted-message"]'));
    body.appendChild(own);
  }
  function request(node, item) {
    const requestId = JSON.stringify([conversation, language, item.key, item.question]);
    if (!enabled || attempted.has(requestId) || pending.has(requestId)) return;
    attempted.add(requestId);
    const version = generation;
    const promise = invoke('webchannels:translateMessage', { ...item, conversationId: conversation, language });
    pending.set(requestId, promise);
    promise.then(result => {
      if (version !== generation || !result.ok) return;
      records.set(result.record.key, result.record);
      scan();
    }).catch(() => {}).finally(() => pending.delete(requestId));
  }
  function load(id) {
    conversation = id; generation++; ready = false; enabled = false; records = new Map(); attempted.clear();
    const version = generation;
    root?.classList.remove('translationCacheReady', 'translationCacheLoading');
    if (!id) return;
    root.classList.add('translationCacheLoading');
    invoke('webchannels:loadPortTranslationCache', { conversationId: id, language }).then(result => {
      if (version !== generation) return;
      root.classList.remove('translationCacheLoading');
      if (!result.ok) return;
      records = new Map(result.records.map(row => [row.key, row]));
      enabled = result.enabled; ready = true;
      root.classList.add('translationCacheReady'); scan();
    }).catch(() => { if (version === generation) root?.classList.remove('translationCacheLoading'); });
  }
  function scan() {
    const next = document.querySelector('#main');
    if (next !== root) { root = next; load(null); }
    if (!root) return;
    const list = nodes(), id = chatId(list);
    if (id !== conversation) load(id);
    for (const node of list) {
      const item = describe(node);
      if (!item) { node.querySelector('[data-haituo-translation]')?.remove(); continue; }
      // This path has no await, timer, animation frame or IPC. Observer callbacks
      // run before paint; virtualized replacement nodes reuse the in-memory Map.
      render(node, item);
      if (ready && !records.has(item.key)) request(node, item);
      else if (ready && records.get(item.key)?.question !== item.question) request(node, item);
    }
  }
  observer = new MutationObserver(mutations => {
    // Ignore only our own insertions/removals, so there is no observer loop.
    if (mutations.every(m => m.type === 'childList' && [...m.addedNodes, ...m.removedNodes].length
      && [...m.addedNodes, ...m.removedNodes].every(n => n.nodeType === 1 && n.hasAttribute('data-haituo-translation')))) return;
    scan();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true,
    attributes: true, attributeFilter: ['data-id', 'data-pre-plain-text', 'data-chat-id', 'data-jid'] });
  scan();
  return { stop() { generation++; observer.disconnect(); records.clear(); pending.clear(); },
    setDisplayMode(value) { if (!['both','original'].includes(value)) throw new Error('Invalid display mode'); mode = value; scan(); },
    setLanguage(value) { if (typeof value !== 'string' || !value || value.length > 64) throw new Error('Invalid language'); language = value; load(conversation); },
    scan };
}

if (typeof window !== 'undefined' && process.isMainFrame && location.origin === 'https://web.whatsapp.com') {
  const start = () => install({ document, MutationObserver, invoke: (name, value) => ipcRenderer.invoke(name, value) });
  if (document.documentElement) start(); else window.addEventListener('DOMContentLoaded', start, { once: true });
}
// Test-only CommonJS exports; the sandbox never exposes them to the page.
if (typeof module !== 'undefined') module.exports = { sha256, stableKey, install, hasWhatsAppTranslatableTextContent };
