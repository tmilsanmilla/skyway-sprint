// Explicitly approved gateway-only reconnect. Never delete Auth, a branch, or a database.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {Pool} from 'pg';
assert.ok(process.argv.includes('--reconnect-approved'),'Run only after explicit gateway-reconnect approval, with --reconnect-approved');
const project='odd-unit-44587143',branch='br-holy-math-axs9gjmb',origin='https://skyway-sprint.vercel.app';
const endpoint=`/projects/${project}/branches/${branch}/data-api/neondb`;
const {access_token}=JSON.parse(readFileSync('/Users/lucas/.config/neon/credentials.json','utf8'));
async function api(path,method='GET',body){
 for(let attempt=0;attempt<10;attempt++){
  const response=await fetch('https://console.neon.tech/api/v2'+path,{method,headers:{Authorization:'Bearer '+access_token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  const text=await response.text(),value=text?JSON.parse(text):{};
  if([423,503].includes(response.status)&&attempt<9){await new Promise(resolve=>setTimeout(resolve,2000));continue;}
  if(!response.ok)throw new Error(`Gateway API failed (${response.status}): ${value.message||value.error||'unknown'}`);return value;
 }
}
const current=await api(endpoint),auth=await api(`/projects/${project}/branches/${branch}/auth`);
assert.equal((await(await fetch(origin+'/api/pixel-pulse/status')).json()).enabled,false,'Never reconnect with the public Pixel flow enabled');
assert.equal(current.url,'https://ep-tiny-tooth-ax0800jo.apirest.c-4.us-east-2.aws.neon.tech/neondb/rest/v1');
const keys=await fetch(origin+'/api/pixel-pulse/database-keys');assert.equal(keys.status,200);assert.ok((await keys.json()).keys.length>=2);
const {uri}=await api(`/projects/${project}/connection_uri?${new URLSearchParams({branch_id:branch,database_name:'neondb',role_name:'neondb_owner'})}`);
const pool=new Pool({connectionString:uri,max:1});
async function snapshot(){
 const data={};
 for(const table of ['neon_auth."user"','neon_auth.account','public.player_stats','public.player_profiles','public.player_unlocks','public.admin_users']){
  data[table]=(await pool.query(`select count(*)::int as count,md5(coalesce(string_agg(to_jsonb(t)::text,'|' order by to_jsonb(t)::text),'empty')) as hash from ${table} t`)).rows[0];
 }
 data.access=(await pool.query(`select md5(string_agg(v,'|' order by v)) as hash from (
  select 'table:'||n.nspname||'.'||c.relname||':'||coalesce(c.relacl::text,'')||':'||c.relrowsecurity::text||':'||c.relforcerowsecurity::text as v from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','app_private','auth','neon_auth') and c.relkind in('r','p')
  union all select 'function:'||p.oid::regprocedure::text||':'||coalesce(p.proacl::text,'')||':'||p.prosecdef::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','app_private','auth')
  union all select 'policy:'||to_jsonb(p)::text from pg_policies p where schemaname in('public','app_private','neon_auth')
 ) s`)).rows[0];return data;
}
let removed=false;
try{
 assert.equal((await pool.query("select current_setting('neon.branch_id') as branch")).rows[0].branch,branch);
 assert.equal((await pool.query('select count(*)::int as n from app_private.pixel_links')).rows[0].n,0,'Existing linked accounts require a separately planned maintenance procedure');
 const before=await snapshot();console.log(JSON.stringify({preflight:true,accounts:before['neon_auth."user"'].count,publicKeysReady:true,rollbackPrepared:true}));
 await api(endpoint,'DELETE');removed=true;
 await api(endpoint,'POST',{auth_provider:'external',jwks_url:origin+'/api/pixel-pulse/database-keys',provider_name:'skyway-sprint-neon-pixel-pulse',jwt_audience:new URL(auth.base_url).origin,skip_auth_schema:true,add_default_grants:false,settings:current.settings});
 const after=await api(endpoint);assert.equal(after.url,current.url);assert.deepEqual(after.settings,current.settings);
 assert.equal((await api(`/projects/${project}/branches/${branch}/auth`)).base_url,auth.base_url);
 assert.deepEqual(await snapshot(),before,'Protected account data or existing permissions changed');
 const result=execFileSync(process.execPath,['scripts/test-pixel-live.mjs'],{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:90000});
 console.log(result.trim());console.log(JSON.stringify({reconnected:true,accountsAndInventoryUnchanged:true,managedAuthPreserved:true,permissionsUnchanged:true}));
}catch(error){
 if(removed){
  console.log('Restoring the original managed gateway after failed verification.');
  await api(endpoint,'DELETE').catch(failure=>{if(!String(failure.message).includes('(404)'))throw failure;});
  await api(endpoint,'POST',{auth_provider:'neon_auth',skip_auth_schema:true,add_default_grants:false,settings:current.settings});
  assert.deepEqual((await api(endpoint)).settings,current.settings);
  console.log(JSON.stringify({originalGatewayRestored:true,pixelStillDisabled:true}));
 }
 throw error;
}finally{await pool.end();}
