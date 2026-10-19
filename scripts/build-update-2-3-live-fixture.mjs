// Generate, NEVER execute, exact two-account live fixture SQL. The manifest is
// written by test-update-2-3-live.mjs and contains IDs/emails, never credentials.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const quote=s=>`'${s.replaceAll("'","''")}'`;
export function buildLiveFixture23(manifest) {
  assert.match(manifest.marker,/^skyway_u23_live_[0-9]{13}_[0-9a-f]{8}$/);
  assert.equal(manifest.fixtures.length,2);
  manifest.fixtures.forEach((f,i)=>{assert.match(f.id,UUID);assert.equal(f.email,`${manifest.marker}_${i?'b':'a'}@example.invalid`);});
  assert.notEqual(manifest.fixtures[0].id,manifest.fixtures[1].id);
  const bytes=createHash('sha256').update(`Skyway Update 2.3 isolated Pitch:${manifest.marker}`).digest().subarray(0,16);
  bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
  const hex=bytes.toString('hex');const matchId=`${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
  const ids=`array[${manifest.fixtures.map(f=>quote(f.id)+'::uuid').join(',')}]`;
  const emails=`array[${manifest.fixtures.map(f=>quote(f.email)).join(',')}]`;
  const declaration=`uids uuid[]:=${ids};emails text[]:=${emails};mid uuid:=${quote(matchId)};marker text:=${quote(manifest.marker)};i integer;created timestamptz;`;
  const guards=`
 if current_database()<>'neondb' or current_user<>'neondb_owner' then raise exception 'Verified Skyway neondb owner connection required';end if;
 for i in 1..2 loop
  select coalesce(to_jsonb(u)->>'createdAt',to_jsonb(u)->>'created_at')::timestamptz into created from neon_auth."user" u where u.id::text=uids[i]::text and lower(u.email)=emails[i];
  if created is null or abs(extract(epoch from created)-split_part(marker,'_',4)::numeric/1000)>300 then raise exception 'Exact synthetic account ID/email/creation marker mismatch; nothing changed';end if;
 end loop;
 if exists(select 1 from public.admin_users where user_id=any(uids)) or exists(select 1 from app_private.pixel_links where user_id=any(uids)) then raise exception 'Fixture has admin/shared identity data; stop for review';end if;
 if exists(select 1 from public.multiplayer_queue where user_id=any(uids)) then raise exception 'Fixture entered the public queue; stop for review';end if;
 if exists(select 1 from public.multiplayer_matches where (host_user_id=any(uids) or guest_user_id=any(uids)) and (id<>mid or host_user_id<>uids[1] or guest_user_id<>uids[2] or mode<>'casual' or map_key<>'pitch')) then raise exception 'Fixture references another match/player; stop for review';end if;
 if exists(select 1 from public.multiplayer_players where (user_id=any(uids) and match_id<>mid) or (match_id=mid and not(user_id=any(uids)))) then raise exception 'Unexpected match participant; stop for review';end if;
`;
  const seed=`-- Exact owned native fixtures only. Single atomic statement; NO public queue,
-- roles, inventory, XP, paid unlock, ranked result or account mutation.
do $seed_u23_pitch$
declare ${declaration}n integer;
begin
${guards}
 if not exists(select 1 from app_private.progression_resets where version=20261017) then raise exception 'Apply and verify Update2.3 before the fixture';end if;
 if exists(select 1 from public.multiplayer_matches where id=mid) then raise exception 'This exact fixture match already exists; do not seed again';end if;
 if (select count(*) from public.player_profiles where user_id=any(uids) and username is not null)<>2 then raise exception 'Two normal native profiles required';end if;
 if exists(select 1 from public.player_stats where user_id=any(uids) and (total_gems<>0 or high_score<>0 or lifetime_xp<>0 or completed_runs<>0 or stardust<>0)) then raise exception 'Fixture already has game rewards; stop rather than overwrite';end if;
 insert into public.multiplayer_matches(id,host_user_id,guest_user_id,status,current_wave,mode,map_key,map_candidates,map_selection_method,character_selection_ends_at,created_at,started_at,last_activity_at)
 values(mid,uids[1],uids[2],'playing',2,'casual','pitch',array['pitch'],'fixed',null,clock_timestamp(),clock_timestamp(),clock_timestamp());
 for i in 1..2 loop
  insert into public.multiplayer_players(match_id,user_id,slot,username,character_key,character_class,weapon_key,max_hearts,hearts,status,wave,score,obstacle_points,lane_index,character_confirmed,katana_broken,last_katana_at,last_katana_wave,katana_cooldown_until,wave_started_at,run_started_at,last_seen_at,updated_at)
  select mid,uids[i],i,p.username,'runner_ace','runner','runner_ace',3,3,'playing',2,0,0,2,true,false,null,null,null,clock_timestamp(),clock_timestamp(),clock_timestamp(),clock_timestamp() from public.player_profiles p where p.user_id=uids[i];
  get diagnostics n=row_count;if n<>1 then raise exception 'Exact synthetic profile was not inserted';end if;
  insert into public.player_progression_1v1_activity(match_id,user_id,active_seconds,verified_wave,last_heartbeat_at,heartbeat_active) values(mid,uids[i],45,2,clock_timestamp(),true);
 end loop;
 insert into app_private.match_setup_19(match_id,phase,deadline,rng_rarity) values(mid,'done',clock_timestamp(),null);
 raise notice 'U23_OWNED_PITCH_MATCH: %',mid;
end $seed_u23_pitch$;
`;
  const protectedScan=`
 predicate:='true';
 for col in select column_name from information_schema.columns where table_schema=item.schema_name and table_name=item.table_name loop
  if col.column_name='user_id' or col.column_name='userId' or col.column_name like '%\\_user_id' escape '\\' or col.column_name in('created_by','revoked_by','reviewed_by','updated_by') or item.schema_name='neon_auth' and item.table_name='user' and col.column_name='id' then
   predicate:=predicate||format(' and coalesce(to_jsonb(t)->>%L,'''')<>all($1)',col.column_name);
  end if;
  if col.column_name='match_id' or item.schema_name='public' and item.table_name='multiplayer_matches' and col.column_name='id' then
   predicate:=predicate||format(' and coalesce(to_jsonb(t)->>%L,'''')<>$2',col.column_name);
  end if;
 end loop;
 execute format('select count(*),md5(coalesce(string_agg(md5(to_jsonb(t)::text),'''' order by md5(to_jsonb(t)::text)),'''')) from %I.%I t where %s',item.schema_name,item.table_name,predicate) into n,h using uids::text[],mid::text;
`;
  const cleanup=`-- Run only AFTER the helper quits/signs out and credentials are discarded.
-- Deletes ONLY these exact two approved synthetic native identities and this
-- exact isolated match. Any unexpected external relationship aborts everything.
do $cleanup_u23_pitch$
declare ${declaration}item record;col record;predicate text;n bigint;h text;account_count integer;user_count integer;
begin
${guards}
 if exists(select 1 from public.admin_command_audit where (actor_user_id=any(uids) and target_user_id is not null and not(target_user_id=any(uids))) or (target_user_id=any(uids) and actor_user_id is not null and not(actor_user_id=any(uids)))) then raise exception 'Fixture has unrelated admin history; stop for review';end if;
 if exists(select 1 from public.player_bans where (created_by=any(uids) or revoked_by=any(uids)) and target_user_id is not null and not(target_user_id=any(uids))) then raise exception 'Fixture created another player ban; stop for review';end if;
 if exists(select 1 from public.player_bans where target_user_id=any(uids) and created_by is not null and not(created_by=any(uids))) then raise exception 'A real administrator acted on the fixture; stop for review';end if;
 if exists(select 1 from public.admin_role_audit a where exists(select 1 from jsonb_each_text(to_jsonb(a)) k where k.key in('actor_user_id','target_user_id','user_id') and k.value=any(uids::text[]))) then raise exception 'Fixture has administrator role history; stop for review';end if;
 if exists(select 1 from app_private.pixel_login_attempts where link_user_id=any(uids)) then raise exception 'Fixture has a shared-account linking attempt; stop for review';end if;
 if exists(select 1 from public.multiplayer_ranked_results where player_one_user_id=any(uids) or player_two_user_id=any(uids) or winner_user_id=any(uids)) or exists(select 1 from public.ranked_1v1_results where player_one_user_id=any(uids) or player_two_user_id=any(uids) or winner_user_id=any(uids)) then raise exception 'A synthetic identity entered ranked; preserve and investigate';end if;
 if exists(select 1 from app_private.player_report_permissions where updated_by=any(uids) and not(user_id=any(uids))) then raise exception 'Fixture edited another account report permission; stop for review';end if;
 create temporary table u23_cleanup_protected(schema_name text,table_name text,n bigint,h text,primary key(schema_name,table_name)) on commit drop;
 for item in select ns.nspname schema_name,c.relname table_name from pg_class c join pg_namespace ns on ns.oid=c.relnamespace where c.relkind in('r','p') and (ns.nspname in('public','app_private') or ns.nspname='neon_auth' and c.relname in('user','account')) order by ns.nspname,c.relname loop
  execute format('lock table %I.%I in share row exclusive mode',item.schema_name,item.table_name);
${protectedScan}
  insert into pg_temp.u23_cleanup_protected values(item.schema_name,item.table_name,n,h);
 end loop;
 -- First remove the exact parent and its normal FK-cascaded dependants.
 delete from public.multiplayer_matches where id=mid and host_user_id=uids[1] and guest_user_id=uids[2] and mode='casual' and map_key='pitch';
 -- Imported legacy helper tables may lack an FK. Only the exact match UUID
 -- is eligible; no global history cleanup or broad table deletion occurs.
 for item in select table_schema,table_name from information_schema.columns where table_schema in('public','app_private') and column_name='match_id' and udt_name='uuid' order by table_schema,table_name loop
  execute format('delete from %I.%I where match_id=$1',item.table_schema,item.table_name) using mid;
 end loop;
 delete from public.admin_command_audit where actor_user_id=any(uids) or target_user_id=any(uids);
 -- Own rows only. The normal managed user FK cascade will also remove native
 -- sessions/accounts; explicit account deletion handles imported associations.
 for item in select table_schema,table_name from information_schema.columns where table_schema in('public','app_private') and column_name='user_id' and udt_name='uuid' order by table_schema,table_name loop
  execute format('delete from %I.%I where user_id=any($1)',item.table_schema,item.table_name) using uids;
 end loop;
 delete from neon_auth.account a where coalesce(to_jsonb(a)->>'userId',to_jsonb(a)->>'user_id')=any(array[uids[1]::text,uids[2]::text]);get diagnostics account_count=row_count;
 delete from neon_auth."user" u where u.id::text=any(uids::text[]) and lower(u.email)=any(emails);get diagnostics user_count=row_count;
 if user_count<>2 then raise exception 'Expected exactly two synthetic native deletions; rollback';end if;
 if exists(select 1 from neon_auth."user" where id::text=any(uids::text[])) or exists(select 1 from neon_auth.account a where coalesce(to_jsonb(a)->>'userId',to_jsonb(a)->>'user_id')=any(array[uids[1]::text,uids[2]::text])) or exists(select 1 from public.multiplayer_matches where id=mid) then raise exception 'Exact fixture cleanup incomplete; rollback';end if;
 for item in select * from pg_temp.u23_cleanup_protected order by schema_name,table_name loop
${protectedScan}
  if n<>item.n or h<>item.h then raise exception 'NON-FIXTURE DATA CHANGED: %.%; whole cleanup rolled back',item.schema_name,item.table_name;end if;
 end loop;
 raise notice 'U23_OWNED_FIXTURE_CLEANUP: %',jsonb_build_object('synthetic_users_deleted',user_count,'synthetic_accounts_deleted',account_count,'isolated_match_absent',true,'non_fixture_tables_unchanged',true,'protected_tables',(select count(*) from pg_temp.u23_cleanup_protected));
end $cleanup_u23_pitch$;
`;
  const baseline=`-- Aggregate non-fixture account/profile/wallet baseline; no personal rows.
with uids as(select unnest(${ids}) id),payloads as(
 select 'managed_users' kind,to_jsonb(u) payload from neon_auth."user" u where not exists(select 1 from uids where id::text=u.id::text)
 union all select 'managed_accounts',to_jsonb(a) from neon_auth.account a where coalesce(to_jsonb(a)->>'userId',to_jsonb(a)->>'user_id')<>all(array[${manifest.fixtures.map(f=>quote(f.id)).join(',')}])
 union all select 'profiles',to_jsonb(p) from public.player_profiles p where not exists(select 1 from uids where id=p.user_id)
 union all select 'stats',to_jsonb(s) from public.player_stats s where not exists(select 1 from uids where id=s.user_id)
 union all select 'owned_items',to_jsonb(o) from public.player_unlocks o where not exists(select 1 from uids where id=o.user_id)
 union all select 'admin_roles',to_jsonb(a) from public.admin_users a
),totals as(select kind,count(*) n,md5(coalesce(string_agg(md5(payload::text),'' order by md5(payload::text)),'')) md5 from payloads group by kind)
select jsonb_object_agg(kind,jsonb_build_object('rows',n,'md5',md5)) as non_fixture_baseline from totals;
`;
  return {marker:manifest.marker,matchId,seed,cleanup,baseline};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 assert.ok(process.argv[2],'Supply the exact live-helper cleanup manifest path; no fixture is created here');
 const manifest=JSON.parse(readFileSync(resolve(process.argv[2]),'utf8'));const sql=buildLiveFixture23(manifest);
 const outputs=resolve(import.meta.dirname,'../../../outputs');
 const result={marker:sql.marker,matchId:sql.matchId,files:{}};
 for(const name of ['seed','cleanup','baseline']){
  const path=resolve(outputs,`${sql.marker}-${name}.sql`);writeFileSync(path,sql[name],{mode:0o600});
  result.files[name]={path,sha256:createHash('sha256').update(sql[name]).digest('hex')};
 }
 console.log(JSON.stringify(result,null,2));
}
