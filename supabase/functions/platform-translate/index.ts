import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { createHandler, createProviderChain } from './core.mjs';

// Secrets are read only in the deployed backend, never shipped in the EXE.
const url = Deno.env.get('SUPABASE_URL')!;
const keys = Deno.env.get('SUPABASE_SECRET_KEYS');
const key = keys ? JSON.parse(keys).default : Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const admin = createClient(url,key!,{ auth:{ persistSession:false,autoRefreshToken:false } });
async function rpc(name:string,args:Record<string,unknown> = {}) {
  const {data,error} = await admin.rpc(name,args);
  if(error) throw new Error('Database operation denied');
  return data;
}
const providers = JSON.parse(Deno.env.get('HAITUO_TRANSLATION_PROVIDERS') || '[]');
let translate;
try { translate = createProviderChain(providers); }
catch { translate = async () => { throw new Error('Platform providers not configured'); }; }
Deno.serve(createHandler({
  authenticate: async (token:string) => {
    const {data,error} = await admin.auth.getUser(token);
    if(error) return null;
    return data.user;
  },
  releaseExpired: () => rpc('release_expired_platform_translations'),
  reserve: (v:any) => rpc('reserve_platform_translation',{p_user:v.userId,p_request:v.requestId,p_port:v.portId,p_fingerprint:v.fingerprint,p_chars:v.chars,p_language:v.language}),
  finish: (v:any) => rpc('finish_platform_translation',{p_user:v.userId,p_request:v.requestId,p_lease:v.lease,p_success:v.success,p_result:v.text || null,p_provider:v.provider || null}),
  translate
}));
