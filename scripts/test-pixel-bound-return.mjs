// LOCAL ONLY: a new random Unix-socket PostgreSQL fixture and NOLOGIN roles.
// No DATABASE_URL, remote API, managed login, real account or email is used.
// Signed OIDC/canary verification is tested separately by the HTTP route suite.
import assert from 'node:assert/strict';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import pg from 'pg';
import {createRuntimeLocalFixture} from './runtime-local-fixture.mjs';
import {readUpdateSnapshot} from './update-2-3-snapshot.mjs';
import {makePixelBoundReturnTransaction,splitPostgresStatements} from './pixel-bound-return-transport.mjs';

const root=resolve(import.meta.dirname,'..');
const installed=readUpdateSnapshot(resolve(root,'../../outputs/update-2-3-live-audit-20261019.json'));
const fixture=await createRuntimeLocalFixture('bound_return');
const {db,roles,roleSql,asRole}=fixture;
const hash=value=>createHash('sha256').update(value).digest('hex');
const issuer='https://pixel-pulse-websites.vercel.app/api/sso';
let checks=0;
const expect=(value,expected,label)=>{assert.deepEqual(value,expected,label);checks++;};
const rejected=async(task,pattern)=>{
  let error;try{await task();}catch(value){error=value;}
  assert.ok(error,'Expected rejection');if(pattern)assert.match(error.message,pattern);checks++;return error;
};
const call=async(name,args)=>{
  const placeholders=args.map((_,index)=>`$${index+1}`).join(',');
  return(await asRole('skyway_server_api',`select app_private.${name}(${placeholders}) as value`,args)).rows[0].value;
};
const begin=async(context={phase:'discovery',entry_mode:'bound-return'},{take=true}={})=>{
  const state=hash(randomBytes(32)),browser=hash(randomBytes(32));
  await call('pixel_attempt_begin_v2',[state,browser,randomBytes(48).toString('base64url'),randomBytes(32).toString('base64url'),context]);
  if(take)await call('pixel_attempt_take_v2',[state,browser]);
  return{state,browser,session:hash(randomBytes(32))};
};
const sign=(profile,attempt)=>call('pixel_signin_bound',[profile,attempt.session,attempt.state,attempt.browser]);
const profile=(username,email,subject=randomUUID())=>({subject,username,email,email_verified:true,profile_version:1,credential_version:1});
const allData=async({sessions=true}={})=>{
  const rows=await db.query(`select jsonb_build_object(
   'users',(select jsonb_agg(to_jsonb(x) order by id) from neon_auth."user" x),
   'accounts',(select jsonb_agg(to_jsonb(x) order by id) from neon_auth.account x),
   'native_sessions',(select jsonb_agg(to_jsonb(x) order by id) from neon_auth.session x),
   'stats',(select jsonb_agg(to_jsonb(x) order by user_id) from public.player_stats x),
   'profiles',(select jsonb_agg(to_jsonb(x) order by user_id) from public.player_profiles x),
   'inventory',(select jsonb_agg(to_jsonb(x) order by user_id,item_key) from public.player_unlocks x),
   'loadouts',(select jsonb_agg(to_jsonb(x) order by user_id) from public.player_loadouts x),
   'admins',(select jsonb_agg(to_jsonb(x) order by user_id) from public.admin_users x),
   'links',(select jsonb_agg(to_jsonb(x) order by subject) from app_private.pixel_links x),
   'discoveries',(select jsonb_agg(to_jsonb(x) order by token_hash) from app_private.pixel_discoveries x),
   'proofs',(select jsonb_agg(to_jsonb(x) order by proof_jti) from app_private.pixel_first_link_receipts x),
   'sessions',case when $1 then(select jsonb_agg(to_jsonb(x) order by token_hash) from app_private.pixel_sessions x)else null end
  )as value`,[sessions]);return rows.rows[0].value;
};
const boundaries=async()=> (await db.query(`select p.oid,p.oid::regprocedure::text as signature,p.proowner,p.prosecdef,
 p.proconfig,p.proacl::text,p.provolatile,p.proisstrict,p.proretset from pg_proc p
 where p.pronamespace in('app_private'::regnamespace,'auth'::regnamespace) order by p.oid`)).rows;
const definitions=async()=> (await db.query(`select p.oid::regprocedure::text as signature,md5(p.prosrc)as source
 from pg_proc p where p.pronamespace in('app_private'::regnamespace,'auth'::regnamespace) order by p.oid`)).rows;
const wrapperNames=new Set(['app_private.pixel_signin_bound(jsonb,text,text,text)','app_private.pixel_discovery_save(text,jsonb,text,text)']);
const transaction=async statements=>{
  await db.query('begin');let last;
  try{for(const statement of statements)last=await db.query(statement);await db.query('commit');return last;}
  catch(error){await db.query('rollback');throw error;}
};
try{
  const quoted=String.raw`-- leading ; comment
select ';' as "semi;column"; /* outer; /* nested; */ still comment; */
do $body$begin perform ';'; perform $$different;tag$$; end$body$;
select E'it\'s;safe'; select $$plain;body$$; -- trailing ;
`;
  expect(splitPostgresStatements(quoted).length,4,'Splitter retains semicolons inside strings, tagged bodies, identifiers and nested comments');
  expect(splitPostgresStatements('; -- only a comment;\n').length,0,'Empty/comment-only statements are omitted');
  for(const invalid of["select 'unfinished",'select "unfinished','do $body$unfinished','select 1; /* unfinished']){
    assert.throws(()=>splitPostgresStatements(invalid),/Unterminated SQL/);checks++;
  }
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
    const fn=installed.functions.find(item=>item.name===name);assert.ok(fn,`Missing saved installed function ${name}`);
    await db.query(fn.definition);
    await db.query(`revoke all on function ${fn.qualified_signature} from public`);
    if(name.startsWith('pixel_'))await db.query(`grant execute on function ${fn.qualified_signature} to "${roles.skyway_server_api}"`);
  }
  await db.query(`create trigger fixture_starters after insert on neon_auth."user" for each row execute function public.provision_player_starters();
   create trigger fixture_auth_guard before update on neon_auth."user" for each row execute function app_private.enforce_pixel_auth_profile();
   create trigger fixture_name_guard before insert or update on public.player_profiles for each row execute function app_private.enforce_pixel_username();`);
  await db.query(roleSql(readFileSync(resolve(root,'neon/pixel-pulse-03-link-security.sql'),'utf8')));
  const first=profile('first_runner','first@example.invalid'),second=profile('second_runner','second@example.invalid');
  const users=[randomUUID(),randomUUID()];
  for(const[index,identity]of[first,second].entries()){
    await db.query(`insert into neon_auth."user"(id,name,email,"emailVerified")values($1,$2,$3,true)`,[users[index],identity.username,identity.email]);
    await db.query(`insert into neon_auth.account("accountId","providerId","userId",password)values($1::text,'credential',$1::uuid,'owned-local-fixture-hash')`,[users[index]]);
    await db.query(`insert into neon_auth.session(id,"userId","expiresAt")values($1,$2,clock_timestamp()+interval '1 day')`,[randomUUID(),users[index]]);
    await db.query(`insert into public.player_profiles(user_id,username)values($1,$2)`,[users[index],identity.username]);
    await db.query(`update public.player_stats set total_gems=$2,high_score=$3,level=7,xp_in_level=31 where user_id=$1`,[users[index],100+index,12345+index]);
    await db.query(`insert into public.admin_users(user_id,role,email)values($1,$2,$3)`,[users[index],index?'co_admin':'main_admin',identity.email]);
    await db.query(`insert into app_private.pixel_links(issuer,subject,user_id,username,email,email_verified,profile_version,credential_version)values($1,$2,$3,$4,$5,true,1,1)`,[issuer,identity.subject,users[index],identity.username,identity.email]);
  }
  const patch=roleSql(readFileSync(resolve(root,'neon/pixel-pulse-05-bound-return.sql'),'utf8'));
  const payload=makePixelBoundReturnTransaction(patch);
  expect(payload.source_sha256,hash(patch),'Transport identifies the exact unmodified source');
  expect(payload.sql_statements.length,11,'Tool payload uses eleven individually executable statements');
  expect(payload.sql_statements.some(statement=>/^(begin|commit)\b/i.test(statement)),false,'Transaction-tool payload excludes outer BEGIN/COMMIT');
  assert.throws(()=>makePixelBoundReturnTransaction(patch.replace('begin;','begin;begin;')),/seven-statement|transaction control/);checks++;
  await db.query('create table public.fixture_fingerprint(id integer,value text);insert into public.fixture_fingerprint values(1,null),(1,null),(2,\'semi;--$$\')');
  const beforeData=await allData(),beforeBoundary=await boundaries(),beforeDefinitions=await definitions();
  const preservation=(await transaction(payload.sql_statements)).rows[0].preservation;
  expect(preservation.protected_data_preserved,true,'Atomic individual-statement transport proves row preservation');
  assert.ok(preservation.protected_tables>0&&preservation.protected_rows>0);checks++;
  expect((await db.query("select to_regclass('pg_temp.skyway_pixel_return_preserve')as present")).rows[0].present,null,'Temporary fingerprints are removed on transaction commit');
  expect(await allData(),beforeData,'Patch preserves all native/game/link/session rows');
  expect(await boundaries(),beforeBoundary,'All function OIDs, owners, modes, ACLs and configuration remain unchanged');
  const changed=(await definitions()).filter((item,index)=>item.source!==beforeDefinitions[index].source).map(item=>item.signature);
  expect(new Set(changed),wrapperNames,'Only the two owned wrapper bodies change');
  const afterDefinitions=await definitions();await transaction(payload.sql_statements);
  expect(await definitions(),afterDefinitions,'Patch is safely reapplicable');
  expect(await allData(),beforeData,'Reapplication preserves rows');
  const mutated=[...payload.sql_statements.slice(0,-2),
    'create function app_private.fixture_transport_rollback()returns integer language sql as $$select 1$$',
    'update public.player_stats set total_gems=total_gems+1',...payload.sql_statements.slice(-2)];
  await rejected(()=>transaction(mutated),/Protected rows changed: public.player_stats/);
  expect(await allData(),beforeData,'A row digest mismatch rolls back every protected write');
  expect((await db.query("select to_regprocedure('app_private.fixture_transport_rollback()')as present")).rows[0].present,null,'A preservation failure rolls back DDL in the same transaction');
  expect(await definitions(),afterDefinitions,'A failed transport leaves exact function source intact');
  const sameCountDrift=[...payload.sql_statements.slice(0,-2),
    "update public.fixture_fingerprint set value='changed'where id=1",...payload.sql_statements.slice(-2)];
  await rejected(()=>transaction(sameCountDrift),/Protected rows changed: public.fixture_fingerprint/);
  expect((await db.query('select count(*)::int as n from public.fixture_fingerprint where id=1 and value is null')).rows[0].n,2,'Fingerprint detects same-count changes with duplicate/null rows and rolls them back');
  const inventoryDrift=[...payload.sql_statements.slice(0,-2),
    'create table public.fixture_unexpected_table(id integer)',...payload.sql_statements.slice(-2)];
  await rejected(()=>transaction(inventoryDrift),/Protected table inventory changed/);
  expect((await db.query("select to_regclass('public.fixture_unexpected_table')as present")).rows[0].present,null,'Unexpected table inventory changes roll back');
  const savedWrapper=(await db.query("select pg_get_functiondef('app_private.pixel_signin_bound(jsonb,text,text,text)'::regprocedure)as definition")).rows[0].definition;
  await db.query(savedWrapper.replace('AS $function$','AS $function$\n-- owned fixture source drift'));
  await rejected(()=>db.query(patch),/Unreviewed bound-return wrapper/);await db.query('rollback');
  await db.query(savedWrapper);
  expect(await definitions(),afterDefinitions,'Unreviewed wrapper source fails closed before replacement');
  await db.query(`grant execute on function app_private.pixel_signin_bound(jsonb,text)to "${roles.skyway_server_api}"`);
  await rejected(()=>db.query(patch),/inner bound-signin helper must remain private/);await db.query('rollback');
  await db.query(`revoke all on function app_private.pixel_signin_bound(jsonb,text)from "${roles.skyway_server_api}"`);
  expect(await allData(),beforeData,'A widened inner-helper boundary refuses installation without data writes');
  expect(await boundaries(),beforeBoundary,'Owned drift fixtures restore the exact original privilege boundary');

  const unknown=profile('unknown_runner',first.email);
  const unknownAttempt=await begin();const beforeUnknown=await allData();
  expect(await sign(unknown,unknownAttempt),null,'Unknown bound-return never adopts even an existing verified email');
  expect(await allData(),beforeUnknown,'Unknown return does not mutate native/profile/account/session/discovery/proof rows');
  expect((await db.query('select completed_at is not null as done from app_private.pixel_attempts_v3 where state_hash=$1',[unknownAttempt.state])).rows[0].done,true,'Unknown bound-only attempt is terminal');
  await rejected(()=>sign(unknown,unknownAttempt),/cancelled, completed or expired/);
  await rejected(()=>call('pixel_discovery_save',[hash('unknown-discovery'),unknown,unknownAttempt.state,unknownAttempt.browser]),/cancelled, completed or expired/);
  const earlyDiscovery=await begin();
  await rejected(()=>call('pixel_discovery_save',[hash('early-discovery'),unknown,earlyDiscovery.state,earlyDiscovery.browser]),/cannot create an account connection/);
  expect(await allData(),beforeUnknown,'Even direct discovery fallback from a bound-only attempt changes no account data');

  const original=await allData({sessions:false}),known=await begin();
  expect((await sign(first,known)).user_id,users[0],'Known bound return uses the original game UUID without a native/canary dependency');
  expect(await allData({sessions:false}),original,'Known return preserves stats, inventory, roles, native hashes and identity rows');
  const saved=await call('pixel_session_get',[known.session]);
  expect(saved.subject,first.subject,'Returned session is bound to the signed immutable subject');
  expect(saved.credential_version,1,'Returned session retains the current credential epoch');
  assert.ok(new Date(saved.runtime_lease_until)>new Date()&&new Date(saved.runtime_lease_until)<=new Date(Date.now()+31000));checks++;
  await rejected(()=>sign(first,known),/cancelled, completed or expired/);
  await rejected(()=>call('pixel_attempt_take_v2',[known.state,known.browser]),/expired or was already used/);

  const canaryContext={phase:'discovery',canary_native_user_id:users[0],canary_jti:randomUUID()};
  const matching=await begin(canaryContext);
  expect((await sign(first,matching)).user_id,users[0],'Matching canary target can return only its own original game UUID');
  const mismatch=await begin(canaryContext),beforeMismatch=await allData();
  await rejected(()=>sign({...second,profile_version:2,username:'must_not_sync'},mismatch),/another Skyway account/);
  expect(await allData(),beforeMismatch,'Mismatched canary is refused before profile sync or session mint');
  expect(await call('pixel_session_get',[mismatch.session]),null,'Mismatched canary creates no hidden session');
  for(const badContext of[
    {phase:'discovery',canary_native_user_id:'not-a-uuid',canary_jti:randomUUID()},
    {phase:'discovery',canary_native_user_id:null,canary_jti:randomUUID()},
    {phase:'discovery',canary_native_user_id:users[0]},
    {phase:'discovery',canary_jti:randomUUID()},
    {phase:'discovery',canary_native_user_id:users[0],canary_jti:'not-a-uuid'},
  ]){
    const bad=await begin(badContext),before=await allData();
    await rejected(()=>sign(first,bad),/Invalid restricted sign-in target/);
    expect(await allData(),before,'Malformed/incomplete canary target cannot sync or mint');
  }
  for(const invalidContext of[
    {phase:'discovery',entry_mode:'other'},
    {phase:'discovery',entry_mode:null},
    {phase:'discovery',entry_mode:true},
    {phase:'discovery',entry_mode:'bound-return',target_mode:'create'},
    {...canaryContext,entry_mode:'bound-return'},
  ]){
    const bad=await begin(invalidContext),before=await allData();
    await rejected(()=>sign(first,bad),/Invalid owned bound-return attempt/);
    expect(await allData(),before,'Mixed/injected bound-return context cannot enter linking or another target');
  }
  // Original unknown discovery remains available only to its separately gated
  // route. It is not silently converted into a binding by the SQL wrapper.
  const ordinary=await begin({phase:'discovery'}),beforeOrdinary=await allData();
  expect(await sign(unknown,ordinary),null,'Ordinary unknown sign-in still cannot adopt by email');
  expect(await allData(),beforeOrdinary,'Unknown ordinary sign-in creates no account or session');
  await call('pixel_discovery_save',[hash('allowed-discovery'),unknown,ordinary.state,ordinary.browser]);
  expect((await call('pixel_discovery_get',[hash('allowed-discovery')])).subject,unknown.subject,'Only ordinary discovery retains the existing fallback');

  const cancelled=await begin(),beforeCancel=await allData();
  await call('pixel_attempt_cancel',[cancelled.browser]);
  await rejected(()=>sign(first,cancelled),/cancelled, completed or expired/);
  expect(await allData(),beforeCancel,'Cancel before return mint preserves account/session data');
  const completed=await begin();await sign(first,completed);
  await call('pixel_attempt_cancel',[completed.browser]);
  expect(await call('pixel_session_get',[completed.session]),null,'Cancel after completed return removes that attempt session');
  await rejected(()=>sign(first,completed),/cancelled, completed or expired/);
  const expired=await begin();
  await db.query("update app_private.pixel_attempts_v3 set expires_at=clock_timestamp()-interval '1 second' where state_hash=$1",[expired.state]);
  await rejected(()=>sign(first,expired),/cancelled, completed or expired/);

  const higher=await begin();
  await rejected(()=>sign({...first,credential_version:2},higher),/committed current-credential check/);
  await call('pixel_retire_credentials',[first.subject,2]);
  expect(await call('pixel_session_get',[known.session]),null,'Separately committed credential change retires old return sessions');
  const stale=await begin();await rejected(()=>sign(first,stale),/older than the saved version/);
  const current=await begin();
  expect((await sign({...first,credential_version:2},current)).user_id,users[0],'Current epoch can return without reviving stale sessions');
  expect(await call('pixel_session_confirm_lease',[current.session,first.subject,2,new Date(Date.now()+30000)]).then(value=>value.user_id),users[0],'Existing current-epoch lease renewal remains intact');

  // Actual concurrent LOCAL transactions prove the persisted binding stays
  // locked across the canary comparison and the inner session INSERT. The
  // second connection only requests a row lock; it never changes ownership.
  const lockKey=randomBytes(4).readUInt32BE()&0x7fffffff;
  await db.query(`create function app_private.fixture_pause_bound_mint()returns trigger language plpgsql security definer set search_path='' as $$
   begin if current_setting('fixture.pause_bound_mint',true)='on' then perform pg_advisory_xact_lock(20261024,${lockKey});end if;return new;end$$;
   revoke all on function app_private.fixture_pause_bound_mint()from public;
   create trigger fixture_pause_bound before insert on app_private.pixel_sessions for each row execute function app_private.fixture_pause_bound_mint();`);
  const localOptions={host:'/tmp',port:5432,user:'junfeng',database:fixture.database};
  const minter=new pg.Client(localOptions),waiter=new pg.Client(localOptions);
  let minting,locking,held=false;
  try{
    await minter.connect();await waiter.connect();
    const mainPid=(await db.query('select pg_backend_pid()as pid')).rows[0].pid;
    const mintPid=(await minter.query('select pg_backend_pid()as pid')).rows[0].pid;
    const waitPid=(await waiter.query('select pg_backend_pid()as pid')).rows[0].pid;
    const attempt=await begin({...canaryContext}),identity={...first,credential_version:2};
    await db.query('select pg_advisory_lock(20261024,$1)',[lockKey]);held=true;
    await minter.query("select set_config('fixture.pause_bound_mint','on',false)");
    await minter.query(`set role "${roles.skyway_server_api}"`);
    minting=minter.query('select app_private.pixel_signin_bound($1::jsonb,$2::text,$3::text,$4::text)as value',[identity,attempt.session,attempt.state,attempt.browser]);
    void minting.catch(()=>{});
    const blockedBy=async(pid,blocker)=>{
      const deadline=Date.now()+3000;
      while(Date.now()<deadline){
        if((await db.query('select $2::integer=any(pg_blocking_pids($1::integer))as waiting',[pid,blocker])).rows[0].waiting)return true;
        await new Promise(resolve=>setTimeout(resolve,20));
      }return false;
    };
    expect(await blockedBy(mintPid,mainPid),true,'Minter pauses inside the INSERT after validating the canary target');
    locking=waiter.query('select user_id from app_private.pixel_links where issuer=$1 and subject=$2 for update',[issuer,first.subject]);
    void locking.catch(()=>{});
    expect(await blockedBy(waitPid,mintPid),true,'Persisted binding cannot change between canary comparison and session mint');
    await db.query('select pg_advisory_unlock(20261024,$1)',[lockKey]);held=false;
    expect((await minting).rows[0].value.user_id,users[0],'Matching canary completes with the same locked game UUID');
    expect((await locking).rows[0].user_id,users[0],'Waiting observer sees unchanged original binding');
  }finally{
    if(held)await db.query('select pg_advisory_unlock(20261024,$1)',[lockKey]);
    if(minting)await minting.catch(()=>{});if(locking)await locking.catch(()=>{});
    await minter.end();await waiter.end();
    await db.query('drop trigger fixture_pause_bound on app_private.pixel_sessions;drop function app_private.fixture_pause_bound_mint()');
  }

  for(const role of['authenticated','anon','anonymous']){
    expect((await db.query('select has_schema_privilege($1,\'app_private\',\'USAGE\')as allowed',[roles[role]])).rows[0].allowed,false,`${role} gains no private-schema access`);
    expect((await db.query(`select count(*)::int as n from pg_proc p where p.pronamespace='app_private'::regnamespace and has_function_privilege($1,p.oid,'EXECUTE')`,[roles[role]])).rows[0].n,0,`${role} gains no private helper execute`);
    const denied=await rejected(()=>asRole(role,'select app_private.pixel_signin_bound($1::jsonb,$2::text,$3::text,$4::text)',[first,hash('forbidden'),known.state,known.browser]));
    expect(denied.code,'42501',`${role} cannot call the owned return wrapper`);
  }
  const inner=await rejected(()=>asRole('skyway_server_api','select app_private.pixel_signin_bound($1::jsonb,$2::text)',[first,hash('inner-forbidden')]));
  expect(inner.code,'42501','Server API still cannot bypass the wrapper through the two-argument mint helper');
  const innerDiscovery=await rejected(()=>asRole('skyway_server_api','select app_private.pixel_discovery_save($1::text,$2::jsonb)',[hash('inner-discovery'),unknown]));
  expect(innerDiscovery.code,'42501','Server API cannot bypass the bound-only discovery guard');
  expect(await boundaries(),beforeBoundary,'All private helper boundaries remain identical after positive and negative cases');
  console.log(`${checks} local bound-return SQL assertions passed; no remote database, real accounts, auth flow or mail used.`);
}finally{await fixture.close();}
