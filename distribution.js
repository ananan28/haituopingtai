const auth = require('./auth');

const NOT_CONFIGURED = '未配置 Supabase：请在 .env 或环境变量中填写配置';

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

// ---------- 分成（接口） ----------

// 分成金额（纯函数）：金额 × 比例%，保留到分。里程碑4 字符扣费接入后复用。
function computeCommission(amount, ratePercent) {
  const cents = Math.round(Number(amount) * 100);
  const rate = Number(ratePercent) || 0;
  return Math.round((cents * rate) / 100) / 100;
}

// 结算接口（占位）：里程碑后续实现真正的结算/出账
async function settleAgentCommissions(_agentId) {
  return { ok: false, error: '分成结算逻辑未实现（里程碑后续）' };
}

// ---------- owner 操作（RLS 已强制 owner 权限） ----------

async function listProfiles() {
  const c = client();
  if (!c) return { ok: false, error: NOT_CONFIGURED };
  const { data, error } = await c
    .from('profiles')
    .select('id, email, role, agent_id, commission_rate, created_at')
    .order('created_at', { ascending: true });
  if (error) return { ok: false, error: friendlyError(error) };
  return { ok: true, profiles: data };
}

async function promoteToAgent(email, commissionRate) {
  const c = client();
  if (!c) return { ok: false, error: NOT_CONFIGURED };
  const rate = Number(commissionRate);
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) return { ok: false, error: '分成比例需为 0–100' };
  const { data: found, error: ferr } = await c
    .from('profiles').select('id').eq('email', String(email).trim()).limit(1);
  if (ferr) return { ok: false, error: friendlyError(ferr) };
  if (!found || found.length === 0) return { ok: false, error: '未找到该邮箱的用户' };
  const { data, error } = await c
    .from('profiles').update({ role: 'agent', commission_rate: rate }).eq('id', found[0].id).select();
  if (error) return { ok: false, error: friendlyError(error) };
  if (!data || data.length === 0) return { ok: false, error: '无权限（需 owner）' };
  return { ok: true, profile: data[0] };
}

async function demoteAgent(userId) {
  const c = client();
  if (!c) return { ok: false, error: NOT_CONFIGURED };
  const { data, error } = await c
    .from('profiles').update({ role: 'user', commission_rate: null }).eq('id', userId).select();
  if (error) return { ok: false, error: friendlyError(error) };
  if (!data || data.length === 0) return { ok: false, error: '无权限（需 owner）' };
  return { ok: true, profile: data[0] };
}

async function assignAgent(userEmail, agentEmail) {
  const c = client();
  if (!c) return { ok: false, error: NOT_CONFIGURED };
  const emails = [String(userEmail).trim(), String(agentEmail).trim()];
  const { data: rows, error: ferr } = await c.from('profiles').select('id, email').in('email', emails);
  if (ferr) return { ok: false, error: friendlyError(ferr) };
  const u = rows && rows.find((r) => r.email === emails[0]);
  const a = rows && rows.find((r) => r.email === emails[1]);
  if (!u) return { ok: false, error: '未找到该用户' };
  if (!a) return { ok: false, error: '未找到该代理' };
  const { data, error } = await c.from('profiles').update({ agent_id: a.id }).eq('id', u.id).select();
  if (error) return { ok: false, error: friendlyError(error) };
  if (!data || data.length === 0) return { ok: false, error: '无权限（需 owner）' };
  return { ok: true, profile: data[0] };
}

// ---------- agent 操作 ----------

async function listMyUsers() {
  const c = client();
  if (!c) return { ok: false, error: NOT_CONFIGURED };
  const { data: sess } = await c.auth.getSession();
  const uid = sess && sess.session ? sess.session.user.id : null;
  if (!uid) return { ok: false, error: '未登录' };
  const { data, error } = await c
    .from('profiles').select('id, email, created_at').eq('agent_id', uid)
    .order('created_at', { ascending: true });
  if (error) return { ok: false, error: friendlyError(error) };
  return { ok: true, users: data };
}

module.exports = {
  computeCommission,
  settleAgentCommissions,
  listProfiles,
  promoteToAgent,
  demoteAgent,
  assignAgent,
  listMyUsers
};
