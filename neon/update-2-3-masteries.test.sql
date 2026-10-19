-- LOCAL-ONLY. Run ONLY through scripts/test-masteries-sql.mjs in its disposable
-- socket-only database. NOT eligible for a production/live rollback audit.
-- The guard below fails before cloning functions or touching any player row.
-- All actors are the two exact synthetic UUIDs created by that local harness.
begin;
set local statement_timeout='30s';
do $local_only$
begin
 if current_database()<>'skyway_mastery_fixture' or inet_server_addr() is not null
  or current_setting('skyway.local_mastery_fixture',true) is distinct from 'skyway-mastery-disposable-v1'
  or to_regclass('app_private.local_test_fixture_marker') is null then raise exception 'LOCAL-ONLY mastery test refused outside disposable fixture';end if;
 if not exists(select 1 from app_private.local_test_fixture_marker where marker='skyway-mastery-disposable-v1')
  or (select count(*) from public.player_stats)<>2
  or not exists(select 1 from public.player_stats where user_id='11111111-1111-4111-8111-111111111111')
  or not exists(select 1 from public.player_stats where user_id='22222222-2222-4222-8222-222222222222')
 then raise exception 'LOCAL-ONLY mastery fixture/actors mismatch';end if;
end $local_only$;
do $clones$
declare f text;n text;
begin
 f:=pg_get_functiondef('app_private.photon_user()'::regprocedure);
 f:=replace(f,'FUNCTION app_private.photon_user()','FUNCTION pg_temp.mastery_test_user()');
 f:=replace(f,'auth.uid()','nullif(current_setting(''skyway.mastery_test_uid'',true),'''')::uuid');
 execute f;
 foreach n in array array['get_mastery_profile()','purchase_mastery_quest(text)','activate_mastery_quest(text)',
  'set_mastery_toggle(text,text,boolean)','set_player_flair(text)','set_endless_randomizer(boolean)',
  'begin_mastery_session(uuid,text,text,text)','credit_mastery_events(uuid,jsonb)','finish_mastery_trial(uuid)'] loop
  f:=pg_get_functiondef(('public.'||n)::regprocedure);
  f:=replace(f,'FUNCTION public.','FUNCTION pg_temp.');
  f:=replace(f,'app_private.photon_user()','pg_temp.mastery_test_user()');
  f:=replace(f,'public.get_mastery_profile()','pg_temp.get_mastery_profile()');
  execute f;
 end loop;
end $clones$;
do $checks$
declare u uuid;v uuid;r uuid;sid uuid;reply jsonb;balance bigint;events jsonb;seq integer;before_stats jsonb;rejected boolean;
begin
 u:='11111111-1111-4111-8111-111111111111';v:='22222222-2222-4222-8222-222222222222';
 select to_jsonb(s) into before_stats from public.player_stats s where user_id=v;
 perform set_config('skyway.mastery_test_uid',u::text,true);
 insert into public.player_unlocks(user_id,item_key,item_type,rarity,ownership_proven_at)
 select u,item_key,'character',rarity,clock_timestamp() from public.extraction_catalog where item_key in('runner_dash','runner_stride','medic_bloom')
 on conflict(user_id,item_key) do nothing;
 insert into public.player_photon_fury(user_id,unlocked_at,photons) values(u,clock_timestamp(),2000)
 on conflict(user_id) do update set unlocked_at=excluded.unlocked_at,photons=2000;
 delete from app_private.mastery_sessions where user_id=u;
 delete from app_private.player_mastery_preferences where user_id=u;
 delete from app_private.player_mastery_quests where user_id=u;
 reply:=pg_temp.purchase_mastery_quest('runner_dash');
 if reply->'account'->>'active'<>'runner_dash' or (reply->>'photons')::bigint<>1800 then raise exception 'Quest price/activation failed';end if;
 reply:=pg_temp.purchase_mastery_quest('runner_dash');
 if (reply->>'photons')::bigint<>1800 then raise exception 'Duplicate purchase charged twice';end if;
 reply:=pg_temp.purchase_mastery_quest('runner_stride');
 if reply->'account'->>'active'<>'runner_dash' or (reply->>'photons')::bigint<>1600 then raise exception 'Second purchase replaced active quest';end if;
 reply:=pg_temp.set_player_flair('medic_bloom');
 if reply->>'flair_key'<>'medic_bloom' then raise exception 'Independent flair ownership failed';end if;
 reply:=pg_temp.set_endless_randomizer(true);
 if (reply->>'randomizer')::boolean is not true then raise exception 'Randomizer did not persist';end if;
 begin perform pg_temp.set_mastery_toggle('runner_dash','mastery',true);raise exception 'Premature mastery accepted';
 exception when others then if sqlerrm<>'Complete this mastery trial first' then raise;end if;end;
 update public.player_progression_runs set completed_at=coalesce(completed_at,clock_timestamp()) where user_id=u and completed_at is null;
 insert into public.player_progression_runs(user_id,started_at,active_seconds,test_mode) values(u,clock_timestamp()-interval '10 minutes',100,false) returning run_id into r;
 insert into public.player_loadouts(user_id,character_key) values(u,'runner_dash') on conflict(user_id) do update set character_key='runner_dash';
 reply:=pg_temp.begin_mastery_session(r,'endless','runner_dash',null);sid:=(reply->>'session_id')::uuid;
 update app_private.mastery_sessions set started_at=clock_timestamp()-interval '10 minutes' where id=sid;
 update app_private.player_mastery_quests set progress=99 where user_id=u and character_key='runner_dash';
 reply:=pg_temp.credit_mastery_events(sid,'[{"seq":1,"at":1,"type":"dash"}]');
 if (reply->'account'->'quests'->'runner_dash'->>'quest')::integer<>1 then raise exception 'Sequential quest did not advance';end if;
 reply:=pg_temp.credit_mastery_events(sid,'[{"seq":1,"at":1,"type":"dash"}]');
 if (reply->'account'->'quests'->'runner_dash'->'progress'->>0)::numeric<>0 then raise exception 'Retry double credited event';end if;
 reply:=pg_temp.begin_mastery_session(r,'endless','runner_dash',null);
 if (reply->>'session_id')::uuid<>sid or (reply->>'last_seq')::integer<>1 or (reply->>'last_at')::numeric<>1 then raise exception 'Restored mastery cursor was not returned';end if;
 begin perform pg_temp.credit_mastery_events(sid,'[{"seq":3,"at":1,"type":"dash"}]');raise exception 'Sequence gap accepted';
 exception when others then if sqlerrm<>'Mastery event sequence gap' then raise;end if;end;
 begin perform pg_temp.credit_mastery_events(sid,'[{"seq":2,"at":0,"type":"dash"}]');raise exception 'Backwards event clock accepted';
 exception when others then if sqlerrm<>'Invalid mastery event clock' then raise;end if;end;
 perform set_config('skyway.mastery_test_uid',v::text,true);
 begin perform pg_temp.credit_mastery_events(sid,'[{"seq":2,"at":2,"type":"dash"}]');raise exception 'Cross-account session credited';
 exception when others then if sqlerrm<>'Owned mastery session not found' then raise;end if;end;
 if (select to_jsonb(s) from public.player_stats s where user_id=v) is distinct from before_stats then raise exception 'Other player stats changed';end if;
 perform set_config('skyway.mastery_test_uid',u::text,true);
 update app_private.player_mastery_quests set quest=3,progress=75 where user_id=u and character_key='runner_dash';
 reply:=pg_temp.begin_mastery_session(r,'endless','runner_dash','runner_dash');sid:=(reply->>'session_id')::uuid;
 if not (select test_mode from public.player_progression_runs where run_id=r) then raise exception 'Trial run can still receive real rewards';end if;
 reply:=pg_temp.begin_mastery_session(r,'endless','runner_dash','runner_dash');
 if (reply->>'session_id')::uuid<>sid then raise exception 'Trial begin retry is not idempotent';end if;
 update app_private.mastery_sessions set started_at=clock_timestamp()-interval '2 minutes' where id=sid;
 begin perform pg_temp.finish_mastery_trial(sid);raise exception 'Unfinished trial granted mastery';
 exception when others then if sqlerrm<>'Complete the trial and collect its trophy first' then raise;end if;end;
 select jsonb_agg(jsonb_build_object('seq',n,'at',n,'type','frame','seconds',1,'hp',3) order by n) into events from generate_series(1,45)n;
 reply:=pg_temp.credit_mastery_events(sid,events);
 if (reply->>'trial_ready')::boolean is not true then raise exception 'Dash timed trial did not reach finale';end if;
 begin perform pg_temp.finish_mastery_trial(sid);raise exception 'Trophy finale skipped';
 exception when others then if sqlerrm<>'Complete the trial and collect its trophy first' then raise;end if;end;
 select jsonb_agg(jsonb_build_object('seq',n,'at',n,'type','frame','seconds',1,'hp',3) order by n) into events from generate_series(46,48)n;
 perform pg_temp.credit_mastery_events(sid,events);
 reply:=pg_temp.finish_mastery_trial(sid);
 if (reply->'account'->'quests'->'runner_dash'->>'mastered')::boolean is not true then raise exception 'Completed trial did not grant mastery';end if;
 reply:=pg_temp.set_mastery_toggle('runner_dash','mastery',false);
 if (reply->'account'->'quests'->'runner_dash'->>'masteryEnabled')::boolean is not false or (reply->'account'->'quests'->'runner_dash'->>'flairRewriteEnabled')::boolean is not true then raise exception 'Independent toggles coupled';end if;
 reply:=pg_temp.set_mastery_toggle('runner_dash','flair',false);
 if (reply->'account'->'quests'->'runner_dash'->>'flairRewriteEnabled')::boolean is not false then raise exception 'Flair toggle failed';end if;
 update public.player_progression_runs set completed_at=coalesce(completed_at,clock_timestamp()) where user_id=u and completed_at is null;
 insert into public.player_progression_runs(user_id,test_mode) values(u,false) returning run_id into r;
 reply:=pg_temp.begin_mastery_session(r,'endless','runner_dash','runner_dash');sid:=(reply->>'session_id')::uuid;
 reply:=pg_temp.credit_mastery_events(sid,'[{"seq":1,"at":0,"type":"trial-special","action":"miss"},{"seq":2,"at":0,"type":"run-end"}]');
 if (reply->>'trial_failed')::boolean is not true or not exists(select 1 from app_private.mastery_sessions where id=sid and finished_at is not null) then raise exception 'Failed trial could not be abandoned';end if;
 reply:=pg_temp.activate_mastery_quest('runner_stride');
 if reply->'account'->>'active'<>'runner_stride' then raise exception 'Abandoned failed trial still blocks quest switching';end if;
 -- An old trial and a disconnected ordinary run both release their lock;
 -- neither path grants a mastery, reward or extra quest progress.
 insert into app_private.mastery_sessions(user_id,context_id,context_type,character_key,last_received_at)
 values(u,gen_random_uuid(),'trial','runner_dash',clock_timestamp()-interval '61 seconds');
 reply:=pg_temp.activate_mastery_quest('runner_stride');
 if exists(select 1 from app_private.mastery_sessions where user_id=u and finished_at is null) then raise exception 'Disconnected trial blocks quest switching';end if;
 insert into app_private.mastery_sessions(user_id,context_id,context_type,character_key)
 values(u,r,'endless','runner_dash');
 update public.player_progression_runs set heartbeat_active=false where run_id=r;
 reply:=pg_temp.activate_mastery_quest('runner_stride');
 if exists(select 1 from app_private.mastery_sessions where user_id=u and finished_at is null) then raise exception 'Disconnected ordinary run blocks quest switching';end if;
 -- A frame at zero HP cannot finish a timed trial, even when the client's
 -- separate death event has not reached the server yet.
 insert into public.player_progression_runs(user_id,test_mode) values(u,false) returning run_id into r;
 reply:=pg_temp.begin_mastery_session(r,'endless','runner_dash','runner_dash');sid:=(reply->>'session_id')::uuid;
 update app_private.mastery_sessions set started_at=clock_timestamp()-interval '2 minutes' where id=sid;
 reply:=pg_temp.credit_mastery_events(sid,'[{"seq":1,"at":1,"type":"frame","seconds":1,"hp":0}]');
 if (reply->>'trial_failed')::boolean is not true then raise exception 'Zero-HP trial frame did not fail';end if;
 begin perform pg_temp.finish_mastery_trial(sid);raise exception 'Zero-HP trial granted mastery';
 exception when others then if sqlerrm<>'Complete the trial and collect its trophy first' then raise;end if;end;
 perform pg_temp.credit_mastery_events(sid,'[{"seq":2,"at":1,"type":"run-end"}]');
 perform set_config('skyway.mastery_test_uid','',true);
 begin perform pg_temp.get_mastery_profile();raise exception 'Guest mastery access accepted';
 exception when others then if sqlerrm<>'Sign in required' then raise;end if;end;
 foreach seq in array array[0,1,2,3] loop
  if app_private.mastery_target('runner_dash',seq) is distinct from (array[100,10,75,null])[seq+1] then raise exception 'Quest target drift';end if;
 end loop;
 if app_private.rounded_health_for_conditions(.8)<>1 or app_private.rounded_health_for_conditions(1.75)<>2 or app_private.rounded_health_for_conditions(.1)<>.5 then raise exception 'Condition rounding failed';end if;
end $checks$;
do $permissions$
declare f text;t text;
begin
 foreach f in array array['public.get_mastery_profile()','public.purchase_mastery_quest(text)','public.activate_mastery_quest(text)',
  'public.set_mastery_toggle(text,text,boolean)','public.set_player_flair(text)','public.set_endless_randomizer(boolean)',
  'public.begin_mastery_session(uuid,text,text,text)','public.credit_mastery_events(uuid,jsonb)','public.finish_mastery_trial(uuid)'] loop
  if not has_function_privilege('authenticated',f,'execute') or has_function_privilege('anon',f,'execute') or has_function_privilege('anonymous',f,'execute') then raise exception 'RPC permission mismatch: %',f;end if;
 end loop;
 foreach t in array array['app_private.player_mastery_quests','app_private.player_mastery_preferences','app_private.mastery_sessions'] loop
  if has_table_privilege('authenticated',t,'insert') or has_table_privilege('authenticated',t,'update') or has_table_privilege('authenticated',t,'delete') then raise exception 'Direct mastery grants exposed';end if;
 end loop;
 if has_function_privilege('authenticated','app_private.mastery_owns_character(uuid,text)','execute') or has_function_privilege('authenticated','app_private.claim_player_gem_before_mastery_flairs(uuid,text)','execute') then raise exception 'Private helper exposed';end if;
 if has_function_privilege('authenticated','public.set_player_weapon(text)','execute') then raise exception 'Retired weapon writer reactivated';end if;
end $permissions$;
select 'PASS: mastery costs, ownership, one active quest, sequential credit, replay, run binding, trial reward isolation, finale, independent toggles and denied direct writes' result;
rollback;
