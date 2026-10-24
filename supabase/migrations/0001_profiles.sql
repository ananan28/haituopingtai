-- =============================================================
-- 里程碑2：用户角色体系（数据模型）
-- 在 Supabase SQL Editor 或 supabase CLI 中执行本文件
-- =============================================================

-- 1. 角色枚举：owner 平台管理员 / agent 分销代理 / user 终端用户
create type public.user_role as enum ('owner', 'agent', 'user');

-- 2. 用户档案表（关联 Supabase Auth 的 auth.users）
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  username text,
  role public.user_role not null default 'user',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 3. 行级安全：登录用户只能读自己的档案（前端据此读 role）
alter table public.profiles enable row level security;

create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);

-- 4. 新用户注册时自动建档（默认 user 角色）
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, role)
  values (new.id, new.email, 'user')
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 5. 指定第一个 owner（注册首个账号后手动执行，把邮箱换成你的）：
--    update public.profiles set role = 'owner' where email = '你的邮箱';
--    之后 owner 可在里程碑3 的界面里创建/管理 agent。
