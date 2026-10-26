'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
test('platform service migration: ownership, reservation, settlement, refund, retries and RLS',async t=>{
  const db=new PGlite(); t.after(()=>db.close());
  await db.exec(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;
    create schema auth;create table auth.users(id uuid primary key,email text not null,encrypted_password text,email_confirmed_at timestamptz,created_at timestamptz,updated_at timestamptz);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema public,auth to anon,authenticated,service_role;
    alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
    alter default privileges in schema public grant all on sequences to anon,authenticated,service_role;
    create function public.crypt(text,text) returns text language sql as $$select 'stub'$$;
    create function public.gen_salt(text) returns text language sql as $$select 'stub'$$;`);
  const dir=path.join(__dirname,'../supabase/migrations');
  for(const file of fs.readdirSync(dir).filter(f=>/^\d.*\.sql$/.test(f)).sort())await db.exec(fs.readFileSync(path.join(dir,file),'utf8'));
  const ids=['10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000003'];
  for(const [i,id] of ids.entries())await db.query('insert into auth.users(id,email) values($1,$2)',[id,'u'+i+'@example.invalid']);
  await db.query("update public.profiles set role='staff' where id=$1",[ids[2]]);
  await db.query('insert into public.staff_accounts(id,owner_id,email) values($1,$2,$3)',[ids[2],ids[0],'staff@example.invalid']);
  const as=async(role,uid,sql,params=[])=>db.transaction(async tx=>{
    await tx.exec('set local role '+role);
    await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[uid]);return tx.query(sql,params);
  });
  const port=(await as('authenticated',ids[0],"select public.create_channel_port('whatsapp','first') as v")).rows[0].v.id;
  const request='20000000-0000-0000-0000-000000000001',hash='a'.repeat(64);
  async function reserve(uid=ids[0],req=request,chars=5,h=hash){return (await as('service_role','',
    'select public.reserve_platform_translation($1,$2,$3,$4,$5,$6) as v',[uid,req,port,h,chars,'zh-CN'])).rows[0].v;}
  async function finish(uid,req,lease,success,text=null){return(await as('service_role','',
    'select public.finish_platform_translation($1,$2,$3,$4,$5,$6) as v',[uid,req,lease,success,text,text?'test':null])).rows[0].v;}
  async function wallet(){return(await db.query('select free_chars,paid_chars from public.wallets where user_id=$1',[ids[0]])).rows[0];}
  await t.test('users cannot read other ports or create ports for staff identities',async()=>{
    assert.equal((await as('authenticated',ids[1],'select * from public.channel_ports')).rows.length,0);
    await assert.rejects(as('authenticated',ids[2],"select public.create_channel_port('whatsapp','forged')"));
    await assert.rejects(reserve(ids[1]));
  });
  await t.test('clients cannot execute billing RPCs, write ledgers, or read private jobs',async()=>{
    await assert.rejects(as('authenticated',ids[0],'select public.reserve_platform_translation($1,$2,$3,$4,5,$5)',[ids[0],request,port,hash,'zh-CN']));
    await assert.rejects(as('authenticated',ids[0],'select * from public.translation_jobs'));
    await assert.rejects(as('authenticated',ids[0],"update public.wallets set free_chars=999999999 where user_id=$1",[ids[0]]));
  });
  await t.test('reserve holds exact Unicode-source character cost; replay neither executes nor double holds',async()=>{
    await db.query('update public.wallets set free_chars=3,paid_chars=10 where user_id=$1',[ids[0]]);
    const r=await reserve();assert.equal(r.state,'execute');assert.ok(r.lease);
    assert.deepEqual(await wallet(),{free_chars:0,paid_chars:8});
    assert.equal((await reserve()).state,'reserved');assert.deepEqual(await wallet(),{free_chars:0,paid_chars:8});
    await assert.rejects(reserve(ids[0],request,6));
    assert.equal((await finish(ids[0],request,r.lease,true,'你好')).state,'succeeded');
    assert.equal((await reserve()).text,'你好');
    await finish(ids[0],request,r.lease,true,'different');
    assert.equal((await db.query('select count(*)::int as n from public.usage_records')).rows[0].n,1);
  });
  await t.test('failure restores original free/paid buckets; retry gets new lease and rejects late old settlement',async()=>{
    const req='20000000-0000-0000-0000-000000000002';
    const r=await reserve(ids[0],req);await finish(ids[0],req,r.lease,false);
    assert.deepEqual(await wallet(),{free_chars:0,paid_chars:8});
    const retry=await reserve(ids[0],req);assert.notEqual(retry.lease,r.lease);
    await assert.rejects(finish(ids[0],req,r.lease,true,'late'));
    await finish(ids[0],req,retry.lease,false);assert.deepEqual(await wallet(),{free_chars:0,paid_chars:8});
  });
  await t.test('staff uses only assigned quota and own merchant ports, never personal wallet',async()=>{
    const req='20000000-0000-0000-0000-000000000003';
    await assert.rejects(reserve(ids[2],req));
    await db.query('update public.staff_accounts set channel_allowlist=$1,char_quota=7 where id=$2',[[port],ids[2]]);
    const r=await reserve(ids[2],req);assert.equal(r.state,'execute');
    await assert.rejects(reserve(ids[2],'20000000-0000-0000-0000-000000000004'));
    const used=(await db.query('select char_used from public.staff_accounts where id=$1',[ids[2]])).rows[0].char_used;
    assert.equal(used,5);await finish(ids[2],req,r.lease,false);
    assert.equal((await db.query('select char_used from public.staff_accounts where id=$1',[ids[2]])).rows[0].char_used,0);
    await db.query("update public.staff_accounts set status='suspended' where id=$1",[ids[2]]);
    await assert.rejects(reserve(ids[2],req));
  });
  await t.test('expired holds release without model calls or usage rows; insufficient wallets fail closed',async()=>{
    const req='20000000-0000-0000-0000-000000000005',r=await reserve(ids[0],req);
    await db.query("update public.translation_jobs set expires_at=now()-interval '1 minute' where request_id=$1",[req]);
    await as('service_role','','select public.release_expired_platform_translations()');
    assert.deepEqual(await wallet(),{free_chars:0,paid_chars:8});
    assert.equal((await finish(ids[0],req,r.lease,true,'late')).state,'failed');
    await assert.rejects(reserve(ids[0],'20000000-0000-0000-0000-000000000006',9));
  });
  await t.test('initial staff quota cannot be minted by create_staff',async()=>{
    await assert.rejects(as('authenticated',ids[0],"select public.create_staff($1,'new@example.invalid','password123','{}',5000,null)",[ids[0]]));
    assert.equal((await db.query("select count(*)::int as n from auth.users where email='new@example.invalid'")).rows[0].n,0);
    const created=(await as('authenticated',ids[0],"select public.create_staff($1,'new@example.invalid','password123','{}',2,null) as v",[ids[0]])).rows[0].v;
    assert.deepEqual(await wallet(),{free_chars:0,paid_chars:6});
    assert.equal((await db.query('select char_quota from public.staff_accounts where id=$1',[created.staff_id])).rows[0].char_quota,2);
  });
  await t.test('local integration: desktop -> Edge handler -> real SQL billing -> port SQLite -> offline reload',async()=>{
    const os=require('node:os');const {TranslationCache,register}=require('../src/translation-cache');
    const {createTranslator}=require('../platform-translation');const {EventEmitter}=require('node:events');
    const {createHandler}=await import('../supabase/functions/platform-translate/core.mjs');
    let modelCalls=0;
    const sql=async(name,args)=>(await as('service_role','',`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) as v`,args)).rows[0].v;
    const handler=createHandler({authenticate:async()=>({id:ids[0]}),releaseExpired:()=>sql('release_expired_platform_translations',[]),
      reserve:v=>sql('reserve_platform_translation',[v.userId,v.requestId,v.portId,v.fingerprint,v.chars,v.language]),
      finish:v=>sql('finish_platform_translation',[v.userId,v.requestId,v.lease,v.success,v.text||null,v.provider||null]),
      translate:async()=>{modelCalls++;return{text:'你好',provider:'local-integration-fixture'};}});
    const identity={scope:'server:'+ids[0],accountIds:[port],local:false,demo:false};
    const access={current:()=>identity,can:()=>true,revision:()=>1,onChange(){},authorize:async()=>({ok:true})};
    const translator=createTranslator({access,getClient:()=>({functions:{invoke:async(_name,{body})=>{
      const reply=await handler(new Request('https://fixture.invalid',{method:'POST',headers:{authorization:'Bearer verified-test-user'},body:JSON.stringify(body)}));
      return{data:await reply.json(),error:reply.ok?null:{message:'denied'}};
    }}})});
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'haituo-service-flow-')),store=new TranslationCache(dir);
    try{
      const handlers=new Map(),event={},entry={scope:identity.scope,accountId:port,channel:'whatsapp'};
      register({ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},app:new EventEmitter(),access,store,translator,resolve:e=>e===event?entry:null});
      const value={conversationId:'123@c.us',messageId:'integration-message',question:'Hi',language:'zh-CN'};
      const call=()=>handlers.get('webchannels:translateMessage')(event,value);
      assert.equal((await call()).ok,true);assert.equal((await call()).ok,true);
      assert.equal(modelCalls,1);assert.deepEqual(await wallet(),{free_chars:0,paid_chars:4});
      store.close();
      const records=store.loadPortTranslationCache({...entry,...value});
      assert.equal(records.length,1);assert.equal(records[0].answer,'你好');
    }finally{store.close();fs.rmSync(dir,{recursive:true,force:true});}
  });
});
