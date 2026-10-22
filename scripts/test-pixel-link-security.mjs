// LOCAL fixture, not a managed Neon/HTTP/signature proof. Current installed
// app function bodies are imported into a NEW empty local test database.
// All managed account/session rows below are synthetic, no mail is sent.
import assert from 'node:assert/strict';
import { createHash,randomBytes,randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';
import { createRuntimeLocalFixture } from './runtime-local-fixture.mjs';
import { readUpdateSnapshot } from './update-2-3-snapshot.mjs';

const root=resolve(import.meta.dirname,'..');
const installed=readUpdateSnapshot(resolve(root,'../../outputs/update-2-3-live-audit-20261019.json'));
const fixture=await createRuntimeLocalFixture('link_fixture');
const {db,roles,roleSql,asRole}=fixture;
let checks=0;
const expect=(value,expected,label)=>{assert.deepEqual(value,expected,label);checks++;};
const hash=value=>createHash('sha256').update(value).digest('hex');
const call=async(name,args)=>{
  const placeholders=args.map((_,i)=>`$${i+1}`).join(',');
  return (await asRole('skyway_server_api',`select app_private.${name}(${placeholders}) as value`,args)).rows[0].value;
};
const rejected=async(task,pattern)=>{let error;try{await task();}catch(e){error=e;}
  assert.ok(error,'Expected rejection');if(pattern)assert.match(error.message,pattern);checks++;return error;};
const profile=(name,email,subject=randomUUID())=>({subject,username:name,email,email_verified:true,profile_version:1,credential_version:1});
const beginDiscovery=async(p,{save=true}={})=>{
  const state=randomBytes(32).toString('base64url'),browser=hash(randomBytes(32));
  const verifier=randomBytes(48).toString('base64url'),nonce=randomBytes(32).toString('base64url');
  await call('pixel_attempt_begin_v2',[hash(state),browser,verifier,nonce,{phase:'discovery'}]);
  await call('pixel_attempt_take_v2',[hash(state),browser]);
  const discovery=hash(randomBytes(32));
  if(save)await call('pixel_discovery_save',[discovery,p,hash(state),browser]);
  return {discovery,state_hash:hash(state),browser_hash:browser};
};
const signin=async(p,sessionHash=hash(randomBytes(32)))=>{
  const a=await beginDiscovery(p,{save:false});
  return call('pixel_signin_bound',[p,sessionHash,a.state_hash,a.browser_hash]);
};
const begin=async(p,{mode='create',user=null,session=null,changes={},take=true,verified=true}={})=>{
  const {discovery}=await beginDiscovery(p),state=randomBytes(32).toString('base64url'),browser=hash(randomBytes(32));
  const verifier=randomBytes(48).toString('base64url'),nonce=randomBytes(32).toString('base64url');
  const ctx={phase:'link',discovery_hash:discovery,target_mode:mode,
    expected:{subject:p.subject,profile_version:p.profile_version,credential_version:p.credential_version},
    flow:{client_id:'skyway-sprint',redirect_uri:'https://skyway-sprint.vercel.app/api/pixel-pulse/callback',
      pixel_intent:'link',code_challenge_method:'S256',nonce,response_type:'code',scope:'openid profile email',state,
      code_challenge:createHash('sha256').update(verifier).digest('base64url')},
    ...(user?{native_user_id:user,native_session_id:session}:{}),...changes};
  await call('pixel_attempt_begin_v2',[hash(state),browser,verifier,nonce,ctx]);
  // Synthetic managed-password success is represented ONLY by the trusted
  // helper call. A fresh native/OAuth-like session cannot set its DB mark.
  if(mode==='link'&&verified)await call('pixel_attempt_confirm_native_password',[hash(state),browser,user]);
  if(take)await call('pixel_attempt_take_v2',[hash(state),browser]);
  const now=Math.floor(Date.now()/1000);
  return {state_hash:hash(state),browser_hash:browser,profile:p,session_hash:hash(randomBytes(32)),
    proof_jti:randomUUID(),proof_auth_time:now,proof_exp:now+85};
};
try {
  await db.query(roleSql(`
create schema neon_auth;create schema app_private;create schema auth;
revoke all on schema app_private from public;grant usage on schema app_private to skyway_server_api;
create function auth.uid()returns uuid language sql stable as $$select nullif(current_setting('fixture.uid',true),'')::uuid$$;
create table neon_auth."user"(id uuid primary key default gen_random_uuid(),name text not null,email text not null unique,"emailVerified" boolean not null default false,
 "createdAt" timestamptz not null default clock_timestamp(),"updatedAt" timestamptz not null default clock_timestamp(),banned boolean default false,"banExpires" timestamptz);
create table neon_auth.account(id uuid primary key default gen_random_uuid(),"accountId" text not null,"providerId" text not null,"userId" uuid not null references neon_auth."user",password text,
 "createdAt" timestamptz not null default clock_timestamp(),"updatedAt" timestamptz not null default clock_timestamp());
create table neon_auth.session(id text primary key,"userId" uuid not null references neon_auth."user","createdAt" timestamptz not null default clock_timestamp(),"expiresAt" timestamptz not null);
create table app_private.pixel_links(issuer text not null,subject uuid not null,user_id uuid not null unique references neon_auth."user",username text not null unique,email text not null,email_verified boolean not null,
 linked_at timestamptz default clock_timestamp(),profile_version bigint not null default 0,credential_version bigint not null default 0,primary key(issuer,subject));
create table app_private.pixel_sessions(token_hash text primary key,issuer text,subject uuid,created_at timestamptz default clock_timestamp(),expires_at timestamptz,credential_version bigint not null default 0);
alter table app_private.pixel_links enable row level security;alter table app_private.pixel_sessions enable row level security;
create table public.player_stats(user_id uuid primary key references neon_auth."user",total_gems bigint not null default 0,high_score bigint not null default 0,updated_at timestamptz default now(),
 level integer not null default 0,xp_in_level bigint not null default 0,lifetime_xp bigint not null default 0);
create table public.player_unlocks(user_id uuid references neon_auth."user",item_key text,item_type text,rarity text,unlocked_at timestamptz not null default now(),primary key(user_id,item_key));
create table public.player_loadouts(user_id uuid primary key references neon_auth."user",class_key text,character_key text,updated_at timestamptz default now());
create table public.player_profiles(user_id uuid primary key references neon_auth."user",username text not null unique,username_changed_at timestamptz not null default now(),created_at timestamptz not null default now());
create table public.admin_users(user_id uuid primary key references neon_auth."user",role text,email text);
create table public.username_blocklist(term text primary key);
`));
  for(const name of ['provision_player_starters','enforce_pixel_auth_profile','enforce_pixel_username','pixel_retire_credentials','pixel_sync_identity','pixel_session_get','pixel_bind_account_v2','pixel_bind_account','pixel_management_bind']){
    const fn=installed.functions.find(f=>f.name===name);assert.ok(fn,`Missing installed function ${name}`);
    await db.query(fn.definition);
    await db.query(`revoke all on function ${fn.qualified_signature} from public`);
    if(name.startsWith('pixel_'))await db.query(`grant execute on function ${fn.qualified_signature} to "${roles.skyway_server_api}"`);
  }
  await db.query(`create trigger fixture_starters after insert on neon_auth."user" for each row execute function public.provision_player_starters();
   create trigger fixture_auth_guard before update on neon_auth."user" for each row execute function app_private.enforce_pixel_auth_profile();
   create trigger fixture_name_guard before insert or update on public.player_profiles for each row execute function app_private.enforce_pixel_username();`);
  const native=randomUUID(),nativeSession=randomUUID();
  await db.query(`insert into neon_auth."user"(id,name,email,"emailVerified")values($1,'original','owned@example.invalid',true)`,[native]);
  await db.query(`insert into neon_auth.account("accountId","providerId","userId",password)values($1::text,'credential',$1::uuid,'fixture-only-preserved-native-hash')`,[native]);
  await db.query(`insert into neon_auth.session(id,"userId","expiresAt")values($1,$2,clock_timestamp()+interval '1 day')`,[nativeSession,native]);
  await db.query(`insert into public.player_profiles(user_id,username)values($1,'original')`,[native]);
  await db.query(`insert into public.admin_users(user_id,role,email)values($1,'main_admin','owned@example.invalid')`,[native]);
  await db.query(`update public.player_stats set total_gems=347,high_score=12345,level=9,xp_in_level=77,lifetime_xp=4321 where user_id=$1`,[native]);
  await db.query(`insert into public.player_unlocks values($1,'rare_owned','character','rare',now())`,[native]);
  const protectedNative=async()=>{
    const r=await db.query(`select jsonb_build_object('stats',(select to_jsonb(s) from public.player_stats s where user_id=$1),
     'inventory',(select jsonb_agg(to_jsonb(i) order by item_key) from public.player_unlocks i where user_id=$1),
     'loadout',(select to_jsonb(l) from public.player_loadouts l where user_id=$1),
     'role',(select to_jsonb(a) from public.admin_users a where user_id=$1),
     'password',(select jsonb_agg(jsonb_build_object('id',id,'userId',"userId",'password',password) order by id) from neon_auth.account where "userId"=$1 and "providerId"='credential')) as value`,[native]);return r.rows[0].value;
  };
  const before=await protectedNative();
  const patch=roleSql(readFileSync(resolve(root,'neon/pixel-pulse-03-link-security.sql'),'utf8'));
  await db.query(patch);await db.query(patch);
  expect(await protectedNative(),before,'Install/reapply preserve native progress, role, inventory and password');
  const legacy='select app_private.pixel_bind_account_v2($1::uuid,$2::text,$3::text,true,$4::uuid,$5::text,$6::text,1::bigint,1::bigint,false)';
  const denied=await rejected(()=>asRole('skyway_server_api',legacy,[randomUUID(),'ignored','other@example.invalid',native,hash('legacy'),'link']));
  expect(denied.code,'42501','Typed legacy binder is no longer callable by server API');
  await rejected(()=>call('pixel_management_bind',[randomUUID(),'other','other@example.invalid',true,1,1,'link',native,hash('old')]),/fresh confirmed/);
  const pending=profile('canonical','owned@example.invalid');
  expect(await signin(pending,hash('not-linked')),null,'Ordinary Continue never adopts matching email');
  await rejected(()=>begin({...pending,email_verified:false},{mode:'link',user:native,session:nativeSession}),/expired or changed/);
  await db.query('update neon_auth."user" set "emailVerified"=false where id=$1',[native]);
  await rejected(()=>begin(pending,{mode:'link',user:native,session:nativeSession}),/matching email/);
  await db.query('update neon_auth."user" set "emailVerified"=true where id=$1',[native]);
  await rejected(()=>begin(pending,{mode:'link',user:randomUUID(),session:nativeSession}),/existing Skyway/);
  await db.query('update neon_auth.session set "createdAt"=clock_timestamp()-interval \'2 minutes\' where id=$1',[nativeSession]);
  await rejected(()=>begin(pending,{mode:'link',user:native,session:nativeSession}),/existing Skyway/);
  await db.query('update neon_auth.session set "createdAt"=clock_timestamp() where id=$1',[nativeSession]);
  const unverifiedNative=await begin(pending,{mode:'link',user:native,session:nativeSession,take:false,verified:false,
    changes:{native_password_verified_at:new Date().toISOString(),password_confirmed:true}});
  await rejected(()=>call('pixel_attempt_take_v2',[unverifiedNative.state_hash,unverifiedNative.browser_hash]),/expired or was already used/);
  await rejected(()=>call('pixel_attempt_confirm_native_password',[unverifiedNative.state_hash,unverifiedNative.browser_hash,randomUUID()]),/another account/);
  await db.query('update app_private.pixel_attempts_v3 set consumed_at=clock_timestamp() where state_hash=$1',[unverifiedNative.state_hash]);
  await rejected(()=>call('pixel_bind_account_v2',[unverifiedNative]),/current Skyway password/);
  const changedDuringPassword=await begin(pending,{mode:'link',user:native,session:nativeSession,take:false,verified:false});
  await db.query(`update neon_auth.account set password='changed-during-password-fixture' where "userId"=$1`,[native]);
  await rejected(()=>call('pixel_attempt_confirm_native_password',[changedDuringPassword.state_hash,changedDuringPassword.browser_hash,native]),/changed during password/);
  await db.query(`update neon_auth.account set password='fixture-only-preserved-native-hash' where "userId"=$1`,[native]);
  const cancelledPassword=await begin(pending,{mode:'link',user:native,session:nativeSession,take:false,verified:false});
  await call('pixel_attempt_cancel',[cancelledPassword.browser_hash]);
  await rejected(()=>call('pixel_attempt_confirm_native_password',[cancelledPassword.state_hash,cancelledPassword.browser_hash,native]),/expired or was already used/);
  const nativeProof=await begin(pending,{mode:'link',user:native,session:nativeSession,take:false});
  await rejected(()=>call('pixel_attempt_confirm_native_password',[nativeProof.state_hash,nativeProof.browser_hash,native]),/already used/);
  await rejected(()=>asRole('authenticated','select app_private.pixel_attempt_confirm_native_password($1,$2,$3)',[nativeProof.state_hash,nativeProof.browser_hash,native]));
  const credentialRace=await begin(pending,{mode:'link',user:native,session:nativeSession});
  await db.query(`update neon_auth.account set password='changed-fixture-only-hash' where "userId"=$1`,[native]);
  await rejected(()=>call('pixel_bind_account_v2',[credentialRace]),/ownership proof changed/);
  await db.query(`update neon_auth.account set password='fixture-only-preserved-native-hash' where "userId"=$1`,[native]);
  const link=await begin(pending,{mode:'link',user:native,session:nativeSession});
  const result=await call('pixel_bind_account_v2',[link]);
  expect(result.user_id,native,'Existing original UUID preserved');
  expect(result.username,'canonical','Canonical username synchronized');
  expect(await protectedNative(),before,'Link preserves scores/Gems/XP/inventory/admin/native credentials');
  expect((await db.query(`select count(*)::int as n from neon_auth.account where "userId"=$1 and "providerId"='pixel-pulse' and password is null`,[native])).rows[0].n,1,'Exactly one passwordless provider association');
  await rejected(()=>call('pixel_bind_account_v2',[link]),/does not match/);
  await rejected(()=>call('pixel_attempt_take_v2',[link.state_hash,link.browser_hash]),/already used/);
  const newProfile=profile('freshstarter','fresh@example.invalid');
  const first=await begin(newProfile);
  const created=await call('pixel_bind_account_v2',[first]);
  assert.notEqual(created.user_id,native);checks++;
  expect((await db.query(`select count(*)::int as n from public.player_unlocks where user_id=$1 and item_type='character'`,[created.user_id])).rows[0].n,4,'New user has exactly four starter characters');
  expect((await db.query(`select count(*)::int as n from public.admin_users where user_id=$1`,[created.user_id])).rows[0].n,0,'Central roles are never imported');
  expect(await call('pixel_attempt_cancel',[first.browser_hash]),{cancelled:true,connection_saved:true},'Cancel after first binding reports durable saved connection');
  expect(await call('pixel_session_get',[first.session_hash]),null,'Late first-bind cookie is revoked after cancel');
  expect((await db.query(`select user_id::text from app_private.pixel_links where subject=$1`,[newProfile.subject])).rows[0].user_id,created.user_id,'Cancellation never deletes committed identity or progress');
  await rejected(()=>call('pixel_signin_bound',[pending,hash('unguarded-two-argument')]),/permission denied/);
  await rejected(()=>call('pixel_discovery_save',[hash('unguarded-discovery'),pending]),/permission denied/);
  const duplicate=await begin(profile('secondnew','second@example.invalid'));
  await rejected(()=>call('pixel_bind_account_v2',[{...duplicate,proof_jti:first.proof_jti}]),/already used/);
  const staleProof=await begin(profile('staleproof','stale@example.invalid'));
  await rejected(()=>call('pixel_bind_account_v2',[{...staleProof,proof_auth_time:Math.floor(Date.now()/1000)-91}]),/expired/);
  await rejected(()=>call('pixel_bind_account_v2',[{...staleProof,browser_hash:hash('other browser')}]),/owned connection/);
  await rejected(()=>call('pixel_bind_account_v2',[{...staleProof,profile:{...staleProof.profile,credential_version:2}}]),/confirmed identity/);
  const cancelled=await begin(profile('cancelled','cancelled@example.invalid'));
  await call('pixel_attempt_cancel',[cancelled.browser_hash]);
  await rejected(()=>call('pixel_bind_account_v2',[cancelled]),/owned connection/);
  expect((await db.query(`select count(*)::int as n from neon_auth."user" where email='cancelled@example.invalid'`)).rows[0].n,0,'Cancel after state consumption blocks callback writes');
  const collision=await begin(profile('canonical','collision@example.invalid'));
  await rejected(()=>call('pixel_bind_account_v2',[collision]),/already used/);
  expect((await db.query(`select count(*)::int as n from neon_auth."user" where email='collision@example.invalid'`)).rows[0].n,0,'Failed profile collision rolls back new identity and starters');
  const {discovery}=await beginDiscovery(profile('discover','discover@example.invalid'));
  assert.ok(await call('pixel_discovery_take',[discovery]));checks++;
  expect(await call('pixel_discovery_take',[discovery]),null,'Discovery one-use take');
  expect(await call('pixel_discovery_get',[discovery]),null,'Consumed discovery cannot be read again');
  const cancelledDiscovery=await beginDiscovery(profile('cancel_discovery','canceldiscovery@example.invalid'),{save:false});
  await call('pixel_attempt_cancel',[cancelledDiscovery.browser_hash]);
  await rejected(()=>call('pixel_discovery_save',[cancelledDiscovery.discovery,pending,cancelledDiscovery.state_hash,cancelledDiscovery.browser_hash]),/cancelled/);
  const completedDiscovery=await beginDiscovery(profile('late_discovery','latediscovery@example.invalid'));
  await call('pixel_attempt_cancel',[completedDiscovery.browser_hash]);
  expect(await call('pixel_discovery_get',[completedDiscovery.discovery]),null,'Cancel removes discovery even if its callback committed first');
  const cancelledOrdinary=await beginDiscovery(pending,{save:false});
  await call('pixel_attempt_cancel',[cancelledOrdinary.browser_hash]);
  await rejected(()=>call('pixel_signin_bound',[pending,hash('cancelled-ordinary'),cancelledOrdinary.state_hash,cancelledOrdinary.browser_hash]),/cancelled/);
  const completedOrdinary=await beginDiscovery(pending,{save:false}),lateCookie=hash('late-ordinary-cookie');
  expect((await call('pixel_signin_bound',[pending,lateCookie,completedOrdinary.state_hash,completedOrdinary.browser_hash])).user_id,native,'Ordinary callback finishes in owned attempt');
  expect(await call('pixel_attempt_cancel',[completedOrdinary.browser_hash]),{cancelled:true,connection_saved:false},'Ordinary cancel is not mislabeled as first account link');
  expect(await call('pixel_session_get',[lateCookie]),null,'Cancel revokes ordinary cookie committed before cancellation');
  await rejected(()=>call('pixel_signin_bound',[pending,hash('repeat-ordinary'),completedOrdinary.state_hash,completedOrdinary.browser_hash]),/cancelled/);
  const ordinary=await signin(pending,hash('bound-return'));
  expect(ordinary.user_id,native,'Returning bound cookie identity remains same player');
  await rejected(()=>signin({...pending,credential_version:2},hash('uncommitted-current-check')),/committed current-credential/);
  // A separate committed authoritative check retires sessions FIRST. The later
  // profile transaction intentionally fails; it must not restore retired ones.
  expect(await call('pixel_session_confirm_lease',[link.session_hash,pending.subject,2,new Date(Date.now()+30000)]),null,'Higher credential epoch retires instead of renewing');
  await rejected(()=>signin({...pending,credential_version:2,profile_version:2,username:newProfile.username},hash('collision-return')),/belongs to another/);
  expect((await db.query(`select credential_version::text from app_private.pixel_links where subject=$1`,[pending.subject])).rows[0].credential_version,'2','Earlier committed retirement survives profile failure');
  expect((await db.query(`select count(*)::int as n from app_private.pixel_sessions where subject=$1 and credential_version<2`,[pending.subject])).rows[0].n,0,'Old local cookies remain retired after profile failure');
  expect(await call('pixel_session_get',[link.session_hash]),null,'No stale cookie fallback');
  expect(await protectedNative(),before,'All existing protected native game data remains preserved after negative cases');
  // Real concurrent local transactions: stop the binder only AFTER it has
  // locked the native credential row, then prove a password update waits.
  const raceUser=randomUUID(),raceSession=randomUUID(),lockKey=randomBytes(4).readUInt32BE()&0x7fffffff;
  await db.query(`insert into neon_auth."user"(id,name,email,"emailVerified")values($1,'raceoriginal','race@example.invalid',true)`,[raceUser]);
  await db.query(`insert into neon_auth.account("accountId","providerId","userId",password)values($1::text,'credential',$1::uuid,'before-race-fixture')`,[raceUser]);
  await db.query(`insert into neon_auth.session(id,"userId","expiresAt")values($1,$2,clock_timestamp()+interval '1 day')`,[raceSession,raceUser]);
  const raceContext=await begin(profile('racecanonical','race@example.invalid'),{mode:'link',user:raceUser,session:raceSession});
  await db.query(`create function app_private.fixture_pause_native_update()returns trigger language plpgsql security definer set search_path='' as $$
   begin if current_setting('fixture.pause_bind',true)='on' then perform pg_advisory_xact_lock(20261021,${lockKey});end if;return new;end$$;
   revoke all on function app_private.fixture_pause_native_update()from public;
   create trigger fixture_pause before update on neon_auth."user" for each row execute function app_private.fixture_pause_native_update();`);
  const binder=new pg.Client({host:'/tmp',port:5432,user:'junfeng',database:fixture.database});
  const resetter=new pg.Client({host:'/tmp',port:5432,user:'junfeng',database:fixture.database});
  let binding,passwordReset,held=false;
  try{
    await binder.connect();await resetter.connect();
    const mainPid=(await db.query('select pg_backend_pid() as pid')).rows[0].pid;
    const bindPid=(await binder.query('select pg_backend_pid() as pid')).rows[0].pid;
    const resetPid=(await resetter.query('select pg_backend_pid() as pid')).rows[0].pid;
    await db.query('begin');await db.query('select pg_advisory_xact_lock(20261021,$1)',[lockKey]);held=true;
    await binder.query("select set_config('fixture.pause_bind','on',false)");
    await binder.query(`set role "${roles.skyway_server_api}"`);
    binding=binder.query('select app_private.pixel_bind_account_v2($1::jsonb) as result',[raceContext]);
    const waitBlocked=async(pid,blocker)=>{
      const deadline=Date.now()+3000;
      while(Date.now()<deadline){
        if((await db.query('select $2::integer=any(pg_blocking_pids($1::integer)) as waiting',[pid,blocker])).rows[0].waiting)return true;
        await new Promise(resolve=>setTimeout(resolve,20));
      }return false;
    };
    expect(await waitBlocked(bindPid,mainPid),true,'Binder paused after native-row ownership locks');
    passwordReset=resetter.query(`update neon_auth.account set password='after-race-fixture' where "userId"=$1`,[raceUser]);
    expect(await waitBlocked(resetPid,bindPid),true,'Concurrent password reset cannot race through the final credential stamp');
    await db.query('commit');held=false;
    expect((await binding).rows[0].result.user_id,raceUser,'Binding commits valid ownership before waiting password change');
    await passwordReset;
    expect((await db.query(`select password from neon_auth.account where "userId"=$1 and "providerId"='credential'`,[raceUser])).rows[0].password,'after-race-fixture','Native credential update runs only after binder commits');
  }finally{
    if(held)await db.query('rollback');
    if(binding)await binding.catch(()=>{});if(passwordReset)await passwordReset.catch(()=>{});
    await binder.end();await resetter.end();
  }
  await rejected(()=>asRole('authenticated','select app_private.pixel_discovery_get($1)',[discovery]));
  const missing=await db.query(`select count(*)::int as n from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app_private' and has_function_privilege($1,p.oid,'EXECUTE')`,[roles.authenticated]);
  expect(missing.rows[0].n,0,'No private helper callable by players');
  console.log(`PASS ${checks} local linking/security fixtures; synthetic managed schema only, NOT production Managed Auth or signed HTTP proof.`);
} finally {await fixture.close();}
