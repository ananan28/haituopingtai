(() => {
  'use strict';

  // 应用设置（渲染层）：主题 / 自动更新 / 开机自启动 / 关闭行为。
  // 设置读写走 preload 暴露的 window.haituo.appSettings（独立 channel），持久化在主进程。

  const Access = window.HaituoAccess;
  const api = window.haituo && window.haituo.appSettings;
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const DEFAULTS = Object.freeze({ theme: 'dark', autoUpdate: true, openAtLogin: false, closeBehavior: 'quit' });
  const THEME_LABELS = { dark: '深色', light: '浅色', system: '跟随系统' };

  let cached = { settings: { ...DEFAULTS }, effectiveTheme: 'dark', packaged: false, version: '' };
  let updateState = null;

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme === 'light' ? 'light' : 'dark';
  }

  async function refresh() {
    if (!api) return;
    try {
      const res = await api.get();
      if (res && res.ok) {
        cached = res;
        applyTheme(res.effectiveTheme);
      }
    } catch { /* 忽略启动期读取失败 */ }
  }

  function updateStateText(p) {
    if (!p) return '';
    return { checking: '检查中…', available: '发现新版本 ' + (p.version || ''), 'not-available': '已是最新版本', downloading: '下载中 ' + Math.round(p.percent || 0) + '%', downloaded: '新版本已就绪，退出时安装', error: '更新出错：' + (p.message || '') }[p.state] || '';
  }

  async function apply(partial, statusEl) {
    if (!api) return;
    const res = await api.set(partial);
    if (res && res.ok) {
      cached = res;
      if (partial && partial.theme) applyTheme(res.effectiveTheme);
    } else if (statusEl) {
      statusEl.textContent = (res && res.error) || '保存失败';
    }
    return res;
  }

  function segment(root, attr, value) {
    root.querySelectorAll('[' + attr + ']').forEach((btn) => btn.classList.toggle('is-active', btn.getAttribute(attr) === value));
  }

  function page() {
    const AccessRef = Access;
    if (AccessRef && !AccessRef.can('appearance')) {
      const denied = document.createElement('div');
      denied.className = 'platform-page';
      denied.innerHTML = '<header class="platform-head"><div><span class="platform-eyebrow">HAITUO WORKSPACE</span><h1>应用设置</h1><p>当前身份未获此项授权</p></div></header><p class="platform-notice">隐藏入口同样受权限校验；请返回首页。</p>';
      return denied;
    }
    const s = cached.settings || { ...DEFAULTS };
    const root = document.createElement('div');
    root.className = 'platform-page';
    const badge = (AccessRef && AccessRef.get() && AccessRef.get().demo) ? '离线演示 · 不连接业务服务器' : '服务器身份 · 服务接入待部署';
    root.innerHTML = `
      <header class="platform-head">
        <div>
          <span class="platform-eyebrow">HAITUO WORKSPACE</span>
          <h1>应用设置</h1>
          <p>主题、自动更新、开机自启动与关闭行为；保存在本机，跟随当前安装。</p>
        </div>
        <span class="demo-badge">${esc(badge)}</span>
      </header>

      <section class="platform-card">
        <h2>主题</h2>
        <div class="as-seg" role="radiogroup" aria-label="主题">
          ${['dark', 'light', 'system'].map((v) => `<button class="as-seg-btn${s.theme === v ? ' is-active' : ''}" type="button" data-as-theme="${v}">${THEME_LABELS[v]}</button>`).join('')}
        </div>
        <p class="platform-notice">跟随系统时以操作系统深浅色为准；浅色为首轮覆盖，个别细节待完善。</p>
      </section>

      <section class="platform-card">
        <h2>自动更新</h2>
        <label class="hp-toggle">
          <span class="hp-toggle-copy"><strong>自动检查更新</strong><small>发布前经自测通过才会推送新版本包</small></span>
          <input id="as-autoupdate" type="checkbox" ${s.autoUpdate ? 'checked' : ''} />
          <span class="hp-switch"></span>
        </label>
        <div class="platform-links">
          <button class="hp-ghost" type="button" id="as-checkupdate">检查更新</button>
        </div>
        <p id="as-update-status" class="as-status" role="status"></p>
      </section>

      <section class="platform-card">
        <h2>开机自启动</h2>
        <label class="hp-toggle">
          <span class="hp-toggle-copy"><strong>登录后自动启动</strong><small>仅安装版生效；开发态只保存设置</small></span>
          <input id="as-autostart" type="checkbox" ${s.openAtLogin ? 'checked' : ''} />
          <span class="hp-switch"></span>
        </label>
        <p class="platform-notice">安装版会写入系统登录项；本地开发运行不写注册表。</p>
      </section>

      <section class="platform-card">
        <h2>关闭行为</h2>
        <div class="as-seg" role="radiogroup" aria-label="关闭行为">
          <button class="as-seg-btn${s.closeBehavior === 'quit' ? ' is-active' : ''}" type="button" data-as-close="quit">直接退出</button>
          <button class="as-seg-btn${s.closeBehavior === 'tray' ? ' is-active' : ''}" type="button" data-as-close="tray">最小化到系统托盘</button>
        </div>
        <p class="platform-notice">选择「最小化到系统托盘」后，点关闭按钮仅隐藏到托盘，程序在后台继续运行。</p>
      </section>
    `;

    const statusEl = root.querySelector('#as-update-status');

    root.querySelectorAll('[data-as-theme]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const res = await apply({ theme: btn.dataset.asTheme });
        if (res && res.ok) segment(root, 'data-as-theme', cached.settings.theme);
      });
    });
    root.querySelectorAll('[data-as-close]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const res = await apply({ closeBehavior: btn.dataset.asClose });
        if (res && res.ok) segment(root, 'data-as-close', cached.settings.closeBehavior);
      });
    });
    root.querySelector('#as-autoupdate').addEventListener('change', async (e) => {
      const res = await apply({ autoUpdate: e.target.checked });
      if (!res || !res.ok) e.target.checked = cached.settings.autoUpdate;
    });
    root.querySelector('#as-autostart').addEventListener('change', async (e) => {
      const res = await apply({ openAtLogin: e.target.checked });
      if (!res || !res.ok) e.target.checked = cached.settings.openAtLogin;
    });
    root.querySelector('#as-checkupdate').addEventListener('click', async () => {
      statusEl.textContent = '正在检查更新…';
      const res = await api.checkUpdate();
      statusEl.textContent = res.ok ? '已发起检查，结果稍后提示' : (res.error || '检查更新失败');
    });
    statusEl.textContent = updateStateText(updateState);

    return root;
  }

  // 启动即应用主题 + 订阅主题/更新推送（独立于页面是否打开）。
  if (api) {
    api.onTheme((p) => { if (p && p.theme) applyTheme(p.theme); });
    api.onUpdateState((p) => { updateState = p; });
    refresh();
  }

  Object.defineProperty(window, 'HaituoAppSettings', {
    value: Object.freeze({ page, applyTheme, refresh, state: () => ({ ...cached, updateState }) }),
    writable: false
  });
})();
