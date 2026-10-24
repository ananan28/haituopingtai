const services = window.HAITUO_SERVICES || [];
const management = window.HAITUO_MANAGEMENT || [];
const brand = (window.haituo && window.haituo.brand) || { name: '海拓商业版', version: '0.1.0' };

document.title = brand.name;
document.querySelectorAll('[data-brand]').forEach((el) => { el.textContent = brand.name; });

const ROLE_LABELS = { owner: '所有者', agent: '代理', user: '用户' };

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
const navServices = document.getElementById('nav-services');
const navManagement = document.getElementById('nav-management');
const mgmtSection = document.getElementById('mgmt-section');
const content = document.getElementById('content');
const userAvatar = document.getElementById('user-avatar');
const userName = document.getElementById('user-name');
const roleBadge = document.getElementById('role-badge');
const logoutBtn = document.getElementById('logout');
const aboutBtn = document.getElementById('about-btn');
const aboutModal = document.getElementById('about-modal');
const aboutClose = document.getElementById('about-close');

document.getElementById('about-version').textContent = brand.version || '0.1.0';

let mode = 'login'; // 'login' | 'register'

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function setMode(next) {
  mode = next;
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
  appView.classList.remove('is-active');
  authView.classList.add('is-active');
  setAuthMessage(message, isOk);
}

function showApp(user) {
  const email = (user && user.email) || (typeof user === 'string' ? user : '') || '';
  const role = (user && user.role) || 'user';
  authView.classList.remove('is-active');
  appView.classList.add('is-active');
  userAvatar.textContent = email.charAt(0).toUpperCase();
  userName.textContent = email;
  roleBadge.textContent = ROLE_LABELS[role] || role;
  roleBadge.dataset.role = role;
  setAuthMessage('');
  content.innerHTML = '';
  renderServices();
  renderManagement(role);
}

function addNavButton(navContainer, entry, isActive) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'nav-item' + (isActive ? ' is-active' : '');
  btn.dataset.service = entry.id;
  btn.innerHTML = `<span class="nav-icon">${escapeHtml(entry.icon)}</span><span>${escapeHtml(entry.name)}</span>`;
  btn.addEventListener('click', () => selectEntry(entry.id));
  navContainer.appendChild(btn);
  return btn;
}

function buildPlaceholderPanel(svc) {
  const frag = document.createDocumentFragment();
  const h = document.createElement('h1');
  h.textContent = svc.name;
  frag.appendChild(h);
  const wip = document.createElement('span');
  wip.className = 'wip';
  wip.textContent = '开发中';
  frag.appendChild(wip);
  const p = document.createElement('p');
  p.className = 'placeholder';
  p.textContent = svc.desc;
  frag.appendChild(p);
  return frag;
}

function renderServices() {
  navServices.innerHTML = '';
  services.forEach((svc, i) => {
    addNavButton(navServices, svc, i === 0);
    const panel = document.createElement('section');
    panel.className = 'panel' + (i === 0 ? ' is-active' : '');
    panel.dataset.panel = svc.id;
    if (svc.id === 'chat') panel.appendChild(buildChatPanel());
    else if (svc.id === 'translate') panel.appendChild(buildTranslatePanel());
    else if (svc.id === 'recharge') panel.appendChild(buildRechargePanel());
    else panel.appendChild(buildPlaceholderPanel(svc));
    content.appendChild(panel);
  });
  syncContentMode(services[0] ? services[0].id : '');
}

function renderManagement(role) {
  navManagement.innerHTML = '';
  const visible = management.filter((m) => (m.roles || []).includes(role));
  mgmtSection.hidden = visible.length === 0;

  visible.forEach((m) => {
    addNavButton(navManagement, m, false);

    const panel = document.createElement('section');
    panel.className = 'panel';
    panel.dataset.panel = m.id;
    const h = document.createElement('h1');
    h.textContent = m.name;
    panel.appendChild(h);
    panel.appendChild(m.id === 'agent-manage' ? buildAgentManagePanel() : buildMyUsersPanel());
    content.appendChild(panel);
  });
}

function syncContentMode(activeId) {
  content.classList.toggle('is-chat', activeId === 'chat');
}

function selectEntry(id) {
  document.querySelectorAll('.nav-item').forEach((n) =>
    n.classList.toggle('is-active', n.dataset.service === id)
  );
  document.querySelectorAll('.panel').forEach((p) =>
    p.classList.toggle('is-active', p.dataset.panel === id)
  );
  syncContentMode(id);
}

// ---------- 会话占位 ----------

const CHAT_STORAGE_KEY = 'haituo.chat.settings';
const CHAT_DEFAULTS = { target: 'zh', always: true, history: false, outgoing: false, role: 'business' };
const CHAT_TARGETS = [
  { id: 'zh', label: '中文' },
  { id: 'en', label: 'English' },
  { id: 'fr', label: 'Français' }
];
const CHAT_ROLES = [
  { id: 'business', name: '商务口吻' },
  { id: 'casual', name: '日常口语' },
  { id: 'tech', name: '技术术语' }
];
const CHAT_MESSAGES = [
  {
    id: 'm1', side: 'in', name: 'Léa Martin', avatar: 'LM', time: '09:41',
    text: "Bonjour, je souhaite commander 20 pièces. Est-ce possible d'avoir un devis ?",
    tr: {
      zh: '您好，我想订购 20 件，可以给我一份报价吗？',
      en: 'Hello, I would like to order 20 units. Could you send me a quote?'
    }
  },
  {
    id: 'm2', side: 'out', name: '我', avatar: '我', time: '09:42',
    text: '您好，20 件可以安排。请提供型号和收货城市，我马上为您报价。',
    tr: {
      en: 'Sure, 20 units can be arranged. Please share the model and destination city, and I will quote you right away.',
      fr: "Bonjour, 20 pièces sont possibles. Merci de préciser le modèle et la ville de livraison, je vous envoie un devis."
    }
  },
  {
    id: 'm3', side: 'in', name: 'Léa Martin', avatar: 'LM', time: '09:44',
    text: "Modèle X200, livraison à Lyon. Le client est pressé, c'est pour un événement.",
    tr: {
      zh: '型号 X200，配送到里昂。客户比较着急，是活动要用的。',
      en: 'Model X200, delivery to Lyon. The client is in a hurry — it is for an event.'
    }
  },
  {
    id: 'm4', side: 'out', name: '我', avatar: '我', time: '09:46',
    text: '收到。X200 有现货，报价 12.8 欧元/件，里昂市区 48 小时送达。',
    tr: {
      en: 'Noted. The X200 is in stock, quoted at €12.80 per unit, delivered in Lyon within 48 hours.',
      fr: "Bien reçu. Le X200 est en stock, à 12,80 € pièce, livraison à Lyon sous 48 h."
    }
  },
  {
    id: 'm5', side: 'in', name: 'Léa Martin', avatar: 'LM', time: '09:48',
    text: 'Parfait, merci beaucoup ! Je confirme la commande.',
    tr: {
      zh: '太好了，非常感谢！我确认下单。',
      en: 'Perfect, thank you very much! I confirm the order.'
    }
  }
];

function loadChatSettings() {
  try {
    return { ...CHAT_DEFAULTS, ...JSON.parse(localStorage.getItem(CHAT_STORAGE_KEY) || '{}') };
  } catch {
    return { ...CHAT_DEFAULTS };
  }
}

function saveChatSettings(settings) {
  try {
    localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    /* 本地设置不可用时仅当前会话生效 */
  }
}

function translationFor(msg, target) {
  if (!msg.tr) return '';
  const text = msg.tr[target] || '';
  if (!text) return '';
  if (target === 'zh' && msg.side === 'out') return '';
  if (target === 'fr' && msg.side === 'in') return '';
  return text;
}

function fallbackCopy(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  const ok = document.execCommand('copy');
  ta.remove();
  if (!ok) throw new Error('copy failed');
}

function copyText(text) {
  if (window.haituo.clipboard && window.haituo.clipboard.write) {
    return window.haituo.clipboard.write(text)
      .then((res) => {
        if (!res || res.ok === false) throw new Error('copy failed');
      })
      .catch(() => fallbackCopy(text));
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
  }
  return Promise.resolve(fallbackCopy(text));
}

const SEARCH_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/></svg>';

function buildChatPanel() {
  const settings = loadChatSettings();
  const now = new Date();
  const shell = document.createElement('div');
  shell.className = 'chat-shell';

  const main = document.createElement('section');
  main.className = 'chat-main';
  shell.appendChild(main);

  const head = document.createElement('header');
  head.className = 'chat-head';
  head.innerHTML =
    '<div class="chat-peer">' +
      '<span class="chat-avatar">LM</span>' +
      '<div class="chat-peer-info">' +
        '<div class="chat-peer-name">Léa Martin <span class="chat-channel">WhatsApp</span></div>' +
        '<div class="chat-peer-sub"><span class="online-dot"></span>在线 · 法国客户 · 演示会话</div>' +
      '</div>' +
    '</div>' +
    '<div class="chat-head-actions">' +
      '<button type="button" class="icon-btn" data-head="search" title="搜索会话">' + SEARCH_ICON + '</button>' +
      '<button type="button" class="icon-btn icon-more" data-head="more" title="更多操作">⋯</button>' +
    '</div>';
  main.appendChild(head);

  const body = document.createElement('div');
  body.className = 'chat-body';
  main.appendChild(body);

  const date = document.createElement('div');
  date.className = 'chat-date';
  date.textContent = '今天 · ' + (now.getMonth() + 1) + ' 月 ' + now.getDate() + ' 日';
  body.appendChild(date);

  const historyBanner = document.createElement('div');
  historyBanner.className = 'history-banner';
  historyBanner.innerHTML = '<span class="online-dot"></span>已补翻 24 条历史消息（演示）';
  body.appendChild(historyBanner);

  const list = document.createElement('div');
  list.className = 'chat-messages';
  body.appendChild(list);

  const toast = document.createElement('div');
  toast.className = 'chat-toast';
  shell.appendChild(toast);
  let toastTimer = null;
  function showToast(text) {
    toast.textContent = text;
    toast.classList.add('is-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('is-show'), 1800);
  }

  const msgRows = [];

  function updateMessageTranslation(row, msg) {
    const trEl = row.querySelector('.msg-translation');
    const text = translationFor(msg, settings.target);
    const manual = row.dataset.manualTr === '1';
    const enabled = manual || (settings.always && (msg.side === 'in' || settings.outgoing));
    trEl.hidden = !(text && enabled);
    row.querySelector('.msg-tr-text').textContent = text || '';
    row.querySelector('.btn-translate').classList.toggle('is-on', manual);
  }

  function appendMessage(msg) {
    const row = document.createElement('div');
    row.className = 'msg msg-' + (msg.side === 'out' ? 'out' : 'in');
    row.dataset.msgId = msg.id;
    row.innerHTML =
      '<div class="msg-avatar' + (msg.side === 'out' ? ' is-me' : '') + '">' + escapeHtml(msg.avatar) + '</div>' +
      '<div class="msg-main">' +
        '<div class="msg-meta"><span class="msg-name">' + escapeHtml(msg.name) + '</span>' +
          '<span class="msg-time">' + escapeHtml(msg.time) + '</span></div>' +
        '<div class="msg-bubble-wrap">' +
          '<div class="msg-bubble">' + escapeHtml(msg.text) + '</div>' +
          '<div class="msg-actions">' +
            '<button type="button" class="msg-action btn-translate" data-act="translate" title="翻译这条消息">译</button>' +
            '<button type="button" class="msg-action" data-act="copy" title="复制消息">复制</button>' +
            '<button type="button" class="msg-action" data-act="note" title="添加备注">备注</button>' +
          '</div>' +
        '</div>' +
        '<div class="msg-translation" hidden><span class="msg-tr-tag">译</span><span class="msg-tr-text"></span></div>' +
        '<div class="msg-note" hidden><span class="msg-note-tag">备注</span><span class="msg-note-text"></span></div>' +
        '<div class="msg-note-editor" hidden><input type="text" placeholder="输入备注，回车保存" maxlength="120" />' +
          '<button type="button" class="note-save">保存</button></div>' +
      '</div>';
    const noteEl = row.querySelector('.msg-note');
    const noteEditor = row.querySelector('.msg-note-editor');
    const noteInput = noteEditor.querySelector('input');

    row.querySelector('[data-act="translate"]').addEventListener('click', () => {
      row.dataset.manualTr = row.dataset.manualTr === '1' ? '0' : '1';
      updateMessageTranslation(row, msg);
      if (!translationFor(msg, settings.target)) showToast('该消息与目标语言相同，无需翻译');
    });
    row.querySelector('[data-act="copy"]').addEventListener('click', () => {
      copyText(msg.text)
        .then(() => showToast('消息已复制'))
        .catch(() => showToast('复制失败，请手动选择'));
    });
    row.querySelector('[data-act="note"]').addEventListener('click', () => {
      const willShow = noteEditor.hidden;
      noteEditor.hidden = !willShow;
      if (willShow) noteInput.focus();
    });

    function saveNote() {
      const value = noteInput.value.trim();
      noteEl.hidden = !value;
      noteEl.querySelector('.msg-note-text').textContent = value;
      noteEditor.hidden = true;
      if (value) showToast('备注已保存（本地）');
    }
    noteEditor.querySelector('.note-save').addEventListener('click', saveNote);
    noteInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        saveNote();
      }
      if (e.key === 'Escape') noteEditor.hidden = true;
    });

    list.appendChild(row);
    msgRows.push({ row, msg });
    updateMessageTranslation(row, msg);
    body.scrollTop = body.scrollHeight;
  }

  function updateAllTranslations() {
    msgRows.forEach(({ row, msg }) => updateMessageTranslation(row, msg));
  }

  CHAT_MESSAGES.forEach(appendMessage);
  historyBanner.hidden = !settings.history;

  const composer = document.createElement('footer');
  composer.className = 'composer';
  composer.innerHTML =
    '<div class="composer-box">' +
      '<button type="button" class="composer-tool" data-tool="attach" title="附件">＋</button>' +
      '<textarea rows="1" placeholder="输入消息，Enter 发送，Shift + Enter 换行"></textarea>' +
      '<button type="button" class="send-btn" disabled>发送</button>' +
    '</div>' +
    '<div class="composer-meta">' +
      '<span class="composer-count">已输入 0 字符</span>' +
      '<span class="composer-bill">发送后按字符计费 · M4 接入</span>' +
      '<span class="composer-demo">演示会话，不连接真实渠道</span>' +
    '</div>';
  main.appendChild(composer);

  const textarea = composer.querySelector('textarea');
  const sendBtn = composer.querySelector('.send-btn');
  const countEl = composer.querySelector('.composer-count');

  function updateComposer() {
    const n = textarea.value.length;
    countEl.textContent = '已输入 ' + n + ' 字符';
    sendBtn.disabled = n === 0;
  }

  function sendMessage() {
    const text = textarea.value.trim();
    if (!text) return;
    const t = new Date();
    const time = String(t.getHours()).padStart(2, '0') + ':' + String(t.getMinutes()).padStart(2, '0');
    appendMessage({ id: 'local-' + Date.now(), side: 'out', name: '我', avatar: '我', time, text });
    textarea.value = '';
    updateComposer();
    showToast('已加入演示会话（不发送到真实渠道）');
    textarea.focus();
  }

  textarea.addEventListener('input', updateComposer);
  textarea.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
  sendBtn.addEventListener('click', sendMessage);
  composer.querySelector('[data-tool="attach"]').addEventListener('click', () => showToast('附件功能待接入'));

  head.querySelectorAll('.icon-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      showToast(btn.dataset.head === 'search' ? '会话搜索待接入' : '更多操作待接入');
    });
  });

  const side = document.createElement('aside');
  side.className = 't-side';
  const targetOptions = CHAT_TARGETS.map((t) =>
    '<option value="' + t.id + '"' + (t.id === settings.target ? ' selected' : '') + '>' + t.label + '</option>'
  ).join('');
  side.innerHTML =
    '<div class="t-side-head"><h3>翻译设置</h3><span class="demo-pill">演示</span></div>' +
    '<div class="t-field">' +
      '<label for="chat-target">目标语言</label>' +
      '<div class="select-wrap"><select id="chat-target">' + targetOptions + '</select></div>' +
      '<p class="t-help">对方消息自动翻译为此语言</p>' +
    '</div>' +
    '<div class="t-switch-list">' +
      '<label class="switch-row">' +
        '<span class="switch-text"><strong>始终翻译</strong><small>自动翻译所有收到的消息</small></span>' +
        '<input type="checkbox" data-setting="always"' + (settings.always ? ' checked' : '') + ' />' +
        '<span class="switch"></span>' +
      '</label>' +
      '<label class="switch-row">' +
        '<span class="switch-text"><strong>历史消息翻译</strong><small>进入会话时补翻历史消息</small></span>' +
        '<input type="checkbox" data-setting="history"' + (settings.history ? ' checked' : '') + ' />' +
        '<span class="switch"></span>' +
      '</label>' +
      '<label class="switch-row">' +
        '<span class="switch-text"><strong>发出消息也翻译</strong><small>发送前翻译成对方语言</small></span>' +
        '<input type="checkbox" data-setting="outgoing"' + (settings.outgoing ? ' checked' : '') + ' />' +
        '<span class="switch"></span>' +
      '</label>' +
    '</div>' +
    '<div class="t-divider"></div>' +
    '<div class="t-role">' +
      '<button type="button" class="role-entry">' +
        '<span class="role-icon">角</span>' +
        '<span class="role-copy"><strong>自定义翻译角色</strong><small class="role-current"></small></span>' +
        '<span class="role-chevron">›</span>' +
      '</button>' +
      '<div class="role-options" hidden></div>' +
    '</div>' +
    '<div class="t-quota">' +
      '<div class="t-quota-head"><span>翻译额度</span><button type="button" class="t-recharge">充值</button></div>' +
      '<div class="t-quota-num">1,284,600 <span>字符</span></div>' +
      '<div class="t-quota-bar"><span></span></div>' +
      '<div class="t-quota-foot">本会话已用 0 字符 · 额度可分配给子账号</div>' +
    '</div>' +
    '<p class="t-note">演示语种：中文 / English / Français</p>' +
    '<div class="t-side-foot"><span class="online-dot"></span>WhatsApp · 账号数据隔离</div>';
  shell.appendChild(side);

  const roleOptions = side.querySelector('.role-options');
  const currentRoleEl = side.querySelector('.role-current');
  function updateRoleLabel() {
    const role = CHAT_ROLES.find((r) => r.id === settings.role) || CHAT_ROLES[0];
    currentRoleEl.textContent = role.name + ' · 点击切换';
  }
  CHAT_ROLES.forEach((role) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'role-chip' + (settings.role === role.id ? ' is-active' : '');
    chip.textContent = role.name;
    chip.addEventListener('click', () => {
      settings.role = role.id;
      saveChatSettings(settings);
      roleOptions.querySelectorAll('.role-chip').forEach((c) => c.classList.toggle('is-active', c === chip));
      updateRoleLabel();
      showToast('翻译角色已切换为「' + role.name + '」（演示）');
    });
    roleOptions.appendChild(chip);
  });
  updateRoleLabel();
  side.querySelector('.role-entry').addEventListener('click', () => {
    roleOptions.hidden = !roleOptions.hidden;
    side.querySelector('.role-entry').classList.toggle('is-open', !roleOptions.hidden);
  });
  side.querySelector('.t-recharge').addEventListener('click', () => selectEntry('recharge'));

  side.querySelectorAll('input[data-setting]').forEach((input) => {
    input.addEventListener('change', () => {
      const key = input.dataset.setting;
      settings[key] = input.checked;
      saveChatSettings(settings);
      if (key === 'history') historyBanner.hidden = !settings.history;
      if (key === 'always' || key === 'outgoing') updateAllTranslations();
      showToast('翻译设置已更新（本地）');
    });
  });

  side.querySelector('#chat-target').addEventListener('change', (e) => {
    settings.target = e.target.value;
    saveChatSettings(settings);
    updateAllTranslations();
    showToast('目标语言已切换为 ' + e.target.options[e.target.selectedIndex].text);
  });

  return shell;
}

// ---------- 翻译首页 ----------

const SRC_LANGS = ['自动检测', '中文', '英文', '日语', '韩语', '法语', '德语', '西班牙语', '俄语'];
const TGT_LANGS = ['中文', '英文', '日语', '韩语', '法语', '德语', '西班牙语', '俄语'];

function buildTranslatePanel() {
  const wrap = document.createElement('div');
  wrap.className = 'translate';

  const head = document.createElement('div');
  head.className = 'translate-head';
  head.innerHTML = '<h2>180+ 语言互译</h2><p>多语言翻译 · 文档翻译 · 实时语音合成 · RESTful API</p>';
  wrap.appendChild(head);

  const langRow = document.createElement('div');
  langRow.className = 'translate-langs';
  const src = document.createElement('select');
  const tgt = document.createElement('select');
  SRC_LANGS.forEach((l, i) => src.add(new Option(l, l, false, i === 1)));
  TGT_LANGS.forEach((l, i) => tgt.add(new Option(l, l, false, i === 1)));
  const swap = document.createElement('button');
  swap.type = 'button';
  swap.className = 'translate-swap';
  swap.textContent = '⇄';
  swap.title = '交换语言';
  swap.addEventListener('click', () => {
    const a = src.value, b = tgt.value;
    src.value = b; tgt.value = a;
  });
  langRow.appendChild(src);
  langRow.appendChild(swap);
  langRow.appendChild(tgt);
  wrap.appendChild(langRow);

  const io = document.createElement('div');
  io.className = 'translate-io';
  const input = document.createElement('textarea');
  input.placeholder = '输入要翻译的内容…';
  const output = document.createElement('textarea');
  output.readOnly = true;
  output.placeholder = '翻译结果';
  io.appendChild(input);
  io.appendChild(output);
  wrap.appendChild(io);

  const note = document.createElement('div');
  note.className = 'translate-note';
  note.textContent = '翻译引擎未接入，当前为占位翻译（里程碑4 接入字符扣费）';
  wrap.appendChild(note);

  const bar = document.createElement('div');
  bar.className = 'translate-bar';
  const count = document.createElement('span');
  count.className = 'translate-count';
  count.textContent = '已输入 0 字符';
  const go = document.createElement('button');
  go.type = 'button';
  go.className = 'translate-go';
  go.textContent = '翻译';
  input.addEventListener('input', () => {
    count.textContent = '已输入 ' + input.value.length + ' 字符';
  });
  go.addEventListener('click', () => {
    count.textContent = '已输入 ' + input.value.length + ' 字符';
    output.value = input.value ? '【占位翻译】' + input.value : '';
  });
  bar.appendChild(count);
  bar.appendChild(go);
  wrap.appendChild(bar);

  const cards = document.createElement('div');
  cards.className = 'feature-cards';
  const feats = [
    { title: '文档翻译', desc: '整篇文档多语言互译' },
    { title: '实时语音合成', desc: '文本转语音（TTS）' },
    { title: 'RESTful API 集成', desc: '开发者接口接入' }
  ];
  feats.forEach((f) => {
    const c = document.createElement('div');
    c.className = 'feature-card';
    c.innerHTML = `<h3>${escapeHtml(f.title)}</h3><p>${escapeHtml(f.desc)}</p><span class="wip">开发中</span>`;
    cards.appendChild(c);
  });
  wrap.appendChild(cards);

  const links = document.createElement('div');
  links.className = 'service-links';
  const rcLabel = document.createElement('span');
  rcLabel.className = 'link-label';
  rcLabel.textContent = '充值中心';
  links.appendChild(rcLabel);
  const recharge = document.createElement('button');
  recharge.type = 'button';
  recharge.className = 'chip-link';
  recharge.textContent = '去充值';
  recharge.addEventListener('click', () => selectEntry('recharge'));
  links.appendChild(recharge);
  const csLabel = document.createElement('span');
  csLabel.className = 'link-label';
  csLabel.textContent = '客服';
  links.appendChild(csLabel);
  ['微信', 'WhatsApp', 'Telegram'].forEach((k) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip-link';
    b.textContent = k;
    b.addEventListener('click', () => { note.textContent = k + ' 客服入口待接入'; });
    links.appendChild(b);
  });
  wrap.appendChild(links);

  return wrap;
}

// ---------- 充值中心 ----------

const RECHARGE_PACKAGES = [
  { id: 'starter', name: '体验包', price: '9.9', chars: '50 万', unit: '0.0198 元 / 千字符', desc: '适合个人试用与小批量沟通' },
  { id: 'standard', name: '标准包', price: '49', chars: '300 万', unit: '0.0163 元 / 千字符', desc: '适合小团队日常跨境沟通', badge: '热门' },
  { id: 'pro', name: '专业包', price: '199', chars: '1500 万', unit: '0.0133 元 / 千字符', desc: '适合高频业务与多账号运营', badge: '最划算' }
];

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
  globalToastTimer = setTimeout(() => el.classList.remove('is-show'), 2000);
}

function buildRechargePanel() {
  const wrap = document.createElement('div');
  wrap.className = 'rc';
  const packages = RECHARGE_PACKAGES.map((p) =>
    '<article class="rc-package' + (p.badge === '热门' ? ' is-featured' : '') + '">' +
      (p.badge ? '<span class="rc-badge">' + p.badge + '</span>' : '') +
      '<h3>' + p.name + '</h3>' +
      '<div class="rc-price"><span>¥</span>' + p.price + '</div>' +
      '<div class="rc-chars">' + p.chars + ' 字符</div>' +
      '<div class="rc-unit">' + p.unit + '</div>' +
      '<p>' + p.desc + '</p>' +
      '<button type="button" class="rc-buy" data-package="' + p.id + '">立即充值</button>' +
    '</article>'
  ).join('');

  wrap.innerHTML =
    '<div class="rc-head">' +
      '<div><h1>充值中心</h1><p>按字符计费 · 额度可分配给子账号 · 代理分成自动计入</p></div>' +
      '<span class="demo-badge">演示数据</span>' +
    '</div>' +
    '<section class="rc-wallet">' +
      '<div class="rc-wallet-main">' +
        '<div class="rc-label">字符余额</div>' +
        '<div class="rc-balance">1,284,600 <span>字符</span></div>' +
        '<div class="rc-sub">免费额度 100,000 字符 · 本月已用 32,400 字符</div>' +
        '<div class="rc-progress"><span style="width: 64%"></span></div>' +
      '</div>' +
      '<div class="rc-wallet-side">' +
        '<div><span>账号位</span><strong>1 / 3</strong></div>' +
        '<div><span>翻译池</span><strong>2 个</strong></div>' +
        '<div><span>额度有效期</span><strong>2026-12-31</strong></div>' +
      '</div>' +
    '</section>' +
    '<div class="rc-section-head"><h2>充值套餐</h2><span>低至 0.0133 元 / 千字符</span></div>' +
    '<div class="rc-packages">' + packages + '</div>' +
    '<div class="rc-grid">' +
      '<section class="rc-card">' +
        '<h3>额度规则</h3>' +
        '<ul class="rc-list">' +
          '<li>仅翻译成功时按原文字符数扣费</li>' +
          '<li>免费额度用完后自动使用付费余额</li>' +
          '<li>额度可分配给子账号，0 表示不限量</li>' +
          '<li>额度支持起止有效期，到期自动停用</li>' +
        '</ul>' +
      '</section>' +
      '<section class="rc-card">' +
        '<h3>代理分销</h3>' +
        '<p>直客与间客佣金按代理比例自动计入分成，提现入口在代理中心。</p>' +
        '<button type="button" class="rc-ghost" data-act="agent-rule">查看分成规则</button>' +
      '</section>' +
    '</div>' +
    '<p class="rc-footnote">支付通道尚未接入，本页金额与余额为界面演示数据；计费表结构已准备（M4）。</p>';

  wrap.querySelectorAll('.rc-buy').forEach((btn) => {
    btn.addEventListener('click', () => {
      const pkg = RECHARGE_PACKAGES.find((p) => p.id === btn.dataset.package);
      showGlobalToast('支付通道接入中：' + (pkg ? pkg.name + ' · ' + pkg.chars + ' 字符' : ''));
    });
  });
  const agentRule = wrap.querySelector('[data-act="agent-rule"]');
  if (agentRule) agentRule.addEventListener('click', () => showGlobalToast('代理分成规则待接入（直客 / 间客 / 提现）'));

  return wrap;
}

// ---------- 管理面板 ----------

function mgmtRow(email, roleLabel, role, extra, actionBtn) {
  const row = document.createElement('div');
  row.className = 'mgmt-row';
  row.innerHTML = `<span class="mgmt-email">${escapeHtml(email)}</span>` +
    `<span class="mgmt-tag" data-role="${escapeHtml(role)}">${escapeHtml(roleLabel)}</span>` +
    (extra ? `<span class="mgmt-extra">${escapeHtml(extra)}</span>` : '');
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
  promoteForm.innerHTML =
    '<label>邮箱 <input name="email" type="email" placeholder="user@example.com" /></label>' +
    '<label>分成 % <input name="rate" type="number" min="0" max="100" step="0.1" placeholder="30" /></label>' +
    '<button type="submit">设为代理</button>';
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
  assignForm.innerHTML =
    '<label>用户邮箱 <input name="userEmail" type="email" placeholder="user@example.com" /></label>' +
    '<label>代理邮箱 <input name="agentEmail" type="email" placeholder="agent@example.com" /></label>' +
    '<button type="submit">分配到代理</button>';
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
    for (const u of users) {
      list.appendChild(mgmtRow(u.email, '', '', '', null));
    }
  }

  wrap.appendChild(list);
  load();
  return wrap;
}

// ---------- 事件 ----------

tabLogin.addEventListener('click', () => setMode('login'));
tabRegister.addEventListener('click', () => setMode('register'));

aboutBtn.addEventListener('click', () => { aboutModal.hidden = false; });
aboutClose.addEventListener('click', () => { aboutModal.hidden = true; });
aboutModal.addEventListener('click', (e) => {
  if (e.target === aboutModal) aboutModal.hidden = true;
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') aboutModal.hidden = true;
});

forgotPassword.addEventListener('click', (e) => {
  e.preventDefault();
  setAuthMessage('密码重置功能待接入（将通过邮件完成）');
});

googleLogin.addEventListener('click', () => {
  setAuthMessage('Google 登录待接入（需在 Supabase 配置 OAuth Provider）');
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

  const res = mode === 'login'
    ? await window.haituo.auth.signIn(email, p)
    : await window.haituo.auth.signUp(email, p);

  if (res.ok) {
    if (mode === 'register') {
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

logoutBtn.addEventListener('click', async () => {
  await window.haituo.auth.signOut();
  passwordInput.value = '';
  setMode('login');
  showAuth();
});

window.haituo.auth.onAuthStateChange(async (payload) => {
  if (payload.event === 'SIGNED_OUT') {
    showAuth('登录已失效，请重新登录');
  } else if (payload.event === 'SIGNED_IN') {
    const res = await window.haituo.auth.getSession();
    if (res && res.ok && res.user) showApp(res.user);
  }
});

async function boot() {
  const status = await window.haituo.auth.status();
  configNotice.hidden = status.configured;

  const res = await window.haituo.auth.getSession();
  if (res && res.ok && res.user) {
    showApp(res.user);
  } else {
    showAuth();
  }
}

boot();
