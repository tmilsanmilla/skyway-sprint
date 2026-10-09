-- Run after progression.sql definitions in a rollback-only transaction.
-- No fixture balance, score, run or level survives the final ROLLBACK.
do $$declare f text;n text;begin
  if exists(select 1 from public.player_stats where level<>0 or xp_in_level<>0 or lifetime_xp<>0 or progression_version<>20261009) then raise exception 'Reset did not zero all progression';end if;
  foreach n in array array['public.get_player_progression()','app_private.award_completed_run_v2_live(uuid,bigint,text)','public.award_completed_run_v2(uuid,bigint,text)'] loop
    f:=pg_get_functiondef(n::regprocedure);
    f:=replace(f,'FUNCTION public.get_player_progression(','FUNCTION pg_temp.get_progression(');
    f:=replace(f,'FUNCTION app_private.award_completed_run_v2_live(','FUNCTION pg_temp.award_live(');
    f:=replace(f,'FUNCTION public.award_completed_run_v2(','FUNCTION pg_temp.award_run(');
    f:=replace(f,'auth.uid()','nullif(current_setting(''skyway.test_uid'',true),'''')::uuid');
    f:=replace(f,'public.get_player_progression()','pg_temp.get_progression()');
    f:=replace(f,'app_private.award_completed_run_v2_live(','pg_temp.award_live(');
    execute f;
  end loop;
end$$;
do $$declare u uuid;r uuid;p jsonb;before_runs bigint;begin
  select user_id into u from public.player_stats where not app_private.has_active_ban(user_id,'account',null) order by user_id limit 1;
  if u is null then raise exception 'Account fixture unavailable';end if;
  perform set_config('skyway.test_uid',u::text,true);
  update app_private.progression_resets set applied_at=clock_timestamp()-interval '1 minute' where version=20261009;
  insert into public.player_progression_runs(user_id,started_at,active_seconds,verified_wave,last_heartbeat_at,heartbeat_active)
    values(u,clock_timestamp()-interval '2 minutes',20,1,clock_timestamp(),false) returning run_id into r;
  p:=pg_temp.award_run(r,10000,'endless');
  if (p->>'xp_awarded')::bigint<>0 or (p->>'lifetime_xp')::bigint<>0 then raise exception 'Old run restored XP';end if;
  select completed_runs into before_runs from public.player_stats where user_id=u;
  insert into public.player_progression_runs(user_id,started_at,active_seconds,verified_wave,last_heartbeat_at,heartbeat_active)
    values(u,clock_timestamp()-interval '30 seconds',20,1,clock_timestamp(),false) returning run_id into r;
  p:=pg_temp.award_run(r,10000,'endless');
  if (p->>'xp_awarded')::bigint<>floor(power(10000::numeric,2.2)/3000000)::bigint or (p->>'level')::integer<>1 then raise exception 'New run did not progress correctly';end if;
  p:=pg_temp.award_run(r,10000,'endless');
  if (p->>'xp_awarded')::bigint<>0 or (select completed_runs from public.player_stats where user_id=u)<>before_runs+1 then raise exception 'Run was rewarded twice';end if;
  if has_function_privilege('anon','public.get_player_progression()','execute') or has_table_privilege('authenticated','app_private.progression_resets','select') then raise exception 'Progression security weakened';end if;
end$$;
select 'PASS: reset, new levels, old-run fence, anti-replay and security' progression_checks;
