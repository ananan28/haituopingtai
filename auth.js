const { createClient } = require('@supabase/supabase-js');
const WebSocket = require('ws');
const fsp = require('fs/promises');
const path = require('path');

// 加载 .env（真实 key 放 .env，绝不提交到 git）
require('dotenv').config({ path: path.join(__dirname, '.env') });

let client = null;
let configured = false;

// 读取配置：来自环境变量（含 .env 里声明的）
function loadConfig() {
  return {
    url: (process.env.SUPABASE_URL || '').trim(),
    anonKey: (process.env.SUPABASE_ANON_KEY || '').trim()
  };
}

// 文件存储适配器：把 Supabase 会话持久化到本地文件（Node 环境没有 localStorage）
function createFileStorage(sessionFile) {
  return {
    getItem: async (key) => {
      try {
        const obj = JSON.parse(await fsp.readFile(sessionFile, 'utf8'));
        return obj[key] ?? null;
      } catch {
        return null;
      }
    },
    setItem: async (key, value) => {
      let obj = {};
      try {
        obj = JSON.parse(await fsp.readFile(sessionFile, 'utf8'));
      } catch {}
      obj[key] = value;
      await fsp.mkdir(path.dirname(sessionFile), { recursive: true });
      const tmp = sessionFile + '.tmp';
      await fsp.writeFile(tmp, JSON.stringify(obj, null, 2), { mode: 0o600 });
      await fsp.rename(tmp, sessionFile);
      await fsp.chmod(sessionFile, 0o600).catch(() => {});
    },
    removeItem: async (key) => {
      try {
        const obj = JSON.parse(await fsp.readFile(sessionFile, 'utf8'));
        delete obj[key];
        await fsp.writeFile(sessionFile, JSON.stringify(obj, null, 2), { mode: 0o600 });
      } catch {}
    }
  };
}

// 初始化 Supabase 客户端。返回 { configured }，未配置时客户端不创建。
function init(sessionFile) {
  const cfg = loadConfig();
  if (!cfg.url || !cfg.anonKey) {
    client = null;
    configured = false;
    return { configured: false };
  }
  client = createClient(cfg.url, cfg.anonKey, {
    auth: {
      storage: createFileStorage(sessionFile),
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

// 读取用户角色：权威来源是 public.profiles.role，读不到时兜底 'user'（最小权限）
// 加 5s 超时，避免网络异常时拖住登录
async function fetchRole(c, userId) {
  try {
    const { data, error } = await Promise.race([
      c.from('profiles').select('role').eq('id', userId).single(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('role fetch timeout')), 5000))
    ]);
    if (error || !data || !data.role) return 'user';
    return data.role;
  } catch {
    return 'user';
  }
}

async function signUp(email, password) {
  if (!client) return { ok: false, error: NOT_CONFIGURED };
  const { data, error } = await client.auth.signUp({ email, password });
  if (error) return { ok: false, error: error.message };
  // 开启了邮箱确认时：注册返回 user 但没有 session，需确认邮箱后再登录
  const needsEmailConfirm = !data.session && !!data.user;
  return { ok: true, user: data.user ? data.user.email : null, needsEmailConfirm };
}

async function signIn(email, password) {
  if (!client) return { ok: false, error: NOT_CONFIGURED };
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) return { ok: false, error: error.message };
  const role = data.user ? await module.exports.fetchRole(client, data.user.id) : 'user';
  return { ok: true, user: { id: data.user.id, email: data.user.email, role } };
}

async function signOut() {
  if (!client) return { ok: true };
  // 本地会话移除即视为退出成功；撤销远端 refresh token 的网络失败不影响本地退出
  await client.auth.signOut();
  return { ok: true };
}

async function getSession() {
  if (!client) return { ok: true, user: null };
  const { data, error } = await client.auth.getSession();
  if (error || !data.session || !data.session.user) return { ok: true, user: null };
  const u = data.session.user;
  const role = await module.exports.fetchRole(client, u.id);
  return { ok: true, user: { id: u.id, email: u.email, role } };
}

function onAuthStateChange(cb) {
  if (!client) return null;
  return client.auth.onAuthStateChange((event, session) => {
    cb(event, session && session.user ? session.user.email : null);
  });
}

module.exports = { init, isConfigured, getClient, loadConfig, signUp, signIn, signOut, getSession, onAuthStateChange, fetchRole };
