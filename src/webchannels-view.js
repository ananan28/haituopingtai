(() => {
  'use strict';

  const api = window.haituo && window.haituo.webchannels;
  const Icons = window.HaituoChannelIcons;

  const SUPPORTED = Object.freeze([
    'whatsapp', 'whatsapp-pure', 'whatsapp-business',
    'telegram', 'telegram-k', 'telegram-a'
  ]);

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));

  const SVG = {
    refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 4v5h-5"/></svg>',
    sleep: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z"/></svg>',
    more: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg>'
  };

  const OVERLAY_IDS = ['context-menu', 'user-menu', 'fx-manager', 'shot-studio'];

  let active = null; // { acc, host, ro, onWinResize, unsub, statusEl, loadingEl, opened, failed }
  let overlayObserver = null;

  function supports(acc) {
    return Boolean(api && acc && SUPPORTED.includes(acc.channel));
  }

  function channelLabel(channel) {
    if (channel === 'telegram-a') return 'Telegram A';
    if (channel === 'telegram-k' || channel === 'telegram') return 'Telegram K';
    if (channel && channel.startsWith('whatsapp')) return 'WhatsApp';
    return String(channel || '');
  }

  function anyOverlayOpen() {
    for (const id of OVERLAY_IDS) {
      const el = document.getElementById(id);
      if (el && !el.hidden) return true;
    }
    return Array.from(document.querySelectorAll('.modal-backdrop')).some((el) => !el.hidden);
  }

  function syncVisibility() {
    if (!active || !api) return;
    const visible = active.opened && !active.failed && active.host.isConnected && !anyOverlayOpen();
    api.setVisible(active.acc.id, visible);
  }

  function syncBounds() {
    if (!active || !api) return;
    if (!active.host.isConnected) return;
    const r = active.host.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    api.setBounds(active.acc.id, { x: r.left, y: r.top, width: r.width, height: r.height });
    syncVisibility();
  }

  function ensureOverlayObserver() {
    if (overlayObserver || !api) return;
    overlayObserver = new MutationObserver(syncVisibility);
    overlayObserver.observe(document.body, { attributes: true, attributeFilter: ['hidden'], subtree: true });
  }

  function teardown() {
    if (!active) return;
    if (active.ro) active.ro.disconnect();
    if (active.onWinResize) window.removeEventListener('resize', active.onWinResize);
    if (active.unsub) active.unsub();
    active = null;
  }

  // 渲染层每次重绘前调用：睡眠=销毁释放内存；切走=仅隐藏保留会话。
  // 删除与身份切换的清理由 destroy() 与 __haituoResetTransient 显式处理。
  function onBeforeRender() {
    if (!active || !api) return;
    const acc = active.acc;
    teardown();
    if (acc.status === 'sleep') api.sleep(acc.id);
    else api.setVisible(acc.id, false);
  }

  function destroy(id) {
    if (api) api.sleep(id);
    if (active && active.acc.id === id) teardown();
  }

  function destroyAll() {
    teardown();
    if (api) api.destroyAll();
  }

  function build(acc, isValid, actions) {
    ensureOverlayObserver();
    teardown();

    const label = channelLabel(acc.channel);
    const root = document.createElement('div');
    root.className = 'em webch-embed';
    root.innerHTML = `
      <header class="em-head">
        <div class="em-peer">
          <span class="ch-tile em-tile" data-channel="${esc(acc.channel)}">${Icons.html(acc.channel, acc.avatar)}</span>
          <div class="em-title">
            <strong>${esc(acc.name)}<span class="em-status is-live">官方网页版</span></strong>
            <small>${esc(label)} · ${esc(acc.account)}<span class="em-partition">${esc(acc.partition)}</span></small>
          </div>
        </div>
        <div class="em-actions">
          <span class="em-embed-note webch-note">内嵌官方站点 · 会话隔离</span>
          <button class="bar-icon" type="button" data-webch="refresh" title="刷新">${SVG.refresh}</button>
          <button class="bar-icon" type="button" data-webch="sleep" title="休眠并释放内存">${SVG.sleep}</button>
          <button class="bar-icon" type="button" data-webch="more" title="账号菜单">${SVG.more}</button>
        </div>
      </header>
      <div class="webch-host">
        <div class="webch-loading"><span class="webch-spinner"></span><span class="webch-loading-text">正在加载 ${esc(label)} 官方网页版…</span></div>
      </div>
      <footer class="webch-bar">
        <span class="webch-bar-status" data-webch-status>初始化…</span>
        <span class="webch-bar-hint">登录态与 Cookie 按账号独立分区存储</span>
      </footer>`;

    const host = root.querySelector('.webch-host');
    const statusEl = root.querySelector('[data-webch-status]');
    const loadingEl = root.querySelector('.webch-loading');
    const loadingText = root.querySelector('.webch-loading-text');

    const unsub = api.onEvent((ev) => {
      if (ev.accountId !== acc.id || !root.isConnected) return;
      if (ev.type === 'did-finish-load') {
        active && (active.opened = true);
        loadingEl.classList.add('is-hidden');
        statusEl.textContent = '已加载 · ' + label;
        syncVisibility();
      } else if (ev.type === 'did-fail-load') {
        if (active) active.failed = true;
        loadingEl.classList.remove('is-hidden');
        loadingText.textContent = '加载失败，请检查网络后刷新';
        const desc = ev.detail && ev.detail.desc;
        statusEl.textContent = '加载失败' + (desc ? '（' + desc + '）' : '');
        api.setVisible(acc.id, false);
      }
    });

    const onWinResize = () => syncBounds();
    const ro = new ResizeObserver(() => syncBounds());
    ro.observe(host);
    window.addEventListener('resize', onWinResize);

    active = { acc, host, ro, onWinResize, unsub, statusEl, loadingEl, opened: false, failed: false };

    api.open(acc.id, acc.channel).then((res) => {
      if (!active || active.acc !== acc || !root.isConnected) return;
      if (res && res.ok) {
        active.opened = true;
        syncBounds();
      } else {
        active.failed = true;
        loadingEl.classList.remove('is-hidden');
        loadingText.textContent = '无法打开渠道';
        statusEl.textContent = (res && res.error) || '打开失败';
      }
    }).catch(() => {
      if (!root.isConnected) return;
      if (active) active.failed = true;
      loadingEl.classList.remove('is-hidden');
      loadingText.textContent = '无法打开渠道';
      statusEl.textContent = '打开失败：服务不可用';
    });

    root.querySelector('[data-webch="refresh"]').addEventListener('click', () => {
      if (!isValid()) return;
      api.refresh(acc.id);
      if (active) active.failed = false;
      loadingEl.classList.remove('is-hidden');
      loadingText.textContent = '正在刷新…';
      statusEl.textContent = '刷新中…';
    });
    root.querySelector('[data-webch="sleep"]').addEventListener('click', () => {
      if (!isValid()) return;
      actions.setSleep(true);
    });
    root.querySelector('[data-webch="more"]').addEventListener('click', (e) => {
      if (!isValid()) return;
      const rect = e.currentTarget.getBoundingClientRect();
      actions.openMenu(acc.id, rect.right - 210, rect.bottom + 6);
    });

    return root;
  }

  // 身份切换（登录/退出/演示角色切换）时释放全部视图：接入 access.js 既有钩子。
  window.__haituoResetTransient = destroyAll;

  window.HaituoWebChannels = Object.freeze({ supports, build, onBeforeRender, destroy });
})();
