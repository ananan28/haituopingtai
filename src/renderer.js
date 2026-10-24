/* ---------- 基础数据 ---------- */

const FEATURES = window.HAITUO_FEATURES || [];
const PAGE_TABS = window.HAITUO_PAGE_TABS || [];
const TITLE_TOOLS = window.HAITUO_TITLE_TOOLS || [];
const CATALOG = window.HAITUO_CHANNEL_CATALOG || [];
const BRAND = (window.haituo && window.haituo.brand) || { name: '海拓商业版', version: '0.1.0' };
const ROLE_LABELS = { owner: '所有者', agent: '代理', user: '用户' };

const CHANNEL_ALIASES = {
  whatsapp: { name: 'WhatsApp', icon: 'W' },
  telegram: { name: 'Telegram', icon: 'T' },
  signal: { name: 'Signal', icon: 'S' },
  line: { name: 'LINE', icon: 'L' }
};

const STORAGE = {
  mode: 'haituo.workspace.mode',
  hidden: 'haituo.workspace.hiddenFeatures',
  drafts: 'haituo.channelDrafts'
};

document.title = BRAND.name;
document.querySelectorAll('[data-brand]').forEach((el) => { el.textContent = BRAND.name; });

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function channelMeta(id) {
  if (CHANNEL_ALIASES[id]) return CHANNEL_ALIASES[id];
  const found = CATALOG.find((c) => c.id === id);
  if (found) return { name: found.name, icon: found.icon };
  return { name: id, icon: String(id || '?').slice(0, 2).toUpperCase() };
}

function readStorage(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : raw;
  } catch {
    return fallback;
  }
}

function writeStorage(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* 本地存储不可用时仅当前会话生效 */
  }
}

/* ---------- 图标 ---------- */

const svg = (body) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

const ICONS = {
  edit: svg('<path d="M4 20h4L19 9l-4-4L4 16v4Z"/><path d="m14 6 4 4"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  search: svg('<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/>'),
  home: svg('<path d="m4 11 8-7 8 7"/><path d="M6.5 9.5V20h11V9.5"/><path d="M10 20v-5h4v5"/>'),
  settings: svg('<circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.4-2.3 1a7 7 0 0 0-1.7-1L14.5 3h-5l-.4 3.1a7 7 0 0 0-1.7 1l-2.3-1-2 3.4L5.1 11a7 7 0 0 0 0 2l-2 1.5 2 3.4 2.3-1a7 7 0 0 0 1.7 1l.4 3.1h5l.4-3.1a7 7 0 0 0 1.7-1l2.3 1 2-3.4-2-1.5c.1-.3.1-.6.1-1Z"/>'),
  tasks: svg('<rect x="4" y="4" width="16" height="16" rx="3"/><path d="m8 12 2.5 2.5L16 9"/>'),
  stats: svg('<path d="M4 20V4"/><path d="M4 20h16"/><path d="M8 16v-4M12 16V8M16 16v-6"/>'),
  bell: svg('<path d="M18 9a6 6 0 1 0-12 0c0 6-2 7-2 7h16s-2-1-2-7"/><path d="M10 20a2 2 0 0 0 4 0"/>'),
  support: svg('<path d="M4 13a8 8 0 0 1 16 0"/><path d="M4 13v3a2 2 0 0 0 2 2h1v-6H6a2 2 0 0 0-2 2Z"/><path d="M20 13v3a2 2 0 0 1-2 2h-1v-6h1a2 2 0 0 1 2 2Z"/><path d="M16 18v1a2 2 0 0 1-2 2h-2"/>'),
  moon: svg('<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z"/>'),
  sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4"/>'),
  globe: svg('<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17"/><path d="M12 3.5c2.5 2.4 3.7 5.2 3.7 8.5s-1.2 6.1-3.7 8.5c-2.5-2.4-3.7-5.2-3.7-8.5S9.5 5.9 12 3.5Z"/>'),
  lock: svg('<rect x="5" y="10" width="14" height="10" rx="2.5"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/><path d="M12 14v2"/>'),
  refresh: svg('<path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 4v5h-5"/>'),
  close: svg('<path d="m6 6 12 12M18 6 6 18"/>'),
  minimize: svg('<path d="M5 12h14"/>'),
  maximize: svg('<rect x="5.5" y="5.5" width="13" height="13" rx="1.5"/>'),
  chevronLeft: svg('<path d="m14 6-6 6 6 6"/>'),
  chevronRight: svg('<path d="m10 6 6 6-6 6"/>'),
  chevronDown: svg('<path d="m6 10 6 6 6-6"/>'),
  grid: svg('<rect x="4" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5"/>'),
  layoutH: svg('<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M3 9h18"/><path d="M8 9v11"/>'),
  layoutV: svg('<rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M3 9h18"/><path d="M10 9v11"/>'),
  collapse: svg('<path d="m14 7-5 5 5 5"/><path d="M19 5v14"/>'),
  chat: svg('<path d="M20 12a7.5 7.5 0 0 1-7.5 7.5H8L4 22v-5.2A7.5 7.5 0 1 1 20 12Z"/><path d="M8.5 11h7M8.5 14h4"/>'),
  translate: svg('<path d="M4 5h10M9 3v2c0 4-2 7-5 9"/><path d="M6 10c1.5 2.2 3.5 3.6 6 4.5"/><path d="m13 20 4-10 4 10"/><path d="M14.5 16.5h5"/>'),
  sliders: svg('<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>'),
  user: svg('<circle cx="12" cy="8" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/>'),
  megaphone: svg('<path d="M4 10v4a2 2 0 0 0 2 2h2l9 4V4l-9 4H6a2 2 0 0 0-2 2Z"/><path d="m9 16 1 4h3l-1-5"/>'),
  network: svg('<circle cx="12" cy="12" r="2.5"/><path d="M12 4v5.5M12 14.5V20M4 12h5.5M14.5 12H20"/><circle cx="12" cy="3.5" r="1.5"/><circle cx="12" cy="20.5" r="1.5"/><circle cx="3.5" cy="12" r="1.5"/><circle cx="20.5" cy="12" r="1.5"/>'),
  fingerprint: svg('<path d="M12 4a7 7 0 0 0-7 7v3"/><path d="M12 7a4 4 0 0 0-4 4v5"/><path d="M12 10a1.5 1.5 0 0 0-1.5 1.5V19"/><path d="M15.5 14v3a6 6 0 0 0 .6 2.6"/><path d="M19 11v4a9 9 0 0 1-.7 3.6"/>'),
  pen: svg('<path d="m4 20 4.5-1L20 7.5 16.5 4 5 15.5 4 20Z"/><path d="m14.5 6 3.5 3.5"/>'),
  chart: svg('<path d="M4 19h16"/><path d="M7 19v-6M12 19V7M17 19v-9"/><path d="m5 9 5-4 3 2 5-4"/>'),
  more: svg('<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>'),
  trending: svg('<path d="m4 16 5-5 3 3 7-8"/><path d="M15 6h4v4"/>'),
  crop: svg('<path d="M6 3v15h15"/><path d="M3 6h15v15"/>'),
  send: svg('<path d="m4 4 17 8-17 8 4-8-4-8Z"/><path d="M8 12h13"/>'),
  phone: svg('<path d="M7 3h3l1.5 4-2 1.5a13 13 0 0 0 6 6L17 12.5 21 14v3a4 4 0 0 1-4 4A14 14 0 0 1 3 7a4 4 0 0 1 4-4Z"/>'),
  mail: svg('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m4 7 8 6 8-6"/>'),
  qr: svg('<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><path d="M14 14h2v2h-2zM18 14h2M14 18h2M18 18h2v2h-2"/>'),
  paperclip: svg('<path d="m9 12 5.5-5.5a3 3 0 0 1 4 4L11 18a5 3 0 0 1-7-4l7-7"/>'),
  trash: svg('<path d="M4 7h16"/><path d="M9 7V5h6v2"/><path d="m6 7 1 13h10l1-13"/><path d="M10 11v5M14 11v5"/>'),
  wallet: svg('<rect x="3" y="6" width="18" height="13" rx="2.5"/><path d="M3 9h18"/><path d="M16 14h2"/>')
};

const FEATURE_ICONS = {
  'quick-reply': ICONS.chat,
  'basic-translate': ICONS.translate,
  'advanced-translate': ICONS.sliders,
  customer: ICONS.user,
  broadcast: ICONS.megaphone,
  proxy: ICONS.network,
  fingerprint: ICONS.fingerprint,
  translate: ICONS.translate,
  writing: ICONS.pen,
  fans: ICONS.chart,
  other: ICONS.more,
  reminder: ICONS.bell,
  trade: ICONS.trending,
  screenshot: ICONS.crop
};

const TITLE_ICONS = {
  edit: ICONS.edit,
  add: ICONS.plus,
  search: ICONS.search,
  home: ICONS.home,
  settings: ICONS.settings,
  tasks: ICONS.tasks,
  stats: ICONS.stats,
  bell: ICONS.bell,
  support: ICONS.support,
  moon: ICONS.moon,
  language: ICONS.globe,
  lock: ICONS.lock
};

/* ---------- DOM ---------- */

const authView = document.getElementById('auth-view');
const appView = document.getElementById('app-view');
const configNotice = document.getElementById('config-notice');
const authTitle = document.getElementById('auth-title');
const tabLogin = document.getElementById('tab-login');
const tabRegister = document.getElementById('tab-register');
const authForm = document.getElementById('auth-form');
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const authMsg = document.getElementById('auth-msg');
const authSubmit = document.getElementById('auth-submit');
const loginOnly = document.getElementById('login-only');
const oauthBlock = document.getElementById('oauth-block');
const forgotPassword = document.getElementById('forgot-password');
const googleLogin = document.getElementById('google-login');
const demoLogin = document.getElementById('demo-login');
const demoHint = document.getElementById('demo-hint');

const titleTools = document.getElementById('title-tools');
const acctChips = document.getElementById('acct-chips');
const railAccounts = document.getElementById('rail-accounts');
const railFeatures = document.getElementById('rail-features');
const railCount = document.getElementById('rail-count');
const pageTabs = document.getElementById('page-tabs');
const content = document.getElementById('content');
const acctAdd = document.getElementById('acct-add');
const railAdd = document.getElementById('rail-add');
const refreshBtn = document.getElementById('refresh-btn');
const userTrigger = document.getElementById('user-trigger');
const userMenu = document.getElementById('user-menu');
const userAvatar = document.getElementById('user-avatar');
const userName = document.getElementById('user-name');
const roleBadge = document.getElementById('role-badge');

const fxRailTop = document.getElementById('fx-rail-top');
const fxPanel = document.getElementById('fx-panel');
const fxPanelKicker = document.getElementById('fx-panel-kicker');
const fxPanelTitle = document.getElementById('fx-panel-title');
const fxPanelBody = document.getElementById('fx-panel-body');
const fxPanelClose = document.getElementById('fx-panel-close');
const fxManage = document.getElementById('fx-manage');
const fxManager = document.getElementById('fx-manager');
const fxRestore = document.getElementById('fx-restore');
const modeToggle = document.getElementById('mode-toggle');
const collapseBtn = document.getElementById('collapse-btn');
const floatBall = document.getElementById('float-ball');
const floatBadge = document.getElementById('float-badge');
const contextMenu = document.getElementById('context-menu');

const channelCatalog = document.getElementById('channel-catalog');
const catalogGrid = document.getElementById('catalog-grid');
const catalogSearch = document.getElementById('catalog-search');
const catalogCount = document.getElementById('catalog-count');
const channelConfig = document.getElementById('channel-config');
const channelForm = document.getElementById('channel-form');
const cfgChannelIcon = document.getElementById('cfg-channel-icon');
const cfgTitle = document.getElementById('cfg-title');
const cfgName = document.getElementById('cfg-name');
const cfgCount = document.getElementById('cfg-count');
const cfgUrlWrap = document.getElementById('cfg-url-wrap');
const cfgUrl = document.getElementById('cfg-url');
const cfgSendTr = document.getElementById('cfg-send-tr');
const cfgRecvTr = document.getElementById('cfg-recv-tr');
const cfgGroupTr = document.getElementById('cfg-group-tr');
const cfgFingerprint = document.getElementById('cfg-fingerprint');
const cfgRegion = document.getElementById('cfg-region');
const cfgLang = document.getElementById('cfg-lang');
const cfgBrowser = document.getElementById('cfg-browser');
const cfgProxyMode = document.getElementById('cfg-proxy-mode');
const cfgProxy = document.getElementById('cfg-proxy');
const cfgCookie = document.getElementById('cfg-cookie');
const accountEditModal = document.getElementById('account-edit');
const editForm = document.getElementById('edit-form');
const editName = document.getElementById('edit-name');
const editAvatar = document.getElementById('edit-avatar');
const editAvatarPreview = document.getElementById('edit-avatar-preview');
const editNamePreview = document.getElementById('edit-name-preview');
const editSubPreview = document.getElementById('edit-sub-preview');
const quotaModal = document.getElementById('quota-modal');
const quotaBody = document.getElementById('quota-body');
const quotaRecharge = document.getElementById('quota-recharge');
const sheetModal = document.getElementById('sheet-modal');
const sheetTitle = document.getElementById('sheet-title');
const sheetBody = document.getElementById('sheet-body');

/* ---------- 状态 ---------- */

const state = {
  user: null,
  role: 'user',
  demo: false,
  accounts: [],
  activeId: null,
  view: 'account',
  mode: readStorage(STORAGE.mode, 'horizontal') === 'vertical' ? 'vertical' : 'horizontal',
  fxOpen: false,
  fxId: 'quick-reply',
  hiddenFx: (() => {
    try {
      const list = JSON.parse(readStorage(STORAGE.hidden, '[]'));
      return Array.isArray(list) ? list.filter((id) => FEATURES.some((f) => f.id === id)) : [];
    } catch {
      return [];
    }
  })(),
  collapsed: false,
  sysUnread: 3,
  pendingChannel: null,
  editingId: null
};

let globalToastTimer = null;

function showGlobalToast(text) {
  let el = document.getElementById('global-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'global-toast';
    el.className = 'global-toast';
    document.body.appendChild(el);
  }
  el.textContent = text;
  el.classList.add('is-show');
  clearTimeout(globalToastTimer);
  globalToastTimer = setTimeout(() => el.classList.remove('is-show'), 2200);
}

function activeAccount() {
  return state.accounts.find((a) => a.id === state.activeId) || null;
}

/* ---------- 窗口控制 ---------- */

function paintWindowButtons() {
  const map = {
    'win-min': ICONS.minimize,
    'win-max': ICONS.maximize,
    'win-close': ICONS.close,
    'auth-win-min': ICONS.minimize,
    'auth-win-max': ICONS.maximize,
    'auth-win-close': ICONS.close
  };
  Object.entries(map).forEach(([id, icon]) => {
    const btn = document.getElementById(id);
    if (btn) btn.innerHTML = icon;
  });
}

function bindWindowControls() {
  const api = window.haituo && window.haituo.windowControls;
  if (!api) return;
  const pairs = [
    ['win-min', 'minimize'],
    ['win-max', 'toggleMaximize'],
    ['win-close', 'close'],
    ['auth-win-min', 'minimize'],
    ['auth-win-max', 'toggleMaximize'],
    ['auth-win-close', 'close']
  ];
  pairs.forEach(([id, action]) => {
    const btn = document.getElementById(id);
    if (btn) btn.addEventListener('click', () => api[action]());
  });
}

/* ---------- 认证 ---------- */

let authMode = 'login';

function setMode(next) {
  authMode = next;
  tabLogin.classList.toggle('is-active', next === 'login');
  tabRegister.classList.toggle('is-active', next === 'register');
  authSubmit.textContent = next === 'login' ? '登录' : '注册';
  authTitle.textContent = next === 'login' ? '会员登录' : '立即注册';
  loginOnly.hidden = next !== 'login';
  oauthBlock.hidden = next !== 'login';
}

function setAuthMessage(text, isOk) {
  authMsg.textContent = text || '';
  authMsg.classList.toggle('is-ok', Boolean(text) && Boolean(isOk));
}

function showAuth(message, isOk) {
  closeAllOverlays();
  state.demo = false;
  appView.classList.remove('is-active');
  authView.classList.add('is-active');
  setAuthMessage(message, isOk);
}

function showApp(user) {
  const email = (user && user.email) || (typeof user === 'string' ? user : '') || '';
  const role = (user && user.role) || 'user';
  const demo = Boolean(user && user.demo);
  state.user = { email, role, demo };
  state.role = role;
  state.demo = demo;

  authView.classList.remove('is-active');
  appView.classList.add('is-active');
  userAvatar.textContent = demo ? '演' : email.charAt(0).toUpperCase();
  userName.textContent = demo ? '离线演示账号' : email;
  roleBadge.textContent = demo ? '离线演示' : (ROLE_LABELS[role] || role);
  roleBadge.dataset.role = demo ? 'demo' : role;
  roleBadge.title = demo ? '本地演示数据 · 所有者权限' : '';
  setAuthMessage('');

  enterWorkspace();
}

function enterWorkspace() {
  state.accounts = (window.HAITUO_ACCOUNTS || []).map((a) => ({
    ...a,
    ui: { font: 'md', density: 3, ...(a.ui || {}) }
  }));
  state.activeId = state.accounts[0] ? state.accounts[0].id : null;
  state.view = 'account';
  state.fxOpen = false;
  state.collapsed = false;
  state.editingId = null;

  document.getElementById('tb-version').textContent = BRAND.version || '0.1.0';
  appView.classList.remove('fx-open', 'fx-collapsed');
  fxRestore.hidden = true;
  collapseBtn.innerHTML = ICONS.collapse;
  collapseBtn.title = '收纳快捷功能栏';
  applyMode(state.mode, false);
  paintTitleTools();
  renderRailFeatures();
  renderAccounts();
  renderPageTabs();
  renderContent();
  buildUserMenu();
  renderFxManager();
  syncRailActive();
}

function paintTitleTools() {
  titleTools.innerHTML = TITLE_TOOLS.map((tool) =>
    `<button class="tb-tool" type="button" data-tool="${escapeHtml(tool.id)}" title="${escapeHtml(tool.name)}" aria-label="${escapeHtml(tool.name)}">${TITLE_ICONS[tool.id] || ICONS.more}</button>`
  ).join('');
}

/* ---------- 账号 ---------- */

function accountStatusLabel(acc) {
  if (!acc.loggedIn) return '待登录';
  return acc.status === 'sleep' ? '已休眠' : '运行中';
}

function chipHtml(acc) {
  const meta = channelMeta(acc.channel);
  const active = state.view === 'account' && acc.id === state.activeId;
  const font = acc.ui && acc.ui.font ? acc.ui.font : 'md';
  const density = acc.ui && acc.ui.density ? acc.ui.density : 3;
  return `<button class="acct-chip fs-${escapeHtml(font)} den-${density}${active ? ' is-active' : ''}${acc.status === 'sleep' ? ' is-sleeping' : ''}" type="button" role="tab" aria-selected="${active}" data-account="${escapeHtml(acc.id)}" title="${escapeHtml(acc.name)} · ${escapeHtml(meta.name)}">
    <span class="ch-tile acct-avatar" data-channel="${escapeHtml(acc.channel)}">${escapeHtml(acc.avatar || meta.icon)}<i class="acct-presence"></i></span>
    <span class="acct-meta">
      <span class="acct-name">${escapeHtml(acc.name)}</span>
      <span class="acct-sub">${escapeHtml(meta.name)} · ${escapeHtml(accountStatusLabel(acc))}</span>
    </span>
    ${acc.unread ? `<span class="acct-badge">${acc.unread}</span>` : ''}
    <span class="acct-more" data-more="${escapeHtml(acc.id)}" title="账号菜单">⋯</span>
  </button>`;
}

function railAccountHtml(acc) {
  const meta = channelMeta(acc.channel);
  const active = state.view === 'account' && acc.id === state.activeId;
  return `<button class="rail-account${active ? ' is-active' : ''}${acc.status === 'sleep' ? ' is-sleeping' : ''}" type="button" data-account="${escapeHtml(acc.id)}" title="${escapeHtml(acc.name)}">
    <span class="ch-tile rail-avatar" data-channel="${escapeHtml(acc.channel)}">${escapeHtml(acc.avatar || meta.icon)}<i class="acct-presence"></i></span>
    <span class="rail-account-copy">
      <strong>${escapeHtml(acc.name)}</strong>
      <small>${escapeHtml(meta.name)} · ${escapeHtml(accountStatusLabel(acc))}</small>
    </span>
    ${acc.unread ? `<span class="acct-badge">${acc.unread}</span>` : ''}
    <span class="rail-account-more" data-more="${escapeHtml(acc.id)}" title="账号菜单">⋯</span>
  </button>`;
}

function revealActiveChip() {
  const chip = acctChips.querySelector('.acct-chip.is-active');
  if (chip) {
    requestAnimationFrame(() => chip.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
  }
}

function renderAccounts() {
  railCount.textContent = String(state.accounts.length);
  acctChips.innerHTML = state.accounts.length
    ? state.accounts.map(chipHtml).join('')
    : '<button class="acct-empty" type="button" data-add-channel>+ 添加第一个渠道账号</button>';
  railAccounts.innerHTML = state.accounts.length
    ? state.accounts.map(railAccountHtml).join('')
    : '<p class="rail-empty">暂无账号，点击右上角 + 添加</p>';
  syncRailActive();
  revealActiveChip();
}

function selectAccount(id) {
  if (!state.accounts.some((a) => a.id === id)) return;
  state.activeId = id;
  state.view = 'account';
  renderAccounts();
  renderPageTabs();
  renderContent();
  closeAccountMenu();
  userMenu.hidden = true;
}

function bindAccountContainer(container) {
  container.addEventListener('click', (e) => {
    const more = e.target.closest('[data-more]');
    if (more) {
      e.stopPropagation();
      const rect = more.getBoundingClientRect();
      openAccountMenu(more.dataset.more, rect.left - 160, rect.bottom + 6);
      return;
    }
    const chip = e.target.closest('[data-account]');
    if (chip) selectAccount(chip.dataset.account);
  });
  container.addEventListener('contextmenu', (e) => {
    const chip = e.target.closest('[data-account]');
    if (!chip) return;
    e.preventDefault();
    openAccountMenu(chip.dataset.account, e.clientX, e.clientY);
  });
}

/* ---------- 页签 / 内容 ---------- */

function renderPageTabs() {
  pageTabs.innerHTML = PAGE_TABS.map((tab) => {
    const active = state.view === tab.id;
    let badge = tab.badge || 0;
    if (tab.id === 'system') badge = state.sysUnread;
    if (tab.id === 'accounts') badge = state.accounts.length;
    return `<button class="page-tab${active ? ' is-active' : ''}" type="button" data-page="${escapeHtml(tab.id)}">
      <span>${escapeHtml(tab.name)}</span>${badge ? `<span class="page-tab-badge">${badge}</span>` : ''}
    </button>`;
  }).join('');
}

function pageTabsClick(e) {
  const btn = e.target.closest('[data-page]');
  if (!btn) return;
  const id = btn.dataset.page;
  if (!PAGE_TABS.some((t) => t.id === id)) return;
  state.view = id;
  renderAccounts();
  renderPageTabs();
  renderContent();
}

function pageWrap(node) {
  const wrap = document.createElement('div');
  wrap.className = 'wp';
  wrap.appendChild(node);
  return wrap;
}

function renderContent() {
  content.innerHTML = '';
  const isAccount = state.view === 'account';
  content.classList.toggle('is-embed', isAccount);
  content.classList.toggle('is-page', !isAccount);
  appView.classList.toggle('view-account', isAccount);

  if (isAccount) {
    const acc = activeAccount();
    content.appendChild(acc ? buildEmbed(acc) : buildEmptyWorkspace());
    return;
  }
  if (state.view === 'recharge') content.appendChild(pageWrap(buildRechargePage()));
  else if (state.view === 'tg') content.appendChild(pageWrap(buildTgPage()));
  else if (state.view === 'system') content.appendChild(pageWrap(buildSystemPage()));
  else if (state.view === 'accounts') content.appendChild(pageWrap(buildAccountsPage()));
  else content.appendChild(pageWrap(buildEmptyWorkspace()));
}

/* ---------- 内嵌区 ---------- */

const EMBED_SCRIPTS = {
  telegram: [
    { side: 'in', name: '陈伟', avatar: '陈', time: '10:02', text: '文件已经发到你的邮箱，请查收。', tr: '文件已发送至您的邮箱，请查收。' },
    { side: 'out', name: '我', avatar: '我', time: '10:04', text: '收到，我今天核对样品单，明天给你确认数量。', tr: 'Bien reçu, je vérifie la liste d’échantillons aujourd’hui et je confirme la quantité demain.' },
    { side: 'in', name: '陈伟', avatar: '陈', time: '10:06', text: '好的，数量确认后我安排顺丰寄出。', tr: '好的，数量确认后我再安排顺丰寄出。' }
  ],
  signal: [
    { side: 'in', name: 'Sophie Bernard', avatar: 'SB', time: '昨天 18:20', text: 'Merci pour le devis, je le transmets à mon responsable.', tr: '谢谢您的报价，我转交给负责人。' },
    { side: 'out', name: '我', avatar: '我', time: '昨天 18:26', text: '好的，如果需要调整数量或交期，随时告诉我。', tr: 'Très bien, n’hésitez pas à me dire si vous devez ajuster la quantité ou le délai.' },
    { side: 'in', name: 'Sophie Bernard', avatar: 'SB', time: '昨天 18:31', text: 'Parfait, je reviens vers vous demain.', tr: '太好了，我明天再联系您。' }
  ],
  whatsapp: [
    { side: 'in', name: 'Léa Martin', avatar: 'LM', time: '09:44', text: "Modèle X200, livraison à Lyon. Le client est pressé, c'est pour un événement.", tr: '型号 X200，配送到里昂。客户比较着急，是活动要用的。' },
    { side: 'out', name: '我', avatar: '我', time: '09:46', text: '收到。X200 有现货，报价 12.8 欧元/件，里昂市区 48 小时送达。', tr: 'Bien reçu. Le X200 est en stock, à 12,80 € pièce, livraison à Lyon sous 48 h.' },
    { side: 'in', name: 'Léa Martin', avatar: 'LM', time: '09:48', text: 'Parfait, merci beaucoup ! Je confirme la commande.', tr: '太好了，非常感谢！我确认下单。' }
  ]
};

function embedScript(acc) {
  const key = Object.keys(EMBED_SCRIPTS).find((k) => acc.channel.startsWith(k));
  return EMBED_SCRIPTS[key] || EMBED_SCRIPTS.whatsapp;
}

function embedHeadHtml(acc) {
  const meta = channelMeta(acc.channel);
  const status = accountStatusLabel(acc);
  return `<header class="em-head">
    <div class="em-peer">
      <span class="ch-tile em-tile" data-channel="${escapeHtml(acc.channel)}">${escapeHtml(acc.avatar || meta.icon)}</span>
      <div class="em-title">
        <strong>${escapeHtml(acc.name)}
          <span class="em-status ${acc.status === 'sleep' ? 'is-sleep' : 'is-live'}">${escapeHtml(status)}</span>
        </strong>
        <small>${escapeHtml(meta.name)} · ${escapeHtml(acc.account)}
          <span class="em-partition">${escapeHtml(acc.partition)}</span>
        </small>
      </div>
    </div>
    <div class="em-actions">
      <span class="em-embed-note">内嵌 WebView · 独立会话分区</span>
      <button class="bar-icon" type="button" data-em-refresh title="刷新服务">${ICONS.refresh}</button>
      <button class="bar-icon" type="button" data-more="${escapeHtml(acc.id)}" title="账号菜单">${ICONS.more}</button>
    </div>
  </header>`;
}

function fakeQr() {
  let cells = '';
  const finderOn = (r, c) => {
    const rr = r < 7 ? r : r - 14;
    const cc = c < 7 ? c : c - 14;
    return rr === 0 || rr === 6 || cc === 0 || cc === 6 || (rr >= 2 && rr <= 4 && cc >= 2 && cc <= 4);
  };
  for (let r = 0; r < 21; r++) {
    for (let c = 0; c < 21; c++) {
      const inFinder = (r < 7 && c < 7) || (r < 7 && c > 13) || (r > 13 && c < 7);
      const on = inFinder ? finderOn(r, c) : ((r * 7 + c * 11 + r * c) % 5) < 2;
      cells += `<i class="${on ? 'on' : ''}"></i>`;
    }
  }
  return `<div class="fake-qr" aria-hidden="true">${cells}</div>`;
}

function buildEmbed(acc) {
  const root = document.createElement('div');
  root.className = 'em';
  root.innerHTML = embedHeadHtml(acc);

  if (acc.status === 'sleep') {
    root.innerHTML += `<div class="em-state">
      <span class="em-state-icon">${ICONS.moon}</span>
      <h2>服务已休眠</h2>
      <p>${escapeHtml(acc.name)} 的后台进程与内存已释放，唤醒后恢复登录态与会话。</p>
      <span class="em-state-meta">独立分区 ${escapeHtml(acc.partition)} · ${acc.unread || 0} 条未读</span>
      <button class="hp-primary em-state-btn" type="button" data-wake="${escapeHtml(acc.id)}">唤醒服务</button>
    </div>`;
    root.querySelector('[data-wake]').addEventListener('click', () => {
      acc.status = 'online';
      renderAccounts();
      renderContent();
      renderPageTabs();
      showGlobalToast('服务已唤醒：' + acc.name);
    });
    bindEmbedHead(root, acc);
    return root;
  }

  if (!acc.loggedIn) {
    const meta = channelMeta(acc.channel);
    root.innerHTML += `<div class="em-login">
      <div class="login-card">
        <span class="ch-tile login-channel" data-channel="${escapeHtml(acc.channel)}">${escapeHtml(acc.avatar || meta.icon)}</span>
        <h2>登录 ${escapeHtml(meta.name)} 账号</h2>
        <p>为 ${escapeHtml(acc.name)} 分配独立会话分区，Cookie、指纹与缓存互不影响。</p>
        <div class="login-tabs">
          <button type="button" class="is-active" data-login-tab="qr">二维码</button>
          <button type="button" data-login-tab="phone">手机号</button>
          <button type="button" data-login-tab="email">邮箱</button>
        </div>
        <div data-login-pane="qr">
          ${fakeQr()}
          <span class="login-hint">打开手机 App 扫码登录</span>
          <button class="hp-primary" type="button" data-login-sim>模拟扫码成功</button>
        </div>
        <div data-login-pane="phone" hidden>
          <label class="cfg-label">手机号
            <input class="fx-input" type="tel" placeholder="+33 6 12 34 56 78" />
          </label>
          <button class="hp-primary" type="button" data-login-sim>发送验证码并登录</button>
        </div>
        <div data-login-pane="email" hidden>
          <label class="cfg-label">邮箱
            <input class="fx-input" type="email" placeholder="name@company.com" />
          </label>
          <label class="cfg-label">密码
            <input class="fx-input" type="password" placeholder="••••••••" />
          </label>
          <button class="hp-primary" type="button" data-login-sim>登录</button>
        </div>
        <span class="login-foot">${escapeHtml(acc.partition)} · 登录后进入内嵌 WebView</span>
      </div>
    </div>`;
    root.querySelectorAll('[data-login-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        root.querySelectorAll('[data-login-tab]').forEach((b) => b.classList.toggle('is-active', b === btn));
        root.querySelectorAll('[data-login-pane]').forEach((pane) => {
          pane.hidden = pane.dataset.loginPane !== btn.dataset.loginTab;
        });
      });
    });
    root.querySelectorAll('[data-login-sim]').forEach((btn) => {
      btn.addEventListener('click', () => {
        acc.loggedIn = true;
        acc.account = '已授权 · ' + acc.partition.slice(-4);
        renderAccounts();
        renderContent();
        showGlobalToast('登录成功（演示）：' + acc.name);
      });
    });
    bindEmbedHead(root, acc);
    return root;
  }

  const meta = channelMeta(acc.channel);
  const messages = embedScript(acc);
  const listHtml = messages.map((m) => `<div class="em-msg ${m.side === 'out' ? 'is-out' : ''}">
    <span class="em-msg-avatar${m.side === 'out' ? ' is-me' : ''}">${escapeHtml(m.avatar)}</span>
    <div class="em-msg-main">
      <div class="em-msg-meta"><span>${escapeHtml(m.name)}</span><span>${escapeHtml(m.time)}</span></div>
      <div class="em-bubble">${escapeHtml(m.text)}</div>
      ${m.tr ? `<div class="em-tr"><span class="em-tr-tag">译</span><span>${escapeHtml(m.tr)}</span></div>` : ''}
    </div>
  </div>`).join('');

  root.innerHTML += `<div class="em-body">
      <div class="em-date">今天 · 内嵌会话演示</div>
      <div class="em-messages">${listHtml}</div>
    </div>
    <footer class="em-composer">
      <div class="em-composer-box">
        <button class="em-tool" type="button" data-em-attach title="附件">${ICONS.paperclip}</button>
        <textarea id="em-input" rows="1" placeholder="输入消息，Enter 发送，Shift + Enter 换行"></textarea>
        <button class="em-send" type="button" disabled>发送</button>
      </div>
      <div class="em-composer-meta">
        <span id="em-count">已输入 0 字符</span>
        <span>发送后按字符计费 · M4 接入</span>
        <span class="em-demo">演示会话 · 不连接真实渠道 · ${escapeHtml(meta.name)}</span>
      </div>
    </footer>`;

  bindEmbedHead(root, acc);

  const body = root.querySelector('.em-body');
  const list = root.querySelector('.em-messages');
  const input = root.querySelector('#em-input');
  const send = root.querySelector('.em-send');
  const count = root.querySelector('#em-count');
  const attach = root.querySelector('[data-em-attach]');

  function updateComposer() {
    const n = input.value.length;
    count.textContent = '已输入 ' + n + ' 字符';
    send.disabled = n === 0;
  }

  function pushOutgoing() {
    const text = input.value.trim();
    if (!text) return;
    const now = new Date();
    const time = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
    const row = document.createElement('div');
    row.className = 'em-msg is-out';
    row.innerHTML = `<span class="em-msg-avatar is-me">我</span>
      <div class="em-msg-main">
        <div class="em-msg-meta"><span>我</span><span>${time}</span></div>
        <div class="em-bubble">${escapeHtml(text)}</div>
      </div>`;
    list.appendChild(row);
    input.value = '';
    updateComposer();
    body.scrollTop = body.scrollHeight;
    showGlobalToast('已加入演示会话（不发送到真实渠道）');
  }

  input.addEventListener('input', updateComposer);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      pushOutgoing();
    }
  });
  send.addEventListener('click', pushOutgoing);
  attach.addEventListener('click', () => showGlobalToast('附件功能待接入'));
  requestAnimationFrame(() => { body.scrollTop = body.scrollHeight; });
  return root;
}

function bindEmbedHead(root, acc) {
  const refresh = root.querySelector('[data-em-refresh]');
  if (refresh) {
    refresh.addEventListener('click', () => {
      refresh.classList.add('is-spinning');
      setTimeout(() => refresh.classList.remove('is-spinning'), 650);
      showGlobalToast('正在刷新 ' + acc.name + '（演示）');
    });
  }
  const more = root.querySelector('[data-more]');
  if (more) {
    more.addEventListener('click', () => {
      const rect = more.getBoundingClientRect();
      openAccountMenu(acc.id, rect.right - 210, rect.bottom + 6);
    });
  }
}

function buildEmptyWorkspace() {
  const wrap = document.createElement('div');
  wrap.className = 'em';
  wrap.innerHTML = `<div class="em-state">
    <span class="em-state-icon">${ICONS.plus}</span>
    <h2>还没有渠道账号</h2>
    <p>从 20+ 渠道目录中添加账号，每个账号拥有独立的内嵌 WebView 会话分区。</p>
    <button class="hp-primary em-state-btn" type="button" data-add-channel>+ 添加渠道账号</button>
  </div>`;
  return wrap;
}

/* ---------- 页签内容 ---------- */

const RECHARGE_PACKAGES = [
  { id: 'starter', name: '体验包', price: '9.9', chars: '50 万', unit: '0.0198 元 / 千字符', desc: '适合个人试用与小批量沟通' },
  { id: 'standard', name: '标准包', price: '49', chars: '300 万', unit: '0.0163 元 / 千字符', desc: '适合小团队日常跨境沟通', badge: '热门' },
  { id: 'pro', name: '专业包', price: '199', chars: '1500 万', unit: '0.0133 元 / 千字符', desc: '适合高频业务与多账号运营', badge: '最划算' }
];

function buildRechargePage() {
  const wrap = document.createElement('div');
  wrap.className = 'rc';
  const packages = RECHARGE_PACKAGES.map((p) =>
    `<article class="rc-package${p.badge === '热门' ? ' is-featured' : ''}">
      ${p.badge ? `<span class="rc-badge">${p.badge}</span>` : ''}
      <h3>${p.name}</h3>
      <div class="rc-price"><span>¥</span>${p.price}</div>
      <div class="rc-chars">${p.chars} 字符</div>
      <div class="rc-unit">${p.unit}</div>
      <p>${p.desc}</p>
      <button type="button" class="rc-buy" data-toast="支付通道接入中：${p.name} · ${p.chars} 字符">立即充值</button>
    </article>`
  ).join('');

  wrap.innerHTML = `<div class="rc-head">
      <div><h1>充值中心</h1><p>按字符计费 · 额度可分配给子账号 · 代理分成自动计入</p></div>
      <span class="demo-badge">演示数据</span>
    </div>
    <section class="rc-wallet">
      <div class="rc-wallet-main">
        <div class="rc-label">字符余额</div>
        <div class="rc-balance">1,284,600 <span>字符</span></div>
        <div class="rc-sub">免费额度 100,000 字符 · 本月已用 32,400 字符</div>
        <div class="rc-progress"><span></span></div>
      </div>
      <div class="rc-wallet-side">
        <div><span>渠道账号</span><strong>${state.accounts.length} 个</strong></div>
        <div><span>翻译池</span><strong>2 个</strong></div>
        <div><span>额度有效期</span><strong>2026-12-31</strong></div>
      </div>
    </section>
    <div class="rc-section-head"><h2>充值套餐</h2><span>低至 0.0133 元 / 千字符</span></div>
    <div class="rc-packages">${packages}</div>
    <div class="rc-grid">
      <section class="rc-card">
        <h3>额度规则</h3>
        <ul class="rc-list">
          <li>仅翻译成功时按原文字符数扣费</li>
          <li>免费额度用完后自动使用付费余额</li>
          <li>额度可分配给子账号，0 表示不限量</li>
          <li>额度支持起止有效期，到期自动停用</li>
        </ul>
      </section>
      <section class="rc-card">
        <h3>代理分销</h3>
        <p>直客与间客佣金按代理比例自动计入分成，提现入口在代理中心。</p>
        <button type="button" class="rc-ghost" data-toast="代理分成规则待接入（直客 / 间客 / 提现）">查看分成规则</button>
      </section>
    </div>
    <p class="rc-footnote">支付通道尚未接入，本页金额与余额为界面演示数据；计费表结构已准备（M4）。</p>`;
  return wrap;
}

const TG_POSTS = [
  { time: '12 分钟前', text: '法国批发渠道本周上新：X200 现货 320 件，里昂仓 48 小时送达。需要报价单的客户可直接回复本频道。', views: '1.8k', likes: 46 },
  { time: '今天 08:40', text: '汇率提醒：EUR / CNY 7.82，较昨日 +0.4%。本周计划结算的客户可以关注一下。', views: '962', likes: 21 },
  { time: '昨天 21:15', text: '售后说明：节假日期间物流时效延长 1–2 天，急单请提前备注。', views: '2.4k', likes: 63 }
];

function buildTgPage() {
  const wrap = document.createElement('div');
  wrap.className = 'tg-page';
  wrap.innerHTML = `<div class="wp-head">
      <div><h1>TG频道</h1><p>频道内容同步、素材发布与互动数据概览（演示）</p></div>
      <div class="wp-actions">
        <button class="hp-ghost" type="button" data-toast="频道数据已刷新（演示）">刷新数据</button>
        <button class="hp-primary" type="button" data-toast="新建频道帖子（演示）">发布内容</button>
      </div>
    </div>
    <section class="tg-hero">
      <span class="ch-tile tg-hero-icon" data-channel="telegram-k">TK</span>
      <div class="tg-hero-copy">
        <strong>海拓 · 法国批发频道</strong>
        <span>@haituo_france · 私有频道 · 2 位管理员</span>
      </div>
      <div class="tg-stats">
        <div><strong>8,420</strong><span>订阅</span></div>
        <div><strong>12</strong><span>本周发帖</span></div>
        <div><strong>4.6%</strong><span>互动率</span></div>
      </div>
    </section>
    <div class="wp-section-head"><h2>最近发布</h2><span class="wp-muted">自动同步 · 每 5 分钟</span></div>
    <div class="tg-posts">
      ${TG_POSTS.map((p) => `<article class="tg-post">
        <header><span class="ch-tile tg-post-avatar" data-channel="telegram-k">TK</span>
          <div><strong>海拓 · 法国批发频道</strong><span>${p.time}</span></div>
          <button class="bar-icon" type="button" data-toast="帖子操作（演示）">${ICONS.more}</button>
        </header>
        <p>${escapeHtml(p.text)}</p>
        <div class="tg-post-cover"></div>
        <footer><span>${ICONS.chart} ${p.views}</span><span>${p.likes} 互动</span><span class="tg-sync">已同步</span></footer>
      </article>`).join('')}
    </div>`;
  return wrap;
}

const SYSTEM_MESSAGES = [
  { tag: '充值', title: '充值到账提醒', text: '标准包 ¥49 · 300 万字符已到账，当前余额 1,284,600 字符。', time: '今天 09:12' },
  { tag: '分销', title: '新用户分配', text: '代理 anan@haituo.app 名下新增 1 位用户，分成比例 30%。', time: '今天 08:36' },
  { tag: '系统', title: '版本更新', text: '工作台布局升级：账号 chips 顶排 + 功能右栏 + 内嵌全宽。', time: '昨天 22:04' },
  { tag: '安全', title: '异地登录提醒', text: '账号 owner@haituo.app 在 Windows 设备登录，如非本人请立即修改密码。', time: '昨天 19:41' }
];

function buildSystemPage() {
  const wrap = document.createElement('div');
  wrap.className = 'sys-page';
  wrap.innerHTML = `<div class="wp-head">
      <div><h1>系统消息</h1><p>充值、分销、账号安全与平台更新通知</p></div>
      <div class="wp-actions">
        <button id="sys-read-all" class="hp-ghost" type="button"${state.sysUnread ? '' : ' disabled'}>全部标为已读</button>
      </div>
    </div>
    <div class="sys-list">
      ${SYSTEM_MESSAGES.map((m, i) => `<article class="sys-item${i < state.sysUnread ? ' is-unread' : ''}">
        <span class="sys-dot"></span>
        <div class="sys-main">
          <header><span class="sys-tag">${m.tag}</span><strong>${escapeHtml(m.title)}</strong><time>${m.time}</time></header>
          <p>${escapeHtml(m.text)}</p>
        </div>
      </article>`).join('')}
    </div>`;
  const readAll = wrap.querySelector('#sys-read-all');
  readAll.addEventListener('click', () => {
    if (!state.sysUnread) return;
    state.sysUnread = 0;
    renderPageTabs();
    renderContent();
    showGlobalToast('系统消息已全部标为已读');
  });
  return wrap;
}

function quotaFor(acc) {
  const used = 18000 + (acc.name.length * 1300) + (acc.unread || 0) * 900;
  return { total: 1284600, free: 100000, used };
}

function buildAccountsPage() {
  const page = document.createElement('div');
  page.className = 'acc-page';
  page.innerHTML = `<div class="wp-head">
      <div><h1>账号管理</h1><p>渠道账号状态、会话分区与额度；休眠可释放内存</p></div>
      <div class="wp-actions">
        <button class="hp-primary" type="button" data-add-channel>+ 添加渠道</button>
      </div>
    </div>
    <section class="acc-card">
      <div class="acc-toolbar">
        <div class="acc-filters">
          <button class="is-active" type="button" data-filter="all">全部</button>
          <button type="button" data-filter="online">在线</button>
          <button type="button" data-filter="sleep">休眠</button>
        </div>
        <div class="acc-search">
          <span class="acc-search-icon">${ICONS.search}</span>
          <input id="acc-search" type="search" placeholder="搜索账号 / 渠道 / 分区" autocomplete="off" />
        </div>
      </div>
      <div class="acc-table">
        <div class="acc-thead">
          <span>账号</span><span>渠道</span><span>状态</span><span>会话分区</span><span>未读</span><span>额度</span><span>操作</span>
        </div>
        <div id="acc-rows"></div>
      </div>
    </section>
    <div id="team-section"></div>`;

  const rows = page.querySelector('#acc-rows');
  const search = page.querySelector('#acc-search');
  let filter = 'all';

  function drawRows() {
    const q = search.value.trim().toLowerCase();
    const items = state.accounts.filter((acc) => {
      const meta = channelMeta(acc.channel);
      const hay = (acc.name + ' ' + meta.name + ' ' + acc.partition).toLowerCase();
      if (q && !hay.includes(q)) return false;
      if (filter === 'online') return acc.status === 'online';
      if (filter === 'sleep') return acc.status === 'sleep';
      return true;
    });
    if (!items.length) {
      rows.innerHTML = '<p class="acc-empty">没有匹配的账号</p>';
      return;
    }
    rows.innerHTML = items.map((acc) => {
      const meta = channelMeta(acc.channel);
      const quota = quotaFor(acc);
      return `<div class="acc-row" data-row="${escapeHtml(acc.id)}">
        <span class="acc-name-cell">
          <span class="ch-tile acc-tile" data-channel="${escapeHtml(acc.channel)}">${escapeHtml(acc.avatar || meta.icon)}</span>
          <span><strong>${escapeHtml(acc.name)}</strong><small>${escapeHtml(acc.account)}</small></span>
        </span>
        <span class="acc-channel">${escapeHtml(meta.name)}</span>
        <span><span class="acc-status ${acc.status === 'sleep' ? 'is-sleep' : ''}">${escapeHtml(accountStatusLabel(acc))}</span></span>
        <span class="acc-partition">${escapeHtml(acc.partition)}</span>
        <span>${acc.unread ? `<b class="acc-unread">${acc.unread}</b>` : '—'}</span>
        <span class="acc-quota">${quota.total.toLocaleString('en-US')}</span>
        <span class="acc-actions">
          <button type="button" data-acc-action="${acc.status === 'sleep' ? 'wake' : 'sleep'}" data-id="${escapeHtml(acc.id)}">${acc.status === 'sleep' ? '唤醒' : '休眠'}</button>
          <button type="button" data-acc-action="quota" data-id="${escapeHtml(acc.id)}">配额</button>
          <button type="button" class="is-danger" data-acc-action="delete" data-id="${escapeHtml(acc.id)}">删除</button>
        </span>
      </div>`;
    }).join('');
  }

  page.querySelectorAll('[data-filter]').forEach((btn) => {
    btn.addEventListener('click', () => {
      filter = btn.dataset.filter;
      page.querySelectorAll('[data-filter]').forEach((b) => b.classList.toggle('is-active', b === btn));
      drawRows();
    });
  });
  search.addEventListener('input', drawRows);

  rows.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-acc-action]');
    if (!btn) return;
    const acc = state.accounts.find((a) => a.id === btn.dataset.id);
    if (!acc) return;
    const action = btn.dataset.accAction;
    if (action === 'sleep' || action === 'wake') {
      acc.status = action === 'sleep' ? 'sleep' : 'online';
      renderAccounts();
      renderContent();
      showGlobalToast(action === 'sleep' ? '服务已休眠，内存已释放（演示）' : '服务已唤醒（演示）');
    } else if (action === 'quota') {
      openQuota(acc);
    } else if (action === 'delete') {
      deleteAccount(acc);
    }
  });

  drawRows();

  const team = page.querySelector('#team-section');
  if (state.role === 'owner' || state.role === 'agent') {
    const block = document.createElement('section');
    block.className = 'wp-section';
    block.innerHTML = `<div class="wp-section-head">
      <div><h2>${state.role === 'owner' ? '团队与分销' : '我的用户'}</h2>
      <p>${state.role === 'owner' ? '管理代理、分配用户与查看分成' : '查看名下用户与分成情况'}</p></div>
    </div>`;
    block.appendChild(state.role === 'owner' ? buildAgentManagePanel() : buildMyUsersPanel());
    team.appendChild(block);
  }
  return page;
}

/* ---------- 关于 / 管理（沿用既有能力） ---------- */

function buildAboutPanel() {
  const wrap = document.createElement('div');
  wrap.className = 'about-page';
  wrap.innerHTML = `<div class="about-hero">
      <span class="about-logo">${escapeHtml(BRAND.name.charAt(0))}</span>
      <div class="about-hero-copy">
        <h1>${escapeHtml(BRAND.name)}</h1>
        <p>版本 ${escapeHtml(BRAND.version || '0.1.0')} · 多语言翻译 · 多渠道消息聚合 · 代理分销</p>
      </div>
      <span class="about-pill">商业版</span>
    </div>
    <div class="about-grid">
      <section class="about-card">
        <h3>产品定位</h3>
        <p>平台自身作为主程序，翻译与账号计费是核心能力；WhatsApp、Telegram、Signal 等消息渠道作为可插拔服务逐步接入。</p>
      </section>
      <section class="about-card">
        <h3>当前进度</h3>
        <ul>
          <li>工作台骨架：标题工具、账号 chips、功能右栏与内嵌区</li>
          <li>Supabase 邮箱账号与 owner / agent / user 角色体系</li>
          <li>渠道目录、端口配置与账号菜单为静态交互</li>
          <li>计费表结构已准备，运行时扣费待接入</li>
        </ul>
      </section>
      <section class="about-card">
        <h3>账号与安全</h3>
        <p>账号与数据由 Supabase 安全存储，渲染层不接触密钥；真实凭据只保存在本机 .env 中，不进入仓库。</p>
      </section>
      <section class="about-card">
        <h3>计费与分销</h3>
        <p>按原文字符数扣费，支持免费额度、付费余额、翻译池分配与起止有效期；代理直客 / 间客分成按比例自动计入。</p>
      </section>
    </div>
    <p class="about-foot">当前为商业版开发预览 · 演示数据不会发送到真实渠道 · 品牌名称由 package.json 单点配置</p>`;
  return wrap;
}

function mgmtRow(email, roleLabel, role, extra, actionBtn) {
  const row = document.createElement('div');
  row.className = 'mgmt-row';
  row.innerHTML = `<span class="mgmt-email">${escapeHtml(email)}</span>
    <span class="mgmt-tag" data-role="${escapeHtml(role)}">${escapeHtml(roleLabel)}</span>
    ${extra ? `<span class="mgmt-extra">${escapeHtml(extra)}</span>` : ''}`;
  if (actionBtn) row.appendChild(actionBtn);
  return row;
}

function buildAgentManagePanel() {
  const wrap = document.createElement('div');
  const msg = document.createElement('div');
  msg.className = 'mgmt-msg';
  const list = document.createElement('div');
  list.className = 'mgmt-list';

  async function load() {
    list.innerHTML = '';
    const res = await window.haituo.distribution.listProfiles();
    if (!res.ok) { list.textContent = res.error || '加载失败'; return; }
    const profiles = res.profiles || [];
    if (profiles.length === 0) { list.textContent = '暂无账号'; return; }
    for (const p of profiles) {
      const roleLabel = ROLE_LABELS[p.role] || p.role;
      const extra = p.commission_rate != null ? '分成 ' + p.commission_rate + '%' : '';
      let btn = null;
      if (p.role === 'agent') {
        btn = document.createElement('button');
        btn.className = 'btn-mini';
        btn.textContent = '降级';
        btn.addEventListener('click', async () => {
          const r = await window.haituo.distribution.demoteAgent(p.id);
          msg.textContent = r.ok ? '已降级' : (r.error || '失败');
          msg.classList.toggle('is-ok', !!r.ok);
          load();
        });
      }
      list.appendChild(mgmtRow(p.email, roleLabel, p.role, extra, btn));
    }
  }

  const promoteForm = document.createElement('form');
  promoteForm.className = 'mgmt-form';
  promoteForm.innerHTML = `<label>邮箱 <input name="email" type="email" placeholder="user@example.com" /></label>
    <label>分成 % <input name="rate" type="number" min="0" max="100" step="0.1" placeholder="30" /></label>
    <button type="submit">设为代理</button>`;
  promoteForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    msg.textContent = '';
    msg.classList.remove('is-ok');
    const r = await window.haituo.distribution.promoteToAgent(promoteForm.email.value, promoteForm.rate.value);
    msg.textContent = r.ok ? '已设为代理' : (r.error || '失败');
    msg.classList.toggle('is-ok', !!r.ok);
    load();
  });

  const assignForm = document.createElement('form');
  assignForm.className = 'mgmt-form';
  assignForm.innerHTML = `<label>用户邮箱 <input name="userEmail" type="email" placeholder="user@example.com" /></label>
    <label>代理邮箱 <input name="agentEmail" type="email" placeholder="agent@example.com" /></label>
    <button type="submit">分配到代理</button>`;
  assignForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    msg.textContent = '';
    msg.classList.remove('is-ok');
    const r = await window.haituo.distribution.assignAgent(assignForm.userEmail.value, assignForm.agentEmail.value);
    msg.textContent = r.ok ? '已分配' : (r.error || '失败');
    msg.classList.toggle('is-ok', !!r.ok);
    load();
  });

  const title = document.createElement('div');
  title.className = 'mgmt-section-title';
  title.textContent = '所有账号';

  wrap.appendChild(promoteForm);
  wrap.appendChild(assignForm);
  wrap.appendChild(msg);
  wrap.appendChild(title);
  wrap.appendChild(list);
  load();
  return wrap;
}

function buildMyUsersPanel() {
  const wrap = document.createElement('div');
  const list = document.createElement('div');
  list.className = 'mgmt-list';

  async function load() {
    list.innerHTML = '';
    const res = await window.haituo.distribution.listMyUsers();
    if (!res.ok) { list.textContent = res.error || '加载失败'; return; }
    const users = res.users || [];
    if (users.length === 0) { list.textContent = '名下暂无用户'; return; }
    for (const u of users) list.appendChild(mgmtRow(u.email, '', '', '', null));
  }

  wrap.appendChild(list);
  load();
  return wrap;
}

/* ---------- 用户菜单 ---------- */

function buildUserMenu() {
  const roleItems = [];
  if (state.role === 'owner') {
    roleItems.push({ action: 'providers', label: '服务商运营' });
    roleItems.push({ action: 'agent', label: '代理管理' });
  }
  if (state.role === 'agent') roleItems.push({ action: 'my-users', label: '我的用户' });
  userMenu.innerHTML = `<div class="um-head">
      <strong>${escapeHtml(state.user ? state.user.email : '')}</strong>
      <small>${state.demo ? '离线演示 · 所有者权限' : (ROLE_LABELS[state.role] || state.role)} · ${escapeHtml(BRAND.name)}</small>
    </div>
    <button class="um-item" type="button" data-user-action="recharge">充值中心</button>
    <button class="um-item" type="button" data-user-action="quota">查看当前账号配额</button>
    ${roleItems.map((i) => `<button class="um-item" type="button" data-user-action="${i.action}">${i.label}</button>`).join('')}
    <button class="um-item" type="button" data-user-action="about">关于海拓</button>
    <div class="um-divider"></div>
    <button class="um-item is-danger" type="button" data-user-action="logout">退出登录</button>`;
}

/* ---------- 功能栏 ---------- */

function visibleFeatures() {
  return FEATURES.filter((f) => !state.hiddenFx.includes(f.id));
}

function featureButtonHtml(feature, compact) {
  return `<button class="fx-rail-btn${compact ? ' is-compact' : ''}" type="button" data-feature="${escapeHtml(feature.id)}" title="${escapeHtml(feature.name)} · ${escapeHtml(feature.desc)}" aria-label="${escapeHtml(feature.name)}">
    ${FEATURE_ICONS[feature.id] || ICONS.more}
    ${feature.id === 'screenshot' ? '<span class="fx-hotkey-dot"></span>' : ''}
  </button>`;
}

function renderRailFeatures() {
  const list = visibleFeatures();
  fxRailTop.innerHTML = list.map((f) => featureButtonHtml(f, false)).join('');
  railFeatures.innerHTML = list.map((f) => featureButtonHtml(f, true)).join('') +
    `<button class="fx-rail-btn is-compact" type="button" data-fx-manage title="侧栏按钮管理">${ICONS.grid}</button>`;
  syncRailActive();
}

function syncRailActive() {
  document.querySelectorAll('[data-feature]').forEach((btn) => {
    btn.classList.toggle('is-active', state.fxOpen && btn.dataset.feature === state.fxId);
  });
}

const panelCache = new Map();

function toggleFeature(id) {
  if (state.hiddenFx.includes(id)) return;
  const feature = FEATURES.find((f) => f.id === id);
  if (!feature) return;
  if (feature.status === 'deferred') {
    showGlobalToast('「' + feature.name + '」已预留插件位（slot: ' + (feature.slot || 'plugin') + '），后续版本接入');
    return;
  }
  if (id === 'screenshot') {
    if (window.HaituoStudio) window.HaituoStudio.startCapture();
    else showGlobalToast('截屏工作台未加载');
    return;
  }
  if (state.fxOpen && state.fxId === id) {
    closePanel();
    return;
  }
  state.fxOpen = true;
  state.fxId = id;
  appView.classList.add('fx-open');
  fxPanelKicker.textContent = feature.kicker;
  fxPanelTitle.textContent = feature.name;
  let body = panelCache.get(id);
  if (!body) {
    body = buildFeaturePanel(id);
    bindPanelEvents(body);
    panelCache.set(id, body);
  }
  fxPanelBody.replaceChildren(body);
  fxPanelBody.scrollTop = 0;
  syncRailActive();
  revealActiveChip();
}

function closePanel() {
  state.fxOpen = false;
  appView.classList.remove('fx-open');
  syncRailActive();
  revealActiveChip();
}

function bindFeatureRailClick(e) {
  const feature = e.target.closest('[data-feature]');
  if (feature) { toggleFeature(feature.dataset.feature); return; }
  if (e.target.closest('[data-fx-manage]')) toggleFxManager();
}

function renderFxManager() {
  fxManager.innerHTML = `<div class="fx-manager-head">
      <strong>侧栏按钮管理</strong>
      <button type="button" data-fx-reset>恢复默认</button>
    </div>
    <div class="fx-manager-list">
      ${FEATURES.map((f) => `<label>
        <input type="checkbox" value="${escapeHtml(f.id)}"${state.hiddenFx.includes(f.id) ? '' : ' checked'} />
        <span>${escapeHtml(f.name)}</span>${f.status === 'deferred' ? '<span class="fx-slot-tag">插件位</span>' : ''}
      </label>`).join('')}
    </div>
    <p class="fx-manager-note">取消勾选后隐藏对应图标，面板会同步收起。</p>`;
}

function toggleFxManager() {
  const willOpen = fxManager.hidden;
  if (willOpen) renderFxManager();
  fxManager.hidden = !willOpen;
}

fxManager.addEventListener('change', (e) => {
  const input = e.target.closest('input[type="checkbox"]');
  if (!input) return;
  const id = input.value;
  const isHidden = state.hiddenFx.includes(id);
  if (input.checked && isHidden) state.hiddenFx = state.hiddenFx.filter((x) => x !== id);
  if (!input.checked && !isHidden) state.hiddenFx.push(id);
  if (state.hiddenFx.includes(state.fxId)) closePanel();
  writeStorage(STORAGE.hidden, JSON.stringify(state.hiddenFx));
  renderRailFeatures();
});

fxManager.addEventListener('click', (e) => {
  if (!e.target.closest('[data-fx-reset]')) return;
  state.hiddenFx = [];
  writeStorage(STORAGE.hidden, '[]');
  renderRailFeatures();
  renderFxManager();
  showGlobalToast('已恢复默认功能栏');
});

/* ---------- 功能面板内容 ---------- */

function hpToggle(label, note, checked) {
  return `<label class="hp-toggle">
    <span class="hp-toggle-copy"><strong>${label}</strong>${note ? `<small>${note}</small>` : ''}</span>
    <input type="checkbox"${checked ? ' checked' : ''} />
    <span class="hp-switch"></span>
  </label>`;
}

function fxField(label, control, help) {
  return `<label class="fx-field"><span>${label}</span>${control}${help ? `<small>${help}</small>` : ''}</label>`;
}

function buildFeaturePanel(id) {
  const wrap = document.createElement('div');
  wrap.className = 'fx-content';

  if (id === 'quick-reply') {
    wrap.innerHTML = `<div class="fx-block">
        <div class="fx-chips">
          <button class="fx-chip is-active" type="button" data-seg>全部</button>
          <button class="fx-chip" type="button" data-seg>报价</button>
          <button class="fx-chip" type="button" data-seg>物流</button>
          <button class="fx-chip" type="button" data-seg>售后</button>
        </div>
      </div>
      <div class="fx-block">
        <div class="fx-block-title">常用回复 · 3</div>
        <article class="fx-reply">
          <header><span>报价开场</span><span class="fx-mini-tag">FR / 中</span></header>
          <p>Bonjour, merci pour votre message. Voici notre meilleur prix pour 20 pièces…</p>
          <footer>
            <button type="button" data-insert="Bonjour, merci pour votre message. Nous vous envoyons le devis tout de suite.">插入</button>
            <button type="button" data-toast="编辑快捷回复（演示）">编辑</button>
          </footer>
        </article>
        <article class="fx-reply">
          <header><span>物流进度</span><span class="fx-mini-tag">通用</span></header>
          <p>Votre colis est en transit. Livraison prévue sous 48 heures à Lyon.</p>
          <footer>
            <button type="button" data-insert="Votre colis est en transit. Livraison prévue sous 48 heures.">插入</button>
            <button type="button" data-toast="编辑快捷回复（演示）">编辑</button>
          </footer>
        </article>
        <article class="fx-reply">
          <header><span>售后安抚</span><span class="fx-mini-tag">中 / FR</span></header>
          <p>很抱歉给您带来不便，我们已安排重新发货，并会补偿下一次订单的运费。</p>
          <footer>
            <button type="button" data-insert="很抱歉给您带来不便，我们已安排重新发货。">插入</button>
            <button type="button" data-toast="编辑快捷回复（演示）">编辑</button>
          </footer>
        </article>
      </div>
      <div class="fx-block">
        <button class="hp-primary" type="button" data-toast="新建快捷回复（演示）">+ 新建快捷回复</button>
        <p class="fx-note">支持分类、变量与原文 / 译文双版本。</p>
      </div>`;
  } else if (id === 'basic-translate') {
    wrap.innerHTML = `<div class="fx-block">
        ${fxField('目标语言', `<select class="fx-select"><option>中文（简体）</option><option>English</option><option>Français</option></select>`)}
        ${fxField('翻译模式', `<select class="fx-select"><option>自动翻译收到的消息</option><option>仅手动触发</option></select>`)}
      </div>
      <div class="fx-block">
        <div class="fx-block-title">服务商偏好</div>
        ${window.HaituoStudio ? window.HaituoStudio.customerDefaultSelectHtml() : ''}
      </div>
      <div class="fx-block">
        ${hpToggle('始终翻译', '收到的消息自动翻译', true)}
        ${hpToggle('历史消息补翻', '进入会话时翻译最近 30 条', true)}
        ${hpToggle('发出消息也翻译', '发送前翻译为对方语言', false)}
      </div>
      <div class="fx-block">
        <div class="fx-block-title">翻译额度</div>
        <div class="fx-quota-line"><strong>1,284,600</strong><span>字符可用</span></div>
        <div class="fx-meter"><span></span></div>
        <button class="hp-ghost" type="button" data-page="recharge">前往充值中心</button>
      </div>`;
  } else if (id === 'advanced-translate') {
    wrap.innerHTML = `<div class="fx-block">
        ${fxField('对话记忆条数', '<input class="fx-input" type="number" min="0" max="200" value="30" />', '翻译时参考最近 N 条对话上下文')}
        ${fxField('翻译角色', '<select class="fx-select"><option>商务口吻</option><option>日常口语</option><option>技术术语</option></select>')}
      </div>
      <div class="fx-block">
        <div class="fx-block-title">译文样式</div>
        <div class="fx-color-row">
          <button class="fx-color is-active" type="button" data-seg><i class="c-purple"></i>淡紫</button>
          <button class="fx-color" type="button" data-seg><i class="c-blue"></i>蓝色</button>
          <button class="fx-color" type="button" data-seg><i class="c-amber"></i>琥珀</button>
        </div>
        ${fxField('译文字号', '<input class="fx-range" type="range" min="10" max="18" value="13" />')}
      </div>
      <div class="fx-block">
        <button class="hp-ghost" type="button" data-toast="术语库管理（演示）">专业术语库</button>
        <p class="fx-note">账号级设置，切换账号不会丢失；演示阶段仅本地记忆。</p>
      </div>`;
  } else if (id === 'customer') {
    wrap.innerHTML = `<div class="fx-profile">
        <span class="fx-profile-avatar">LM</span>
        <div><strong>Léa Martin</strong><small>法国 · 里昂 · WhatsApp</small></div>
        <span class="fx-tag">高意向</span>
      </div>
      <div class="fx-info-grid">
        <div><span>性别</span><strong>女</strong></div>
        <div><span>国家</span><strong>法国</strong></div>
        <div><span>邮箱</span><strong>lea@example.fr</strong></div>
        <div><span>电话</span><strong>06 12 34 56 78</strong></div>
        <div><span>客户 ID</span><strong>c_9f3a21</strong></div>
        <div><span>来源</span><strong>WhatsApp 咨询</strong></div>
      </div>
      <div class="fx-block">
        <div class="fx-block-title">标签</div>
        <div class="fx-chips">
          <button class="fx-chip is-active" type="button" data-seg>批发</button>
          <button class="fx-chip" type="button" data-seg>里昂</button>
          <button class="fx-chip" type="button" data-seg>高复购</button>
          <button class="fx-chip" type="button" data-seg>+ 标签</button>
        </div>
      </div>
      <div class="fx-block">
        <div class="fx-block-title">跟进记录</div>
        <div class="fx-timeline">
          <div><span>今天 09:48</span><p>确认 20 件 X200 订单，等待付款。</p></div>
          <div><span>昨天 16:20</span><p>发送报价单，客户询问交期。</p></div>
          <div><span>周一</span><p>首次询盘，来自 WhatsApp 群。</p></div>
        </div>
      </div>
      <div class="fx-block fx-btn-row">
        <button class="hp-primary" type="button" data-toast="添加跟进记录（演示）">+ 跟进</button>
        <button class="hp-ghost" type="button" data-toast="团队同步待接入">同步团队</button>
      </div>`;
  } else if (id === 'broadcast') {
    wrap.innerHTML = `<div class="fx-block">
        ${fxField('客户分组', '<select class="fx-select"><option>法国批发客户（58）</option><option>未成交询盘（23）</option><option>全部客户（142）</option></select>')}
        <div class="fx-field"><span>发送对象</span>
          <div class="fx-chips">
            <button class="fx-chip is-active" type="button" data-seg>法国客户</button>
            <button class="fx-chip" type="button" data-seg>30 天未成交</button>
            <button class="fx-chip" type="button" data-seg>VIP</button>
          </div>
        </div>
        ${fxField('消息内容', '<textarea class="fx-textarea" rows="4" placeholder="Bonjour, notre nouvelle collection est disponible…"></textarea>')}
        ${fxField('发送间隔', '<select class="fx-select"><option>每 15 秒 1 条</option><option>每 30 秒 1 条</option><option>每 60 秒 1 条</option></select>')}
        <div class="fx-dropzone">${ICONS.paperclip}<span>拖入图片 / 报价单附件</span></div>
      </div>
      <div class="fx-block">
        <div class="fx-task">
          <div><strong>今日群发任务</strong><span>进行中 · 12 / 58</span></div>
          <div class="fx-meter"><span class="w-20"></span></div>
        </div>
        <button class="hp-primary" type="button" data-toast="群发任务已加入队列（演示）">开始群发</button>
        <p class="fx-note">演示模式不会发送真实消息；发送前请确认账号已登录。</p>
      </div>`;
  } else if (id === 'proxy') {
    wrap.innerHTML = `<div class="fx-block">
        ${fxField('代理协议', '<select class="fx-select"><option>SOCKS5</option><option>HTTP</option><option>HTTPS</option><option>直连</option></select>')}
        <div class="fx-grid-2">
          ${fxField('主机', '<input class="fx-input" type="text" placeholder="185.62.190.24" />')}
          ${fxField('端口', '<input class="fx-input" type="text" placeholder="1080" />')}
        </div>
        <div class="fx-grid-2">
          ${fxField('用户名', '<input class="fx-input" type="text" placeholder="可选" />')}
          ${fxField('密码', '<input class="fx-input" type="password" placeholder="可选" />')}
        </div>
      </div>
      <div class="fx-block">
        <button class="hp-primary" type="button" data-proxy-check>检测出口 IP</button>
        <div class="fx-result" data-proxy-result>尚未检测</div>
      </div>
      <div class="fx-block">
        ${hpToggle('应用到当前账号', '切换账号后保持独立代理', true)}
        <p class="fx-alert">真实代理接入前，检测结果为演示数据，不会发出网络请求。</p>
      </div>`;
  } else if (id === 'fingerprint') {
    wrap.innerHTML = `<div class="fx-block">
        <div class="fx-grid-2">
          ${fxField('地区', '<select class="fx-select"><option>法国</option><option>德国</option><option>美国</option><option>英国</option></select>')}
          ${fxField('语言', '<select class="fx-select"><option>fr-FR</option><option>de-DE</option><option>en-US</option></select>')}
        </div>
        ${fxField('浏览器版本', '<select class="fx-select"><option>Chrome 135 · Windows 11</option><option>Chrome 131 · Windows 10</option><option>Chrome 128 · macOS 14</option></select>')}
        ${fxField('设备种子', '<input class="fx-input" type="text" value="seed-7f3a-91ce" />')}
        <button class="hp-ghost" type="button" data-toast="已生成新的设备种子（演示）">随机生成种子</button>
      </div>
      <div class="fx-block">
        ${hpToggle('WebRTC 防泄漏', '屏蔽真实内网 IP', true)}
        ${hpToggle('Canvas 噪声', '每次渲染加入随机噪声', true)}
        ${hpToggle('音频指纹伪装', '干扰 AudioContext 指纹', true)}
      </div>
      <div class="fx-block">
        <div class="fx-grid-2">
          ${fxField('分辨率', '<select class="fx-select"><option>1920 × 1080</option><option>1440 × 900</option><option>1366 × 768</option></select>')}
          ${fxField('设备名', '<input class="fx-input" type="text" value="DESKTOP-FR07" />')}
        </div>
        ${fxField('MAC 地址', '<input class="fx-input" type="text" value="A4:5E:60:2B:91:CE" />')}
        <p class="fx-alert">指纹为浏览器级伪装；演示阶段不修改真实系统信息。</p>
      </div>`;
  } else if (id === 'translate') {
    wrap.innerHTML = `<div class="fx-block">
        ${window.HaituoStudio ? window.HaituoStudio.panelProviderSelectHtml() : ''}
        <div class="fx-grid-2">
          ${fxField('源语言', '<select class="fx-select"><option>自动检测</option><option>Français</option><option>中文</option></select>')}
          ${fxField('目标语言', '<select class="fx-select"><option>中文（简体）</option><option>English</option></select>')}
        </div>
        ${fxField('原文', '<textarea class="fx-textarea" id="fx-tr-input" rows="4" placeholder="输入或粘贴需要翻译的文本…">Bonjour, je souhaite commander 20 pièces.</textarea>')}
        <button class="hp-primary" type="button" data-tr-run>翻译</button>
      </div>
      <div class="fx-block">
        <div class="fx-block-title">译文</div>
        <div class="fx-tr-out" id="fx-tr-out">您好，我想订购 20 件。能否提供一份正式报价？</div>
        <p class="fx-note" id="fx-tr-meta">演示译文，不调用真实 API；按翻译字符 × 服务商单价扣额度。</p>
      </div>`;
  } else if (id === 'writing') {
    wrap.innerHTML = `<div class="fx-block">
        <div class="fx-seg">
          <button class="is-active" type="button" data-seg>撰写</button>
          <button type="button" data-seg>回复</button>
        </div>
        ${fxField('格式', '<select class="fx-select"><option>WhatsApp 消息</option><option>商务邮件</option><option>正式信函</option><option>产品文案</option></select>')}
        <div class="fx-field"><span>语气</span>
          <div class="fx-chips">
            <button class="fx-chip is-active" type="button" data-seg>专业</button>
            <button class="fx-chip" type="button" data-seg>友好</button>
            <button class="fx-chip" type="button" data-seg>强势</button>
          </div>
        </div>
        <div class="fx-field"><span>长度</span>
          <div class="fx-seg">
            <button type="button" data-seg>短</button>
            <button class="is-active" type="button" data-seg>中</button>
            <button type="button" data-seg>长</button>
          </div>
        </div>
        ${fxField('语言', '<select class="fx-select"><option>Français</option><option>English</option><option>中文</option></select>')}
        ${fxField('主题 / 要点', '<textarea class="fx-textarea" rows="3">向法国客户说明 X200 现货、交期和新价格。</textarea>')}
        <button class="hp-primary" type="button" data-gen>生成草稿</button>
      </div>
      <div class="fx-block">
        <div class="fx-block-title">生成结果</div>
        <div class="fx-gen-out" hidden>Bonjour, nous avons le X200 en stock. Livraison à Lyon sous 48 h, à 12,80 € pièce.</div>
        <p class="fx-note">生成内容需人工确认后发送。</p>
      </div>`;
  } else if (id === 'fans') {
    wrap.innerHTML = `<div class="fx-block">
        <div class="fx-stat-grid">
          <div class="fx-stat"><span>总粉丝</span><strong>8,420</strong></div>
          <div class="fx-stat"><span>本周新增</span><strong>+312</strong></div>
          <div class="fx-stat"><span>活跃率</span><strong>64%</strong></div>
        </div>
      </div>
      <div class="fx-block">
        <div class="fx-block-title">近 7 日增长</div>
        <div class="fx-bars"><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div>
        <div class="fx-axis"><span>周一</span><span>周三</span><span>周五</span><span>周日</span></div>
      </div>
      <div class="fx-block">
        <div class="fx-block-title">渠道分布</div>
        <div class="fx-dist"><span>Telegram 频道</span><b>42%</b><div class="fx-meter"><span class="w-42"></span></div></div>
        <div class="fx-dist"><span>WhatsApp 客户</span><b>31%</b><div class="fx-meter"><span class="w-31"></span></div></div>
        <div class="fx-dist"><span>Signal</span><b>17%</b><div class="fx-meter"><span class="w-17"></span></div></div>
        <div class="fx-dist"><span>其他</span><b>10%</b><div class="fx-meter"><span class="w-10"></span></div></div>
      </div>`;
  } else if (id === 'other') {
    wrap.innerHTML = `<div class="fx-block">
        <div class="fx-block-title">兼容与自动化</div>
        ${hpToggle('WhatsApp 兼容模式', '减少新版界面导致的翻译错位', true)}
        ${hpToggle('自动已读', '打开会话后自动标记已读', false)}
        ${hpToggle('剪贴板翻译', '复制文本后浮窗显示译文', true)}
        ${hpToggle('启动时恢复休眠账号', '仅恢复上次在线账号', false)}
      </div>
      <div class="fx-block">
        <div class="fx-block-title">数据</div>
        <button class="hp-ghost" type="button" data-toast="聊天记录导出任务已创建（演示）">导出聊天记录</button>
        <button class="hp-ghost" type="button" data-toast="缓存已清理（演示）">清理全部账号缓存</button>
        <p class="fx-note">导出格式：CSV / JSON，按账号独立保存。</p>
      </div>
      <div class="fx-block">
        <div class="fx-block-title">界面</div>
        ${fxField('界面语言', '<select class="fx-select"><option>简体中文</option><option>English</option><option>Français</option></select>')}
        ${hpToggle('紧凑模式', '缩小账号 chips 与列表间距', false)}
      </div>
      ${window.HaituoStudio ? window.HaituoStudio.screenshotSettingsHtml() : ''}`;
  } else if (id === 'reminder') {
    wrap.innerHTML = `<div class="fx-block">
        ${fxField('提醒时间', '<input class="fx-input" type="datetime-local" />')}
        ${fxField('提醒内容', '<textarea class="fx-textarea" rows="3" placeholder="例如：跟进 Léa 的 20 件订单付款"></textarea>')}
        <button class="hp-primary" type="button" data-toast="提醒已创建（本地演示）">+ 添加提醒</button>
      </div>
      <div class="fx-block">
        <div class="fx-block-title">待办 · 3</div>
        <div class="fx-reminder"><span class="fx-reminder-dot"></span><div><strong>跟进 Léa 订单付款</strong><small>今天 15:30</small></div></div>
        <div class="fx-reminder"><span class="fx-reminder-dot is-warn"></span><div><strong>回复法国批发群报价</strong><small>明天 10:00</small></div></div>
        <div class="fx-reminder"><span class="fx-reminder-dot"></span><div><strong>整理本周粉丝数据</strong><small>周五 18:00</small></div></div>
      </div>`;
  } else if (id === 'trade') {
    wrap.innerHTML = `<div class="fx-block">
        <div class="fx-block-title">实时行情 · 演示</div>
        <div class="fx-quote"><div><strong>EUR / CNY</strong><span>欧元 / 人民币</span></div><b>7.8214</b><em class="up">+0.42%</em></div>
        <div class="fx-quote"><div><strong>EUR / USD</strong><span>欧元 / 美元</span></div><b>1.0862</b><em class="down">-0.11%</em></div>
        <div class="fx-quote"><div><strong>XAU / USD</strong><span>黄金</span></div><b>2,734.6</b><em class="up">+0.26%</em></div>
        <div class="fx-quote"><div><strong>BTC / USD</strong><span>比特币</span></div><b>67,420</b><em class="up">+1.08%</em></div>
      </div>
      <div class="fx-block">
        <div class="fx-block-title">金融快讯</div>
        <div class="fx-news"><span>14:20</span><p>欧洲央行维持利率不变，欧元短线走高。</p></div>
        <div class="fx-news"><span>13:05</span><p>法国 10 月制造业 PMI 回升至 50.2。</p></div>
        <div class="fx-news"><span>11:42</span><p>国际金价站上 2,730 美元，避险需求升温。</p></div>
      </div>
      <div class="fx-block">
        <button class="hp-ghost" type="button" data-toast="打开环球交易 WebView（演示）">打开交易视图</button>
        <p class="fx-note">行情与快讯为静态演示，不构成投资建议。</p>
      </div>`;
  } else {
    wrap.innerHTML = `<div class="fx-block">
        <div class="fx-hotkey"><span>截屏翻译</span><kbd>Alt</kbd><kbd>Shift</kbd><kbd>S</kbd></div>
        <div class="fx-shot-preview"><span class="fx-shot-box">拖动选区后松开</span></div>
        <button class="hp-primary" type="button" data-shot>模拟截屏</button>
      </div>
      <div class="fx-block">
        <div class="fx-block-title">OCR 结果</div>
        <div class="fx-ocr" data-shot-result hidden>
          <p>Bonjour, je souhaite connaître le prix pour 50 pièces.</p>
          <div class="fx-tr-out">您好，我想了解 50 件的价格。</div>
        </div>
        <div class="fx-result" data-shot-empty>尚未截取内容</div>
      </div>
      <div class="fx-block">
        <p class="fx-note">截屏翻译会在选区完成后依次执行 OCR、翻译与可编辑校对。演示阶段使用示例文本。</p>
      </div>`;
  }

  return wrap;
}

function bindPanelEvents(root) {
  root.addEventListener('click', (e) => {
    const seg = e.target.closest('[data-seg]');
    if (seg) {
      e.preventDefault();
      seg.parentElement.querySelectorAll('[data-seg]').forEach((b) => b.classList.toggle('is-active', b === seg));
      return;
    }
    const page = e.target.closest('[data-page]');
    if (page) {
      selectPage(page.dataset.page);
      closePanel();
      return;
    }
    const insert = e.target.closest('[data-insert]');
    if (insert) {
      const input = document.getElementById('em-input');
      if (!input) {
        showGlobalToast('请先切换到在线账号，再插入快捷回复');
        return;
      }
      input.value = insert.dataset.insert;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.focus();
      showGlobalToast('已插入到输入框');
      return;
    }
    if (e.target.closest('[data-proxy-check]')) {
      const result = root.querySelector('[data-proxy-result]');
      if (result) {
        result.textContent = '185.62.190.24 · Paris · 延迟 38ms（演示）';
        result.classList.add('is-ok');
      }
      return;
    }
    if (e.target.closest('[data-tr-run]')) {
      const input = root.querySelector('#fx-tr-input');
      const out = root.querySelector('#fx-tr-out');
      const select = root.querySelector('#fx-tr-provider');
      const meta = root.querySelector('#fx-tr-meta');
      const source = input ? input.value.trim() : '';
      if (!source) {
        if (out) out.textContent = '请先输入原文。';
        return;
      }
      const res = window.HaituoStudio
        ? window.HaituoStudio.runPanelTranslation(source, select ? select.value : '')
        : { ok: false, error: '翻译服务未加载' };
      if (out) out.textContent = res.ok ? res.translation : res.error;
      if (meta) meta.textContent = res.ok ? res.meta : (res.error || '翻译失败');
      return;
    }
    if (e.target.closest('[data-gen]')) {
      const out = root.querySelector('.fx-gen-out');
      if (out) out.hidden = false;
      showGlobalToast('已生成草稿（演示）');
      return;
    }
    if (e.target.closest('[data-shot]')) {
      const result = root.querySelector('[data-shot-result]');
      const empty = root.querySelector('[data-shot-empty]');
      if (result) result.hidden = false;
      if (empty) empty.hidden = true;
      showGlobalToast('已截取选区并完成 OCR（演示）');
    }
  });
}

/* ---------- 账号菜单 ---------- */

function accountMenuHtml(acc) {
  const meta = channelMeta(acc.channel);
  const font = acc.ui && acc.ui.font ? acc.ui.font : 'md';
  const density = acc.ui && acc.ui.density ? acc.ui.density : 3;
  return `<div class="cm-head">
      <span class="ch-tile cm-avatar" data-channel="${escapeHtml(acc.channel)}">${escapeHtml(acc.avatar || meta.icon)}</span>
      <div><strong>${escapeHtml(acc.name)}</strong><small>${escapeHtml(meta.name)} · ${escapeHtml(acc.partition)}</small></div>
    </div>
    <div class="cm-section">
      <span class="cm-label">字号</span>
      <div class="cm-seg">
        <button type="button" data-font="sm" class="${font === 'sm' ? 'is-active' : ''}">小</button>
        <button type="button" data-font="md" class="${font === 'md' ? 'is-active' : ''}">中</button>
        <button type="button" data-font="lg" class="${font === 'lg' ? 'is-active' : ''}">大</button>
      </div>
    </div>
    <div class="cm-section">
      <span class="cm-label">图标密度</span>
      <div class="cm-dots">
        ${[1, 2, 3, 4, 5].map((n) => `<button type="button" data-density="${n}" class="${density === n ? 'is-active' : ''}" title="密度 ${n}">${n}</button>`).join('')}
      </div>
    </div>
    <div class="cm-divider"></div>
    <button class="cm-item" type="button" data-acc-act="edit">编辑备注 / 头像</button>
    <button class="cm-item" type="button" data-acc-act="toggle-sleep">${acc.status === 'sleep' ? '唤醒服务' : '休眠服务'}</button>
    <button class="cm-item" type="button" data-acc-act="refresh">刷新服务</button>
    <button class="cm-item" type="button" data-acc-act="clear">清理缓存并刷新</button>
    <button class="cm-item" type="button" data-acc-act="quota">配额查看</button>
    <div class="cm-divider"></div>
    <button class="cm-item is-danger" type="button" data-acc-act="delete">删除服务</button>`;
}

function openAccountMenu(id, x, y) {
  const acc = state.accounts.find((a) => a.id === id);
  if (!acc) return;
  contextMenu.dataset.account = id;
  contextMenu.innerHTML = accountMenuHtml(acc);
  contextMenu.hidden = false;
  contextMenu.style.left = '0px';
  contextMenu.style.top = '0px';
  const w = contextMenu.offsetWidth;
  const h = contextMenu.offsetHeight;
  contextMenu.style.left = Math.max(8, Math.min(x, window.innerWidth - w - 8)) + 'px';
  contextMenu.style.top = Math.max(8, Math.min(y, window.innerHeight - h - 8)) + 'px';
}

function closeAccountMenu() {
  contextMenu.hidden = true;
}

function deleteAccount(acc) {
  const ok = window.confirm('确定删除服务「' + acc.name + '」？演示阶段仅从当前工作台移除。');
  if (!ok) return;
  state.accounts = state.accounts.filter((a) => a.id !== acc.id);
  if (state.activeId === acc.id) state.activeId = state.accounts[0] ? state.accounts[0].id : null;
  closeAccountMenu();
  renderAccounts();
  renderPageTabs();
  renderContent();
  showGlobalToast('已删除服务：' + acc.name);
}

contextMenu.addEventListener('click', (e) => {
  const acc = state.accounts.find((a) => a.id === contextMenu.dataset.account);
  if (!acc) return;
  const fontBtn = e.target.closest('[data-font]');
  if (fontBtn) {
    acc.ui.font = fontBtn.dataset.font;
    renderAccounts();
    closeAccountMenu();
    return;
  }
  const densityBtn = e.target.closest('[data-density]');
  if (densityBtn) {
    acc.ui.density = Number(densityBtn.dataset.density);
    renderAccounts();
    closeAccountMenu();
    return;
  }
  const actBtn = e.target.closest('[data-acc-act]');
  if (!actBtn) return;
  const act = actBtn.dataset.accAct;
  if (act === 'edit') {
    openEditAccount(acc);
    closeAccountMenu();
  } else if (act === 'toggle-sleep') {
    acc.status = acc.status === 'sleep' ? 'online' : 'sleep';
    renderAccounts();
    if (state.view === 'account' && state.activeId === acc.id) renderContent();
    if (state.view === 'accounts') renderContent();
    closeAccountMenu();
    showGlobalToast(acc.status === 'sleep' ? '服务已休眠，内存已释放（演示）' : '服务已唤醒（演示）');
  } else if (act === 'refresh') {
    closeAccountMenu();
    showGlobalToast('正在刷新 ' + acc.name + '（演示）');
    if (state.view === 'account' && state.activeId === acc.id) renderContent();
  } else if (act === 'clear') {
    closeAccountMenu();
    showGlobalToast('缓存已清理并刷新：' + acc.name + '（演示）');
    if (state.view === 'account' && state.activeId === acc.id) renderContent();
  } else if (act === 'quota') {
    closeAccountMenu();
    openQuota(acc);
  } else if (act === 'delete') {
    deleteAccount(acc);
  }
});

/* ---------- 添加渠道 ---------- */

function catalogCardHtml(channel) {
  const custom = Boolean(channel.custom);
  return `<button class="cat-card${custom ? ' is-custom' : ''}" type="button" data-channel-id="${escapeHtml(channel.id)}">
    <span class="ch-tile cat-icon" data-channel="${escapeHtml(channel.id)}">${escapeHtml(channel.icon)}</span>
    <span class="cat-name">${escapeHtml(channel.name)}</span>
    <span class="cat-tag">${escapeHtml(channel.tag)}</span>
    <span class="cat-coming">${custom ? 'URL 预留' : '即将上线'}</span>
  </button>`;
}

function renderCatalog(keyword) {
  const q = String(keyword || '').trim().toLowerCase();
  const list = CATALOG.filter((c) => !q || (c.name + ' ' + c.tag + ' ' + c.id).toLowerCase().includes(q));
  catalogGrid.innerHTML = list.map(catalogCardHtml).join('') || '<p class="catalog-empty">没有匹配的渠道</p>';
  catalogCount.textContent = list.length + ' 个服务';
}

function openCatalog() {
  catalogSearch.value = '';
  renderCatalog('');
  closeModal('channel-config');
  openModal('channel-catalog');
  setTimeout(() => catalogSearch.focus(), 30);
}

function openConfig(channel) {
  state.pendingChannel = channel;
  const custom = Boolean(channel.custom || channel.url);
  cfgChannelIcon.dataset.channel = channel.id;
  cfgChannelIcon.textContent = channel.icon;
  cfgTitle.textContent = custom ? '配置自定义服务' : '配置 ' + channel.name + ' 端口';
  cfgName.value = channel.name + ' 01';
  cfgName.placeholder = custom ? '例如：我的独立站客服' : '例如：法国批发 01';
  cfgCount.value = '1';
  cfgUrlWrap.hidden = !custom;
  cfgUrl.value = '';
  cfgSendTr.checked = true;
  cfgRecvTr.checked = true;
  cfgGroupTr.checked = false;
  cfgFingerprint.checked = true;
  cfgCookie.checked = false;
  cfgProxyMode.selectedIndex = 0;
  if (cfgProxy) cfgProxy.value = '';
  cfgRegion.selectedIndex = 0;
  cfgLang.selectedIndex = 0;
  cfgBrowser.selectedIndex = 0;
  closeModal('channel-catalog');
  openModal('channel-config');
  setTimeout(() => {
    if (custom) cfgUrl.focus();
    else cfgName.select();
  }, 30);
}

function shortId() {
  return Math.random().toString(16).slice(2, 6);
}

/* ---------- 弹层辅助 ---------- */

function openModal(id) {
  const el = document.getElementById(id);
  if (el) el.hidden = false;
}

function closeModal(id) {
  const el = document.getElementById(id);
  if (el) el.hidden = true;
}

function closeAllModals() {
  document.querySelectorAll('.modal-backdrop').forEach((el) => { el.hidden = true; });
}

function closeAllOverlays() {
  closeAllModals();
  closeAccountMenu();
  fxManager.hidden = true;
  userMenu.hidden = true;
}

document.querySelectorAll('[data-close]').forEach((btn) => {
  btn.addEventListener('click', () => closeModal(btn.dataset.close));
});

document.querySelectorAll('.modal-backdrop').forEach((backdrop) => {
  backdrop.addEventListener('mousedown', (e) => {
    if (e.target === backdrop) backdrop.hidden = true;
  });
});

function openQuota(acc) {
  if (!acc) { showGlobalToast('请先选择一个账号'); return; }
  const meta = channelMeta(acc.channel);
  const quota = quotaFor(acc);
  quotaBody.innerHTML = `<div class="quota-account">
      <span class="ch-tile quota-tile" data-channel="${escapeHtml(acc.channel)}">${escapeHtml(acc.avatar || meta.icon)}</span>
      <div><strong>${escapeHtml(acc.name)}</strong><small>${escapeHtml(meta.name)} · ${escapeHtml(acc.partition)}</small></div>
      <span class="quota-status${acc.status === 'sleep' ? ' is-sleep' : ''}">${escapeHtml(accountStatusLabel(acc))}</span>
    </div>
    <div class="quota-balance">
      <span>可用字符余额</span>
      <strong>${(quota.total - quota.used).toLocaleString('en-US')}<small>字符</small></strong>
      <em>免费额度 ${quota.free.toLocaleString('en-US')} · 本账号已用 ${quota.used.toLocaleString('en-US')}</em>
      <div class="fx-meter"><span class="w-64"></span></div>
    </div>
    <div class="quota-grid">
      <div><span>本账号配额</span><strong>不限量</strong></div>
      <div><span>剩余有效期</span><strong>2026-12-31</strong></div>
      <div><span>翻译池</span><strong>默认池</strong></div>
      <div><span>计费方式</span><strong>按原文字符</strong></div>
    </div>
    <p class="quota-note">休眠账号不消耗配额；唤醒后按实际翻译字符扣减。数据来自 M4 计费表（演示）。</p>`;
  openModal('quota-modal');
}

function openEditAccount(acc) {
  state.editingId = acc.id;
  const meta = channelMeta(acc.channel);
  editName.value = acc.name;
  editAvatar.value = acc.avatar || meta.icon;
  editAvatarPreview.dataset.channel = acc.channel;
  editAvatarPreview.textContent = acc.avatar || meta.icon;
  editNamePreview.textContent = acc.name;
  editSubPreview.textContent = meta.name + ' · ' + acc.partition;
  openModal('account-edit');
  setTimeout(() => editName.focus(), 30);
}

editName.addEventListener('input', () => { editNamePreview.textContent = editName.value || '账号名称'; });
editAvatar.addEventListener('input', () => { editAvatarPreview.textContent = editAvatar.value || '?'; });

editForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const acc = state.accounts.find((a) => a.id === state.editingId);
  if (!acc) return;
  acc.name = editName.value.trim() || acc.name;
  acc.avatar = editAvatar.value.trim() || acc.avatar;
  closeModal('account-edit');
  renderAccounts();
  renderContent();
  showGlobalToast('账号信息已更新');
});

function openSheet(title, node) {
  sheetTitle.textContent = title;
  sheetBody.replaceChildren(node);
  openModal('sheet-modal');
}

/* ---------- 标题栏 / 用户菜单 / 模式 ---------- */

function openLockScreen() {
  let overlay = document.getElementById('lock-screen');
  if (!overlay) {
    overlay = document.createElement('div');
    overlay.id = 'lock-screen';
    overlay.className = 'lock-screen';
    overlay.innerHTML = `<span class="lock-icon">${ICONS.lock}</span>
      <h2>工作台已锁定</h2>
      <p>账号与服务在后台保持运行，解锁后继续处理消息。</p>
      <button class="hp-primary" type="button">解锁</button>`;
    overlay.querySelector('button').addEventListener('click', () => {
      overlay.hidden = true;
      showGlobalToast('已解锁');
    });
    appView.appendChild(overlay);
  }
  overlay.hidden = false;
}

function handleTitleTool(tool) {
  if (tool === 'add') return openCatalog();
  if (tool === 'edit') return toggleFeature('writing');
  if (tool === 'search') return showGlobalToast('全局搜索待接入：账号 / 客户 / 消息');
  if (tool === 'home') {
    if (state.accounts.length) selectAccount(state.activeId || state.accounts[0].id);
    else renderContent();
    return;
  }
  if (tool === 'settings') return toggleFeature('other');
  if (tool === 'tasks') return toggleFeature('reminder');
  if (tool === 'stats') return showGlobalToast('粉丝统计为插件位预留（slot: analytics），后续版本接入');
  if (tool === 'bell') {
    state.view = 'system';
    renderAccounts();
    renderPageTabs();
    renderContent();
    return;
  }
  if (tool === 'support') {
    floatBall.classList.add('is-pulse');
    setTimeout(() => floatBall.classList.remove('is-pulse'), 1200);
    showGlobalToast('客服会话接入中，可点击右下角悬浮球');
    return;
  }
  if (tool === 'moon') return showGlobalToast('当前已是深色主题');
  if (tool === 'language') return showGlobalToast('界面语言：简体中文（多语言切换待接入）');
  if (tool === 'lock') return openLockScreen();
}

titleTools.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-tool]');
  if (btn) handleTitleTool(btn.dataset.tool);
});

userTrigger.addEventListener('click', (e) => {
  e.stopPropagation();
  userMenu.hidden = !userMenu.hidden;
});

userMenu.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-user-action]');
  if (!btn) return;
  userMenu.hidden = true;
  const action = btn.dataset.userAction;
  if (action === 'recharge') {
    selectPage('recharge');
  } else if (action === 'quota') {
    openQuota(activeAccount());
  } else if (action === 'agent') {
    openSheet('代理管理', buildAgentManagePanel());
  } else if (action === 'providers') {
    if (window.HaituoStudio) window.HaituoStudio.openProviderPanel();
  } else if (action === 'my-users') {
    openSheet('我的用户', buildMyUsersPanel());
  } else if (action === 'about') {
    openSheet('关于海拓', buildAboutPanel());
  } else if (action === 'logout') {
    closeAllOverlays();
    if (!state.demo) await window.haituo.auth.signOut();
    passwordInput.value = '';
    setMode('login');
    showAuth();
  }
});

function applyMode(mode, notify) {
  state.mode = mode;
  writeStorage(STORAGE.mode, mode);
  appView.classList.toggle('mode-vertical', mode === 'vertical');
  modeToggle.innerHTML = mode === 'vertical' ? ICONS.layoutH : ICONS.layoutV;
  modeToggle.title = mode === 'vertical' ? '切换为水平布局' : '切换为垂直布局';
  syncRailActive();
  if (mode === 'horizontal') revealActiveChip();
  if (notify) showGlobalToast(mode === 'vertical' ? '已切换为垂直账号栏' : '已切换为水平账号栏');
}

function setCollapsed(next) {
  state.collapsed = next;
  appView.classList.toggle('fx-collapsed', next);
  fxRestore.hidden = !next;
  collapseBtn.innerHTML = next ? ICONS.chevronLeft : ICONS.collapse;
  collapseBtn.title = next ? '展开快捷功能栏' : '收纳快捷功能栏';
  if (next) closePanel();
}

modeToggle.addEventListener('click', () => applyMode(state.mode === 'vertical' ? 'horizontal' : 'vertical', true));
collapseBtn.addEventListener('click', () => setCollapsed(!state.collapsed));
fxRestore.addEventListener('click', () => setCollapsed(false));
fxPanelClose.addEventListener('click', closePanel);
fxManage.addEventListener('click', toggleFxManager);
fxRailTop.addEventListener('click', bindFeatureRailClick);
railFeatures.addEventListener('click', bindFeatureRailClick);

pageTabs.addEventListener('click', pageTabsClick);
bindAccountContainer(acctChips);
bindAccountContainer(railAccounts);
acctAdd.addEventListener('click', openCatalog);
railAdd.addEventListener('click', openCatalog);
window.addEventListener('resize', revealActiveChip);

refreshBtn.addEventListener('click', () => {
  refreshBtn.classList.add('is-spinning');
  setTimeout(() => refreshBtn.classList.remove('is-spinning'), 700);
  renderContent();
  showGlobalToast('当前服务已刷新（演示）');
});

floatBall.querySelector('.float-icon').innerHTML = ICONS.support;
floatBall.addEventListener('click', () => {
  floatBadge.hidden = true;
  floatBall.classList.remove('is-pulse');
  showGlobalToast('客服会话接入中：可在「系统消息」查看回复');
});

catalogSearch.addEventListener('input', () => renderCatalog(catalogSearch.value));
catalogGrid.addEventListener('click', (e) => {
  const card = e.target.closest('[data-channel-id]');
  if (!card) return;
  const channel = CATALOG.find((c) => c.id === card.dataset.channelId);
  if (channel) openConfig(channel);
});

channelForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const channel = state.pendingChannel;
  if (!channel) return;
  const custom = Boolean(channel.custom || channel.url);
  const baseName = cfgName.value.trim() || channel.name + ' 01';
  const count = Math.max(1, Math.min(20, Number.parseInt(cfgCount.value, 10) || 1));
  const url = cfgUrl ? cfgUrl.value.trim() : '';
  if (custom && !/^https?:\/\/[^\s]+$/i.test(url)) {
    showGlobalToast('请填写以 http:// 或 https:// 开头的服务地址');
    cfgUrl.focus();
    return;
  }
  let drafts = [];
  try {
    const saved = JSON.parse(readStorage(STORAGE.drafts, '[]'));
    drafts = Array.isArray(saved) ? saved : [];
  } catch {
    drafts = [];
  }
  drafts.push({
    id: 'draft-' + Date.now() + '-' + shortId(),
    channel: channel.id,
    channelName: channel.name,
    custom,
    name: baseName,
    count,
    url,
    sendTranslate: cfgSendTr.checked,
    receiveTranslate: cfgRecvTr.checked,
    groupTranslate: cfgGroupTr.checked,
    fingerprint: cfgFingerprint.checked,
    region: cfgRegion.value,
    lang: cfgLang.value,
    browser: cfgBrowser.value,
    proxyMode: cfgProxyMode.value,
    proxy: cfgProxy ? cfgProxy.value.trim() : '',
    cookieLogin: cfgCookie.checked,
    savedAt: new Date().toISOString()
  });
  writeStorage(STORAGE.drafts, JSON.stringify(drafts));
  closeModal('channel-config');
  showGlobalToast('已保存配置草稿（共 ' + drafts.length + ' 条），首期不创建账号');
});

quotaRecharge.addEventListener('click', () => {
  closeModal('quota-modal');
  selectPage('recharge');
});

document.addEventListener('click', (e) => {
  const add = e.target.closest('[data-add-channel]');
  if (add) openCatalog();
  const toast = e.target.closest('[data-toast]');
  if (toast) showGlobalToast(toast.dataset.toast);
});

document.addEventListener('mousedown', (e) => {
  if (!userMenu.hidden && !e.target.closest('#user-menu-wrap') && !e.target.closest('#user-menu')) {
    userMenu.hidden = true;
  }
  if (!contextMenu.hidden && !e.target.closest('#context-menu')) closeAccountMenu();
  if (!fxManager.hidden && !e.target.closest('#fx-manager') && !e.target.closest('[data-fx-manage]') && e.target.id !== 'fx-manage') {
    fxManager.hidden = true;
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  const openBackdrop = Array.from(document.querySelectorAll('.modal-backdrop')).find((el) => !el.hidden);
  if (openBackdrop) { openBackdrop.hidden = true; return; }
  if (!contextMenu.hidden) { closeAccountMenu(); return; }
  if (!userMenu.hidden) { userMenu.hidden = true; return; }
  if (!fxManager.hidden) { fxManager.hidden = true; return; }
  if (state.fxOpen) closePanel();
});

/* ---------- 认证事件 ---------- */

tabLogin.addEventListener('click', () => setMode('login'));
tabRegister.addEventListener('click', () => setMode('register'));

forgotPassword.addEventListener('click', (e) => {
  e.preventDefault();
  setAuthMessage('密码重置功能待接入（将通过邮件完成）');
});

googleLogin.addEventListener('click', () => {
  setAuthMessage('Google 登录待接入（需在 Supabase 配置 OAuth Provider）');
});

demoLogin.addEventListener('click', () => {
  passwordInput.value = '';
  setMode('login');
  setAuthMessage('');
  showApp({ email: 'demo@haituo.local', role: 'owner', demo: true });
});

document.querySelectorAll('.auth-terms a').forEach((a) => {
  a.addEventListener('click', (e) => {
    e.preventDefault();
    setAuthMessage('服务协议 / 隐私政策待补充');
  });
});

authForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = emailInput.value.trim();
  const p = passwordInput.value;
  authMsg.classList.remove('is-ok');
  authMsg.textContent = '';

  if (!email || !p) {
    authMsg.textContent = '请输入邮箱和密码';
    return;
  }

  const res = authMode === 'login'
    ? await window.haituo.auth.signIn(email, p)
    : await window.haituo.auth.signUp(email, p);

  if (res.ok) {
    if (authMode === 'register') {
      emailInput.value = '';
      passwordInput.value = '';
      setMode('login');
      authMsg.classList.add('is-ok');
      authMsg.textContent = res.needsEmailConfirm
        ? '注册成功，请查收邮箱确认链接后登录'
        : '注册成功，请登录';
    } else {
      showApp(res.user);
    }
  } else {
    authMsg.textContent = res.error || '操作失败';
  }
});

window.haituo.auth.onAuthStateChange(async (payload) => {
  if (state.demo) return;
  if (payload.event === 'SIGNED_OUT') {
    showAuth('登录已失效，请重新登录');
  } else if (payload.event === 'SIGNED_IN') {
    const res = await window.haituo.auth.getSession();
    if (res && res.ok && res.user) showApp(res.user);
  }
});

async function boot() {
  paintWindowButtons();
  bindWindowControls();
  const status = await window.haituo.auth.status();
  configNotice.hidden = status.configured;
  demoHint.hidden = status.configured;

  const res = await window.haituo.auth.getSession();
  if (res && res.ok && res.user) {
    showApp(res.user);
  } else {
    showAuth();
  }
}

boot();
