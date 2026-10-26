'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createHash } = require('node:crypto');
const { parseHTML } = require('linkedom');
const { messageKey } = require('../src/translation-cache');
const moduleValue = { exports: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/whatsapp-cache-preload.js'),'utf8'), {
  module: moduleValue, require: name => { assert.equal(name, 'electron'); return { ipcRenderer: {} }; },
  TextEncoder, Uint8Array, Int32Array, DataView
});
const { sha256, stableKey, install, hasWhatsAppTranslatableTextContent } = moduleValue.exports;
const tick = () => new Promise(resolve => setImmediate(resolve));
const source = 'Hello 👩🏽‍💻';
const markup = (id = 'false_123@c.us_A', body = source, metadata = '[10:01] Alice:') =>
  `<div data-id="${id}"><div class="message-in"><div data-pre-plain-text="${metadata}"><span class="selectable-text">${body}</span></div></div></div>`;
function fixture(t, invoke, html = markup()) {
  const { document, window } = parseHTML('<html><body><div id="main">' + html + '</div></body></html>');
  const calls = [];
  const adapter = install({ document, MutationObserver: window.MutationObserver, invoke: (name, value) => {
    calls.push([name, value]); return invoke(name, value);
  } });
  t.after(() => adapter.stop());
  return { document, adapter, calls, root: document.querySelector('#main'), translation: () => document.querySelector('[data-haituo-translation]') };
}
const record = { key: 'id:false_123@c.us_A', question: source, answer: '你好 👩🏽‍💻', language: 'zh-CN' };
test('sandbox SHA-256 exactly matches Node for Unicode, long strings and padding boundaries', () => {
  for (const value of ['', 'a', 'a'.repeat(55),'a'.repeat(56),'a'.repeat(64),'a'.repeat(10000), source, JSON.stringify(['[10:01] 李:',source])]) {
    assert.equal(sha256(value), createHash('sha256').update(value).digest('hex'));
  }
  const value = { messageId: '', metadata: '[10:01] Alice:', question: source };
  assert.equal(stableKey(value), messageKey(value));
});
test('only text with translatable letters is eligible, not numbers or emoji-only content', () => {
  for (const text of ['', '123456', '👩🏽‍💻 🎉', undefined]) assert.equal(hasWhatsAppTranslatableTextContent(text), false);
  for (const text of ['Hello', '你好', 'مرحبا', 'Salut 123']) assert.equal(hasWhatsAppTranslatableTextContent(text), true);
});
test('conversation cache loads once, replacement nodes synchronously reattach without IPC/loading', async t => {
  const f = fixture(t, async () => ({ ok: true, records: [record], enabled: false }));
  await tick(); assert.equal(f.translation().textContent, record.answer); assert.equal(f.calls.length, 1);
  f.root.innerHTML = markup();
  // scan is exactly the synchronous observer path: no promise or disk read.
  f.adapter.scan(); assert.equal(f.translation().textContent, record.answer);
  assert.equal(f.calls.length, 1); assert.ok(f.root.classList.contains('translationCacheReady'));
  assert.equal(f.root.classList.contains('translationCacheLoading'), false);
  await tick(); assert.equal(f.document.querySelectorAll('[data-haituo-translation]').length, 1);
});
test('actual MutationObserver restores removed virtual list nodes before the next task', async t => {
  const f = fixture(t, async () => ({ ok: true, records: [record], enabled: false }));
  await tick(); f.root.innerHTML = markup();
  await tick(); assert.equal(f.translation().textContent, record.answer); assert.equal(f.calls.length, 1);
});
test('repeated source text uses message identity and never copies a neighboring translation', async t => {
  const f = fixture(t, async () => ({ ok: true, records: [record], enabled: false }), markup() + markup('false_123@c.us_B'));
  await tick(); assert.equal(f.document.querySelectorAll('[data-haituo-translation]').length, 1);
  assert.equal(f.root.lastElementChild.querySelector('[data-haituo-translation]'), null);
});
test('edited text removes stale translation and media-only messages do not create requests', async t => {
  const f = fixture(t, async () => ({ ok: true, records: [record], enabled: false }));
  await tick(); f.document.querySelector('.selectable-text').textContent = 'Changed';
  f.adapter.scan(); assert.equal(f.translation(), null);
  f.root.innerHTML = '<div data-id="false_123@c.us_A"><div class="message-in"><img src="photo"></div></div>';
  await tick(); assert.equal(f.calls.length, 1); assert.equal(f.translation(), null);
});
test('conversation switch drops old cache; an old async load cannot overwrite the new chat', async t => {
  let finish;
  const f = fixture(t, (_name, value) => value.conversationId === '123@c.us'
    ? new Promise(resolve => { finish = resolve; }) : Promise.resolve({ ok: true, records: [], enabled: false }));
  f.root.innerHTML = markup('false_456@c.us_A'); f.adapter.scan();
  await tick(); finish({ ok: true, records: [record], enabled: false }); await tick();
  assert.equal(f.translation(), null); assert.equal(f.calls.length, 2);
});
test('cached text is rendered safely; original mode and language change invalidate visible translations', async t => {
  const f = fixture(t, async () => ({ ok: true, records: [{ ...record, answer: '<img src=x onerror=alert(1)>' }], enabled: false }));
  await tick(); assert.equal(f.translation().querySelector('img'), null);
  f.adapter.setDisplayMode('original'); assert.equal(f.translation(), null);
  f.adapter.setDisplayMode('both'); assert.ok(f.translation());
  f.adapter.setLanguage('fr'); await tick(); assert.equal(f.translation(), null);
});
test('missing stable chat IDs fail closed; fallback metadata keys survive node replacement', async t => {
  const metadata = '[10:01] Alice:';
  const row = { ...record, key: stableKey({ messageId: '', metadata, question: source }) };
  const f = fixture(t, async () => ({ ok: true, records: [row], enabled: false }), markup(''));
  await tick(); assert.equal(f.calls.length, 0);
  f.root.setAttribute('data-chat-id', '123@c.us'); await tick(); assert.equal(f.translation().textContent, record.answer);
  f.root.innerHTML = markup(''); await tick(); assert.equal(f.translation().textContent, record.answer);
});
test('new message requests deduplicate; late edited-source response never appears on changed text', async t => {
  let finish;
  const f = fixture(t, async (name) => name.endsWith('loadPortTranslationCache')
    ? { ok: true, records: [], enabled: true } : new Promise(resolve => { finish = resolve; }));
  await tick(); f.adapter.scan(); f.adapter.scan(); assert.equal(f.calls.length, 2);
  f.document.querySelector('.selectable-text').textContent = 'Changed';
  // Disable another request while verifying the old response independently.
  f.adapter.setDisplayMode('original');
  const oldFinish = finish;
  oldFinish({ ok: true, record }); await tick(); f.adapter.setDisplayMode('both');
  assert.equal(f.translation(), null);
});
