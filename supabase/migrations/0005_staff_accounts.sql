-- =============================================================
-- 里程碑：5→4 角色合并（agent→user）+ 子账号体系 + 受控 RPC + 审计
-- 在 Supabase SQL Editor 或 supabase CLI 中执行（0001–0004 之后）
-- =============================================================

begin;

-- 依赖 pgcrypto 的 crypt()/gen_salt() 做 bcrypt 密码哈希。
-- 真实 Supabase 部署前请在 Database > Extensions 启用 pgcrypto（本文件不创建扩展，
-- 以便隔离测试环境用桩函数复现）。本文件不读取或写入任何真实密钥。

-- 1. 角色枚举补 admin/staff（'agent' 保留为不可用残留值，Postgres 枚举无法安全删除）
alter type public.user_role add value if not exists 'admin';
alter type public.user_role add value if not exists 'staff';

-- 2. 迁移现有 agent 数据为 user（代理=商户，同一角色）
update public.profiles set role = 'user' where role = 'agent';

-- 3. 永久禁用 agent 角色（数据已迁移，未来不允许再写入 agent）
alter table public.profiles
  add constraint profiles_role_no_agent check (role::text <> 'agent');

-- 4. 清理 0004 的 agent 关系结构（触发器 → 函数 → 策略 → 复合FK → check → 生成列 → 唯一约束）
--    以及 0002 的 agent_id / commission_rate 列（分成随邀请奖励，挂起未做）
drop trigger if exists profiles_release_agent_relationships on public.profiles;
drop function if exists public.release_agent_relationships();
drop policy if exists "profiles_agent_select_own_users" on public.profiles;
alter table public.profiles
  drop constraint if exists profiles_active_agent_fk,
  drop constraint if exists profiles_merchant_agent_check,
  drop constraint if exists profiles_id_role_unique,
  drop constraint if exists profiles_agent_id_fkey;
alter table public.profiles drop column if exists agent_role;
alter table public.profiles drop column if exists agent_id;
alter table public.profiles drop column if exists commission_rate;

-- 5. 分成/提现策略降为 owner 只读（代理分成挂起，表保留）
drop policy if exists "commission_select_own" on public.commission_records;
drop policy if exists "withdrawal_select_own" on public.withdrawal_requests;
create policy "commission_select_owner" on public.commission_records
  for select using (public.current_user_role() = 'owner');
create policy "withdrawal_select_owner" on public.withdrawal_requests
  for select using (public.current_user_role() = 'owner');

-- 5a. 清理 0003 残留的 agent_id 列（代理已并入 user，这两列均为 NOT NULL 外键，直删列连带外键约束）
alter table public.commission_records drop column if exists agent_id;
alter table public.withdrawal_requests drop column if exists agent_id;

-- 6. 子账号表（不复用代理表）
create table if not exists public.staff_accounts (
  id uuid primary key references public.profiles (id) on delete cascade,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  email text not null,
  channel_allowlist text[] not null default '{}',
  char_quota bigint not null default 0 check (char_quota >= 0),
  char_used bigint not null default 0 check (char_used >= 0),
  status text not null default 'active' check (status in ('active', 'suspended')),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.staff_accounts enable row level security;

-- 子账号只能看自己的行（分配的渠道/额度/用量）
create policy "staff_accounts_select_own" on public.staff_accounts
  for select using (auth.uid() = id);

-- 主账号只能看/管理自己名下的 staff
create policy "staff_accounts_select_owner" on public.staff_accounts
  for select using (auth.uid() = owner_id);

-- owner/admin 可看全部 staff
create policy "staff_accounts_select_admin" on public.staff_accounts
  for select using (public.current_user_role() in ('owner', 'admin'));

-- 7. 审计日志表（敏感操作留痕；客户端不能写，只能由受控 RPC 写）
create table if not exists public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles (id) on delete set null,
  actor_role text,
  action text not null,
  target_id uuid,
  detail jsonb,
  created_at timestamptz not null default now()
);

alter table public.audit_logs enable row level security;
create policy "audit_logs_select_admin" on public.audit_logs
  for select using (public.current_user_role() in ('owner', 'admin'));
revoke insert, update, delete, truncate, references, trigger on public.audit_logs
  from public, anon, authenticated;

-- 8. 审计写入助手（仅受控 RPC 内部调用）
create or replace function public._write_audit(action text, target uuid, detail jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.audit_logs (actor_id, actor_role, action, target_id, detail)
  values (auth.uid(), public.current_user_role(), action, target, detail);
end;
$$;
revoke all on function public._write_audit(text, uuid, jsonb) from public, anon, authenticated;

-- 9. 受控 RPC：创建子账号（真实 Auth 账户 + profile(staff) + staff_accounts + 审计）
create or replace function public.create_staff(
  p_owner uuid, p_email text, p_password text,
  p_channels text[] default '{}', p_quota bigint default 0, p_note text default null
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_caller_role text;
  v_owner_role text;
  v_id uuid := gen_random_uuid();
begin
  select role::text into v_caller_role from public.profiles where id = auth.uid();
  if v_caller_role is null then
    raise exception '未登录或角色缺失';
  end if;
  if v_caller_role = 'staff' then
    raise exception '子账号无权开子账号';
  end if;
  if p_email is null or p_email = '' or p_password is null or length(p_password) < 6 then
    raise exception '邮箱或密码无效';
  end if;
  if p_quota < 0 then
    raise exception '字符额度不能为负';
  end if;
  select role::text into v_owner_role from public.profiles where id = p_owner;
  if v_owner_role is null or v_owner_role <> 'user' then
    raise exception '目标主账号必须是商户(user)';
  end if;
  if v_caller_role = 'user' and p_owner <> auth.uid() then
    raise exception '商户只能给自己名下开子账号';
  end if;

  insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  values (v_id, p_email, crypt(p_password, gen_salt('bf')), now(), now(), now());

  update public.profiles set role = 'staff', updated_at = now() where id = v_id;
  insert into public.staff_accounts (id, owner_id, email, channel_allowlist, char_quota, note)
  values (v_id, p_owner, p_email, coalesce(p_channels, '{}'), p_quota, p_note);

  perform public._write_audit('create_staff', v_id, jsonb_build_object('owner', p_owner, 'email', p_email, 'quota', p_quota));
  return jsonb_build_object('ok', true, 'staff_id', v_id, 'email', p_email);
end;
$$;

-- 受控 RPC：停用子账号
create or replace function public.suspend_staff(p_staff uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_caller_role text;
  v_owner uuid;
begin
  select role::text into v_caller_role from public.profiles where id = auth.uid();
  if v_caller_role is null then raise exception '未登录或角色缺失'; end if;
  if v_caller_role = 'staff' then raise exception '子账号无权管理子账号'; end if;
  select owner_id into v_owner from public.staff_accounts where id = p_staff;
  if v_owner is null then raise exception '子账号不存在'; end if;
  if v_caller_role = 'user' and v_owner <> auth.uid() then
    raise exception '商户只能管理自己名下的子账号';
  end if;
  update public.staff_accounts set status = 'suspended', updated_at = now() where id = p_staff;
  perform public._write_audit('suspend_staff', p_staff, null);
  return jsonb_build_object('ok', true);
end;
$$;

-- 受控 RPC：注销子账号（staff_accounts + profile + auth 账户）
create or replace function public.delete_staff(p_staff uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_caller_role text;
  v_owner uuid;
  v_role text;
begin
  select role::text into v_caller_role from public.profiles where id = auth.uid();
  if v_caller_role is null then raise exception '未登录或角色缺失'; end if;
  if v_caller_role = 'staff' then raise exception '子账号无权管理子账号'; end if;
  select owner_id into v_owner from public.staff_accounts where id = p_staff;
  if v_owner is null then raise exception '子账号不存在'; end if;
  if v_caller_role = 'user' and v_owner <> auth.uid() then
    raise exception '商户只能管理自己名下的子账号';
  end if;
  select role::text into v_role from public.profiles where id = p_staff;
  if v_role is distinct from 'staff' then raise exception '目标不是子账号'; end if;
  delete from public.staff_accounts where id = p_staff;
  delete from public.profiles where id = p_staff and role = 'staff';
  delete from auth.users where id = p_staff;
  perform public._write_audit('delete_staff', p_staff, null);
  return jsonb_build_object('ok', true);
end;
$$;

-- 受控 RPC：分配渠道账号白名单
create or replace function public.assign_channel(p_staff uuid, p_channels text[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_caller_role text;
  v_owner uuid;
begin
  select role::text into v_caller_role from public.profiles where id = auth.uid();
  if v_caller_role is null then raise exception '未登录或角色缺失'; end if;
  if v_caller_role = 'staff' then raise exception '子账号无权管理子账号'; end if;
  select owner_id into v_owner from public.staff_accounts where id = p_staff;
  if v_owner is null then raise exception '子账号不存在'; end if;
  if v_caller_role = 'user' and v_owner <> auth.uid() then
    raise exception '商户只能管理自己名下的子账号';
  end if;
  update public.staff_accounts
    set channel_allowlist = coalesce(p_channels, '{}'), updated_at = now()
    where id = p_staff;
  perform public._write_audit('assign_channel', p_staff, jsonb_build_object('channels', coalesce(p_channels, '{}')));
  return jsonb_build_object('ok', true);
end;
$$;

-- 受控 RPC：从调用者钱包余额划拨字符给子账号（校验余额 + 原子）
create or replace function public.allocate_chars(p_staff uuid, p_chars bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_caller_role text;
  v_owner uuid;
  v_free_used bigint := 0;
  v_paid_used bigint := 0;
begin
  select role::text into v_caller_role from public.profiles where id = auth.uid();
  if v_caller_role is null then raise exception '未登录或角色缺失'; end if;
  if v_caller_role = 'staff' then raise exception '子账号无权分配字符'; end if;
  if p_chars is null or p_chars <= 0 then raise exception '分配字符数必须大于 0'; end if;
  select owner_id into v_owner from public.staff_accounts where id = p_staff for update;
  if v_owner is null then raise exception '子账号不存在'; end if;
  if v_caller_role = 'user' and v_owner <> auth.uid() then
    raise exception '商户只能给自己名下的子账号分配字符';
  end if;

  -- 从调用者（主账号）钱包划拨，先免费后付费，余额不足即拒绝
  select free_chars, paid_chars into v_free_used, v_paid_used
  from public.wallets where user_id = auth.uid() for update;
  if not found then
    insert into public.wallets (user_id) values (auth.uid())
    on conflict (user_id) do nothing;
    select free_chars, paid_chars into v_free_used, v_paid_used
    from public.wallets where user_id = auth.uid() for update;
  end if;
  if v_free_used + v_paid_used < p_chars then
    raise exception '余额不足：需要 % 字符，剩余 % 字符', p_chars, v_free_used + v_paid_used;
  end if;
  v_free_used := least(v_free_used, p_chars);
  v_paid_used := p_chars - v_free_used;
  update public.wallets
    set free_chars = free_chars - v_free_used,
        paid_chars = paid_chars - v_paid_used,
        updated_at = now()
    where user_id = auth.uid();
  update public.staff_accounts
    set char_quota = char_quota + p_chars, updated_at = now()
    where id = p_staff;
  perform public._write_audit('allocate_chars', p_staff, jsonb_build_object('chars', p_chars));
  return jsonb_build_object('ok', true, 'allocated', p_chars);
end;
$$;

-- 受控 RPC：重置密码（owner 全部 / admin 商户·子账号+自己 / 商户 自己子账号+自己 / 子账号 自己）
create or replace function public.reset_password(p_target uuid, p_password text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_caller_role text;
  v_target_role text;
  v_staff_owner uuid;
begin
  select role::text into v_caller_role from public.profiles where id = auth.uid();
  if v_caller_role is null then raise exception '未登录或角色缺失'; end if;
  if p_target is null or p_password is null or length(p_password) < 6 then
    raise exception '目标或密码无效';
  end if;
  select role::text into v_target_role from public.profiles where id = p_target;
  if v_target_role is null then raise exception '目标账号不存在'; end if;

  if v_caller_role = 'owner' then
    null; -- owner 可重置所有
  elsif v_caller_role = 'admin' then
    if v_target_role not in ('user', 'staff') and p_target <> auth.uid() then
      raise exception '管理员只能重置商户/子账号或自己的密码';
    end if;
  elsif v_caller_role = 'user' then
    if p_target <> auth.uid() then
      select owner_id into v_staff_owner from public.staff_accounts where id = p_target;
      if v_staff_owner is distinct from auth.uid() then
        raise exception '商户只能重置自己名下子账号或自己的密码';
      end if;
    end if;
  else -- staff
    if p_target <> auth.uid() then
      raise exception '子账号只能重置自己的密码';
    end if;
  end if;

  update auth.users
    set encrypted_password = crypt(p_password, gen_salt('bf')), updated_at = now()
    where id = p_target;
  perform public._write_audit('reset_password', p_target, null);
  return jsonb_build_object('ok', true);
end;
$$;

-- 10. 受控 RPC 只向登录用户开放，撤 PUBLIC/anon
revoke all on function public.create_staff(uuid, text, text, text[], bigint, text) from public, anon;
revoke all on function public.suspend_staff(uuid) from public, anon;
revoke all on function public.delete_staff(uuid) from public, anon;
revoke all on function public.assign_channel(uuid, text[]) from public, anon;
revoke all on function public.allocate_chars(uuid, bigint) from public, anon;
revoke all on function public.reset_password(uuid, text) from public, anon;

grant execute on function public.create_staff(uuid, text, text, text[], bigint, text) to authenticated;
grant execute on function public.suspend_staff(uuid) to authenticated;
grant execute on function public.delete_staff(uuid) to authenticated;
grant execute on function public.assign_channel(uuid, text[]) to authenticated;
grant execute on function public.allocate_chars(uuid, bigint) to authenticated;
grant execute on function public.reset_password(uuid, text) to authenticated;

commit;
