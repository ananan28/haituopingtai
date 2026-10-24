-- =============================================================
-- 里程碑3：角色多级分销（owner → agent → user）
-- 在 Supabase SQL Editor 或 supabase CLI 中执行本文件
-- =============================================================

-- 1. 新增字段：用户归属代理 + 代理分成比例
alter table public.profiles
  add column if not exists agent_id uuid references public.profiles (id) on delete set null,
  add column if not exists commission_rate numeric(5,2)
    check (commission_rate is null or (commission_rate >= 0 and commission_rate <= 100));

-- 2. 当前用户角色辅助函数（security definer 避免 RLS 自引用递归）
create or replace function public.current_user_role()
returns text
language sql
security definer
set search_path = public
stable
as $$
  select role::text from public.profiles where id = auth.uid();
$$;

-- 3. RLS 策略
-- owner：可读所有档案
create policy "profiles_owner_select" on public.profiles
  for select using (public.current_user_role() = 'owner');

-- owner：可改所有档案（设代理 / 降级 / 分配 / 分成）
create policy "profiles_owner_update" on public.profiles
  for update using (public.current_user_role() = 'owner');

-- agent：可读自己名下用户
create policy "profiles_agent_select_own_users" on public.profiles
  for select using (auth.uid() = agent_id);

-- 4. 说明：分成结算逻辑先留接口（见 distribution.js 的 settleAgentCommissions），
--    里程碑后续接入字符扣费（里程碑4）后，再实现真正的结算/出账。
