// 远程配置同步（主进程）：订阅 Supabase postgres_changes，收到变更后局部转发给渲染层，
// 不整页重载。写操作走受控 RPC set_platform_config（服务端仅 owner/admin 放行）。
// 依赖 auth.js 复用同一个 Supabase 客户端；不依赖 runtime-access（权限由 ipc.js 层把关）。

const auth = require('./auth');

const NOT_CONFIGURED = '未配置 Supabase：请在 .env 或环境变量中填写配置';

// 当前活跃的 Realtime channel 与转发目标 webContents
let channel = null;
let sender = null;

// 快照缓存：public 全员可见，admin 仅 owner/admin（由服务端 RLS 决定，这里原样透传）
let snapshotCache = { ok: true, config: { public: {}, admin: {} }, fetchedAt: null };
let snapshotLoaded = false;

function client() {
  return auth.getClient();
}

function friendlyError(err) {
  const m = (err && err.message) || String(err || '');
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|EAI_AGAIN|network request/i.test(m)) {
    return '网络请求失败，请检查网络或 Supabase 配置';
  }
  return m;
}

// rows: [{ key, value, scope, updated_at }] -> { public: {}, admin: {} }
function toConfig(rows) {
  const config = { public: {}, admin: {} };
  for (const row of rows || []) {
    if (!row || typeof row.key !== 'string') continue;
    const bucket = row.scope === 'admin' ? 'admin' : 'public';
    config[bucket][row.key] = row.value;
  }
  return config;
}

// postgres_changes payload -> 精简事件（供渲染层局部刷新）
function normalizeEvent(payload) {
  if (!payload || typeof payload !== 'object') return null;
  if (payload.table !== 'platform_config' || payload.schema !== 'public') return null;
  const row = payload.eventType === 'DELETE' ? payload.old : payload.new;
  if (!row || typeof row.key !== 'string') return null;
  if (payload.eventType === 'DELETE') {
    return { type: 'delete', key: row.key, scope: row.scope === 'admin' ? 'admin' : 'public', value: null, updated_at: null };
  }
  return {
    type: payload.eventType === 'INSERT' ? 'insert' : 'update',
    key: row.key,
    scope: row.scope === 'admin' ? 'admin' : 'public',
    value: row.value,
    updated_at: row.updated_at
  };
}

function forward(payload) {
  if (!sender) return;
  if (sender.isDestroyed && sender.isDestroyed()) return;
  const event = normalizeEvent(payload);
  if (!event) return;
  // 同步更新本地快照缓存，供 snapshot() 立即返回最新值
  if (snapshotLoaded) {
    const bucket = event.scope === 'admin' ? 'admin' : 'public';
    if (event.type === 'delete') delete snapshotCache.config[bucket][event.key];
    else snapshotCache.config[bucket][event.key] = event.value;
    snapshotCache.fetchedAt = Date.now();
  }
  try {
    sender.send('realtime-config:event', event);
  } catch {
    /* webContents 已销毁等竞态，忽略 */
  }
}

// 拉取当前登录用户可见的全量配置（RLS 过滤：商户看不到 admin 定价机密）
async function fetchConfig() {
  const c = client();
  if (!c) return { ok: false, error: NOT_CONFIGURED };
  const { data, error } = await c
    .from('platform_config')
    .select('key, value, scope, updated_at');
  if (error) return { ok: false, error: friendlyError(error) };
  const config = toConfig(data);
  snapshotCache = { ok: true, config, fetchedAt: Date.now() };
  snapshotLoaded = true;
  return { ok: true, config };
}

// 订阅并绑定转发目标：渲染层登录后调用一次；重复调用会先拆除旧订阅。
async function attach(webContents) {
  detach();
  const c = client();
  if (!c) return { ok: false, error: NOT_CONFIGURED };
  let session = null;
  try {
    const { data } = await Promise.race([
      c.auth.getSession(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('session timeout')), 5000))
    ]);
    session = data && data.session;
  } catch {
    return { ok: false, error: '会话校验超时，请重试' };
  }
  if (!session) return { ok: false, error: '未登录，无法订阅远程配置' };

  sender = webContents;
  const snap = await fetchConfig();

  const topic = 'platform-config-realtime';
  channel = c
    .channel(topic)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'platform_config' },
      forward
    )
    .subscribe((status) => {
      if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        // 订阅异常时保守退订，渲染层可按需重新 subscribe
        if (channel) { try { channel.unsubscribe(); } catch { /* ignore */ } channel = null; }
      }
    });
  return snap;
}

function detach() {
  if (channel) {
    try { channel.unsubscribe(); } catch { /* ignore */ }
    channel = null;
  }
  sender = null;
}

function snapshot() {
  return { ok: true, config: snapshotCache.config, fetchedAt: snapshotCache.fetchedAt };
}

// 写配置（仅 owner/admin；服务端 RPC 二次校验）。guard 用于复核身份未切换。
async function setConfig(key, value, scope, guard) {
  const c = client();
  if (!c) return { ok: false, error: NOT_CONFIGURED };
  if (typeof key !== 'string' || !/^[a-z0-9_]{1,64}$/.test(key)) return { ok: false, error: '配置键无效' };
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return { ok: false, error: '配置值必须是 JSON 对象' };
  const finalScope = scope === 'admin' ? 'admin' : 'public';
  if (guard && !guard()) return { ok: false, error: '身份已切换，写操作已取消' };
  const { data, error } = await c.rpc('set_platform_config', {
    p_key: key,
    p_value: value,
    p_scope: finalScope
  });
  if (guard && !guard()) return { ok: false, error: '身份已切换，写操作已取消' };
  if (error) return { ok: false, error: friendlyError(error) };
  // 本机先乐观更新，服务端确认的变更会再经 postgres_changes 广播回来
  if (snapshotLoaded) {
    const bucket = finalScope === 'admin' ? 'admin' : 'public';
    snapshotCache.config[bucket][key] = value;
    snapshotCache.fetchedAt = Date.now();
  }
  return { ok: true, ...(data && typeof data === 'object' ? data : {}) };
}

module.exports = { attach, detach, snapshot, fetchConfig, setConfig };
