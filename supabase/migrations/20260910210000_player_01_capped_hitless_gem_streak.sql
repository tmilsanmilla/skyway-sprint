-- Player 01 extension: capped hitless-run gem streak.
--
-- Awards 1,2,3,4,5, then five more pickups at 5, followed by 6 and a
-- permanent cap of 7 until damage. The public wrapper keeps the existing
-- admin Test Mode no-reward guard and the private receipt/heartbeat checks.

begin;

do $$
begin
  if to_regprocedure('public.claim_player_gem(uuid,text)') is null
     or to_regprocedure(
       'app_private.claim_player_gem_live(uuid,text)'
     ) is null
     or to_regprocedure(
       'app_private.is_test_run_context(uuid,uuid)'
     ) is null then
    raise exception 'Run the current merged Player 01 SQL first';
  end if;
end
$$;

create or replace function app_private.endless_gem_streak_award(
  p_consecutive_pickups bigint
)
returns bigint
language sql
immutable
security invoker
set search_path=''
as $$
  select case
    when coalesce(p_consecutive_pickups,0)<=0 then 0
    when p_consecutive_pickups<=5 then p_consecutive_pickups
    when p_consecutive_pickups<=10 then 5
    when p_consecutive_pickups=11 then 6
    else 7
  end;
$$;
revoke all on function app_private.endless_gem_streak_award(bigint)
  from public,anon,authenticated;

create or replace function public.claim_player_gem(
  p_context_id uuid,
  p_pickup_id text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_uid uuid:=auth.uid();
  v_pickup_id text:=trim(p_pickup_id);
  v_total bigint;
  v_test_context_active boolean;
  v_verified_wave integer;
  v_result jsonb;
  v_streak bigint;
  v_raw_award bigint;
  v_desired_award bigint;
begin
  -- The private live implementation retains the verified heartbeat_active and
  -- active_seconds envelope, including "Gem pickups arrived too quickly".
  if v_uid is null then raise exception 'Sign in required'; end if;
  if p_context_id is null or v_pickup_id is null
     or length(v_pickup_id) not between 1 and 120 then
    raise exception 'Valid gem context and pickup ID are required';
  end if;

  if app_private.is_test_run_context(p_context_id,v_uid) then
    select exists(
      select 1 from public.player_progression_runs run
      where run.run_id=p_context_id and run.user_id=v_uid and run.test_mode
        and run.completed_at is null
        and run.started_at>now()-interval '6 hours'
        and run.heartbeat_active
        and run.last_heartbeat_at>=clock_timestamp()-interval '8 seconds'
    ) or exists(
      select 1
      from public.multiplayer_matches match
      join public.multiplayer_players player
        on player.match_id=match.id and player.user_id=v_uid
      join public.player_progression_1v1_activity activity
        on activity.match_id=match.id and activity.user_id=v_uid
      where match.id=p_context_id and player.test_mode
        and match.status='playing' and player.status='playing'
        and activity.heartbeat_active
        and activity.last_heartbeat_at>=clock_timestamp()-interval '8 seconds'
    ) into v_test_context_active;
    if not v_test_context_active then
      raise exception 'Gem collection requires active test play';
    end if;
    select total_gems into v_total
    from public.player_stats where user_id=v_uid;
    return jsonb_build_object(
      'total_gems',coalesce(v_total,0),'gems_awarded',0,'streak',0,
      'is_new',true,'test_mode',true,
      'progression',public.get_player_progression()
    );
  end if;

  -- Match the private claim/reset lock order before touching streak state.
  perform pg_advisory_xact_lock(hashtextextended(v_uid::text,1));

  -- The original verified claim code used the wave column as a reset signal.
  -- Advancing it first makes this a hitless-run chain without weakening any
  -- receipt, heartbeat, rate-limit, or idempotency validation it performs.
  select run.verified_wave into v_verified_wave
  from public.player_progression_runs run
  where run.run_id=p_context_id and run.user_id=v_uid
    and run.completed_at is null;
  if found then
    update public.player_endless_gem_streaks streak
    set wave=v_verified_wave,updated_at=now()
    where streak.run_id=p_context_id and streak.user_id=v_uid;
  end if;

  v_result:=app_private.claim_player_gem_live(p_context_id,p_pickup_id);
  if v_verified_wave is null
     or not coalesce((v_result->>'is_new')::boolean,false) then
    return v_result;
  end if;

  v_streak:=least(12,greatest(1,coalesce((v_result->>'streak')::bigint,1)));
  v_raw_award:=greatest(0,coalesce((v_result->>'gems_awarded')::bigint,1));
  v_desired_award:=app_private.endless_gem_streak_award(v_streak);

  if v_raw_award<>v_desired_award then
    update public.player_stats
    set total_gems=greatest(0,total_gems+v_desired_award-v_raw_award),
        updated_at=now()
    where user_id=v_uid;
    update public.player_progression_events event
    set metadata=jsonb_set(
      jsonb_set(event.metadata,'{streak}',to_jsonb(v_streak),true),
      '{gems_awarded}',to_jsonb(v_desired_award),true
    )
    where event.user_id=v_uid and event.source='gem'
      and event.source_key=p_context_id::text||':'||v_pickup_id;
  end if;

  update public.player_endless_gem_streaks streak
  set streak=v_streak,wave=v_verified_wave,updated_at=now()
  where streak.run_id=p_context_id and streak.user_id=v_uid;
  select total_gems into v_total
  from public.player_stats where user_id=v_uid;
  return v_result||jsonb_build_object(
    'total_gems',coalesce(v_total,0),
    'gems_awarded',v_desired_award,
    'streak',v_streak,
    'streak_wave',v_verified_wave
  );
end;
$$;

revoke all on function public.claim_player_gem(uuid,text)
  from public,anon,authenticated;
grant execute on function public.claim_player_gem(uuid,text)
  to authenticated;

comment on function public.claim_player_gem(uuid,text) is
  'Receipt-backed gem claim. Endless awards 1-5, holds at 5 for five pickups, then awards 6 and caps at 7 until damage; 1v1 awards one gem.';
comment on function public.reset_endless_gem_streak(uuid) is
  'Clears the caller''s current verified Endless gem streak after damage.';

do $$
begin
  if array(
       select app_private.endless_gem_streak_award(pickup)
       from generate_series(1,14) pickup
       order by pickup
     )<>array[1,2,3,4,5,5,5,5,5,5,6,7,7,7]::bigint[] then
    raise exception 'Endless gem streak reward curve is incorrect';
  end if;
  if position('app_private.is_test_run_context' in pg_get_functiondef(
       to_regprocedure('public.claim_player_gem(uuid,text)')
     ))=0
     or position('app_private.claim_player_gem_live' in pg_get_functiondef(
       to_regprocedure('public.claim_player_gem(uuid,text)')
     ))=0
     or position('app_private.endless_gem_streak_award' in pg_get_functiondef(
       to_regprocedure('public.claim_player_gem(uuid,text)')
     ))=0 then
    raise exception 'Gem streak wrapper lost its security or reward guard';
  end if;
  if position('heartbeat_active' in pg_get_functiondef(
       to_regprocedure('app_private.claim_player_gem_live(uuid,text)')
     ))=0
     or position('active_seconds' in pg_get_functiondef(
       to_regprocedure('app_private.claim_player_gem_live(uuid,text)')
     ))=0 then
    raise exception 'Verified gem claim envelope was not preserved';
  end if;
  if not has_function_privilege(
       'authenticated','public.claim_player_gem(uuid,text)','EXECUTE'
     ) or has_function_privilege(
       'anon','public.claim_player_gem(uuid,text)','EXECUTE'
     ) then
    raise exception 'Gem claim privileges are incorrect';
  end if;
end
$$;

notify pgrst,'reload schema';
commit;
