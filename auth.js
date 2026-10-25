const { createClient } = require('@supabase/supabase-js');
const WebSocket = require('ws');
const fsp = require('fs/promises');
const path = require('path');

// 加载 .env（真实 key 放 .env，绝不提交到 git）
require('dotenv').config({ path: path.join(__dirname, '.env') });

let client = null;
let configured = false;
let sessionStorage = null;

// 读取配置：来自环境变量（含 .env 里声明的）
function loadConfig() {
  return {
    url: (process.env.SUPABASE_URL || '').trim(),
    anonKey: (process.env.SUPABASE_ANON_KEY || '').trim()
  };
}

function createFileStorage(sessionFile, safeStorage) {
  let suspended = false;
  let epoch = 0;
  let updates = Promise.resolve();
  const storageError = () => Object.assign(new Error('系统安全存储不可用或会话损坏，真实登录已关闭；请修复系统凭据存储或使用离线演示'), { code: 'SESSION_STORAGE' });
  const requireEncryption = () => {
    if (!safeStorage || !safeStorage.isEncryptionAvailable() ||
        safeStorage.getSelectedStorageBackend?.() === 'basic_text') throw storageError();
  };
  const validData = (obj) => obj && typeof obj === 'object' && !Array.isArray(obj) &&
    Object.values(obj).every((value) => typeof value === 'string');
  const read = async () => {
    let obj;
    try { obj = JSON.parse(await fsp.readFile(sessionFile, 'utf8')); }
    catch (error) { if (error.code === 'ENOENT' || error instanceof SyntaxError) return { data: {}, legacy: false }; throw error; }
    if (obj && (Object.hasOwn(obj, 'encrypted') || Object.hasOwn(obj, 'version'))) {
      requireEncryption();
      try {
        if (obj.version !== 1 || typeof obj.encrypted !== 'string' || !obj.encrypted) throw storageError();
        const bytes = Buffer.from(obj.encrypted, 'base64');
        if (bytes.toString('base64') !== obj.encrypted) throw storageError();
        const data = JSON.parse(safeStorage.decryptString(bytes));
        if (!validData(data)) throw storageError();
        return { data, legacy: false };
      } catch { throw storageError(); }
    }
    if (!validData(obj)) throw storageError();
    return { data: obj, legacy: Object.keys(obj).length > 0 };
  };
  const write = async (obj) => {
    let stored = {};
    if (Object.keys(obj).length) {
      requireEncryption();
      try {
        const encrypted = safeStorage.encryptString(JSON.stringify(obj));
        if (!Buffer.isBuffer(encrypted) || encrypted.length === 0) throw storageError();
        stored = { version: 1, encrypted: encrypted.toString('base64') };
      } catch { throw storageError(); }
    }
    await fsp.mkdir(path.dirname(sessionFile), { recursive: true });
    const tmp = sessionFile + '.tmp';
    await fsp.writeFile(tmp, JSON.stringify(stored), { mode: 0o600 });
    await fsp.rename(tmp, sessionFile);
    await fsp.chmod(sessionFile, 0o600).catch(() => {});
  };
  const mutate = (operation) => {
    const version = epoch;
    const run = () => operation(version);
    const next = updates.then(run, run);
    updates = next.catch(() => {});
    return next;
  };
  return {
    getItem: async (key) => {
      await updates;
      if (suspended) return null;
      const version = epoch;
      let loaded = await read();
      if (suspended || version !== epoch) return null;
      if (loaded.legacy) {
        await mutate(async () => {
          if (suspended || version !== epoch) return;
          loaded = await read();
          if (suspended || version !== epoch) return;
          if (loaded.legacy) await write(loaded.data);
        });
      }
      return suspended || version !== epoch ? null : loaded.data[key] ?? null;
    },
    setItem: (key, value) => mutate(async (version) => {
      if (suspended) return;
      if (version !== epoch) return;
      const { data } = await read();
      if (suspended || version !== epoch) return;
      data[key] = value;
      await write(data);
    }),
    removeItem: (key) => mutate(async () => {
      const { data } = await read();
      delete data[key];
      await write(data);
    }),
    clear: () => {
      suspended = true;
      epoch += 1;
      return mutate(() => write({}));
    },
    resume: () => { requireEncryption(); epoch += 1; suspended = false; }
  };
}

// 初始化 Supabase 客户端。返回 { configured }，未配置时客户端不创建。
function init(sessionFile, safeStorage) {
  const cfg = loadConfig();
  if (!cfg.url || !cfg.anonKey) {
    client = null;
    configured = false;
    return { configured: false };
  }
  sessionStorage = createFileStorage(sessionFile, safeStorage);
  client = createClient(cfg.url, cfg.anonKey, {
    auth: {
      storage: sessionStorage,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false
    },
    // Electron 主进程（Node 20）没有原生 WebSocket，须显式提供 ws
    realtime: { transport: WebSocket }
  });
  configured = true;
  return { configured: true };
}

function isConfigured() {
  return configured;
}

// 供其他模块（如 distribution.js）复用同一个 Supabase 客户端
function getClient() {
  return client;
}

const NOT_CONFIGURED =
  '未配置 Supabase：请复制 .env.example 为 .env 并填写 SUPABASE_URL / SUPABASE_ANON_KEY';

// 角色缺失或网络失败时不授予任何身份。
async function fetchRole(c, userId) {
  try {
    const { data, error } = await Promise.race([
      c.from('profiles').select('role').eq('id', userId).single(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('role fetch timeout')), 5000))
    ]);
    if (error || !data || !['owner', 'admin', 'user', 'staff'].includes(data.role)) return null;
    return data.role;
  } catch {
    return null;
  }
}

// 子账号读取自己被分配的渠道账号与额度（RLS 仅放行本人行）
async function fetchStaffAccount(c, userId) {
  try {
    const { data, error } = await Promise.race([
      c.from('staff_accounts').select('channel_allowlist, char_quota, char_used, status').eq('id', userId).maybeSingle(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('staff account timeout')), 5000))
    ]);
    if (error || !data || data.status !== 'active') return null;
    return data;
  } catch {
    return null;
  }
}

// 身份 = 服务器核验的角色 + （子账号）被分配的渠道账号。任一缺失 fail-closed。
async function fetchIdentity(c, userId) {
  const role = await module.exports.fetchRole(c, userId);
  if (!role) return null;
  if (role === 'staff') {
    const staff = await fetchStaffAccount(c, userId);
    if (!staff) return null;
    return { role, accountIds: Array.isArray(staff.channel_allowlist) ? staff.channel_allowlist : [] };
  }
  return { role, accountIds: [] };
}

// 新登录/注册前先清空旧会话：切换账号失败时不得留下上一个身份的凭据，
// 否则重启后 restore 会恢复到旧 owner。清空后 resume 允许本次尝试写入新会话。
async function beginFreshAuth() {
  await clearLocalSession();
  sessionStorage.resume();
}

async function signUp(email, password) {
  if (!client) return { ok: false, error: NOT_CONFIGURED };
  try { await beginFreshAuth(); }
  catch { return { ok: false, error: '系统安全存储不可用，真实登录已关闭；可使用离线演示' }; }
  const { data, error } = await client.auth.signUp({ email, password });
  if (error) return { ok: false, error: error.message };
  // 开启了邮箱确认时：注册返回 user 但没有 session，需确认邮箱后再登录
  const needsEmailConfirm = !data.session && !!data.user;
  return { ok: true, user: data.user ? data.user.email : null, needsEmailConfirm };
}

async function signIn(email, password) {
  if (!client) return { ok: false, error: NOT_CONFIGURED };
  try { await beginFreshAuth(); }
  catch { return { ok: false, error: '系统安全存储不可用，真实登录已关闭；可使用离线演示' }; }
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) return { ok: false, error: error.message };
  const identity = data.user ? await module.exports.fetchIdentity(client, data.user.id) : null;
  if (!identity) return { ok: false, user: null, error: '无法核验服务器角色，访问已关闭' };
  return { ok: true, user: { id: data.user.id, email: data.user.email, role: identity.role, accountIds: identity.accountIds } };
}

async function signOut() {
  if (!client) return { ok: true };
  let failed = false;
  try { failed = Boolean((await client.auth.signOut({ scope: 'local' })).error); }
  catch { failed = true; }
  await clearLocalSession();
  return failed ? { ok: false, error: '本地会话已清除，但服务器退出确认失败' } : { ok: true };
}

async function getSession() {
  if (!client) return { ok: true, user: null };
  let timeout;
  let verified;
  try {
    const { data, error } = await Promise.race([
      client.auth.getSession(),
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('session restore timeout')), 8000); })
    ]);
    clearTimeout(timeout);
    if (error) return { ok: false, user: null, error: '会话恢复失败，请重新登录' };
    if (!data.session || !data.session.user) return { ok: true, user: null };
    verified = await Promise.race([
      client.auth.getUser(),
      new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('verification timeout')), 8000); })
    ]);
  } catch (error) { return { ok: false, user: null, error: error.code === 'SESSION_STORAGE' ? error.message : '服务器身份验证失败，请重新登录' }; }
  finally { clearTimeout(timeout); }
  if (verified.error || !verified.data.user) return { ok: false, user: null, error: '服务器身份验证失败，请重新登录' };
  const u = verified.data.user;
  const identity = await module.exports.fetchIdentity(client, u.id);
  if (!identity) return { ok: false, user: null, error: '无法核验服务器角色，访问已关闭' };
  return { ok: true, user: { id: u.id, email: u.email, role: identity.role, accountIds: identity.accountIds } };
}

function onAuthStateChange(cb) {
  if (!client) return null;
  return client.auth.onAuthStateChange((event, session) => {
    cb(event, session && session.user ? session.user.email : null);
  });
}

function pauseRefresh() {
  if (client) return client.auth.stopAutoRefresh();
}

async function clearLocalSession() {
  await pauseRefresh();
  if (sessionStorage) await sessionStorage.clear();
}

function resumeRefresh() {
  if (client) client.auth.startAutoRefresh();
}

module.exports = { init, isConfigured, getClient, loadConfig, signUp, signIn, signOut, getSession, onAuthStateChange, fetchRole, fetchStaffAccount, fetchIdentity, pauseRefresh, resumeRefresh, clearLocalSession };
