-- Local-tested service layer. Deploy only to the explicitly selected commercial project.
begin;
create schema if not exists haituo_private;
revoke all on schema haituo_private from public, anon, authenticated;

create table public.channel_ports (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id),
  channel text not null check(channel in ('whatsapp','whatsapp-pure','whatsapp-business','signal','telegram','telegram-k','telegram-a')),
  name text not null check(length(name) between 1 and 100),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.channel_ports enable row level security;
create index channel_ports_owner on public.channel_ports(owner_id) where active;
revoke all on public.channel_ports from public, anon, authenticated;
grant select on public.channel_ports to authenticated;
create policy channel_ports_read on public.channel_ports for select to authenticated using (
  owner_id=(select auth.uid()) or exists (
    select 1 from public.staff_accounts s where s.id=(select auth.uid()) and s.owner_id=channel_ports.owner_id
      and s.status='active' and channel_ports.id::text=any(s.channel_allowlist)
  )
);
create function public.create_channel_port(p_channel text,p_name text) returns jsonb
language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.channel_ports;
begin
  if auth.uid() is null or public.current_user_role() not in ('owner','admin','user') then raise exception 'Port creation denied'; end if;
  insert into public.channel_ports(owner_id,channel,name) values(auth.uid(),p_channel,p_name) returning * into v;
  return to_jsonb(v);
end; $$;
revoke all on function public.create_channel_port(text,text) from public,anon;
grant execute on function public.create_channel_port(text,text) to authenticated;

-- Initial staff grants must come through allocate_chars (which debits a wallet).
-- Otherwise create_staff(p_quota=...) would mint quota without a debit.
create function haituo_private.staff_initial_quota() returns trigger language plpgsql as $$
begin
  if new.char_quota<>0 or new.char_used<>0 then raise exception 'Create staff with zero quota, then allocate characters'; end if;
  return new;
end; $$;
revoke all on function haituo_private.staff_initial_quota() from public,anon,authenticated;
create trigger staff_initial_quota before insert on public.staff_accounts for each row execute function haituo_private.staff_initial_quota();

alter function public.create_staff(uuid,text,text,text[],bigint,text) set schema haituo_private;
revoke all on function haituo_private.create_staff(uuid,text,text,text[],bigint,text) from public,anon,authenticated;
create function public.create_staff(p_owner uuid,p_email text,p_password text,p_channels text[] default '{}',p_quota bigint default 0,p_note text default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v jsonb;
begin
  if p_quota is null or p_quota<0 then raise exception 'Invalid initial quota'; end if;
  v:=haituo_private.create_staff(p_owner,p_email,p_password,p_channels,0,p_note);
  if p_quota>0 then perform public.allocate_chars((v->>'staff_id')::uuid,p_quota); end if;
  return v;
end; $$;
revoke all on function public.create_staff(uuid,text,text,text[],bigint,text) from public,anon;
grant execute on function public.create_staff(uuid,text,text,text[],bigint,text) to authenticated;

create table public.translation_jobs (
  user_id uuid not null references public.profiles(id), request_id uuid not null,
  port_id uuid not null references public.channel_ports(id), fingerprint text not null,
  state text not null check(state in ('reserved','succeeded','failed')),
  lease_id uuid not null default gen_random_uuid(),
  chars integer not null check(chars between 1 and 100000),
  free_reserved bigint not null default 0, paid_reserved bigint not null default 0,
  staff_reserved boolean not null, target_lang text not null,
  result text, provider text, created_at timestamptz not null default now(), expires_at timestamptz not null,
  primary key(user_id,request_id)
);
create index translation_jobs_expiry on public.translation_jobs(expires_at) where state='reserved';
create index translation_jobs_port on public.translation_jobs(port_id);
alter table public.translation_jobs enable row level security;
revoke all on public.translation_jobs from public,anon,authenticated;

create function public.reserve_platform_translation(p_user uuid,p_request uuid,p_port uuid,p_fingerprint text,p_chars integer,p_language text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_role text; v_port public.channel_ports; v_staff public.staff_accounts; v_wallet public.wallets;
  v_job public.translation_jobs; v_free bigint:=0; v_paid bigint:=0;
begin
  if p_user is null or p_request is null or p_fingerprint !~ '^[a-f0-9]{64}$' or p_chars not between 1 and 100000
    or length(p_language) not between 1 and 64 then raise exception 'Invalid request'; end if;
  -- Serialize retries with the same request key before any wallet/usage change.
  perform pg_advisory_xact_lock(hashtextextended(p_user::text||':'||p_request::text,0));
  select role::text into v_role from public.profiles where id=p_user;
  select * into v_port from public.channel_ports where id=p_port and active for share;
  if not found or v_role is null then raise exception 'Port denied'; end if;
  if v_role='staff' then
    select * into v_staff from public.staff_accounts where id=p_user for update;
    if not found or v_staff.status<>'active' or v_staff.owner_id<>v_port.owner_id
      or not(p_port::text=any(v_staff.channel_allowlist)) then raise exception 'Staff port denied'; end if;
  elsif v_role not in ('owner','admin','user') or v_port.owner_id<>p_user then raise exception 'Port denied'; end if;
  select * into v_job from public.translation_jobs where user_id=p_user and request_id=p_request for update;
  if found then
    if v_job.fingerprint<>p_fingerprint or v_job.port_id<>p_port or v_job.chars<>p_chars or v_job.target_lang<>p_language then raise exception 'Request key reused with different input'; end if;
    if v_job.state<>'failed' then return jsonb_build_object('state',v_job.state,'text',v_job.result,'provider',v_job.provider); end if;
    delete from public.translation_jobs where user_id=p_user and request_id=p_request;
  end if;
  if v_role='staff' then
    if v_staff.char_quota-v_staff.char_used<p_chars then raise exception 'Insufficient quota'; end if;
    update public.staff_accounts set char_used=char_used+p_chars,updated_at=now() where id=p_user;
  else
    select * into v_wallet from public.wallets where user_id=p_user for update;
    if not found or v_wallet.free_chars+v_wallet.paid_chars<p_chars then raise exception 'Insufficient quota'; end if;
    v_free:=least(v_wallet.free_chars,p_chars); v_paid:=p_chars-v_free;
    update public.wallets set free_chars=free_chars-v_free,paid_chars=paid_chars-v_paid,updated_at=now() where user_id=p_user;
  end if;
  insert into public.translation_jobs(user_id,request_id,port_id,fingerprint,state,chars,free_reserved,paid_reserved,staff_reserved,target_lang,expires_at)
    values(p_user,p_request,p_port,p_fingerprint,'reserved',p_chars,v_free,v_paid,v_role='staff',p_language,now()+interval '5 minutes') returning * into v_job;
  return jsonb_build_object('state','execute','lease',v_job.lease_id);
end; $$;

create function public.finish_platform_translation(p_user uuid,p_request uuid,p_lease uuid,p_success boolean,p_result text default null,p_provider text default null)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v public.translation_jobs; v_ok boolean;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_user::text||':'||p_request::text,0));
  select * into v from public.translation_jobs where user_id=p_user and request_id=p_request for update;
  if not found then raise exception 'Unknown request'; end if;
  if v.lease_id is distinct from p_lease then raise exception 'Stale attempt'; end if;
  if v.state<>'reserved' then return jsonb_build_object('state',v.state,'text',v.result,'provider',v.provider); end if;
  v_ok:=p_success and v.expires_at>now() and length(p_result) between 1 and 200000 and length(p_provider) between 1 and 128;
  if v.staff_reserved then
    v_ok:=v_ok and exists(select 1 from public.staff_accounts s join public.channel_ports p on p.id=v.port_id
      where s.id=p_user and s.status='active' and p.active and p.owner_id=s.owner_id and p.id::text=any(s.channel_allowlist));
  else
    v_ok:=v_ok and exists(select 1 from public.channel_ports p join public.profiles u on u.id=p_user
      where p.id=v.port_id and p.active and p.owner_id=p_user and u.role::text in ('owner','admin','user'));
  end if;
  if coalesce(v_ok,false) then
    update public.translation_jobs set state='succeeded',result=p_result,provider=p_provider where user_id=p_user and request_id=p_request;
    insert into public.usage_records(user_id,account_id,kind,chars,target_lang) values(p_user,v.port_id,'translate',v.chars,v.target_lang);
    return jsonb_build_object('state','succeeded','text',p_result,'provider',p_provider);
  end if;
  if v.staff_reserved then
    update public.staff_accounts set char_used=char_used-v.chars,updated_at=now() where id=p_user;
  else
    update public.wallets set free_chars=free_chars+v.free_reserved,paid_chars=paid_chars+v.paid_reserved,updated_at=now() where user_id=p_user;
  end if;
  update public.translation_jobs set state='failed' where user_id=p_user and request_id=p_request;
  return jsonb_build_object('state','failed');
end; $$;

create function public.release_expired_platform_translations() returns integer
language plpgsql security definer set search_path=public,pg_temp as $$
declare v record; n integer:=0; v_lease uuid;
begin
  for v in select user_id,request_id,lease_id from public.translation_jobs where state='reserved' and expires_at<now()
    order by expires_at limit 100 loop
    if pg_try_advisory_xact_lock(hashtextextended(v.user_id::text||':'||v.request_id::text,0)) then
      select lease_id into v_lease from public.translation_jobs where user_id=v.user_id and request_id=v.request_id
        and state='reserved' and expires_at<now();
      if found then perform public.finish_platform_translation(v.user_id,v.request_id,v_lease,false); n:=n+1; end if;
    end if;
  end loop;
  return n;
end; $$;
revoke all on function public.reserve_platform_translation(uuid,uuid,uuid,text,integer,text),
  public.finish_platform_translation(uuid,uuid,uuid,boolean,text,text),public.release_expired_platform_translations()
  from public,anon,authenticated;
grant execute on function public.reserve_platform_translation(uuid,uuid,uuid,text,integer,text),
  public.finish_platform_translation(uuid,uuid,uuid,boolean,text,text),public.release_expired_platform_translations() to service_role;
commit;
