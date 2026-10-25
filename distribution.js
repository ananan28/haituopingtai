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

// 身份在 await 期间可能切换；每次 await 后、发写请求前必须复核。
const SWITCHED = '身份已切换，写操作已取消';
function switched(guard) {
  return guard && !guard();
}

// 服务端受控 RPC 结果统一处理：RPC 抛错由 Supabase 转 error。
async function callRpc(name, params, guard) {
  const c = client();
  if (!c) return { ok: false, error: NOT_CONFIGURED };
  const { data, error } = await c.rpc(name, params);
  if (switched(guard)) return { ok: false, error: SWITCHED };
  if (error) return { ok: false, error: friendlyError(error) };
  return { ok: true, ...(data && typeof data === 'object' ? data : {}) };
}

// ---------- 子账号管理（受控 RPC，服务端角色校验 + 原子 + 审计） ----------

// 列出子账号：商户仅见自己名下（RLS owner_id=auth.uid()）；owner/admin 见全部；staff 仅见自己
async function listStaff(guard) {
  const c = client();
  if (!c) return { ok: false, error: NOT_CONFIGURED };
  const { data, error } = await c
    .from('staff_accounts')
    .select('id, owner_id, email, channel_allowlist, char_quota, char_used, status, note, created_at')
    .order('created_at', { ascending: true });
  if (switched(guard)) return { ok: false, error: SWITCHED };
  if (error) return { ok: false, error: friendlyError(error) };
  return { ok: true, staff: data };
}

async function createStaff(params, guard) {
  return callRpc('create_staff', params, guard);
}

async function suspendStaff(staffId, guard) {
  return callRpc('suspend_staff', { p_staff: staffId }, guard);
}

async function deleteStaff(staffId, guard) {
  return callRpc('delete_staff', { p_staff: staffId }, guard);
}

async function assignChannel(staffId, channels, guard) {
  return callRpc('assign_channel', { p_staff: staffId, p_channels: channels }, guard);
}

async function allocateChars(staffId, chars, guard) {
  return callRpc('allocate_chars', { p_staff: staffId, p_chars: chars }, guard);
}

async function resetPassword(targetId, password, guard) {
  return callRpc('reset_password', { p_target: targetId, p_password: password }, guard);
}

// 审计日志（RLS：仅 owner/admin 可读）
async function listAudit(guard) {
  const c = client();
  if (!c) return { ok: false, error: NOT_CONFIGURED };
  const { data, error } = await c
    .from('audit_logs')
    .select('id, actor_id, actor_role, action, target_id, detail, created_at')
    .order('created_at', { ascending: false })
    .limit(200);
  if (switched(guard)) return { ok: false, error: SWITCHED };
  if (error) return { ok: false, error: friendlyError(error) };
  return { ok: true, logs: data };
}

module.exports = {
  listStaff,
  createStaff,
  suspendStaff,
  deleteStaff,
  assignChannel,
  allocateChars,
  resetPassword,
  listAudit
};
