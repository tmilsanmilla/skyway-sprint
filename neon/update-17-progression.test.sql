-- Rollback-only integration fixtures. No account changes or tests survive.
begin;
do $$ declare f text;signature text;begin
  foreach signature in array array['public.get_player_progression()','public.unlock_ranked_1v1()',
    'app_private.photon_user()','public.finish_photon_character_run(uuid,numeric,integer,integer)',
    'app_private.award_completed_run_v2_live(uuid,bigint,text)'] loop
    f:=pg_get_functiondef(signature::regprocedure);
    f:=replace(f,'FUNCTION public.get_player_progression(','FUNCTION pg_temp.test_progression(');
    f:=replace(f,'FUNCTION public.unlock_ranked_1v1(','FUNCTION pg_temp.test_unlock_ranked(');
    f:=replace(f,'FUNCTION app_private.photon_user(','FUNCTION pg_temp.test_photon_user(');
    f:=replace(f,'FUNCTION public.finish_photon_character_run(','FUNCTION pg_temp.test_photon_finish(');
    f:=replace(f,'FUNCTION app_private.award_completed_run_v2_live(','FUNCTION pg_temp.test_award_run(');
    f:=replace(f,'public.get_player_progression()','pg_temp.test_progression()');
    f:=replace(f,'app_private.photon_user()','pg_temp.test_photon_user()');
    f:=replace(f,'auth.uid()','nullif(current_setting(''skyway.test_uid'',true),'''')::uuid');
    execute f;
  end loop;
end $$;
do $$
#variable_conflict use_variable
declare a uuid;b uuid;before_b jsonb;profile jsonb;paid jsonb;rejected boolean;run_id uuid:=gen_random_uuid();
  photon_id uuid:=gen_random_uuid();value bigint;before_xp bigint;level_no integer;
begin
  if exists(select 1 from public.player_stats where level<>0 or lifetime_xp<>0 or xp_in_level<>0) then raise exception 'One-time reset did not clear progression';end if;
  if to_regclass('app_private.progression_reset_backup') is not null then raise exception 'Old XP recovery data retained';end if;
  if exists(select 1 from public.player_progression_events where xp_awarded<>0 or metadata?'xp_breakdown') then raise exception 'Old XP receipts retained';end if;
  for level_no in 1..500 loop
    value:=app_private.cumulative_xp_for_level(level_no);
    if app_private.level_for_lifetime_xp(value)<>level_no or app_private.level_for_lifetime_xp(value-1)<>level_no-1
      or app_private.xp_required_for_level(level_no-1)<>100+100*level_no then raise exception 'XP boundary mismatch at %',level_no;end if;
  end loop;
  if app_private.cumulative_xp_for_level(25)<>35000 or app_private.xp_required_for_level(74)<>7600 then raise exception 'XP curve mismatch';end if;
  if app_private.photon_points_reward(3)<>0 or app_private.photon_points_reward(4)<>1 or app_private.photon_points_reward(5)<>2 or app_private.photon_points_reward(7)<>10 then raise exception 'Photon formula mismatch';end if;
  select user_id into a from public.player_profiles where not app_private.is_admin_test_user(user_id)
    and not app_private.has_active_ban(user_id,'account',null) and not app_private.has_active_ban(user_id,'leaderboard',null) order by user_id limit 1;
  select user_id into b from public.player_profiles where user_id<>a order by user_id limit 1;
  if a is null or b is null then raise exception 'Two accounts required for rollback-only isolation test';end if;
  select to_jsonb(s) into before_b from public.player_stats s where user_id=b;
  perform set_config('skyway.test_uid',a::text,true);
  update public.player_stats set total_gems=250 where user_id=a;
  insert into app_private.ranked_requalification(user_id,qualified) values(a,false) on conflict(user_id) do update set qualified=false;
  insert into public.player_photon_fury(user_id,unlocked_at,photons) values(a,null,0) on conflict(user_id) do update set unlocked_at=null,photons=0;
  profile:=pg_temp.test_progression();
  if (profile->>'level')::integer<>0 or (profile->>'xp_required')::bigint<>200 or (profile->>'ranked_unlocked')::boolean then raise exception 'Fresh profile mismatch';end if;
  rejected:=false;
  begin perform pg_temp.test_unlock_ranked();exception when others then rejected:=sqlerrm='Ranked requires level 25';end;
  if not rejected then raise exception 'Low-level Ranked purchase accepted';end if;
  -- Exercise the protected, receipt-backed award path, including a gem streak.
  insert into public.player_progression_runs(run_id,user_id,started_at,active_seconds,heartbeat_active)
    values(run_id,a,clock_timestamp()-interval '100 seconds',100,false);
  insert into public.player_progression_events(user_id,source,source_key,xp_awarded,metadata)
    values(a,'gem',gen_random_uuid()::text,0,jsonb_build_object('context_id',run_id,'context_type','endless','gems_awarded',7));
  profile:=pg_temp.test_award_run(run_id,10000,'endless');
  value:=floor(power(10000::numeric,2.2)/3000000)::bigint;
  if (profile->>'xp_awarded')::bigint<>value or (profile->>'lifetime_xp')::bigint<>value or (profile->'xp_breakdown'->>'gems')::bigint<>0 then raise exception 'Protected award used old XP or gem bonus';end if;
  profile:=pg_temp.test_award_run(run_id,10000,'endless');
  if (profile->>'xp_awarded')::bigint<>0 or (profile->>'lifetime_xp')::bigint<>value then raise exception 'Run credited twice';end if;
  perform set_config('skyway.test_uid',b::text,true);
  rejected:=false;
  begin perform pg_temp.test_award_run(run_id,10000,'endless');exception when others then rejected:=sqlerrm='Run receipt not found';end;
  if not rejected then raise exception 'Other account run accepted';end if;
  perform set_config('skyway.test_uid',a::text,true);
  update public.player_stats set level=25,xp_in_level=0,lifetime_xp=35000,total_gems=99 where user_id=a;
  rejected:=false;
  begin perform pg_temp.test_unlock_ranked();exception when others then rejected:=sqlerrm='You need 100 Gems';end;
  if not rejected then raise exception 'Unaffordable Ranked purchase accepted';end if;
  update public.player_stats set total_gems=250 where user_id=a;
  paid:=pg_temp.test_unlock_ranked();
  if not (paid->>'ranked_unlocked')::boolean or (paid->>'total_gems')::numeric<>150 then raise exception 'Ranked purchase failed';end if;
  paid:=pg_temp.test_unlock_ranked();
  if (paid->>'total_gems')::numeric<>150 then raise exception 'Ranked charged twice';end if;
  if (select unlocked_at from public.player_photon_fury where user_id=a) is not null then raise exception 'Ranked changed Photon unlock';end if;
  update public.player_photon_fury set unlocked_at=clock_timestamp() where user_id=a;
  before_xp:=(pg_temp.test_progression()->>'lifetime_xp')::bigint;
  insert into app_private.photon_fury_runs(id,user_id,started_at,character_key,saber_cooldown_seconds,point_multiplier)
    values(photon_id,a,clock_timestamp()-interval '100 seconds','photon_tick',1.2,1);
  profile:=pg_temp.test_photon_finish(photon_id,10,5,0);
  if (profile->>'awarded')::bigint<>2 or profile?'score' or (profile->>'points')::numeric<>5 then raise exception 'Photon payout mismatch';end if;
  profile:=pg_temp.test_photon_finish(photon_id,10,5,0);
  if (profile->>'photons')::bigint<>2 then raise exception 'Photon paid twice';end if;
  if (pg_temp.test_progression()->>'lifetime_xp')::bigint<>before_xp then raise exception 'Photon granted XP';end if;
  perform set_config('skyway.test_uid',b::text,true);
  rejected:=false;
  begin perform pg_temp.test_photon_finish(photon_id,10,5,0);exception when others then rejected:=sqlerrm='No run';end;
  if not rejected then raise exception 'Other account Photon receipt accepted';end if;
  if (select to_jsonb(s) from public.player_stats s where user_id=b) is distinct from before_b then raise exception 'Other account stats changed';end if;
  perform set_config('skyway.test_uid','',true);
  rejected:=false;
  begin perform pg_temp.test_unlock_ranked();exception when others then rejected:=sqlerrm='Sign in required';end;
  if not rejected then raise exception 'Anonymous purchase accepted';end if;
  if has_function_privilege('anon','public.unlock_ranked_1v1()','EXECUTE') or has_function_privilege('anonymous','public.unlock_ranked_1v1()','EXECUTE')
    or not has_function_privilege('authenticated','public.unlock_ranked_1v1()','EXECUTE')
    or has_function_privilege('authenticated','app_private.apply_player_xp(uuid,bigint,boolean)','EXECUTE')
    or has_table_privilege('authenticated','app_private.progression_resets','SELECT') then raise exception 'Unsafe progression permissions';end if;
end $$;
select 'PASS: old XP erased, 500 level boundaries, protected score-only XP, replay denial, independent Ranked purchase, single charge, Update 17 Photon payout, account isolation, private permissions' as result;
rollback;
