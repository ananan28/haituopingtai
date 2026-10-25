begin;

update public.profiles as child set agent_id = null
where agent_id is not null and (agent_id = id or role <> 'user'
  or not exists (select 1 from public.profiles as parent where parent.id = child.agent_id and parent.role = 'agent'));

alter table public.profiles
  add constraint profiles_id_role_unique unique (id, role),
  add column agent_role public.user_role generated always as
    (case when agent_id is not null then 'agent'::public.user_role end) stored,
  add constraint profiles_merchant_agent_check check
    (agent_id is null or (role = 'user' and agent_id <> id)),
  add constraint profiles_active_agent_fk foreign key (agent_id, agent_role)
    references public.profiles (id, role);

create function public.release_agent_relationships()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- The generated-column FK forbids SET NULL, so detach children before deleting the parent.
  if tg_op = 'DELETE' then
    update public.profiles set agent_id = null where agent_id = old.id;
    return old;
  end if;
  if old.role is distinct from new.role then
    new.agent_id := null;
    if old.role = 'agent' and new.role <> 'agent' then
      update public.profiles set agent_id = null where agent_id = old.id;
    end if;
    if new.role <> 'agent' then new.commission_rate := null; end if;
  end if;
  return new;
end;
$$;

create trigger profiles_release_agent_relationships
  before update of role or delete on public.profiles
  for each row execute function public.release_agent_relationships();

revoke all on function public.release_agent_relationships() from public, anon, authenticated, service_role;

alter policy "profiles_agent_select_own_users" on public.profiles
  using (public.current_user_role() = 'agent' and auth.uid() = agent_id and role = 'user');

alter policy "commission_select_own" on public.commission_records
  using ((public.current_user_role() = 'agent' and auth.uid() = agent_id)
    or public.current_user_role() = 'owner');

alter policy "withdrawal_select_own" on public.withdrawal_requests
  using ((public.current_user_role() = 'agent' and auth.uid() = agent_id)
    or public.current_user_role() = 'owner');

drop policy if exists "orders_insert_own" on public.recharge_orders;
drop policy if exists "withdrawal_insert_own" on public.withdrawal_requests;
drop policy if exists "pools_insert_owner" on public.translation_pools;
drop policy if exists "pools_update_owner" on public.translation_pools;

-- Payment verification and idempotent server billing are not deployed; client financial writes remain closed.
revoke insert, update, delete, truncate, references, trigger
  on public.wallets, public.translation_pools, public.usage_records,
     public.recharge_orders, public.commission_records, public.withdrawal_requests
  from public, anon, authenticated;

revoke insert, delete, truncate, references, trigger on public.profiles
  from public, anon, authenticated;

-- The legacy RPC trusts caller-provided character counts and lacks a request idempotency key.
revoke all on function public.consume_translation_chars(integer, uuid, text, text)
  from public, anon, authenticated, service_role;

commit;
