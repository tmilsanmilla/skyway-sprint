-- LOCAL-ONLY rollback receipt tests. The local harness installs the production
-- function bodies from the read-only snapshot, then applies the new patch.
-- NOT eligible for live/production execution, even as a rollback. These tests
-- use only a socket-only disposable database and two exact synthetic actors.
begin;
do $local_only$
begin
 if current_database()<>'skyway_mastery_fixture' or inet_server_addr() is not null
  or current_setting('skyway.local_mastery_fixture',true) is distinct from 'skyway-mastery-disposable-v1'
  or to_regclass('app_private.local_test_fixture_marker') is null then raise exception 'LOCAL-ONLY gem-streak test refused outside disposable fixture';end if;
 if not exists(select 1 from app_private.local_test_fixture_marker where marker='skyway-mastery-disposable-v1')
  or (select count(*) from public.player_stats)<>2
  or not exists(select 1 from public.player_stats where user_id='11111111-1111-4111-8111-111111111111')
  or not exists(select 1 from public.player_stats where user_id='22222222-2222-4222-8222-222222222222')
 then raise exception 'LOCAL-ONLY gem-streak fixture/actors mismatch';end if;
end $local_only$;
do $checks$
declare u uuid;v uuid;r uuid:=gen_random_uuid();other_run uuid:=gen_random_uuid();p jsonb;total bigint;prior bigint;expected bigint;i integer;d text;
begin
 u:='11111111-1111-4111-8111-111111111111';v:='22222222-2222-4222-8222-222222222222';
 perform set_config('skyway.test_uid',u::text,true);
 update public.player_progression_runs set completed_at=coalesce(completed_at,clock_timestamp()) where user_id in(u,v) and completed_at is null;
 insert into public.player_progression_runs(run_id,user_id,started_at,active_seconds,verified_wave,last_heartbeat_at,heartbeat_active,test_mode)
 values(r,u,clock_timestamp()-interval '10 minutes',300,1,clock_timestamp(),true,false),
 (other_run,v,clock_timestamp()-interval '10 minutes',300,1,clock_timestamp(),true,false);
 select total_gems into total from public.player_stats where user_id=u;
 for i in 1..20 loop
  if i=13 then update public.player_progression_runs set verified_wave=2 where run_id=r;end if;
  p:=public.claim_player_gem(r,'uncapped-'||i);
  expected:=case when i<=5 then i when i<=10 then 5 else i-5 end;
  if (p->>'is_new')::boolean is not true or (p->>'streak')::integer<>i or (p->>'gems_awarded')::integer<>expected then raise exception 'Gem chain failed at %, got %',i,p;end if;
  total:=total+expected;
  if (p->>'total_gems')::bigint<>total then raise exception 'Verified bank reward incorrect';end if;
  -- Age only owned test receipts so each iteration represents a later pickup
  -- without sleeping. The separate rate-cap test below leaves them recent.
  update public.player_progression_events set created_at=clock_timestamp()-interval '2 seconds'
   where user_id=u and source_key=r::text||':uncapped-'||i;
 end loop;
 if (select streak from public.player_endless_gem_streaks where run_id=r)<>20 then raise exception 'Counter was capped or wave-reset';end if;
 p:=public.claim_player_gem(r,'uncapped-20');
 if (p->>'is_new')::boolean is not false or (p->>'total_gems')::bigint<>total or (p->>'gems_awarded')::integer<>15 then raise exception 'Replay paid again or forgot original award';end if;
 -- A damaged player's explicit zero row must win over prior pickup receipts.
 p:=public.reset_endless_gem_streak(r);
 if (p->>'reset')::boolean is not true or (select streak from public.player_endless_gem_streaks where run_id=r)<>0 then raise exception 'Explicit damage reset did not zero chain';end if;
 p:=public.claim_player_gem(r,'after-damage');
 if (p->>'streak')::integer<>1 or (p->>'gems_awarded')::integer<>1 then raise exception 'Fallback resurrected pre-damage streak';end if;
 update public.player_progression_events set created_at=clock_timestamp()-interval '2 seconds' where user_id=u and source_key=r::text||':after-damage';
 -- An absent streak row reconstructs the whole run, not only current wave.
 delete from public.player_endless_gem_streaks where run_id=r;
 p:=public.claim_player_gem(r,'fallback-whole-run');
 if (p->>'streak')::integer<>22 then raise exception 'Receipt fallback was still limited to current wave';end if;
 update public.player_progression_events set created_at=clock_timestamp()-interval '2 seconds' where user_id=u and source_key=r::text||':fallback-whole-run';
 select total_gems into prior from public.player_stats where user_id=v;
 begin perform public.claim_player_gem(other_run,'other-user');raise exception 'Other user gem context was accepted';
 exception when others then if sqlerrm<>'Gem context is not active' then raise;end if;end;
 begin perform public.reset_endless_gem_streak(other_run);raise exception 'Other user reset accepted';
 exception when others then if sqlerrm<>'Active Endless run not found' then raise;end if;end;
 if (select total_gems from public.player_stats where user_id=v)<>prior then raise exception 'Other account balance changed';end if;
 update public.player_progression_runs set heartbeat_active=false where run_id=r;
 begin perform public.claim_player_gem(r,'inactive');raise exception 'Inactive heartbeat accepted';
 exception when others then if sqlerrm<>'Gem collection requires active play' then raise;end if;end;
 update public.player_progression_runs set heartbeat_active=true,last_heartbeat_at=clock_timestamp()-interval '9 seconds' where run_id=r;
 begin perform public.claim_player_gem(r,'stale');raise exception 'Stale heartbeat accepted';
 exception when others then if sqlerrm<>'Gem collection requires active play' then raise;end if;end;
 update public.player_progression_runs set last_heartbeat_at=clock_timestamp(),active_seconds=0 where run_id=r;
 begin perform public.claim_player_gem(r,'above-cap');raise exception 'Physical pickup allowance bypassed';
 exception when others then if sqlerrm<>'Gem claim limit reached' then raise;end if;end;
 update public.player_progression_runs set active_seconds=300 where run_id=r;
 insert into public.player_progression_events(user_id,source,source_key,xp_awarded,metadata)
 select u,'gem','rate-limit-'||gen_random_uuid(),0,'{}'::jsonb from generate_series(1,3);
 begin perform public.claim_player_gem(r,'too-quick');raise exception 'Pickup rate cap bypassed';
 exception when others then if sqlerrm<>'Gem pickups arrived too quickly' then raise;end if;end;
 perform set_config('skyway.test_uid','',true);
 begin perform public.claim_player_gem(r,'no-session');raise exception 'Unsigned gem accepted';
 exception when others then if sqlerrm<>'Sign in required' then raise;end if;end;
 if has_function_privilege('anon','public.claim_player_gem(uuid,text)','execute') or has_function_privilege('anonymous','public.reset_endless_gem_streak(uuid)','execute')
 or has_function_privilege('authenticated','app_private.claim_player_gem_live(uuid,text)','execute') then raise exception 'RPC access was broadened';end if;
 d:=pg_get_functiondef('app_private.claim_player_gem_live(uuid,text)'::regprocedure);
 if position('Gem pickups arrived too quickly' in d)=0 or position('Gem claim limit reached' in d)=0 or position('for update' in lower(d))=0 then raise exception 'Installed safety envelope removed';end if;
end $checks$;
select 'PASS: physical receipts at wave 1/2 and streak 12/20, no cap/wave reset, explicit damage zero, replay, account isolation and unchanged claim envelopes' result;
rollback;
