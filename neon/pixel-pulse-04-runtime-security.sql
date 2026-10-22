-- Generated from a reviewed, complete read-only metadata export.
-- Application-owned admission only; managed auth.uid/auth.jwt are NEVER changed.
-- No accounts, passwords, balances, ownership, roles or history are modified.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $runtime_preflight$
declare actual jsonb;
begin
 if current_database()<>'neondb' or current_user<>'neondb_owner' or current_setting('neon.branch_id',true)<>'br-holy-math-axs9gjmb' then
  raise exception 'Exact reviewed Skyway database required';end if;
 if not exists(select 1 from information_schema.columns where table_schema='app_private' and table_name='pixel_sessions'
  and column_name='runtime_lease_until' and udt_name='timestamptz') then raise exception 'Apply the bounded Pixel session lease migration first';end if;
 if exists(select 1 from pg_roles where rolname='authenticated' and(rolsuper or rolbypassrls))
  or has_schema_privilege('authenticated','public','CREATE') or has_schema_privilege('authenticated','app_private','USAGE,CREATE')
  or exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in('r','p')
   and pg_has_role('authenticated',c.relowner,'MEMBER')) then raise exception 'Player schema/role boundary changed';end if;
 select jsonb_agg('public.'||p.proname||'('||replace(oidvectortypes(p.proargtypes),', ',',')||')'
  order by 'public.'||p.proname||'('||replace(oidvectortypes(p.proargtypes),', ',',')||')') into actual
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f'
  and p.proname<>'skyway_runtime_admitted' and has_function_privilege('authenticated',p.oid,'EXECUTE');
 if actual is distinct from '["public.acknowledge_1v1_attacks(uuid,uuid[])","public.activate_1v1_katana(uuid)","public.activate_1v1_mirage(uuid,integer)","public.activate_1v1_zenith_time_stop(uuid,bigint)","public.activate_mastery_quest(text)","public.admin_command_suggestions(text,text,uuid,integer)","public.admin_execute_player_command(text,uuid,text,text,text,bigint,text[],uuid,bigint,boolean,bigint,text,text)","public.admin_get_player(uuid)","public.admin_get_player_record(uuid)","public.admin_player_command_v23(text,uuid,text,text,text,bigint,text[],uuid,bigint,boolean,bigint,text,text)","public.admin_player_search(text,integer)","public.admin_unban_player(uuid,text,text)","public.apply_1v1_mirage_damage(uuid,numeric)","public.apply_mastery_heal(uuid,uuid,text)","public.award_1v1_mushroom(uuid,integer,text)","public.award_completed_run(uuid,bigint,text)","public.award_completed_run_v2(uuid,bigint,text)","public.ban_1v1_map(uuid,text)","public.begin_mastery_session(uuid,text,text,text)","public.begin_mastery_smoke_charge(uuid,uuid)","public.begin_photon_character_run(text)","public.begin_photon_fury_run()","public.choose_1v1_character(uuid,text)","public.claim_mastery_blue_gem(uuid,text)","public.claim_player_gem(uuid,text)","public.consume_1v1_heatfeast(uuid,integer)","public.credit_mastery_events(uuid,jsonb)","public.discard_1v1_gambit_cards(uuid,text[])","public.draw_1v1_gambit_wave(uuid,integer)","public.equip_photon_character(text)","public.extract_items(integer,text)","public.finish_mastery_trial(uuid)","public.finish_photon_character_run(uuid,numeric,integer,integer)","public.finish_photon_fury_run(uuid,numeric,integer)","public.get_1v1_ability_state(uuid)","public.get_1v1_gambit_state(uuid)","public.get_1v1_leaderboard(integer,integer)","public.get_1v1_map_catalog()","public.get_1v1_map_priorities()","public.get_1v1_state(uuid)","public.get_admin_ban_appeals(text)","public.get_admin_reports()","public.get_admin_role()","public.get_admin_test_mode()","public.get_leaderboard()","public.get_mastery_profile()","public.get_mastery_salve_uses(uuid)","public.get_mastery_smoke_effect(uuid)","public.get_my_pixel_identity()","public.get_my_report_permission()","public.get_photon_fury_profile()","public.get_player_progression()","public.get_rotating_mode()","public.is_admin()","public.join_1v1_queue(text)","public.leave_1v1()","public.list_admins()","public.manage_admin(text,text)","public.purchase_1v1_comet_removal(uuid,text,text)","public.purchase_catalog_item(text)","public.purchase_mastery_quest(text)","public.record_1v1_ruins_pumpkin(uuid,integer,boolean)","public.record_1v1_terminal_contact(uuid,text,text)","public.redeem_1v1_comet_removal(uuid,uuid,text)","public.reflect_1v1_attack(uuid,text,text)","public.reflect_1v1_attack(uuid,text,text,uuid)","public.register_player_device(text,text)","public.reset_endless_gem_streak(uuid)","public.resolve_ban_appeal(bigint,text,text)","public.resolve_player_report(bigint)","public.send_1v1_attack(uuid,text,integer)","public.set_1v1_map_priorities(text[])","public.set_1v1_terminal_facing(uuid,integer)","public.set_admin_test_mode(boolean)","public.set_endless_randomizer(boolean)","public.set_loadout(text,text)","public.set_mastery_guard_mode(uuid,boolean)","public.set_mastery_toggle(text,text,boolean)","public.set_player_flair(text)","public.set_player_username(text)","public.start_progression_run()","public.sync_1v1_intermission_coins(uuid,text[])","public.sync_1v1_progression(uuid,integer,boolean)","public.sync_1v1_score(uuid,bigint)","public.sync_progression_run(uuid,integer,boolean)","public.unlock_photon_fury()","public.unlock_ranked_1v1()","public.update_1v1_position(uuid,integer)","public.update_1v1_state(uuid,numeric,integer,bigint,text)","public.update_1v1_terminal_state(uuid,numeric,integer,bigint,text,numeric)","public.use_1v1_terminal_sword(uuid)","public.use_mastery_smoke(uuid,integer,uuid)"]'::jsonb then raise exception 'Current callable RPC inventory changed; review before installation';end if;
 if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app_private'
  and p.prokind='f' and has_function_privilege('authenticated',p.oid,'EXECUTE')) then raise exception 'Private RPC is exposed';end if;
 if exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in('r','p')
  and(has_table_privilege('authenticated',c.oid,'TRUNCATE') or(not c.relrowsecurity and
   (has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE') or has_any_column_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE'))))) then
  raise exception 'Unprotected player table privileges changed';end if;
 select coalesce(jsonb_agg(to_jsonb(p) order by p.schemaname,p.tablename,p.policyname),'[]'::jsonb) into actual
 from pg_policies p where p.schemaname='public' and p.policyname<>'skyway_pixel_runtime_admission';
 if actual is distinct from '[{"cmd":"SELECT","qual":"active","roles":["authenticated"],"tablename":"extraction_catalog","permissive":"PERMISSIVE","policyname":"Authenticated players read extraction catalog","schemaname":"public","with_check":null},{"cmd":"SELECT","qual":"( SELECT is_1v1_participant(multiplayer_attacks.match_id) AS is_1v1_participant)","roles":["authenticated"],"tablename":"multiplayer_attacks","permissive":"PERMISSIVE","policyname":"Participants read 1v1 attacks","schemaname":"public","with_check":null},{"cmd":"SELECT","qual":"( SELECT is_1v1_participant(multiplayer_matches.id) AS is_1v1_participant)","roles":["authenticated"],"tablename":"multiplayer_matches","permissive":"PERMISSIVE","policyname":"Participants read their 1v1 matches","schemaname":"public","with_check":null},{"cmd":"SELECT","qual":"( SELECT is_1v1_participant(multiplayer_players.match_id) AS is_1v1_participant)","roles":["authenticated"],"tablename":"multiplayer_players","permissive":"PERMISSIVE","policyname":"Participants read 1v1 players","schemaname":"public","with_check":null},{"cmd":"SELECT","qual":"(( SELECT auth.uid() AS uid) = user_id)","roles":["authenticated"],"tablename":"player_loadouts","permissive":"PERMISSIVE","policyname":"Players read own loadout","schemaname":"public","with_check":null},{"cmd":"SELECT","qual":"(user_id = auth.uid())","roles":["authenticated"],"tablename":"player_photon_fury","permissive":"PERMISSIVE","policyname":"photon_own_read","schemaname":"public","with_check":null},{"cmd":"SELECT","qual":"(( SELECT auth.uid() AS uid) = user_id)","roles":["authenticated"],"tablename":"player_profiles","permissive":"PERMISSIVE","policyname":"Players read their profile","schemaname":"public","with_check":null},{"cmd":"SELECT","qual":"( SELECT is_admin() AS is_admin)","roles":["authenticated"],"tablename":"player_reports","permissive":"PERMISSIVE","policyname":"Admins read reports","schemaname":"public","with_check":null},{"cmd":"INSERT","qual":null,"roles":["authenticated"],"tablename":"player_reports","permissive":"PERMISSIVE","policyname":"Players submit their own reports","schemaname":"public","with_check":"(( SELECT auth.uid() AS uid) = user_id)"},{"cmd":"SELECT","qual":"(( SELECT auth.uid() AS uid) = user_id)","roles":["authenticated"],"tablename":"player_stats","permissive":"PERMISSIVE","policyname":"Players read their own stats","schemaname":"public","with_check":null},{"cmd":"SELECT","qual":"(( SELECT auth.uid() AS uid) = user_id)","roles":["authenticated"],"tablename":"player_unlocks","permissive":"PERMISSIVE","policyname":"Players read own unlocks","schemaname":"public","with_check":null}]'::jsonb then raise exception 'Existing RLS policies changed; review before installation';end if;
 select coalesce(jsonb_agg(jsonb_build_object('name',c.relname,'rls',c.relrowsecurity) order by c.relname),'[]'::jsonb) into actual
 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in('r','p');
 if actual is distinct from '[{"name":"admin_command_audit","rls":true},{"name":"admin_compensation_ledger","rls":true},{"name":"admin_role_audit","rls":true},{"name":"admin_todos","rls":true},{"name":"admin_users","rls":true},{"name":"extraction_catalog","rls":true},{"name":"extraction_transactions","rls":true},{"name":"multiplayer_attacks","rls":true},{"name":"multiplayer_comet_removals","rls":true},{"name":"multiplayer_grove_wave_results","rls":true},{"name":"multiplayer_heatfeast","rls":true},{"name":"multiplayer_heatfeast_split_state","rls":true},{"name":"multiplayer_heatfeast_tax_events","rls":true},{"name":"multiplayer_heatfeast_wave_usage","rls":true},{"name":"multiplayer_katana_events","rls":true},{"name":"multiplayer_matches","rls":true},{"name":"multiplayer_mushroom_events","rls":true},{"name":"multiplayer_players","rls":true},{"name":"multiplayer_point_events","rls":true},{"name":"multiplayer_queue","rls":true},{"name":"multiplayer_ranked_results","rls":true},{"name":"player_1v1_map_priorities","rls":true},{"name":"player_1v1_stats","rls":true},{"name":"player_ban_appeals","rls":true},{"name":"player_bans","rls":true},{"name":"player_device_links","rls":true},{"name":"player_devices","rls":true},{"name":"player_endless_gem_streaks","rls":true},{"name":"player_loadouts","rls":true},{"name":"player_photon_fury","rls":true},{"name":"player_profiles","rls":true},{"name":"player_progression_1v1_activity","rls":true},{"name":"player_progression_events","rls":true},{"name":"player_progression_runs","rls":true},{"name":"player_ranked_1v1_stats","rls":true},{"name":"player_reports","rls":true},{"name":"player_stats","rls":true},{"name":"player_unlocks","rls":true},{"name":"ranked_1v1_results","rls":true},{"name":"ranked_1v1_seasons","rls":true},{"name":"username_blocklist","rls":true}]'::jsonb then
  raise exception 'Player table inventory changed; review before installation';end if;
end $runtime_preflight$;

create or replace function app_private.pixel_native_admission(p_user_id uuid)
returns boolean language sql stable security definer set search_path='' as $native$
 select p_user_id is not null and exists(select 1 from neon_auth."user" u where u.id=p_user_id
   and(not coalesce(u.banned,false) or(u."banExpires" is not null and u."banExpires"<clock_timestamp())))
 and not exists(select 1 from app_private.pixel_links l where l.user_id=p_user_id)
$native$;
revoke all on function app_private.pixel_native_admission(uuid) from public,anon,anonymous,authenticated;
grant execute on function app_private.pixel_native_admission(uuid) to skyway_server_api;

create or replace function app_private.pixel_runtime_admitted()
returns boolean language plpgsql stable security definer set search_path='' as $admission$
declare claims jsonb:=auth.jwt();u uuid:=auth.uid();stamp numeric:=extract(epoch from clock_timestamp());cv numeric;
begin
 if u is null or jsonb_typeof(claims)<>'object' or claims->>'sub' is distinct from u::text then return false;end if;
 if claims->>'iss'='https://ep-tiny-tooth-ax0800jo.neonauth.c-4.us-east-2.aws.neon.tech' then
   if claims?'skyway_auth' or claims?'pixel_subject' or claims?'pixel_session_hash' or claims?'pixel_credential_version' then return false;end if;
   return app_private.pixel_native_admission(u);
 end if;
 if claims->>'iss' is distinct from 'https://skyway-sprint.vercel.app/api/pixel-pulse'
  or claims->>'skyway_auth' is distinct from 'pixel' or claims->>'role' is distinct from 'authenticated'
  or jsonb_typeof(claims->'aud') is distinct from 'array'
  or not(claims->'aud' ? 'https://skyway-sprint.vercel.app')
  or jsonb_typeof(claims->'iat') is distinct from 'number' or jsonb_typeof(claims->'exp') is distinct from 'number'
  or coalesce(claims->>'pixel_session_hash','')!~'^[a-f0-9]{64}$'
  or jsonb_typeof(claims->'pixel_credential_version') is distinct from 'number'
  or coalesce(claims->>'pixel_credential_version','')!~'^[0-9]{1,16}$' then return false;end if;
 cv:=(claims->>'pixel_credential_version')::numeric;
 if cv>9007199254740991 or (claims->>'iat')::numeric>stamp+10
  or (claims->>'iat')::numeric<stamp-130 or (claims->>'exp')::numeric<=stamp
  or (claims->>'exp')::numeric>(claims->>'iat')::numeric+120 then return false;end if;
 return exists(select 1 from app_private.pixel_sessions s
  join app_private.pixel_links l using(issuer,subject) join neon_auth."user" a on a.id=l.user_id
  where l.user_id=u and l.issuer='https://pixel-pulse-websites.vercel.app/api/sso'
   and l.subject::text=claims->>'pixel_subject' and l.credential_version=cv
   and s.token_hash=claims->>'pixel_session_hash' and s.credential_version=cv
   and s.expires_at>clock_timestamp() and s.runtime_lease_until>clock_timestamp()
   and s.runtime_lease_until<=clock_timestamp()+interval '35 seconds'
   and(not coalesce(a.banned,false) or(a."banExpires" is not null and a."banExpires"<clock_timestamp())));
exception when invalid_text_representation or numeric_value_out_of_range then return false;
end $admission$;
revoke all on function app_private.pixel_runtime_admitted() from public,anon,anonymous,authenticated,skyway_server_api;

create or replace function app_private.require_pixel_runtime()
returns void language plpgsql stable security definer set search_path='' as $require$
begin
 if not app_private.pixel_runtime_admitted() then
  raise exception 'Sign in again with Pixel Pulse to continue' using errcode='42501';
 end if;
end $require$;
revoke all on function app_private.require_pixel_runtime() from public,anon,anonymous,authenticated,skyway_server_api;

-- This is the sole new player-callable helper. No UUID arguments, profile data,
-- session IDs, role import or private schema access: only the caller's admission.
create or replace function public.skyway_runtime_admitted()
returns boolean language sql stable security definer set search_path='' as $public_admission$
 select app_private.pixel_runtime_admitted()
$public_admission$;
revoke all on function public.skyway_runtime_admitted() from public,anon,anonymous;
grant execute on function public.skyway_runtime_admitted() to authenticated;

do $runtime_install$
declare item jsonb;
begin

 if md5(pg_get_functiondef('public.acknowledge_1v1_attacks(uuid,uuid[])'::regprocedure))='2e9bb36506d61f984774dbe3d628fb16' then
  execute 'CREATE OR REPLACE FUNCTION public.acknowledge_1v1_attacks(p_match_id uuid, p_attack_ids uuid[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''''
AS $runtime_guard$
begin
  -- Pixel runtime boundary: before original variable initializers or writes.
  perform app_private.require_pixel_runtime();
  <<skyway_original>>
declare
  v_uid uuid := auth.uid();
  v_count integer;
begin
  if v_uid is null then
    raise exception ''Sign in required'';
  end if;
  if not exists (
    select 1 from public.multiplayer_players
    where match_id = p_match_id and user_id = v_uid
  ) then
    raise exception ''1v1 match not found'';
  end if;

  update public.multiplayer_attacks
  set delivered_at = now()
  where match_id = p_match_id
    and target_user_id = v_uid
    and id = any(coalesce(p_attack_ids, array[]::uuid[]))
    and delivered_at is null;
  get diagnostics v_count = row_count;
  return v_count;
end;
end
$runtime_guard$
';
 elsif (select md5(prosrc) from pg_proc where oid='public.acknowledge_1v1_attacks(uuid,uuid[])'::regprocedure)<>'c7a2c6716375ad231a95b23728137546' then
  raise exception 'Unreviewed RPC source: %','acknowledge_1v1_attacks(uuid,uuid[])';
 end if;

 if md5(pg_get_functiondef('public.activate_1v1_katana(uuid)'::regprocedure))='b22db9dd9799772fdd7f5c1b045e6758' then
  execute 'CREATE OR REPLACE FUNCTION public.activate_1v1_katana(p_match_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''''
AS $runtime_guard$
begin
  -- Pixel runtime boundary: before original variable initializers or writes.
  perform app_private.require_pixel_runtime();
  <<skyway_original>>
declare
  v_uid uuid := auth.uid();
  v_match public.multiplayer_matches;
  v_self public.multiplayer_players;
  v_now timestamptz := clock_timestamp();
begin
  if v_uid is null then raise exception ''Sign in required''; end if;
  select * into v_match from public.multiplayer_matches match
  where match.id = p_match_id for update;
  select * into v_self from public.multiplayer_players player
  where player.match_id = p_match_id and player.user_id = v_uid for update;
  if v_match.id is null or v_self.user_id is null then
    raise exception ''1v1 match not found'';
  end if;
  if v_match.map_key <> ''pitch'' then
    raise exception ''Katana activation is only available on Pitch'';
  end if;
  if v_match.status <> ''playing'' or v_self.status <> ''playing'' then
    raise exception ''Katana can only be used during active play'';
  end if;
  if v_self.katana_broken then raise exception ''The katana is broken''; end if;
  if v_self.last_katana_wave = v_self.wave
     and coalesce(v_self.katana_cooldown_until,v_self.last_katana_at+interval ''6.4 seconds'') > v_now then
    raise exception ''Katana is cooling down'';
  end if;

  update public.multiplayer_players player
  set katana_cooldown_until=v_now+interval ''6.4 seconds'', last_katana_at = v_now,
      last_katana_wave = v_self.wave,
      last_seen_at = v_now,
      updated_at = v_now
  where player.match_id = p_match_id and player.user_id = v_uid;
  update public.multiplayer_matches match
  set last_activity_at = v_now where match.id = p_match_id;

  return jsonb_build_object(
    ''match_id'', p_match_id,
    ''activated_at'', v_now,
    ''active_until'', v_now + interval ''0.4 seconds''/(1+.25*greatest(v_self.wave-1,0)),
    ''katana_broken'', false,
    ''katana_cooldown_ends_at'', v_now + interval ''6.4 seconds'',
    ''katana_cooldown_until'', v_now + interval ''6.4 seconds''
  );
end;
end
$runtime_guard$
';
 elsif (select md5(prosrc) from pg_proc where oid='public.activate_1v1_katana(uuid)'::regprocedure)<>'0c562a96b224923cbaf7a6432f29377c' then
  raise exception 'Unreviewed RPC source: %','activate_1v1_katana(uuid)';
 end if;

 if md5(pg_get_functiondef('public.activate_1v1_mirage(uuid,integer)'::regprocedure))='fdfa573194904c7ed194e7f299be5877' then
  execute 'CREATE OR REPLACE FUNCTION public.activate_1v1_mirage(p_match_id uuid, p_lane_index integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''''
AS $runtime_guard$
begin
  -- Pixel runtime boundary: before original variable initializers or writes.
  perform app_private.require_pixel_runtime();
  <<skyway_original>>
declare
  v_uid uuid := auth.uid();
  v_match public.multiplayer_matches;
  v_self public.multiplayer_players;
  v_opponent public.multiplayer_players;
  v_lane_count integer := 5;
  v_now timestamptz := clock_timestamp();
begin
  if v_uid is null then raise exception ''Sign in required''; end if;
  select * into v_match from public.multiplayer_matches match_row
  where match_row.id = p_match_id for update;
  perform 1 from public.multiplayer_players player
  where player.match_id = p_match_id order by player.slot for update;
  select * into v_self from public.multiplayer_players player
  where player.match_id = p_match_id and player.user_id = v_uid;
  select * into v_opponent from public.multiplayer_players player
  where player.match_id = p_match_id and player.user_id <> v_uid limit 1;
  if v_match.id is null or v_self.user_id is null or v_opponent.user_id is null then
    raise exception ''1v1 match not found'';
  end if;
  if v_match.status <> ''playing'' or v_self.status <> ''playing'' then
    raise exception ''Mirage Invasion is only available during active 1v1 play'';
  end if;
  if v_self.character_key <> ''trickster_mirage'' then
    raise exception ''Only Mirage can start Mirage Invasion'';
  end if;
  select rules.lane_count into v_lane_count
  from app_private.one_v_one_map_rules rules
  where rules.map_key = v_match.map_key;
  v_lane_count := coalesce(v_lane_count, 5);
  if p_lane_index is null or p_lane_index < 0
     or p_lane_index >= v_lane_count then
    raise exception ''Lane must be between 0 and %'', v_lane_count - 1;
  end if;
  if p_lane_index = v_opponent.lane_index then
    raise exception ''Mirage must enter in a lane the opponent is not in'';
  end if;
  if v_self.mirage_used_wave = v_self.wave then
    raise exception ''Mirage Invasion was already used this wave'';
  end if;
  if v_self.mirage_active_until > v_now
     and not v_self.mirage_exit_damage_applied then
    raise exception ''Mirage Invasion is already active'';
  end if;
  perform app_private.settle_1v1_mirage_exit(
    p_match_id, v_uid, v_now
  );
  select * into v_self from public.multiplayer_players player
  where player.match_id = p_match_id and player.user_id = v_uid;
  if v_self.status <> ''playing'' or v_self.hearts <= 0 then
    raise exception ''Eliminated players cannot start Mirage Invasion'';
  end if;

  update public.multiplayer_players player
  set lane_index = p_lane_index::smallint,
      last_position_at = v_now,
      mirage_used_wave = player.wave,
      mirage_started_at = v_now,
      mirage_active_until = v_now + interval ''5 seconds'',
      mirage_matching_since_at = null,
      mirage_next_damage_at = null,
      mirage_exit_damage_applied = false,
      mirage_damage_dealt = 0,
      last_seen_at = v_now,
      updated_at = v_now
  where player.match_id = p_match_id and player.user_id = v_uid;
  update public.multiplayer_matches match_row
  set last_activity_at = v_now where match_row.id = p_match_id;
  return jsonb_build_object(
    ''match_id'', p_match_id,
    ''wave'', v_self.wave,
    ''lane_index'', p_lane_index,
    ''opponent_lane_index'', v_opponent.lane_index,
    ''started_at'', v_now,
    ''ends_at'', v_now + interval ''5 seconds'',
    ''active'', true,
    ''damage_dealt'', 0
  );
end;
end
$runtime_guard$
';
 elsif (select md5(prosrc) from pg_proc where oid='public.activate_1v1_mirage(uuid,integer)'::regprocedure)<>'cbdbcb56ecf6730bb6122494ea616f53' then
  raise exception 'Unreviewed RPC source: %','activate_1v1_mirage(uuid,integer)';
 end if;

 if md5(pg_get_functiondef('public.activate_1v1_zenith_time_stop(uuid,bigint)'::regprocedure))='9b5923f72e1915d34dcbd1c32b462f19' then
  execute 'CREATE OR REPLACE FUNCTION public.activate_1v1_zenith_time_stop(p_match_id uuid, p_score bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''''
AS $runtime_guard$
begin
  -- Pixel runtime boundary: before original variable initializers or writes.
  perform app_private.require_pixel_runtime();
  <<skyway_original>>
declare
  v_uid uuid := auth.uid();
  v_match public.multiplayer_matches;
  v_self public.multiplayer_players;
  v_now timestamptz := clock_timestamp();
  v_until timestamptz := v_now + interval ''10 seconds'';
begin
  if v_uid is null then raise exception ''Sign in required''; end if;
  if p_score is null or p_score < 0 or p_score > 1000000000000 then
    raise exception ''Invalid 1v1 score'';
  end if;

  select * into v_match from public.multiplayer_matches match
  where match.id = p_match_id for update;
  select * into v_self from public.multiplayer_players player
  where player.match_id = p_match_id and player.user_id = v_uid for update;

  if v_match.id is null or v_self.user_id is null then
    raise exception ''1v1 match not found'';
  end if;
  if v_match.status <> ''playing'' or v_self.status <> ''playing'' then
    raise exception ''Time Stop requires active 1v1 play'';
  end if;
  if v_self.character_key <> ''runner_zenith''
     or v_self.character_class <> ''runner'' then
    raise exception ''Only Zenith can activate Time Stop'';
  end if;
  if v_self.wave < 15 then
    raise exception ''Time Stop unlocks on wave 15'';
  end if;
  if v_self.zenith_time_stop_used then
    raise exception ''Time Stop was already used in this match'';
  end if;
  if p_score < v_self.score then
    raise exception ''Score cannot decrease'';
  end if;

  update public.multiplayer_players player
  set hearts = player.max_hearts,
      score = greatest(player.score, p_score) + 15000,
      zenith_time_stop_used = true,
      zenith_time_stop_until = v_until,
      obstacle_speed_multiplier = least(player.obstacle_speed_multiplier, .75),
      last_seen_at = v_now,
      updated_at = v_now
  where player.match_id = p_match_id and player.user_id = v_uid;

  update public.multiplayer_players player
  set zenith_time_stop_until = greatest(
        coalesce(player.zenith_time_stop_until, ''-infinity''::timestamptz),
        v_until
      ),
      updated_at = v_now
  where player.match_id = p_match_id
    and player.user_id <> v_uid
    and player.status = ''playing'';

  update public.multiplayer_matches match
  set last_activity_at = v_now where match.id = p_match_id;

  select * into v_self from public.multiplayer_players player
  where player.match_id = p_match_id and player.user_id = v_uid;
  return jsonb_build_object(
    ''match_id'', p_match_id,
    ''score'', v_self.score,
    ''hearts'', v_self.hearts,
    ''max_hearts'', v_self.max_hearts,
    ''time_stop_until'', v_self.zenith_time_stop_until,
    ''time_stop_used'', v_self.zenith_time_stop_used,
    ''obstacle_speed_multiplier'', v_self.obstacle_speed_multiplier
  );
end;
end
$runtime_guard$
';
 elsif (select md5(prosrc) from pg_proc where oid='public.activate_1v1_zenith_time_stop(uuid,bigint)'::regprocedure)<>'f0117de485a24e1c5dd8d1f10c16c629' then
  raise exception 'Unreviewed RPC source: %','activate_1v1_zenith_time_stop(uuid,bigint)';
 end if;

 if md5(pg_get_functiondef('public.activate_mastery_quest(text)'::regprocedure))='5c76058dc2384751153baba4590c99a3' then
  execute 'CREATE OR REPLACE FUNCTION public.activate_mastery_quest(p_character_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''''
AS $runtime_guard$
begin
  -- Pixel runtime boundary: before original variable initializers or writes.
  perform app_private.require_pixel_runtime();
  <<skyway_original>>
declare u uuid:=app_private.photon_user();
begin
 perform pg_advisory_xact_lock(hashtextextended(u::text,23));
 if not app_private.mastery_owns_character(u,p_character_key) then raise exception ''Character locked'';end if;
 if not exists(select 1 from app_private.player_mastery_quests where user_id=u and character_key=p_character_key and quest<3) then raise exception ''No incomplete quest for this character'';end if;
 -- Expiry releases abandoned/crashed sessions without crediting anything.
 -- Sign-out must retire auth immediately rather than wait for a network save.
 update app_private.mastery_sessions s set finished_at=clock_timestamp()
 where s.user_id=u and s.finished_at is null and (
  s.context_type=''trial'' and s.last_received_at<clock_timestamp()-interval ''60 seconds''
  or s.context_type=''endless'' and not exists(select 1 from public.player_progression_runs r where r.run_id=s.context_id and r.user_id=u and r.completed_at is null and r.heartbeat_active and r.last_heartbeat_at>=clock_timestamp()-interval ''60 seconds'')
  or s.context_type=''1v1'' and not exists(select 1 from public.multiplayer_players p join public.multiplayer_matches m on m.id=p.match_id
   join public.player_progression_1v1_activity a on a.match_id=p.match_id and a.user_id=p.user_id
   where p.match_id=s.context_id and p.user_id=u and m.finished_at is null and a.last_heartbeat_at>=clock_timestamp()-interval ''60 seconds''));
 if exists(select 1 from app_private.mastery_sessions where user_id=u and finished_at is null) then raise exception ''Finish the current run before switching quests'';end if;
 insert into app_private.player_mastery_preferences(user_id,active_character) values(u,p_character_key)
 on conflict(user_id) do update set active_character=excluded.active_character;
 return public.get_mastery_profile();
end;
end
$runtime_guard$
';
 elsif (select md5(prosrc) from pg_proc where oid='public.activate_mastery_quest(text)'::regprocedure)<>'c6badf748f32bf8cc3923436a4eaf055' then
  raise exception 'Unreviewed RPC source: %','activate_mastery_quest(text)';
 end if;

 if md5(pg_get_functiondef('public.admin_command_suggestions(text,text,uuid,integer)'::regprocedure))='196fdccbe87ce8aa5ec10b76b758bf80' then
  execute 'CREATE OR REPLACE FUNCTION public.admin_command_suggestions(p_fragment text DEFAULT ''''::text, p_kind text DEFAULT NULL::text, p_selected_user_id uuid DEFAULT NULL::uuid, p_limit integer DEFAULT 12)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''''
AS $runtime_guard$
begin
  -- Pixel runtime boundary: before original variable initializers or writes.
  perform app_private.require_pixel_runtime();
  <<skyway_original>>
declare
  v_fragment text := lower(trim(coalesce(p_fragment, '''')));
  v_kind text := lower(nullif(trim(p_kind), ''''));
  v_limit integer := greatest(1, least(coalesce(p_limit, 12), 25));
begin
  if not public.is_admin() then
    raise exception ''Admin access required'';
  end if;
  if v_kind is not null
     and v_kind not in (''character'', ''cosmetic'', ''player'', ''obstacle'', ''environment'') then
    raise exception ''Invalid suggestion kind'';
  end if;

  return jsonb_build_object(
    ''commands'', jsonb_build_array(
      ''/grant <character|cosmetic> [item] [username|email]'',
      ''/revoke <character|cosmetic> [item] [from username|email]'',
      ''/set <gems|high_score> <value> [username|email]'',
      ''/ban [account + device + leaderboard] for <duration|permanently>'',
      ''/bann [account + device + score] for <duration|permanently>'',
      ''/unban username/email''
    ),
    ''item_kinds'', jsonb_build_array(''character'', ''cosmetic''),
    ''stats'', jsonb_build_array(''gems'', ''high_score''),
    ''ban_scopes'', jsonb_build_array(''account'', ''device'', ''leaderboard''),
    ''duration_units'', jsonb_build_array(''years'', ''days'', ''hours'', ''minutes''),
    ''selected_user_id'', p_selected_user_id,
    ''items'', coalesce((
      select jsonb_agg(jsonb_build_object(
        ''item_key'', item.item_key,
        ''display_name'', item.display_name,
        ''command_kind'', case
          when item.item_type = ''character'' then ''character''
          else ''cosmetic''
        end,
        ''item_type'', item.item_type,
        ''rarity'', item.rarity,
        ''character_class'', item.character_class,
        ''owned'', case when p_selected_user_id is null then null else exists (
          select 1
          from public.player_unlocks unlock
          where unlock.user_id = p_selected_user_id
            and unlock.item_key = item.item_key
        ) end
      ) order by item.display_name)
      from (
        select catalog.*
        from public.extraction_catalog catalog
        where catalog.active
          and (
            v_kind is null
            or (v_kind = ''character'' and catalog.item_type = ''character'')
            or (v_kind = ''cosmetic'' and catalog.item_type <> ''character'')
            or catalog.item_type = v_kind
          )
          and (
            v_fragment = ''''
            or position(v_fragment in lower(catalog.display_name)) > 0
            or position(v_fragment in lower(catalog.item_key)) > 0
          )
        order by
          case
            when lower(catalog.display_name) = v_fragment then 0
            when lower(catalog.item_key) = v_fragment then 0
            else 1
          end,
          catalog.display_name
        limit v_limit
      ) item
    ), ''[]''::jsonb),
    ''players'', case
      when char_length(v_fragment) < 2 then ''[]''::jsonb
      else coalesce((
        select jsonb_agg(jsonb_build_object(
          ''user_id'', player.user_id,
          ''username'', player.username,
          ''email'', player.email
        ) order by player.username nulls last, player.email)
        from (
          select
            users.id as user_id,
            profile.username,
            lower(users.email)::text as email
          from neon_auth."user" users
          left join public.player_profiles profile on profile.user_id = users.id
          where position(v_fragment in lower(coalesce(users.email, ''''))) > 0
             or position(v_fragment in lower(coalesce(profile.username, ''''))) > 0
             or users.id::text = v_fragment
          order by
            case
              when lower(coalesce(users.email, '''')) = v_fragment then 0
              when lower(coalesce(profile.username, '''')) = v_fragment then 0
              else 1
            end,
            lower(coalesce(profile.username, users.email, users.id::text))
          limit v_limit
        ) player
      ), ''[]''::jsonb)
    end
  );
end;
end
$runtime_guard$
';
 elsif (select md5(prosrc) from pg_proc where oid='public.admin_command_suggestions(text,text,uuid,integer)'::regprocedure)<>'991cb01c281e429434d3c7a57c044a04' then
  raise exception 'Unreviewed RPC source: %','admin_command_suggestions(text,text,uuid,integer)';
 end if;

 if md5(pg_get_functiondef('public.admin_execute_player_command(text,uuid,text,text,text,bigint,text[],uuid,bigint,boolean,bigint,text,text)'::regprocedure))='a5039d2716c73dc97464894bdb7eff84' then
  execute 'CREATE OR REPLACE FUNCTION public.admin_execute_player_command(p_action text, p_target_user_id uuid, p_item_kind text DEFAULT NULL::text, p_item_key text DEFAULT NULL::text, p_stat_key text DEFAULT NULL::text, p_value bigint DEFAULT NULL::bigint, p_ban_scopes text[] DEFAULT NULL::text[], p_device_id uuid DEFAULT NULL::uuid, p_duration_seconds bigint DEFAULT NULL::bigint, p_permanent boolean DEFAULT false, p_ban_id bigint DEFAULT NULL::bigint, p_reason text DEFAULT NULL::text, p_command_text text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''''
AS $runtime_guard$
begin
  -- Pixel runtime boundary: before original variable initializers or writes.
  perform app_private.require_pixel_runtime();
  <<skyway_original>>
declare
  v_intercepted jsonb;
begin
  v_intercepted:=app_private.intercept_in_game_player_command(
    p_action,p_target_user_id,p_command_text,jsonb_build_object(
      ''item_kind'',p_item_kind,''item_key'',p_item_key,
      ''stat_key'',p_stat_key,''value'',p_value,
      ''ban_scopes'',p_ban_scopes,''device_id'',p_device_id,
      ''duration_seconds'',p_duration_seconds,''permanent'',p_permanent,
      ''ban_id'',p_ban_id,''reason'',p_reason
    )
  );
  if v_intercepted is not null then return v_intercepted; end if;
  return app_private.admin_execute_player_command_core(
    p_action,p_target_user_id,p_item_kind,p_item_key,p_stat_key,p_value,
    p_ban_scopes,p_device_id,p_duration_seconds,p_permanent,p_ban_id,
    p_reason,p_command_text
  );
end;
end
$runtime_guard$
';
 elsif (select md5(prosrc) from pg_proc where oid='public.admin_execute_player_command(text,uuid,text,text,text,bigint,text[],uuid,bigint,boolean,bigint,text,text)'::regprocedure)<>'bbd66fcb231c7a760ae3b97e0e5fbec8' then
  raise exception 'Unreviewed RPC source: %','admin_execute_player_command(text,uuid,text,text,text,bigint,text[],uuid,bigint,boolean,bigint,text,text)';
 end if;

 if md5(pg_get_functiondef('public.admin_get_player(uuid)'::regprocedure))='f384754d68052ea5f8b1629b9413c5da' then
  execute 'CREATE OR REPLACE FUNCTION public.admin_get_player(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''''
AS $runtime_guard$
begin
  -- Pixel runtime boundary: before original variable initializers or writes.
  perform app_private.require_pixel_runtime();
  <<skyway_original>>
declare
  v_result jsonb;
begin
  if not public.is_admin() then
    raise exception ''Admin access required'' using errcode=''42501'';
  end if;
  if p_user_id is null or not exists(
    select 1 from neon_auth."user" users where users.id=p_user_id
  ) then raise exception ''Player not found'' using errcode=''P0002''; end if;

  select jsonb_build_object(
    ''account'',jsonb_build_object(
      ''user_id'',users.id,''email'',lower(users.email),
      ''created_at'',users."createdAt",''last_sign_in_at'',(select max(session."createdAt") from neon_auth."session" session where session."userId"=users.id),
      ''email_confirmed_at'',null::timestamptz,
      ''admin_role'',coalesce((
        select admin.role from public.admin_users admin
        where admin.user_id=users.id limit 1
      ),''player''),
      ''account_banned'',app_private.has_active_ban(users.id,''account'',null),
      ''leaderboard_banned'',
        app_private.has_active_ban(users.id,''leaderboard'',null),
      ''is_online'',(presence.state->>''is_online'')::boolean
    ),
    ''presence'',presence.state,
    ''profile'',jsonb_build_object(
      ''username'',profile.username,
      ''username_changed_at'',profile.username_changed_at,
      ''created_at'',profile.created_at
    ),
    ''stats'',jsonb_build_object(
      ''total_gems'',coalesce(stats.total_gems,0),
      ''high_score'',coalesce(stats.high_score,0),
      ''updated_at'',stats.updated_at
    ),
    ''loadout'',jsonb_build_object(
      ''class_key'',coalesce(loadout.class_key,''runner''),
      ''character_key'',coalesce(loadout.character_key,''runner_ace''),
      ''player_cosmetic'',loadout.player_cosmetic,
      ''obstacle_cosmetic'',loadout.obstacle_cosmetic,
      ''environment_cosmetic'',loadout.environment_cosmetic,
      ''updated_at'',loadout.updated_at
    ),
    ''unlocks'',coalesce((
      select jsonb_agg(jsonb_build_object(
        ''item_key'',unlock.item_key,
        ''display_name'',coalesce(
          catalog.display_name,initcap(replace(unlock.item_key,''_'','' ''))
        ),
        ''item_type'',unlock.item_type,''rarity'',unlock.rarity,
        ''character_class'',catalog.character_class,
        ''weapon_name'',catalog.weapon_name,
        ''weapon_score_bonus'',catalog.weapon_score_bonus,
        ''unlocked_at'',unlock.unlocked_at
      ) order by unlock.item_type,unlock.unlocked_at,unlock.item_key)
      from public.player_unlocks unlock
      left join public.extraction_catalog catalog
        on catalog.item_key=unlock.item_key
      where unlock.user_id=users.id
    ),''[]''::jsonb),
    ''devices'',coalesce((
      select jsonb_agg(jsonb_build_object(
        ''device_id'',device.id,''token_hint'',device.token_hint,
        ''label'',device.label,''first_seen_at'',link.first_seen_at,
        ''last_seen_at'',link.last_seen_at,
        ''device_banned'',
          app_private.has_active_ban(users.id,''device'',device.id)
      ) order by link.last_seen_at desc,device.id)
      from public.player_device_links link
      join public.player_devices device on device.id=link.device_id
      where link.user_id=users.id
    ),''[]''::jsonb)
  ) into v_result
  from neon_auth."user" users
  left join public.player_profiles profile on profile.user_id=users.id
  left join public.player_stats stats on stats.user_id=users.id
  left join public.player_loadouts loadout on loadout.user_id=users.id
  cross join lateral(
    select app_private.player_presence_snapshot(users.id) as state
  ) presence
  where users.id=p_user_id;

  -- Update 2.3 mastery management follow-up: existing admin-only lookup.
  v_result:=v_result||jsonb_build_object(''masteries'',(
    select coalesce(jsonb_agg(jsonb_build_object(''character_key'',character_key,''quest'',quest,
      ''progress'',case when character_key=''runner_stride'' and quest=2 then jsonb_build_array(progress,progress_two) else jsonb_build_array(progress) end,
      ''complete'',quest=3,''mastered'',mastered,''masteryEnabled'',mastery_enabled,''flairRewriteEnabled'',flair_rewrite_enabled,
      ''mastered_at'',mastered_at) order by character_key),''[]''::jsonb)
    from app_private.player_mastery_quests where user_id=p_user_id));
  return v_result;

end;
end
$runtime_guard$
';
 elsif (select md5(prosrc) from pg_proc where oid='public.admin_get_player(uuid)'::regprocedure)<>'69483988c96f352a9167eb891008b7b4' then
  raise exception 'Unreviewed RPC source: %','admin_get_player(uuid)';
 end if;

 if md5(pg_get_functiondef('public.admin_get_player_record(uuid)'::regprocedure))='7baadda1a9868b656a95166482047333' then
  execute 'CREATE OR REPLACE FUNCTION public.admin_get_player_record(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''''
AS $runtime_guard$
begin
  -- Pixel runtime boundary: before original variable initializers or writes.
  perform app_private.require_pixel_runtime();
  <<skyway_original>>
declare
  v_result jsonb;
  v_history_start timestamptz:=now()-interval ''1 month'';
begin
  if not public.is_admin() then raise exception ''Admin access required''; end if;
  if p_user_id is null or not exists(
    select 1 from neon_auth."user" users where users.id=p_user_id
  ) then raise exception ''Player not found''; end if;

  with command_rows as(
    select audit.*,
      app_private.audit_ban_ids(audit.result) as attached_ban_ids
    from public.admin_command_audit audit
    where audit.target_user_id=p_user_id
  ),visible_commands as(
    select command.*
    from command_rows command
    where command.created_at>=v_history_start or exists(
      select 1 from public.player_bans ban
      where ban.id=any(command.attached_ban_ids)
        and (
          greatest(ban.created_at,coalesce(ban.revoked_at,ban.created_at))
            >=v_history_start
          or (ban.starts_at<=now() and ban.revoked_at is null
            and (ban.expires_at is null or ban.expires_at>now()))
        )
    )
  ),command_json as(
    select coalesce(jsonb_agg(jsonb_build_object(
      ''id'',command.id,''action'',command.action,
      ''command_text'',command.command_text,
      ''request'',command.request,''result'',command.result,
      ''succeeded'',command.succeeded,
      ''error_message'',command.error_message,
      ''created_at'',command.created_at,
      ''actor_user_id'',command.actor_user_id,
      ''actor_email'',command.actor_email,
      ''actor_username'',actor_profile.username,
      ''actor_role'',(
        select admin.role from public.admin_users admin
        where admin.user_id=command.actor_user_id
           or (admin.user_id is null
             and admin.email=lower(command.actor_email))
        order by (admin.user_id=command.actor_user_id) desc limit 1
      ),
      ''ban_note'',coalesce(
        nullif(command.result->>''ban_note'',''''),
        nullif(command.request->>''reason'',''''),
        (select string_agg(distinct ban.reason,'' / '' order by ban.reason)
         from public.player_bans ban
         where ban.id=any(command.attached_ban_ids))
      ),
      ''ban_scopes'',coalesce((
        select jsonb_agg(distinct ban.scope order by ban.scope)
        from public.player_bans ban
        where ban.id=any(command.attached_ban_ids)
      ),case when jsonb_typeof(command.request->''ban_scopes'')=''array''
        then command.request->''ban_scopes'' else ''[]''::jsonb end),
      ''ban_ids'',to_jsonb(command.attached_ban_ids),
      ''active_ban_count'',(
        select count(*) from public.player_bans ban
        where ban.id=any(command.attached_ban_ids)
          and ban.starts_at<=now() and ban.revoked_at is null
          and (ban.expires_at is null or ban.expires_at>now())
      ),
      ''bans'',coalesce((
        select jsonb_agg(jsonb_build_object(
          ''id'',ban.id,''scope'',ban.scope,
          ''device_id'',ban.target_device_id,''starts_at'',ban.starts_at,
          ''expires_at'',ban.expires_at,''reason'',ban.reason,
          ''created_at'',ban.created_at,
          ''active'',ban.revoked_at is null and ban.starts_at<=now()
            and (ban.expires_at is null or ban.expires_at>now()),
          ''revoked_at'',ban.revoked_at,''revoked_reason'',ban.revoked_reason
        ) order by ban.id)
        from public.player_bans ban
        where ban.id=any(command.attached_ban_ids)
      ),''[]''::jsonb)
    ) order by command.created_at desc,command.id desc),''[]''::jsonb) as value
    from visible_commands command
    left join public.player_profiles actor_profile
      on actor_profile.user_id=command.actor_user_id
  ),orphan_ban_json as(
    select coalesce(jsonb_agg(jsonb_build_object(
      ''id'',ban.id,''scope'',ban.scope,''device_id'',ban.target_device_id,
      ''starts_at'',ban.starts_at,''expires_at'',ban.expires_at,
      ''reason'',ban.reason,''created_at'',ban.created_at,
      ''active'',ban.revoked_at is null and ban.starts_at<=now()
        and (ban.expires_at is null or ban.expires_at>now()),
      ''created_by_user_id'',ban.created_by,
      ''created_by_email'',lower(created_actor.email),
      ''created_by_username'',created_profile.username,
      ''revoked_at'',ban.revoked_at,''revoked_reason'',ban.revoked_reason,
      ''revoked_by_user_id'',ban.revoked_by,
      ''revoked_by_email'',lower(revoked_actor.email),
      ''revoked_by_username'',revoked_profile.username
    ) order by greatest(ban.created_at,coalesce(ban.revoked_at,ban.created_at))
      desc,ban.id desc),''[]''::jsonb) as value
    from public.player_bans ban
    left join neon_auth."user" created_actor on created_actor.id=ban.created_by
    left join public.player_profiles created_profile
      on created_profile.user_id=ban.created_by
    left join neon_auth."user" revoked_actor on revoked_actor.id=ban.revoked_by
    left join public.player_profiles revoked_profile
      on revoked_profile.user_id=ban.revoked_by
    where (ban.target_user_id=p_user_id or exists(
      select 1 from public.player_device_links link
      where link.user_id=p_user_id and link.device_id=ban.target_device_id
    ))
      and (greatest(ban.created_at,coalesce(ban.revoked_at,ban.created_at))
        >=v_history_start or (
          ban.starts_at<=now() and ban.revoked_at is null
          and (ban.expires_at is null or ban.expires_at>now())
        ))
      and not exists(
        select 1 from command_rows command
        where ban.id=any(command.attached_ban_ids)
      )
  )
  select jsonb_build_object(
    ''history_window_started_at'',v_history_start,
    ''commands'',command_json.value,''bans'',orphan_ban_json.value
  ) into v_result
  from command_json cross join orphan_ban_json;
  return v_result;
end;
end
$runtime_guard$
';
 elsif (select md5(prosrc) from pg_proc where oid='public.admin_get_player_record(uuid)'::regprocedure)<>'d6b651f28d2469e9182a1d93216cdf16' then
  raise exception 'Unreviewed RPC source: %','admin_get_player_record(uuid)';
 end if;

 if md5(pg_get_functiondef('public.admin_player_command_v23(text,uuid,text,text,text,bigint,text[],uuid,bigint,boolean,bigint,text,text)'::regprocedure))='7925824222414ea9c84a216d3d9603b4' then
  execute 'CREATE OR REPLACE FUNCTION public.admin_player_command_v23(p_action text, p_target_user_id uuid, p_item_kind text DEFAULT NULL::text, p_item_key text DEFAULT NULL::text, p_stat_key text DEFAULT NULL::text, p_value bigint DEFAULT NULL::bigint, p_ban_scopes text[] DEFAULT NULL::text[], p_device_id uuid DEFAULT NULL::uuid, p_duration_seconds bigint DEFAULT NULL::bigint, p_permanent boolean DEFAULT false, p_ban_id bigint DEFAULT NULL::bigint, p_reason text DEFAULT NULL::text, p_command_text text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''''
AS $runtime_guard$
begin
  -- Pixel runtime boundary: before original variable initializers or writes.
  perform app_private.require_pixel_runtime();
  <<skyway_original>>
declare
  v_intercepted jsonb;
begin
  v_intercepted:=app_private.intercept_in_game_player_command(
    p_action,p_target_user_id,p_command_text,jsonb_build_object(
      ''item_kind'',p_item_kind,''item_key'',p_item_key,
      ''stat_key'',p_stat_key,''value'',p_value,
      ''ban_scopes'',p_ban_scopes,''device_id'',p_device_id,
      ''duration_seconds'',p_duration_seconds,''permanent'',p_permanent,
      ''ban_id'',p_ban_id,''reason'',p_reason
    )
  );
  if v_intercepted is not null then return v_intercepted; end if;
  return app_private.admin_player_command_v23_core(
    p_action,p_target_user_id,p_item_kind,p_item_key,p_stat_key,p_value,
    p_ban_scopes,p_device_id,p_duration_seconds,p_permanent,p_ban_id,
    p_reason,p_command_text
  );
end;
end
$runtime_guard$
';
 elsif (select md5(prosrc) from pg_proc where oid='public.admin_player_command_v23(text,uuid,text,text,text,bigint,text[],uuid,bigint,boolean,bigint,text,text)'::regprocedure)<>'459842372f493c4f384e0e0bd2369e3c' then
  raise exception 'Unreviewed RPC source: %','admin_player_command_v23(text,uuid,text,text,text,bigint,text[],uuid,bigint,boolean,bigint,text,text)';
 end if;

 if md5(pg_get_functiondef('public.admin_player_search(text,integer)'::regprocedure))='e8ba6a0ba010f7223f3234f10f9ffbde' then
  execute 'CREATE OR REPLACE FUNCTION public.admin_player_search(p_query text, p_limit integer DEFAULT 20)
 RETURNS TABLE(user_id uuid, username text, email text, created_at timestamp with time zone, last_sign_in_at timestamp with time zone, account_banned boolean, leaderboard_banned boolean, is_online boolean, presence_status text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''''
AS $runtime_guard$
begin
  -- Pixel runtime boundary: before original variable initializers or writes.
  perform app_private.require_pixel_runtime();
  <<skyway_original>>
declare
  v_query text:=lower(trim(coalesce(p_query,'''')));
  v_limit integer:=greatest(1,least(coalesce(p_limit,20),25));
begin
  if not public.is_admin() then raise exception ''Admin access required''; end if;
  if char_length(v_query)<2 then raise exception ''Enter at least 2 characters''; end if;

  return query
  select users.id,profile.username::text,lower(users.email)::text,
    users."createdAt",(select max(session."createdAt") from neon_auth."session" session where session."userId"=users.id),
    app_private.has_active_ban(users.id,''account'',null),
    app_private.has_active_ban(users.id,''leaderboard'',null),
    (presence.state->>''is_online'')::boolean,
    presence.state->>''status''
  from neon_auth."user" users
  left join public.player_profiles profile on profile.user_id=users.id
  cross join lateral(
    select app_private.player_presence_snapshot(users.id) as state
  ) presence
  where position(v_query in lower(coalesce(users.email,'''')))>0
     or position(v_query in lower(coalesce(profile.username,'''')))>0
     or users.id::text=v_query
  order by case
      when lower(coalesce(users.email,''''))=v_query then 0
      when lower(coalesce(profile.username,''''))=v_query then 0
      when users.id::text=v_query then 0 else 1 end,
    lower(coalesce(profile.username,users.email,users.id::text))
  limit v_limit;
end;
end
$runtime_guard$
';
 elsif (select md5(prosrc) from pg_proc where oid='public.admin_player_search(text,integer)'::regprocedure)<>'21ac275828cdb0e71a7215cb9764fe9b' then
  raise exception 'Unreviewed RPC source: %','admin_player_search(text,integer)';
 end if;

 if md5(pg_get_functiondef('public.admin_unban_player(uuid,text,text)'::regprocedure))='3c8282b3ac1dbdb9a1191fab326480a4' then
  execute 'CREATE OR REPLACE FUNCTION public.admin_unban_player(p_target_user_id uuid, p_reason text DEFAULT NULL::text, p_command_text text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''''
AS $runtime_guard$
begin
  -- Pixel runtime boundary: before original variable initializers or writes.
  perform app_private.require_pixel_runtime();
  <<skyway_original>>
declare
  v_intercepted jsonb;
begin
  v_intercepted:=app_private.intercept_in_game_player_command(
    ''unban'',p_target_user_id,p_command_text,
    jsonb_build_object(''reason'',p_reason)
  );
  if v_intercepted is not null then return v_intercepted; end if;
  return app_private.admin_unban_player_core(
    p_target_user_id,p_reason,p_command_text
  );
end;
end
$runtime_guard$
';
 elsif (select md5(prosrc) from pg_proc where oid='public.admin_unban_player(uuid,text,text)'::regprocedure)<>'be8587e6d321b82e298b313526801acf' then
  raise exception 'Unreviewed RPC source: %','admin_unban_player(uuid,text,text)';
 end if;

 if md5(pg_get_functiondef('public.apply_1v1_mirage_damage(uuid,numeric)'::regprocedure))='03e3ae2a03641b7085ec412a35dfd07f' then
  execute 'CREATE OR REPLACE FUNCTION public.apply_1v1_mirage_damage(p_match_id uuid, p_damage numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''''
AS $runtime_guard$
begin
  -- Pixel runtime boundary: before original variable initializers or writes.
  perform app_private.require_pixel_runtime();
  <<skyway_original>>
declare
  v_uid uuid := auth.uid();
  v_match public.multiplayer_matches;
  v_self public.multiplayer_players;
  v_opponent public.multiplayer_players;
  v_now timestamptz := clock_timestamp();
  v_effective_now timestamptz;
  v_next timestamptz;
  v_due integer := 0;
  v_applied numeric := 0;
  v_self_damage numeric := 0;
  v_opponent_after numeric;
  v_self_after numeric;
begin
  if v_uid is null then raise exception ''Sign in required''; end if;
  if p_damage is null or p_damage <= 0 or p_damage > 10
     or p_damage <> trunc(p_damage) then
    raise exception ''Invalid Mirage damage poll'';
  end if;
  select * into v_match from public.multiplayer_matches match_row
  where match_row.id = p_match_id for update;
  perform 1 from public.multiplayer_players player
  where player.match_id = p_match_id order by player.slot for update;
  select * into v_self from public.multiplayer_players player
  where player.match_id = p_match_id and player.user_id = v_uid;
  select * into v_opponent from public.multiplayer_players player
  where player.match_id = p_match_id and player.user_id <> v_uid limit 1;
  if v_match.id is null or v_self.user_id is null or v_opponent.user_id is null then
    raise exception ''1v1 match not found'';
  end if;
  if v_match.status not in (''playing'', ''intermission'') then
    raise exception ''This 1v1 match is not active'';
  end if;
  if v_self.character_key <> ''trickster_mirage''
     or v_self.mirage_started_at is null
     or v_self.mirage_active_until is null
     or v_self.mirage_exit_damage_applied then
    raise exception ''Mirage Invasion is not active'';
  end if;

  v_effective_now := least(v_now, v_self.mirage_active_until);
  if v_match.status = ''playing''
     and v_self.status = ''playing''
     and v_opponent.status = ''playing''
     and v_self.lane_index = v_opponent.lane_index then
    if v_self.mirage_matching_since_at is null then
      update public.multiplayer_players player
      set mirage_matching_since_at = v_effective_now,
          mirage_next_damage_at = v_effective_now + interval ''0.5 seconds'',
          updated_at = v_now
      where player.match_id = p_match_id and player.user_id = v_uid;
    else
      v_next := coalesce(
        v_self.mirage_next_damage_at,
        v_self.mirage_matching_since_at + interval ''0.5 seconds''
      );
      if v_next <= v_effective_now then
        v_due := 1 + floor(
          extract(epoch from (v_effective_now - v_next)) / 0.5
        )::integer;
        v_due := least(10, greatest(0, v_due));
        v_next := v_next + v_due * interval ''0.5 seconds'';
      end if;
      -- An invading Mirage is immune, including to another Mirage.
      if v_due > 0 and not (
        v_opponent.character_key = ''trickster_mirage''
        and v_opponent.mirage_active_until > v_now
        and not v_opponent.mirage_exit_damage_applied
      ) then
        v_applied := least(v_due::numeric, v_opponent.hearts);
        update public.multiplayer_players player
        set hearts = greatest(0, player.hearts - v_applied),
            last_damage_at = v_now,
            updated_at = v_now
        where player.match_id = p_match_id
          and player.user_id = v_opponent.user_id
        returning hearts into v_opponent_after;
      end if;
      update public.multiplayer_players player
      set mirage_next_damage_at = v_next,
          mirage_damage_dealt = player.mirage_damage_dealt + v_applied,
          last_seen_at = v_now,
          updated_at = v_now
      where player.match_id = p_match_id and player.user_id = v_uid;
      if coalesce(v_opponent_after, v_opponent.hearts) = 0
         and v_applied > 0 then
        perform app_private.mark_1v1_eliminated(
          p_match_id, v_opponent.user_id, v_now
        );
        perform app_private.finalize_1v1_after_second_death(
          p_match_id, v_now
        );
      end if;
    end if;
  else
    update public.multiplayer_players player
    set mirage_matching_since_at = null,
        mirage_next_damage_at = null,
        updated_at = v_now
    where player.match_id = p_match_id and player.user_id = v_uid;
  end if;

  if v_now >= v_self.mirage_active_until then
    v_self_damage := app_private.settle_1v1_mirage_exit(
      p_match_id, v_uid, v_now
    );
  end if;
  select player.hearts into v_self_after
  from public.multiplayer_players player
  where player.match_id = p_match_id and player.user_id = v_uid;
  select player.hearts into v_opponent_after
  from public.multiplayer_players player
  where player.match_id = p_match_id and player.user_id = v_opponent.user_id;
  update public.multiplayer_matches match_row
  set last_activity_at = v_now where match_row.id = p_match_id;
  return jsonb_build_object(
    ''match_id'', p_match_id,
    ''damage_applied'', v_applied,
    ''self_damage_applied'', v_self_damage,
    ''self_hearts'', v_self_after,
    ''opponent_hearts'', v_opponent_after,
    ''active'', v_now < v_self.mirage_active_until,
    ''ends_at'', v_self.mirage_active_until
  );
end;
end
$runtime_guard$
';
 elsif (select md5(prosrc) from pg_proc where oid='public.apply_1v1_mirage_damage(uuid,numeric)'::regprocedure)<>'8c06ef018003004265b4e007a38129bb' then
  raise exception 'Unreviewed RPC source: %','apply_1v1_mirage_damage(uuid,numeric)';
 end if;

 if md5(pg_get_functiondef('public.apply_mastery_heal(uuid,uuid,text)'::regprocedure))='2d50a0659c8f70b55d2ebddea2aa17ca' then
  execute 'CREATE OR REPLACE FUNCTION public.apply_mastery_heal(p_match_id uuid, p_event_id uuid, p_kind text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''''
AS $runtime_guard$
begin
  -- Pixel runtime boundary: before original variable initializers or writes.
  perform app_private.require_pixel_runtime();
  <<skyway_original>>
declare u uuid:=app_private.photon_user();p public.multiplayer_players;m public.multiplayer_matches;t app_private.mastery_heal_tokens;h numeric;
begin
 if p_event_id is null or p_kind is distinct from ''dash-green'' then raise exception ''Choose an eligible mastery heal event'';end if;
 perform pg_advisory_xact_lock(hashtextextended(u::text,23));
 select * into m from public.multiplayer_matches where id=p_match_id for update;
 select * into p from public.multiplayer_players where match_id=p_match_id and user_id=u for update;
 if m.id is null or p.user_id is null then raise exception ''Owned 1v1 match required'';end if;
 select * into t from app_private.mastery_heal_tokens where match_id=p_match_id and user_id=u and event_id=p_event_id and kind=p_kind for update;
 if t.event_id is null then raise exception ''A verified mastery block receipt is required'';end if;
 if t.consumed_at is not null then return jsonb_build_object(''hearts'',p.hearts,''duplicate'',true);end if;
 if t.created_at<clock_timestamp()-interval ''8 seconds'' then raise exception ''Mastery heal receipt expired'';end if;
 if m.status<>''playing'' or m.finished_at is not null or p.status<>''playing'' or p.hearts<=0 or p.test_mode or p.character_key<>''runner_dash''
  or not app_private.mastery_owns_character(u,''runner_dash'') or m.map_key=''desert'' then raise exception ''Mastery healing is not available in this match'';end if;
 if not exists(select 1 from app_private.player_mastery_quests where user_id=u and character_key=''runner_dash'' and mastered and mastery_enabled)
  or not exists(select 1 from app_private.mastery_sessions where id=t.session_id and user_id=u and context_id=p_match_id and context_type=''1v1'' and character_key=''runner_dash'' and finished_at is null)
  or not exists(select 1 from public.player_progression_1v1_activity where match_id=p_match_id and user_id=u and heartbeat_active and last_heartbeat_at>=clock_timestamp()-interval ''8 seconds'') then raise exception ''Active owned Dash mastery play is required'';end if;
 h:=least(p.max_hearts,p.hearts+1);
 update public.multiplayer_players set hearts=h,last_seen_at=clock_timestamp(),updated_at=clock_timestamp() where match_id=p_match_id and user_id=u;
 update app_private.mastery_heal_tokens set consumed_at=clock_timestamp(),hearts_after=h where match_id=p_match_id and user_id=u and event_id=p_event_id;
 return jsonb_build_object(''hearts'',h,''duplicate'',false,''healed'',h-p.hearts);
end;
end
$runtime_guard$
';
 elsif (select md5(prosrc) from pg_proc where oid='public.apply_mastery_heal(uuid,uuid,text)'::regprocedure)<>'964b54d79fdc9b49f865e89f698d08b0' then
  raise exception 'Unreviewed RPC source: %','apply_mastery_heal(uuid,uuid,text)';
 end if;

 if md5(pg_get_functiondef('public.award_1v1_mushroom(uuid,integer,text)'::regprocedure))='a7e0ced417532f86324ceaebdc0ae946' then
  execute 'CREATE OR REPLACE FUNCTION public.award_1v1_mushroom(p_match_id uuid, p_wave integer, p_pickup_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''''
AS $runtime_guard$
begin
  -- Pixel runtime boundary: before original variable initializers or writes.
  perform app_private.require_pixel_runtime();
  <<skyway_original>>
declare
  v_uid uuid := auth.uid();
  v_pickup_id text := trim(p_pickup_id);
  v_match public.multiplayer_matches;
  v_self public.multiplayer_players;
  v_inserted text;
  v_now timestamptz;
  v_active_seconds bigint;
  v_verified_wave integer;
  v_last_heartbeat timestamptz;
  v_heartbeat_active boolean;
  v_time_allowance bigint;
  v_wave_allowance bigint;
  v_allowed bigint;
  v_claimed bigint;
  v_recent_claims bigint;
  v_wave_mushrooms integer;
begin
  if v_uid is null then raise exception ''Sign in required''; end if;
  if p_wave is null or p_wave < 1 then raise exception ''Invalid mushroom wave''; end if;
  if v_pickup_id is null or length(v_pickup_id) not between 1 and 160 then
    raise exception ''A valid mushroom pickup id is required'';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 1));

  select * into v_match from public.multiplayer_matches
  where id = p_match_id for update;
  select * into v_self from public.multiplayer_players
  where match_id = p_match_id and user_id = v_uid for update;
  if v_match.id is null or v_self.user_id is null then
    raise exception ''1v1 match not found'';
  end if;

  if exists (
    select 1 from public.multiplayer_mushroom_events event
    where event.match_id = p_match_id and event.user_id = v_uid
      and event.pickup_id = v_pickup_id
  ) then
    select count(*)::integer into v_wave_mushrooms
    from public.multiplayer_mushroom_events event
    where event.match_id = p_match_id and event.user_id = v_uid
      and event.wave = p_wave;
    return jsonb_build_object(
      ''match_id'', p_match_id, ''map_key'', v_match.map_key,
      ''pickup_id'', v_pickup_id, ''duplicate'', true,
      ''awarded_score'', 0, ''score'', v_self.score,
      ''mushrooms_collected'', v_self.mushrooms_collected,
      ''wave_mushrooms'', v_wave_mushrooms,
      ''current_wave_mushrooms'', v_wave_mushrooms
    );
  end if;
  if v_match.map_key <> ''grove'' then
    raise exception ''Mushrooms are only available on Grove'';
  end if;
  if v_match.started_at <= now() - interval ''6 hours'' then
    raise exception ''1v1 match is too old for new mushroom receipts'';
  end if;
  if v_match.status <> ''playing'' or v_self.status <> ''playing'' then
    raise exception ''Mushrooms can only be collected during active 1v1 play'';
  end if;
  if p_wave <> v_self.wave or p_wave <> v_match.current_wave then
    raise exception ''Mushroom wave does not match active play'';
  end if;

  select activity.active_seconds, activity.verified_wave,
         activity.last_heartbeat_at, activity.heartbeat_active
  into v_active_seconds, v_verified_wave, v_last_heartbeat,
       v_heartbeat_active
  from public.player_progression_1v1_activity activity
  where activity.match_id = p_match_id and activity.user_id = v_uid
  for update;
  if not found then raise exception ''Mushrooms require active 1v1 play''; end if;
  v_now := clock_timestamp();
  if not coalesce(v_heartbeat_active, false)
     or v_last_heartbeat is null
     or v_last_heartbeat < v_now - interval ''8 seconds'' then
    raise exception ''Mushrooms require active 1v1 play'';
  end if;

  v_active_seconds := least(
    21600::bigint,
    greatest(0::bigint, coalesce(v_active_seconds, 0))
  );
  v_verified_wave := least(
    100000,
    greatest(1, coalesce(v_verified_wave, 1))
  );
  if p_wave > v_verified_wave then
    raise exception ''Mushroom wave is not server-verified'';
  end if;
  v_time_allowance := 2
    + floor(v_active_seconds::numeric / 0.75)::bigint;
  v_wave_allowance := 2 + v_verified_wave::bigint * 60;
  v_allowed := least(v_time_allowance, v_wave_allowance);
  select count(*) into v_claimed
  from public.multiplayer_point_events event
  where event.match_id = p_match_id and event.user_id = v_uid;
  select v_claimed + count(*) into v_claimed
  from public.multiplayer_mushroom_events event
  where event.match_id = p_match_id and event.user_id = v_uid;
  select v_claimed + count(*) into v_claimed
  from public.player_progression_events event
  where event.user_id = v_uid and event.source = ''gem''
    and event.metadata->>''context_id'' = p_match_id::text;
  if v_claimed >= v_allowed then raise exception ''Pickup allowance reached''; end if;

  select count(*) into v_recent_claims
  from public.multiplayer_point_events event
  where event.user_id = v_uid
    and event.created_at > v_now - interval ''1 second'';
  select v_recent_claims + count(*) into v_recent_claims
  from public.multiplayer_mushroom_events event
  where event.user_id = v_uid
    and event.created_at > v_now - interval ''1 second'';
  select v_recent_claims + count(*) into v_recent_claims
  from public.player_progression_events event
  where event.user_id = v_uid and event.source = ''gem''
    and event.metadata->>''context_id'' = p_match_id::text
    and event.created_at > v_now - interval ''1 second'';
  if v_recent_claims >= 3 then raise exception ''Pickups arrived too quickly''; end if;

  insert into public.multiplayer_mushroom_events(
    match_id, user_id, pickup_id, wave, score_awarded, created_at
  ) values (p_match_id, v_uid, v_pickup_id, p_wave, 120, v_now)
  on conflict (match_id, user_id, pickup_id) do nothing
  returning pickup_id into v_inserted;
  if v_inserted is not null then
    update public.multiplayer_players
    set score = score + 120,
        mushrooms_collected = mushrooms_collected + 1,
        last_seen_at = v_now,
        updated_at = v_now
    where match_id = p_match_id and user_id = v_uid;
    update public.multiplayer_matches set last_activity_at = v_now
    where id = p_match_id;
  end if;

  select * into v_self from public.multiplayer_players
  where match_id = p_match_id and user_id = v_uid;
  select count(*)::integer into v_wave_mushrooms
  from public.multiplayer_mushroom_events event
  where event.match_id = p_match_id and event.user_id = v_uid
    and event.wave = p_wave;
  return jsonb_build_object(
    ''match_id'', p_match_id, ''map_key'', v_match.map_key,
    ''pickup_id'', v_pickup_id, ''duplicate'', v_inserted is null,
    ''awarded_score'', case when v_inserted is null then 0 else 120 end,
    ''score'', v_self.score,
    ''mushrooms_collected'', v_self.mushrooms_collected,
    ''wave_mushrooms'', v_wave_mushrooms,
    ''current_wave_mushrooms'', v_wave_mushrooms,
    ''pickup_allowance'', v_allowed
  );
end;
end
$runtime_guard$
';
 elsif (select md5(prosrc) from pg_proc where oid='public.award_1v1_mushroom(uuid,integer,text)'::regprocedure)<>'106efc91501fc8711b2e59903085b4c8' then
  raise exception 'Unreviewed RPC source: %','award_1v1_mushroom(uuid,integer,text)';
 end if;

 if md5(pg_get_functiondef('public.award_completed_run(uuid,bigint,text)'::regprocedure))='a5c058cd6ee7afae1a1df82936513af6' then
  execute 'CREATE OR REPLACE FUNCTION public.award_completed_run(p_run_id uuid, p_score bigint, p_scope text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''''
AS $runtime_guard$
#variable_conflict use_column
begin
  if not public.skyway_runtime_admitted() then raise exception ''Sign in again with Pixel Pulse to continue'' using errcode=''42501'';end if;
  return (select public.award_completed_run_v2(p_run_id,p_score,p_scope));
end
$runtime_guard$
';
 elsif (select md5(prosrc) from pg_proc where oid='public.award_completed_run(uuid,bigint,text)'::regprocedure)<>'49824e7edf56f730da34c02bf8117738' then
  raise exception 'Unreviewed RPC source: %','award_completed_run(uuid,bigint,text)';
 end if;

 if md5(pg_get_functiondef('public.award_completed_run_v2(uuid,bigint,text)'::regprocedure))='b608465567cd5db892f5f87df7a29f8a' then
  execute 'CREATE OR REPLACE FUNCTION public.award_completed_run_v2(p_run_id uuid, p_score bigint, p_scope text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''''
AS $runtime_guard$
begin
  -- Pixel runtime boundary: before original variable initializers or writes.
  perform app_private.require_pixel_runtime();
  <<skyway_original>>
declare
  v_uid uuid:=auth.uid();
  v_scope text:=lower(trim(p_scope));
  v_high_score bigint;
  v_context_valid boolean;
begin
  if v_uid is null then raise exception ''Sign in required''; end if;
  if p_run_id is null then raise exception ''Run ID is required''; end if;
  if p_score is null or p_score<0 or p_score>1000000000 then
    raise exception ''Invalid run score'';
  end if;
  if v_scope is null
     or v_scope not in(''endless'',''casual_1v1'',''ranked_1v1'') then
    raise exception ''Invalid run type'';
  end if;
  if app_private.is_test_run_context(p_run_id,v_uid) then
    select case
      when v_scope=''endless'' then exists(
        select 1 from public.player_progression_runs run
        where run.run_id=p_run_id and run.user_id=v_uid and run.test_mode
      )
      else exists(
        select 1
        from public.multiplayer_matches match
        join public.multiplayer_players player
          on player.match_id=match.id and player.user_id=v_uid
        where match.id=p_run_id and player.test_mode
          and match.status=''finished''
          and v_scope=match.mode||''_1v1''
      )
    end into v_context_valid;
    if not v_context_valid then raise exception ''Invalid test run result''; end if;
    update public.player_progression_runs
    set completed_at=coalesce(completed_at,now()),claimed_score=p_score,
        credited_score=0,heartbeat_active=false
    where run_id=p_run_id and user_id=v_uid;
    select high_score into v_high_score
    from public.player_stats where user_id=v_uid;
    return public.get_player_progression()||jsonb_build_object(
      ''xp_awarded'',0,
      ''xp_breakdown'',jsonb_build_object(
        ''score'',0,''gems'',0,''gem_count'',0,''total'',0
      ),
      ''high_score'',coalesce(v_high_score,0),''test_mode'',true
    );
  end if;
  return app_private.award_completed_run_v2_live(p_run_id,p_score,v_scope);
end;
end
$runtime_guard$
';
 elsif (select md5(prosrc) from pg_proc where oid='public.award_completed_run_v2(uuid,bigint,text)'::regprocedure)<>'e080b242311ec01a06bd6fafc35cf6a8' then
  raise exception 'Unreviewed RPC source: %','award_completed_run_v2(uuid,bigint,text)';
 end if;

 if md5(pg_get_functiondef('public.ban_1v1_map(uuid,text)'::regprocedure))='13ae90929cad71c67a3a3b22e9ea61fc' then
  execute 'CREATE OR REPLACE FUNCTION public.ban_1v1_map(p_match_id uuid, p_map_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''''
AS $runtime_guard$
begin
  -- Pixel runtime boundary: before original variable initializers or writes.
  perform app_private.require_pixel_runtime();
  <<skyway_original>>
declare m public.multiplayer_matches;s app_private.match_setup_19;u uuid:=auth.uid();begin
 if u is null or not exists(select 1 from public.multiplayer_players where match_id=p_match_id and user_id=u) then raise exception ''Match not found'';end if;
 select * into m from public.multiplayer_matches where id=p_match_id for update;
 select * into s from app_private.match_setup_19 where match_id=p_match_id;
 if s.phase is distinct from ''ban'' or m.status<>''countdown'' or clock_timestamp()>=s.deadline then raise exception ''Map bans have ended'';end if;
 if not(p_map_key=any(m.map_candidates)) then raise exception ''Choose one of these four maps'';end if;
 insert into app_private.match_bans_19 values(p_match_id,u,p_map_key) on conflict(match_id,user_id) do update set map_key=excluded.map_key;
 return public.get_1v1_state(p_match_id);
end;
end
$runtime_guard$
';
 elsif (select md5(prosrc) from pg_proc where oid='public.ban_1v1_map(uuid,text)'::regprocedure)<>'e3b406ea1b9bbaa93b9cabc6c6bb793d' then
  raise exception 'Unreviewed RPC source: %','ban_1v1_map(uuid,text)';
 end if;

 if md5(pg_get_functiondef('public.begin_mastery_session(uuid,text,text,text)'::regprocedure))='4ccfb235c9ac80893664a4a9c9516886' then
  execute 'CREATE OR REPLACE FUNCTION public.begin_mastery_session(p_context_id uuid, p_context_type text, p_character_key text, p_trial_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''''
AS $runtime_guard$
begin
  -- Pixel runtime boundary: before original variable initializers or writes.
  perform app_private.require_pixel_runtime();
  <<skyway_original>>
declare u uuid:=app_private.photon_user();r uuid;c text;v_trial boolean:=p_trial_key is not null;q app_private.player_mastery_quests;f text;g numeric:=1;previous app_private.mastery_sessions;v_replay boolean:=false;
begin
 if not app_private.mastery_owns_character(u,p_character_key) then raise exception ''Character locked'';end if;
 if app_private.is_admin_test_user(u) then raise exception ''Test Mode runs do not progress mastery'';end if;
 if p_context_type is null or p_context_type not in(''endless'',''1v1'') or v_trial and (p_context_type<>''endless'' or p_trial_key<>p_character_key) then raise exception ''Invalid mastery context'';end if;
 perform pg_advisory_xact_lock(hashtextextended(u::text,23));
 select * into previous from app_private.mastery_sessions where user_id=u and context_id=p_context_id and character_key=p_character_key
  and context_type=case when v_trial then ''trial'' else p_context_type end and finished_at is null;
 if previous.id is not null then return jsonb_build_object(''session_id'',previous.id,''trial'',v_trial,''trial_replay'',previous.trial_replay,''last_seq'',previous.last_seq,''last_at'',previous.last_at,''profile'',public.get_mastery_profile());end if;
 if p_context_type=''endless'' then
  if not exists(select 1 from public.player_progression_runs where run_id=p_context_id and user_id=u and completed_at is null and not test_mode) then raise exception ''Owned active run receipt required'';end if;
  select character_key into c from public.player_loadouts where user_id=u;
  if not v_trial and coalesce(c,''runner_ace'')<>p_character_key and not exists(select 1 from app_private.player_mastery_preferences where user_id=u and endless_randomizer) then raise exception ''Mastery character does not match the run loadout'';end if;
 elsif p_context_type=''1v1'' then
  if not exists(select 1 from public.multiplayer_players p join public.multiplayer_matches m on m.id=p.match_id
   where p.match_id=p_context_id and p.user_id=u and p.character_key=p_character_key and not p.test_mode and m.finished_at is null) then raise exception ''Owned active match required'';end if;
 end if;
 if v_trial then
  select * into q from app_private.player_mastery_quests where user_id=u and character_key=p_character_key;
  if q.quest is distinct from 3 then raise exception ''Finish all three quests before entering the trial'';end if;
  v_replay:=q.mastered;
  -- An ordinary owned server run receipt is irreversibly marked nonrewarding
  -- before the trial begins. Existing native reward/test guards cover direct
  -- RPC calls as well as this UI; no admin permission or preference changes.
  update public.player_progression_runs set test_mode=true where run_id=p_context_id and user_id=u and completed_at is null;
  if not found then raise exception ''Owned active trial run required'';end if;
 end if;
 -- Closing a stale session keeps only one active per player and does not grant completion.
 update app_private.mastery_sessions set finished_at=clock_timestamp() where user_id=u and finished_at is null;
 if not v_trial then
  update app_private.player_mastery_quests set progress=0,progress_two=0 where user_id=u and character_key=p_character_key
   and ((character_key=''runner_dash'' and quest=1) or (character_key in(''runner_stride'',''medic_bloom'',''runner_vault'') and quest=2));
 end if;
 select flair_character into f from app_private.player_mastery_preferences where user_id=u;
 if not coalesce(app_private.mastery_owns_character(u,f),false) then f:=p_character_key;end if;
 if f=''medic_bloom'' and exists(select 1 from app_private.player_mastery_quests where user_id=u and character_key=f and mastered and flair_rewrite_enabled) then g:=case when f=p_character_key then 1.35 else 1.25 end;end if;
 -- Update 2.3 mastery management follow-up: replay is server-bound to this nonrewarding owned trial.
 insert into app_private.mastery_sessions(user_id,context_id,context_type,character_key,flair_character,gem_multiplier,trial_replay) values(u,p_context_id,case when v_trial then ''trial'' else p_context_type end,p_character_key,f,g,v_replay) returning id into r;
 return jsonb_build_object(''session_id'',r,''trial'',v_trial,''trial_replay'',v_replay,''last_seq'',0,''last_at'',0,''profile'',public.get_mastery_profile());
end;
end
$runtime_guard$
';
 elsif (select md5(prosrc) from pg_proc where oid='public.begin_mastery_session(uuid,text,text,text)'::regprocedure)<>'d711a403449df664269b6d9eccbd2179' then
  raise exception 'Unreviewed RPC source: %','begin_mastery_session(uuid,text,text,text)';
 end if;

 if md5(pg_get_functiondef('public.begin_mastery_smoke_charge(uuid,uuid)'::regprocedure))='52938ab7087e09bb5821fd4b730ad2ef' then
  execute 'CREATE OR REPLACE FUNCTION public.begin_mastery_smoke_charge(p_match_id uuid, p_action_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''''
AS $runtime_guard$
begin
  -- Pixel runtime boundary: before original variable initializers or writes.
  perform app_private.require_pixel_runtime();
  <<skyway_original>>
declare u uuid:=app_private.photon_user();a jsonb;s app_private.mastery_smoke_state;r app_private.mastery_smoke_actions;
begin
 if p_action_id is null then raise exception ''Smoke action ID required'';end if;
 perform pg_advisory_xact_lock(hashtextextended(u::text,23));
 a:=app_private.mastery_smoke_actor(p_match_id);
 select * into r from app_private.mastery_smoke_actions where match_id=p_match_id and user_id=u and action_id=p_action_id;
 if found then return r.reply||jsonb_build_object(''already_used'',true);end if;
 insert into app_private.mastery_smoke_state(match_id,user_id,wave) values(p_match_id,u,(a->>''wave'')::integer) on conflict do nothing;
 select * into s from app_private.mastery_smoke_state where match_id=p_match_id and user_id=u for update;
 if s.wave<>(a->>''wave'')::integer then s.wave:=(a->>''wave'')::integer;s.bombs_used:=0;s.charge_action_id:=null;s.charge_started_at:=null;end if;
 if s.cooldown_until>clock_timestamp() then raise exception ''Smoke is cooling down'';end if;
 if (a->>''mastered'')::boolean and s.bombs_used>=3 then raise exception ''All three smoke bombs were used this wave'';end if;
 if s.charge_action_id is distinct from p_action_id then s.charge_action_id:=p_action_id;s.charge_started_at:=clock_timestamp();s.charge_active_seconds:=(a->>''active_seconds'')::bigint;end if;
 update app_private.mastery_smoke_state set wave=s.wave,bombs_used=s.bombs_used,charge_action_id=s.charge_action_id,charge_started_at=s.charge_started_at,charge_active_seconds=s.charge_active_seconds where match_id=p_match_id and user_id=u;
 return jsonb_build_object(''action_id'',p_action_id,''charge_started_at'',s.charge_started_at,''bombs_remaining'',case when (a->>''mastered'')::boolean then 3-s.bombs_used else null end);
end;
end
$runtime_guard$
';
 elsif (select md5(prosrc) from pg_proc where oid='public.begin_mastery_smoke_charge(uuid,uuid)'::regprocedure)<>'5caf79f85f2d9e7989156e40e6697b4d' then
  raise exception 'Unreviewed RPC source: %','begin_mastery_smoke_charge(uuid,uuid)';
 end if;

 if md5(pg_get_functiondef('public.begin_photon_character_run(text)'::regprocedure))='501d922cf618dce27eef170740c3183f' then
  execute 'CREATE OR REPLACE FUNCTION public.begin_photon_character_run(p_character_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''''
AS $runtime_guard$
begin
  -- Pixel runtime boundary: before original variable initializers or writes.
  perform app_private.require_pixel_runtime();
  <<skyway_original>>
declare u uuid:=app_private.photon_user();k text:=p_character_key;c record;p jsonb;w text;
begin
 if not app_private.owns_photon_character(u,k) then raise exception ''Character locked'';end if;
 select * into c from app_private.photon_character_rules(k);
 select selected_weapon_key into w from public.player_photon_fury where user_id=u;
 if w is null or not exists(select 1 from app_private.photon_weapon_rules(w))
  or not app_private.photon_weapon_compatible(w,k)
  or(w<>''lightsaber'' and not exists(select 1 from app_private.photon_unlocks where user_id=u and kind=''weapon'' and item_key=''photon_weapon_''||w)) then w:=''lightsaber'';end if;
 p:=public.begin_photon_fury_run();
 update app_private.photon_fury_runs set character_key=c.character_key,weapon_key=w,rules_version=20261017,
  saber_cooldown_seconds=c.cooldown_seconds,bonus_point_seconds=c.bonus_point_seconds,
  point_multiplier=case when k=''photon_burner'' then 2 else 1 end where id=(p->>''run_id'')::uuid and user_id=u;
 return p||jsonb_build_object(''character_key'',k,''weapon_key'',w,''rules_version'',20261017);
end;
end
$runtime_guard$
';
 elsif (select md5(prosrc) from pg_proc where oid='public.begin_photon_character_run(text)'::regprocedure)<>'e38d8399f4503ac3e4c1d25802643c19' then
  raise exception 'Unreviewed RPC source: %','begin_photon_character_run(text)';
 end if;

 if md5(pg_get_functiondef('public.begin_photon_fury_run()'::regprocedure))='cae6381056fbbe7927794e46f5d5ad3c' then
  execute 'CREATE OR REPLACE FUNCTION public.begin_photon_fury_run()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''''
AS $runtime_guard$
begin
  -- Pixel runtime boundary: before original variable initializers or writes.
  perform app_private.require_pixel_runtime();
  <<skyway_original>>
declare u uuid:=app_private.photon_user();r uuid;begin if not exists(select 1 from public.player_photon_fury where user_id=u and unlocked_at is not null)then raise exception ''Mode locked'';end if;perform pg_advisory_xact_lock(hashtextextended(u::text,803100));if exists(select 1 from app_private.photon_fury_runs where user_id=u and started_at>clock_timestamp()-interval ''1s'')then raise exception ''Wait 1s'';end if;if app_private.is_admin_test_user(u)then raise exception ''Test run'';end if;update app_private.photon_fury_runs set finished_at=clock_timestamp(),active_seconds=0,reflections=0,awarded=0 where user_id=u and finished_at is null;insert into app_private.photon_fury_runs(user_id)values(u)returning id into r;return jsonb_build_object(''run_id'',r);end;
end
$runtime_guard$
';
 elsif (select md5(prosrc) from pg_proc where oid='public.begin_photon_fury_run()'::regprocedure)<>'c8898941577c541f9d0eaa70bd259cee' then
  raise exception 'Unreviewed RPC source: %','begin_photon_fury_run()';
 end if;

 if md5(pg_get_functiondef('public.choose_1v1_character(uuid,text)'::regprocedure))='ab8c932d964fc343a67295f7ebdf4329' then
  execute 'CREATE OR REPLACE FUNCTION public.choose_1v1_character(p_match_id uuid, p_character_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''''
AS $runtime_guard$
begin
  -- Pixel runtime boundary: before original variable initializers or writes.
  perform app_private.require_pixel_runtime();
  <<skyway_original>>
declare u uuid:=auth.uid();m public.multiplayer_matches;s app_private.match_setup_19;c public.extraction_catalog;h record;r app_private.one_v_one_map_rules;begin
 if u is null or not exists(select 1 from public.multiplayer_players where match_id=p_match_id and user_id=u) then raise exception ''Match not found'';end if;
 select * into m from public.multiplayer_matches where id=p_match_id for update;
 select * into s from app_private.match_setup_19 where match_id=p_match_id;
 if m.status<>''countdown'' or s.phase is distinct from ''character'' or clock_timestamp()>=s.deadline then raise exception ''Character selection has ended'';end if;
 if app_private.has_active_ban(u,''account'',null) then raise exception ''This account is banned'';end if;
 select * into c from public.extraction_catalog where item_key=p_character_key and item_type=''character'' and active;
 select * into r from app_private.one_v_one_map_rules where map_key=m.map_key;
 if c.item_key is null or not exists(select 1 from public.player_unlocks where user_id=u and item_key=c.item_key and item_type=''character'') then raise exception ''You do not own this character'';end if;
 if r.forced_character_key is not null or not(c.character_class=any(r.allowed_character_classes)) then raise exception ''Character is not allowed on this map'';end if;
 if not app_private.duel_character_allowed_23(m.mode,c.item_key) then raise exception ''Character is not allowed in this duel mode'';end if;
 -- QOL Ruins ownership restrictions
if m.map_key=''ruins'' and (c.rarity=''mythic'' or exists(select 1 from app_private.ruins_character_bans where match_id=p_match_id and character_key=c.item_key)) then raise exception ''Character is banned on Ruins for this match'';end if;
select * into h from app_private.character_selection_snapshot(u,m.map_key,c.item_key);
 update public.multiplayer_players set character_key=h.character_key,character_class=h.character_class,max_hearts=h.max_hearts,hearts=h.starting_hearts,character_confirmed=true,last_seen_at=clock_timestamp() where match_id=p_match_id and user_id=u;
 return public.get_1v1_state(p_match_id);
end;
end
$runtime_guard$
';
 elsif (select md5(prosrc) from pg_proc where oid='public.choose_1v1_character(uuid,text)'::regprocedure)<>'7584224f502f02fd110869e351d5e505' then
  raise exception 'Unreviewed RPC source: %','choose_1v1_character(uuid,text)';
 end if;

 if md5(pg_get_functiondef('public.claim_mastery_blue_gem(uuid,text)'::regprocedure))='7449095175d9e3e9b24645453fddf63f' then
  execute 'CREATE OR REPLACE FUNCTION public.claim_mastery_blue_gem(p_context_id uuid, p_pickup_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''''
AS $runtime_guard$
begin
  -- Pixel runtime boundary: before original variable initializers or writes.
  perform app_private.require_pixel_runtime();
  <<skyway_original>>
declare u uuid:=app_private.photon_user();s app_private.mastery_sessions;w integer;current_count bigint;target bigint;counter_before bigint;r jsonb;
begin
 if p_context_id is null or p_pickup_id is null or length(trim(p_pickup_id)) not between 1 and 120 then raise exception ''Valid Gem context and pickup ID required'';end if;
 -- Use the existing Gem receipt serialization first; a lost-response retry
 -- cannot advance the chain, consume another blue slot, or grant twice.
 perform pg_advisory_xact_lock(hashtextextended(u::text,1));
 if exists(select 1 from public.player_progression_events where user_id=u and source=''gem'' and source_key=p_context_id::text||'':''||trim(p_pickup_id)) then return public.claim_player_gem(p_context_id,p_pickup_id);end if;
 perform pg_advisory_xact_lock(hashtextextended(u::text,23));
 select * into s from app_private.mastery_sessions where user_id=u and context_id=p_context_id and finished_at is null and context_type in(''endless'',''1v1'') for update;
 if s.id is null or s.character_key<>''tank_guard'' or not app_private.mastery_owns_character(u,''tank_guard'') then raise exception ''Active Guard mode required for a blue Gem'';end if;
 if not exists(select 1 from app_private.player_mastery_quests where user_id=u and character_key=''tank_guard'' and mastered and mastery_enabled) then raise exception ''Complete and enable Guard mastery first'';end if;
 if s.context_type=''1v1'' then
  -- 1v1 has no Endless streak and never earns Endless XP. The regular own-match
  -- pickup function still controls its permanent Gem receipt and currency.
  return public.claim_player_gem(p_context_id,p_pickup_id);
 end if;
 select verified_wave into w from public.player_progression_runs where run_id=p_context_id and user_id=u and completed_at is null and not test_mode and heartbeat_active and last_heartbeat_at>=clock_timestamp()-interval ''8 seconds'' for update;
 if w is null then raise exception ''Blue Gems require recent active Endless play'';end if;
 -- Objects spawned while GUARD was enabled remain blue when the player
 -- switches back. Turning it off never clears their already-earned eligibility.
 if not s.guard_mode and s.guard_eligible_wave<>w then raise exception ''Active Guard mode required for a blue Gem'';end if;
 if s.guard_blue_wave<>w then s.guard_blue_wave:=w;s.guard_blue_gems:=0;end if;
 if s.guard_blue_gems>=2 then raise exception ''Only two blue objects can appear per wave'';end if;
 select streak into current_count from public.player_endless_gem_streaks where run_id=p_context_id and user_id=u for update;
 if not found then select count(*) into current_count from public.player_progression_events where user_id=u and source=''gem'' and metadata->>''context_id''=p_context_id::text and metadata->>''context_type''=''endless'';end if;
 -- Blue pickup replaces the normal +1 tier with +2 tiers: current x2 -> x4.
 -- Encode the target back into the preserved five-pickup x5 plateau counter.
 target:=app_private.endless_gem_streak_award(coalesce(current_count,0))+2;
 counter_before:=case when target<=5 then target-1 else target+4 end;
 insert into public.player_endless_gem_streaks(run_id,user_id,wave,streak,updated_at) values(p_context_id,u,w,counter_before,clock_timestamp())
 on conflict(run_id) do update set wave=excluded.wave,streak=excluded.streak,updated_at=excluded.updated_at where public.player_endless_gem_streaks.user_id=u;
 r:=public.claim_player_gem(p_context_id,p_pickup_id);
 if (r->>''is_new'')::boolean is not true or (r->>''test_mode'')::boolean is true then raise exception ''Blue Gem requires a new active physical pickup'';end if;
 update app_private.mastery_sessions set guard_blue_wave=w,guard_blue_gems=s.guard_blue_gems+1 where id=s.id;
 update public.player_progression_events set metadata=metadata||jsonb_build_object(''guard_blue'',true,''guard_blue_tier'',target) where user_id=u and source=''gem'' and source_key=p_context_id::text||'':''||trim(p_pickup_id);
 return r||jsonb_build_object(''guard_blue'',true,''guard_blue_tier'',target);
end;
end
$runtime_guard$
';
 elsif (select md5(prosrc) from pg_proc where oid='public.claim_mastery_blue_gem(uuid,text)'::regprocedure)<>'a71cd38b884521ea1bc25a93d904d87e' then
  raise exception 'Unreviewed RPC source: %','claim_mastery_blue_gem(uuid,text)';
 end if;

 if md5(pg_get_functiondef('public.claim_player_gem(uuid,text)'::regprocedure))='1b7748b1ffcbda1bb41561bf1a63f85f' then
  execute 'CREATE OR REPLACE FUNCTION public.claim_player_gem(p_context_id uuid, p_pickup_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''''
AS $runtime_guard$
begin
  -- Pixel runtime boundary: before original variable initializers or writes.
  perform app_private.require_pixel_runtime();
  <<skyway_original>>
declare u uuid:=app_private.photon_user();r jsonb;s app_private.mastery_sessions;extra bigint;carry numeric;total bigint;awarded bigint;
begin
 -- Existing implementation validates own active receipt, freshness, rate and
 -- duplicate pickup ID, and grants no currency for a marked mastery trial.
 r:=app_private.claim_player_gem_before_mastery_flairs(p_context_id,p_pickup_id);
 if (r->>''is_new'')::boolean is not true or (r->>''test_mode'')::boolean is true then return r;end if;
 select * into s from app_private.mastery_sessions where user_id=u and context_id=p_context_id
  and context_type in(''endless'',''1v1'') and finished_at is null order by started_at desc limit 1 for update;
 if s.id is null or s.gem_multiplier<=1 or not app_private.mastery_owns_character(u,s.flair_character) then return r;end if;
 awarded:=coalesce((r->>''gems_awarded'')::bigint,0);
 if awarded<0 or awarded>1000000000 then raise exception ''Unexpected verified gem reward'';end if;
 carry:=s.gem_fraction+awarded*(s.gem_multiplier-1);extra:=floor(carry)::bigint;
 update app_private.mastery_sessions set gem_fraction=carry-extra where id=s.id;
 if extra>0 then
  update public.player_stats set total_gems=total_gems+extra,updated_at=clock_timestamp() where user_id=u returning total_gems into total;
 else select total_gems into total from public.player_stats where user_id=u;end if;
 -- The same atomic physical-pickup receipt carries its final whole reward.
 -- A lost-response retry is handled by the original idempotent implementation.
 update public.player_progression_events set metadata=metadata||jsonb_build_object(''gems_awarded'',awarded+extra,''flair_extra_gems'',extra,''flair_multiplier'',s.gem_multiplier)
 where user_id=u and source=''gem'' and source_key=p_context_id::text||'':''||trim(p_pickup_id);
 return r||jsonb_build_object(''total_gems'',total,''gems_awarded'',awarded+extra);
end;
end
$runtime_guard$
';
 elsif (select md5(prosrc) from pg_proc where oid='public.claim_player_gem(uuid,text)'::regprocedure)<>'a530aad1a79f6b33c5295669016a0937' then
  raise exception 'Unreviewed RPC source: %','claim_player_gem(uuid,text)';
 end if;

 if md5(pg_get_functiondef('public.consume_1v1_heatfeast(uuid,integer)'::regprocedure))='8868b87adb1a869f0bcf1d2f360bd338' then
  execute 'CREATE OR REPLACE FUNCTION public.consume_1v1_heatfeast(p_match_id uuid, p_amount integer DEFAULT 100)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''''
AS $runtime_guard$
begin
  -- Pixel runtime boundary: before original variable initializers or writes.
  perform app_private.require_pixel_runtime();
  <<skyway_original>>
declare
  v_uid uuid := auth.uid();
  v_match public.multiplayer_matches;
  v_self public.multiplayer_players;
  v_ledger public.multiplayer_heatfeast;
  v_used numeric := 0;
  v_amount numeric := 0;
  v_now timestamptz := clock_timestamp();
begin
  if v_uid is null then raise exception ''Sign in required''; end if;
  if p_amount is null or p_amount < 1 or p_amount > 100 then
    raise exception ''HEATFEAST consumption must be between 1 and 100'';
  end if;
  select * into v_match from public.multiplayer_matches match_row
  where match_row.id = p_match_id for update;
  select * into v_self from public.multiplayer_players player
  where player.match_id = p_match_id and player.user_id = v_uid
  for update;
  if v_match.id is null or v_self.user_id is null then
    raise exception ''1v1 match not found'';
  end if;
  if v_match.status not in (''playing'', ''intermission'')
     or v_self.status not in (''playing'', ''intermission'') then
    raise exception ''HEATFEAST is only available during an active 1v1'';
  end if;
  if v_self.character_key <> ''runner_comet'' then
    raise exception ''Only Comet can consume HEATFEAST'';
  end if;

  insert into public.multiplayer_heatfeast(match_id)
  values (p_match_id) on conflict (match_id) do nothing;
  select * into v_ledger from public.multiplayer_heatfeast ledger
  where ledger.match_id = p_match_id for update;
  select usage.consumed into v_used
  from public.multiplayer_heatfeast_wave_usage usage
  where usage.match_id = p_match_id and usage.user_id = v_uid
    and usage.wave = v_self.wave for update;
  v_used := coalesce(v_used, 0);
  v_amount := least(
    p_amount::numeric,
    greatest(0, 100 - v_used),
    v_ledger.stored
  );
  if v_amount > 0 then
    insert into public.multiplayer_heatfeast_wave_usage(
      match_id, user_id, wave, consumed, updated_at
    ) values (
      p_match_id, v_uid, v_self.wave, v_amount, v_now
    )
    on conflict (match_id, user_id, wave) do update
      set consumed = public.multiplayer_heatfeast_wave_usage.consumed
            + excluded.consumed,
          updated_at = excluded.updated_at;
    update public.multiplayer_heatfeast ledger
    set stored = ledger.stored - v_amount,
        consumed = ledger.consumed + v_amount,
        updated_at = v_now
    where ledger.match_id = p_match_id;
    update public.multiplayer_matches match_row
    set last_activity_at = v_now where match_row.id = p_match_id;
  end if;
  return app_private.one_v_one_heatfeast_json(
    p_match_id, v_uid, v_self.wave
  ) || jsonb_build_object(''amount'', v_amount, ''match_id'', p_match_id);
end;
end
$runtime_guard$
';
 elsif (select md5(prosrc) from pg_proc where oid='public.consume_1v1_heatfeast(uuid,integer)'::regprocedure)<>'2da286ed3933bb3821a4752526d9a397' then
  raise exception 'Unreviewed RPC source: %','consume_1v1_heatfeast(uuid,integer)';
 end if;

 if md5(pg_get_functiondef('public.credit_mastery_events(uuid,jsonb)'::regprocedure))='f8304bb2602c5ac8784647b249c08f21' then
  execute 'CREATE OR REPLACE FUNCTION public.credit_mastery_events(p_session_id uuid, p_batch jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''''
AS $runtime_guard$
begin
  -- Pixel runtime boundary: before original variable initializers or writes.
  perform app_private.require_pixel_runtime();
  <<skyway_original>>
declare u uuid:=app_private.photon_user();s app_private.mastery_sessions;q app_private.player_mastery_quests;
 e jsonb;t text;n integer;a numeric;dt numeric;amount numeric;hp numeric;d numeric;b numeric;event_count integer;event_limit numeric;verified_seconds bigint;
 wave integer;active_key text;target numeric;prior numeric;v_progress numeric;v_two numeric;v_quest integer;risk numeric;ratio numeric;
begin
 if jsonb_typeof(p_batch)<>''array'' or jsonb_array_length(p_batch)>512 or octet_length(p_batch::text)>262144 then raise exception ''Invalid mastery event batch'';end if;
 perform pg_advisory_xact_lock(hashtextextended(u::text,23));
 select * into s from app_private.mastery_sessions where id=p_session_id and user_id=u for update;
 if s.id is null then raise exception ''Owned mastery session not found'';end if;
 if s.finished_at is not null then return public.get_mastery_profile()||jsonb_build_object(''already_finished'',true);end if;
 if not app_private.mastery_owns_character(u,s.character_key) or app_private.is_admin_test_user(u) then raise exception ''Mastery session no longer eligible'';end if;
 if s.context_type=''endless'' then
  select active_seconds into verified_seconds from public.player_progression_runs where run_id=s.context_id and user_id=u and not test_mode;
  if verified_seconds is null then raise exception ''Owned progression receipt required'';end if;
 elsif s.context_type=''1v1'' then
  select a.active_seconds into verified_seconds from public.player_progression_1v1_activity a
   join public.multiplayer_players p on p.match_id=a.match_id and p.user_id=a.user_id
   where a.match_id=s.context_id and a.user_id=u and p.character_key=s.character_key and not p.test_mode;
  if verified_seconds is null then raise exception ''Owned match activity receipt required'';end if;
 end if;
 select active_character into active_key from app_private.player_mastery_preferences where user_id=u;
 for e in select value from jsonb_array_elements(p_batch) loop
  if jsonb_typeof(e)<>''object'' or not coalesce(e->>''seq'','''')~''^[0-9]{1,8}$'' then raise exception ''Invalid mastery event sequence'';end if;
  n:=(e->>''seq'')::integer;
  if n<=s.last_seq then continue;end if;
  if n<>s.last_seq+1 then raise exception ''Mastery event sequence gap'';end if;
  a:=(e->>''at'')::numeric;
  if a is null or a=''NaN''::numeric or a<s.last_at or a>21600 or a>extract(epoch from clock_timestamp()-s.started_at)+2 then raise exception ''Invalid mastery event clock'';end if;
  if s.context_type<>''trial'' and a>verified_seconds+8 then raise exception ''Mastery progress exceeded verified playtime'';end if;
  s.last_at:=a;s.last_seq:=n;s.events:=s.events+1;
  if s.events>ceil((a+2)*120) then raise exception ''Mastery event rate exceeded'';end if;
  t:=e->>''type'';
  if t not in(''dash'',''lane-change'',''block'',''gem'',''heal'',''snowflake'',''frame'',''salve-heal'',''wave'',''vault'',''damage'',''smoke'',''run-start'',''run-end'',''trial-special'',''trial-gem'',''trial-vault'',''trial-wave'',''trial-died'') then raise exception ''Unknown mastery event'';end if;
  event_count:=coalesce((s.event_counts->>t)::integer,0)+1;
  event_limit:=case t when ''dash'' then 1+floor(a/2) when ''lane-change'' then 2+floor(a*10)
   when ''smoke'' then 1+floor(a/5) when ''salve-heal'' then 2+floor(a/10)
   when ''block'' then 3+floor(a*4) when ''heal'' then 3+floor(a*3)
   when ''snowflake'' then 3+floor(a*2) when ''vault'' then 3+floor(a*4)
   when ''damage'' then 3+floor(a*4) when ''trial-vault'' then 3+floor(a*4)
   when ''trial-gem'' then 3+floor(a*2) when ''trial-special'' then 3+floor(a*4)
   else ceil((a+2)*120) end;
  if event_count>event_limit then raise exception ''Mastery action rate exceeded'';end if;
  if t=''salve-heal'' and (s.character_key<>''medic_salve'' or event_count>case when exists(select 1 from app_private.player_mastery_quests where user_id=u and character_key=''medic_salve'' and mastered and mastery_enabled) then 3 else 2 end) then raise exception ''Salve has used all special heals for this run'';end if;
  if t=''gem'' then
   select count(*) into prior from public.player_progression_events where user_id=u and source=''gem'' and metadata->>''context_id''=s.context_id::text;
   if event_count>prior then raise exception ''Verified physical gem receipt required'';end if;
  end if;
  s.event_counts:=jsonb_set(s.event_counts,array[t],to_jsonb(event_count),true);
  if t=''dash'' then
   s.event_counts:=s.event_counts||jsonb_build_object(''last-dash-at'',a,''green-blocks-this-dash'',0);
  elsif t=''block'' and e->>''source''=''dash'' and (e->>''green'')::boolean is true and s.context_type=''1v1'' then
   if s.character_key<>''runner_dash'' or not exists(select 1 from app_private.player_mastery_quests where user_id=u and character_key=''runner_dash'' and mastered and mastery_enabled)
    or not coalesce(e->>''event_id'','''')~''^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$''
    or not(s.event_counts?''last-dash-at'') or a-(s.event_counts->>''last-dash-at'')::numeric not between 0 and .8
    or coalesce((s.event_counts->>''green-blocks-this-dash'')::integer,0)>=4 then raise exception ''A recent owned mastered Dash block is required for healing'';end if;
   insert into app_private.mastery_heal_tokens(match_id,user_id,event_id,session_id,kind) values(s.context_id,u,(e->>''event_id'')::uuid,s.id,''dash-green'') on conflict do nothing;
   s.event_counts:=jsonb_set(s.event_counts,array[''green-blocks-this-dash''],to_jsonb(coalesce((s.event_counts->>''green-blocks-this-dash'')::integer,0)+1),true);
  end if;
  dt:=0;amount:=0;hp:=0;d:=0;b:=0;wave:=0;
  if t=''frame'' then
   dt:=(e->>''seconds'')::numeric;hp:=(e->>''hp'')::numeric;
   if dt is null or dt<0 or dt>1 or dt=''NaN''::numeric or hp is null or hp<0 or hp>100 or hp=''NaN''::numeric then raise exception ''Invalid mastery frame'';end if;
   s.active_seconds:=s.active_seconds+dt;
   if s.active_seconds>a+1 or s.active_seconds>21600 then raise exception ''Mastery active time exceeded'';end if;
  end if;
  if t=''heal'' then
   amount:=(e->>''amount'')::numeric;
   if amount is null or amount<0 or amount>10 or amount=''NaN''::numeric then raise exception ''Invalid healing event'';end if;
  end if;
  if t=''damage'' then
   hp:=(e->>''before'')::numeric;d:=(e->>''damage'')::numeric;b:=(e->>''baseDamage'')::numeric;
   if hp is null or d is null or b is null or hp=''NaN''::numeric or d=''NaN''::numeric or b=''NaN''::numeric or hp<0 or hp>100 or d<0 or d>20 or b<0 or b>20 then raise exception ''Invalid damage event'';end if;
  end if;
  if t in(''wave'',''trial-wave'') then
   wave:=(e->>''wave'')::integer;
   if wave is null or wave<1 or wave>100000 or wave>1+floor(s.active_seconds/10) then raise exception ''Invalid mastery wave'';end if;
  end if;
  if s.context_type=''trial'' then
   if s.trial_failed then
    -- A failed trial must still be abandonable; otherwise its own session
    -- would prevent changing the active quest for up to 24 hours.
    if t=''run-end'' then s.finished_at:=clock_timestamp();end if;
    continue;
   end if;
   if t=''trial-died'' then s.trial_failed:=true;end if;
   if t=''frame'' then
    if hp<=0 then s.trial_failed:=true;continue;end if;
    if s.trial_ready then continue;end if;
    if s.character_key in(''runner_dash'',''runner_stride'') and s.active_seconds>=45 or s.character_key=''trickster_smoke'' and s.active_seconds>=200 then s.trial_ready:=true;s.finale_at:=a;end if;
    if s.character_key=''medic_remedy'' then
     s.trial_heat_seconds:=s.trial_heat_seconds+dt;
     while s.trial_heat_seconds>=2 loop s.trial_heat_seconds:=s.trial_heat_seconds-2;s.trial_heat:=s.trial_heat+1;end loop;
     if s.trial_heat>=10 then s.trial_failed:=true;end if;
    end if;
    if s.character_key=''medic_salve'' then
     s.trial_wave_seconds:=s.trial_wave_seconds+dt;
     if hp>0 and app_private.rounded_health_for_conditions(hp)<=1 then s.trial_low_seconds:=s.trial_low_seconds+dt;end if;
    end if;
   elsif t=''trial-special'' then
    if s.character_key=''runner_dash'' and e->>''action''<>''dash'' or s.character_key=''runner_stride'' and e->>''action''<>''stride-third'' or s.character_key=''tank_guard'' and e->>''action''<>''hit'' then s.trial_failed:=true;end if;
    if s.character_key=''tank_guard'' and e->>''action''=''hit'' then s.trial_count:=s.trial_count+1;end if;
   elsif t=''trial-gem'' and s.character_key=''medic_bloom'' then
    if not s.trial_first_gem and (e->>''collected'')::boolean is not true then s.trial_failed:=true;end if;s.trial_first_gem:=true;
   elsif t=''snowflake'' and s.character_key=''medic_remedy'' then s.trial_heat:=1;s.trial_heat_seconds:=0;
   elsif t=''trial-vault'' and s.character_key=''runner_vault'' then
    if (e->>''vaulted'')::boolean is not true or s.trial_pole_damaged and (e->>''timed'')::boolean is not true then s.trial_failed:=true;
    else s.trial_count:=s.trial_count+1;if (e->>''timed'')::boolean is not true then s.trial_pole_damaged:=true;end if;
     if s.trial_count>=20 and not s.trial_ready then s.trial_ready:=true;s.finale_at:=a;end if;
    end if;
   elsif t=''trial-wave'' then
    if wave<>s.trial_wave then raise exception ''Trial wave sequence gap'';end if;
    if s.character_key<>''medic_salve'' and s.active_seconds<wave*30 then raise exception ''Trial wave is not complete'';end if;
    if s.character_key=''medic_bloom'' and not s.trial_first_gem then s.trial_failed:=true;end if;
    if s.character_key=''tank_guard'' and s.trial_count<>(array[1,2,3,5])[least(4,wave)] then s.trial_failed:=true;end if;
    if s.character_key=''medic_salve'' then
     if s.trial_wave_seconds<60 then raise exception ''Treatment is not complete'';end if;
     ratio:=s.trial_low_seconds/s.trial_wave_seconds;
     risk:=case when ratio<.1 then 1 when ratio<.3 then .5 when ratio<.6 then .25 when ratio<=.75 then .1 else 0 end;
     -- A server roll decides the battlefield check, not a caller-supplied roll.
     if random()<risk then s.trial_failed:=true;else s.trial_count:=s.trial_count+1;end if;
     s.trial_low_seconds:=0;s.trial_wave_seconds:=0;
     if s.trial_count>=4 and not s.trial_failed then s.trial_ready:=true;s.finale_at:=a;end if;
    elsif not s.trial_failed and (s.character_key in(''medic_bloom'',''medic_remedy'') and wave=5 or s.character_key=''tank_guard'' and wave=4) then s.trial_ready:=true;s.finale_at:=a;
    end if;
    if s.character_key=''tank_guard'' then s.trial_count:=0;end if;
    s.trial_wave:=wave+1;s.trial_first_gem:=false;
   end if;
  elsif active_key=s.character_key then
   select * into q from app_private.player_mastery_quests where user_id=u and character_key=s.character_key for update;
   if q.quest<3 then
    v_progress:=q.progress;v_two:=q.progress_two;v_quest:=q.quest;
    case s.character_key
    when ''runner_dash'' then
     if q.quest<2 and t=''dash'' then v_progress:=v_progress+1;end if;
     if q.quest=1 and (t=''damage'' and d>0 or t=''run-end'') then v_progress:=0;end if;
     if q.quest=2 and t=''block'' and e->>''source''=''dash'' then v_progress:=v_progress+1;end if;
    when ''runner_stride'' then
     if q.quest in(0,2) and t=''lane-change'' then v_progress:=v_progress+1;end if;
     if q.quest=1 and t=''block'' and e->>''source''=''stride-third'' then v_progress:=v_progress+1;end if;
     if q.quest=2 and t=''block'' and e->>''source'' in(''stride'',''stride-third'') then v_two:=v_two+1;end if;
     if q.quest=2 and (t=''damage'' and d>0 or t=''run-end'') then v_progress:=0;v_two:=0;end if;
    when ''medic_bloom'' then
     if q.quest=0 and t=''gem'' then v_progress:=v_progress+1;end if;
     if q.quest>0 and t=''heal'' and e->>''source''=''bloom'' then v_progress:=v_progress+amount;end if;
     if q.quest=2 and t=''run-end'' then v_progress:=0;end if;
    when ''medic_remedy'' then
     if t=''heal'' and (q.quest=0 or q.quest=1 and e->>''source''=''snowflake'') then v_progress:=v_progress+amount;end if;
     if q.quest=2 and t=''snowflake'' then v_progress:=v_progress+1;end if;
    when ''medic_salve'' then
     if q.quest=0 and t=''frame'' and hp>0 and app_private.rounded_health_for_conditions(hp)<=1 then v_progress:=v_progress+dt;end if;
     if q.quest=1 and t=''salve-heal'' then v_progress:=v_progress+1;end if;
     if q.quest=2 and t=''wave'' and (e->>''salveExhausted'')::boolean then v_progress:=v_progress+1;end if;
    when ''runner_vault'' then
     if q.quest in(0,1) and t=''vault'' and e->>''hazard''=(case q.quest when 0 then ''log'' else ''spikes'' end) then v_progress:=v_progress+1;end if;
     if q.quest=2 and t=''damage'' and d>0 and e->>''hazard'' in(''log'',''spikes'') then s.run_failed:=true;end if;
     if q.quest=2 and t=''wave'' and not s.run_failed then v_progress:=greatest(v_progress,wave);end if;
     if q.quest=2 and t=''run-end'' then v_progress:=0;end if;
    when ''tank_guard'' then
     if t=''damage'' then
      if q.quest=0 then v_progress:=v_progress+greatest(0,b-d);end if;
      if q.quest=1 and hp>d and hp<=b then v_progress:=v_progress+1;end if;
      if q.quest=2 then v_progress:=v_progress+d;end if;
     end if;
    when ''trickster_smoke'' then
     if t=''smoke'' and(q.quest=0 or q.quest=1 and s.context_type=''1v1'' and (e->>''opponent'')::boolean is true
      or q.quest=2 and (e->>''opponent'')::boolean is not true and (e->>''timeToImpact'')::numeric between 0 and .25) then v_progress:=v_progress+1;end if;
    else null;
    end case;
    target:=app_private.mastery_target(s.character_key,q.quest);
    if v_progress>=target and (s.character_key<>''runner_stride'' or q.quest<>2 or v_two>=25) then
     v_quest:=q.quest+1;v_progress:=case when v_quest=3 then v_progress else 0 end;v_two:=0;
     if v_quest=3 then update app_private.player_mastery_preferences set active_character=null where user_id=u;active_key:=null;end if;
    end if;
    update app_private.player_mastery_quests set quest=v_quest,progress=v_progress,progress_two=v_two where user_id=u and character_key=s.character_key;
   end if;
  end if;
  if t=''run-end'' then s.finished_at:=clock_timestamp();end if;
 end loop;
 update app_private.mastery_sessions set last_received_at=clock_timestamp(),last_seq=s.last_seq,last_at=s.last_at,active_seconds=s.active_seconds,events=s.events,event_counts=s.event_counts,
  run_failed=s.run_failed,trial_failed=s.trial_failed,trial_ready=s.trial_ready,finale_at=s.finale_at,trial_wave=s.trial_wave,
  trial_count=s.trial_count,trial_heat=s.trial_heat,trial_heat_seconds=s.trial_heat_seconds,trial_low_seconds=s.trial_low_seconds,
  trial_wave_seconds=s.trial_wave_seconds,trial_first_gem=s.trial_first_gem,trial_pole_damaged=s.trial_pole_damaged,finished_at=s.finished_at where id=s.id;
 return public.get_mastery_profile()||jsonb_build_object(''last_seq'',s.last_seq,''trial_failed'',s.trial_failed,''trial_ready'',s.trial_ready);
end;
end
$runtime_guard$
';
 elsif (select md5(prosrc) from pg_proc where oid='public.credit_mastery_events(uuid,jsonb)'::regprocedure)<>'0aa7ed22b11dde933c75f05a981b8a1f' then
  raise exception 'Unreviewed RPC source: %','credit_mastery_events(uuid,jsonb)';
 end if;

 if md5(pg_get_functiondef('public.discard_1v1_gambit_cards(uuid,text[])'::regprocedure))='9115b4707ff212bd9c9ca36765f6e27c' then
  execute 'CREATE OR REPLACE FUNCTION public.discard_1v1_gambit_cards(p_match_id uuid, p_card_ids text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''''
AS $runtime_guard$
begin
  -- Pixel runtime boundary: before original variable initializers or writes.
  perform app_private.require_pixel_runtime();
  <<skyway_original>>
declare
  v_uid uuid := auth.uid();
  v_match public.multiplayer_matches;
  v_self public.multiplayer_players;
  v_state app_private.multiplayer_gambit_state;
  v_distinct_count integer;
begin
  if v_uid is null then raise exception ''Sign in required''; end if;
  if cardinality(coalesce(p_card_ids, array[]::text[])) not between 1 and 10 then
    raise exception ''Choose between 1 and 10 cards to discard'';
  end if;
  select count(distinct card) into v_distinct_count
  from unnest(p_card_ids) as cards(card);
  if v_distinct_count <> cardinality(p_card_ids) then
    raise exception ''Each discarded card must be unique'';
  end if;
  select * into v_match from public.multiplayer_matches match_row
  where match_row.id = p_match_id for update;
  perform 1 from public.multiplayer_players player
  where player.match_id = p_match_id order by player.slot for update;
  select * into v_self from public.multiplayer_players player
  where player.match_id = p_match_id and player.user_id = v_uid;
  if v_match.id is null or v_self.user_id is null then
    raise exception ''1v1 match not found'';
  end if;
  if v_self.character_key <> ''trickster_gambit'' then
    raise exception ''Counting Cards belongs to Gambit'';
  end if;
  if v_match.status not in (''countdown'',''playing'',''intermission'')
     or v_self.status in (''eliminated'',''left'',''finished'') then
    raise exception ''Cards cannot be changed after this run'';
  end if;
  select * into v_state from app_private.multiplayer_gambit_state state_row
  where state_row.match_id = p_match_id and state_row.user_id = v_uid
  for update;
  if v_state.user_id is null then
    raise exception ''Draw the first Gambit hand before discarding'';
  end if;
  if exists (
    select 1 from unnest(p_card_ids) as chosen(card)
    where not (chosen.card = any(v_state.hand))
  ) then
    raise exception ''A selected card is not in your current hand'';
  end if;
  update app_private.multiplayer_gambit_state state_row
  set hand = array(
        select card from unnest(state_row.hand) with ordinality held(card, pos)
        where not (card = any(p_card_ids)) order by pos
      ),
      discard_pile = state_row.discard_pile || p_card_ids,
      updated_at = now()
  where state_row.match_id = p_match_id and state_row.user_id = v_uid;
  return app_private.gambit_public_state(p_match_id, v_uid)
    || jsonb_build_object(''discarded_count'', cardinality(p_card_ids));
end;
end
$runtime_guard$
';
 elsif (select md5(prosrc) from pg_proc where oid='public.discard_1v1_gambit_cards(uuid,text[])'::regprocedure)<>'aa3f5bba3a04d0626edbf73df2f5b7f9' then
  raise exception 'Unreviewed RPC source: %','discard_1v1_gambit_cards(uuid,text[])';
 end if;

 if md5(pg_get_functiondef('public.draw_1v1_gambit_wave(uuid,integer)'::regprocedure))='0b9c05f5394d8851f498991cdeb99ae9' then
  execute 'CREATE OR REPLACE FUNCTION public.draw_1v1_gambit_wave(p_match_id uuid, p_wave integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''''
AS $runtime_guard$
begin
  -- Pixel runtime boundary: before original variable initializers or writes.
  perform app_private.require_pixel_runtime();
  <<skyway_original>>
declare
  v_uid uuid := auth.uid();
  v_match public.multiplayer_matches;
  v_self public.multiplayer_players;
  v_opponent public.multiplayer_players;
  v_state app_private.multiplayer_gambit_state;
  v_card text;
  v_hand text[];
  v_draw text[];
  v_discard text[];
  v_cycle integer;
  v_index integer;
  v_hand_name text;
  v_reward_inserted boolean := false;
  v_stolen numeric := 0;
  v_doubled numeric := 0;
  v_self_after numeric := 0;
  v_opponent_after numeric := 0;
begin
  if v_uid is null then raise exception ''Sign in required''; end if;
  if p_wave is null or p_wave < 1 then raise exception ''Invalid Gambit wave''; end if;
  select * into v_match from public.multiplayer_matches match_row
  where match_row.id = p_match_id for update;
  perform 1 from public.multiplayer_players player
  where player.match_id = p_match_id order by player.slot for update;
  select * into v_self from public.multiplayer_players player
  where player.match_id = p_match_id and player.user_id = v_uid;
  select * into v_opponent from public.multiplayer_players player
  where player.match_id = p_match_id and player.user_id <> v_uid limit 1;
  if v_match.id is null or v_self.user_id is null or v_opponent.user_id is null then
    raise exception ''1v1 match not found'';
  end if;
  if v_self.character_key <> ''trickster_gambit'' then
    raise exception ''Counting Cards belongs to Gambit'';
  end if;
  if v_match.status not in (''countdown'',''playing'')
     or v_self.status <> ''playing'' then
    raise exception ''Gambit draws only at the start of a live wave'';
  end if;
  if p_wave <> v_self.wave or p_wave < v_match.current_wave then
    raise exception ''That Gambit wave is not active'';
  end if;

  insert into app_private.multiplayer_gambit_state(
    match_id, user_id, draw_pile
  ) values (
    p_match_id, v_uid,
    app_private.gambit_shuffle(
      app_private.gambit_full_deck(), gen_random_uuid()
    )
  ) on conflict (match_id, user_id) do nothing;
  select * into v_state from app_private.multiplayer_gambit_state state_row
  where state_row.match_id = p_match_id and state_row.user_id = v_uid
  for update;

  if v_state.last_draw_wave >= p_wave then
    return app_private.gambit_public_state(p_match_id, v_uid)
      || jsonb_build_object(''reward_applied'', false, ''duplicate'', true);
  end if;
  if cardinality(v_state.hand) > 5 then
    return app_private.gambit_public_state(p_match_id, v_uid)
      || jsonb_build_object(
        ''reward_applied'', false,
        ''discard_required'', cardinality(v_state.hand) - 5
      );
  end if;

  v_hand := v_state.hand;
  v_draw := v_state.draw_pile;
  v_discard := v_state.discard_pile;
  v_cycle := v_state.deck_cycle;
  for v_index in 1..5 loop
    if cardinality(v_draw) = 0 then
      if cardinality(v_discard) = 0 then
        raise exception ''Gambit deck state is incomplete'';
      end if;
      v_cycle := v_cycle + 1;
      v_draw := app_private.gambit_shuffle(v_discard, gen_random_uuid());
      v_discard := array[]::text[];
    end if;
    v_card := v_draw[1];
    v_draw := coalesce(v_draw[2:cardinality(v_draw)], array[]::text[]);
    v_hand := array_append(v_hand, v_card);
  end loop;
  if cardinality(v_hand) > 10 then raise exception ''Gambit hand exceeded 10 cards''; end if;
  v_hand_name := app_private.gambit_best_hand(v_hand);

  update app_private.multiplayer_gambit_state state_row
  set deck_cycle = v_cycle, draw_pile = v_draw, discard_pile = v_discard,
      hand = v_hand, last_draw_wave = p_wave, updated_at = now()
  where state_row.match_id = p_match_id and state_row.user_id = v_uid;

  insert into app_private.multiplayer_gambit_rewards(
    match_id, user_id, wave, best_hand
  ) values (p_match_id, v_uid, p_wave, v_hand_name)
  on conflict (match_id, user_id, wave) do nothing
  returning true into v_reward_inserted;
  v_reward_inserted := coalesce(v_reward_inserted, false);

  if v_reward_inserted and v_hand_name in (''two-pair'',''royal-flush'') then
    if v_hand_name = ''two-pair'' then
      v_stolen := round(v_opponent.obstacle_points * 0.25, 4);
      v_self_after := least(1000000000::numeric,
        v_self.obstacle_points + v_stolen);
      v_stolen := v_self_after - v_self.obstacle_points;
      v_opponent_after := v_opponent.obstacle_points - v_stolen;
    else
      v_stolen := v_opponent.obstacle_points;
      v_opponent_after := 0;
      v_self_after := least(1000000000::numeric,
        (v_self.obstacle_points + v_stolen) * 2);
      v_doubled := greatest(0,
        v_self_after - (v_self.obstacle_points + v_stolen));
    end if;
    perform set_config(
      ''app_private.skip_1v1_point_multiplier'', ''on'', true
    );
    update public.multiplayer_players player
    set obstacle_points = case
          when player.user_id = v_uid then v_self_after
          else v_opponent_after
        end,
        updated_at = now()
    where player.match_id = p_match_id
      and player.user_id in (v_uid, v_opponent.user_id);
    perform set_config(
      ''app_private.skip_1v1_point_multiplier'', ''off'', true
    );
  else
    v_self_after := v_self.obstacle_points;
    v_opponent_after := v_opponent.obstacle_points;
  end if;
  if v_reward_inserted then
    update app_private.multiplayer_gambit_rewards reward
    set stolen_coins = v_stolen, doubled_coins = v_doubled,
        self_coins_after = v_self_after,
        opponent_coins_after = v_opponent_after
    where reward.match_id = p_match_id and reward.user_id = v_uid
      and reward.wave = p_wave;
  end if;
  update public.multiplayer_matches match_row set last_activity_at = now()
  where match_row.id = p_match_id;
  return app_private.gambit_public_state(p_match_id, v_uid)
    || jsonb_build_object(
      ''reward_applied'', v_reward_inserted,
      ''reward_wave'', p_wave,
      ''reward_hand'', v_hand_name,
      ''reward_label'', app_private.gambit_reward_label(v_hand_name),
      ''stolen_coins'', v_stolen,
      ''doubled_coins'', v_doubled,
      ''self_coins'', v_self_after,
      ''opponent_coins'', v_opponent_after
    );
end;
end
$runtime_guard$
';
 elsif (select md5(prosrc) from pg_proc where oid='public.draw_1v1_gambit_wave(uuid,integer)'::regprocedure)<>'e5d7d9d062028954aabe3c5090b163b7' then
  raise exception 'Unreviewed RPC source: %','draw_1v1_gambit_wave(uuid,integer)';
 end if;

 if md5(pg_get_functiondef('public.equip_photon_character(text)'::regprocedure))='63f2539101d9b9541c691f9eba29be6f' then
  execute 'CREATE OR REPLACE FUNCTION public.equip_photon_character(p_character_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''''
AS $runtime_guard$
begin
  -- Pixel runtime boundary: before original variable initializers or writes.
  perform app_private.require_pixel_runtime();
  <<skyway_original>>
declare u uuid:=app_private.photon_user();k text:=lower(trim(p_character_key));p public.player_photon_fury;item record;target text;
begin
 select * into p from public.player_photon_fury where user_id=u for update;
 if p.unlocked_at is null then raise exception ''Mode locked'';end if;
 if k like ''weapon:%'' then
  target:=substr(k,8);
  if not exists(select 1 from app_private.photon_weapon_rules(target)) or (target<>''lightsaber'' and not exists(
    select 1 from app_private.photon_unlocks where user_id=u and kind=''weapon'' and item_key=''photon_weapon_''||target))
    then raise exception ''Weapon locked'';end if;
  if not app_private.photon_weapon_compatible(target,p.selected_character_key) then raise exception ''Weapon is incompatible with Bear or Magnet'';end if;
  update public.player_photon_fury set selected_weapon_key=target where user_id=u;
 elsif k like ''skin:default:%'' then
  target:=substr(k,14);
  if not app_private.owns_photon_character(u,target) then raise exception ''Character locked'';end if;
  update public.player_photon_fury set skin_choices=skin_choices-target where user_id=u;
 elsif k like ''skin:%'' then
  target:=substr(k,6);select * into item from app_private.photon_qol_catalog() where item_key=target and kind=''skin'';
  if item.item_key is null or not app_private.owns_photon_character(u,item.character_key) or not exists(
    select 1 from app_private.photon_unlocks where user_id=u and item_key=target and kind=''skin'') then raise exception ''Skin or character locked'';end if;
  update public.player_photon_fury set skin_choices=jsonb_set(skin_choices,array[item.character_key],to_jsonb(target),true) where user_id=u;
 elsif k like ''theme:%'' then
  target:=substr(k,7);
  if target<>''default'' and not exists(select 1 from app_private.photon_unlocks where user_id=u and item_key=target and kind=''theme'')
    then raise exception ''Theme locked'';end if;
  update public.player_photon_fury set selected_theme_key=target where user_id=u;
 else
  if not app_private.owns_photon_character(u,k) then raise exception ''Character locked'';end if;
  update public.player_photon_fury set selected_character_key=k,
   selected_weapon_key=case when app_private.photon_weapon_compatible(selected_weapon_key,k) then selected_weapon_key else ''lightsaber'' end where user_id=u;
 end if;
 return public.get_photon_fury_profile();
end;
end
$runtime_guard$
';
 elsif (select md5(prosrc) from pg_proc where oid='public.equip_photon_character(text)'::regprocedure)<>'ec5f8bc4894b1374e3811344c5fafa1d' then
  raise exception 'Unreviewed RPC source: %','equip_photon_character(text)';
 end if;

 if md5(pg_get_functiondef('public.extract_items(integer,text)'::regprocedure))='3b6bd1107c90d0286533e0a1aa7a2a0d' then
  execute 'CREATE OR REPLACE FUNCTION public.extract_items(pull_count integer, box_type text DEFAULT ''regular''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''''
AS $runtime_guard$
begin
  -- Pixel runtime boundary: before original variable initializers or writes.
  perform app_private.require_pixel_runtime();
  <<skyway_original>>
declare u uuid:=auth.uid();k text:=lower(trim(box_type));b record;d record;item record;g bigint;l integer;
  n integer;i integer;total integer;inserted integer;sd bigint;earned integer:=0;award integer;results jsonb:=''[]'';
begin
  if u is null then raise exception ''Sign in required'';end if;
  if app_private.has_active_ban(u,''account'',null) then raise exception ''This account is banned'';end if;
  if k like ''photon:%'' then
    if pull_count is distinct from 1 then raise exception ''Choose one Photon box'';end if;
    return app_private.open_photon_box(substr(k,8)::uuid);
  end if;
  if k in(''regular'',''ten'') then raise exception ''This shop requires the Update 18 game client'';end if;
  select * into b from app_private.booster_box_rules(k);
  if b.cost is null then raise exception ''Choose Normal, Rare, or Legendary Box'';end if;
  if pull_count is null or pull_count<1 or pull_count>99 then raise exception ''Choose 1 to 99 boxes'';end if;
  insert into public.player_stats(user_id,total_gems,high_score,updated_at) values(u,0,0,now()) on conflict(user_id) do nothing;
  select total_gems,level,stardust into g,l,sd from public.player_stats where user_id=u for update;
  if l<b.min_level then raise exception ''% Box requires level %'',initcap(k),b.min_level;end if;
  -- Update 2.3 validated pull distributions.
if exists(select 1 from unnest(b.profiles) profile cross join lateral app_private.booster_pull_rules(profile) rules where (select sum(w) from unnest(rules.weights) w)<>100) then raise exception ''Invalid pull odds; no Gems spent'';end if;
if g<pull_count*b.cost then raise exception ''Not enough gems'';end if;
  for n in 1..pull_count loop
    for i in 1..cardinality(b.profiles) loop
      select * into d from app_private.booster_roll(b.profiles[i],random(),random());
      select c.* into item from public.extraction_catalog c
      where c.active and c.extractable and c.rarity=d.rarity and c.item_key not like ''photon_%''
        and ((d.category=''character'' and c.item_type=''character'')
          or(d.category=''cosmetic'' and c.item_type in(''player'',''obstacle'',''environment'')))
      order by random() limit 1;
      if item.item_key is null then raise exception ''Missing % % catalog pool'',d.rarity,d.category;end if;
      insert into public.player_unlocks(user_id,item_key,item_type,rarity,unlocked_at)
        values(u,item.item_key,item.item_type,item.rarity,now()) on conflict(user_id,item_key) do nothing;
      get diagnostics inserted=row_count;
      award:=case when inserted=0 then app_private.duplicate_stardust(item.rarity,item.item_type,l) else 0 end;earned:=earned+award;
      results:=results||jsonb_build_array(jsonb_build_object(''pull_number'',(n-1)*cardinality(b.profiles)+i,
        ''box_number'',n,''item_in_box'',i,''draw_profile'',b.profiles[i],''item_key'',item.item_key,
        ''display_name'',item.display_name,''item_type'',item.item_type,''category'',d.category,
        ''character_class'',item.character_class,''rarity'',item.rarity,''is_new'',inserted=1,''duplicate_refund'',0,''duplicate_stardust'',award));
    end loop;
  end loop;
  total:=pull_count*b.cost;
  update public.player_stats set total_gems=total_gems-total,stardust=stardust+earned,updated_at=now() where user_id=u returning total_gems,stardust into g,sd;
  return jsonb_build_object(''box_type'',k,''box_quantity'',pull_count,''items_per_box'',cardinality(b.profiles),
    ''pull_count'',jsonb_array_length(results),''item_count'',jsonb_array_length(results),''box_cost'',b.cost,
    ''cost'',total,''gross_cost'',total,''net_cost'',total,''refund'',0,''duplicate_refund'',0,''gems'',g,''stardust'',sd,''stardust_awarded'',earned,''results'',results);
end;
end
$runtime_guard$
';
 elsif (select md5(prosrc) from pg_proc where oid='public.extract_items(integer,text)'::regprocedure)<>'9f1bdf5ed272701a862ea133a7961a23' then
  raise exception 'Unreviewed RPC source: %','extract_items(integer,text)';
 end if;

 if md5(pg_get_functiondef('public.finish_mastery_trial(uuid)'::regprocedure))='59773f1d9b11c526ce3d7fb793a843a6' then
  execute 'CREATE OR REPLACE FUNCTION public.finish_mastery_trial(p_session_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''''
AS $runtime_guard$
begin
  -- Pixel runtime boundary: before original variable initializers or writes.
  perform app_private.require_pixel_runtime();
  <<skyway_original>>
declare u uuid:=app_private.photon_user();s app_private.mastery_sessions;
begin
 perform pg_advisory_xact_lock(hashtextextended(u::text,23));
 select * into s from app_private.mastery_sessions where id=p_session_id and user_id=u for update;
 if s.id is null or s.context_type<>''trial'' then raise exception ''Owned trial receipt required'';end if;
 if not app_private.mastery_owns_character(u,s.character_key) or app_private.is_admin_test_user(u) then raise exception ''Trial no longer eligible'';end if;
 if s.trial_failed or not s.trial_ready or s.finale_at is null or s.last_at<s.finale_at+3 then raise exception ''Complete the trial and collect its trophy first'';end if;

 if s.event_counts->''admin_mastery_revoked''=''true''::jsonb then raise exception ''This trial receipt was revoked; start a new trial'';end if;
 -- Update 2.3 mastery management follow-up: no repeat mastery/toggle reward.
 if s.trial_replay then
  update app_private.mastery_sessions set finished_at=coalesce(finished_at,clock_timestamp()) where id=s.id;
  return public.get_mastery_profile()||jsonb_build_object(''trial_replay'',true,''trial_completed'',true);
 end if;
 update app_private.player_mastery_quests set mastered=true,mastery_enabled=true,flair_rewrite_enabled=true,mastered_at=coalesce(mastered_at,clock_timestamp())

 where user_id=u and character_key=s.character_key and quest=3 and not mastered;
 update app_private.mastery_sessions set finished_at=coalesce(finished_at,clock_timestamp()) where id=s.id;
 return public.get_mastery_profile()||jsonb_build_object(''trial_replay'',false,''trial_completed'',true);
end;
end
$runtime_guard$
';
 elsif (select md5(prosrc) from pg_proc where oid='public.finish_mastery_trial(uuid)'::regprocedure)<>'7bbc51b35f4c0a63170aeaba2d472712' then
  raise exception 'Unreviewed RPC source: %','finish_mastery_trial(uuid)';
 end if;

 if md5(pg_get_functiondef('public.finish_photon_character_run(uuid,numeric,integer,integer)'::regprocedure))='77ae24e21c5250e4ec1889c1e698a96f' then
  execute 'CREATE OR REPLACE FUNCTION public.finish_photon_character_run(p_run_id uuid, p_active_seconds numeric, p_reflections integer, p_extra_points integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''''
AS $runtime_guard$
begin
  -- Pixel runtime boundary: before original variable initializers or writes.
  perform app_private.require_pixel_runtime();
  <<skyway_original>>
declare u uuid:=app_private.photon_user();r app_private.photon_fury_runs;t numeric:=p_active_seconds;
 n integer:=p_reflections;x integer:=p_extra_points;h numeric;l numeric;p numeric;v bigint;b bigint;
begin
 select * into r from app_private.photon_fury_runs where id=p_run_id and user_id=u for update;
 if r.id is null then raise exception ''No run'';end if;
 if r.rules_version not in(20261014,20261017) then return app_private.finish_photon_character_run_legacy(p_run_id,t,n,x);end if;
 if r.finished_at is not null then
  select photons into b from public.player_photon_fury where user_id=u;
  return jsonb_build_object(''awarded'',r.awarded,''photons'',b,''already_completed'',true);
 end if;
 if not coalesce(t between 0 and 21600,false) or t>extract(epoch from clock_timestamp()-r.started_at)+.5 then raise exception ''Invalid playtime'';end if;
 if n is null or n<0 or n>floor(t/r.saber_cooldown_seconds)+1 then raise exception ''Invalid reflections'';end if;
 if app_private.is_admin_test_user(u) then raise exception ''Test run'';end if;
 -- Conservative rate envelopes cover contact rewards and movement without accepting a client payout.
 h:=least(1e6,ceil((power(1.004,t/2)-1)*1600)+3);
 l:=case r.character_key when ''photon_magnet'' then 3*h when ''photon_bear'' then 2*n+h
  when ''photon_wrench'' then n when ''photon_static'' then n else 0 end;
 l:=l+case r.weapon_key when ''photon_blaster'' then 2*n when ''magnetite_sword'' then 2*n+h
  when ''ninjablade'' then 4*n+2*h+coalesce(floor(t/nullif(r.bonus_point_seconds,0)),0)
  when ''jolt_shockwave'' then ceil(60*t)*r.point_multiplier else 0 end;
 if x is null or x<0 or x>l then raise exception ''Invalid bonus'';end if;
 p:=n*r.point_multiplier+x+coalesce(floor(t/nullif(r.bonus_point_seconds,0)),0);
 v:=case when r.weapon_key=''jolt_shockwave'' then case when p>=16 then (2*(p-16)^2+1)::bigint else 0 end
  else app_private.photon_points_reward(p) end;
 update public.player_photon_fury set photons=photons+v where user_id=u and unlocked_at is not null returning photons into b;
 if b is null then raise exception ''Mode locked'';end if;
 update app_private.photon_fury_runs set finished_at=clock_timestamp(),active_seconds=t,reflections=n,extra_points=x,awarded=v where id=r.id;
 return jsonb_build_object(''awarded'',v,''photons'',b,''points'',p);
end;
end
$runtime_guard$
';
 elsif (select md5(prosrc) from pg_proc where oid='public.finish_photon_character_run(uuid,numeric,integer,integer)'::regprocedure)<>'98e96386944c431f277076a7afca5519' then
  raise exception 'Unreviewed RPC source: %','finish_photon_character_run(uuid,numeric,integer,integer)';
 end if;

 if md5(pg_get_functiondef('public.finish_photon_fury_run(uuid,numeric,integer)'::regprocedure))='576f89d89fb2067d817b67384698db41' then
  execute 'CREATE OR REPLACE FUNCTION public.finish_photon_fury_run(p_run_id uuid, p_active_seconds numeric, p_reflections integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''''
AS $runtime_guard$
#variable_conflict use_column
begin
  perform app_private.require_pixel_runtime();
  return (select public.finish_photon_character_run($1,$2,$3,0));
end
$runtime_guard$
';
 elsif (select md5(prosrc) from pg_proc where oid='public.finish_photon_fury_run(uuid,numeric,integer)'::regprocedure)<>'929fa2fbeae6140c99b4f9104598997e' then
  raise exception 'Unreviewed RPC source: %','finish_photon_fury_run(uuid,numeric,integer)';
 end if;

 if md5(pg_get_functiondef('public.get_1v1_ability_state(uuid)'::regprocedure))='9e0a7dd43b2e1cc5a7213917338f80e0' then
  execute 'CREATE OR REPLACE FUNCTION public.get_1v1_ability_state(p_match_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''''
AS $runtime_guard$
begin
  -- Pixel runtime boundary: before original variable initializers or writes.
  perform app_private.require_pixel_runtime();
  <<skyway_original>>
declare
  v_uid uuid := auth.uid();
  v_match public.multiplayer_matches;
  v_self public.multiplayer_players;
  v_opponent public.multiplayer_players;
  v_now timestamptz := clock_timestamp();
  v_player record;
  v_pending_removals jsonb := ''[]''::jsonb;
begin
  if v_uid is null then raise exception ''Sign in required''; end if;
  select * into v_match from public.multiplayer_matches match_row
  where match_row.id = p_match_id for update;
  perform 1 from public.multiplayer_players player
  where player.match_id = p_match_id order by player.slot for update;
  select * into v_self from public.multiplayer_players player
  where player.match_id = p_match_id and player.user_id = v_uid;
  if v_match.id is null or v_self.user_id is null then
    raise exception ''1v1 match not found'';
  end if;
  for v_player in
    select player.user_id
    from public.multiplayer_players player
    where player.match_id = p_match_id
      and player.mirage_active_until is not null
      and player.mirage_active_until <= v_now
      and not player.mirage_exit_damage_applied
  loop
    perform app_private.settle_1v1_mirage_exit(
      p_match_id, v_player.user_id, v_now
    );
  end loop;
  select * into v_self from public.multiplayer_players player
  where player.match_id = p_match_id and player.user_id = v_uid;
  select * into v_opponent from public.multiplayer_players player
  where player.match_id = p_match_id and player.user_id <> v_uid limit 1;
  select coalesce(jsonb_agg(jsonb_build_object(
    ''receipt_id'', receipt.id,
    ''purchase_id'', receipt.purchase_id,
    ''obstacle_type'', receipt.obstacle_type,
    ''point_cost'', receipt.point_cost,
    ''spawn_wave'', receipt.spawn_wave,
    ''created_at'', receipt.created_at
  ) order by receipt.created_at, receipt.id), ''[]''::jsonb)
  into v_pending_removals
  from public.multiplayer_comet_removals receipt
  where receipt.match_id = p_match_id and receipt.user_id = v_uid
    and receipt.spawn_wave = v_self.wave
    and receipt.redeemed_at is null;
  return jsonb_build_object(
    ''match_id'', p_match_id,
    ''server_now'', v_now,
    ''heatfeast'', app_private.one_v_one_heatfeast_json(
      p_match_id, v_uid, v_self.wave
    ),
    ''pending_comet_removals'', v_pending_removals,
    ''self'', jsonb_build_object(
      ''lane_index'', v_self.lane_index,
      ''mirage_active'', coalesce(
        v_self.mirage_active_until > v_now
          and not v_self.mirage_exit_damage_applied,
        false
      ),
      ''mirage_used_wave'', v_self.mirage_used_wave,
      ''mirage_started_at'', v_self.mirage_started_at,
      ''mirage_ends_at'', v_self.mirage_active_until,
      ''mirage_matching_since_at'', v_self.mirage_matching_since_at,
      ''mirage_damage_dealt'', v_self.mirage_damage_dealt,
      ''mirage_exit_damage_applied'', v_self.mirage_exit_damage_applied,
      ''hearts'', v_self.hearts
    ),
    ''opponent'', jsonb_build_object(
      ''lane_index'', v_opponent.lane_index,
      ''mirage_active'', coalesce(
        v_opponent.mirage_active_until > v_now
          and not v_opponent.mirage_exit_damage_applied,
        false
      ),
      ''mirage_started_at'', v_opponent.mirage_started_at,
      ''mirage_ends_at'', v_opponent.mirage_active_until,
      ''mirage_damage_dealt'', v_opponent.mirage_damage_dealt,
      ''hearts'', v_opponent.hearts
    )
  );
end;
end
$runtime_guard$
';
 elsif (select md5(prosrc) from pg_proc where oid='public.get_1v1_ability_state(uuid)'::regprocedure)<>'61f68a4108dc52bc14174a113e93f22a' then
  raise exception 'Unreviewed RPC source: %','get_1v1_ability_state(uuid)';
 end if;

 if md5(pg_get_functiondef('public.get_1v1_gambit_state(uuid)'::regprocedure))='c5a718f271c59c45d1e43410ffeafe11' then
  execute 'CREATE OR REPLACE FUNCTION public.get_1v1_gambit_state(p_match_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''''
AS $runtime_guard$
begin
  -- Pixel runtime boundary: before original variable initializers or writes.
  perform app_private.require_pixel_runtime();
  <<skyway_original>>
declare
  v_uid uuid := auth.uid();
  v_self public.multiplayer_players;
begin
  if v_uid is null then raise exception ''Sign in required''; end if;
  select * into v_self from public.multiplayer_players player
  where player.match_id = p_match_id and player.user_id = v_uid;
  if v_self.user_id is null then raise exception ''1v1 match not found''; end if;
  if v_self.character_key <> ''trickster_gambit'' then
    raise exception ''Counting Cards belongs to Gambit'';
  end if;
  return app_private.gambit_public_state(p_match_id, v_uid);
end;
end
$runtime_guard$
';
 elsif (select md5(prosrc) from pg_proc where oid='public.get_1v1_gambit_state(uuid)'::regprocedure)<>'587aa9f5a47dc5e5c21e07abe03f195b' then
  raise exception 'Unreviewed RPC source: %','get_1v1_gambit_state(uuid)';
 end if;

 if md5(pg_get_functiondef('public.get_1v1_leaderboard(integer,integer)'::regprocedure))='431eab684b433aedee993034bec7df1d' then
  execute 'CREATE OR REPLACE FUNCTION public.get_1v1_leaderboard(p_limit integer DEFAULT 50, p_offset integer DEFAULT 0)
 RETURNS TABLE(rank bigint, username text, rating integer, provisional boolean, matches_played bigint, wins bigint, losses bigint, draws bigint, win_rate numeric, current_streak bigint, best_streak bigint, best_wave integer, best_score bigint, coins_collected bigint, obstacle_points_spent bigint, is_self boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''''
AS $runtime_guard$
begin
  -- Pixel runtime boundary: before original variable initializers or writes.
  perform app_private.require_pixel_runtime();
  <<skyway_original>>
declare
  v_uid uuid := auth.uid();
  v_season_id integer;
begin
  if v_uid is null then raise exception ''Sign in required''; end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception ''Leaderboard limit must be between 1 and 100'';
  end if;
  if p_offset is null or p_offset < 0 or p_offset > 10000 then
    raise exception ''Leaderboard offset must be between 0 and 10000'';
  end if;
  select season.id into v_season_id
  from public.ranked_1v1_seasons season
  where season.is_active order by season.starts_at desc limit 1;

  return query
  with eligible as (
    select
      stats.user_id, profile.username, stats.rating, stats.matches_played,
      stats.wins, stats.losses, stats.draws,
      round(stats.wins::numeric * 100 / nullif(stats.matches_played, 0), 1)
        as win_rate,
      stats.current_streak, stats.best_streak, stats.best_wave,
      stats.best_score, stats.coins_collected, stats.obstacle_points_spent
    from public.player_ranked_1v1_stats stats
    join public.player_profiles profile on profile.user_id = stats.user_id
    where stats.season_id = v_season_id and stats.matches_played > 0
      and not app_private.has_active_ban(stats.user_id, ''account'', null)
      and not app_private.has_active_ban(stats.user_id, ''leaderboard'', null)
  ), ranked as (
    select row_number() over (
      order by eligible.rating desc, eligible.wins desc,
        eligible.win_rate desc, eligible.best_wave desc,
        eligible.best_score desc, lower(eligible.username), eligible.user_id
    ) as rank, eligible.* from eligible
  )
  select ranked.rank, ranked.username, round(ranked.rating)::integer,
    ranked.matches_played < 10, ranked.matches_played, ranked.wins,
    ranked.losses, ranked.draws, ranked.win_rate, ranked.current_streak,
    ranked.best_streak, ranked.best_wave, ranked.best_score,
    ranked.coins_collected, ranked.obstacle_points_spent,
    ranked.user_id = v_uid
  from ranked order by ranked.rank limit p_limit offset p_offset;
end;
end
$runtime_guard$
';
 elsif (select md5(prosrc) from pg_proc where oid='public.get_1v1_leaderboard(integer,integer)'::regprocedure)<>'926e3d9940ed9f3af8400545052551e1' then
  raise exception 'Unreviewed RPC source: %','get_1v1_leaderboard(integer,integer)';
 end if;

 if md5(pg_get_functiondef('public.get_1v1_map_catalog()'::regprocedure))='43603ddef490870ea4af4228bb1bd2e2' then
  execute 'CREATE OR REPLACE FUNCTION public.get_1v1_map_catalog()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''''
AS $runtime_guard$
#variable_conflict use_column
begin
  perform app_private.require_pixel_runtime();
  return (select coalesce(
    jsonb_agg(
      app_private.one_v_one_map_rules_json(rules.map_key)
      order by rules.sort_order
    ),
    ''[]''::jsonb
  )
  from app_private.one_v_one_map_rules rules where rules.map_key<>''alley'');
end
$runtime_guard$
';
 elsif (select md5(prosrc) from pg_proc where oid='public.get_1v1_map_catalog()'::regprocedure)<>'e0dd4bc1277e277d1437d855cc862160' then
  raise exception 'Unreviewed RPC source: %','get_1v1_map_catalog()';
 end if;

 if md5(pg_get_functiondef('public.get_1v1_map_priorities()'::regprocedure))='e76be6c759f4aad8d4e1fd58da5909f3' then
  execute 'CREATE OR REPLACE FUNCTION public.get_1v1_map_priorities()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''''
AS $runtime_guard$
begin
  -- Pixel runtime boundary: before original variable initializers or writes.
  perform app_private.require_pixel_runtime();
  <<skyway_original>>
declare
  v_uid uuid := auth.uid();
  v_order text[];
begin
  if v_uid is null then raise exception ''Sign in required''; end if;

  select array_agg(vote.map_key order by vote.priority)
  into v_order
  from public.player_1v1_map_priorities vote
  where vote.user_id = v_uid;

  return jsonb_build_object(
    ''configured'', coalesce(cardinality(v_order), 0) = 2,
    ''map_votes'', coalesce(to_jsonb(v_order), ''[]''::jsonb),
    ''map_order'', coalesce(to_jsonb(v_order), ''[]''::jsonb),
    ''max_selections'', 2,
    ''catalog'', public.get_1v1_map_catalog()
  );
end;
end
$runtime_guard$
';
 elsif (select md5(prosrc) from pg_proc where oid='public.get_1v1_map_priorities()'::regprocedure)<>'8f115c3fbdc9d79dd9b28e9ee6ee96d3' then
  raise exception 'Unreviewed RPC source: %','get_1v1_map_priorities()';
 end if;

 if md5(pg_get_functiondef('public.get_1v1_state(uuid)'::regprocedure))='7e34a158b95819674bee11ed817cecb5' then
  execute 'CREATE OR REPLACE FUNCTION public.get_1v1_state(p_match_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''''
AS $runtime_guard$
begin
  -- Pixel runtime boundary: before original variable initializers or writes.
  perform app_private.require_pixel_runtime();
  <<skyway_original>>
declare u uuid:=auth.uid();p jsonb;w integer;
begin
 if u is null or not exists(select 1 from public.multiplayer_players where match_id=p_match_id and user_id=u) then raise exception ''Match not found'';end if;
 perform app_private.settle_ruins_completed_pumpkins(p_match_id); p:=app_private.get_1v1_state_qol_base(p_match_id);w:=(p->''match''->>''current_wave'')::integer;
 return p||jsonb_build_object(''self'',(p->''self'')||jsonb_build_object(
  ''purchase_counts'',app_private.armory_purchase_counts(p_match_id,u,w),
  ''ruins_pumpkins_missed'',(select ruins_pumpkins_missed from public.multiplayer_players where match_id=p_match_id and user_id=u),
  ''ruins_pumpkin_last_wave'',(select ruins_pumpkin_last_wave from public.multiplayer_players where match_id=p_match_id and user_id=u),
  ''terminal_facing'',(select terminal_facing from public.multiplayer_players where match_id=p_match_id and user_id=u),
  ''ruins_banned_characters'',(select coalesce(jsonb_agg(character_key order by character_key),''[]'') from app_private.ruins_character_bans where match_id=p_match_id)));
end;
end
$runtime_guard$
';
 elsif (select md5(prosrc) from pg_proc where oid='public.get_1v1_state(uuid)'::regprocedure)<>'5d5089eb9451bac308c8dc46cd2e76d4' then
  raise exception 'Unreviewed RPC source: %','get_1v1_state(uuid)';
 end if;

 if md5(pg_get_functiondef('public.get_admin_ban_appeals(text)'::regprocedure))='baca223ac0a95e266542354b036bca45' then
  execute 'CREATE OR REPLACE FUNCTION public.get_admin_ban_appeals(p_status text DEFAULT ''pending''::text)
 RETURNS TABLE(id bigint, user_id uuid, username text, email text, ban_id bigint, ban_scope text, ban_note text, player_note text, status text, created_at timestamp with time zone, reviewed_at timestamp with time zone, reviewed_by_username text, reviewed_by_email text, admin_note text, appealed_ban_count integer, snapshot_active_ban_count bigint, active_ban_count bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''''
AS $runtime_guard$
begin
  -- Pixel runtime boundary: before original variable initializers or writes.
  perform app_private.require_pixel_runtime();
  <<skyway_original>>
begin
  if not public.is_admin() then
    raise exception ''Admin access required'' using errcode=''42501'';
  end if;

  return query
  select appeal.id,appeal.user_id,profile.username::text,
    lower(users.email)::text,appeal.ban_id,original_ban.scope::text,
    original_ban.reason::text,appeal.player_note::text,
    appeal.status::text,appeal.created_at,appeal.reviewed_at,
    reviewer_profile.username::text,lower(reviewer.email)::text,
    appeal.admin_note::text,cardinality(appeal.appealed_ban_ids),
    (
      select count(*) from public.player_bans snapshotted_ban
      where snapshotted_ban.id=any(appeal.appealed_ban_ids)
        and snapshotted_ban.starts_at<=now()
        and snapshotted_ban.revoked_at is null
        and (snapshotted_ban.expires_at is null
          or snapshotted_ban.expires_at>now())
    )::bigint,
    (
      select count(*) from public.player_bans active_ban
      where active_ban.starts_at<=now()
        and active_ban.revoked_at is null
        and (active_ban.expires_at is null or active_ban.expires_at>now())
        and (active_ban.target_user_id=appeal.user_id or exists(
          select 1 from public.player_device_links link
          where link.user_id=appeal.user_id
            and link.device_id=active_ban.target_device_id
        ))
    )::bigint
  from public.player_ban_appeals appeal
  join neon_auth."user" users on users.id=appeal.user_id
  left join public.player_profiles profile on profile.user_id=appeal.user_id
  left join public.player_bans original_ban on original_ban.id=appeal.ban_id
  left join neon_auth."user" reviewer on reviewer.id=appeal.reviewed_by
  left join public.player_profiles reviewer_profile
    on reviewer_profile.user_id=appeal.reviewed_by
  where appeal.status=''pending''
  order by appeal.created_at desc,appeal.id desc;
end;
end
$runtime_guard$
';
 elsif (select md5(prosrc) from pg_proc where oid='public.get_admin_ban_appeals(text)'::regprocedure)<>'20506313701daac946e8cce508183575' then
  raise exception 'Unreviewed RPC source: %','get_admin_ban_appeals(text)';
 end if;

 if md5(pg_get_functiondef('public.get_admin_reports()'::regprocedure))='02aa7d8afb91bb90def94fc6b93434e2' then
  execute 'CREATE OR REPLACE FUNCTION public.get_admin_reports()
 RETURNS TABLE(id bigint, user_id uuid, username text, report_type text, message text, status text, created_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''''
AS $runtime_guard$
begin
  -- Pixel runtime boundary: before original variable initializers or writes.
  perform app_private.require_pixel_runtime();
  <<skyway_original>>
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception ''Admin access required'' using errcode = ''42501'';
  end if;

  return query
  select
    report.id,
    report.user_id,
    profile.username::text,
    report.report_type,
    report.message,
    report.status,
    report.created_at
  from public.player_reports report
  left join public.player_profiles profile
    on profile.user_id = report.user_id
  where report.status <> ''resolved''
  order by report.created_at desc;
end;
end
$runtime_guard$
';
 elsif (select md5(prosrc) from pg_proc where oid='public.get_admin_reports()'::regprocedure)<>'07a55c29bed8e822d9f7dc1c8300e74b' then
  raise exception 'Unreviewed RPC source: %','get_admin_reports()';
 end if;

 if md5(pg_get_functiondef('public.get_admin_role()'::regprocedure))='5d48b9a287d941254970192eb8b73152' then
  execute 'CREATE OR REPLACE FUNCTION public.get_admin_role()
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''''
AS $runtime_guard$
#variable_conflict use_column
begin
  perform app_private.require_pixel_runtime();
  return (select admin.role
  from public.admin_users admin
  where auth.uid() is not null
    and admin.user_id = auth.uid()
    and not app_private.has_active_ban(auth.uid(), ''account'', null)
  limit 1);
end
$runtime_guard$
';
 elsif (select md5(prosrc) from pg_proc where oid='public.get_admin_role()'::regprocedure)<>'25047f964ab2e6b203ed171ca5641121' then
  raise exception 'Unreviewed RPC source: %','get_admin_role()';
 end if;

 if md5(pg_get_functiondef('public.get_admin_test_mode()'::regprocedure))='220741af0bc2134b3bcd680a23c52a67' then
  execute 'CREATE OR REPLACE FUNCTION public.get_admin_test_mode()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''''
AS $runtime_guard$
#variable_conflict use_column
begin
  perform app_private.require_pixel_runtime();
  return (select jsonb_build_object(''enabled'',false));
end
$runtime_guard$
';
 elsif (select md5(prosrc) from pg_proc where oid='public.get_admin_test_mode()'::regprocedure)<>'cc24d55dca253907e1d71d46ccbffc6e' then
  raise exception 'Unreviewed RPC source: %','get_admin_test_mode()';
 end if;

 if md5(pg_get_functiondef('public.get_leaderboard()'::regprocedure))='af2aafa2634a60cdd1ca80011e8f83fa' then
  execute 'CREATE OR REPLACE FUNCTION public.get_leaderboard()
 RETURNS TABLE(rank bigint, username text, high_score bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''''
AS $runtime_guard$
#variable_conflict use_column
begin
  perform app_private.require_pixel_runtime();
  return query select row_number() over(order by stats.high_score desc,profile.username asc),
    profile.username,stats.high_score
  from public.player_stats stats
  join public.player_profiles profile on profile.user_id=stats.user_id
  where auth.uid() is not null and stats.high_score>0
    and app_private.is_leaderboard_visible(stats.user_id)
  order by stats.high_score desc,profile.username asc
  limit 50;
end
$runtime_guard$
';
 elsif (select md5(prosrc) from pg_proc where oid='public.get_leaderboard()'::regprocedure)<>'26fb70ada061f63170b1baf7d62d69c2' then
  raise exception 'Unreviewed RPC source: %','get_leaderboard()';
 end if;

 if md5(pg_get_functiondef('public.get_mastery_profile()'::regprocedure))='804e97da2b9a32e9f27d0f0453c573fb' then
  execute 'CREATE OR REPLACE FUNCTION public.get_mastery_profile()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''''
AS $runtime_guard$
begin
  -- Pixel runtime boundary: before original variable initializers or writes.
  perform app_private.require_pixel_runtime();
  <<skyway_original>>
declare u uuid:=app_private.photon_user();p app_private.player_mastery_preferences;v jsonb;f text;
begin
 select * into p from app_private.player_mastery_preferences where user_id=u;
 select coalesce(jsonb_object_agg(character_key,jsonb_build_object(''quest'',quest,
  ''progress'',case when character_key=''runner_stride'' and quest=2 then jsonb_build_array(progress,progress_two) else jsonb_build_array(progress) end,
  ''complete'',quest=3,''mastered'',mastered,''masteryEnabled'',mastery_enabled,''flairRewriteEnabled'',flair_rewrite_enabled)),''{}''::jsonb)
 into v from app_private.player_mastery_quests where user_id=u;
 f:=p.flair_character;
 if not coalesce(app_private.mastery_owns_character(u,f),false) then
  select character_key into f from public.player_loadouts where user_id=u;
  if not coalesce(app_private.mastery_owns_character(u,f),false) then f:=''runner_ace'';end if;
 end if;
 return jsonb_build_object(''account'',jsonb_build_object(''active'',p.active_character,''quests'',v),''flair_key'',f,''randomizer'',coalesce(p.endless_randomizer,false),
 ''photons'',(select photons from public.player_photon_fury where user_id=u and unlocked_at is not null));
end;
end
$runtime_guard$
';
 elsif (select md5(prosrc) from pg_proc where oid='public.get_mastery_profile()'::regprocedure)<>'4dbb72b587a084d148a90f9bda25d6c3' then
  raise exception 'Unreviewed RPC source: %','get_mastery_profile()';
 end if;

 if md5(pg_get_functiondef('public.get_mastery_salve_uses(uuid)'::regprocedure))='1ea6ec3a834f9bbd3917ca927d5165a0' then
  execute 'CREATE OR REPLACE FUNCTION public.get_mastery_salve_uses(p_context_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''''
AS $runtime_guard$
begin
  -- Pixel runtime boundary: before original variable initializers or writes.
  perform app_private.require_pixel_runtime();
  <<skyway_original>>
declare u uuid:=app_private.photon_user();n integer;
begin
 select least(3,coalesce((event_counts->>''salve-heal'')::integer,0)) into n from app_private.mastery_sessions
 where user_id=u and context_id=p_context_id and context_type in(''endless'',''1v1'') and character_key=''medic_salve'' and finished_at is null;
 if n is null or not app_private.mastery_owns_character(u,''medic_salve'') then raise exception ''Owned active Salve run required'';end if;
 return n;
end;
end
$runtime_guard$
';
 elsif (select md5(prosrc) from pg_proc where oid='public.get_mastery_salve_uses(uuid)'::regprocedure)<>'be809ad27c7e391c319392a232aa0307' then
  raise exception 'Unreviewed RPC source: %','get_mastery_salve_uses(uuid)';
 end if;

 if md5(pg_get_functiondef('public.get_mastery_smoke_effect(uuid)'::regprocedure))='dae7be9b073060961b821b30419b4386' then
  execute 'CREATE OR REPLACE FUNCTION public.get_mastery_smoke_effect(p_match_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''''
AS $runtime_guard$
begin
  -- Pixel runtime boundary: before original variable initializers or writes.
  perform app_private.require_pixel_runtime();
  <<skyway_original>>
declare u uuid:=app_private.photon_user();p public.multiplayer_players;o public.multiplayer_players;m public.multiplayer_matches;
 s app_private.mastery_smoke_state;e app_private.mastery_smoke_actions;top numeric:=0;mastered boolean:=false;
begin
 select * into m from public.multiplayer_matches where id=p_match_id;
 select * into p from public.multiplayer_players where match_id=p_match_id and user_id=u;
 if m.id is null or p.user_id is null then raise exception ''Owned 1v1 match required'';end if;
 select * into o from public.multiplayer_players where match_id=p_match_id and user_id<>u limit 1;
 if m.status=''playing'' and m.finished_at is null and p.status=''playing'' then
  select * into e from app_private.mastery_smoke_actions where match_id=p_match_id and user_id=o.user_id and active_until>clock_timestamp() order by created_at desc limit 1;
  if exists(select 1 from app_private.mastery_sessions ms join app_private.player_mastery_quests q on q.user_id=ms.user_id and q.character_key=''trickster_smoke''
   where ms.user_id=o.user_id and ms.context_id=p_match_id and ms.context_type=''1v1'' and ms.finished_at is null and ms.flair_character=''trickster_smoke''
    and q.mastered and q.flair_rewrite_enabled and app_private.mastery_owns_character(o.user_id,''trickster_smoke'')) then
   top:=case when o.character_key=''trickster_smoke'' then .4 else .2 end;
  end if;
 end if;
 select coalesce(bool_or(q.mastered and q.mastery_enabled),false) into mastered from app_private.player_mastery_quests q where q.user_id=u and q.character_key=''trickster_smoke'';
 select * into s from app_private.mastery_smoke_state where match_id=p_match_id and user_id=u;
 return jsonb_build_object(''strength'',e.strength,''active_until'',e.active_until,''flair_top'',top,
  ''own_bombs_remaining'',case when p.character_key=''trickster_smoke'' and mastered then 3-case when s.wave=p.wave then coalesce(s.bombs_used,0) else 0 end else null end,
  ''own_cooldown_until'',s.cooldown_until,''self_heavy'',p.character_key=''trickster_smoke'' and mastered and s.wave=p.wave and s.bombs_used=3);
end;
end
$runtime_guard$
';
 elsif (select md5(prosrc) from pg_proc where oid='public.get_mastery_smoke_effect(uuid)'::regprocedure)<>'900484e06d31ddfd81d33a0104f19ec7' then
  raise exception 'Unreviewed RPC source: %','get_mastery_smoke_effect(uuid)';
 end if;

 if md5(pg_get_functiondef('public.get_my_pixel_identity()'::regprocedure))='fed83a0ccbd387560f8160bb07260c71' then
  execute 'CREATE OR REPLACE FUNCTION public.get_my_pixel_identity()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''''
AS $runtime_guard$
#variable_conflict use_column
begin
  perform app_private.require_pixel_runtime();
  return (select jsonb_build_object(''linked'',true,''username'',username,''profileVersion'',profile_version,''credentialVersion'',credential_version) from app_private.pixel_links where user_id=auth.uid());
end
$runtime_guard$
';
 elsif (select md5(prosrc) from pg_proc where oid='public.get_my_pixel_identity()'::regprocedure)<>'dcd67cbb9bcebc48ef966f2c4da6badc' then
  raise exception 'Unreviewed RPC source: %','get_my_pixel_identity()';
 end if;

 if md5(pg_get_functiondef('public.get_my_report_permission()'::regprocedure))='dba48bc42bccff12c46edcd0b5b4273b' then
  execute 'CREATE OR REPLACE FUNCTION public.get_my_report_permission()
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''''
AS $runtime_guard$
begin
  -- Pixel runtime boundary: before original variable initializers or writes.
  perform app_private.require_pixel_runtime();
  <<skyway_original>>
declare u uuid := auth.uid();
begin
  if u is null then raise exception ''Sign in required'' using errcode=''42501''; end if;
  return coalesce((select allowed from app_private.player_report_permissions where user_id=u),true);
end;
end
$runtime_guard$
';
 elsif (select md5(prosrc) from pg_proc where oid='public.get_my_report_permission()'::regprocedure)<>'153bf7ae09861feee6575d6a67792d95' then
  raise exception 'Unreviewed RPC source: %','get_my_report_permission()';
 end if;

 if md5(pg_get_functiondef('public.get_photon_fury_profile()'::regprocedure))='df59ddf9e197786be4541abd8b3b1b14' then
  execute 'CREATE OR REPLACE FUNCTION public.get_photon_fury_profile()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''''
AS $runtime_guard$
begin
  -- Pixel runtime boundary: before original variable initializers or writes.
  perform app_private.require_pixel_runtime();
  <<skyway_original>>
declare u uuid:=app_private.photon_user();p public.player_photon_fury;c text;w text;
begin
 select * into p from public.player_photon_fury where user_id=u;
 c:=case when app_private.owns_photon_character(u,p.selected_character_key) then p.selected_character_key else ''photon_magician'' end;
 w:=case when exists(select 1 from app_private.photon_weapon_rules(p.selected_weapon_key))
  and app_private.photon_weapon_compatible(p.selected_weapon_key,c) and (p.selected_weapon_key=''lightsaber'' or exists(
   select 1 from app_private.photon_unlocks where user_id=u and kind=''weapon'' and item_key=''photon_weapon_''||p.selected_weapon_key))
  then p.selected_weapon_key else ''lightsaber'' end;
 return jsonb_build_object(''unlocked'',p.unlocked_at is not null,''photons'',coalesce(p.photons,0),
  ''character_keys'',(select coalesce(jsonb_agg(character_key),''[]''::jsonb) from app_private.photon_character_rules(null)
   where p.unlocked_at is not null and app_private.owns_photon_character(u,character_key)),
  ''selected_character_key'',c,''selected_weapon_key'',w,''selected_theme_key'',coalesce(p.selected_theme_key,''default''),
  ''skin_choices'',coalesce(p.skin_choices,''{}''::jsonb),''box_nonce'',p.box_nonce,
  ''skin_keys'',(select coalesce(jsonb_agg(item_key),''[]''::jsonb) from app_private.photon_unlocks where user_id=u and kind=''skin''),
  ''theme_keys'',(select coalesce(jsonb_agg(item_key),''[]''::jsonb) from app_private.photon_unlocks where user_id=u and kind=''theme''),
  ''weapon_keys'',(select coalesce(jsonb_agg(replace(item_key,''photon_weapon_'','''')),''[]''::jsonb) from app_private.photon_unlocks where user_id=u and kind=''weapon''));
end;
end
$runtime_guard$
';
 elsif (select md5(prosrc) from pg_proc where oid='public.get_photon_fury_profile()'::regprocedure)<>'3dc209dcd2912d143c2b25a1c913e807' then
  raise exception 'Unreviewed RPC source: %','get_photon_fury_profile()';
 end if;

 if md5(pg_get_functiondef('public.get_player_progression()'::regprocedure))='ed7b6013d71fa557b8b353039c29b458' then
  execute 'CREATE OR REPLACE FUNCTION public.get_player_progression()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''''
AS $runtime_guard$
begin
  -- Pixel runtime boundary: before original variable initializers or writes.
  perform app_private.require_pixel_runtime();
  <<skyway_original>>
declare u uuid:=auth.uid();s public.player_stats;paid boolean;unlimited jsonb;
begin
 if u is null then raise exception ''Sign in required'';end if;
 insert into public.player_stats(user_id,total_gems,high_score,updated_at) values(u,0,0,now()) on conflict(user_id) do nothing;
 select * into s from public.player_stats where user_id=u;
 perform app_private.retain_level_mode_unlocks(u,s.level);
 paid:=exists(select 1 from app_private.ranked_requalification where user_id=u and qualified);
 unlimited:=app_private.unlimited_1v1_requirements(u);
 if (unlimited->>''unlocked'')::boolean then insert into app_private.mode_unlock_entitlements(user_id,mode) values(u,''unlimited'') on conflict do nothing;end if;
 return jsonb_build_object(''level'',s.level,''xp'',s.xp_in_level,''xp_required'',app_private.xp_required_for_level(s.level),
 ''lifetime_xp'',s.lifetime_xp,''completed_runs'',s.completed_runs,''casual_unlocked'',app_private.has_level_mode_unlocked(u,''casual''),
 ''rotating_unlocked'',app_private.has_level_mode_unlocked(u,''rotating''),''ranked_purchased'',paid,''ranked_unlocked'',paid,
 ''photon_unlocked'',exists(select 1 from public.player_photon_fury where user_id=u and unlocked_at is not null),
 ''unlimited_unlocked'',exists(select 1 from app_private.mode_unlock_entitlements where user_id=u and mode=''unlimited''),
 ''unlimited_requirements'',unlimited,''progression_version'',s.progression_version);
end;
end
$runtime_guard$
';
 elsif (select md5(prosrc) from pg_proc where oid='public.get_player_progression()'::regprocedure)<>'dbd9da294041b88d1cfd43d08b044be3' then
  raise exception 'Unreviewed RPC source: %','get_player_progression()';
 end if;

 if md5(pg_get_functiondef('public.get_rotating_mode()'::regprocedure))='85eba7d63cedcc3a689270b68d8ea4ab' then
  execute 'CREATE OR REPLACE FUNCTION public.get_rotating_mode()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''''
AS $runtime_guard$
#variable_conflict use_column
begin
  perform app_private.require_pixel_runtime();
  return (select jsonb_build_object(''active_mode'',app_private.rotating_mode_19(now()),''required_level'',15,
  ''next_rotation_at'',(((now() at time zone ''America/New_York'')::date+1)::timestamp at time zone ''America/New_York'')));
end
$runtime_guard$
';
 elsif (select md5(prosrc) from pg_proc where oid='public.get_rotating_mode()'::regprocedure)<>'8de1b299e61f8e77d9e2221427c27d5b' then
  raise exception 'Unreviewed RPC source: %','get_rotating_mode()';
 end if;

 if md5(pg_get_functiondef('public.is_admin()'::regprocedure))='7053d4a3051e3b8ecfd26895942a3bdb' then
  execute 'CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''''
AS $runtime_guard$
#variable_conflict use_column
begin
  perform app_private.require_pixel_runtime();
  return (select auth.uid() is not null
    and not app_private.has_active_ban(auth.uid(), ''account'', null)
    and exists (
      select 1
      from public.admin_users admin
      where admin.user_id = auth.uid()
    ));
end
$runtime_guard$
';
 elsif (select md5(prosrc) from pg_proc where oid='public.is_admin()'::regprocedure)<>'a40b9a2ee84b1a73e8aa845507fff77f' then
  raise exception 'Unreviewed RPC source: %','is_admin()';
 end if;

 if md5(pg_get_functiondef('public.join_1v1_queue(text)'::regprocedure))='37bee9c2cfa5400c532f70f96dd1a3e6' then
  execute 'CREATE OR REPLACE FUNCTION public.join_1v1_queue(p_mode text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''''
AS $runtime_guard$
begin
  -- Pixel runtime boundary: before original variable initializers or writes.
  perform app_private.require_pixel_runtime();
  <<skyway_original>>
declare u uuid:=auth.uid();k text:=lower(trim(p_mode));name text;other uuid;other_name text;mid uuid;m public.multiplayer_matches;
pool text[];candidates text[];map text:=''classic'';v_rarity text;classes text[];r float8;ck text;class text;slot integer;uid uuid;
begin
if u is null then raise exception ''Sign in required'';end if;
if k is null or k not in(''casual'',''ranked'',''unlimited'',''rng'',''hardcore_duel'',''quicksand'',''mundane'') then raise exception ''Unknown duel mode'';end if;
if app_private.has_active_ban(u,''account'',null) then raise exception ''This account is banned'';end if;
perform pg_advisory_xact_lock(917240115);
select mm.* into m from public.multiplayer_matches mm join public.multiplayer_players p on p.match_id=mm.id
where p.user_id=u and mm.status in(''countdown'',''playing'',''intermission'') order by mm.created_at desc limit 1;
if m.id is not null then return jsonb_build_object(''match_id'',m.id,''status'',m.status,''mode'',m.mode,''map_key'',m.map_key,
''opponent_username'',(select username from public.multiplayer_players where match_id=m.id and user_id<>u limit 1));end if;
-- Map Refresh Casual level 5.
-- Update 2.3 queue mode rules.
if not app_private.duel_mode_allowed_23(u,k) then raise exception ''Complete the unlock requirements for this duel mode'';end if;
if k in(''rng'',''hardcore_duel'',''quicksand'',''mundane'') and k<>app_private.rotating_mode_19(now()) then raise exception ''Choose today''''s active New York mode'';end if;
if k=''ranked'' and (not exists(select 1 from app_private.ranked_requalification where user_id=u and qualified) or
app_private.has_active_ban(u,''leaderboard'',null)) then raise exception ''Ranked requires level 25, its unlock, and no score ban'';end if;
select username into name from public.player_profiles where user_id=u;
if name is null then raise exception ''Choose a username before entering 1v1'';end if;
delete from public.multiplayer_queue where queued_at<now()-interval ''2 minutes'';
select q.user_id,p.username into other,other_name from public.multiplayer_queue q join public.player_profiles p on p.user_id=q.user_id join public.player_stats st on st.user_id=q.user_id
where q.user_id<>u and q.mode=k and not app_private.has_active_ban(q.user_id,''account'',null)
and app_private.duel_mode_allowed_23(q.user_id,k)
and (k<>''ranked'' or (exists(select 1 from app_private.ranked_requalification where user_id=q.user_id and qualified) and not app_private.has_active_ban(q.user_id,''leaderboard'',null)))
and not exists(select 1 from public.multiplayer_players mp join public.multiplayer_matches mm on mm.id=mp.match_id where mp.user_id=q.user_id and mm.status in(''countdown'',''playing'',''intermission''))
order by q.queued_at limit 1 for update of q skip locked;
if other is null then
insert into public.multiplayer_queue values(u,now(),k) on conflict(user_id) do update set queued_at=excluded.queued_at,mode=excluded.mode;
return jsonb_build_object(''match_id'',null,''status'',''waiting'',''mode'',k);
end if;
-- QOL Map Refresh pool: Unknown is incomplete and unavailable.
pool:=case when k=''hardcore_duel'' then array[''classic'',''ruins'',''desert'',''skyway'',''pitch'',''factory'',''meadow''] else array[''classic'',''ruins'',''desert'',''skyway'',''pitch'',''volcano'',''factory'',''grove'',''meadow'',''terminal''] end;
select array_agg(key) into candidates from (select key from unnest(pool) key order by random() limit 4) x;
if k=''rng'' then
r:=random();map:=case when r<.3 then ''classic'' when r<.55 then ''pitch'' when r<.8 then ''factory'' else ''meadow'' end;
r:=random();v_rarity:=case when r<.15 then ''uncommon'' when r<.5 then ''rare'' when r<.85 then ''epic'' else ''legendary'' end;
candidates:=array[map];
select array_agg(key) into classes from (select key from unnest(array[''runner'',''medic'',''tank'',''trickster'',''misc'']) key order by random()) x;
end if;
if k=''quicksand'' then map:=''classic'';candidates:=array[map];
elsif k=''mundane'' then r:=random();map:=case when r<.55 then ''classic'' when r<.80 then ''factory'' when r<.90 then ''meadow'' else ''pitch'' end;candidates:=array[map];end if;
insert into public.multiplayer_matches(host_user_id,guest_user_id,mode,map_key,map_candidates,map_selection_method,character_selection_ends_at)
values(other,u,k,map,candidates,case when k=''rng'' then ''rng'' when k in(''quicksand'',''mundane'') then ''fixed'' else ''bans'' end,null) returning id into mid;
for slot in 1..2 loop
uid:=case when slot=1 then other else u end;ck:=''runner_ace'';class:=''runner'';
if k=''rng'' then
class:=classes[slot];select item_key into ck from public.extraction_catalog where active and item_type=''character'' and character_class=class and rarity=v_rarity order by random() limit 1;
if ck is null then raise exception ''Missing RNG % % character pool'',v_rarity,class;end if;
end if;
insert into public.multiplayer_players(match_id,user_id,slot,username,character_key,character_class,max_hearts,hearts,lane_index)
values(mid,uid,slot,case when slot=1 then other_name else name end,ck,class,3,3,2);
end loop;
insert into app_private.match_setup_19 values(mid,case when k in(''rng'',''quicksand'',''mundane'') then ''announce'' else ''ban'' end,clock_timestamp()+case when k in(''rng'',''quicksand'',''mundane'') then interval ''4 seconds'' else interval ''10 seconds'' end,v_rarity);
if k in(''rng'',''quicksand'',''mundane'') then perform app_private.setup_19_health(mid);end if;
delete from public.multiplayer_queue where user_id in(u,other);
return jsonb_build_object(''match_id'',mid,''status'',''countdown'',''mode'',k,''map_key'',map,''opponent_username'',other_name);
end;
end
$runtime_guard$
';
 elsif (select md5(prosrc) from pg_proc where oid='public.join_1v1_queue(text)'::regprocedure)<>'0d05b1b965ae186dc5c2e5cd4070e828' then
  raise exception 'Unreviewed RPC source: %','join_1v1_queue(text)';
 end if;

 if md5(pg_get_functiondef('public.leave_1v1()'::regprocedure))='77da4a34bdda6ecef65f79251c6f9a33' then
  execute 'CREATE OR REPLACE FUNCTION public.leave_1v1()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''''
AS $runtime_guard$
begin
  -- Pixel runtime boundary: before original variable initializers or writes.
  perform app_private.require_pixel_runtime();
  <<skyway_original>>
declare
  v_uid uuid := auth.uid();
  v_match_id uuid;
begin
  if v_uid is null then raise exception ''Sign in required''; end if;

  delete from public.multiplayer_queue where user_id = v_uid;
  select player.match_id into v_match_id
  from public.multiplayer_players player
  join public.multiplayer_matches match on match.id = player.match_id
  where player.user_id = v_uid
    and match.status in (''countdown'', ''playing'', ''intermission'')
  order by match.created_at desc
  limit 1
  for update of match;

  if v_match_id is null then
    return jsonb_build_object(''match_id'', null, ''status'', ''left_queue'');
  end if;
  return public.finish_1v1(v_match_id);
end;
end
$runtime_guard$
';
 elsif (select md5(prosrc) from pg_proc where oid='public.leave_1v1()'::regprocedure)<>'d5f4186c0f1c3d474b69f77bc34889e1' then
  raise exception 'Unreviewed RPC source: %','leave_1v1()';
 end if;

 if md5(pg_get_functiondef('public.list_admins()'::regprocedure))='37e13ee2222e0ba60cf2afbbaafceaf7' then
  execute 'CREATE OR REPLACE FUNCTION public.list_admins()
 RETURNS TABLE(user_id uuid, email text, username text, role text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''''
AS $runtime_guard$
begin
  -- Pixel runtime boundary: before original variable initializers or writes.
  perform app_private.require_pixel_runtime();
  <<skyway_original>>
begin
  if not public.is_admin() then
    raise exception ''Admin access required'' using errcode = ''42501'';
  end if;

  return query
  select
    users.id,
    lower(users.email)::text,
    profile.username::text,
    admin.role
  from public.admin_users admin
  join neon_auth."user" users
    on (admin.user_id is not null and users.id = admin.user_id)
    or (
      admin.user_id is null
      and users.email is not null
      and lower(users.email) = admin.email
    )
  left join public.player_profiles profile on profile.user_id = users.id
  order by
    case when admin.role = ''main'' then 0 else 1 end,
    lower(users.email);
end;
end
$runtime_guard$
';
 elsif (select md5(prosrc) from pg_proc where oid='public.list_admins()'::regprocedure)<>'fd0b490cfec87f287f7c5479fdde3b5a' then
  raise exception 'Unreviewed RPC source: %','list_admins()';
 end if;

 if md5(pg_get_functiondef('public.manage_admin(text,text)'::regprocedure))='9367106ca37cccf5720a44614c34fb99' then
  execute 'CREATE OR REPLACE FUNCTION public.manage_admin(target text, admin_action text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''''
AS $runtime_guard$
begin
  -- Pixel runtime boundary: before original variable initializers or writes.
  perform app_private.require_pixel_runtime();
  <<skyway_original>>
declare
  v_actor_id uuid := auth.uid();
  v_target text := lower(trim(coalesce(target, '''')));
  v_action text := lower(trim(coalesce(admin_action, '''')));
  v_target_id uuid;
  v_target_email text;
  v_existing_email text;
  v_existing_role text;
  v_has_admin boolean := false;
  v_main_count bigint;
begin
  if not public.is_main_admin() then
    raise exception ''Only main admins can manage admins'' using errcode = ''42501'';
  end if;

  if v_action = ''kick'' then
    v_action := ''remove'';
  end if;
  if v_action not in (''add'', ''promote'', ''demote'', ''remove'') then
    raise exception ''Admin action must be add, promote, demote, or remove''
      using errcode = ''22023'';
  end if;
  if v_target = '''' then
    raise exception ''Enter an email or username'' using errcode = ''22023'';
  end if;

  -- Only one main-admin role mutation may proceed at a time. Rechecking after
  -- the lock prevents an actor who was demoted while waiting from continuing.
  lock table public.admin_users in share row exclusive mode;

  -- Serialize this grant path with account-ban creation. The write triggers
  -- below recheck the invariant as defense in depth for every caller.
  perform app_private.lock_admin_security_state();

  if not public.is_main_admin() then
    raise exception ''Only main admins can manage admins'' using errcode = ''42501'';
  end if;

  select users.id, lower(users.email)::text
  into v_target_id, v_target_email
  from neon_auth."user" users
  left join public.player_profiles profile on profile.user_id = users.id
  where users.email is not null
    and (
      lower(users.email) = v_target
      or lower(profile.username) = v_target
    )
  order by case when lower(users.email) = v_target then 0 else 1 end
  limit 1;

  if v_target_id is null or v_target_email is null then
    raise exception ''No player found with that email or username'';
  end if;

  select admin.email, admin.role
  into v_existing_email, v_existing_role
  from public.admin_users admin
  where admin.user_id = v_target_id
     or (
       admin.user_id is null
       and admin.email = v_target_email
     )
  order by (admin.user_id = v_target_id) desc nulls last
  limit 1
  for update;

  v_has_admin := found;

  if exists (
    select 1
    from public.admin_users collision
    where collision.email = v_target_email
      and (
        not v_has_admin
        or collision.email <> v_existing_email
      )
  ) then
    raise exception ''Admin identity conflict for that Auth email'';
  end if;

  if v_actor_id = v_target_id and v_action in (''demote'', ''remove'') then
    raise exception ''You cannot remove or demote yourself'';
  end if;

  if v_action in (''add'', ''promote'')
     and exists (
       select 1
       from public.player_bans ban
       where ban.scope = ''account''
         and ban.target_user_id = v_target_id
         and ban.revoked_at is null
         and (ban.expires_at is null or ban.expires_at > now())
     ) then
    raise exception ''Remove the unexpired account ban before granting admin access'';
  end if;

  if v_action = ''add'' then
    if v_has_admin then
      raise exception ''That player is already an admin'';
    end if;

    insert into public.admin_users(email, user_id, role)
    values (v_target_email, v_target_id, ''co_admin'');
    return;
  end if;

  if not v_has_admin then
    raise exception ''Add this player as a co-admin first'';
  end if;

  if v_action = ''promote'' then
    if v_existing_role = ''main'' then
      raise exception ''That player is already a main admin'';
    end if;

    update public.admin_users admin
    set email = v_target_email,
        user_id = v_target_id,
        role = ''main''
    where admin.email = v_existing_email;
    return;
  end if;

  if v_action = ''demote'' then
    if v_existing_role <> ''main'' then
      raise exception ''That player is already a co-admin'';
    end if;

    select count(*)
    into v_main_count
    from public.admin_users admin
    where admin.role = ''main'';

    if v_main_count <= 1 then
      raise exception ''The last main admin cannot be demoted. Promote a replacement first.'';
    end if;

    update public.admin_users admin
    set email = v_target_email,
        user_id = v_target_id,
        role = ''co_admin''
    where admin.email = v_existing_email;
    return;
  end if;

  if v_existing_role = ''main'' then
    raise exception ''Demote this main admin before removing them'';
  end if;

  delete from public.admin_users admin
  where admin.email = v_existing_email;
end;
end
$runtime_guard$
';
 elsif (select md5(prosrc) from pg_proc where oid='public.manage_admin(text,text)'::regprocedure)<>'541cc094531aeff1daf1173b89aa1641' then
  raise exception 'Unreviewed RPC source: %','manage_admin(text,text)';
 end if;

 if md5(pg_get_functiondef('public.purchase_1v1_comet_removal(uuid,text,text)'::regprocedure))='c8685a5f1aa22c71386d20e809b9be49' then
  execute 'CREATE OR REPLACE FUNCTION public.purchase_1v1_comet_removal(p_match_id uuid, p_purchase_id text, p_obstacle_type text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''''
AS $runtime_guard$
begin
  -- Pixel runtime boundary: before original variable initializers or writes.
  perform app_private.require_pixel_runtime();
  <<skyway_original>>
declare
  v_uid uuid := auth.uid();
  v_purchase_id text := btrim(p_purchase_id);
  v_type text := lower(btrim(p_obstacle_type));
  v_match public.multiplayer_matches;
  v_self public.multiplayer_players;
  v_existing public.multiplayer_comet_removals;
  v_base_cost integer;
  v_cost integer;
  v_heat_consumed numeric := 0;
  v_remaining numeric;
  v_receipt_id uuid;
  v_spawn_wave integer;
  v_now timestamptz := clock_timestamp();
begin
  if v_uid is null then raise exception ''Sign in required''; end if;
  if p_purchase_id is null
     or length(v_purchase_id) not between 1 and 160 then
    raise exception ''Removal purchase id must contain 1 to 160 characters'';
  end if;
  if v_type = ''spikes'' then v_type := ''spike''; end if;
  v_base_cost := case v_type
    when ''barrel'' then 6
    when ''log'' then 6
    when ''snowflake'' then 7
    when ''car'' then 8
    when ''spike'' then 8
    when ''rock'' then 8
    else null
  end;
  if v_base_cost is null then
    raise exception ''Only natural barrels, logs, snowflakes, cars, spikes, and rocks can be removed'';
  end if;

  select * into v_match from public.multiplayer_matches match_row
  where match_row.id = p_match_id for update;
  select * into v_self from public.multiplayer_players player
  where player.match_id = p_match_id and player.user_id = v_uid
  for update;
  if v_match.id is null or v_self.user_id is null then
    raise exception ''1v1 match not found'';
  end if;

  -- Lost-response retries return their original receipt even if the shared
  -- intermission ended after the successful first transaction.
  select * into v_existing
  from public.multiplayer_comet_removals receipt
  where receipt.match_id = p_match_id and receipt.user_id = v_uid
    and receipt.purchase_id = v_purchase_id;
  if v_existing.id is not null then
    if v_existing.obstacle_type <> v_type then
      raise exception ''Removal purchase id was already used for another obstacle'';
    end if;
    return jsonb_build_object(
      ''match_id'', p_match_id,
      ''receipt_id'', v_existing.id,
      ''purchase_id'', v_existing.purchase_id,
      ''obstacle_type'', v_existing.obstacle_type,
      ''point_cost'', v_existing.point_cost,
      ''spawn_wave'', v_existing.spawn_wave,
      ''duplicate'', true,
      ''remaining_points'', v_self.obstacle_points,
      ''heatfeast'', app_private.one_v_one_heatfeast_json(
        p_match_id, v_uid, v_self.wave
      )
    );
  end if;
  if v_match.status <> ''intermission''
     or v_match.intermission_ends_at is null
     or v_match.intermission_ends_at <= v_now
     or v_self.status <> ''intermission'' then
    raise exception ''Natural removals can only be bought during the 10-second intermission'';
  end if;
  if v_self.character_key <> ''runner_comet'' then
    raise exception ''Only Comet can buy natural obstacle removals'';
  end if;

  insert into public.multiplayer_heatfeast(match_id)
  values (p_match_id) on conflict (match_id) do nothing;
  select ledger.consumed into v_heat_consumed
  from public.multiplayer_heatfeast ledger
  where ledger.match_id = p_match_id for update;
  v_cost := case when coalesce(v_heat_consumed, 0) >= 500
    then ceil(v_base_cost::numeric / 2)::integer
    else v_base_cost
  end;
  v_spawn_wave := greatest(v_match.current_wave, v_self.wave);

  update public.multiplayer_players player
  set obstacle_points = player.obstacle_points - v_cost,
      last_seen_at = v_now,
      updated_at = v_now
  where player.match_id = p_match_id and player.user_id = v_uid
    and player.status = ''intermission''
    and player.obstacle_points >= v_cost
  returning obstacle_points into v_remaining;
  if v_remaining is null then raise exception ''Not enough obstacle points''; end if;

  insert into public.multiplayer_comet_removals(
    match_id, user_id, purchase_id, obstacle_type,
    point_cost, spawn_wave, created_at
  ) values (
    p_match_id, v_uid, v_purchase_id, v_type,
    v_cost, v_spawn_wave, v_now
  ) returning id into v_receipt_id;
  update public.multiplayer_heatfeast ledger
  set stored = ledger.stored + v_cost,
      updated_at = v_now
  where ledger.match_id = p_match_id;
  update public.multiplayer_matches match_row
  set last_activity_at = v_now where match_row.id = p_match_id;
  return jsonb_build_object(
    ''match_id'', p_match_id,
    ''receipt_id'', v_receipt_id,
    ''purchase_id'', v_purchase_id,
    ''obstacle_type'', v_type,
    ''base_point_cost'', v_base_cost,
    ''point_cost'', v_cost,
    ''spawn_wave'', v_spawn_wave,
    ''duplicate'', false,
    ''remaining_points'', v_remaining,
    ''heatfeast'', app_private.one_v_one_heatfeast_json(
      p_match_id, v_uid, v_self.wave
    )
  );
end;
end
$runtime_guard$
';
 elsif (select md5(prosrc) from pg_proc where oid='public.purchase_1v1_comet_removal(uuid,text,text)'::regprocedure)<>'1fe74256d6af7d37de7078ba10fe4efd' then
  raise exception 'Unreviewed RPC source: %','purchase_1v1_comet_removal(uuid,text,text)';
 end if;

 if md5(pg_get_functiondef('public.purchase_catalog_item(text)'::regprocedure))='e20a873e4de09ba26e70d1bf076bfad9' then
  execute 'CREATE OR REPLACE FUNCTION public.purchase_catalog_item(p_item_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''''
AS $runtime_guard$
begin
  -- Pixel runtime boundary: before original variable initializers or writes.
  perform app_private.require_pixel_runtime();
  <<skyway_original>>
declare u uuid:=auth.uid();item record;price integer;g bigint;sd bigint;owned boolean;
begin
  if u is null then raise exception ''Sign in required'';end if;
  if app_private.has_active_ban(u,''account'',null) then raise exception ''This account is banned'';end if;
  if lower(trim(p_item_key)) like ''photon_weapon_%'' then return app_private.purchase_photon_weapon(lower(trim(p_item_key)));end if;
  select c.* into item from public.extraction_catalog c where c.item_key=lower(trim(p_item_key))
    and c.active and c.extractable and c.item_key not like ''photon_%'';
  if item.item_key is null then raise exception ''Item is not available'';end if;
  price:=app_private.direct_catalog_price(item.rarity,item.item_type);
  if price is null then raise exception ''This item cannot be directly unlocked'';end if;
  insert into public.player_stats(user_id,total_gems,high_score,updated_at) values(u,0,0,now()) on conflict(user_id) do nothing;
  select total_gems,stardust into g,sd from public.player_stats where user_id=u for update;
  owned:=exists(select 1 from public.player_unlocks where user_id=u and item_key=item.item_key);
  if not owned then
    if sd<price then raise exception ''Not enough Stardust'';end if;
    insert into public.player_unlocks(user_id,item_key,item_type,rarity,unlocked_at)
      values(u,item.item_key,item.item_type,item.rarity,now()) on conflict(user_id,item_key) do nothing;
    if found then
      update public.player_stats set stardust=stardust-price,updated_at=now() where user_id=u returning stardust into sd;
    else owned:=true;end if;
  end if;
  return jsonb_build_object(''item_key'',item.item_key,''display_name'',item.display_name,''item_type'',item.item_type,
    ''rarity'',item.rarity,''cost'',case when owned then 0 else price end,''gems'',g,''total_gems'',g,''stardust'',sd,''currency'',''stardust'',''already_owned'',owned,''is_new'',not owned);
end;
end
$runtime_guard$
';
 elsif (select md5(prosrc) from pg_proc where oid='public.purchase_catalog_item(text)'::regprocedure)<>'c42e6bf46725f1ebeeea75fb42730749' then
  raise exception 'Unreviewed RPC source: %','purchase_catalog_item(text)';
 end if;

 if md5(pg_get_functiondef('public.purchase_mastery_quest(text)'::regprocedure))='9c7362e98445f7bc9432b3f4f5e24631' then
  execute 'CREATE OR REPLACE FUNCTION public.purchase_mastery_quest(p_character_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''''
AS $runtime_guard$
begin
  -- Pixel runtime boundary: before original variable initializers or writes.
  perform app_private.require_pixel_runtime();
  <<skyway_original>>
declare u uuid:=app_private.photon_user();cost integer:=app_private.mastery_price(p_character_key);b bigint;
begin
 if cost is null then raise exception ''This character has no mastery quest'';end if;
 if not app_private.mastery_owns_character(u,p_character_key) then raise exception ''Unlock this character first'';end if;
 if app_private.is_admin_test_user(u) then raise exception ''Turn off Test Mode before purchasing'';end if;
 perform pg_advisory_xact_lock(hashtextextended(u::text,23));
 if exists(select 1 from app_private.player_mastery_quests where user_id=u and character_key=p_character_key) then return public.get_mastery_profile();end if;
 select photons into b from public.player_photon_fury where user_id=u and unlocked_at is not null for update;
 if b is null or b<cost then raise exception ''You need % photons'',cost;end if;
 update public.player_photon_fury set photons=photons-cost where user_id=u;
 insert into app_private.player_mastery_quests(user_id,character_key) values(u,p_character_key);
 insert into app_private.player_mastery_preferences(user_id,active_character) values(u,p_character_key)
 on conflict(user_id) do update set active_character=coalesce(app_private.player_mastery_preferences.active_character,excluded.active_character);
 return public.get_mastery_profile();
end;
end
$runtime_guard$
';
 elsif (select md5(prosrc) from pg_proc where oid='public.purchase_mastery_quest(text)'::regprocedure)<>'12baa752fd4e374458a571685eff4c36' then
  raise exception 'Unreviewed RPC source: %','purchase_mastery_quest(text)';
 end if;

 if md5(pg_get_functiondef('public.record_1v1_ruins_pumpkin(uuid,integer,boolean)'::regprocedure))='eec68e586d90edbae1432abad9972ca0' then
  execute 'CREATE OR REPLACE FUNCTION public.record_1v1_ruins_pumpkin(p_match_id uuid, p_wave integer, p_collected boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''''
AS $runtime_guard$
begin
  -- Pixel runtime boundary: before original variable initializers or writes.
  perform app_private.require_pixel_runtime();
  <<skyway_original>>
declare u uuid:=auth.uid();m public.multiplayer_matches;p public.multiplayer_players;w integer;previous boolean;
begin
 if u is null then raise exception ''Sign in required'';end if;
 select * into m from public.multiplayer_matches where id=p_match_id for update;
 select * into p from public.multiplayer_players where match_id=p_match_id and user_id=u for update;
 if m.map_key is distinct from ''ruins'' or p.user_id is null then raise exception ''Ruins participant required'';end if;
 if p_wave is null or p_wave not between 1 and 100000 or p_collected is null then raise exception ''Invalid pumpkin outcome'';end if;
 select collected into previous from app_private.ruins_pumpkin_receipts where match_id=p_match_id and user_id=u and wave=p_wave;
 if found then
  if previous is distinct from p_collected then raise exception ''Pumpkin outcome already recorded'';end if;
  return public.get_1v1_state(p_match_id);
 end if;
 if app_private.has_active_ban(u,''account'',null) then raise exception ''This account is banned'';end if;
 if m.status not in(''playing'',''intermission'') or p.status not in(''playing'',''intermission'') then raise exception ''Active Ruins game required'';end if;
 if p_wave>p.wave or p_wave>m.current_wave or p_wave<greatest(1,p.wave-1) then raise exception ''Pumpkin receipt is outside the current wave'';end if;
 for w in p.ruins_pumpkin_last_wave+1..p_wave-1 loop
  perform app_private.apply_ruins_pumpkin(p_match_id,u,w,false);
  if (select ruins_pumpkins_missed from public.multiplayer_players where match_id=p_match_id and user_id=u)=3 then return public.get_1v1_state(p_match_id);end if;
 end loop;
 perform app_private.apply_ruins_pumpkin(p_match_id,u,p_wave,p_collected);
 return public.get_1v1_state(p_match_id);
end;
end
$runtime_guard$
';
 elsif (select md5(prosrc) from pg_proc where oid='public.record_1v1_ruins_pumpkin(uuid,integer,boolean)'::regprocedure)<>'a272664c4cf47147b7f42cf8bdb4b93d' then
  raise exception 'Unreviewed RPC source: %','record_1v1_ruins_pumpkin(uuid,integer,boolean)';
 end if;

 if md5(pg_get_functiondef('public.record_1v1_terminal_contact(uuid,text,text)'::regprocedure))='41a7f3e5c89d2b809907b94d3b6198cd' then
  execute 'CREATE OR REPLACE FUNCTION public.record_1v1_terminal_contact(p_match_id uuid, p_item_id text, p_kind text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''''
AS $runtime_guard$
begin
  -- Pixel runtime boundary: before original variable initializers or writes.
  perform app_private.require_pixel_runtime();
  <<skyway_original>>
declare a public.multiplayer_players; m public.multiplayer_matches;
begin
  if auth.uid() is null then raise exception ''Sign in required''; end if;
  select * into m from public.multiplayer_matches where id=p_match_id for update;
  select * into a from public.multiplayer_players where match_id=p_match_id and user_id=auth.uid() for update;
  if a.user_id is null or m.map_key<>''terminal'' or m.status<>''playing'' or a.status<>''playing'' then raise exception ''Active Terminal match required''; end if;
  if p_kind not in (''rock'',''spikes'') or p_item_id is null or p_item_id !~ ''^-[0-9]{1,15}$'' then raise exception ''Invalid contact''; end if;
  if (select count(*) from app_private.terminal_contact_receipts where match_id=p_match_id and user_id=a.user_id and wave=a.wave)>=100 then raise exception ''Contact limit reached''; end if;
  insert into app_private.terminal_contact_receipts values(p_match_id,a.user_id,a.wave,p_item_id) on conflict do nothing;
  if found then update public.multiplayer_players set sword_durability=greatest(0,sword_durability-1) where match_id=p_match_id and user_id=a.user_id; end if;
  return public.get_1v1_state(p_match_id);
end;
end
$runtime_guard$
';
 elsif (select md5(prosrc) from pg_proc where oid='public.record_1v1_terminal_contact(uuid,text,text)'::regprocedure)<>'f55d1397b8e458ffe4abd4676f1361e1' then
  raise exception 'Unreviewed RPC source: %','record_1v1_terminal_contact(uuid,text,text)';
 end if;

 if md5(pg_get_functiondef('public.redeem_1v1_comet_removal(uuid,uuid,text)'::regprocedure))='7f0799caf042b702c63fd8783311af5f' then
  execute 'CREATE OR REPLACE FUNCTION public.redeem_1v1_comet_removal(p_match_id uuid, p_receipt_id uuid, p_obstacle_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''''
AS $runtime_guard$
begin
  -- Pixel runtime boundary: before original variable initializers or writes.
  perform app_private.require_pixel_runtime();
  <<skyway_original>>
declare
  v_uid uuid := auth.uid();
  v_obstacle_id text := btrim(p_obstacle_id);
  v_match public.multiplayer_matches;
  v_self public.multiplayer_players;
  v_receipt public.multiplayer_comet_removals;
  v_now timestamptz := clock_timestamp();
begin
  if v_uid is null then raise exception ''Sign in required''; end if;
  if p_receipt_id is null or p_obstacle_id is null
     or length(v_obstacle_id) not between 1 and 160 then
    raise exception ''Removal receipt and obstacle id are required'';
  end if;
  select * into v_match from public.multiplayer_matches match_row
  where match_row.id = p_match_id for update;
  select * into v_self from public.multiplayer_players player
  where player.match_id = p_match_id and player.user_id = v_uid
  for update;
  select * into v_receipt from public.multiplayer_comet_removals receipt
  where receipt.id = p_receipt_id and receipt.match_id = p_match_id
    and receipt.user_id = v_uid for update;
  if v_match.id is null or v_self.user_id is null or v_receipt.id is null then
    raise exception ''Comet removal receipt not found'';
  end if;
  if v_match.status <> ''playing'' or v_self.status <> ''playing''
     or v_receipt.spawn_wave <> v_self.wave then
    raise exception ''This removal receipt is not valid in the current wave'';
  end if;
  if v_receipt.redeemed_at is not null then
    if v_receipt.obstacle_id <> v_obstacle_id then
      raise exception ''This removal receipt was already redeemed'';
    end if;
    return jsonb_build_object(
      ''match_id'', p_match_id,
      ''receipt_id'', v_receipt.id,
      ''obstacle_type'', v_receipt.obstacle_type,
      ''obstacle_id'', v_receipt.obstacle_id,
      ''duplicate'', true
    );
  end if;
  update public.multiplayer_comet_removals receipt
  set obstacle_id = v_obstacle_id,
      redeemed_at = v_now
  where receipt.id = p_receipt_id;
  return jsonb_build_object(
    ''match_id'', p_match_id,
    ''receipt_id'', v_receipt.id,
    ''obstacle_type'', v_receipt.obstacle_type,
    ''obstacle_id'', v_obstacle_id,
    ''duplicate'', false
  );
end;
end
$runtime_guard$
';
 elsif (select md5(prosrc) from pg_proc where oid='public.redeem_1v1_comet_removal(uuid,uuid,text)'::regprocedure)<>'140be1e87c40925c7ac0824dfe9e9cb6' then
  raise exception 'Unreviewed RPC source: %','redeem_1v1_comet_removal(uuid,uuid,text)';
 end if;

 if md5(pg_get_functiondef('public.reflect_1v1_attack(uuid,text,text)'::regprocedure))='5df81fe46ecb558db5656389963b0192' then
  execute 'CREATE OR REPLACE FUNCTION public.reflect_1v1_attack(p_match_id uuid, p_reflection_id text, p_obstacle_type text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''''
AS $runtime_guard$
#variable_conflict use_column
begin
  perform app_private.require_pixel_runtime();
  return (select public.reflect_1v1_attack(
    p_match_id, p_reflection_id, p_obstacle_type, null::uuid
  ));
end
$runtime_guard$
';
 elsif (select md5(prosrc) from pg_proc where oid='public.reflect_1v1_attack(uuid,text,text)'::regprocedure)<>'3df3e7ed88a387ad3105c5e312a50e7a' then
  raise exception 'Unreviewed RPC source: %','reflect_1v1_attack(uuid,text,text)';
 end if;

 if md5(pg_get_functiondef('public.reflect_1v1_attack(uuid,text,text,uuid)'::regprocedure))='f99ed3fcc37ff8e1221c2a11ff4cced1' then
  execute 'CREATE OR REPLACE FUNCTION public.reflect_1v1_attack(p_match_id uuid, p_reflection_id text, p_obstacle_type text, p_source_attack_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''''
AS $runtime_guard$
begin
  -- Pixel runtime boundary: before original variable initializers or writes.
  perform app_private.require_pixel_runtime();
  <<skyway_original>>
declare
  v_uid uuid := auth.uid();
  v_reflection_id text := trim(p_reflection_id);
  v_type text := lower(trim(p_obstacle_type));
  v_match public.multiplayer_matches;
  v_self public.multiplayer_players;
  v_target public.multiplayer_players;
  v_existing public.multiplayer_katana_events;
  v_existing_attack public.multiplayer_attacks;
  v_source_attack public.multiplayer_attacks;
  v_attack_id uuid;
  v_activation_reflections integer := 0;
  v_placement record;
  v_now timestamptz := clock_timestamp();
begin
  if v_uid is null then raise exception ''Sign in required''; end if;
  if v_reflection_id is null
     or length(v_reflection_id) not between 1 and 160 then
    raise exception ''A valid katana reflection id is required'';
  end if;
  if v_type = ''spikes'' then v_type := ''spike''; end if;
  if v_type not in (
    ''barrel'', ''log'', ''car'', ''snowflake'', ''current'', ''spike'', ''rock''
  ) then
    raise exception ''That obstacle cannot interact with the Pitch katana'';
  end if;

  select * into v_match from public.multiplayer_matches
  where id = p_match_id for update;
  select * into v_self from public.multiplayer_players
  where match_id = p_match_id and user_id = v_uid for update;
  if v_match.id is null or v_self.user_id is null then
    raise exception ''1v1 match not found'';
  end if;

  select * into v_existing from public.multiplayer_katana_events event
  where event.match_id = p_match_id and event.user_id = v_uid
    and event.reflection_id = v_reflection_id;
  if v_existing.reflection_id is not null then
    if v_existing.attack_id is not null then
      select * into v_existing_attack from public.multiplayer_attacks attack
      where attack.id = v_existing.attack_id;
    end if;
    return jsonb_build_object(
      ''match_id'', p_match_id,
      ''reflection_id'', v_reflection_id,
      ''duplicate'', true,
      ''outcome'', v_existing.outcome,
      ''attack_id'', v_existing.attack_id,
      ''source_attack_id'', v_existing.source_attack_id,
      ''obstacle_type'', v_existing.obstacle_type,
      ''lane_index'', v_existing_attack.lane_index,
      ''lane_group'', v_existing_attack.lane_group,
      ''lane_position'', v_existing_attack.lane_position,
      ''wall_parity'', v_existing_attack.wall_parity,
      ''wall_lane_index'', v_existing_attack.wall_lane_index,
      ''wall_size'', v_existing_attack.wall_size,
      ''spawn_wave'', v_existing.wave,
      ''katana_broken'', v_existing.outcome = ''broken'' or v_self.katana_broken,
      ''katana_cooldown_ends_at'', case
        when v_existing.outcome = ''broken'' then null
        else coalesce(v_self.katana_cooldown_until,v_self.last_katana_at + interval ''6.4 seconds'')
      end,
      ''katana_cooldown_until'', case
        when v_existing.outcome = ''broken'' then null
        else coalesce(v_self.katana_cooldown_until,v_self.last_katana_at + interval ''6.4 seconds'')
      end
    );
  end if;

  if v_match.map_key <> ''pitch'' then
    raise exception ''Katana reflection is only available on Pitch'';
  end if;
  if v_match.status <> ''playing'' or v_self.status <> ''playing'' then
    raise exception ''Katana can only be used during active play'';
  end if;
  if v_self.katana_broken then raise exception ''The katana is broken''; end if;
  if v_self.last_katana_wave is distinct from v_self.wave
     or v_self.last_katana_at is null
     or v_self.last_katana_at < v_now - interval ''0.4 seconds''/(1+.25*greatest(v_self.wave-1,0)) then
    raise exception ''Katana is not active'';
  end if;
  select count(*)::integer into v_activation_reflections
  from public.multiplayer_katana_events event
  where event.match_id = p_match_id and event.user_id = v_uid
    and event.wave = v_self.wave
    and event.created_at >= v_self.last_katana_at;
  if v_activation_reflections >= 1 then
    raise exception ''Katana reflection limit reached'';
  end if;

  if p_source_attack_id is not null then
    select * into v_source_attack
    from public.multiplayer_attacks attack
    where attack.id = p_source_attack_id
      and attack.match_id = p_match_id
      and attack.target_user_id = v_uid
      and attack.obstacle_type = v_type
      and attack.delivered_at is null
    for update;
    if v_source_attack.id is null then
      raise exception ''Pending reflected attack not found'';
    end if;
  end if;

  if v_type = ''rock'' then
    insert into public.multiplayer_katana_events(
      match_id, user_id, reflection_id, wave, obstacle_type, outcome,
      source_attack_id, created_at
    ) values (
      p_match_id, v_uid, v_reflection_id, v_self.wave, v_type, ''broken'',
      p_source_attack_id, v_now
    );
    if p_source_attack_id is not null then
      update public.multiplayer_attacks
      set delivered_at = v_now where id = p_source_attack_id;
    end if;
    update public.multiplayer_players
    set katana_broken = true,
        last_katana_at = v_now,
        last_katana_wave = v_self.wave,
        last_seen_at = v_now,
        updated_at = v_now
    where match_id = p_match_id and user_id = v_uid;
    update public.multiplayer_matches set last_activity_at = v_now
    where id = p_match_id;
    return jsonb_build_object(
      ''match_id'', p_match_id,
      ''reflection_id'', v_reflection_id,
      ''duplicate'', false,
      ''outcome'', ''broken'',
      ''attack_id'', null,
      ''source_attack_id'', p_source_attack_id,
      ''obstacle_type'', v_type,
      ''lane_index'', null,
      ''lane_group'', null,
      ''lane_position'', null,
      ''spawn_wave'', v_self.wave,
      ''katana_broken'', true,
      ''katana_cooldown_ends_at'', null,
      ''katana_cooldown_until'', null
    );
  end if;

  select * into v_target from public.multiplayer_players
  where match_id = p_match_id and user_id <> v_uid limit 1;
  if v_target.user_id is null
     or v_target.status in (''eliminated'', ''left'', ''finished'') then
    raise exception ''The opponent is no longer accepting reflected attacks'';
  end if;

  select * into v_placement
  from app_private.next_1v1_attack_placement(
    p_match_id, v_uid, v_target.user_id, v_type
  );
  insert into public.multiplayer_katana_events(
    match_id, user_id, reflection_id, wave, obstacle_type, outcome,
    source_attack_id, created_at
  ) values (
    p_match_id, v_uid, v_reflection_id, v_self.wave, v_type, ''reflected'',
    p_source_attack_id, v_now
  );
  insert into public.multiplayer_attacks(
    match_id, sender_user_id, target_user_id,
    obstacle_type, point_cost, spawn_wave, source,
    lane_index, lane_group, lane_position, escape_lane_index,
    wall_parity, wall_lane_index, wall_size, created_at
  ) values (
    p_match_id, v_uid, v_target.user_id,
    v_type, 0, v_self.wave, ''katana'',
    v_placement.lane_index, v_placement.lane_group,
    v_placement.lane_position, v_placement.escape_lane_index,
    v_placement.wall_parity, v_placement.wall_lane_index,
    v_placement.wall_size, v_now
  ) returning id into v_attack_id;
  if p_source_attack_id is not null then
    update public.multiplayer_attacks
    set delivered_at = v_now where id = p_source_attack_id;
  end if;
  update public.multiplayer_katana_events
  set attack_id = v_attack_id
  where match_id = p_match_id and user_id = v_uid
    and reflection_id = v_reflection_id;
  update public.multiplayer_players
  set katana_cooldown_until=v_now+interval ''6 seconds'', last_seen_at = v_now,
      updated_at = v_now
  where match_id = p_match_id and user_id = v_uid;
  update public.multiplayer_matches set last_activity_at = v_now
  where id = p_match_id;

  return jsonb_build_object(
    ''match_id'', p_match_id,
    ''reflection_id'', v_reflection_id,
    ''duplicate'', false,
    ''outcome'', ''reflected'',
    ''attack_id'', v_attack_id,
    ''source_attack_id'', p_source_attack_id,
    ''obstacle_type'', v_type,
    ''lane_index'', v_placement.lane_index,
    ''lane_group'', v_placement.lane_group,
    ''lane_position'', v_placement.lane_position,
    ''wall_parity'', v_placement.wall_parity,
    ''wall_lane_index'', v_placement.wall_lane_index,
    ''wall_size'', v_placement.wall_size,
    ''spawn_wave'', v_self.wave,
    ''katana_broken'', false,
    ''katana_cooldown_ends_at'', v_now + interval ''6 seconds'',
    ''katana_cooldown_until'', v_now + interval ''6 seconds''
  );
end;
end
$runtime_guard$
';
 elsif (select md5(prosrc) from pg_proc where oid='public.reflect_1v1_attack(uuid,text,text,uuid)'::regprocedure)<>'e65e871c256ae154cdffbeda6cf2519d' then
  raise exception 'Unreviewed RPC source: %','reflect_1v1_attack(uuid,text,text,uuid)';
 end if;

 if md5(pg_get_functiondef('public.register_player_device(text,text)'::regprocedure))='d367bc63ac6b8f4066fcd266d37c052d' then
  execute 'CREATE OR REPLACE FUNCTION public.register_player_device(p_device_token text, p_label text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''''
AS $runtime_guard$
begin
  -- Pixel runtime boundary: before original variable initializers or writes.
  perform app_private.require_pixel_runtime();
  <<skyway_original>>
declare
  v_uid uuid := auth.uid();
  v_hash bytea;
  v_device_id uuid;
  v_label text := nullif(trim(p_label), '''');
  v_bans jsonb;
begin
  if v_uid is null then
    raise exception ''Sign in required'';
  end if;
  if p_device_token is null
     or p_device_token !~ ''^[A-Za-z0-9._~+/=-]{24,128}$'' then
    raise exception ''Invalid app device token'';
  end if;
  if v_label is not null and char_length(v_label) > 80 then
    raise exception ''Device label must be 80 characters or fewer'';
  end if;

  v_hash := extensions.digest(
    convert_to(p_device_token, ''UTF8''),
    ''sha256''
  );

  insert into public.player_devices(
    token_hash, token_hint, label, first_seen_at, last_seen_at
  ) values (
    v_hash,
    left(p_device_token, 4) || ''…'' || right(p_device_token, 4),
    v_label,
    now(),
    now()
  )
  on conflict (token_hash) do update
  set label = coalesce(excluded.label, public.player_devices.label),
      last_seen_at = now()
  returning id into v_device_id;

  insert into public.player_device_links(
    user_id, device_id, first_seen_at, last_seen_at
  ) values (
    v_uid, v_device_id, now(), now()
  )
  on conflict (user_id, device_id) do update
  set last_seen_at = now();

  select coalesce(
    jsonb_agg(jsonb_build_object(
      ''id'', ban.id,
      ''scope'', ban.scope,
      ''expires_at'', ban.expires_at,
      ''reason'', ban.reason
    ) order by ban.created_at),
    ''[]''::jsonb
  )
  into v_bans
  from public.player_bans ban
  where ban.starts_at <= now()
    and ban.revoked_at is null
    and (ban.expires_at is null or ban.expires_at > now())
    and (
      ban.target_user_id = v_uid
      or ban.target_device_id = v_device_id
    );

  return jsonb_build_object(
    ''device_id'', v_device_id,
    ''account_banned'', app_private.has_active_ban(v_uid, ''account'', null),
    ''device_banned'', app_private.has_active_ban(v_uid, ''device'', v_device_id),
    ''leaderboard_banned'', app_private.has_active_ban(v_uid, ''leaderboard'', null),
    ''active_bans'', v_bans
  );
end;
end
$runtime_guard$
';
 elsif (select md5(prosrc) from pg_proc where oid='public.register_player_device(text,text)'::regprocedure)<>'d6eaa201f134880f7d5c7815e3d60084' then
  raise exception 'Unreviewed RPC source: %','register_player_device(text,text)';
 end if;

 if md5(pg_get_functiondef('public.reset_endless_gem_streak(uuid)'::regprocedure))='7cf64ec504939fc6b36d015d10b389f9' then
  execute 'CREATE OR REPLACE FUNCTION public.reset_endless_gem_streak(p_run_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''''
AS $runtime_guard$
begin
  -- Pixel runtime boundary: before original variable initializers or writes.
  perform app_private.require_pixel_runtime();
  <<skyway_original>>
declare
  v_uid uuid:=auth.uid();
  v_wave integer;
  v_last_heartbeat timestamptz;
  v_active boolean;
begin
  if v_uid is null then raise exception ''Sign in required''; end if;
  if p_run_id is null then raise exception ''Run ID is required''; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text,1));

  select verified_wave,last_heartbeat_at,heartbeat_active
  into v_wave,v_last_heartbeat,v_active
  from public.player_progression_runs
  where run_id=p_run_id and user_id=v_uid
    and completed_at is null
    and started_at>now()-interval ''6 hours''
  for update;
  if not found then raise exception ''Active Endless run not found''; end if;
  if not coalesce(v_active,false)
     or v_last_heartbeat is null
     or v_last_heartbeat<clock_timestamp()-interval ''8 seconds'' then
    raise exception ''Streak reset requires active Endless play'';
  end if;

  insert into public.player_endless_gem_streaks(
    run_id,user_id,wave,streak,updated_at
  ) values(p_run_id,v_uid,v_wave,0,now())
  on conflict(run_id) do update
  set user_id=excluded.user_id,
      wave=excluded.wave,
      streak=0,
      updated_at=now()
  where public.player_endless_gem_streaks.user_id=excluded.user_id;

  return jsonb_build_object(
    ''run_id'',p_run_id,
    ''wave'',v_wave,
    ''streak'',0,
    ''reset'',true
  );
end;
end
$runtime_guard$
';
 elsif (select md5(prosrc) from pg_proc where oid='public.reset_endless_gem_streak(uuid)'::regprocedure)<>'4130a32a6d3565cbbbf83b31e7f3863f' then
  raise exception 'Unreviewed RPC source: %','reset_endless_gem_streak(uuid)';
 end if;

 if md5(pg_get_functiondef('public.resolve_ban_appeal(bigint,text,text)'::regprocedure))='bf563c2964db602933d6d5b8c3181e0d' then
  execute 'CREATE OR REPLACE FUNCTION public.resolve_ban_appeal(p_appeal_id bigint, p_action text, p_admin_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''''
AS $runtime_guard$
begin
  -- Pixel runtime boundary: before original variable initializers or writes.
  perform app_private.require_pixel_runtime();
  <<skyway_original>>
declare
  v_actor uuid:=auth.uid();
  v_actor_email text;
  v_action text:=lower(trim(coalesce(p_action,'''')));
  v_admin_note text:=nullif(trim(coalesce(p_admin_note,'''')),'''');
  v_appeal public.player_ban_appeals%rowtype;
  v_revoked_count integer:=0;
  v_revoked_ban_ids jsonb:=''[]''::jsonb;
  v_result jsonb;
begin
  if not public.is_main_admin() then
    raise exception ''Only main admins can resolve appeals''
      using errcode=''42501'';
  end if;
  if v_action not in(''approve'',''deny'') then
    raise exception ''Appeal action must be approve or deny''
      using errcode=''22023'';
  end if;
  if v_admin_note is not null and char_length(v_admin_note)>500 then
    raise exception ''Admin note must be 500 characters or fewer''
      using errcode=''22023'';
  end if;

  select appeal.* into v_appeal
  from public.player_ban_appeals appeal
  where appeal.id=p_appeal_id for update;
  if not found then raise exception ''Appeal not found'' using errcode=''P0002''; end if;
  if v_appeal.status<>''pending'' then
    raise exception ''That appeal has already been reviewed'';
  end if;
  if v_action=''approve''
     and coalesce(cardinality(v_appeal.appealed_ban_ids),0)=0 then
    raise exception ''This legacy appeal has no safe ban snapshot and cannot auto-unban'';
  end if;

  if v_action=''approve'' then
    with revoked as(
      update public.player_bans ban
      set revoked_at=now(),revoked_by=v_actor,
          revoked_reason=left(case when v_admin_note is null
            then ''Appeal approved''
            else ''Appeal approved: ''||v_admin_note end,500)
      where ban.starts_at<=now() and ban.revoked_at is null
        and (ban.expires_at is null or ban.expires_at>now())
        and ban.id=any(v_appeal.appealed_ban_ids)
        and (ban.target_user_id=v_appeal.user_id or exists(
          select 1 from public.player_device_links link
          where link.user_id=v_appeal.user_id
            and link.device_id=ban.target_device_id
        ))
      returning ban.id
    )
    select count(*)::integer,
      coalesce(jsonb_agg(revoked.id order by revoked.id),''[]''::jsonb)
    into v_revoked_count,v_revoked_ban_ids from revoked;

    update public.player_ban_appeals appeal
    set status=''approved'',reviewed_at=now(),reviewed_by=v_actor,
        admin_note=v_admin_note
    where appeal.id=v_appeal.id;
  else
    update public.player_ban_appeals appeal
    set status=''denied'',reviewed_at=now(),reviewed_by=v_actor,
        admin_note=v_admin_note
    where appeal.id=v_appeal.id;
  end if;

  select lower(users.email) into v_actor_email
  from neon_auth."user" users where users.id=v_actor;
  v_result:=jsonb_build_object(
    ''ok'',true,''appeal_id'',v_appeal.id,
    ''status'',case when v_action=''approve'' then ''approved'' else ''denied'' end,
    ''target_user_id'',v_appeal.user_id,''revoked_count'',v_revoked_count,
    ''revoked_ban_ids'',v_revoked_ban_ids
  );
  insert into public.admin_command_audit(
    actor_user_id,actor_email,target_user_id,action,command_text,
    request,result,succeeded,created_at
  ) values(
    v_actor,coalesce(v_actor_email,''''),v_appeal.user_id,
    case when v_action=''approve''
      then ''appeal_approve_unban'' else ''appeal_deny'' end,
    null,jsonb_build_object(
      ''appeal_id'',v_appeal.id,''admin_note'',v_admin_note
    ),v_result,true,now()
  );
  return v_result;
end;
end
$runtime_guard$
';
 elsif (select md5(prosrc) from pg_proc where oid='public.resolve_ban_appeal(bigint,text,text)'::regprocedure)<>'9ed2f3a471777d2a096c04fa72aadc42' then
  raise exception 'Unreviewed RPC source: %','resolve_ban_appeal(bigint,text,text)';
 end if;

 if md5(pg_get_functiondef('public.resolve_player_report(bigint)'::regprocedure))='297577d44234c40c5a646cd5c2beaafd' then
  execute 'CREATE OR REPLACE FUNCTION public.resolve_player_report(report_id bigint)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''''
AS $runtime_guard$
begin
  -- Pixel runtime boundary: before original variable initializers or writes.
  perform app_private.require_pixel_runtime();
  <<skyway_original>>
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception ''Admin access required'' using errcode = ''42501'';
  end if;

  delete from public.player_reports report
  where report.id = report_id;

  if not found then
    raise exception ''Report not found'' using errcode = ''P0002'';
  end if;
end;
end
$runtime_guard$
';
 elsif (select md5(prosrc) from pg_proc where oid='public.resolve_player_report(bigint)'::regprocedure)<>'5ffa50a4c1fbe1deab1b9eaa7b82a173' then
  raise exception 'Unreviewed RPC source: %','resolve_player_report(bigint)';
 end if;

 if md5(pg_get_functiondef('public.send_1v1_attack(uuid,text,integer)'::regprocedure))='02f3021540cac9a393348309330130d7' then
  execute 'CREATE OR REPLACE FUNCTION public.send_1v1_attack(p_match_id uuid, p_obstacle_type text, p_cost integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''''
AS $runtime_guard$
begin
  -- Pixel runtime boundary: before original variable initializers or writes.
  perform app_private.require_pixel_runtime();
  <<skyway_original>>
declare u uuid:=auth.uid();m public.multiplayer_matches;k text:=lower(trim(p_obstacle_type));result jsonb;prior integer;
begin
 if u is null or not exists(select 1 from public.multiplayer_players where match_id=p_match_id and user_id=u) then raise exception ''Match not found'';end if;
 if app_private.has_active_ban(u,''account'',null) then raise exception ''This account is banned'';end if;
 select * into m from public.multiplayer_matches where id=p_match_id for update;
 if k=''spikes'' then k:=''spike'';end if;
 if m.map_key=''terminal'' then raise exception ''Terminal has no attack purchases'';end if;
 if not exists(select 1 from app_private.one_v_one_map_rules where map_key=m.map_key and k=any(allowed_attacks)) then raise exception ''Obstacle unavailable on this map'';end if;
 select coalesce(quantity,0) into prior from app_private.armory_purchases where match_id=p_match_id and user_id=u and wave=m.current_wave and kind=k;
 prior:=coalesce(prior,0);
 if k<>''snowflake'' and prior>=4 then raise exception ''Maximum four purchases of this obstacle per wave'';end if;
 result:=app_private.send_1v1_attack_qol_base(p_match_id,k,p_cost);
 -- One paid purchase. Free Comet/Gambit copies neither increase p nor consume its cap.
 insert into app_private.armory_purchases values(p_match_id,u,m.current_wave,k,1)
 on conflict(match_id,user_id,wave,kind) do update set quantity=app_private.armory_purchases.quantity+1;
 return result||jsonb_build_object(''purchase_counts'',app_private.armory_purchase_counts(p_match_id,u,m.current_wave));
end;
end
$runtime_guard$
';
 elsif (select md5(prosrc) from pg_proc where oid='public.send_1v1_attack(uuid,text,integer)'::regprocedure)<>'24895974df384f355f1e0b6268747b98' then
  raise exception 'Unreviewed RPC source: %','send_1v1_attack(uuid,text,integer)';
 end if;

 if md5(pg_get_functiondef('public.set_1v1_map_priorities(text[])'::regprocedure))='6d907fe2cb7cfc05a995e1513b03faf4' then
  execute 'CREATE OR REPLACE FUNCTION public.set_1v1_map_priorities(p_map_order text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''''
AS $runtime_guard$
begin
  -- Pixel runtime boundary: before original variable initializers or writes.
  perform app_private.require_pixel_runtime();
  <<skyway_original>>
declare
  v_uid uuid := auth.uid();
  v_order text[];
begin
  if v_uid is null then raise exception ''Sign in required''; end if;
  if p_map_order is null or cardinality(p_map_order) <> 2 then
    raise exception ''Choose exactly two maps to vote for'';
  end if;

  select array_agg(lower(trim(item.map_key)) order by item.ordinality)
  into v_order
  from unnest(p_map_order) with ordinality as item(map_key, ordinality);

  if exists (select 1 from unnest(v_order) item where item is null or item = '''')
     or (select count(distinct item) from unnest(v_order) item) <> 2
     or exists (
       select 1 from unnest(v_order) item
       where item not in (
         ''classic'', ''ruins'', ''desert'', ''skyway'',
         ''pitch'', ''volcano'', ''factory'', ''grove'', ''meadow'', ''terminal''
       )
     ) then
    raise exception ''Choose exactly two different maps from the map list'';
  end if;

  delete from public.player_1v1_map_priorities where user_id = v_uid;
  insert into public.player_1v1_map_priorities(
    user_id, map_key, priority, updated_at
  )
  select v_uid, item.map_key, item.ordinality::smallint, now()
  from unnest(v_order) with ordinality as item(map_key, ordinality);

  return jsonb_build_object(
    ''configured'', true,
    ''map_votes'', to_jsonb(v_order),
    ''map_order'', to_jsonb(v_order),
    ''max_selections'', 2,
    ''catalog'', public.get_1v1_map_catalog()
  );
end;
end
$runtime_guard$
';
 elsif (select md5(prosrc) from pg_proc where oid='public.set_1v1_map_priorities(text[])'::regprocedure)<>'e0f5e3bcc12c99028f9b961e9237ff08' then
  raise exception 'Unreviewed RPC source: %','set_1v1_map_priorities(text[])';
 end if;

 if md5(pg_get_functiondef('public.set_1v1_terminal_facing(uuid,integer)'::regprocedure))='129b4dc0a71da91538f41beb9b8d5fa0' then
  execute 'CREATE OR REPLACE FUNCTION public.set_1v1_terminal_facing(p_match_id uuid, p_facing integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''''
AS $runtime_guard$
begin
  -- Pixel runtime boundary: before original variable initializers or writes.
  perform app_private.require_pixel_runtime();
  <<skyway_original>>
declare u uuid:=auth.uid();m public.multiplayer_matches;a public.multiplayer_players;
begin
 if u is null then raise exception ''Sign in required'';end if;
 select * into m from public.multiplayer_matches where id=p_match_id for update;
 select * into a from public.multiplayer_players where match_id=p_match_id and user_id=u for update;
 if a.user_id is null then raise exception ''Match not found'';end if;
 if m.map_key<>''terminal'' or m.status<>''playing'' or a.status<>''playing'' then raise exception ''Facing requires active Terminal play'';end if;
 if p_facing is null or p_facing not between -1 and 1 then raise exception ''Choose left, forward or right'';end if;
 if app_private.has_active_ban(u,''account'',null) then raise exception ''This account is banned'';end if;
 update public.multiplayer_players set terminal_facing=p_facing,last_seen_at=clock_timestamp(),updated_at=clock_timestamp()
 where match_id=p_match_id and user_id=u;
 return public.get_1v1_state(p_match_id);
end;
end
$runtime_guard$
';
 elsif (select md5(prosrc) from pg_proc where oid='public.set_1v1_terminal_facing(uuid,integer)'::regprocedure)<>'70e820895c5b3d6c7871a5ef45f5a7ac' then
  raise exception 'Unreviewed RPC source: %','set_1v1_terminal_facing(uuid,integer)';
 end if;

 if md5(pg_get_functiondef('public.set_admin_test_mode(boolean)'::regprocedure))='0ab4beb7ca515f0ff9a813332ab9bce6' then
  execute 'CREATE OR REPLACE FUNCTION public.set_admin_test_mode(p_enabled boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''''
AS $runtime_guard$
begin
  -- Pixel runtime boundary: before original variable initializers or writes.
  perform app_private.require_pixel_runtime();
  <<skyway_original>>
begin raise exception ''Test Mode has been removed'';end;
end
$runtime_guard$
';
 elsif (select md5(prosrc) from pg_proc where oid='public.set_admin_test_mode(boolean)'::regprocedure)<>'8e1b224d9077eef6ce8bd0ce28f044db' then
  raise exception 'Unreviewed RPC source: %','set_admin_test_mode(boolean)';
 end if;

 if md5(pg_get_functiondef('public.set_endless_randomizer(boolean)'::regprocedure))='533c538bcc69cc2470059b87a8a6eb5f' then
  execute 'CREATE OR REPLACE FUNCTION public.set_endless_randomizer(p_enabled boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''''
AS $runtime_guard$
begin
  -- Pixel runtime boundary: before original variable initializers or writes.
  perform app_private.require_pixel_runtime();
  <<skyway_original>>
declare u uuid:=app_private.photon_user();
begin
 if p_enabled is null then raise exception ''Choose on or off'';end if;
 insert into app_private.player_mastery_preferences(user_id,endless_randomizer) values(u,p_enabled)
 on conflict(user_id) do update set endless_randomizer=excluded.endless_randomizer;
 return public.get_mastery_profile();
end;
end
$runtime_guard$
';
 elsif (select md5(prosrc) from pg_proc where oid='public.set_endless_randomizer(boolean)'::regprocedure)<>'aad92963335536fbc0e556bba020878a' then
  raise exception 'Unreviewed RPC source: %','set_endless_randomizer(boolean)';
 end if;

 if md5(pg_get_functiondef('public.set_loadout(text,text)'::regprocedure))='11b5eefb4ee858c7d11f7e4128c576cc' then
  execute 'CREATE OR REPLACE FUNCTION public.set_loadout(p_slot text, p_item text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''''
AS $runtime_guard$
begin
  -- Pixel runtime boundary: before original variable initializers or writes.
  perform app_private.require_pixel_runtime();
  <<skyway_original>>
declare
  v_uid uuid:=auth.uid();
  v_slot text:=lower(trim(p_slot));
  v_item text:=lower(trim(coalesce(p_item,'''')));
  v_required_class text;
  v_current_class text;
  v_current_character text;
  v_next_character text;
  v_test_mode boolean:=false;
begin
  if v_uid is null then raise exception ''Sign in required''; end if;
  if v_slot not in(''class'',''character'',''player'',''obstacle'',''environment'') then
    raise exception ''Invalid loadout slot'';
  end if;
  v_test_mode:=app_private.is_admin_test_user(v_uid);

  if v_slot in(''player'',''obstacle'',''environment'')
     and v_item in('''',''default'',''none'') then
    insert into public.player_loadouts(user_id)
    values(v_uid) on conflict(user_id) do nothing;
    update public.player_loadouts
    set player_cosmetic=case when v_slot=''player'' then null else player_cosmetic end,
        obstacle_cosmetic=case when v_slot=''obstacle'' then null else obstacle_cosmetic end,
        environment_cosmetic=case when v_slot=''environment'' then null else environment_cosmetic end,
        updated_at=now()
    where user_id=v_uid;
    return;
  end if;
  if v_item='''' then raise exception ''Invalid loadout item''; end if;

  insert into public.player_loadouts(user_id)
  values(v_uid) on conflict(user_id) do nothing;
  select class_key,character_key into v_current_class,v_current_character
  from public.player_loadouts where user_id=v_uid for update;

  if v_slot=''class'' then
    if v_item not in(''runner'',''medic'',''tank'',''trickster'',''misc'') then
      raise exception ''Invalid class'';
    end if;
    if not v_test_mode
       and v_item<>''runner''
       and not exists(
         select 1 from public.player_unlocks
         where user_id=v_uid and item_type=''class'' and item_key=v_item
       )
       and not exists(
         select 1 from public.player_unlocks unlock
         join public.extraction_catalog catalog
           on catalog.item_key=unlock.item_key
          and catalog.item_type=''character''
          and catalog.character_class=v_item
         where unlock.user_id=v_uid and unlock.item_type=''character''
       ) then raise exception ''Class is not unlocked''; end if;

    if v_current_class=v_item and exists(
      select 1 from public.extraction_catalog catalog
      left join public.player_unlocks unlock
        on unlock.user_id=v_uid and unlock.item_key=catalog.item_key
       and unlock.item_type=''character''
      where catalog.item_key=v_current_character
        and catalog.item_type=''character'' and catalog.active
        and catalog.character_class=v_item
        and (unlock.item_key is not null or v_test_mode)
    ) then
      v_next_character:=v_current_character;
    elsif v_test_mode then
      select catalog.item_key into v_next_character
      from public.extraction_catalog catalog
      where catalog.item_type=''character'' and catalog.active
        and catalog.character_class=v_item
      order by catalog.extractable,catalog.item_key limit 1;
    else
      select unlock.item_key into v_next_character
      from public.player_unlocks unlock
      join public.extraction_catalog catalog
        on catalog.item_key=unlock.item_key
       and catalog.item_type=''character''
       and catalog.character_class=v_item
      where unlock.user_id=v_uid and unlock.item_type=''character''
      order by unlock.unlocked_at,unlock.item_key limit 1;
    end if;
    if v_next_character is null then
      raise exception ''No available character exists for this class'';
    end if;
    update public.player_loadouts
    set class_key=v_item,character_key=v_next_character,updated_at=now()
    where user_id=v_uid;
    return;
  end if;

  if v_slot=''character'' then
    select character_class into v_required_class
    from public.extraction_catalog
    where item_key=v_item and item_type=''character'' and active;
    if v_required_class is null then raise exception ''Invalid character''; end if;
    if not v_test_mode and not exists(
      select 1 from public.player_unlocks
      where user_id=v_uid and item_key=v_item and item_type=''character''
    ) then raise exception ''Character is not unlocked''; end if;
    update public.player_loadouts
    set class_key=v_required_class,character_key=v_item,updated_at=now()
    where user_id=v_uid;
    return;
  end if;

  if not exists(
    select 1 from public.player_unlocks
    where user_id=v_uid and item_key=v_item and item_type=v_slot
  ) then raise exception ''Item is not unlocked for this slot''; end if;
  update public.player_loadouts
  set player_cosmetic=case when v_slot=''player'' then v_item else player_cosmetic end,
      obstacle_cosmetic=case when v_slot=''obstacle'' then v_item else obstacle_cosmetic end,
      environment_cosmetic=case when v_slot=''environment'' then v_item else environment_cosmetic end,
      updated_at=now()
  where user_id=v_uid;
end;
end
$runtime_guard$
';
 elsif (select md5(prosrc) from pg_proc where oid='public.set_loadout(text,text)'::regprocedure)<>'9365e74e499b439ca363d3974e5de80f' then
  raise exception 'Unreviewed RPC source: %','set_loadout(text,text)';
 end if;

 if md5(pg_get_functiondef('public.set_mastery_guard_mode(uuid,boolean)'::regprocedure))='1782616691981973bf4ed8aa247054a2' then
  execute 'CREATE OR REPLACE FUNCTION public.set_mastery_guard_mode(p_context_id uuid, p_enabled boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''''
AS $runtime_guard$
begin
  -- Pixel runtime boundary: before original variable initializers or writes.
  perform app_private.require_pixel_runtime();
  <<skyway_original>>
declare u uuid:=app_private.photon_user();s app_private.mastery_sessions;w integer;
begin
 if p_context_id is null or p_enabled is null then raise exception ''Choose Guard mode on or off'';end if;
 perform pg_advisory_xact_lock(hashtextextended(u::text,23));
 select * into s from app_private.mastery_sessions where user_id=u and context_id=p_context_id and finished_at is null and context_type in(''endless'',''1v1'') for update;
 if s.id is null or s.character_key<>''tank_guard'' or not app_private.mastery_owns_character(u,''tank_guard'') then raise exception ''Owned active Guard run required'';end if;
 if not exists(select 1 from app_private.player_mastery_quests where user_id=u and character_key=''tank_guard'' and mastered and mastery_enabled) then raise exception ''Complete and enable Guard mastery first'';end if;
 if s.context_type=''endless'' then select verified_wave into w from public.player_progression_runs where run_id=p_context_id and user_id=u and completed_at is null and not test_mode;
 else select p.wave into w from public.multiplayer_players p join public.multiplayer_matches m on m.id=p.match_id where p.match_id=p_context_id and p.user_id=u and p.character_key=''tank_guard'' and not p.test_mode and p.status=''playing'' and m.status=''playing'' and m.finished_at is null;end if;
 if w is null then raise exception ''Owned active Guard run or match required'';end if;
 update app_private.mastery_sessions set guard_mode=p_enabled,guard_eligible_wave=case when p_enabled then w else guard_eligible_wave end where id=s.id;
 return jsonb_build_object(''guard_mode'',p_enabled,''context_id'',p_context_id);
end;
end
$runtime_guard$
';
 elsif (select md5(prosrc) from pg_proc where oid='public.set_mastery_guard_mode(uuid,boolean)'::regprocedure)<>'22f9fa79dcc58302270aadc169857c9a' then
  raise exception 'Unreviewed RPC source: %','set_mastery_guard_mode(uuid,boolean)';
 end if;

 if md5(pg_get_functiondef('public.set_mastery_toggle(text,text,boolean)'::regprocedure))='2777750f8cc88796bd9ae6c725f85ce5' then
  execute 'CREATE OR REPLACE FUNCTION public.set_mastery_toggle(p_character_key text, p_which text, p_enabled boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''''
AS $runtime_guard$
begin
  -- Pixel runtime boundary: before original variable initializers or writes.
  perform app_private.require_pixel_runtime();
  <<skyway_original>>
declare u uuid:=app_private.photon_user();
begin
 if p_which is null or p_which not in(''mastery'',''flair'') or p_enabled is null then raise exception ''Invalid mastery toggle'';end if;
 if not app_private.mastery_owns_character(u,p_character_key) then raise exception ''Character locked'';end if;
 update app_private.player_mastery_quests set mastery_enabled=case when p_which=''mastery'' then p_enabled else mastery_enabled end,
  flair_rewrite_enabled=case when p_which=''flair'' then p_enabled else flair_rewrite_enabled end
 where user_id=u and character_key=p_character_key and mastered;
 if not found then raise exception ''Complete this mastery trial first'';end if;
 return public.get_mastery_profile();
end;
end
$runtime_guard$
';
 elsif (select md5(prosrc) from pg_proc where oid='public.set_mastery_toggle(text,text,boolean)'::regprocedure)<>'da406efbb9f0265d90e509ace5dae986' then
  raise exception 'Unreviewed RPC source: %','set_mastery_toggle(text,text,boolean)';
 end if;

 if md5(pg_get_functiondef('public.set_player_flair(text)'::regprocedure))='a68c59f3cd7b29c9e0751006813865ec' then
  execute 'CREATE OR REPLACE FUNCTION public.set_player_flair(p_flair_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''''
AS $runtime_guard$
begin
  -- Pixel runtime boundary: before original variable initializers or writes.
  perform app_private.require_pixel_runtime();
  <<skyway_original>>
declare u uuid:=app_private.photon_user();
begin
 if not app_private.mastery_owns_character(u,p_flair_key) then raise exception ''Unlock the flair character first'';end if;
 insert into app_private.player_mastery_preferences(user_id,flair_character) values(u,p_flair_key)
 on conflict(user_id) do update set flair_character=excluded.flair_character;
 return public.get_mastery_profile();
end;
end
$runtime_guard$
';
 elsif (select md5(prosrc) from pg_proc where oid='public.set_player_flair(text)'::regprocedure)<>'edcb1fc8fb7f4226c4625f80cb0f0c1f' then
  raise exception 'Unreviewed RPC source: %','set_player_flair(text)';
 end if;

 if md5(pg_get_functiondef('public.set_player_username(text)'::regprocedure))='739790b1e424ee66fc9b034faa5add83' then
  execute 'CREATE OR REPLACE FUNCTION public.set_player_username(new_username text)
 RETURNS player_profiles
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''''
AS $runtime_guard$
begin
  -- Pixel runtime boundary: before original variable initializers or writes.
  perform app_private.require_pixel_runtime();
  <<skyway_original>>
declare u uuid:=auth.uid(); existing public.player_profiles; result public.player_profiles;
 normalized text; stamp timestamptz;
begin
 if u is null then raise exception ''Sign in required'';end if;
 -- Serialize concurrent first choices/renames for this immutable identity.
 perform pg_advisory_xact_lock(hashtextextended(''skyway-native-username-23:''||u::text,0));
 if exists(select 1 from app_private.pixel_links where user_id=u) then
  raise exception ''Your username is managed by Pixel Pulse; change it in Pixel Account'';
 end if;
 new_username:=btrim(new_username);
 select * into existing from public.player_profiles where user_id=u for update;
 -- Case-only/trim-only saves are canonical no-ops: keep the stored spelling
 -- and do not consume or extend a rename timer.
 if existing.user_id is not null and lower(existing.username)=lower(new_username) then return existing;end if;
 if new_username is null or new_username!~''^[A-Za-z0-9_]{3,20}$'' then
  raise exception ''Username must be 3-20 letters, numbers, or underscores'';
 end if;
 normalized:=lower(regexp_replace(new_username,''[^a-zA-Z0-9]'','''',''g''));
 if exists(select 1 from public.username_blocklist where (length(term)<4 and normalized=term) or (length(term)>=4 and position(term in normalized)>0)) then
  raise exception ''That username is not allowed'';
 end if;
 -- One lock per candidate name also protects cross-account collisions even
 -- if a historical imported database lacks its case-insensitive name index.
 perform pg_advisory_xact_lock(hashtextextended(''skyway-native-name-23:''||lower(new_username),0));
 if exists(select 1 from public.player_profiles where user_id<>u and lower(username)=lower(new_username)) then
  raise exception ''That username is already taken'';
 end if;
 stamp:=clock_timestamp();
 -- Original first choices use the same created/changed timestamp. They do
 -- not count as a rename; existing actual rename timestamps remain intact.
 if existing.user_id is not null and existing.username_changed_at is distinct from existing.created_at
  and existing.username_changed_at>stamp-interval ''720 hours'' then
  raise exception ''Username can only be changed once every 30 days'';
 end if;
 if existing.user_id is null then
  insert into public.player_profiles(user_id,username,username_changed_at,created_at)
  values(u,new_username,stamp,stamp) returning * into result;
 else
  update public.player_profiles set username=new_username,username_changed_at=stamp where user_id=u returning * into result;
 end if;
 return result;
exception when unique_violation then raise exception ''That username is already taken'';
end;
end
$runtime_guard$
';
 elsif (select md5(prosrc) from pg_proc where oid='public.set_player_username(text)'::regprocedure)<>'a3a2e3a767bc4b2e1ac2de40725b176b' then
  raise exception 'Unreviewed RPC source: %','set_player_username(text)';
 end if;

 if md5(pg_get_functiondef('public.start_progression_run()'::regprocedure))='1d29bc3714f34bc9842a8263252a53c7' then
  execute 'CREATE OR REPLACE FUNCTION public.start_progression_run()
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''''
AS $runtime_guard$
begin
  -- Pixel runtime boundary: before original variable initializers or writes.
  perform app_private.require_pixel_runtime();
  <<skyway_original>>
declare v_uid uuid:=auth.uid(); v_run_id uuid;
begin
  if v_uid is null then raise exception ''Sign in required''; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text,0));
  update public.player_progression_runs set completed_at=now(),
    claimed_score=0,credited_score=0
  where user_id=v_uid and completed_at is null;
  insert into public.player_progression_runs(
    user_id,active_seconds,verified_wave,last_heartbeat_at,heartbeat_active
  ) values(v_uid,0,1,clock_timestamp(),false) returning run_id into v_run_id;
  return v_run_id;
end;
end
$runtime_guard$
';
 elsif (select md5(prosrc) from pg_proc where oid='public.start_progression_run()'::regprocedure)<>'f5c2501643ccde87bce054384697eef8' then
  raise exception 'Unreviewed RPC source: %','start_progression_run()';
 end if;

 if md5(pg_get_functiondef('public.sync_1v1_intermission_coins(uuid,text[])'::regprocedure))='006077c3bf0ee4ed993ee76dabcdbcaf' then
  execute 'CREATE OR REPLACE FUNCTION public.sync_1v1_intermission_coins(p_match_id uuid, p_pickup_ids text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''''
AS $runtime_guard$
begin
  -- Pixel runtime boundary: before original variable initializers or writes.
  perform app_private.require_pixel_runtime();
  <<skyway_original>>
declare
  v_uid uuid := auth.uid();
  v_match public.multiplayer_matches;
  v_self public.multiplayer_players;
  v_map_key text;
  v_coin_reward numeric := 2;
  v_active_seconds bigint;
  v_verified_wave integer;
  v_time_allowance bigint;
  v_wave_allowance bigint;
  v_allowed bigint;
  v_claimed bigint := 0;
  v_requested integer := 0;
  v_new_requested integer := 0;
  v_inserted integer := 0;
  v_nominal_award numeric := 0;
  v_balance_before numeric := 0;
  v_balance_after numeric := 0;
  v_now timestamptz := clock_timestamp();
begin
  if v_uid is null then raise exception ''Sign in required''; end if;
  if p_match_id is null or p_pickup_ids is null then
    raise exception ''Match and coin pickup ids are required'';
  end if;
  if cardinality(p_pickup_ids) > 1000 then
    raise exception ''At most 1000 coin pickups may be synced at once'';
  end if;
  if exists (
    select 1 from unnest(p_pickup_ids) item(pickup_id)
    where item.pickup_id is null
       or length(btrim(item.pickup_id)) not between 1 and 160
  ) then
    raise exception ''Every coin pickup id must contain 1 to 160 characters'';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_uid::text, 1));
  select * into v_match
  from public.multiplayer_matches match_row
  where match_row.id = p_match_id
  for update;
  select * into v_self
  from public.multiplayer_players player
  where player.match_id = p_match_id and player.user_id = v_uid
  for update;
  if v_match.id is null or v_self.user_id is null then
    raise exception ''1v1 match not found'';
  end if;
  if v_self.status <> ''intermission''
     or v_match.status <> ''intermission''
     or v_match.intermission_ends_at is null
     or v_match.intermission_ends_at <= v_now then
    raise exception
      ''Attack coins can only sync during the shared 10-second intermission'';
  end if;
  if v_match.started_at <= now() - interval ''6 hours'' then
    raise exception ''1v1 match is too old for new coin receipts'';
  end if;

  v_map_key := coalesce(nullif(to_jsonb(v_match)->>''map_key'', ''''), ''classic'');
  -- QOL Meadow lane receipt: strip lane suffix for idempotency.
  if v_map_key=''terminal'' then raise exception ''Terminal does not use attack coins'';end if;
  if v_map_key=''meadow'' and exists(select 1 from unnest(p_pickup_ids) item(pickup_id)
    where btrim(item.pickup_id) like ''%:lane:%'' and btrim(item.pickup_id) !~ ''^.+:lane:[0-5]$'') then
    raise exception ''Invalid Meadow coin lane receipt'';
  end if;
  if v_map_key=''meadow'' and exists(select 1 from unnest(p_pickup_ids) item(pickup_id)
    group by regexp_replace(btrim(item.pickup_id),'':lane:[0-9]+$'','''')
    having count(distinct btrim(item.pickup_id))>1) then
    raise exception ''Conflicting Meadow coin lane receipts'';
  end if;

  if to_regclass(''app_private.one_v_one_map_rules'') is not null then
    execute ''select coin_point_reward::numeric
      from app_private.one_v_one_map_rules where map_key=$1''
    into v_coin_reward using v_map_key;
    v_coin_reward := coalesce(v_coin_reward, 2);
  end if;

  select activity.active_seconds, activity.verified_wave
  into v_active_seconds, v_verified_wave
  from public.player_progression_1v1_activity activity
  where activity.match_id = p_match_id and activity.user_id = v_uid
  for update;
  if not found then
    raise exception ''Attack coins require verified 1v1 activity'';
  end if;
  v_active_seconds := least(
    21600::bigint,
    greatest(0::bigint, coalesce(v_active_seconds, 0))
  );
  v_verified_wave := least(
    100000,
    greatest(1, coalesce(v_verified_wave, 1))
  );
  v_time_allowance := 2
    + floor(v_active_seconds::numeric / 0.75)::bigint;
  v_wave_allowance := 2 + v_verified_wave::bigint * 60;
  v_allowed := least(v_time_allowance, v_wave_allowance);

  select count(*) into v_claimed
  from public.multiplayer_point_events event
  where event.match_id = p_match_id and event.user_id = v_uid;
  if to_regclass(''public.multiplayer_mushroom_events'') is not null then
    execute ''select $1 + count(*)
      from public.multiplayer_mushroom_events
      where match_id=$2 and user_id=$3''
    into v_claimed using v_claimed, p_match_id, v_uid;
  end if;
  select v_claimed + count(*) into v_claimed
  from public.player_progression_events event
  where event.user_id = v_uid and event.source = ''gem''
    and event.metadata->>''context_id'' = p_match_id::text;

  with requested as (
    select distinct regexp_replace(btrim(item.pickup_id),'':lane:[0-9]+$'','''') as pickup_id
    from unnest(p_pickup_ids) item(pickup_id)
  )
  select count(*)::integer,
         count(*) filter (where receipt.pickup_id is null)::integer
  into v_requested, v_new_requested
  from requested
  left join public.multiplayer_point_events receipt
    on receipt.match_id = p_match_id
   and receipt.user_id = v_uid
   and receipt.pickup_id = requested.pickup_id;

  -- A retry containing only previously accepted ids must always be able to
  -- return the authoritative balance, even if later receipts used the rest of
  -- the allowance after the original response was lost.
  if v_new_requested > 0 and v_claimed + v_new_requested > v_allowed then
    raise exception ''Coin pickup allowance reached'';
  end if;
  v_balance_before := v_self.obstacle_points;

  with requested as (
    select distinct on(regexp_replace(btrim(item.pickup_id),'':lane:[0-9]+$'',''''))
     regexp_replace(btrim(item.pickup_id),'':lane:[0-9]+$'','''') as pickup_id,
     case when btrim(item.pickup_id) ~ '':lane:[0-9]+$'' then substring(btrim(item.pickup_id) from '':lane:([0-9]+)$'')::integer else -1 end as lane
    from unnest(p_pickup_ids) item(pickup_id)
    order by regexp_replace(btrim(item.pickup_id),'':lane:[0-9]+$'',''''),item.pickup_id
  ), inserted as (
    insert into public.multiplayer_point_events(
      match_id, user_id, pickup_id, source, points_awarded
    )
    select p_match_id, v_uid, requested.pickup_id, ''coin'', case when v_map_key=''meadow'' and requested.lane=(app_private.one_v_one_wave_rules(p_match_id,greatest(1,v_match.current_wave-1))->>''bonus_lane_index'')::integer then 7 else v_coin_reward end
    from requested
    on conflict (match_id, user_id, pickup_id) do nothing
    returning points_awarded
  )
  select count(*)::integer,coalesce(sum(points_awarded),0) into v_inserted,v_nominal_award from inserted;

  if v_inserted > 0 then
    -- The receipt sum preserves mixed bonus/ordinary lane awards.
    update public.multiplayer_players player
    set obstacle_points = player.obstacle_points + v_nominal_award,
        melons_collected = player.melons_collected + v_inserted,
        last_melon_at = v_now,
        last_seen_at = v_now,
        updated_at = v_now
    where player.match_id = p_match_id and player.user_id = v_uid;
    update public.multiplayer_matches match_row
    set last_activity_at = v_now
    where match_row.id = p_match_id;
  end if;

  select player.obstacle_points into v_balance_after
  from public.multiplayer_players player
  where player.match_id = p_match_id and player.user_id = v_uid;
  return jsonb_build_object(
    ''match_id'', p_match_id,
    ''map_key'', v_map_key,
    ''phase'', ''intermission'',
    ''requested'', v_requested,
    ''accepted'', v_inserted,
    ''duplicates'', greatest(0, v_requested - v_inserted),
    ''awarded'', greatest(0, v_balance_after - v_balance_before),
    ''points_per_coin'', case when v_inserted > 0
      then round((v_balance_after - v_balance_before) / v_inserted, 4)
      else v_coin_reward
    end,
    ''obstacle_points'', v_balance_after,
    ''coins_collected'', v_self.melons_collected + v_inserted,
    ''pickup_allowance'', v_allowed,
    ''coin_allowance'', v_allowed
  );
end;
end
$runtime_guard$
';
 elsif (select md5(prosrc) from pg_proc where oid='public.sync_1v1_intermission_coins(uuid,text[])'::regprocedure)<>'79923ce353703938c5ce2cc6eab3a684' then
  raise exception 'Unreviewed RPC source: %','sync_1v1_intermission_coins(uuid,text[])';
 end if;

 if md5(pg_get_functiondef('public.sync_1v1_progression(uuid,integer,boolean)'::regprocedure))='fc3a6a9790e125c406562fe6004d9280' then
  execute 'CREATE OR REPLACE FUNCTION public.sync_1v1_progression(p_match_id uuid, p_wave integer, p_active boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''''
AS $runtime_guard$
begin
  -- Pixel runtime boundary: before original variable initializers or writes.
  perform app_private.require_pixel_runtime();
  <<skyway_original>>
declare
  v_uid uuid:=auth.uid(); v_status text; v_player_status text;
  v_now timestamptz;
  v_last_heartbeat timestamptz; v_active_seconds bigint;
  v_verified_wave integer; v_was_active boolean;
  v_effective_active boolean; v_increment bigint; v_max_wave integer;
begin
  if v_uid is null then raise exception ''Sign in required''; end if;
  if p_match_id is null then raise exception ''Match ID is required''; end if;
  if p_wave is null or p_wave<1 or p_wave>100000 then
    raise exception ''Invalid match wave'';
  end if;
  if p_active is null then raise exception ''Match activity state is required''; end if;
  select match_row.status,player.status into v_status,v_player_status
  from public.multiplayer_matches match_row
  join public.multiplayer_players player
    on player.match_id=match_row.id and player.user_id=v_uid
  where match_row.id=p_match_id
    and match_row.status in(''countdown'',''playing'',''intermission'')
    and match_row.started_at>now()-interval ''6 hours''
  for update of match_row;
  if v_status is null then raise exception ''Active 1v1 membership not found''; end if;
  insert into public.player_progression_1v1_activity(match_id,user_id)
  values(p_match_id,v_uid) on conflict(match_id,user_id) do nothing;
  select last_heartbeat_at,active_seconds,verified_wave,heartbeat_active
  into v_last_heartbeat,v_active_seconds,v_verified_wave,v_was_active
  from public.player_progression_1v1_activity
  where match_id=p_match_id and user_id=v_uid for update;
  v_now:=clock_timestamp();
  v_effective_active:=p_active and v_status=''playing''
    and v_player_status=''playing'';
  v_increment:=case when v_was_active and v_status=''playing''
    and v_player_status=''playing''
    then least(6::bigint,greatest(0,floor(extract(epoch from(
      v_now-coalesce(v_last_heartbeat,v_now))))::bigint)) else 0 end;
  v_active_seconds:=least(21600::bigint,v_active_seconds+v_increment);
  v_max_wave:=least(100000,
    1+floor(v_active_seconds::numeric/15)::integer);
  v_verified_wave:=least(greatest(v_verified_wave,p_wave),
    v_verified_wave+1,v_max_wave);
  update public.player_progression_1v1_activity
  set active_seconds=v_active_seconds,verified_wave=v_verified_wave,
    last_heartbeat_at=v_now,heartbeat_active=v_effective_active
  where match_id=p_match_id and user_id=v_uid;
  return jsonb_build_object(''active_seconds'',v_active_seconds,
    ''verified_wave'',v_verified_wave,''active'',v_effective_active);
end;
end
$runtime_guard$
';
 elsif (select md5(prosrc) from pg_proc where oid='public.sync_1v1_progression(uuid,integer,boolean)'::regprocedure)<>'5406a6290e6e34dcd113a84932dd6c28' then
  raise exception 'Unreviewed RPC source: %','sync_1v1_progression(uuid,integer,boolean)';
 end if;

 if md5(pg_get_functiondef('public.sync_1v1_score(uuid,bigint)'::regprocedure))='ca3ea0bcd3d4e9b832846133e613a9f5' then
  execute 'CREATE OR REPLACE FUNCTION public.sync_1v1_score(p_match_id uuid, p_score bigint)
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''''
AS $runtime_guard$
begin
  -- Pixel runtime boundary: before original variable initializers or writes.
  perform app_private.require_pixel_runtime();
  <<skyway_original>>
declare
  v_uid uuid := auth.uid();
  v_match_status text;
  v_player_status text;
  v_current_score bigint;
begin
  if v_uid is null then raise exception ''Sign in required''; end if;
  if p_score is null or p_score < 0 or p_score > 1000000000000 then
    raise exception ''Invalid 1v1 score'';
  end if;

  select match.status into v_match_status
  from public.multiplayer_matches match
  where match.id = p_match_id
  for update;
  if v_match_status is null
     or v_match_status not in (''countdown'', ''playing'', ''intermission'') then
    raise exception ''1v1 match is not active'';
  end if;

  select player.score, player.status
  into v_current_score, v_player_status
  from public.multiplayer_players player
  where player.match_id = p_match_id and player.user_id = v_uid
  for update;
  if v_current_score is null then raise exception ''1v1 match not found''; end if;
  if v_player_status in (''eliminated'', ''left'', ''finished'') then
    raise exception ''This player can no longer update their 1v1 score'';
  end if;
  if p_score < v_current_score then raise exception ''Score cannot decrease''; end if;

  update public.multiplayer_players player
  set score = p_score,
      last_seen_at = now(),
      updated_at = now()
  where player.match_id = p_match_id
    and player.user_id = v_uid
    and player.status not in (''eliminated'', ''left'', ''finished'');
  if not found then
    raise exception ''This player can no longer update their 1v1 score'';
  end if;

  update public.multiplayer_matches match
  set last_activity_at = now()
  where match.id = p_match_id;
  return p_score;
end;
end
$runtime_guard$
';
 elsif (select md5(prosrc) from pg_proc where oid='public.sync_1v1_score(uuid,bigint)'::regprocedure)<>'acede6168db53201108e80f03897c25d' then
  raise exception 'Unreviewed RPC source: %','sync_1v1_score(uuid,bigint)';
 end if;

 if md5(pg_get_functiondef('public.sync_progression_run(uuid,integer,boolean)'::regprocedure))='0939260b3e6fc63448d789b6ce4e7b84' then
  execute 'CREATE OR REPLACE FUNCTION public.sync_progression_run(p_run_id uuid, p_wave integer, p_active boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''''
AS $runtime_guard$
begin
  -- Pixel runtime boundary: before original variable initializers or writes.
  perform app_private.require_pixel_runtime();
  <<skyway_original>>
declare
  v_uid uuid:=auth.uid(); v_now timestamptz;
  v_last_heartbeat timestamptz; v_active_seconds bigint;
  v_verified_wave integer; v_was_active boolean;
  v_increment bigint; v_max_wave integer;
begin
  if v_uid is null then raise exception ''Sign in required''; end if;
  if p_run_id is null then raise exception ''Run ID is required''; end if;
  if p_wave is null or p_wave<1 or p_wave>100000 then
    raise exception ''Invalid run wave'';
  end if;
  if p_active is null then raise exception ''Run activity state is required''; end if;
  select last_heartbeat_at,active_seconds,verified_wave,heartbeat_active
  into v_last_heartbeat,v_active_seconds,v_verified_wave,v_was_active
  from public.player_progression_runs where run_id=p_run_id
    and user_id=v_uid and completed_at is null for update;
  if not found then raise exception ''Active run receipt not found''; end if;
  v_now:=clock_timestamp();
  v_increment:=case when v_was_active then least(6::bigint,greatest(0,
    floor(extract(epoch from(v_now-coalesce(v_last_heartbeat,v_now))))::bigint))
    else 0 end;
  v_active_seconds:=least(21600::bigint,v_active_seconds+v_increment);
  v_max_wave:=least(100000,
    1+floor(v_active_seconds::numeric/15)::integer);
  v_verified_wave:=least(greatest(v_verified_wave,p_wave),
    v_verified_wave+1,v_max_wave);
  update public.player_progression_runs set active_seconds=v_active_seconds,
    verified_wave=v_verified_wave,last_heartbeat_at=v_now,
    heartbeat_active=p_active
  where run_id=p_run_id;
  return jsonb_build_object(''active_seconds'',v_active_seconds,
    ''verified_wave'',v_verified_wave,''active'',p_active);
end;
end
$runtime_guard$
';
 elsif (select md5(prosrc) from pg_proc where oid='public.sync_progression_run(uuid,integer,boolean)'::regprocedure)<>'3028e2e337416318b549d959091961e6' then
  raise exception 'Unreviewed RPC source: %','sync_progression_run(uuid,integer,boolean)';
 end if;

 if md5(pg_get_functiondef('public.unlock_photon_fury()'::regprocedure))='704adc605b5b786560157358edc006bf' then
  execute 'CREATE OR REPLACE FUNCTION public.unlock_photon_fury()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''''
AS $runtime_guard$
begin
  -- Pixel runtime boundary: before original variable initializers or writes.
  perform app_private.require_pixel_runtime();
  <<skyway_original>>
declare u uuid:=app_private.photon_user();s public.player_stats;p public.player_photon_fury;
begin
 select * into s from public.player_stats where user_id=u for update;
 insert into public.player_photon_fury(user_id) values(u) on conflict do nothing;
 select * into p from public.player_photon_fury where user_id=u for update;
 if p.unlocked_at is null then
  if coalesce(s.level,0)<25 then raise exception ''Requires level 25'';end if;
  if coalesce(s.total_gems,0)<225 then raise exception ''You need 225 Gems'';end if;
  update public.player_stats set total_gems=total_gems-225,updated_at=clock_timestamp()
   where user_id=u returning * into s;
  update public.player_photon_fury set unlocked_at=clock_timestamp() where user_id=u;
 end if;
 return jsonb_build_object(''unlocked'',true,''total_gems'',s.total_gems);
end;
end
$runtime_guard$
';
 elsif (select md5(prosrc) from pg_proc where oid='public.unlock_photon_fury()'::regprocedure)<>'d32afb436384ab9bc68a6bd6bb5fb463' then
  raise exception 'Unreviewed RPC source: %','unlock_photon_fury()';
 end if;

 if md5(pg_get_functiondef('public.unlock_ranked_1v1()'::regprocedure))='9ce47654f1daae5b3098513c6c18153c' then
  execute 'CREATE OR REPLACE FUNCTION public.unlock_ranked_1v1()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''''
AS $runtime_guard$
begin
  -- Pixel runtime boundary: before original variable initializers or writes.
  perform app_private.require_pixel_runtime();
  <<skyway_original>>
declare u uuid:=auth.uid();s public.player_stats;paid boolean;
begin
 if u is null then raise exception ''Sign in required'';end if;
 if app_private.has_active_ban(u,''account'',null) or app_private.has_active_ban(u,''leaderboard'',null) then
  raise exception ''This account cannot unlock Ranked'';end if;
 if app_private.is_admin_test_user(u) then raise exception ''Turn off Test Mode to unlock Ranked'';end if;
 select * into s from public.player_stats where user_id=u for update;
 paid:=exists(select 1 from app_private.ranked_requalification where user_id=u and qualified);
 if not paid then
  if s.user_id is null or s.level<35 then raise exception ''Ranked requires level 35'';end if;
  if s.total_gems<235 then raise exception ''You need 235 Gems'';end if;
  update public.player_stats set total_gems=total_gems-235,updated_at=now() where user_id=u returning * into s;
  insert into app_private.ranked_requalification(user_id,qualified,qualified_at)
   values(u,true,clock_timestamp()) on conflict(user_id) do update set qualified=true,qualified_at=excluded.qualified_at;
 end if;
 return public.get_player_progression()||jsonb_build_object(''total_gems'',s.total_gems);
end;
end
$runtime_guard$
';
 elsif (select md5(prosrc) from pg_proc where oid='public.unlock_ranked_1v1()'::regprocedure)<>'b03804331a830e1d51cc979e4912b5d9' then
  raise exception 'Unreviewed RPC source: %','unlock_ranked_1v1()';
 end if;

 if md5(pg_get_functiondef('public.update_1v1_position(uuid,integer)'::regprocedure))='7cedd2a7456c079c6108e85daecef9ee' then
  execute 'CREATE OR REPLACE FUNCTION public.update_1v1_position(p_match_id uuid, p_lane_index integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''''
AS $runtime_guard$
begin
  -- Pixel runtime boundary: before original variable initializers or writes.
  perform app_private.require_pixel_runtime();
  <<skyway_original>>
declare m public.multiplayer_matches; a public.multiplayer_players;
begin
  if auth.uid() is null then raise exception ''Sign in required''; end if;
  select * into m from public.multiplayer_matches where id=p_match_id for update;
  select * into a from public.multiplayer_players where match_id=p_match_id and user_id=auth.uid() for update;
  if a.user_id is null then raise exception ''Match not found''; end if;
  -- QOL Terminal facing movement guard. Edge wraps follow their input direction.
  if m.map_key=''terminal'' and a.terminal_facing<>0 and p_lane_index<>a.lane_index and
    (case when a.lane_index=0 and p_lane_index=4 then -1
          when a.lane_index=4 and p_lane_index=0 then 1
          else sign(p_lane_index-a.lane_index) end)<>a.terminal_facing then
    raise exception ''Face forward or toward that lane before moving'';
  end if;
  if m.map_key=''terminal'' and abs(p_lane_index-a.lane_index)>1 then
    if m.status<>''playing'' or a.status<>''playing'' or not ((a.lane_index=0 and p_lane_index=4) or (a.lane_index=4 and p_lane_index=0)) or a.terminal_wrap_wave=a.wave then raise exception ''One edge wrap per wave is available''; end if;
    update public.multiplayer_players set terminal_wrap_wave=a.wave where match_id=p_match_id and user_id=a.user_id;
  end if;
  return app_private.update_position_before_terminal(p_match_id,p_lane_index);
end;
end
$runtime_guard$
';
 elsif (select md5(prosrc) from pg_proc where oid='public.update_1v1_position(uuid,integer)'::regprocedure)<>'f69f30fc6615753b01abeeddb8b22f74' then
  raise exception 'Unreviewed RPC source: %','update_1v1_position(uuid,integer)';
 end if;

 if md5(pg_get_functiondef('public.update_1v1_state(uuid,numeric,integer,bigint,text)'::regprocedure))='84661c556088e800368ce8f1e1783671' then
  execute 'CREATE OR REPLACE FUNCTION public.update_1v1_state(p_match_id uuid, p_hearts numeric, p_wave integer, p_score bigint, p_status text DEFAULT ''playing''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''''
AS $runtime_guard$
begin
  -- Pixel runtime boundary: before original variable initializers or writes.
  perform app_private.require_pixel_runtime();
  <<skyway_original>>
declare
  v_uid uuid := auth.uid();
  v_match public.multiplayer_matches;
  v_self public.multiplayer_players;
  v_opponent public.multiplayer_players;
  v_heat_consumed numeric := 0;
  v_damage numeric;
  v_damage_multiplier numeric := 1;
  v_effective_hearts numeric := p_hearts;
  v_effective_status text := p_status;
begin
  if exists(select 1 from public.multiplayer_matches m where m.id=p_match_id and m.status=''countdown'') then return public.get_1v1_state(p_match_id); end if;
  if v_uid is not null then
    select * into v_match
    from public.multiplayer_matches match_row
    where match_row.id = p_match_id
    for update;
    perform 1
    from public.multiplayer_players player
    where player.match_id = p_match_id
    order by player.slot
    for update;
    select * into v_self
    from public.multiplayer_players player
    where player.match_id = p_match_id and player.user_id = v_uid;
    select * into v_opponent
    from public.multiplayer_players player
    where player.match_id = p_match_id and player.user_id <> v_uid
    limit 1;
  end if;

  if v_match.status = ''playing''
     and v_self.status = ''playing''
     and p_hearts is not null
     and p_hearts < v_self.hearts then
    select coalesce(ledger.consumed, 0)
    into v_heat_consumed
    from public.multiplayer_heatfeast ledger
    where ledger.match_id = p_match_id;
    if coalesce(v_heat_consumed, 0) >= 100 then
      if v_self.character_key = ''runner_comet'' then
        v_damage_multiplier := v_damage_multiplier * 0.75;
      end if;
      if v_opponent.character_key = ''runner_comet'' then
        v_damage_multiplier := v_damage_multiplier * 1.25;
      end if;
      v_damage := v_self.hearts - p_hearts;
      v_effective_hearts := greatest(
        0,
        v_self.hearts - v_damage * v_damage_multiplier
      );
      if v_effective_hearts > 0 and v_effective_status = ''eliminated'' then
        v_effective_status := ''playing'';
      end if;
    end if;
  end if;

  return app_private.update_1v1_state_unadjusted(
    p_match_id,
    v_effective_hearts,
    p_wave,
    p_score,
    v_effective_status
  );
end;
end
$runtime_guard$
';
 elsif (select md5(prosrc) from pg_proc where oid='public.update_1v1_state(uuid,numeric,integer,bigint,text)'::regprocedure)<>'77b5624409c06bf787960d2f97864fa5' then
  raise exception 'Unreviewed RPC source: %','update_1v1_state(uuid,numeric,integer,bigint,text)';
 end if;

 if md5(pg_get_functiondef('public.update_1v1_terminal_state(uuid,numeric,integer,bigint,text,numeric)'::regprocedure))='3cb3d9ee7beb5b2fe0654bcf8c497f9a' then
  execute 'CREATE OR REPLACE FUNCTION public.update_1v1_terminal_state(p_match_id uuid, p_hearts numeric, p_wave integer, p_score bigint, p_status text, p_sword_damage_seen numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''''
AS $runtime_guard$
begin
  -- Pixel runtime boundary: before original variable initializers or writes.
  perform app_private.require_pixel_runtime();
  <<skyway_original>>
declare a public.multiplayer_players; effective numeric; m public.multiplayer_matches;
begin
  if exists(select 1 from public.multiplayer_matches m where m.id=p_match_id and m.status=''countdown'' and m.character_selection_ends_at>clock_timestamp()) then return public.get_1v1_state(p_match_id); end if;
  if auth.uid() is null then raise exception ''Sign in required''; end if;
  select * into m from public.multiplayer_matches where id=p_match_id for update;
  select * into a from public.multiplayer_players where match_id=p_match_id and user_id=auth.uid() for update;
  if a.user_id is null or m.map_key<>''terminal'' then raise exception ''Terminal match not found''; end if;
  if p_sword_damage_seen is null or p_sword_damage_seen<0 or p_sword_damage_seen>a.sword_damage_total or p_hearts is null or p_hearts<0 or p_hearts>4 then raise exception ''Invalid Terminal health state''; end if;
  effective:=greatest(0,p_hearts-(a.sword_damage_total-p_sword_damage_seen));
  effective:=least(effective,a.hearts+case when p_wave>a.wave then 0.5 else 0 end,4);
  return public.update_1v1_state(p_match_id,effective,p_wave,p_score,case when effective=0 then ''eliminated'' else p_status end);
end;
end
$runtime_guard$
';
 elsif (select md5(prosrc) from pg_proc where oid='public.update_1v1_terminal_state(uuid,numeric,integer,bigint,text,numeric)'::regprocedure)<>'9d40e2121f9ceae4d5d1b0a14d85569a' then
  raise exception 'Unreviewed RPC source: %','update_1v1_terminal_state(uuid,numeric,integer,bigint,text,numeric)';
 end if;

 if md5(pg_get_functiondef('public.use_1v1_terminal_sword(uuid)'::regprocedure))='892659fbde57fab0f1e504dec94afe5d' then
  execute 'CREATE OR REPLACE FUNCTION public.use_1v1_terminal_sword(p_match_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''''
AS $runtime_guard$
begin
  -- Pixel runtime boundary: before original variable initializers or writes.
  perform app_private.require_pixel_runtime();
  <<skyway_original>>
declare uid uuid:=auth.uid(); m public.multiplayer_matches; a public.multiplayer_players; b public.multiplayer_players; t timestamptz:=clock_timestamp(); hit boolean;
begin
  if uid is null then raise exception ''Sign in required''; end if;
  select * into m from public.multiplayer_matches where id=p_match_id for update;
  perform 1 from public.multiplayer_players where match_id=p_match_id order by slot for update;
  select * into a from public.multiplayer_players where match_id=p_match_id and user_id=uid;
  select * into b from public.multiplayer_players where match_id=p_match_id and user_id<>uid limit 1;
  if a.user_id is null or b.user_id is null then raise exception ''Match not found''; end if;
  if m.map_key<>''terminal'' or m.status<>''playing'' or a.status<>''playing'' or b.status<>''playing'' then raise exception ''Sword requires both rivals in active Terminal play''; end if;
  if a.sword_durability=0 or a.sword_cooldown_until>t then raise exception ''Sword is broken or cooling down''; end if;
  hit:=a.lane_index+a.terminal_facing=b.lane_index;
  update public.multiplayer_players set sword_cooldown_until=t+interval ''3 seconds'',sword_durability=sword_durability-case when hit then 0 else 1 end,
    hearts=greatest(0,hearts-case when hit then 0 else .5 end),sword_damage_total=sword_damage_total+case when hit then 0 else .5 end,last_seen_at=t,updated_at=t where match_id=p_match_id and user_id=uid;
  if hit then
    update public.multiplayer_players set hearts=greatest(0,hearts-1),sword_damage_total=sword_damage_total+1,sword_cooldown_until=greatest(coalesce(sword_cooldown_until,t),t+interval ''3 seconds''),updated_at=t where match_id=p_match_id and user_id=b.user_id;
  end if;
  if exists(select 1 from public.multiplayer_players where match_id=p_match_id and user_id=uid and hearts=0) then perform app_private.mark_1v1_eliminated(p_match_id,uid,t); end if;
  if exists(select 1 from public.multiplayer_players where match_id=p_match_id and user_id=b.user_id and hearts=0) then perform app_private.mark_1v1_eliminated(p_match_id,b.user_id,t); end if;
  perform app_private.finalize_1v1_after_second_death(p_match_id,t);
  update public.multiplayer_matches set last_activity_at=t where id=p_match_id;
  return public.get_1v1_state(p_match_id)||jsonb_build_object(''sword_hit'',hit);
end;
end
$runtime_guard$
';
 elsif (select md5(prosrc) from pg_proc where oid='public.use_1v1_terminal_sword(uuid)'::regprocedure)<>'f72aea0bf568ee561b1b10194c7fa8d6' then
  raise exception 'Unreviewed RPC source: %','use_1v1_terminal_sword(uuid)';
 end if;

 if md5(pg_get_functiondef('public.use_mastery_smoke(uuid,integer,uuid)'::regprocedure))='ba51d6ef5224b460e8f25ad66885c722' then
  execute 'CREATE OR REPLACE FUNCTION public.use_mastery_smoke(p_match_id uuid, p_hold_seconds integer, p_action_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''''
AS $runtime_guard$
begin
  -- Pixel runtime boundary: before original variable initializers or writes.
  perform app_private.require_pixel_runtime();
  <<skyway_original>>
declare u uuid:=app_private.photon_user();a jsonb;s app_private.mastery_smoke_state;r app_private.mastery_smoke_actions;
 n integer;cost integer;mastered boolean;strength text;cooldown numeric;reply jsonb;ends timestamptz;
begin
 if p_action_id is null or p_hold_seconds is null or p_hold_seconds not in(0,3,5,10) then raise exception ''Invalid Smoke action'';end if;
 perform pg_advisory_xact_lock(hashtextextended(u::text,23));
 -- Own membership is checked even for a retry. Completed actions can be read
 -- after the match ends, but cannot be replayed on another match or user.
 if not exists(select 1 from public.multiplayer_players where match_id=p_match_id and user_id=u) then raise exception ''Owned 1v1 match required'';end if;
 select * into r from app_private.mastery_smoke_actions where match_id=p_match_id and user_id=u and action_id=p_action_id;
 if found then
  if r.hold_seconds<>p_hold_seconds then raise exception ''Smoke action ID was already used for a different action'';end if;
  return r.reply||jsonb_build_object(''duplicate'',true);
 end if;
 a:=app_private.mastery_smoke_actor(p_match_id);mastered:=(a->>''mastered'')::boolean;n:=(a->>''wave'')::integer;
 if p_hold_seconds in(5,10) and not mastered then raise exception ''Complete and enable Smoke mastery for stronger hold attacks'';end if;
 insert into app_private.mastery_smoke_state(match_id,user_id,wave) values(p_match_id,u,n) on conflict do nothing;
 select * into s from app_private.mastery_smoke_state where match_id=p_match_id and user_id=u for update;
 if s.wave<>n then s.wave:=n;s.bombs_used:=0;s.charge_action_id:=null;s.charge_started_at:=null;end if;
 if s.cooldown_until>clock_timestamp() then raise exception ''Smoke is cooling down'';end if;
 if mastered and s.bombs_used>=3 then raise exception ''All three smoke bombs were used this wave'';end if;
 if p_hold_seconds>0 then
  if s.charge_action_id is distinct from p_action_id or s.charge_started_at is null
   or extract(epoch from clock_timestamp()-s.charge_started_at)<p_hold_seconds-.25
   or coalesce((a->>''active_seconds'')::bigint-s.charge_active_seconds,-1)<p_hold_seconds-1.5 then raise exception ''Hold E for the full Smoke charge time during active play'';end if;
  if not exists(select 1 from public.multiplayer_players where match_id=p_match_id and user_id<>u and status=''playing'' and hearts>0) then raise exception ''Living opponent required'';end if;
  cost:=case p_hold_seconds when 3 then 1 when 5 then 2 else 3-s.bombs_used end;
  strength:=case p_hold_seconds when 3 then ''mild'' when 5 then ''grey'' else ''heavy-grey'' end;
  cooldown:=case when mastered then 20 else 12 end;ends:=clock_timestamp()+interval ''10 seconds'';
 else cost:=1;cooldown:=case when mastered then 5 else 12 end;end if;
 if mastered and s.bombs_used+cost>3 then raise exception ''Not enough smoke bombs remain this wave'';end if;
 if mastered then s.bombs_used:=s.bombs_used+cost;end if;
 s.cooldown_until:=clock_timestamp()+make_interval(secs=>cooldown::double precision);
 reply:=jsonb_build_object(''action_id'',p_action_id,''strength'',strength,''duration'',case when strength is null then 0 else 10 end,
  ''active_until'',ends,''bombs_remaining'',case when mastered then 3-s.bombs_used else null end,''cooldown_until'',s.cooldown_until,
  ''self_heavy'',mastered and s.bombs_used=3,''wave'',n,''duplicate'',false);
 update app_private.mastery_smoke_state set wave=n,bombs_used=s.bombs_used,cooldown_until=s.cooldown_until,charge_action_id=null,charge_started_at=null,charge_active_seconds=null where match_id=p_match_id and user_id=u;
 insert into app_private.mastery_smoke_actions(match_id,user_id,action_id,wave,hold_seconds,strength,active_until,reply) values(p_match_id,u,p_action_id,n,p_hold_seconds,strength,ends,reply);
 return reply;
end;
end
$runtime_guard$
';
 elsif (select md5(prosrc) from pg_proc where oid='public.use_mastery_smoke(uuid,integer,uuid)'::regprocedure)<>'4556dd4f1cc559349110ce90b066b9dc' then
  raise exception 'Unreviewed RPC source: %','use_mastery_smoke(uuid,integer,uuid)';
 end if;

 if not exists(select 1 from pg_policy where polrelid='public.admin_command_audit'::regclass and polname='skyway_pixel_runtime_admission') then
  execute 'create policy skyway_pixel_runtime_admission on public."admin_command_audit" as restrictive for all to authenticated using ((select public.skyway_runtime_admitted())) with check ((select public.skyway_runtime_admitted()))';
 end if;
 if not exists(select 1 from pg_policy where polrelid='public.admin_command_audit'::regclass and polname='skyway_pixel_runtime_admission'
  and not polpermissive and polcmd='*' and polroles=array[(select oid from pg_roles where rolname='authenticated')]
  and replace(pg_get_expr(polqual,polrelid),'public.','')='( SELECT skyway_runtime_admitted() AS skyway_runtime_admitted)'
  and replace(pg_get_expr(polwithcheck,polrelid),'public.','')='( SELECT skyway_runtime_admitted() AS skyway_runtime_admitted)') then
   raise exception 'Unreviewed runtime policy: %','admin_command_audit';
 end if;

 if not exists(select 1 from pg_policy where polrelid='public.admin_compensation_ledger'::regclass and polname='skyway_pixel_runtime_admission') then
  execute 'create policy skyway_pixel_runtime_admission on public."admin_compensation_ledger" as restrictive for all to authenticated using ((select public.skyway_runtime_admitted())) with check ((select public.skyway_runtime_admitted()))';
 end if;
 if not exists(select 1 from pg_policy where polrelid='public.admin_compensation_ledger'::regclass and polname='skyway_pixel_runtime_admission'
  and not polpermissive and polcmd='*' and polroles=array[(select oid from pg_roles where rolname='authenticated')]
  and replace(pg_get_expr(polqual,polrelid),'public.','')='( SELECT skyway_runtime_admitted() AS skyway_runtime_admitted)'
  and replace(pg_get_expr(polwithcheck,polrelid),'public.','')='( SELECT skyway_runtime_admitted() AS skyway_runtime_admitted)') then
   raise exception 'Unreviewed runtime policy: %','admin_compensation_ledger';
 end if;

 if not exists(select 1 from pg_policy where polrelid='public.admin_role_audit'::regclass and polname='skyway_pixel_runtime_admission') then
  execute 'create policy skyway_pixel_runtime_admission on public."admin_role_audit" as restrictive for all to authenticated using ((select public.skyway_runtime_admitted())) with check ((select public.skyway_runtime_admitted()))';
 end if;
 if not exists(select 1 from pg_policy where polrelid='public.admin_role_audit'::regclass and polname='skyway_pixel_runtime_admission'
  and not polpermissive and polcmd='*' and polroles=array[(select oid from pg_roles where rolname='authenticated')]
  and replace(pg_get_expr(polqual,polrelid),'public.','')='( SELECT skyway_runtime_admitted() AS skyway_runtime_admitted)'
  and replace(pg_get_expr(polwithcheck,polrelid),'public.','')='( SELECT skyway_runtime_admitted() AS skyway_runtime_admitted)') then
   raise exception 'Unreviewed runtime policy: %','admin_role_audit';
 end if;

 if not exists(select 1 from pg_policy where polrelid='public.admin_todos'::regclass and polname='skyway_pixel_runtime_admission') then
  execute 'create policy skyway_pixel_runtime_admission on public."admin_todos" as restrictive for all to authenticated using ((select public.skyway_runtime_admitted())) with check ((select public.skyway_runtime_admitted()))';
 end if;
 if not exists(select 1 from pg_policy where polrelid='public.admin_todos'::regclass and polname='skyway_pixel_runtime_admission'
  and not polpermissive and polcmd='*' and polroles=array[(select oid from pg_roles where rolname='authenticated')]
  and replace(pg_get_expr(polqual,polrelid),'public.','')='( SELECT skyway_runtime_admitted() AS skyway_runtime_admitted)'
  and replace(pg_get_expr(polwithcheck,polrelid),'public.','')='( SELECT skyway_runtime_admitted() AS skyway_runtime_admitted)') then
   raise exception 'Unreviewed runtime policy: %','admin_todos';
 end if;

 if not exists(select 1 from pg_policy where polrelid='public.admin_users'::regclass and polname='skyway_pixel_runtime_admission') then
  execute 'create policy skyway_pixel_runtime_admission on public."admin_users" as restrictive for all to authenticated using ((select public.skyway_runtime_admitted())) with check ((select public.skyway_runtime_admitted()))';
 end if;
 if not exists(select 1 from pg_policy where polrelid='public.admin_users'::regclass and polname='skyway_pixel_runtime_admission'
  and not polpermissive and polcmd='*' and polroles=array[(select oid from pg_roles where rolname='authenticated')]
  and replace(pg_get_expr(polqual,polrelid),'public.','')='( SELECT skyway_runtime_admitted() AS skyway_runtime_admitted)'
  and replace(pg_get_expr(polwithcheck,polrelid),'public.','')='( SELECT skyway_runtime_admitted() AS skyway_runtime_admitted)') then
   raise exception 'Unreviewed runtime policy: %','admin_users';
 end if;

 if not exists(select 1 from pg_policy where polrelid='public.extraction_catalog'::regclass and polname='skyway_pixel_runtime_admission') then
  execute 'create policy skyway_pixel_runtime_admission on public."extraction_catalog" as restrictive for all to authenticated using ((select public.skyway_runtime_admitted())) with check ((select public.skyway_runtime_admitted()))';
 end if;
 if not exists(select 1 from pg_policy where polrelid='public.extraction_catalog'::regclass and polname='skyway_pixel_runtime_admission'
  and not polpermissive and polcmd='*' and polroles=array[(select oid from pg_roles where rolname='authenticated')]
  and replace(pg_get_expr(polqual,polrelid),'public.','')='( SELECT skyway_runtime_admitted() AS skyway_runtime_admitted)'
  and replace(pg_get_expr(polwithcheck,polrelid),'public.','')='( SELECT skyway_runtime_admitted() AS skyway_runtime_admitted)') then
   raise exception 'Unreviewed runtime policy: %','extraction_catalog';
 end if;

 if not exists(select 1 from pg_policy where polrelid='public.extraction_transactions'::regclass and polname='skyway_pixel_runtime_admission') then
  execute 'create policy skyway_pixel_runtime_admission on public."extraction_transactions" as restrictive for all to authenticated using ((select public.skyway_runtime_admitted())) with check ((select public.skyway_runtime_admitted()))';
 end if;
 if not exists(select 1 from pg_policy where polrelid='public.extraction_transactions'::regclass and polname='skyway_pixel_runtime_admission'
  and not polpermissive and polcmd='*' and polroles=array[(select oid from pg_roles where rolname='authenticated')]
  and replace(pg_get_expr(polqual,polrelid),'public.','')='( SELECT skyway_runtime_admitted() AS skyway_runtime_admitted)'
  and replace(pg_get_expr(polwithcheck,polrelid),'public.','')='( SELECT skyway_runtime_admitted() AS skyway_runtime_admitted)') then
   raise exception 'Unreviewed runtime policy: %','extraction_transactions';
 end if;

 if not exists(select 1 from pg_policy where polrelid='public.multiplayer_attacks'::regclass and polname='skyway_pixel_runtime_admission') then
  execute 'create policy skyway_pixel_runtime_admission on public."multiplayer_attacks" as restrictive for all to authenticated using ((select public.skyway_runtime_admitted())) with check ((select public.skyway_runtime_admitted()))';
 end if;
 if not exists(select 1 from pg_policy where polrelid='public.multiplayer_attacks'::regclass and polname='skyway_pixel_runtime_admission'
  and not polpermissive and polcmd='*' and polroles=array[(select oid from pg_roles where rolname='authenticated')]
  and replace(pg_get_expr(polqual,polrelid),'public.','')='( SELECT skyway_runtime_admitted() AS skyway_runtime_admitted)'
  and replace(pg_get_expr(polwithcheck,polrelid),'public.','')='( SELECT skyway_runtime_admitted() AS skyway_runtime_admitted)') then
   raise exception 'Unreviewed runtime policy: %','multiplayer_attacks';
 end if;

 if not exists(select 1 from pg_policy where polrelid='public.multiplayer_comet_removals'::regclass and polname='skyway_pixel_runtime_admission') then
  execute 'create policy skyway_pixel_runtime_admission on public."multiplayer_comet_removals" as restrictive for all to authenticated using ((select public.skyway_runtime_admitted())) with check ((select public.skyway_runtime_admitted()))';
 end if;
 if not exists(select 1 from pg_policy where polrelid='public.multiplayer_comet_removals'::regclass and polname='skyway_pixel_runtime_admission'
  and not polpermissive and polcmd='*' and polroles=array[(select oid from pg_roles where rolname='authenticated')]
  and replace(pg_get_expr(polqual,polrelid),'public.','')='( SELECT skyway_runtime_admitted() AS skyway_runtime_admitted)'
  and replace(pg_get_expr(polwithcheck,polrelid),'public.','')='( SELECT skyway_runtime_admitted() AS skyway_runtime_admitted)') then
   raise exception 'Unreviewed runtime policy: %','multiplayer_comet_removals';
 end if;

 if not exists(select 1 from pg_policy where polrelid='public.multiplayer_grove_wave_results'::regclass and polname='skyway_pixel_runtime_admission') then
  execute 'create policy skyway_pixel_runtime_admission on public."multiplayer_grove_wave_results" as restrictive for all to authenticated using ((select public.skyway_runtime_admitted())) with check ((select public.skyway_runtime_admitted()))';
 end if;
 if not exists(select 1 from pg_policy where polrelid='public.multiplayer_grove_wave_results'::regclass and polname='skyway_pixel_runtime_admission'
  and not polpermissive and polcmd='*' and polroles=array[(select oid from pg_roles where rolname='authenticated')]
  and replace(pg_get_expr(polqual,polrelid),'public.','')='( SELECT skyway_runtime_admitted() AS skyway_runtime_admitted)'
  and replace(pg_get_expr(polwithcheck,polrelid),'public.','')='( SELECT skyway_runtime_admitted() AS skyway_runtime_admitted)') then
   raise exception 'Unreviewed runtime policy: %','multiplayer_grove_wave_results';
 end if;

 if not exists(select 1 from pg_policy where polrelid='public.multiplayer_heatfeast'::regclass and polname='skyway_pixel_runtime_admission') then
  execute 'create policy skyway_pixel_runtime_admission on public."multiplayer_heatfeast" as restrictive for all to authenticated using ((select public.skyway_runtime_admitted())) with check ((select public.skyway_runtime_admitted()))';
 end if;
 if not exists(select 1 from pg_policy where polrelid='public.multiplayer_heatfeast'::regclass and polname='skyway_pixel_runtime_admission'
  and not polpermissive and polcmd='*' and polroles=array[(select oid from pg_roles where rolname='authenticated')]
  and replace(pg_get_expr(polqual,polrelid),'public.','')='( SELECT skyway_runtime_admitted() AS skyway_runtime_admitted)'
  and replace(pg_get_expr(polwithcheck,polrelid),'public.','')='( SELECT skyway_runtime_admitted() AS skyway_runtime_admitted)') then
   raise exception 'Unreviewed runtime policy: %','multiplayer_heatfeast';
 end if;

 if not exists(select 1 from pg_policy where polrelid='public.multiplayer_heatfeast_split_state'::regclass and polname='skyway_pixel_runtime_admission') then
  execute 'create policy skyway_pixel_runtime_admission on public."multiplayer_heatfeast_split_state" as restrictive for all to authenticated using ((select public.skyway_runtime_admitted())) with check ((select public.skyway_runtime_admitted()))';
 end if;
 if not exists(select 1 from pg_policy where polrelid='public.multiplayer_heatfeast_split_state'::regclass and polname='skyway_pixel_runtime_admission'
  and not polpermissive and polcmd='*' and polroles=array[(select oid from pg_roles where rolname='authenticated')]
  and replace(pg_get_expr(polqual,polrelid),'public.','')='( SELECT skyway_runtime_admitted() AS skyway_runtime_admitted)'
  and replace(pg_get_expr(polwithcheck,polrelid),'public.','')='( SELECT skyway_runtime_admitted() AS skyway_runtime_admitted)') then
   raise exception 'Unreviewed runtime policy: %','multiplayer_heatfeast_split_state';
 end if;

 if not exists(select 1 from pg_policy where polrelid='public.multiplayer_heatfeast_tax_events'::regclass and polname='skyway_pixel_runtime_admission') then
  execute 'create policy skyway_pixel_runtime_admission on public."multiplayer_heatfeast_tax_events" as restrictive for all to authenticated using ((select public.skyway_runtime_admitted())) with check ((select public.skyway_runtime_admitted()))';
 end if;
 if not exists(select 1 from pg_policy where polrelid='public.multiplayer_heatfeast_tax_events'::regclass and polname='skyway_pixel_runtime_admission'
  and not polpermissive and polcmd='*' and polroles=array[(select oid from pg_roles where rolname='authenticated')]
  and replace(pg_get_expr(polqual,polrelid),'public.','')='( SELECT skyway_runtime_admitted() AS skyway_runtime_admitted)'
  and replace(pg_get_expr(polwithcheck,polrelid),'public.','')='( SELECT skyway_runtime_admitted() AS skyway_runtime_admitted)') then
   raise exception 'Unreviewed runtime policy: %','multiplayer_heatfeast_tax_events';
 end if;

 if not exists(select 1 from pg_policy where polrelid='public.multiplayer_heatfeast_wave_usage'::regclass and polname='skyway_pixel_runtime_admission') then
  execute 'create policy skyway_pixel_runtime_admission on public."multiplayer_heatfeast_wave_usage" as restrictive for all to authenticated using ((select public.skyway_runtime_admitted())) with check ((select public.skyway_runtime_admitted()))';
 end if;
 if not exists(select 1 from pg_policy where polrelid='public.multiplayer_heatfeast_wave_usage'::regclass and polname='skyway_pixel_runtime_admission'
  and not polpermissive and polcmd='*' and polroles=array[(select oid from pg_roles where rolname='authenticated')]
  and replace(pg_get_expr(polqual,polrelid),'public.','')='( SELECT skyway_runtime_admitted() AS skyway_runtime_admitted)'
  and replace(pg_get_expr(polwithcheck,polrelid),'public.','')='( SELECT skyway_runtime_admitted() AS skyway_runtime_admitted)') then
   raise exception 'Unreviewed runtime policy: %','multiplayer_heatfeast_wave_usage';
 end if;

 if not exists(select 1 from pg_policy where polrelid='public.multiplayer_katana_events'::regclass and polname='skyway_pixel_runtime_admission') then
  execute 'create policy skyway_pixel_runtime_admission on public."multiplayer_katana_events" as restrictive for all to authenticated using ((select public.skyway_runtime_admitted())) with check ((select public.skyway_runtime_admitted()))';
 end if;
 if not exists(select 1 from pg_policy where polrelid='public.multiplayer_katana_events'::regclass and polname='skyway_pixel_runtime_admission'
  and not polpermissive and polcmd='*' and polroles=array[(select oid from pg_roles where rolname='authenticated')]
  and replace(pg_get_expr(polqual,polrelid),'public.','')='( SELECT skyway_runtime_admitted() AS skyway_runtime_admitted)'
  and replace(pg_get_expr(polwithcheck,polrelid),'public.','')='( SELECT skyway_runtime_admitted() AS skyway_runtime_admitted)') then
   raise exception 'Unreviewed runtime policy: %','multiplayer_katana_events';
 end if;

 if not exists(select 1 from pg_policy where polrelid='public.multiplayer_matches'::regclass and polname='skyway_pixel_runtime_admission') then
  execute 'create policy skyway_pixel_runtime_admission on public."multiplayer_matches" as restrictive for all to authenticated using ((select public.skyway_runtime_admitted())) with check ((select public.skyway_runtime_admitted()))';
 end if;
 if not exists(select 1 from pg_policy where polrelid='public.multiplayer_matches'::regclass and polname='skyway_pixel_runtime_admission'
  and not polpermissive and polcmd='*' and polroles=array[(select oid from pg_roles where rolname='authenticated')]
  and replace(pg_get_expr(polqual,polrelid),'public.','')='( SELECT skyway_runtime_admitted() AS skyway_runtime_admitted)'
  and replace(pg_get_expr(polwithcheck,polrelid),'public.','')='( SELECT skyway_runtime_admitted() AS skyway_runtime_admitted)') then
   raise exception 'Unreviewed runtime policy: %','multiplayer_matches';
 end if;

 if not exists(select 1 from pg_policy where polrelid='public.multiplayer_mushroom_events'::regclass and polname='skyway_pixel_runtime_admission') then
  execute 'create policy skyway_pixel_runtime_admission on public."multiplayer_mushroom_events" as restrictive for all to authenticated using ((select public.skyway_runtime_admitted())) with check ((select public.skyway_runtime_admitted()))';
 end if;
 if not exists(select 1 from pg_policy where polrelid='public.multiplayer_mushroom_events'::regclass and polname='skyway_pixel_runtime_admission'
  and not polpermissive and polcmd='*' and polroles=array[(select oid from pg_roles where rolname='authenticated')]
  and replace(pg_get_expr(polqual,polrelid),'public.','')='( SELECT skyway_runtime_admitted() AS skyway_runtime_admitted)'
  and replace(pg_get_expr(polwithcheck,polrelid),'public.','')='( SELECT skyway_runtime_admitted() AS skyway_runtime_admitted)') then
   raise exception 'Unreviewed runtime policy: %','multiplayer_mushroom_events';
 end if;

 if not exists(select 1 from pg_policy where polrelid='public.multiplayer_players'::regclass and polname='skyway_pixel_runtime_admission') then
  execute 'create policy skyway_pixel_runtime_admission on public."multiplayer_players" as restrictive for all to authenticated using ((select public.skyway_runtime_admitted())) with check ((select public.skyway_runtime_admitted()))';
 end if;
 if not exists(select 1 from pg_policy where polrelid='public.multiplayer_players'::regclass and polname='skyway_pixel_runtime_admission'
  and not polpermissive and polcmd='*' and polroles=array[(select oid from pg_roles where rolname='authenticated')]
  and replace(pg_get_expr(polqual,polrelid),'public.','')='( SELECT skyway_runtime_admitted() AS skyway_runtime_admitted)'
  and replace(pg_get_expr(polwithcheck,polrelid),'public.','')='( SELECT skyway_runtime_admitted() AS skyway_runtime_admitted)') then
   raise exception 'Unreviewed runtime policy: %','multiplayer_players';
 end if;

 if not exists(select 1 from pg_policy where polrelid='public.multiplayer_point_events'::regclass and polname='skyway_pixel_runtime_admission') then
  execute 'create policy skyway_pixel_runtime_admission on public."multiplayer_point_events" as restrictive for all to authenticated using ((select public.skyway_runtime_admitted())) with check ((select public.skyway_runtime_admitted()))';
 end if;
 if not exists(select 1 from pg_policy where polrelid='public.multiplayer_point_events'::regclass and polname='skyway_pixel_runtime_admission'
  and not polpermissive and polcmd='*' and polroles=array[(select oid from pg_roles where rolname='authenticated')]
  and replace(pg_get_expr(polqual,polrelid),'public.','')='( SELECT skyway_runtime_admitted() AS skyway_runtime_admitted)'
  and replace(pg_get_expr(polwithcheck,polrelid),'public.','')='( SELECT skyway_runtime_admitted() AS skyway_runtime_admitted)') then
   raise exception 'Unreviewed runtime policy: %','multiplayer_point_events';
 end if;

 if not exists(select 1 from pg_policy where polrelid='public.multiplayer_queue'::regclass and polname='skyway_pixel_runtime_admission') then
  execute 'create policy skyway_pixel_runtime_admission on public."multiplayer_queue" as restrictive for all to authenticated using ((select public.skyway_runtime_admitted())) with check ((select public.skyway_runtime_admitted()))';
 end if;
 if not exists(select 1 from pg_policy where polrelid='public.multiplayer_queue'::regclass and polname='skyway_pixel_runtime_admission'
  and not polpermissive and polcmd='*' and polroles=array[(select oid from pg_roles where rolname='authenticated')]
  and replace(pg_get_expr(polqual,polrelid),'public.','')='( SELECT skyway_runtime_admitted() AS skyway_runtime_admitted)'
  and replace(pg_get_expr(polwithcheck,polrelid),'public.','')='( SELECT skyway_runtime_admitted() AS skyway_runtime_admitted)') then
   raise exception 'Unreviewed runtime policy: %','multiplayer_queue';
 end if;

 if not exists(select 1 from pg_policy where polrelid='public.multiplayer_ranked_results'::regclass and polname='skyway_pixel_runtime_admission') then
  execute 'create policy skyway_pixel_runtime_admission on public."multiplayer_ranked_results" as restrictive for all to authenticated using ((select public.skyway_runtime_admitted())) with check ((select public.skyway_runtime_admitted()))';
 end if;
 if not exists(select 1 from pg_policy where polrelid='public.multiplayer_ranked_results'::regclass and polname='skyway_pixel_runtime_admission'
  and not polpermissive and polcmd='*' and polroles=array[(select oid from pg_roles where rolname='authenticated')]
  and replace(pg_get_expr(polqual,polrelid),'public.','')='( SELECT skyway_runtime_admitted() AS skyway_runtime_admitted)'
  and replace(pg_get_expr(polwithcheck,polrelid),'public.','')='( SELECT skyway_runtime_admitted() AS skyway_runtime_admitted)') then
   raise exception 'Unreviewed runtime policy: %','multiplayer_ranked_results';
 end if;

 if not exists(select 1 from pg_policy where polrelid='public.player_1v1_map_priorities'::regclass and polname='skyway_pixel_runtime_admission') then
  execute 'create policy skyway_pixel_runtime_admission on public."player_1v1_map_priorities" as restrictive for all to authenticated using ((select public.skyway_runtime_admitted())) with check ((select public.skyway_runtime_admitted()))';
 end if;
 if not exists(select 1 from pg_policy where polrelid='public.player_1v1_map_priorities'::regclass and polname='skyway_pixel_runtime_admission'
  and not polpermissive and polcmd='*' and polroles=array[(select oid from pg_roles where rolname='authenticated')]
  and replace(pg_get_expr(polqual,polrelid),'public.','')='( SELECT skyway_runtime_admitted() AS skyway_runtime_admitted)'
  and replace(pg_get_expr(polwithcheck,polrelid),'public.','')='( SELECT skyway_runtime_admitted() AS skyway_runtime_admitted)') then
   raise exception 'Unreviewed runtime policy: %','player_1v1_map_priorities';
 end if;

 if not exists(select 1 from pg_policy where polrelid='public.player_1v1_stats'::regclass and polname='skyway_pixel_runtime_admission') then
  execute 'create policy skyway_pixel_runtime_admission on public."player_1v1_stats" as restrictive for all to authenticated using ((select public.skyway_runtime_admitted())) with check ((select public.skyway_runtime_admitted()))';
 end if;
 if not exists(select 1 from pg_policy where polrelid='public.player_1v1_stats'::regclass and polname='skyway_pixel_runtime_admission'
  and not polpermissive and polcmd='*' and polroles=array[(select oid from pg_roles where rolname='authenticated')]
  and replace(pg_get_expr(polqual,polrelid),'public.','')='( SELECT skyway_runtime_admitted() AS skyway_runtime_admitted)'
  and replace(pg_get_expr(polwithcheck,polrelid),'public.','')='( SELECT skyway_runtime_admitted() AS skyway_runtime_admitted)') then
   raise exception 'Unreviewed runtime policy: %','player_1v1_stats';
 end if;

 if not exists(select 1 from pg_policy where polrelid='public.player_ban_appeals'::regclass and polname='skyway_pixel_runtime_admission') then
  execute 'create policy skyway_pixel_runtime_admission on public."player_ban_appeals" as restrictive for all to authenticated using ((select public.skyway_runtime_admitted())) with check ((select public.skyway_runtime_admitted()))';
 end if;
 if not exists(select 1 from pg_policy where polrelid='public.player_ban_appeals'::regclass and polname='skyway_pixel_runtime_admission'
  and not polpermissive and polcmd='*' and polroles=array[(select oid from pg_roles where rolname='authenticated')]
  and replace(pg_get_expr(polqual,polrelid),'public.','')='( SELECT skyway_runtime_admitted() AS skyway_runtime_admitted)'
  and replace(pg_get_expr(polwithcheck,polrelid),'public.','')='( SELECT skyway_runtime_admitted() AS skyway_runtime_admitted)') then
   raise exception 'Unreviewed runtime policy: %','player_ban_appeals';
 end if;

 if not exists(select 1 from pg_policy where polrelid='public.player_bans'::regclass and polname='skyway_pixel_runtime_admission') then
  execute 'create policy skyway_pixel_runtime_admission on public."player_bans" as restrictive for all to authenticated using ((select public.skyway_runtime_admitted())) with check ((select public.skyway_runtime_admitted()))';
 end if;
 if not exists(select 1 from pg_policy where polrelid='public.player_bans'::regclass and polname='skyway_pixel_runtime_admission'
  and not polpermissive and polcmd='*' and polroles=array[(select oid from pg_roles where rolname='authenticated')]
  and replace(pg_get_expr(polqual,polrelid),'public.','')='( SELECT skyway_runtime_admitted() AS skyway_runtime_admitted)'
  and replace(pg_get_expr(polwithcheck,polrelid),'public.','')='( SELECT skyway_runtime_admitted() AS skyway_runtime_admitted)') then
   raise exception 'Unreviewed runtime policy: %','player_bans';
 end if;

 if not exists(select 1 from pg_policy where polrelid='public.player_device_links'::regclass and polname='skyway_pixel_runtime_admission') then
  execute 'create policy skyway_pixel_runtime_admission on public."player_device_links" as restrictive for all to authenticated using ((select public.skyway_runtime_admitted())) with check ((select public.skyway_runtime_admitted()))';
 end if;
 if not exists(select 1 from pg_policy where polrelid='public.player_device_links'::regclass and polname='skyway_pixel_runtime_admission'
  and not polpermissive and polcmd='*' and polroles=array[(select oid from pg_roles where rolname='authenticated')]
  and replace(pg_get_expr(polqual,polrelid),'public.','')='( SELECT skyway_runtime_admitted() AS skyway_runtime_admitted)'
  and replace(pg_get_expr(polwithcheck,polrelid),'public.','')='( SELECT skyway_runtime_admitted() AS skyway_runtime_admitted)') then
   raise exception 'Unreviewed runtime policy: %','player_device_links';
 end if;

 if not exists(select 1 from pg_policy where polrelid='public.player_devices'::regclass and polname='skyway_pixel_runtime_admission') then
  execute 'create policy skyway_pixel_runtime_admission on public."player_devices" as restrictive for all to authenticated using ((select public.skyway_runtime_admitted())) with check ((select public.skyway_runtime_admitted()))';
 end if;
 if not exists(select 1 from pg_policy where polrelid='public.player_devices'::regclass and polname='skyway_pixel_runtime_admission'
  and not polpermissive and polcmd='*' and polroles=array[(select oid from pg_roles where rolname='authenticated')]
  and replace(pg_get_expr(polqual,polrelid),'public.','')='( SELECT skyway_runtime_admitted() AS skyway_runtime_admitted)'
  and replace(pg_get_expr(polwithcheck,polrelid),'public.','')='( SELECT skyway_runtime_admitted() AS skyway_runtime_admitted)') then
   raise exception 'Unreviewed runtime policy: %','player_devices';
 end if;

 if not exists(select 1 from pg_policy where polrelid='public.player_endless_gem_streaks'::regclass and polname='skyway_pixel_runtime_admission') then
  execute 'create policy skyway_pixel_runtime_admission on public."player_endless_gem_streaks" as restrictive for all to authenticated using ((select public.skyway_runtime_admitted())) with check ((select public.skyway_runtime_admitted()))';
 end if;
 if not exists(select 1 from pg_policy where polrelid='public.player_endless_gem_streaks'::regclass and polname='skyway_pixel_runtime_admission'
  and not polpermissive and polcmd='*' and polroles=array[(select oid from pg_roles where rolname='authenticated')]
  and replace(pg_get_expr(polqual,polrelid),'public.','')='( SELECT skyway_runtime_admitted() AS skyway_runtime_admitted)'
  and replace(pg_get_expr(polwithcheck,polrelid),'public.','')='( SELECT skyway_runtime_admitted() AS skyway_runtime_admitted)') then
   raise exception 'Unreviewed runtime policy: %','player_endless_gem_streaks';
 end if;

 if not exists(select 1 from pg_policy where polrelid='public.player_loadouts'::regclass and polname='skyway_pixel_runtime_admission') then
  execute 'create policy skyway_pixel_runtime_admission on public."player_loadouts" as restrictive for all to authenticated using ((select public.skyway_runtime_admitted())) with check ((select public.skyway_runtime_admitted()))';
 end if;
 if not exists(select 1 from pg_policy where polrelid='public.player_loadouts'::regclass and polname='skyway_pixel_runtime_admission'
  and not polpermissive and polcmd='*' and polroles=array[(select oid from pg_roles where rolname='authenticated')]
  and replace(pg_get_expr(polqual,polrelid),'public.','')='( SELECT skyway_runtime_admitted() AS skyway_runtime_admitted)'
  and replace(pg_get_expr(polwithcheck,polrelid),'public.','')='( SELECT skyway_runtime_admitted() AS skyway_runtime_admitted)') then
   raise exception 'Unreviewed runtime policy: %','player_loadouts';
 end if;

 if not exists(select 1 from pg_policy where polrelid='public.player_photon_fury'::regclass and polname='skyway_pixel_runtime_admission') then
  execute 'create policy skyway_pixel_runtime_admission on public."player_photon_fury" as restrictive for all to authenticated using ((select public.skyway_runtime_admitted())) with check ((select public.skyway_runtime_admitted()))';
 end if;
 if not exists(select 1 from pg_policy where polrelid='public.player_photon_fury'::regclass and polname='skyway_pixel_runtime_admission'
  and not polpermissive and polcmd='*' and polroles=array[(select oid from pg_roles where rolname='authenticated')]
  and replace(pg_get_expr(polqual,polrelid),'public.','')='( SELECT skyway_runtime_admitted() AS skyway_runtime_admitted)'
  and replace(pg_get_expr(polwithcheck,polrelid),'public.','')='( SELECT skyway_runtime_admitted() AS skyway_runtime_admitted)') then
   raise exception 'Unreviewed runtime policy: %','player_photon_fury';
 end if;

 if not exists(select 1 from pg_policy where polrelid='public.player_profiles'::regclass and polname='skyway_pixel_runtime_admission') then
  execute 'create policy skyway_pixel_runtime_admission on public."player_profiles" as restrictive for all to authenticated using ((select public.skyway_runtime_admitted())) with check ((select public.skyway_runtime_admitted()))';
 end if;
 if not exists(select 1 from pg_policy where polrelid='public.player_profiles'::regclass and polname='skyway_pixel_runtime_admission'
  and not polpermissive and polcmd='*' and polroles=array[(select oid from pg_roles where rolname='authenticated')]
  and replace(pg_get_expr(polqual,polrelid),'public.','')='( SELECT skyway_runtime_admitted() AS skyway_runtime_admitted)'
  and replace(pg_get_expr(polwithcheck,polrelid),'public.','')='( SELECT skyway_runtime_admitted() AS skyway_runtime_admitted)') then
   raise exception 'Unreviewed runtime policy: %','player_profiles';
 end if;

 if not exists(select 1 from pg_policy where polrelid='public.player_progression_1v1_activity'::regclass and polname='skyway_pixel_runtime_admission') then
  execute 'create policy skyway_pixel_runtime_admission on public."player_progression_1v1_activity" as restrictive for all to authenticated using ((select public.skyway_runtime_admitted())) with check ((select public.skyway_runtime_admitted()))';
 end if;
 if not exists(select 1 from pg_policy where polrelid='public.player_progression_1v1_activity'::regclass and polname='skyway_pixel_runtime_admission'
  and not polpermissive and polcmd='*' and polroles=array[(select oid from pg_roles where rolname='authenticated')]
  and replace(pg_get_expr(polqual,polrelid),'public.','')='( SELECT skyway_runtime_admitted() AS skyway_runtime_admitted)'
  and replace(pg_get_expr(polwithcheck,polrelid),'public.','')='( SELECT skyway_runtime_admitted() AS skyway_runtime_admitted)') then
   raise exception 'Unreviewed runtime policy: %','player_progression_1v1_activity';
 end if;

 if not exists(select 1 from pg_policy where polrelid='public.player_progression_events'::regclass and polname='skyway_pixel_runtime_admission') then
  execute 'create policy skyway_pixel_runtime_admission on public."player_progression_events" as restrictive for all to authenticated using ((select public.skyway_runtime_admitted())) with check ((select public.skyway_runtime_admitted()))';
 end if;
 if not exists(select 1 from pg_policy where polrelid='public.player_progression_events'::regclass and polname='skyway_pixel_runtime_admission'
  and not polpermissive and polcmd='*' and polroles=array[(select oid from pg_roles where rolname='authenticated')]
  and replace(pg_get_expr(polqual,polrelid),'public.','')='( SELECT skyway_runtime_admitted() AS skyway_runtime_admitted)'
  and replace(pg_get_expr(polwithcheck,polrelid),'public.','')='( SELECT skyway_runtime_admitted() AS skyway_runtime_admitted)') then
   raise exception 'Unreviewed runtime policy: %','player_progression_events';
 end if;

 if not exists(select 1 from pg_policy where polrelid='public.player_progression_runs'::regclass and polname='skyway_pixel_runtime_admission') then
  execute 'create policy skyway_pixel_runtime_admission on public."player_progression_runs" as restrictive for all to authenticated using ((select public.skyway_runtime_admitted())) with check ((select public.skyway_runtime_admitted()))';
 end if;
 if not exists(select 1 from pg_policy where polrelid='public.player_progression_runs'::regclass and polname='skyway_pixel_runtime_admission'
  and not polpermissive and polcmd='*' and polroles=array[(select oid from pg_roles where rolname='authenticated')]
  and replace(pg_get_expr(polqual,polrelid),'public.','')='( SELECT skyway_runtime_admitted() AS skyway_runtime_admitted)'
  and replace(pg_get_expr(polwithcheck,polrelid),'public.','')='( SELECT skyway_runtime_admitted() AS skyway_runtime_admitted)') then
   raise exception 'Unreviewed runtime policy: %','player_progression_runs';
 end if;

 if not exists(select 1 from pg_policy where polrelid='public.player_ranked_1v1_stats'::regclass and polname='skyway_pixel_runtime_admission') then
  execute 'create policy skyway_pixel_runtime_admission on public."player_ranked_1v1_stats" as restrictive for all to authenticated using ((select public.skyway_runtime_admitted())) with check ((select public.skyway_runtime_admitted()))';
 end if;
 if not exists(select 1 from pg_policy where polrelid='public.player_ranked_1v1_stats'::regclass and polname='skyway_pixel_runtime_admission'
  and not polpermissive and polcmd='*' and polroles=array[(select oid from pg_roles where rolname='authenticated')]
  and replace(pg_get_expr(polqual,polrelid),'public.','')='( SELECT skyway_runtime_admitted() AS skyway_runtime_admitted)'
  and replace(pg_get_expr(polwithcheck,polrelid),'public.','')='( SELECT skyway_runtime_admitted() AS skyway_runtime_admitted)') then
   raise exception 'Unreviewed runtime policy: %','player_ranked_1v1_stats';
 end if;

 if not exists(select 1 from pg_policy where polrelid='public.player_reports'::regclass and polname='skyway_pixel_runtime_admission') then
  execute 'create policy skyway_pixel_runtime_admission on public."player_reports" as restrictive for all to authenticated using ((select public.skyway_runtime_admitted())) with check ((select public.skyway_runtime_admitted()))';
 end if;
 if not exists(select 1 from pg_policy where polrelid='public.player_reports'::regclass and polname='skyway_pixel_runtime_admission'
  and not polpermissive and polcmd='*' and polroles=array[(select oid from pg_roles where rolname='authenticated')]
  and replace(pg_get_expr(polqual,polrelid),'public.','')='( SELECT skyway_runtime_admitted() AS skyway_runtime_admitted)'
  and replace(pg_get_expr(polwithcheck,polrelid),'public.','')='( SELECT skyway_runtime_admitted() AS skyway_runtime_admitted)') then
   raise exception 'Unreviewed runtime policy: %','player_reports';
 end if;

 if not exists(select 1 from pg_policy where polrelid='public.player_stats'::regclass and polname='skyway_pixel_runtime_admission') then
  execute 'create policy skyway_pixel_runtime_admission on public."player_stats" as restrictive for all to authenticated using ((select public.skyway_runtime_admitted())) with check ((select public.skyway_runtime_admitted()))';
 end if;
 if not exists(select 1 from pg_policy where polrelid='public.player_stats'::regclass and polname='skyway_pixel_runtime_admission'
  and not polpermissive and polcmd='*' and polroles=array[(select oid from pg_roles where rolname='authenticated')]
  and replace(pg_get_expr(polqual,polrelid),'public.','')='( SELECT skyway_runtime_admitted() AS skyway_runtime_admitted)'
  and replace(pg_get_expr(polwithcheck,polrelid),'public.','')='( SELECT skyway_runtime_admitted() AS skyway_runtime_admitted)') then
   raise exception 'Unreviewed runtime policy: %','player_stats';
 end if;

 if not exists(select 1 from pg_policy where polrelid='public.player_unlocks'::regclass and polname='skyway_pixel_runtime_admission') then
  execute 'create policy skyway_pixel_runtime_admission on public."player_unlocks" as restrictive for all to authenticated using ((select public.skyway_runtime_admitted())) with check ((select public.skyway_runtime_admitted()))';
 end if;
 if not exists(select 1 from pg_policy where polrelid='public.player_unlocks'::regclass and polname='skyway_pixel_runtime_admission'
  and not polpermissive and polcmd='*' and polroles=array[(select oid from pg_roles where rolname='authenticated')]
  and replace(pg_get_expr(polqual,polrelid),'public.','')='( SELECT skyway_runtime_admitted() AS skyway_runtime_admitted)'
  and replace(pg_get_expr(polwithcheck,polrelid),'public.','')='( SELECT skyway_runtime_admitted() AS skyway_runtime_admitted)') then
   raise exception 'Unreviewed runtime policy: %','player_unlocks';
 end if;

 if not exists(select 1 from pg_policy where polrelid='public.ranked_1v1_results'::regclass and polname='skyway_pixel_runtime_admission') then
  execute 'create policy skyway_pixel_runtime_admission on public."ranked_1v1_results" as restrictive for all to authenticated using ((select public.skyway_runtime_admitted())) with check ((select public.skyway_runtime_admitted()))';
 end if;
 if not exists(select 1 from pg_policy where polrelid='public.ranked_1v1_results'::regclass and polname='skyway_pixel_runtime_admission'
  and not polpermissive and polcmd='*' and polroles=array[(select oid from pg_roles where rolname='authenticated')]
  and replace(pg_get_expr(polqual,polrelid),'public.','')='( SELECT skyway_runtime_admitted() AS skyway_runtime_admitted)'
  and replace(pg_get_expr(polwithcheck,polrelid),'public.','')='( SELECT skyway_runtime_admitted() AS skyway_runtime_admitted)') then
   raise exception 'Unreviewed runtime policy: %','ranked_1v1_results';
 end if;

 if not exists(select 1 from pg_policy where polrelid='public.ranked_1v1_seasons'::regclass and polname='skyway_pixel_runtime_admission') then
  execute 'create policy skyway_pixel_runtime_admission on public."ranked_1v1_seasons" as restrictive for all to authenticated using ((select public.skyway_runtime_admitted())) with check ((select public.skyway_runtime_admitted()))';
 end if;
 if not exists(select 1 from pg_policy where polrelid='public.ranked_1v1_seasons'::regclass and polname='skyway_pixel_runtime_admission'
  and not polpermissive and polcmd='*' and polroles=array[(select oid from pg_roles where rolname='authenticated')]
  and replace(pg_get_expr(polqual,polrelid),'public.','')='( SELECT skyway_runtime_admitted() AS skyway_runtime_admitted)'
  and replace(pg_get_expr(polwithcheck,polrelid),'public.','')='( SELECT skyway_runtime_admitted() AS skyway_runtime_admitted)') then
   raise exception 'Unreviewed runtime policy: %','ranked_1v1_seasons';
 end if;

 if not exists(select 1 from pg_policy where polrelid='public.username_blocklist'::regclass and polname='skyway_pixel_runtime_admission') then
  execute 'create policy skyway_pixel_runtime_admission on public."username_blocklist" as restrictive for all to authenticated using ((select public.skyway_runtime_admitted())) with check ((select public.skyway_runtime_admitted()))';
 end if;
 if not exists(select 1 from pg_policy where polrelid='public.username_blocklist'::regclass and polname='skyway_pixel_runtime_admission'
  and not polpermissive and polcmd='*' and polroles=array[(select oid from pg_roles where rolname='authenticated')]
  and replace(pg_get_expr(polqual,polrelid),'public.','')='( SELECT skyway_runtime_admitted() AS skyway_runtime_admitted)'
  and replace(pg_get_expr(polwithcheck,polrelid),'public.','')='( SELECT skyway_runtime_admitted() AS skyway_runtime_admitted)') then
   raise exception 'Unreviewed runtime policy: %','username_blocklist';
 end if;
 for item in select * from jsonb_array_elements('[{"signature":"public.acknowledge_1v1_attacks(uuid,uuid[])","before":"2e9bb36506d61f984774dbe3d628fb16","after":"c7a2c6716375ad231a95b23728137546","acl":"{neondb_owner=X/neondb_owner,authenticated=X/neondb_owner}","volatility":"v","strict":false,"returns_set":false,"security_definer":true},{"signature":"public.activate_1v1_katana(uuid)","before":"b22db9dd9799772fdd7f5c1b045e6758","after":"0c562a96b224923cbaf7a6432f29377c","acl":"{neondb_owner=X/neondb_owner,authenticated=X/neondb_owner}","volatility":"v","strict":false,"returns_set":false,"security_definer":true},{"signature":"public.activate_1v1_mirage(uuid,integer)","before":"fdfa573194904c7ed194e7f299be5877","after":"cbdbcb56ecf6730bb6122494ea616f53","acl":"{neondb_owner=X/neondb_owner,authenticated=X/neondb_owner}","volatility":"v","strict":false,"returns_set":false,"security_definer":true},{"signature":"public.activate_1v1_zenith_time_stop(uuid,bigint)","before":"9b5923f72e1915d34dcbd1c32b462f19","after":"f0117de485a24e1c5dd8d1f10c16c629","acl":"{neondb_owner=X/neondb_owner,authenticated=X/neondb_owner}","volatility":"v","strict":false,"returns_set":false,"security_definer":true},{"signature":"public.activate_mastery_quest(text)","before":"5c76058dc2384751153baba4590c99a3","after":"c6badf748f32bf8cc3923436a4eaf055","acl":"{neondb_owner=X/neondb_owner,authenticated=X/neondb_owner}","volatility":"v","strict":false,"returns_set":false,"security_definer":true},{"signature":"public.admin_command_suggestions(text,text,uuid,integer)","before":"196fdccbe87ce8aa5ec10b76b758bf80","after":"991cb01c281e429434d3c7a57c044a04","acl":"{neondb_owner=X/neondb_owner,authenticated=X/neondb_owner}","volatility":"s","strict":false,"returns_set":false,"security_definer":true},{"signature":"public.admin_execute_player_command(text,uuid,text,text,text,bigint,text[],uuid,bigint,boolean,bigint,text,text)","before":"a5039d2716c73dc97464894bdb7eff84","after":"bbd66fcb231c7a760ae3b97e0e5fbec8","acl":"{neondb_owner=X/neondb_owner,authenticated=X/neondb_owner}","volatility":"v","strict":false,"returns_set":false,"security_definer":true},{"signature":"public.admin_get_player(uuid)","before":"f384754d68052ea5f8b1629b9413c5da","after":"69483988c96f352a9167eb891008b7b4","acl":"{neondb_owner=X/neondb_owner,authenticated=X/neondb_owner}","volatility":"s","strict":false,"returns_set":false,"security_definer":true},{"signature":"public.admin_get_player_record(uuid)","before":"7baadda1a9868b656a95166482047333","after":"d6b651f28d2469e9182a1d93216cdf16","acl":"{neondb_owner=X/neondb_owner,authenticated=X/neondb_owner}","volatility":"s","strict":false,"returns_set":false,"security_definer":true},{"signature":"public.admin_player_command_v23(text,uuid,text,text,text,bigint,text[],uuid,bigint,boolean,bigint,text,text)","before":"7925824222414ea9c84a216d3d9603b4","after":"459842372f493c4f384e0e0bd2369e3c","acl":"{neondb_owner=X/neondb_owner,authenticated=X/neondb_owner}","volatility":"v","strict":false,"returns_set":false,"security_definer":true},{"signature":"public.admin_player_search(text,integer)","before":"e8ba6a0ba010f7223f3234f10f9ffbde","after":"21ac275828cdb0e71a7215cb9764fe9b","acl":"{neondb_owner=X/neondb_owner,authenticated=X/neondb_owner}","volatility":"s","strict":false,"returns_set":true,"security_definer":true},{"signature":"public.admin_unban_player(uuid,text,text)","before":"3c8282b3ac1dbdb9a1191fab326480a4","after":"be8587e6d321b82e298b313526801acf","acl":"{neondb_owner=X/neondb_owner,authenticated=X/neondb_owner}","volatility":"v","strict":false,"returns_set":false,"security_definer":true},{"signature":"public.apply_1v1_mirage_damage(uuid,numeric)","before":"03e3ae2a03641b7085ec412a35dfd07f","after":"8c06ef018003004265b4e007a38129bb","acl":"{neondb_owner=X/neondb_owner,authenticated=X/neondb_owner}","volatility":"v","strict":false,"returns_set":false,"security_definer":true},{"signature":"public.apply_mastery_heal(uuid,uuid,text)","before":"2d50a0659c8f70b55d2ebddea2aa17ca","after":"964b54d79fdc9b49f865e89f698d08b0","acl":"{neondb_owner=X/neondb_owner,authenticated=X/neondb_owner}","volatility":"v","strict":false,"returns_set":false,"security_definer":true},{"signature":"public.award_1v1_mushroom(uuid,integer,text)","before":"a7e0ced417532f86324ceaebdc0ae946","after":"106efc91501fc8711b2e59903085b4c8","acl":"{neondb_owner=X/neondb_owner,authenticated=X/neondb_owner}","volatility":"v","strict":false,"returns_set":false,"security_definer":true},{"signature":"public.award_completed_run(uuid,bigint,text)","before":"a5c058cd6ee7afae1a1df82936513af6","after":"49824e7edf56f730da34c02bf8117738","acl":"{neondb_owner=X/neondb_owner,authenticated=X/neondb_owner}","volatility":"v","strict":false,"returns_set":false,"security_definer":false},{"signature":"public.award_completed_run_v2(uuid,bigint,text)","before":"b608465567cd5db892f5f87df7a29f8a","after":"e080b242311ec01a06bd6fafc35cf6a8","acl":"{neondb_owner=X/neondb_owner,authenticated=X/neondb_owner}","volatility":"v","strict":false,"returns_set":false,"security_definer":true},{"signature":"public.ban_1v1_map(uuid,text)","before":"13ae90929cad71c67a3a3b22e9ea61fc","after":"e3b406ea1b9bbaa93b9cabc6c6bb793d","acl":"{neondb_owner=X/neondb_owner,authenticated=X/neondb_owner}","volatility":"v","strict":false,"returns_set":false,"security_definer":true},{"signature":"public.begin_mastery_session(uuid,text,text,text)","before":"4ccfb235c9ac80893664a4a9c9516886","after":"d711a403449df664269b6d9eccbd2179","acl":"{neondb_owner=X/neondb_owner,authenticated=X/neondb_owner}","volatility":"v","strict":false,"returns_set":false,"security_definer":true},{"signature":"public.begin_mastery_smoke_charge(uuid,uuid)","before":"52938ab7087e09bb5821fd4b730ad2ef","after":"5caf79f85f2d9e7989156e40e6697b4d","acl":"{neondb_owner=X/neondb_owner,authenticated=X/neondb_owner}","volatility":"v","strict":false,"returns_set":false,"security_definer":true},{"signature":"public.begin_photon_character_run(text)","before":"501d922cf618dce27eef170740c3183f","after":"e38d8399f4503ac3e4c1d25802643c19","acl":"{neondb_owner=X/neondb_owner,authenticated=X/neondb_owner}","volatility":"v","strict":false,"returns_set":false,"security_definer":true},{"signature":"public.begin_photon_fury_run()","before":"cae6381056fbbe7927794e46f5d5ad3c","after":"c8898941577c541f9d0eaa70bd259cee","acl":"{neondb_owner=X/neondb_owner,authenticated=X/neondb_owner}","volatility":"v","strict":false,"returns_set":false,"security_definer":true},{"signature":"public.choose_1v1_character(uuid,text)","before":"ab8c932d964fc343a67295f7ebdf4329","after":"7584224f502f02fd110869e351d5e505","acl":"{neondb_owner=X/neondb_owner,authenticated=X/neondb_owner}","volatility":"v","strict":false,"returns_set":false,"security_definer":true},{"signature":"public.claim_mastery_blue_gem(uuid,text)","before":"7449095175d9e3e9b24645453fddf63f","after":"a71cd38b884521ea1bc25a93d904d87e","acl":"{neondb_owner=X/neondb_owner,authenticated=X/neondb_owner}","volatility":"v","strict":false,"returns_set":false,"security_definer":true},{"signature":"public.claim_player_gem(uuid,text)","before":"1b7748b1ffcbda1bb41561bf1a63f85f","after":"a530aad1a79f6b33c5295669016a0937","acl":"{neondb_owner=X/neondb_owner,authenticated=X/neondb_owner}","volatility":"v","strict":false,"returns_set":false,"security_definer":true},{"signature":"public.consume_1v1_heatfeast(uuid,integer)","before":"8868b87adb1a869f0bcf1d2f360bd338","after":"2da286ed3933bb3821a4752526d9a397","acl":"{neondb_owner=X/neondb_owner,authenticated=X/neondb_owner}","volatility":"v","strict":false,"returns_set":false,"security_definer":true},{"signature":"public.credit_mastery_events(uuid,jsonb)","before":"f8304bb2602c5ac8784647b249c08f21","after":"0aa7ed22b11dde933c75f05a981b8a1f","acl":"{neondb_owner=X/neondb_owner,authenticated=X/neondb_owner}","volatility":"v","strict":false,"returns_set":false,"security_definer":true},{"signature":"public.discard_1v1_gambit_cards(uuid,text[])","before":"9115b4707ff212bd9c9ca36765f6e27c","after":"aa3f5bba3a04d0626edbf73df2f5b7f9","acl":"{neondb_owner=X/neondb_owner,authenticated=X/neondb_owner}","volatility":"v","strict":false,"returns_set":false,"security_definer":true},{"signature":"public.draw_1v1_gambit_wave(uuid,integer)","before":"0b9c05f5394d8851f498991cdeb99ae9","after":"e5d7d9d062028954aabe3c5090b163b7","acl":"{neondb_owner=X/neondb_owner,authenticated=X/neondb_owner}","volatility":"v","strict":false,"returns_set":false,"security_definer":true},{"signature":"public.equip_photon_character(text)","before":"63f2539101d9b9541c691f9eba29be6f","after":"ec5f8bc4894b1374e3811344c5fafa1d","acl":"{neondb_owner=X/neondb_owner,authenticated=X/neondb_owner}","volatility":"v","strict":false,"returns_set":false,"security_definer":true},{"signature":"public.extract_items(integer,text)","before":"3b6bd1107c90d0286533e0a1aa7a2a0d","after":"9f1bdf5ed272701a862ea133a7961a23","acl":"{neondb_owner=X/neondb_owner,authenticated=X/neondb_owner}","volatility":"v","strict":false,"returns_set":false,"security_definer":true},{"signature":"public.finish_mastery_trial(uuid)","before":"59773f1d9b11c526ce3d7fb793a843a6","after":"7bbc51b35f4c0a63170aeaba2d472712","acl":"{neondb_owner=X/neondb_owner,authenticated=X/neondb_owner}","volatility":"v","strict":false,"returns_set":false,"security_definer":true},{"signature":"public.finish_photon_character_run(uuid,numeric,integer,integer)","before":"77ae24e21c5250e4ec1889c1e698a96f","after":"98e96386944c431f277076a7afca5519","acl":"{neondb_owner=X/neondb_owner,authenticated=X/neondb_owner}","volatility":"v","strict":false,"returns_set":false,"security_definer":true},{"signature":"public.finish_photon_fury_run(uuid,numeric,integer)","before":"576f89d89fb2067d817b67384698db41","after":"929fa2fbeae6140c99b4f9104598997e","acl":"{neondb_owner=X/neondb_owner,authenticated=X/neondb_owner}","volatility":"v","strict":false,"returns_set":false,"security_definer":true},{"signature":"public.get_1v1_ability_state(uuid)","before":"9e0a7dd43b2e1cc5a7213917338f80e0","after":"61f68a4108dc52bc14174a113e93f22a","acl":"{neondb_owner=X/neondb_owner,authenticated=X/neondb_owner}","volatility":"v","strict":false,"returns_set":false,"security_definer":true},{"signature":"public.get_1v1_gambit_state(uuid)","before":"c5a718f271c59c45d1e43410ffeafe11","after":"587aa9f5a47dc5e5c21e07abe03f195b","acl":"{neondb_owner=X/neondb_owner,authenticated=X/neondb_owner}","volatility":"s","strict":false,"returns_set":false,"security_definer":true},{"signature":"public.get_1v1_leaderboard(integer,integer)","before":"431eab684b433aedee993034bec7df1d","after":"926e3d9940ed9f3af8400545052551e1","acl":"{neondb_owner=X/neondb_owner,authenticated=X/neondb_owner}","volatility":"s","strict":false,"returns_set":true,"security_definer":true},{"signature":"public.get_1v1_map_catalog()","before":"43603ddef490870ea4af4228bb1bd2e2","after":"e0dd4bc1277e277d1437d855cc862160","acl":"{neondb_owner=X/neondb_owner,authenticated=X/neondb_owner}","volatility":"s","strict":false,"returns_set":false,"security_definer":true},{"signature":"public.get_1v1_map_priorities()","before":"e76be6c759f4aad8d4e1fd58da5909f3","after":"8f115c3fbdc9d79dd9b28e9ee6ee96d3","acl":"{neondb_owner=X/neondb_owner,authenticated=X/neondb_owner}","volatility":"s","strict":false,"returns_set":false,"security_definer":true},{"signature":"public.get_1v1_state(uuid)","before":"7e34a158b95819674bee11ed817cecb5","after":"5d5089eb9451bac308c8dc46cd2e76d4","acl":"{neondb_owner=X/neondb_owner,authenticated=X/neondb_owner}","volatility":"v","strict":false,"returns_set":false,"security_definer":true},{"signature":"public.get_admin_ban_appeals(text)","before":"baca223ac0a95e266542354b036bca45","after":"20506313701daac946e8cce508183575","acl":"{neondb_owner=X/neondb_owner,authenticated=X/neondb_owner}","volatility":"s","strict":false,"returns_set":true,"security_definer":true},{"signature":"public.get_admin_reports()","before":"02aa7d8afb91bb90def94fc6b93434e2","after":"07a55c29bed8e822d9f7dc1c8300e74b","acl":"{neondb_owner=X/neondb_owner,authenticated=X/neondb_owner}","volatility":"v","strict":false,"returns_set":true,"security_definer":true},{"signature":"public.get_admin_role()","before":"5d48b9a287d941254970192eb8b73152","after":"25047f964ab2e6b203ed171ca5641121","acl":"{neondb_owner=X/neondb_owner,authenticated=X/neondb_owner}","volatility":"s","strict":false,"returns_set":false,"security_definer":true},{"signature":"public.get_admin_test_mode()","before":"220741af0bc2134b3bcd680a23c52a67","after":"cc24d55dca253907e1d71d46ccbffc6e","acl":"{neondb_owner=X/neondb_owner,authenticated=X/neondb_owner}","volatility":"s","strict":false,"returns_set":false,"security_definer":true},{"signature":"public.get_leaderboard()","before":"af2aafa2634a60cdd1ca80011e8f83fa","after":"26fb70ada061f63170b1baf7d62d69c2","acl":"{neondb_owner=X/neondb_owner,authenticated=X/neondb_owner}","volatility":"s","strict":false,"returns_set":true,"security_definer":true},{"signature":"public.get_mastery_profile()","before":"804e97da2b9a32e9f27d0f0453c573fb","after":"4dbb72b587a084d148a90f9bda25d6c3","acl":"{neondb_owner=X/neondb_owner,authenticated=X/neondb_owner}","volatility":"v","strict":false,"returns_set":false,"security_definer":true},{"signature":"public.get_mastery_salve_uses(uuid)","before":"1ea6ec3a834f9bbd3917ca927d5165a0","after":"be809ad27c7e391c319392a232aa0307","acl":"{neondb_owner=X/neondb_owner,authenticated=X/neondb_owner}","volatility":"s","strict":false,"returns_set":false,"security_definer":true},{"signature":"public.get_mastery_smoke_effect(uuid)","before":"dae7be9b073060961b821b30419b4386","after":"900484e06d31ddfd81d33a0104f19ec7","acl":"{neondb_owner=X/neondb_owner,authenticated=X/neondb_owner}","volatility":"s","strict":false,"returns_set":false,"security_definer":true},{"signature":"public.get_my_pixel_identity()","before":"fed83a0ccbd387560f8160bb07260c71","after":"dcd67cbb9bcebc48ef966f2c4da6badc","acl":"{neondb_owner=X/neondb_owner,authenticated=X/neondb_owner}","volatility":"s","strict":false,"returns_set":false,"security_definer":true},{"signature":"public.get_my_report_permission()","before":"dba48bc42bccff12c46edcd0b5b4273b","after":"153bf7ae09861feee6575d6a67792d95","acl":"{neondb_owner=X/neondb_owner,authenticated=X/neondb_owner}","volatility":"s","strict":false,"returns_set":false,"security_definer":true},{"signature":"public.get_photon_fury_profile()","before":"df59ddf9e197786be4541abd8b3b1b14","after":"3dc209dcd2912d143c2b25a1c913e807","acl":"{neondb_owner=X/neondb_owner,authenticated=X/neondb_owner}","volatility":"v","strict":false,"returns_set":false,"security_definer":true},{"signature":"public.get_player_progression()","before":"ed7b6013d71fa557b8b353039c29b458","after":"dbd9da294041b88d1cfd43d08b044be3","acl":"{neondb_owner=X/neondb_owner,authenticated=X/neondb_owner}","volatility":"v","strict":false,"returns_set":false,"security_definer":true},{"signature":"public.get_rotating_mode()","before":"85eba7d63cedcc3a689270b68d8ea4ab","after":"8de1b299e61f8e77d9e2221427c27d5b","acl":"{neondb_owner=X/neondb_owner,authenticated=X/neondb_owner}","volatility":"s","strict":false,"returns_set":false,"security_definer":true},{"signature":"public.is_admin()","before":"7053d4a3051e3b8ecfd26895942a3bdb","after":"a40b9a2ee84b1a73e8aa845507fff77f","acl":"{neondb_owner=X/neondb_owner,authenticated=X/neondb_owner}","volatility":"s","strict":false,"returns_set":false,"security_definer":true},{"signature":"public.join_1v1_queue(text)","before":"37bee9c2cfa5400c532f70f96dd1a3e6","after":"0d05b1b965ae186dc5c2e5cd4070e828","acl":"{neondb_owner=X/neondb_owner,authenticated=X/neondb_owner}","volatility":"v","strict":false,"returns_set":false,"security_definer":true},{"signature":"public.leave_1v1()","before":"77da4a34bdda6ecef65f79251c6f9a33","after":"d5f4186c0f1c3d474b69f77bc34889e1","acl":"{neondb_owner=X/neondb_owner,authenticated=X/neondb_owner}","volatility":"v","strict":false,"returns_set":false,"security_definer":true},{"signature":"public.list_admins()","before":"37e13ee2222e0ba60cf2afbbaafceaf7","after":"fd0b490cfec87f287f7c5479fdde3b5a","acl":"{neondb_owner=X/neondb_owner,authenticated=X/neondb_owner}","volatility":"s","strict":false,"returns_set":true,"security_definer":true},{"signature":"public.manage_admin(text,text)","before":"9367106ca37cccf5720a44614c34fb99","after":"541cc094531aeff1daf1173b89aa1641","acl":"{neondb_owner=X/neondb_owner,authenticated=X/neondb_owner}","volatility":"v","strict":false,"returns_set":false,"security_definer":true},{"signature":"public.purchase_1v1_comet_removal(uuid,text,text)","before":"c8685a5f1aa22c71386d20e809b9be49","after":"1fe74256d6af7d37de7078ba10fe4efd","acl":"{neondb_owner=X/neondb_owner,authenticated=X/neondb_owner}","volatility":"v","strict":false,"returns_set":false,"security_definer":true},{"signature":"public.purchase_catalog_item(text)","before":"e20a873e4de09ba26e70d1bf076bfad9","after":"c42e6bf46725f1ebeeea75fb42730749","acl":"{neondb_owner=X/neondb_owner,authenticated=X/neondb_owner}","volatility":"v","strict":false,"returns_set":false,"security_definer":true},{"signature":"public.purchase_mastery_quest(text)","before":"9c7362e98445f7bc9432b3f4f5e24631","after":"12baa752fd4e374458a571685eff4c36","acl":"{neondb_owner=X/neondb_owner,authenticated=X/neondb_owner}","volatility":"v","strict":false,"returns_set":false,"security_definer":true},{"signature":"public.record_1v1_ruins_pumpkin(uuid,integer,boolean)","before":"eec68e586d90edbae1432abad9972ca0","after":"a272664c4cf47147b7f42cf8bdb4b93d","acl":"{neondb_owner=X/neondb_owner,authenticated=X/neondb_owner}","volatility":"v","strict":false,"returns_set":false,"security_definer":true},{"signature":"public.record_1v1_terminal_contact(uuid,text,text)","before":"41a7f3e5c89d2b809907b94d3b6198cd","after":"f55d1397b8e458ffe4abd4676f1361e1","acl":"{neondb_owner=X/neondb_owner,authenticated=X/neondb_owner}","volatility":"v","strict":false,"returns_set":false,"security_definer":true},{"signature":"public.redeem_1v1_comet_removal(uuid,uuid,text)","before":"7f0799caf042b702c63fd8783311af5f","after":"140be1e87c40925c7ac0824dfe9e9cb6","acl":"{neondb_owner=X/neondb_owner,authenticated=X/neondb_owner}","volatility":"v","strict":false,"returns_set":false,"security_definer":true},{"signature":"public.reflect_1v1_attack(uuid,text,text)","before":"5df81fe46ecb558db5656389963b0192","after":"3df3e7ed88a387ad3105c5e312a50e7a","acl":"{neondb_owner=X/neondb_owner,authenticated=X/neondb_owner}","volatility":"v","strict":false,"returns_set":false,"security_definer":true},{"signature":"public.reflect_1v1_attack(uuid,text,text,uuid)","before":"f99ed3fcc37ff8e1221c2a11ff4cced1","after":"e65e871c256ae154cdffbeda6cf2519d","acl":"{neondb_owner=X/neondb_owner,authenticated=X/neondb_owner}","volatility":"v","strict":false,"returns_set":false,"security_definer":true},{"signature":"public.register_player_device(text,text)","before":"d367bc63ac6b8f4066fcd266d37c052d","after":"d6eaa201f134880f7d5c7815e3d60084","acl":"{neondb_owner=X/neondb_owner,authenticated=X/neondb_owner}","volatility":"v","strict":false,"returns_set":false,"security_definer":true},{"signature":"public.reset_endless_gem_streak(uuid)","before":"7cf64ec504939fc6b36d015d10b389f9","after":"4130a32a6d3565cbbbf83b31e7f3863f","acl":"{neondb_owner=X/neondb_owner,authenticated=X/neondb_owner}","volatility":"v","strict":false,"returns_set":false,"security_definer":true},{"signature":"public.resolve_ban_appeal(bigint,text,text)","before":"bf563c2964db602933d6d5b8c3181e0d","after":"9ed2f3a471777d2a096c04fa72aadc42","acl":"{neondb_owner=X/neondb_owner,authenticated=X/neondb_owner}","volatility":"v","strict":false,"returns_set":false,"security_definer":true},{"signature":"public.resolve_player_report(bigint)","before":"297577d44234c40c5a646cd5c2beaafd","after":"5ffa50a4c1fbe1deab1b9eaa7b82a173","acl":"{neondb_owner=X/neondb_owner,authenticated=X/neondb_owner}","volatility":"v","strict":false,"returns_set":false,"security_definer":true},{"signature":"public.send_1v1_attack(uuid,text,integer)","before":"02f3021540cac9a393348309330130d7","after":"24895974df384f355f1e0b6268747b98","acl":"{neondb_owner=X/neondb_owner,authenticated=X/neondb_owner}","volatility":"v","strict":false,"returns_set":false,"security_definer":true},{"signature":"public.set_1v1_map_priorities(text[])","before":"6d907fe2cb7cfc05a995e1513b03faf4","after":"e0f5e3bcc12c99028f9b961e9237ff08","acl":"{neondb_owner=X/neondb_owner,authenticated=X/neondb_owner}","volatility":"v","strict":false,"returns_set":false,"security_definer":true},{"signature":"public.set_1v1_terminal_facing(uuid,integer)","before":"129b4dc0a71da91538f41beb9b8d5fa0","after":"70e820895c5b3d6c7871a5ef45f5a7ac","acl":"{neondb_owner=X/neondb_owner,authenticated=X/neondb_owner}","volatility":"v","strict":false,"returns_set":false,"security_definer":true},{"signature":"public.set_admin_test_mode(boolean)","before":"0ab4beb7ca515f0ff9a813332ab9bce6","after":"8e1b224d9077eef6ce8bd0ce28f044db","acl":"{neondb_owner=X/neondb_owner,authenticated=X/neondb_owner}","volatility":"v","strict":false,"returns_set":false,"security_definer":true},{"signature":"public.set_endless_randomizer(boolean)","before":"533c538bcc69cc2470059b87a8a6eb5f","after":"aad92963335536fbc0e556bba020878a","acl":"{neondb_owner=X/neondb_owner,authenticated=X/neondb_owner}","volatility":"v","strict":false,"returns_set":false,"security_definer":true},{"signature":"public.set_loadout(text,text)","before":"11b5eefb4ee858c7d11f7e4128c576cc","after":"9365e74e499b439ca363d3974e5de80f","acl":"{neondb_owner=X/neondb_owner,authenticated=X/neondb_owner}","volatility":"v","strict":false,"returns_set":false,"security_definer":true},{"signature":"public.set_mastery_guard_mode(uuid,boolean)","before":"1782616691981973bf4ed8aa247054a2","after":"22f9fa79dcc58302270aadc169857c9a","acl":"{neondb_owner=X/neondb_owner,authenticated=X/neondb_owner}","volatility":"v","strict":false,"returns_set":false,"security_definer":true},{"signature":"public.set_mastery_toggle(text,text,boolean)","before":"2777750f8cc88796bd9ae6c725f85ce5","after":"da406efbb9f0265d90e509ace5dae986","acl":"{neondb_owner=X/neondb_owner,authenticated=X/neondb_owner}","volatility":"v","strict":false,"returns_set":false,"security_definer":true},{"signature":"public.set_player_flair(text)","before":"a68c59f3cd7b29c9e0751006813865ec","after":"edcb1fc8fb7f4226c4625f80cb0f0c1f","acl":"{neondb_owner=X/neondb_owner,authenticated=X/neondb_owner}","volatility":"v","strict":false,"returns_set":false,"security_definer":true},{"signature":"public.set_player_username(text)","before":"739790b1e424ee66fc9b034faa5add83","after":"a3a2e3a767bc4b2e1ac2de40725b176b","acl":"{neondb_owner=X/neondb_owner,authenticated=X/neondb_owner}","volatility":"v","strict":false,"returns_set":false,"security_definer":true},{"signature":"public.start_progression_run()","before":"1d29bc3714f34bc9842a8263252a53c7","after":"f5c2501643ccde87bce054384697eef8","acl":"{neondb_owner=X/neondb_owner,authenticated=X/neondb_owner}","volatility":"v","strict":false,"returns_set":false,"security_definer":true},{"signature":"public.sync_1v1_intermission_coins(uuid,text[])","before":"006077c3bf0ee4ed993ee76dabcdbcaf","after":"79923ce353703938c5ce2cc6eab3a684","acl":"{neondb_owner=X/neondb_owner,authenticated=X/neondb_owner}","volatility":"v","strict":false,"returns_set":false,"security_definer":true},{"signature":"public.sync_1v1_progression(uuid,integer,boolean)","before":"fc3a6a9790e125c406562fe6004d9280","after":"5406a6290e6e34dcd113a84932dd6c28","acl":"{neondb_owner=X/neondb_owner,authenticated=X/neondb_owner}","volatility":"v","strict":false,"returns_set":false,"security_definer":true},{"signature":"public.sync_1v1_score(uuid,bigint)","before":"ca3ea0bcd3d4e9b832846133e613a9f5","after":"acede6168db53201108e80f03897c25d","acl":"{neondb_owner=X/neondb_owner,authenticated=X/neondb_owner}","volatility":"v","strict":false,"returns_set":false,"security_definer":true},{"signature":"public.sync_progression_run(uuid,integer,boolean)","before":"0939260b3e6fc63448d789b6ce4e7b84","after":"3028e2e337416318b549d959091961e6","acl":"{neondb_owner=X/neondb_owner,authenticated=X/neondb_owner}","volatility":"v","strict":false,"returns_set":false,"security_definer":true},{"signature":"public.unlock_photon_fury()","before":"704adc605b5b786560157358edc006bf","after":"d32afb436384ab9bc68a6bd6bb5fb463","acl":"{neondb_owner=X/neondb_owner,authenticated=X/neondb_owner}","volatility":"v","strict":false,"returns_set":false,"security_definer":true},{"signature":"public.unlock_ranked_1v1()","before":"9ce47654f1daae5b3098513c6c18153c","after":"b03804331a830e1d51cc979e4912b5d9","acl":"{neondb_owner=X/neondb_owner,authenticated=X/neondb_owner}","volatility":"v","strict":false,"returns_set":false,"security_definer":true},{"signature":"public.update_1v1_position(uuid,integer)","before":"7cedd2a7456c079c6108e85daecef9ee","after":"f69f30fc6615753b01abeeddb8b22f74","acl":"{neondb_owner=X/neondb_owner,authenticated=X/neondb_owner}","volatility":"v","strict":false,"returns_set":false,"security_definer":true},{"signature":"public.update_1v1_state(uuid,numeric,integer,bigint,text)","before":"84661c556088e800368ce8f1e1783671","after":"77b5624409c06bf787960d2f97864fa5","acl":"{neondb_owner=X/neondb_owner,authenticated=X/neondb_owner}","volatility":"v","strict":false,"returns_set":false,"security_definer":true},{"signature":"public.update_1v1_terminal_state(uuid,numeric,integer,bigint,text,numeric)","before":"3cb3d9ee7beb5b2fe0654bcf8c497f9a","after":"9d40e2121f9ceae4d5d1b0a14d85569a","acl":"{neondb_owner=X/neondb_owner,authenticated=X/neondb_owner}","volatility":"v","strict":false,"returns_set":false,"security_definer":true},{"signature":"public.use_1v1_terminal_sword(uuid)","before":"892659fbde57fab0f1e504dec94afe5d","after":"f72aea0bf568ee561b1b10194c7fa8d6","acl":"{neondb_owner=X/neondb_owner,authenticated=X/neondb_owner}","volatility":"v","strict":false,"returns_set":false,"security_definer":true},{"signature":"public.use_mastery_smoke(uuid,integer,uuid)","before":"ba51d6ef5224b460e8f25ad66885c722","after":"4556dd4f1cc559349110ce90b066b9dc","acl":"{neondb_owner=X/neondb_owner,authenticated=X/neondb_owner}","volatility":"v","strict":false,"returns_set":false,"security_definer":true}]'::jsonb) loop
  if not exists(select 1 from pg_proc p where p.oid=(item->>'signature')::regprocedure and p.prosecdef=(item->>'security_definer')::boolean and p.prolang=(select oid from pg_language where lanname='plpgsql')
   and p.proconfig=array['search_path=""'] and p.proacl::text is not distinct from item->>'acl'
   and p.provolatile::text=item->>'volatility' and p.proisstrict=(item->>'strict')::boolean and p.proretset=(item->>'returns_set')::boolean
   and md5(p.prosrc)=item->>'after') then raise exception 'RPC attributes or permissions changed: %',item->>'signature';end if;
 end loop;
 raise notice 'PIXEL_RUNTIME_GUARD: %',jsonb_build_object('guarded_rpcs',92,'rls_tables',41,'native_linked_blocked',true,'managed_helpers_changed',false);
end $runtime_install$;
notify pgrst,'reload schema';
commit;
