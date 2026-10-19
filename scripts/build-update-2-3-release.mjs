// Mechanical release bundler: one audited transaction, no connection/login.
// Output contains SQL source and aggregate-only preservation checks, no users,
// credentials, keys, cookies, account data, or read-only metadata exports.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const target = resolve(process.argv[2] ?? resolve(root, '../../outputs/update-2-3-release-20261019.sql'));
assert.ok(target.startsWith(resolve(root, '../../outputs') + '/'), 'Release artifact must remain in the task outputs folder');
const order = ['duel-access', 'economy', 'duel-modes', 'gem-streak', 'masteries', 'health', 'guard', 'smoke', 'admin'];
const sources = order.map(name => {
  const file = `neon/update-2-3-${name}.sql`;
  const source = readFileSync(resolve(root, file), 'utf8');
  assert.equal([...source.matchAll(/^begin;\s*$/gm)].length, 1, file);
  assert.equal([...source.matchAll(/^commit;\s*$/gm)].length, 1, file);
  return { file, sha256: createHash('sha256').update(source).digest('hex'), sql: source.replace(/^begin;\s*$/m, '').replace(/^commit;\s*$/m, '') };
});
const checksumBody = `
 expr:='to_jsonb(t)';predicate:='';
 if item.schema_name='public' and item.table_name='player_stats' then
  expr:='to_jsonb(t)-array[''level'',''xp_in_level'',''lifetime_xp'',''progression_version'']::text[]';
 elsif item.schema_name='public' and item.table_name='player_progression_events' then
  expr:='jsonb_set(to_jsonb(t)-''xp_awarded'',''{metadata}'',case when t.metadata is null then ''null''::jsonb else t.metadata-''xp_breakdown'' end)';
 elsif item.schema_name='app_private' and item.table_name='one_v_one_map_rules' then
  expr:='jsonb_set(to_jsonb(t),''{allowed_attacks}'',to_jsonb(t.allowed_attacks)-''snowflake'')';
 elsif item.schema_name='app_private' and item.table_name='progression_resets' then predicate:=' where version<>20261017';end if;
 execute format('select count(*),md5(coalesce(string_agg(md5((%s)::text),'''' order by md5((%s)::text)),'''')) from %I.%I t%s',expr,expr,item.schema_name,item.table_name,predicate) into n,h;
`;
const before = `-- UPDATE 2.3: one transaction with fail-closed aggregate preservation.
-- Execute as the existing neondb_owner in the verified Skyway production DB.
-- This intentionally resets XP once (registry20261017), never other data.
begin;
set local lock_timeout='5s';
set local statement_timeout='180s';
select pg_advisory_xact_lock(20261019,23);
create temporary table update23_before(schema_name text,table_name text,n bigint,h text,primary key(schema_name,table_name)) on commit drop;
create temporary table update23_existing_modes(payload jsonb primary key) on commit drop;
create temporary table update23_expected_modes(user_id uuid,mode text,primary key(user_id,mode)) on commit drop;
create temporary table update23_metadata(key text primary key,value jsonb) on commit drop;
do $capture$
declare item record;expr text;predicate text;n bigint;h text;prior boolean;
begin
 if current_database()<>'neondb' or current_user<>'neondb_owner' then raise exception 'Use the verified Skyway neondb owner connection';end if;
 if to_regclass('neon_auth.user') is null or to_regclass('neon_auth.account') is null or to_regclass('app_private.progression_resets') is null then raise exception 'Expected managed account/progression tables are missing';end if;
 -- Lock only the current game's actual data tables in a deterministic order.
 -- A busy table fails after five seconds instead of running without a fence.
 for item in select nsp.nspname schema_name,c.relname table_name from pg_catalog.pg_class c join pg_catalog.pg_namespace nsp on nsp.oid=c.relnamespace
  where c.relkind in('r','p') and (nsp.nspname in('public','app_private') or nsp.nspname='neon_auth' and c.relname in('user','account')) order by nsp.nspname,c.relname loop
  execute format('lock table %I.%I in share row exclusive mode',item.schema_name,item.table_name);
  if item.schema_name='app_private' and item.table_name='mode_unlock_entitlements' then
   execute 'insert into pg_temp.update23_existing_modes select to_jsonb(e) from app_private.mode_unlock_entitlements e';
  else
${checksumBody}
   insert into pg_temp.update23_before values(item.schema_name,item.table_name,n,h);
  end if;
 end loop;
 prior:=exists(select 1 from app_private.progression_resets where version=20261017);
 insert into pg_temp.update23_metadata values('already_reset',to_jsonb(prior));
 if prior then
  insert into pg_temp.update23_metadata select 'reset_row',to_jsonb(r) from app_private.progression_resets r where version=20261017;
  select md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) into h from public.player_stats t;
  insert into pg_temp.update23_metadata values('full_stats_on_replay',to_jsonb(h));
  select md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) into h from public.player_progression_events t;
  insert into pg_temp.update23_metadata values('full_events_on_replay',to_jsonb(h));
 else
  insert into pg_temp.update23_expected_modes select user_id,mode from public.player_stats cross join(values('casual'),('rotating')) m(mode) where level>=5;
 end if;
end $capture$;
`;
const after = `
do $preservation$
declare item record;expr text;predicate text;n bigint;h text;prior boolean;
begin
 for item in select * from pg_temp.update23_before order by schema_name,table_name loop
  if to_regclass(format('%I.%I',item.schema_name,item.table_name)) is null then raise exception 'Protected table removed: %.%',item.schema_name,item.table_name;end if;
${checksumBody}
  if n<>item.n or h<>item.h then raise exception 'PROTECTED DATA CHANGED: %.%; entire update rolled back',item.schema_name,item.table_name;end if;
 end loop;
 if exists(select 1 from pg_temp.update23_existing_modes b where not exists(select 1 from app_private.mode_unlock_entitlements e where to_jsonb(e)=b.payload)) then raise exception 'An existing earned mode entitlement changed';end if;
 if exists(select 1 from app_private.mode_unlock_entitlements e where not exists(select 1 from pg_temp.update23_existing_modes b where b.payload=to_jsonb(e)) and not exists(select 1 from pg_temp.update23_expected_modes x where x.user_id=e.user_id and x.mode=e.mode)) then raise exception 'Unexpected new mode entitlement';end if;
 if exists(select 1 from pg_temp.update23_expected_modes x where not exists(select 1 from app_private.mode_unlock_entitlements e where e.user_id=x.user_id and e.mode=x.mode)) then raise exception 'An old free mode unlock was not preserved';end if;
 if (select count(*) from app_private.progression_resets where version=20261017)<>1 then raise exception 'One-time XP reset registry missing';end if;
 select value::boolean into prior from pg_temp.update23_metadata where key='already_reset';
 if prior then
  if (select to_jsonb(r) from app_private.progression_resets r where version=20261017) is distinct from (select value from pg_temp.update23_metadata where key='reset_row') then raise exception 'Existing reset registry changed';end if;
  select md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) into h from public.player_stats t;
  if to_jsonb(h) is distinct from (select value from pg_temp.update23_metadata where key='full_stats_on_replay') then raise exception 'Reapplying reset changed newly earned XP';end if;
  select md5(coalesce(string_agg(md5(to_jsonb(t)::text),'' order by md5(to_jsonb(t)::text)),'')) into h from public.player_progression_events t;
  if to_jsonb(h) is distinct from (select value from pg_temp.update23_metadata where key='full_events_on_replay') then raise exception 'Reapplying reset changed new XP receipts';end if;
 else
  if exists(select 1 from public.player_stats where level<>0 or xp_in_level<>0 or lifetime_xp<>0 or progression_version<>20261017) then raise exception 'The requested XP-only reset is incomplete';end if;
  if exists(select 1 from public.player_progression_events where xp_awarded<>0 or metadata?'xp_breakdown') then raise exception 'Obsolete XP award amounts remain';end if;
 end if;
end $preservation$;
select jsonb_build_object('update','2.3','database',current_database(),'protected_tables',(select count(*) from pg_temp.update23_before),
 'accounts_preserved',true,'protected_data_preserved',true,'xp_reset_version',20261017,'xp_reset_previously_applied',(select value from pg_temp.update23_metadata where key='already_reset'),
 'new_free_mode_entitlements',(select count(*) from pg_temp.update23_expected_modes),'committing',true) as update_2_3_result;
commit;
`;
const output = before + sources.map(s => `\n-- BEGIN ${s.file} SHA256 ${s.sha256}\n${s.sql}\n-- END ${s.file}\n`).join('') + after;
assert.ok(!/\b(?:drop\s+(?:database|schema)|truncate\s|vacuum\s+full)\b/i.test(output));
writeFileSync(target, output, { mode: 0o600 });
console.log(JSON.stringify({ path: target, bytes: Buffer.byteLength(output), sha256: createHash('sha256').update(output).digest('hex'), sources: sources.map(({ file, sha256 }) => ({ file, sha256 })) }, null, 2));
