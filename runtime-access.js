const path = require('path');
const { pathToFileURL } = require('url');
const auth = require('./auth');

const COMMON = ['home', 'account', 'accounts', 'usage', 'appearance', 'other', 'about', 'logout'];
const TRANSLATE = ['translate', 'basic-translate', 'advanced-translate', 'screenshot'];
// 权限点按《权限能力范围方案》矩阵白名单化；agent 已并入 user（代理=商户，同一角色）。
const RULES = {
  owner: [...COMMON, ...TRANSLATE, 'recharge', 'system', 'tg', 'catalog', 'account-edit', 'account-delete',
    'providers', 'announcements', 'writing', 'proxy', 'fingerprint',
    'staff:manage', 'quota:allocate', 'account:suspend', 'password:reset', 'audit:read', 'order:view', 'role:manage', 'pricing'],
  admin: [...COMMON, ...TRANSLATE, 'system', 'announcements', 'providers', 'pricing', 'catalog', 'account-edit',
    'staff:manage', 'quota:allocate', 'account:suspend', 'password:reset', 'audit:read', 'order:view'],
  user: [...COMMON, ...TRANSLATE, 'recharge', 'catalog', 'account-edit', 'account-delete',
    'staff:manage', 'quota:allocate', 'password:reset', 'order:view'],
  staff: [...COMMON, 'translate', 'basic-translate', 'password:reset']
};
const LABELS = { owner: '所有者', admin: '管理员', user: '商户 / 代理', staff: '员工子账号' };
const ROLES = ['owner', 'admin', 'user', 'staff'];
const ACCOUNT_IDS = ['wa-lea', 'tg-chen', 'wa-group', 'sg-sophie'];
let current = null;
let demo = false;
let local = false;
let generation = 0;
let busy = false;
let allowRestore = true;
let verification = 0;
let mainContents = null;
const listeners = new Set();

function changed() {
  generation += 1;
  for (const listener of listeners) listener();
}

function trusted(event) {
  return event.sender === mainContents && Boolean(event.senderFrame) && event.senderFrame === event.sender.mainFrame
    && event.senderFrame.url === pathToFileURL(path.join(__dirname, 'src', 'index.html')).href;
}

function identity(user, isDemo) {
  const role = user.role;
  const serverAccounts = Array.isArray(user.accountIds) ? user.accountIds : [];
  return Object.freeze({
    id: user.id, email: user.email, role, label: LABELS[role], demo: isDemo, revision: generation,
    scope: isDemo ? 'demo:' + role : 'server:' + user.id,
    permissions: Object.freeze((RULES[role] || []).slice()),
    ...(!isDemo && Array.isArray(user.accounts) ? {accounts:Object.freeze(user.accounts.map(a=>Object.freeze({...a})))} : {}),
    accountIds: Object.freeze(isDemo ? (role === 'staff' ? ['demo:wa-lea'] : ACCOUNT_IDS.map((id) => 'demo:' + id)) : serverAccounts)
  });
}

function denied(error = '当前身份没有此操作权限') {
  return { ok: false, error };
}

async function restore() {
  if (demo || local || !allowRestore) return { ok: true, user: current };
  if (busy) return denied('认证处理中，请稍候');
  const stamp = generation;
  const request = ++verification;
  let result;
  try { result = await auth.getSession(); }
  catch { result = denied('服务器身份验证失败'); }
  if (stamp !== generation || request !== verification) return denied('身份已切换，请重试');
  const verified = result.ok && result.user && ROLES.includes(result.user.role);
  if (!verified) {
    if (current) { current = null; changed(); }
    return { ...result, user: null };
  }
  if (current && (current.id !== result.user.id || current.role !== result.user.role
    || current.accountIds.some(id=>!(result.user.accountIds || []).includes(id)))) changed();
  current = identity(result.user, false);
  return { ...result, user: current };
}

async function authenticate(method, email, password) {
  if (demo || local) return denied('请先退出本机工作区或离线演示，再使用服务器账号');
  if (busy) return denied('认证处理中，请稍候');
  if (!['signIn', 'signUp'].includes(method) || typeof email !== 'string' || email.length > 320
    || typeof password !== 'string' || password.length < 6 || password.length > 1024) return denied('邮箱或密码格式无效');
  busy = true;
  current = null;
  allowRestore = false;
  changed();
  const stamp = generation;
  try {
    const result = await auth[method](email, password);
    if (stamp !== generation) return denied('身份已切换');
    if (method === 'signIn' && result.ok && result.user && ROLES.includes(result.user.role)) {
      current = identity(result.user, false);
      allowRestore = true;
      auth.resumeRefresh();
    }
    return method === 'signIn' ? { ...result, user: current, ok: Boolean(current) } : result;
  } finally { busy = false; }
}

async function enterDemo(role) {
  if (busy) return denied('认证处理中，请稍候');
  if (current && !demo && !local) return denied('请先退出服务器账号，再进入离线演示');
  if (typeof role !== 'string' || !Object.hasOwn(RULES, role)) return denied('无效演示角色');
  busy = true;
  current = null;
  demo = false;
  local = false;
  allowRestore = false;
  changed();
  const stamp = generation;
  try {
    await auth.clearLocalSession();
    if (stamp !== generation) return denied('身份已切换');
    demo = true;
    current = identity({ id: 'demo-' + role, email: role + '@demo.local', role }, true);
    return { ok: true, user: current };
  } catch { return denied('无法清除旧登录会话，未进入演示'); }
  finally { busy = false; }
}

async function enterLocal() {
  if (busy) return denied('认证处理中，请稍候');
  if (current && !demo && !local) return denied('请先退出服务器账号，再进入本机工作区');
  busy = true; current = null; demo = false; local = false; allowRestore = false; changed();
  const stamp = generation;
  try {
    await auth.clearLocalSession();
    if (stamp !== generation) return denied('身份已切换');
    local = true;
    current = Object.freeze({
      id: 'local-workspace', email: '本机渠道工作区', role: 'user', label: '本机渠道工作区',
      demo: false, local: true, revision: generation, scope: 'local:workspace',
      permissions: Object.freeze([...COMMON, 'catalog', 'account-edit', 'account-delete', 'screenshot']),
      accountIds: Object.freeze(['local:whatsapp-1', 'local:telegram-k-1', 'local:telegram-a-1', 'local:signal-1', 'local:signal-2'])
    });
    return { ok: true, user: current };
  } catch { return denied('无法清除旧会话，未进入本机工作区'); }
  finally { busy = false; }
}

async function signOut() {
  if (busy) return denied('认证处理中，请稍候');
  const wasDemo = demo || local;
  current = null;
  demo = false;
  local = false;
  allowRestore = false;
  changed();
  if (wasDemo) return { ok: true };
  busy = true;
  try { return await auth.signOut(); }
  finally { busy = false; }
}

function can(permission) {
  return Boolean(current && current.permissions.includes(permission));
}

async function authorize(permission) {
  if (demo || local) return denied('本机工作区与离线演示禁止访问服务器账号、分销和支付接口');
  const stamp = generation;
  const res = await restore();
  if (stamp !== generation || demo || !res.ok || !current) return denied('无法核验服务器身份，请重新登录');
  return can(permission) ? { ok: true, revision: generation } : denied();
}

function invalidate() {
  if (demo || local) return;
  current = null;
  allowRestore = false;
  changed();
}

module.exports = {
  trusted, restore, authenticate, enterDemo, enterLocal, signOut, authorize, can, invalidate,
  isDemo: () => demo || local, current: () => current, revision: () => generation,
  bindWindow: (contents) => { mainContents = contents; },
  onChange: (listener) => { listeners.add(listener); return () => listeners.delete(listener); }
};
