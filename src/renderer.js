const services = window.HAITUO_SERVICES || [];
const management = window.HAITUO_MANAGEMENT || [];

const ROLE_LABELS = { owner: '所有者', agent: '代理', user: '用户' };

const authView = document.getElementById('auth-view');
const appView = document.getElementById('app-view');
const configNotice = document.getElementById('config-notice');
const tabLogin = document.getElementById('tab-login');
const tabRegister = document.getElementById('tab-register');
const authForm = document.getElementById('auth-form');
const emailInput = document.getElementById('email');
const passwordInput = document.getElementById('password');
const authMsg = document.getElementById('auth-msg');
const authSubmit = document.getElementById('auth-submit');
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
}

function showAuth(message, isOk) {
  appView.classList.remove('is-active');
  authView.classList.add('is-active');
  authMsg.textContent = message || '';
  authMsg.classList.toggle('is-ok', Boolean(message) && Boolean(isOk));
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
  authMsg.textContent = '';
  content.innerHTML = '';
  renderServices();
  renderManagement(role);
}

function addEntry(navContainer, entry, isActive) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'nav-item' + (isActive ? ' is-active' : '');
  btn.dataset.service = entry.id;
  btn.innerHTML = `<span class="nav-icon">${escapeHtml(entry.icon)}</span><span>${escapeHtml(entry.name)}</span>`;
  btn.addEventListener('click', () => selectEntry(entry.id));
  navContainer.appendChild(btn);

  const panel = document.createElement('section');
  panel.className = 'panel' + (isActive ? ' is-active' : '');
  panel.dataset.panel = entry.id;
  panel.innerHTML =
    `<h1>${escapeHtml(entry.name)}</h1>` +
    `<span class="wip">开发中</span>` +
    `<p class="placeholder">${escapeHtml(entry.desc)}</p>`;
  content.appendChild(panel);
}

function renderServices() {
  navServices.innerHTML = '';
  services.forEach((svc, i) => addEntry(navServices, svc, i === 0));
}

function renderManagement(role) {
  navManagement.innerHTML = '';
  const visible = management.filter((m) => (m.roles || []).includes(role));
  mgmtSection.hidden = visible.length === 0;
  visible.forEach((m) => addEntry(navManagement, m, false));
}

function selectEntry(id) {
  document.querySelectorAll('.nav-item').forEach((n) =>
    n.classList.toggle('is-active', n.dataset.service === id)
  );
  document.querySelectorAll('.panel').forEach((p) =>
    p.classList.toggle('is-active', p.dataset.panel === id)
  );
}

tabLogin.addEventListener('click', () => setMode('login'));
tabRegister.addEventListener('click', () => setMode('register'));

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
