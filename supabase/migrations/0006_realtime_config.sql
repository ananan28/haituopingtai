-- =============================================================
-- 里程碑6：远程配置同步（Supabase Realtime 秒级推送）
-- 在 0001–0005 之后执行。本文件不读取/写入任何真实密钥。
-- 写操作仅 owner/admin（受控 RPC + 服务端角色校验 + 审计）；
-- 商户(user)/子账号(staff)只读订阅自己可见的公开配置，
-- 全局定价机密项（scope='admin'）不对商户下发。
--
-- 配置键约定（客户端 src/realtime-config.js 与主进程 realtime-config.js 共用）：
--   announcement (public) -> { "text": "公告正文" }
--   model_order   (public) -> { "chain": ["doubao","qwen",...] }  默认模型顺序
--   channels      (public) -> { "status": { "<channelId>": "on"|"off" } }  渠道上下架
--   pricing       (admin)  -> { "providers": { "<id>": { "pricePerK": 6 } } }  定价机密
-- =============================================================

begin;

-- 1. 平台配置表：key/value + 作用域（scope 决定可见性）
create table if not exists public.platform_config (
  key text primary key,
  value jsonb not null check (jsonb_typeof(value) = 'object'),
  scope text not null default 'public' check (scope in ('public', 'admin')),
  updated_by uuid references public.profiles (id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.platform_config enable row level security;

-- 2. 读策略：登录用户可读 public；owner/admin 额外可读 admin（定价机密）
create policy "platform_config_select_visible" on public.platform_config
  for select using (
    auth.uid() is not null
    and (scope = 'public' or public.current_user_role() in ('owner', 'admin'))
  );

-- 3. 写：不建任何 insert/update/delete 策略 → 默认拒绝；
--    客户端只能通过受控 RPC（security definer）写入
revoke insert, update, delete, truncate, references, trigger
  on public.platform_config from public, anon, authenticated;

-- 4. Realtime：加入 supabase_realtime 发布，写后经 postgres_changes 推送。
--    本地 PGlite 无该发布，用 DO 块容错跳过。
--    REPLICA IDENTITY FULL：UPDATE 时广播完整新行，客户端无需回查即可局部刷新。
alter table public.platform_config replica identity full;

do $$
begin
  begin
    alter publication supabase_realtime add table public.platform_config;
  exception when undefined_object then
    null;
  end;
end $$;

-- 5. 受控 RPC：仅 owner/admin 可写（显式角色校验，即使 security definer 也不放行越权）
create or replace function public.set_platform_config(
  p_key text,
  p_value jsonb,
  p_scope text default 'public'
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_role text;
begin
  select role::text into v_role from public.profiles where id = auth.uid();
  if v_role is null then
    raise exception '未登录或角色缺失';
  end if;
  if v_role not in ('owner', 'admin') then
    raise exception '只有所有者或管理员能修改平台配置';
  end if;
  if p_key is null or p_key !~ '^[a-z0-9_]{1,64}$' then
    raise exception '配置键无效';
  end if;
  if p_scope not in ('public', 'admin') then
    raise exception '配置作用域无效';
  end if;
  if p_value is null or jsonb_typeof(p_value) <> 'object' then
    raise exception '配置值必须是 JSON 对象';
  end if;

  insert into public.platform_config (key, value, scope, updated_by, updated_at)
  values (p_key, p_value, p_scope, auth.uid(), now())
  on conflict (key) do update
    set value = excluded.value,
        scope = excluded.scope,
        updated_by = excluded.updated_by,
        updated_at = now();

  perform public._write_audit('set_platform_config', null,
    jsonb_build_object('key', p_key, 'scope', p_scope));

  return jsonb_build_object('ok', true, 'key', p_key, 'scope', p_scope);
end;
$$;

-- 6. 仅登录用户可调用，撤 PUBLIC/anon
revoke all on function public.set_platform_config(text, jsonb, text) from public, anon;
grant execute on function public.set_platform_config(text, jsonb, text) to authenticated;

commit;
