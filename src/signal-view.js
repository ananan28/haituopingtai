(() => {
  'use strict';

  // Signal 渠道内嵌（渲染层）：与 webchannels-view.js（WA/TG）并列。
  // 非演示 Signal 账号点开时，用主进程 WebContentsView 承载本地 background.html
  // 渲染器（源码级融合，同进程）；演示账号仍走本地 mock，不挂载真实后端。
  const api = window.haituo && window.haituo.signal;
  const Icons = window.HaituoChannelIcons;

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));

  const SVG = {
    refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 4v5h-5"/></svg>',
    sleep: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z"/></svg>',
    more: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></svg>'
  };

  const OVERLAY_IDS = ['context-menu', 'user-menu', 'fx-manager', 'shot-studio'];

  let active = null; // { acc, host, ro, onWinResize, statusEl, loadingEl, opened, failed }

  function supports(acc) {
    return Boolean(api && acc && typeof acc.channel === 'string' && acc.channel.startsWith('signal'));
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

  function teardown() {
    if (!active) return;
    if (active.ro) active.ro.disconnect();
    if (active.onWinResize) window.removeEventListener('resize', active.onWinResize);
    active = null;
  }

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
    const acc = active && active.acc;
    teardown();
    if (api && acc) api.sleep(acc.id);
  }

  function build(acc, isValid, actions) {
    teardown();

    const root = document.createElement('div');
    root.className = 'em webch-embed';
    root.innerHTML = `
      <header class="em-head">
        <div class="em-peer">
          <span class="ch-tile em-tile" data-channel="${esc(acc.channel)}">${Icons.html(acc.channel, acc.avatar)}</span>
          <div class="em-title">
            <strong>${esc(acc.name)}<span class="em-status is-live">Signal 渠道</span></strong>
            <small>Signal · ${esc(acc.account)}<span class="em-partition">${esc(acc.partition)}</span></small>
          </div>
        </div>
        <div class="em-actions">
          <span class="em-embed-note webch-note">源码级内嵌 · 同进程</span>
          <button class="bar-icon" type="button" data-sig="refresh" title="刷新">${SVG.refresh}</button>
          <button class="bar-icon" type="button" data-sig="sleep" title="休眠并释放内存">${SVG.sleep}</button>
          <button class="bar-icon" type="button" data-sig="more" title="账号菜单">${SVG.more}</button>
        </div>
      </header>
      <div class="webch-host">
        <div class="webch-loading"><span class="webch-spinner"></span><span class="webch-loading-text">正在启动 Signal 会话…</span></div>
      </div>
      <footer class="webch-bar">
        <span class="webch-bar-status" data-sig-status>初始化…</span>
        <span class="webch-bar-hint">Signal 会话与后端同进程承载</span>
      </footer>`;

    const host = root.querySelector('.webch-host');
    const statusEl = root.querySelector('[data-sig-status]');
    const loadingEl = root.querySelector('.webch-loading');
    const loadingText = root.querySelector('.webch-loading-text');

    const onWinResize = () => syncBounds();
    const ro = new ResizeObserver(() => syncBounds());
    ro.observe(host);
    window.addEventListener('resize', onWinResize);

    active = { acc, host, ro, onWinResize, statusEl, loadingEl, opened: false, failed: false };

    api.open(acc.id).then((res) => {
      if (!active || active.acc !== acc || !root.isConnected) return;
      if (res && res.ok) {
        active.opened = true;
        loadingEl.classList.add('is-hidden');
        statusEl.textContent = 'Signal 会话已启动';
        syncBounds();
      } else {
        active.failed = true;
        loadingEl.classList.remove('is-hidden');
        loadingText.textContent = '无法启动 Signal 会话';
        statusEl.textContent = (res && res.error) || '启动失败';
      }
    }).catch(() => {
      if (!root.isConnected) return;
      if (active) active.failed = true;
      loadingEl.classList.remove('is-hidden');
      loadingText.textContent = '无法启动 Signal 会话';
      statusEl.textContent = '启动失败：服务不可用';
    });

    root.querySelector('[data-sig="refresh"]').addEventListener('click', () => {
      if (!isValid()) return;
      if (active) { active.failed = false; active.opened = true; }
      loadingEl.classList.remove('is-hidden');
      loadingText.textContent = '正在刷新…';
      statusEl.textContent = '刷新中…';
      api.open(acc.id).then((res) => {
        if (!active || active.acc !== acc || !root.isConnected) return;
        if (res && res.ok) { loadingEl.classList.add('is-hidden'); statusEl.textContent = 'Signal 会话已启动'; syncBounds(); }
        else { active.failed = true; loadingText.textContent = '刷新失败'; statusEl.textContent = (res && res.error) || '刷新失败'; }
      });
    });
    root.querySelector('[data-sig="sleep"]').addEventListener('click', () => {
      if (!isValid()) return;
      actions.setSleep(true);
    });
    root.querySelector('[data-sig="more"]').addEventListener('click', (e) => {
      if (!isValid()) return;
      const rect = e.currentTarget.getBoundingClientRect();
      actions.openMenu(acc.id, rect.right - 210, rect.bottom + 6);
    });

    return root;
  }

  window.HaituoSignal = Object.freeze({ supports, build, onBeforeRender, destroy, destroyAll });
})();
