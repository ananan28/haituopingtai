(() => {
  'use strict';
  const api = window.haituo.messages;

  function html(record) {
    const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    return `<div class="em-msg ${record.direction === 'out' ? 'is-out' : ''}" data-message-id="${escape(record.id)}">
      <span class="em-msg-avatar${record.direction === 'out' ? ' is-me' : ''}">${escape(record.avatar)}</span>
      <div class="em-msg-main"><div class="em-msg-meta"><span>${escape(record.sender)}</span><span>${escape(record.displayTime)}</span></div>
        <div class="em-bubble">${escape(record.body)}</div>
        ${record.translation ? `<div class="em-tr"><span class="em-tr-tag">译</span><span>${escape(record.translation.text)}</span></div>` : ''}
      </div></div>`;
  }

  // One persisted message includes both source and translation. No second DOM pass.
  async function loadDemo(account, seeds, valid) {
    const address = { accountId: account.id, channel: account.channel, conversationId: 'demo-conversation' };
    for (let i = 0; i < seeds.length; i++) {
      if (!valid()) return null;
      const item = seeds[i];
      const result = await api.put({ ...address, id: 'demo-seed-v1-' + i, direction: item.side,
        body: item.text, sender: item.name, avatar: item.avatar, displayTime: item.time, timestamp: 1700000000000 + i });
      if (!valid()) return null;
      if (!result.ok) throw new Error(result.error);
      if (!result.record.translation && item.tr) {
        const translated = await api.translate({ ...address, id: result.record.id, sourceHash: result.record.sourceHash,
          text: item.tr, language: 'demo', provider: 'demo-seed', demo: true });
        if (!valid()) return null;
        if (!translated.ok) throw new Error(translated.error);
      }
    }
    if (!valid()) return null;
    const result = await api.list(address);
    if (!valid()) return null;
    if (!result.ok) throw new Error(result.error);
    return result.records;
  }

  async function saveOutgoing(account, body, translated, valid) {
    if (!valid()) return null;
    const now = Date.now();
    const value = { accountId: account.id, channel: account.channel, conversationId: 'demo-conversation',
      id: crypto.randomUUID(), direction: 'out', body, timestamp: now, sender: '我', avatar: '我',
      displayTime: new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }) };
    const stored = await api.put(value);
    if (!valid()) return null;
    if (!stored.ok) throw new Error(stored.error);
    if (!translated) return stored.record;
    const result = await api.translate({ ...value, sourceHash: stored.record.sourceHash, text: translated,
      language: 'demo', provider: 'demo-simulator', demo: true });
    if (!valid()) return null;
    if (!result.ok) return stored.record;
    return result.record;
  }

  async function older(account, before, valid) {
    const result = await api.list({ accountId: account.id, channel: account.channel, conversationId: 'demo-conversation', before });
    if (!valid()) return null;
    if (!result.ok) throw new Error(result.error);
    return result.records;
  }
  window.HaituoMessages = Object.freeze({ html, loadDemo, saveOutgoing, older });
})();
