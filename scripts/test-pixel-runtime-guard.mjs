// LOCAL ONLY: dedicated Unix socket PostgreSQL, no remote connections, real
// credentials, managed helper changes, production accounts or outbound mail.
// auth.jwt() is an explicit fixture stub; real signature/Data API tests are a
// separate mandatory release check and are NOT claimed by this test.
import assert from 'node:assert/strict';
import { readFileSync, realpathSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join, resolve } from 'node:path';
import pg from 'pg';
import { buildRuntimeMigration, guardFunctionDefinition } from './runtime-guard-generator.mjs';

const root = realpathSync(resolve(import.meta.dirname, '..'));
const suffix=randomBytes(8).toString('hex');
const database=`skyway_pixel_runtime_fixture_${suffix}`;
const roles=Object.fromEntries(['authenticated','anon','anonymous','skyway_server_api'].map(r=>[r,`runtime_${suffix}_${r}`]));
const localOptions={host:'/tmp',port:5432,user:'junfeng'};
const fixtureSql=text=>text.replace(/\b(authenticated|anonymous|anon|skyway_server_api)\b/g,m=>roles[m])
  .replace(`claims->>'role' is distinct from '${roles.authenticated}'`,"claims->>'role' is distinct from 'authenticated'");
let admin, db, databaseCreated=false, checks = 0;
const createdRoles=[];
const nativeIssuer = 'https://native.fixture.invalid/auth';
const uid = '11111111-1111-4111-8111-111111111111';
const linked = '22222222-2222-4222-8222-222222222222';
const subject = '33333333-3333-4333-8333-333333333333';
const sid = 'a'.repeat(64);
const expect = (value, expected, name) => { assert.deepEqual(value, expected, name); checks++; };
try {
  // The existing service was verified read-only before choosing this path.
  // Only a new random database and new NOLOGIN roles are created; existing
  // databases, roles and the service process are never changed or stopped.
  admin=new pg.Client({...localOptions,database:'postgres'});await admin.connect();
  const server=(await admin.query("select current_setting('server_version') as version,inet_server_addr() is null as unix_only,rolcreatedb,rolcreaterole from pg_roles where rolname=current_user")).rows[0];
  assert.equal(server.unix_only,true);assert.match(server.version,/^17\./);
  assert.equal(server.rolcreatedb,true);assert.equal(server.rolcreaterole,true);
  for(const role of Object.values(roles)){
    assert.equal((await admin.query('select 1 from pg_roles where rolname=$1',[role])).rowCount,0);
    await admin.query(`create role "${role}" nologin`);createdRoles.push(role);
  }
  await admin.query(`create database "${database}"`);databaseCreated=true;
  db = new pg.Client({ ...localOptions, database });
  await db.connect();
  const sql = text => db.query(text);
  await sql(fixtureSql(`
create schema auth;create schema app_private;create schema neon_auth;
revoke all on schema app_private from public;
grant usage on schema app_private to skyway_server_api;
create function auth.jwt() returns jsonb language sql stable as $$select nullif(current_setting('fixture.claims',true),'')::jsonb$$;
create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;
grant usage on schema auth to authenticated;grant execute on function auth.jwt(),auth.uid() to authenticated;
create table neon_auth."user"(id uuid primary key,banned boolean default false,"banExpires" timestamptz);
create table app_private.pixel_links(issuer text,subject uuid,user_id uuid unique,credential_version bigint,primary key(issuer,subject));
create table app_private.pixel_sessions(token_hash text primary key,issuer text,subject uuid,credential_version bigint,runtime_lease_until timestamptz,expires_at timestamptz);
alter table app_private.pixel_links enable row level security;alter table app_private.pixel_sessions enable row level security;
create table public.player_stats(user_id uuid primary key,total_gems bigint);
create table public.player_reports(user_id uuid,message text);
alter table public.player_stats enable row level security;alter table public.player_reports enable row level security;
create policy own_stats on public.player_stats for select to authenticated using(user_id=auth.uid());
create policy own_reports on public.player_reports for insert to authenticated with check(user_id=auth.uid());
grant select(user_id,total_gems) on public.player_stats to authenticated;
grant insert on public.player_reports to authenticated;
insert into neon_auth."user"(id) values('${uid}'),('${linked}');
insert into public.player_stats values('${uid}',17),('${linked}',29);
insert into app_private.pixel_links values('https://pixel-pulse-websites.vercel.app/api/sso','${subject}','${linked}',1);
insert into app_private.pixel_sessions values('${sid}','https://pixel-pulse-websites.vercel.app/api/sso','${subject}',1,clock_timestamp()+interval '30 seconds',clock_timestamp()+interval '7 days');
create function public.mutate_wallet(p_delta integer default 1) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();n bigint;
begin update public.player_stats set total_gems=total_gems+p_delta where user_id=u returning total_gems into n;return jsonb_build_object('gems',n);end$$;
create function app_private.initializer_mutation() returns integer language plpgsql security definer set search_path='' as $$
begin update public.player_stats set total_gems=total_gems+1000 where user_id=auth.uid();return 1;end$$;
revoke all on function app_private.initializer_mutation() from public,authenticated,anon,anonymous;
create function public.initializer_rpc() returns integer language plpgsql security definer set search_path='' as $$
declare n integer:=app_private.initializer_mutation();begin return n;end$$;
create function public.read_wallet() returns table(user_id uuid,total_gems bigint) language sql stable security definer set search_path='' as $$select user_id,total_gems from public.player_stats where user_id=auth.uid()$$;
create function public.wallet_total() returns bigint language sql stable security definer set search_path='' as $$select total_gems from public.player_stats where user_id=auth.uid()$$;
create function public.safe_noop() returns void language plpgsql security definer set search_path='' as $$begin return;end$$;
create function public.award_completed_run_v2(p_run_id uuid,p_score bigint,p_scope text) returns jsonb language plpgsql security definer set search_path='' as $$
begin return jsonb_build_object('user_id',auth.uid(),'score',p_score,'scope',p_scope);end$$;
create function public.award_completed_run(p_run_id uuid,p_score bigint,p_scope text) returns jsonb language sql set search_path='' as $function$
  select public.award_completed_run_v2(p_run_id,p_score,p_scope);
$function$;
create function public.get_leaderboard() returns table(username text,high_score bigint) language sql stable security definer set search_path='' as $$
 select case when user_id='${uid}'::uuid then 'runner_one'::text else 'runner_two'::text end,total_gems from public.player_stats order by total_gems desc$$;
revoke all on function public.mutate_wallet(integer),public.initializer_rpc(),public.read_wallet(),public.wallet_total(),public.safe_noop(),public.award_completed_run(uuid,bigint,text),public.award_completed_run_v2(uuid,bigint,text) from public,anon,anonymous;
grant execute on function public.mutate_wallet(integer),public.initializer_rpc(),public.read_wallet(),public.wallet_total(),public.safe_noop(),public.award_completed_run(uuid,bigint,text),public.award_completed_run_v2(uuid,bigint,text) to authenticated;
revoke all on function public.get_leaderboard() from public;
grant execute on function public.get_leaderboard() to authenticated,anon,anonymous;
`));
  const metadata = (await sql(fixtureSql(readFileSync(join(root, 'neon/runtime-guard-preflight.sql'), 'utf8')))).rows[0].runtime_guard_metadata;
  for(const fn of metadata.functions) for(const role of ['authenticated','anon','anonymous']) fn[role]=fn[roles[role]];
  const candidate = buildRuntimeMigration({...metadata,database:'skyway_runtime_fixture'}, nativeIssuer, { fixture: true });
  const invokerBefore=metadata.functions.find(f=>f.name==='award_completed_run');
  expect(invokerBefore.security_definer,false,'The reviewed original run alias is SECURITY INVOKER');
  expect(candidate.manifest.find(f=>f.signature==='public.award_completed_run(uuid,bigint,text)').security_definer,false,'Generated manifest preserves the invoker flag');
  expect(candidate.manifest.find(f=>f.signature==='public.award_completed_run_v2(uuid,bigint,text)').security_definer,true,'Generated manifest preserves the definer flag');
  const guardedInvoker=guardFunctionDefinition(invokerBefore);
  assert.match(guardedInvoker.guardedSource,/public\.skyway_runtime_admitted\(\)/);checks++;
  assert.doesNotMatch(guardedInvoker.guardedSource,/app_private\./);checks++;
  assert.doesNotMatch(candidate.sql,/grant\s+(?:usage|all)[^;]*schema\s+app_private[^;]*authenticated/i);checks++;
  candidate.sql=fixtureSql(candidate.sql).replaceAll("'skyway_runtime_fixture'",`'${database}'`);
  const protectedData = async () => (await sql(`select jsonb_build_object('stats',(select jsonb_agg(to_jsonb(x) order by user_id) from public.player_stats x),'links',(select jsonb_agg(to_jsonb(x) order by user_id) from app_private.pixel_links x),'sessions',(select jsonb_agg(to_jsonb(x) order by token_hash) from app_private.pixel_sessions x),'users',(select jsonb_agg(to_jsonb(x) order by id) from neon_auth."user" x),'reports',(select jsonb_agg(to_jsonb(x)) from public.player_reports x)) as data`)).rows[0].data;
  const before = await protectedData();
  const identities = (await sql(`select oid,proname,prosecdef,proacl::text from pg_proc where pronamespace='public'::regnamespace order by oid`)).rows;
  await sql(candidate.sql);
  expect(await protectedData(), before, 'Installation preserves all fixture rows');
  expect((await sql(`select oid,proname,prosecdef,proacl::text from pg_proc where pronamespace='public'::regnamespace and proname<>'skyway_runtime_admitted' order by oid`)).rows, identities, 'Function OIDs, original security modes and ACLs remain unchanged');
  expect((await sql(`select has_schema_privilege('${roles.authenticated}','app_private','USAGE') as allowed`)).rows[0].allowed,false,'Authenticated players gain no private-schema USAGE');
  await sql(candidate.sql);
  expect(await protectedData(), before, 'Reapplication preserves all fixture rows');

  const setClaims = async claims => { await db.query("select set_config('fixture.claims',$1,false)", [JSON.stringify(claims)]); };
  const asPlayer = async (claims, query) => {
    await setClaims(claims); await sql(`set role "${roles.authenticated}"`);
    try { return await sql(query); } finally { await sql('reset role'); }
  };
  const native = id => ({ iss: nativeIssuer, sub: id, exp: Math.floor(Date.now()/1000)+120 });
  const pixel = extra => ({ iss: 'https://skyway-sprint.vercel.app/api/pixel-pulse', sub: linked,
    role: 'authenticated', skyway_auth: 'pixel', pixel_subject: subject, pixel_credential_version: 1,
    pixel_session_hash: sid, aud: ['https://skyway-sprint.vercel.app','https://native.fixture.invalid'],
    iat: Math.floor(Date.now()/1000), exp: Math.floor(Date.now()/1000)+120, ...extra });
  const allowed = async claims => (await asPlayer(claims, 'select public.skyway_runtime_admitted() as ok')).rows[0].ok;
  const deniedRpc = async (claims, query='select public.initializer_rpc()') => {
    let code; try { await asPlayer(claims, query); } catch (error) { code=error.code; }
    expect(code, '42501', `Rejected runtime RPC: ${query}`);
  };
  expect(await allowed(native(uid)), true, 'Native unlinked admitted');
  expect((await asPlayer(native(uid), 'select public.wallet_total() as n')).rows[0].n, '17', 'SQL scalar RPC works');
  expect((await asPlayer(native(uid), 'select * from public.read_wallet()')).rows, [{user_id:uid,total_gems:'17'}], 'SQL TABLE RPC works and isolates own row');
  expect((await asPlayer(native(uid), `select public.award_completed_run('${uid}',100,'endless') as result`)).rows[0].result,
    {user_id:uid,score:100,scope:'endless'},'Own unlinked native player can still call the invoker alias');
  expect((await asPlayer(native(uid), 'select user_id from public.player_stats')).rows, [{user_id:uid}], 'Direct column-granted SELECT keeps original isolation');
  expect(await allowed(native(linked)), false, 'Old or fresh native token rejected after binding');
  await deniedRpc(native(linked));
  await deniedRpc(native(linked),`select public.award_completed_run('${linked}',100,'endless')`);
  expect((await asPlayer(native(linked), 'select * from public.player_stats')).rows, [], 'RLS denies linked native direct reads');
  await deniedRpc(native(linked), `insert into public.player_reports values('${linked}','no')`);
  await setClaims({});await sql(`set role "${roles.anon}"`);
  expect((await sql('select * from public.get_leaderboard()')).rows,[{username:'runner_two',high_score:'29'},{username:'runner_one',high_score:'17'}],'Existing anonymous public leaderboard read stays available');
  let guestCode;try{await sql('select public.wallet_total()');}catch(error){guestCode=error.code;}
  expect(guestCode,'42501','Anonymous readers gain no private RPC access');await sql('reset role');
  await deniedRpc(native(linked),'select * from public.get_leaderboard()');
  expect(await protectedData(), before, 'Denied variable initializer and direct INSERT cannot mutate data');
  expect(await allowed(pixel()), true, 'Valid Pixel session admitted');
  expect((await asPlayer(pixel(), 'select public.wallet_total() as n')).rows[0].n, '29', 'Valid Pixel same UUID preserved');
  expect((await asPlayer(pixel(), 'select * from public.read_wallet()')).rows, [{user_id:linked,total_gems:'29'}], 'Valid Pixel own-row RPC');
  expect((await asPlayer(pixel(), `select public.award_completed_run('${linked}',100,'endless') as result`)).rows[0].result,
    {user_id:linked,score:100,scope:'endless'},'Fresh Pixel player can call the same invoker alias with its original UUID');
  await asPlayer(pixel(), 'select public.safe_noop()'); checks++;
  for (const [label, changes] of Object.entries({
    'wrong issuer': {iss:'https://attacker.invalid'}, 'missing marker':{skyway_auth:undefined},
    'wrong marker':{skyway_auth:'native'}, 'wrong subject':{pixel_subject:uid},
    'cross-account identity':{sub:uid}, 'old epoch':{pixel_credential_version:0},
    'future epoch':{pixel_credential_version:2}, 'fractional epoch':{pixel_credential_version:1.5},
    'string epoch':{pixel_credential_version:'1'}, 'oversized epoch':{pixel_credential_version:9007199254740992},
    'wrong session':{pixel_session_hash:'b'.repeat(64)}, 'missing session':{pixel_session_hash:undefined},
    'expired token':{exp:Math.floor(Date.now()/1000)-1}, 'long TTL':{exp:Math.floor(Date.now()/1000)+121},
    'future issue':{iat:Math.floor(Date.now()/1000)+30}, 'old issue':{iat:Math.floor(Date.now()/1000)-131},
    'missing audience':{aud:[]}, 'wrong audience type':{aud:'https://skyway-sprint.vercel.app'},
    'wrong role':{role:'admin'}, 'missing credential epoch':{pixel_credential_version:undefined},
  })) expect(await allowed(pixel(changes)), false, label);
  expect(await allowed({...native(uid),skyway_auth:'pixel'}), false, 'Native cannot claim Pixel authority');
  await sql(`update app_private.pixel_sessions set runtime_lease_until=clock_timestamp()-interval '1 second'`);
  expect(await allowed(pixel()), false, 'Expired central freshness lease');
  await deniedRpc(pixel(),'select public.mutate_wallet(9)');
  await sql(`update app_private.pixel_sessions set runtime_lease_until=clock_timestamp()+interval '40 seconds'`);
  expect(await allowed(pixel()), false, 'Overlong freshness lease fails closed');
  await sql(`update app_private.pixel_sessions set runtime_lease_until=clock_timestamp()+interval '30 seconds',expires_at=clock_timestamp()-interval '1 second'`);
  expect(await allowed(pixel()), false, 'Expired local session');
  await sql(`update app_private.pixel_sessions set expires_at=clock_timestamp()+interval '7 days';update app_private.pixel_links set credential_version=2`);
  expect(await allowed(pixel()), false, 'Credential change retires old JWT before its expiration');
  expect(await allowed(native(linked)), false, 'Central credential change cannot reenable native bypass');
  await sql(`update app_private.pixel_sessions set credential_version=2`);
  expect(await allowed(pixel({pixel_credential_version:2})), true, 'Fresh epoch accepted after authoritative refresh');
  await sql(`delete from app_private.pixel_sessions`);
  expect(await allowed(pixel({pixel_credential_version:2})), false, 'Sign-out immediately rejects already-issued JWT');
  await deniedRpc(native(uid),`select app_private.pixel_native_admission('${uid}')`);
  await sql(`set role "${roles.skyway_server_api}"`);
  expect((await sql(`select app_private.pixel_native_admission('${uid}') as ok`)).rows[0].ok,true,'Server-only native admission remains usable');
  expect((await sql(`select app_private.pixel_native_admission('${linked}') as ok`)).rows[0].ok,false,'Server native fallback rejects linked identity');
  await sql('reset role');
  const functionBefore = metadata.functions.find(f=>f.name==='mutate_wallet');
  assert.throws(()=>guardFunctionDefinition({...functionBefore,security_definer:false}),/non-definer/);checks++;
  assert.throws(()=>guardFunctionDefinition({...invokerBefore,definition:invokerBefore.definition+'\n'}),/Unreviewed security-invoker/);checks++;
  assert.throws(()=>guardFunctionDefinition({...invokerBefore,name:'unreviewed_alias',signature:'unreviewed_alias(uuid,bigint,text)'}),/non-definer/);checks++;
  assert.throws(()=>guardFunctionDefinition(invokerBefore,{guestRead:true}),/anonymous security-invoker/);checks++;
  assert.throws(()=>guardFunctionDefinition({...functionBefore,volatility:'i'}),/cached RPC/);checks++;
  await sql('alter function public.award_completed_run(uuid,bigint,text) security definer');
  let rejectedSecurityMode=false;
  try{await sql(candidate.sql);}catch(error){assert.match(error.message,/RPC attributes or permissions changed/);rejectedSecurityMode=true;await sql('rollback');}
  expect(rejectedSecurityMode,true,'Readback rejects an elevated invoker even when its guarded body is unchanged');
  await sql('alter function public.award_completed_run(uuid,bigint,text) security invoker');
  await sql(fixtureSql(`create function public.unreviewed_rpc() returns boolean language sql as $$select true$$;revoke all on function public.unreviewed_rpc() from public;grant execute on function public.unreviewed_rpc() to authenticated`));
  let rejected=false;try{await sql(candidate.sql);}catch(error){assert.match(error.message,/RPC inventory changed/);rejected=true;await sql('rollback');}
  expect(rejected,true,'Unknown callable source blocks installation');
  console.log(`PASS ${checks} isolated runtime guard checks; no remote/production connection or real account used.`);
} finally {
  if (db) await db.end().catch(()=>{});
  if (admin) {
    if(databaseCreated) await admin.query(`drop database "${database}"`);
    for(const role of createdRoles.reverse()) await admin.query(`drop role "${role}"`);
    await admin.end();
  }
}
