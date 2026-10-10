-- Rollback-only verification of live permissions and exact run-function bodies.
-- Session-local clones replace identity only; production auth/functions are untouched.
begin;
do $$declare n text;f text;begin
  foreach n in array array['public.start_progression_run()','public.sync_progression_run(uuid,integer,boolean)','public.sync_1v1_progression(uuid,integer,boolean)','public.claim_player_gem(uuid,text)','public.reset_endless_gem_streak(uuid)','public.award_completed_run(uuid,bigint,text)','public.award_completed_run_v2(uuid,bigint,text)'] loop
    if not has_function_privilege('authenticated',n,'execute') then raise exception 'Missing signed-in permission: %',n;end if;
    if has_function_privilege('anon',n,'execute') or has_function_privilege('anonymous',n,'execute') then raise exception 'Anonymous access: %',n;end if;
  end loop;
  if has_table_privilege('authenticated','public.player_progression_runs','insert') or has_table_privilege('authenticated','public.player_stats','update') or has_function_privilege('authenticated','app_private.apply_player_xp(uuid,bigint,boolean)','execute') then raise exception 'Direct rewards exposed';end if;
  foreach n in array array['public.start_progression_run()','public.sync_progression_run(uuid,integer,boolean)','public.claim_player_gem(uuid,text)','public.reset_endless_gem_streak(uuid)','public.get_player_progression()','app_private.claim_player_gem_live(uuid,text)','app_private.award_completed_run_v2_live(uuid,bigint,text)','public.award_completed_run_v2(uuid,bigint,text)'] loop
    f:=pg_get_functiondef(n::regprocedure);
    f:=replace(f,'FUNCTION public.','FUNCTION pg_temp.');
    f:=replace(f,'FUNCTION app_private.','FUNCTION pg_temp.');
    f:=replace(f,'auth.uid()','nullif(current_setting(''skyway.test_uid'',true),'''')::uuid');
    f:=replace(f,'public.get_player_progression()','pg_temp.get_player_progression()');
    f:=replace(f,'app_private.claim_player_gem_live(','pg_temp.claim_player_gem_live(');
    f:=replace(f,'app_private.award_completed_run_v2_live(','pg_temp.award_completed_run_v2_live(');
    execute f;
  end loop;
end$$;
do $$declare u uuid;other_u uuid;r uuid;other_r uuid;p jsonb;before_runs bigint;before_xp bigint;begin
  select user_id into u from public.player_stats where not app_private.has_active_ban(user_id,'account',null) order by user_id limit 1;
  select user_id into other_u from public.player_stats where user_id<>u order by user_id limit 1;
  if u is null or other_u is null then raise exception 'Two test actors required';end if;
  perform set_config('skyway.test_uid',u::text,true);
  update public.player_stats set total_gems=100 where user_id=u;
  select completed_runs,lifetime_xp into before_runs,before_xp from public.player_stats where user_id=u;
  r:=pg_temp.start_progression_run();
  if r is null or not exists(select 1 from public.player_progression_runs where run_id=r and user_id=u and completed_at is null) then raise exception 'Run did not start';end if;
  p:=pg_temp.sync_progression_run(r,1,true);
  if (p->>'active')::boolean is not true then raise exception 'Heartbeat failed';end if;
  p:=pg_temp.claim_player_gem(r,'permission-test');
  if (p->>'total_gems')::bigint<>101 or (p->>'is_new')::boolean is not true then raise exception 'Gem claim failed';end if;
  p:=pg_temp.claim_player_gem(r,'permission-test');
  if (p->>'total_gems')::bigint<>101 or (p->>'is_new')::boolean is not false then raise exception 'Gem replay rewarded';end if;
  p:=pg_temp.reset_endless_gem_streak(r);
  if (p->>'reset')::boolean is not true then raise exception 'Streak reset failed';end if;
  insert into public.player_progression_runs(user_id) values(other_u) returning run_id into other_r;
  begin
    perform pg_temp.sync_progression_run(other_r,1,true);
    raise exception 'Cross-account heartbeat accepted';
  exception when others then if sqlerrm<>'Active run receipt not found' then raise;end if;end;
  begin
    perform pg_temp.award_completed_run_v2(other_r,100,'endless');
    raise exception 'Cross-account reward accepted';
  exception when others then if sqlerrm<>'Run receipt not found' then raise;end if;end;
  update public.player_progression_runs set started_at=clock_timestamp()-interval '30 seconds',active_seconds=20 where run_id=r;
  p:=pg_temp.award_completed_run_v2(r,10000,'endless');
  if (p->>'xp_awarded')::bigint<>floor(power(10000::numeric,2.2)/3000000)::bigint then raise exception 'Fresh score reward failed';end if;
  p:=pg_temp.award_completed_run_v2(r,10000,'endless');
  if (p->>'xp_awarded')::bigint<>0 or (select completed_runs from public.player_stats where user_id=u)<>before_runs+1 then raise exception 'Run replay rewarded';end if;
  perform set_config('skyway.test_uid','',true);
  begin perform pg_temp.start_progression_run();raise exception 'No-session start accepted';
  exception when others then if sqlerrm<>'Sign in required' then raise;end if;end;
end$$;
select 'PASS: run start, heartbeat, Gems, save, replay protection and account isolation' result;
rollback;
