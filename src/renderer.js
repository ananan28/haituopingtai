const services = window.HAITUO_SERVICES || [];
const management = window.HAITUO_MANAGEMENT || [];

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
    panel.appendChild(svc.id === 'translate' ? buildTranslatePanel() : buildPlaceholderPanel(svc));
    content.appendChild(panel);
  });
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

function selectEntry(id) {
  document.querySelectorAll('.nav-item').forEach((n) =>
    n.classList.toggle('is-active', n.dataset.service === id)
  );
  document.querySelectorAll('.panel').forEach((p) =>
    p.classList.toggle('is-active', p.dataset.panel === id)
  );
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
  recharge.textContent = '去充值（开发中）';
  recharge.addEventListener('click', () => { note.textContent = '充值中心待接入（里程碑4）'; });
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
