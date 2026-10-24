-- =============================================================
-- 里程碑4：字符计费底座（钱包 / 翻译池 / 用量 / 充值 / 分成）
-- 在 Supabase SQL Editor 或 supabase CLI 中执行本文件（0001、0002 之后）
-- =============================================================

-- 1. 钱包：免费字符 + 付费字符，按原文成功翻译字符数扣减
create table if not exists public.wallets (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  free_chars bigint not null default 100000 check (free_chars >= 0),
  paid_chars bigint not null default 0 check (paid_chars >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 2. 翻译池：额度包，可分配给子账号；unlimited = 0 字符不限量；支持起止有效期
create table if not exists public.translation_pools (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  assigned_user_id uuid references public.profiles (id) on delete set null,
  name text not null default '翻译额度',
  total_chars bigint not null default 0 check (total_chars >= 0),
  used_chars bigint not null default 0 check (used_chars >= 0),
  unlimited boolean not null default false,
  starts_at timestamptz not null default now(),
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  check (unlimited or total_chars > 0),
  check (unlimited or used_chars <= total_chars),
  check (expires_at is null or expires_at > starts_at)
);

-- 3. 用量流水：每次实际翻译成功后记录；account_id 预留给渠道账号 UUID 数据分区
create table if not exists public.usage_records (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  pool_id uuid references public.translation_pools (id) on delete set null,
  account_id uuid,
  kind text not null default 'translate',
  chars integer not null check (chars > 0),
  source_lang text,
  target_lang text,
  created_at timestamptz not null default now()
);

create index if not exists usage_records_user_time_idx
  on public.usage_records (user_id, created_at desc);

-- 4. 充值订单：支付通道后续接入，先落订单
create table if not exists public.recharge_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  package_id text not null,
  chars bigint not null check (chars > 0),
  amount_cents integer not null check (amount_cents > 0),
  status text not null default 'pending'
    check (status in ('pending', 'paid', 'canceled', 'refunded')),
  provider text,
  created_at timestamptz not null default now(),
  paid_at timestamptz
);

create index if not exists recharge_orders_user_time_idx
  on public.recharge_orders (user_id, created_at desc);

-- 5. 代理分成流水：直客 / 间客两级，供后续结算与提现
create table if not exists public.commission_records (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.recharge_orders (id) on delete set null,
  agent_id uuid not null references public.profiles (id) on delete cascade,
  buyer_id uuid not null references public.profiles (id) on delete cascade,
  level text not null check (level in ('direct', 'indirect')),
  rate numeric(5,2) not null check (rate >= 0 and rate <= 100),
  base_cents integer not null check (base_cents >= 0),
  amount_cents integer not null check (amount_cents >= 0),
  status text not null default 'pending'
    check (status in ('pending', 'available', 'withdrawn')),
  created_at timestamptz not null default now()
);

create table if not exists public.withdrawal_requests (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.profiles (id) on delete cascade,
  amount_cents integer not null check (amount_cents > 0),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'paid', 'rejected')),
  note text,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

-- 6. 新档案自动建钱包（含 100,000 免费字符），并为已有账号补建
create or replace function public.handle_new_wallet()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.wallets (user_id) values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_profile_created_wallet on public.profiles;
create trigger on_profile_created_wallet
  after insert on public.profiles
  for each row execute function public.handle_new_wallet();

insert into public.wallets (user_id)
select id from public.profiles
on conflict (user_id) do nothing;

-- 7. 原子扣费：优先有效期内的翻译池，其次钱包（免费额度 → 付费余额）
--    额度不足时抛错，翻译结果不应返回，保证「不成功不扣费」
create or replace function public.consume_translation_chars(
  p_chars integer,
  p_account_id uuid default null,
  p_source_lang text default null,
  p_target_lang text default null
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_pool_id uuid;
  v_wallet public.wallets%rowtype;
  v_free_used bigint := 0;
  v_paid_used bigint := 0;
  v_remaining bigint;
begin
  if v_uid is null then
    raise exception '未登录，无法扣费';
  end if;
  if p_chars is null or p_chars <= 0 then
    raise exception '扣费字符数必须大于 0';
  end if;

  select id into v_pool_id
  from public.translation_pools
  where (assigned_user_id = v_uid or (assigned_user_id is null and owner_id = v_uid))
    and starts_at <= now()
    and (expires_at is null or expires_at > now())
    and (unlimited or total_chars - used_chars >= p_chars)
  order by (expires_at is null) asc, expires_at asc, created_at asc
  limit 1
  for update;

  if v_pool_id is not null then
    update public.translation_pools
      set used_chars = used_chars + p_chars
      where id = v_pool_id;

    insert into public.usage_records (user_id, pool_id, account_id, kind, chars, source_lang, target_lang)
    values (v_uid, v_pool_id, p_account_id, 'translate', p_chars, p_source_lang, p_target_lang);

    return jsonb_build_object(
      'ok', true,
      'source', 'pool',
      'pool_id', v_pool_id,
      'charged', p_chars
    );
  end if;

  select * into v_wallet from public.wallets where user_id = v_uid for update;
  if not found then
    insert into public.wallets (user_id) values (v_uid) on conflict (user_id) do nothing;
    select * into v_wallet from public.wallets where user_id = v_uid for update;
  end if;

  if (v_wallet.free_chars + v_wallet.paid_chars) < p_chars then
    raise exception '字符额度不足：需要 % 字符，剩余 % 字符',
      p_chars, v_wallet.free_chars + v_wallet.paid_chars;
  end if;

  v_free_used := least(v_wallet.free_chars, p_chars);
  v_paid_used := p_chars - v_free_used;

  update public.wallets
    set free_chars = free_chars - v_free_used,
        paid_chars = paid_chars - v_paid_used,
        updated_at = now()
    where user_id = v_uid
    returning * into v_wallet;

  insert into public.usage_records (user_id, pool_id, account_id, kind, chars, source_lang, target_lang)
  values (v_uid, null, p_account_id, 'translate', p_chars, p_source_lang, p_target_lang);

  v_remaining := v_wallet.free_chars + v_wallet.paid_chars;
  return jsonb_build_object(
    'ok', true,
    'source', 'wallet',
    'charged', p_chars,
    'free_chars', v_wallet.free_chars,
    'paid_chars', v_wallet.paid_chars,
    'remaining', v_remaining
  );
end;
$$;

revoke all on function public.consume_translation_chars(integer, uuid, text, text) from public;
grant execute on function public.consume_translation_chars(integer, uuid, text, text) to authenticated;

-- 8. RLS：用户只能看自己的钱包 / 用量 / 订单；翻译池可看自己持有或被分配的
alter table public.wallets enable row level security;
alter table public.translation_pools enable row level security;
alter table public.usage_records enable row level security;
alter table public.recharge_orders enable row level security;
alter table public.commission_records enable row level security;
alter table public.withdrawal_requests enable row level security;

create policy "wallets_select_own" on public.wallets
  for select using (auth.uid() = user_id);

create policy "pools_select_own" on public.translation_pools
  for select using (
    auth.uid() = owner_id
    or auth.uid() = assigned_user_id
    or public.current_user_role() = 'owner'
  );

-- 翻译池是平台/代理分配的额度，普通用户只能查看，不能自行创建或扩容
create policy "pools_insert_owner" on public.translation_pools
  for insert with check (public.current_user_role() = 'owner');

create policy "pools_update_owner" on public.translation_pools
  for update using (public.current_user_role() = 'owner');

create policy "usage_select_own" on public.usage_records
  for select using (
    auth.uid() = user_id
    or public.current_user_role() = 'owner'
  );

create policy "orders_select_own" on public.recharge_orders
  for select using (
    auth.uid() = user_id
    or public.current_user_role() = 'owner'
  );

create policy "orders_insert_own" on public.recharge_orders
  for insert with check (auth.uid() = user_id and status = 'pending');

create policy "commission_select_own" on public.commission_records
  for select using (
    auth.uid() = agent_id
    or public.current_user_role() = 'owner'
  );

create policy "withdrawal_select_own" on public.withdrawal_requests
  for select using (
    auth.uid() = agent_id
    or public.current_user_role() = 'owner'
  );

create policy "withdrawal_insert_own" on public.withdrawal_requests
  for insert with check (auth.uid() = agent_id and status = 'pending');

-- 9. 说明：
--    钱包与翻译池的写操作只允许通过 consume_translation_chars（security definer）完成，
--    避免客户端并发扣费导致余额透支。充值到账、分成结算、提现审核由后续支付 / 代理里程碑实现。
