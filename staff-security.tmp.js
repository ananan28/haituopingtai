'use strict';
// Local-only tests: isolated in-memory PGlite, fake auth schema/roles/uid, stub bcrypt.
// No live Supabase, no network, no real credentials, no real .env read.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { PGlite } = require('C:/Users/AQ28n/AppData/Local/Temp/haituo-window2-checks/node_modules/@electric-sql/pglite');
const db = new PGlite();
const ids = Object.fromEntries(['owner', 'admin', 'merchant', 'other', 'agent'].map((r, i) => [r, `20000000-0000-0000-0000-${String(i + 1).padStart(12, '0')}`]));
const migrationDir = path.join(__dirname, 'supabase/migrations');
const migrations = fs.readdirSync(migrationDir).filter((f) => /^\d+.*\.sql$/.test(f)).sort();
let passed = 0;
let staffId = null;
async function test(name, fn) { await fn(); passed++; console.log('PASS ' + name); }
async function asUser(role, sql, params = []) {
  return db.transaction(async (tx) => {
    await tx.exec('set local role authenticated');
    await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [ids[role]]);
    return tx.query(sql, params);
  });
}
async function denied(role, sql, params = []) {
  await assert.rejects(asUser(role, sql, params), (e) => e.code === '42501' || e.code === 'P0001');
}
async function asId(id, sql, params = []) {
  return db.transaction(async (tx) => {
    await tx.exec('set local role authenticated');
    await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [id]);
    return tx.query(sql, params);
  });
}
async function rpc(role, fn, params) {
  const placeholders = params.map((_, i) => '$' + (i + 1)).join(',');
  return asUser(role, `select public.${fn}(${placeholders}) as result`, params);
}
async function rpcId(id, fn, params) {
  const placeholders = params.map((_, i) => '$' + (i + 1)).join(',');
  return asId(id, `select public.${fn}(${placeholders}) as result`, params);
}
async function main() {
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key, email text not null, encrypted_password text, email_confirmed_at timestamptz, created_at timestamptz, updated_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema public, auth to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
    -- bcrypt 桩（真实 Supabase 由 pgcrypto 提供；隔离环境无 pgcrypto）
    create or replace function public.crypt(password text, salt text) returns text language sql as $$ select 'STUB_BCRYPT:' || password || ':' || salt $$;
    create or replace function public.gen_salt(type text) returns text language sql as $$ select 'stub-salt' $$;
  `);
  // 先跑 0001–0004，造一个 agent 供 0005 迁移
  for (const file of migrations.filter((f) => Number(f.split('_')[0]) <= 4)) await db.exec(fs.readFileSync(path.join(migrationDir, file), 'utf8'));
  for (const [role, id] of Object.entries(ids)) await db.query('insert into auth.users (id, email) values ($1,$2)', [id, role + '@example.invalid']);
  await db.query("update public.profiles set role='owner' where id=$1", [ids.owner]);
  await db.query("update public.profiles set role='user' where id=$1", [ids.merchant]);
  await db.query("update public.profiles set role='user' where id=$1", [ids.other]);
  await db.query("update public.profiles set role='agent' where id=$1", [ids.agent]);
  await db.query('update public.wallets set free_chars=5000, paid_chars=0 where user_id=$1', [ids.merchant]);
  await db.query('update public.wallets set free_chars=9000, paid_chars=0 where user_id=$1', [ids.owner]);

  // 0005 迁移（此时才把 admin/staff 加入枚举）
  await db.exec(fs.readFileSync(path.join(migrationDir, '0005_staff_accounts.sql'), 'utf8'));
  await db.query("update public.profiles set role='admin' where id=$1", [ids.admin]);

  await test('0005 migrates existing agent to user', async () => {
    assert.equal((await db.query('select role::text as r from public.profiles where id=$1', [ids.agent])).rows[0].r, 'user');
  });
  await test('0005 forbids writing agent role again', async () => {
    await assert.rejects(db.query("update public.profiles set role='agent' where id=$1", [ids.merchant]), (e) => e.code === '23514');
  });
  await test('0005 drops agent relationship columns and trigger', async () => {
    const cols = (await db.query("select column_name from information_schema.columns where table_name='profiles'")).rows.map((r) => r.column_name);
    assert.ok(!cols.includes('agent_id') && !cols.includes('commission_rate') && !cols.includes('agent_role'), cols.join(','));
    assert.equal((await db.query("select count(*)::int as n from pg_trigger where tgname='profiles_release_agent_relationships'")).rows[0].n, 0);
    assert.equal((await db.query("select count(*)::int as n from pg_proc where proname='release_agent_relationships'")).rows[0].n, 0);
  });
  await test('0005 drops billing agent_id columns (commission/withdrawal)', async () => {
    for (const table of ['commission_records', 'withdrawal_requests']) {
      const cols = (await db.query(`select column_name from information_schema.columns where table_name='${table}'`)).rows.map((r) => r.column_name);
      assert.ok(!cols.includes('agent_id'), table + ' still has agent_id: ' + cols.join(','));
    }
  });
  await test('0005 keeps owner/admin/user/staff roles available', async () => {
    const enumVals = (await db.query("select enumlabel from pg_enum e join pg_type t on t.oid=e.enumtypid where t.typname='user_role'")).rows.map((r) => r.enumlabel);
    for (const v of ['owner', 'admin', 'user', 'staff']) assert.ok(enumVals.includes(v), v);
  });
  await test('financial closures from 0004 still hold for staff-capable world', async () => {
    for (const role of ['owner', 'admin', 'merchant', 'other']) {
      await denied(role, 'update public.wallets set free_chars=999999');
      await denied(role, "insert into public.recharge_orders(user_id,package_id,chars,amount_cents) values($1,'x',1,1)", [ids[role]]);
      await denied(role, 'select public.consume_translation_chars(100,null,null,null)');
    }
  });

  // ---- 受控 RPC ----
  await test('create_staff as merchant creates staff + profile + auth + audit', async () => {
    const res = (await rpc('merchant', 'create_staff', [ids.merchant, 'staff1@example.invalid', 'secret6', ['wa-lea'], 1000, '备注一'])).rows[0].result;
    assert.equal(res.ok, true); staffId = res.staff_id;
    const row = (await db.query('select owner_id, email, char_quota, status, note, channel_allowlist from public.staff_accounts where id=$1', [staffId])).rows[0];
    assert.equal(row.owner_id, ids.merchant); assert.equal(row.email, 'staff1@example.invalid');
    assert.equal(Number(row.char_quota), 1000); assert.equal(row.status, 'active'); assert.equal(row.note, '备注一');
    assert.deepEqual(row.channel_allowlist, ['wa-lea']);
    assert.equal((await db.query('select role::text as r from public.profiles where id=$1', [staffId])).rows[0].r, 'staff');
    assert.equal((await db.query('select count(*)::int as n from auth.users where id=$1', [staffId])).rows[0].n, 1);
    const audit = (await db.query("select action, actor_id, target_id from public.audit_logs where action='create_staff'")).rows;
    assert.equal(audit.length, 1); assert.equal(audit[0].actor_id, ids.merchant); assert.equal(audit[0].target_id, staffId);
  });
  await test('create_staff as merchant cannot create for another owner', async () => {
    await assert.rejects(rpc('merchant', 'create_staff', [ids.other, 'x@example.invalid', 'secret6']), (e) => e.code === 'P0001');
  });
  await test('create_staff as staff is denied', async () => {
    await assert.rejects(rpcId(staffId, 'create_staff', [ids.merchant, 'x@example.invalid', 'secret6']), (e) => e.code === 'P0001');
  });
  await test('create_staff as owner/admin can create under any merchant', async () => {
    const r1 = (await rpc('owner', 'create_staff', [ids.merchant, 'staff2@example.invalid', 'secret6'])).rows[0].result;
    assert.equal(r1.ok, true);
    const r2 = (await rpc('admin', 'create_staff', [ids.other, 'staff3@example.invalid', 'secret6'])).rows[0].result;
    assert.equal(r2.ok, true);
  });
  await test('staff_accounts RLS: owner sees all, merchant sees own, staff sees self only', async () => {
    assert.equal((await asUser('owner', 'select * from public.staff_accounts')).rows.length, 3);
    assert.equal((await asUser('merchant', 'select * from public.staff_accounts')).rows.length, 2);
    assert.equal((await asUser('other', 'select * from public.staff_accounts')).rows.length, 1);
    assert.equal((await asId(staffId, 'select * from public.staff_accounts')).rows.length, 1);
    const own = (await asId(staffId, 'select id from public.staff_accounts')).rows[0].id;
    assert.equal(own, staffId);
  });
  await test('assign_channel as merchant own staff works, others denied', async () => {
    const res = (await rpc('merchant', 'assign_channel', [staffId, ['wa-lea', 'tg-chen']])).rows[0].result;
    assert.equal(res.ok, true);
    assert.deepEqual((await db.query('select channel_allowlist from public.staff_accounts where id=$1', [staffId])).rows[0].channel_allowlist, ['wa-lea', 'tg-chen']);
    await assert.rejects(rpc('other', 'assign_channel', [staffId, ['x']]), (e) => e.code === 'P0001');
  });
  await test('allocate_chars debits caller wallet and credits staff quota atomically', async () => {
    const before = (await db.query('select free_chars, paid_chars from public.wallets where user_id=$1', [ids.merchant])).rows[0];
    const res = (await rpc('merchant', 'allocate_chars', [staffId, 300])).rows[0].result;
    assert.equal(res.ok, true);
    const after = (await db.query('select free_chars, paid_chars from public.wallets where user_id=$1', [ids.merchant])).rows[0];
    assert.equal(Number(after.free_chars), Number(before.free_chars) - 300);
    assert.equal(Number((await db.query('select char_quota from public.staff_accounts where id=$1', [staffId])).rows[0].char_quota), 1300);
  });
  await test('allocate_chars insufficient balance is denied without side effects', async () => {
    const before = (await db.query('select free_chars from public.wallets where user_id=$1', [ids.merchant])).rows[0];
    await assert.rejects(rpc('merchant', 'allocate_chars', [staffId, 999999]), (e) => e.code === 'P0001');
    assert.deepEqual((await db.query('select free_chars from public.wallets where user_id=$1', [ids.merchant])).rows[0], before);
  });
  await test('allocate_chars for another merchant staff is denied', async () => {
    const otherStaff = (await asUser('other', 'select id from public.staff_accounts')).rows[0].id;
    await assert.rejects(rpc('merchant', 'allocate_chars', [otherStaff, 10]), (e) => e.code === 'P0001');
  });
  // ---- 密码重置矩阵（必须在删除 staff1 之前）----
  await test('reset_password matrix: staff self only', async () => {
    assert.equal((await rpcId(staffId, 'reset_password', [staffId, 'newpass6'])).rows[0].result.ok, true);
    await assert.rejects(rpcId(staffId, 'reset_password', [ids.merchant, 'x']), (e) => e.code === 'P0001');
  });
  await test('reset_password matrix: merchant own staff + self', async () => {
    assert.equal((await rpc('merchant', 'reset_password', [staffId, 'newpass6'])).rows[0].result.ok, true);
    assert.equal((await rpc('merchant', 'reset_password', [ids.merchant, 'newpass6'])).rows[0].result.ok, true);
  });
  await test('reset_password: merchant cannot reset another merchant (cross-tenant UUID)', async () => {
    await assert.rejects(rpc('merchant', 'reset_password', [ids.other, 'newpass6']), (e) => e.code === 'P0001');
  });
  await test('reset_password matrix: admin merchant/staff/self, not owner', async () => {
    assert.equal((await rpc('admin', 'reset_password', [ids.merchant, 'newpass6'])).rows[0].result.ok, true);
    assert.equal((await rpc('admin', 'reset_password', [staffId, 'newpass6'])).rows[0].result.ok, true);
    assert.equal((await rpc('admin', 'reset_password', [ids.admin, 'newpass6'])).rows[0].result.ok, true);
    await assert.rejects(rpc('admin', 'reset_password', [ids.owner, 'x']), (e) => e.code === 'P0001');
  });
  await test('reset_password matrix: owner any', async () => {
    assert.equal((await rpc('owner', 'reset_password', [ids.owner, 'newpass6'])).rows[0].result.ok, true);
    assert.equal((await rpc('owner', 'reset_password', [ids.merchant, 'newpass6'])).rows[0].result.ok, true);
    assert.equal((await rpc('owner', 'reset_password', [ids.admin, 'newpass6'])).rows[0].result.ok, true);
  });
  await test('reset_password actually updates auth.users encrypted_password and audits', async () => {
    const pw = (await db.query('select encrypted_password from auth.users where id=$1', [ids.merchant])).rows[0].encrypted_password;
    assert.match(pw, /^STUB_BCRYPT:newpass6:/);
    // 1(staff self) + 2(merchant) + 3(admin) + 3(owner) = 9
    assert.equal((await db.query("select count(*)::int as n from public.audit_logs where action='reset_password'")).rows[0].n, 9);
  });

  await test('suspend_staff and delete_staff enforce ownership and audit', async () => {
    const res = (await rpc('merchant', 'suspend_staff', [staffId])).rows[0].result;
    assert.equal(res.ok, true);
    assert.equal((await db.query('select status from public.staff_accounts where id=$1', [staffId])).rows[0].status, 'suspended');
    await assert.rejects(rpc('other', 'suspend_staff', [staffId]), (e) => e.code === 'P0001');
    const del = (await rpc('merchant', 'delete_staff', [staffId])).rows[0].result;
    assert.equal(del.ok, true);
    assert.equal((await db.query('select count(*)::int as n from public.staff_accounts where id=$1', [staffId])).rows[0].n, 0);
    assert.equal((await db.query('select count(*)::int as n from public.profiles where id=$1', [staffId])).rows[0].n, 0);
    assert.equal((await db.query('select count(*)::int as n from auth.users where id=$1', [staffId])).rows[0].n, 0);
    assert.equal((await db.query("select count(*)::int as n from public.audit_logs where action in ('suspend_staff','delete_staff')")).rows[0].n, 2);
  });
  await test('staff RPCs revoked from anon/public', async () => {
    for (const sig of ['create_staff(uuid,text,text,text[],bigint,text)', 'suspend_staff(uuid)', 'delete_staff(uuid)', 'assign_channel(uuid,text[])', 'allocate_chars(uuid,bigint)', 'reset_password(uuid,text)']) {
      const q = await db.query(`select has_function_privilege('anon','public.${sig}','execute') as allowed`);
      assert.equal(q.rows[0].allowed, false, sig);
    }
  });
  console.log(`SUMMARY ${passed}/${passed}; isolated single-connection PGlite with stub bcrypt; no live DB, no multi-connection concurrency, real payment/charging still disabled.`);
}
main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(() => db.close());
