-- Reported gameplay fixes: exact gem-streak XP, healer HP parity, and current
-- Runner ability descriptions. This migration is rerunnable and preserves all
-- existing Tank health and ability rules.

begin;

do $$
begin
  if to_regclass('public.player_stats') is null
     or to_regclass('public.player_progression_events') is null
     or to_regprocedure('app_private.endless_run_xp_breakdown(bigint,bigint)') is null
     or to_regprocedure('app_private.one_v_one_character_snapshot(uuid,text)') is null then
    raise exception 'Player 01 Stats and Multi-device 01 must be installed first';
  end if;
end
$$;

-- Only characters whose ability explicitly raises maximum HP may exceed the
-- normal 3-HP Healer cap. Map-specific HP modifiers are still applied after
-- this character snapshot. Tank values are intentionally unchanged.
create or replace function app_private.one_v_one_character_snapshot(
  p_user_id uuid,
  p_map_key text
)
returns table(
  character_key text,
  character_class text,
  max_hearts numeric,
  starting_hearts numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_key text;
  v_class text;
  v_allowed text[];
  v_forced text;
  v_base_max numeric;
  v_base_start numeric;
  v_multiplier numeric;
  v_bonus numeric;
begin
  select loadout.character_key, catalog.character_class
  into v_key, v_class
  from public.player_loadouts loadout
  join public.extraction_catalog catalog
    on catalog.item_key = loadout.character_key
   and catalog.item_type = 'character'
  join public.player_unlocks unlock
    on unlock.user_id = loadout.user_id
   and unlock.item_key = loadout.character_key
   and unlock.item_type = 'character'
  where loadout.user_id = p_user_id;
  v_key := coalesce(v_key, 'runner_ace');
  v_class := coalesce(v_class, 'runner');

  select rules.allowed_character_classes, rules.forced_character_key,
         coalesce((rules.gameplay_rules->>'hp_multiplier')::numeric, 1),
         coalesce((rules.gameplay_rules->>'hp_bonus')::numeric, 0)
  into v_allowed, v_forced, v_multiplier, v_bonus
  from app_private.one_v_one_map_rules rules
  where rules.map_key = p_map_key;

  if v_forced is not null then
    v_key := v_forced;
    v_class := 'runner';
  elsif not (v_class = any(v_allowed)) then
    v_key := 'runner_ace';
    v_class := 'runner';
  end if;

  v_base_max := case
    when v_key = 'tank_atlas' then 6
    when v_key in ('medic_beacon', 'tank_colossus') then 5.5
    when v_key = 'tank_guard' then 4.5
    when v_key = 'medic_patch' then 4
    when v_key in ('medic_suture', 'tank_hammer') then 5
    when v_class = 'tank' then 4
    when v_class = 'trickster' then 2
    else 3
  end;
  v_base_start := case
    when v_class = 'tank' then 4
    when v_class = 'trickster' then 2
    else 3
  end;

  return query select v_key, v_class,
    (v_base_max * v_multiplier + v_bonus)::numeric,
    (v_base_start * v_multiplier + v_bonus)::numeric;
end;
$$;

revoke all on function app_private.one_v_one_character_snapshot(uuid, text)
  from public, anon, authenticated;

-- The streak RPC stores the authoritative amount awarded by each pickup in
-- metadata.gems_awarded. Sum that value instead of counting receipt rows.
create or replace function public.award_completed_run_v2(
  p_run_id uuid,
  p_score bigint,
  p_scope text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_uid uuid:=auth.uid();
  v_scope text:=lower(trim(p_scope));
  v_inserted uuid;
  v_score bigint;
  v_started_at timestamptz;
  v_completed_at timestamptz;
  v_stored_score bigint;
  v_high_score bigint;
  v_active_seconds bigint;
  v_last_heartbeat timestamptz;
  v_heartbeat_active boolean;
  v_final_increment bigint:=0;
  v_gem_count bigint:=0;
  v_xp bigint;
  v_breakdown jsonb;
  v_existing_breakdown jsonb;
  v_progress jsonb;
  v_match_status text;
  v_match_mode text;
begin
  if v_uid is null then raise exception 'Sign in required'; end if;
  if p_run_id is null then raise exception 'Run ID is required'; end if;
  if p_score is null or p_score<0 or p_score>1000000000 then
    raise exception 'Invalid run score';
  end if;
  if v_scope not in('endless','casual_1v1','ranked_1v1') then
    raise exception 'Invalid run type';
  end if;

  if v_scope<>'endless' then
    select match_row.status,match_row.mode
    into v_match_status,v_match_mode
    from public.multiplayer_matches match_row
    join public.multiplayer_players player
      on player.match_id=match_row.id and player.user_id=v_uid
    where match_row.id=p_run_id;
    if v_match_status is null then raise exception '1v1 result not found'; end if;
    if v_match_status<>'finished' then raise exception '1v1 is not finished'; end if;
    if v_scope<>(v_match_mode||'_1v1') then
      raise exception '1v1 mode does not match the finished result';
    end if;
    select high_score into v_high_score
    from public.player_stats where user_id=v_uid;
    return public.get_player_progression()||jsonb_build_object(
      'xp_awarded',0,
      'xp_breakdown',jsonb_build_object(
        'score',0,'gems',0,'gem_count',0,'total',0
      ),
      'high_score',coalesce(v_high_score,0)
    );
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_uid::text,0));
  select started_at,completed_at,credited_score,active_seconds,
         last_heartbeat_at,heartbeat_active
  into v_started_at,v_completed_at,v_stored_score,v_active_seconds,
       v_last_heartbeat,v_heartbeat_active
  from public.player_progression_runs
  where run_id=p_run_id and user_id=v_uid
  for update;
  if v_started_at is null then raise exception 'Run receipt not found'; end if;

  if v_completed_at is not null then
    select metadata->'xp_breakdown'
    into v_existing_breakdown
    from public.player_progression_events
    where user_id=v_uid and source='run'
      and source_key=p_run_id::text;
    select high_score into v_high_score
    from public.player_stats where user_id=v_uid;
    return public.get_player_progression()||jsonb_build_object(
      'xp_awarded',0,
      'xp_breakdown',v_existing_breakdown,
      'high_score',coalesce(v_high_score,0)
    );
  end if;

  if coalesce(v_heartbeat_active,false) then
    v_final_increment:=least(
      6::bigint,
      greatest(
        0::bigint,
        floor(extract(epoch from(
          clock_timestamp()-coalesce(v_last_heartbeat,clock_timestamp())
        )))::bigint
      )
    );
  end if;
  v_active_seconds:=least(
    21600::bigint,
    greatest(coalesce(v_active_seconds,0),0)+v_final_increment,
    greatest(
      0::bigint,
      floor(extract(epoch from(clock_timestamp()-v_started_at)))::bigint
    )
  );
  v_score:=least(
    p_score,
    v_active_seconds*2000::bigint,
    50000000::bigint
  );

  update public.player_progression_runs
  set completed_at=now(),
      claimed_score=p_score,
      credited_score=v_score,
      active_seconds=v_active_seconds,
      heartbeat_active=false
  where run_id=p_run_id;

  select coalesce(sum(
    case
      when coalesce(event.metadata->>'gems_awarded','')~'^[0-9]{1,18}$'
        then greatest(
          1::numeric,
          least(1000000::numeric,(event.metadata->>'gems_awarded')::numeric)
        )
      else 1::numeric
    end
  ),0)::bigint into v_gem_count
  from public.player_progression_events event
  where event.user_id=v_uid and event.source='gem'
    and event.metadata->>'context_id'=p_run_id::text
    and event.metadata->>'context_type'='endless';

  v_breakdown:=app_private.endless_run_xp_breakdown(v_score,v_gem_count);
  v_xp:=(v_breakdown->>'total')::bigint;

  insert into public.player_stats(user_id,total_gems,high_score,updated_at)
  values(v_uid,0,v_score,now()) on conflict(user_id) do nothing;
  update public.player_stats
  set high_score=greatest(high_score,v_score),updated_at=now()
  where user_id=v_uid
  returning high_score into v_high_score;

  insert into public.player_progression_events(
    user_id,source,source_key,xp_awarded,metadata
  ) values(
    v_uid,'run',p_run_id::text,v_xp,
    jsonb_build_object(
      'claimed_score',p_score,
      'credited_score',v_score,
      'scope','endless',
      'active_seconds',v_active_seconds,
      'gem_count',v_gem_count,
      'xp_breakdown',v_breakdown
    )
  ) on conflict(user_id,source,source_key) do nothing
  returning id into v_inserted;

  if v_inserted is not null then
    v_progress:=app_private.apply_player_xp(v_uid,v_xp,true);
    return v_progress||jsonb_build_object(
      'xp_breakdown',v_breakdown,
      'high_score',v_high_score
    );
  end if;

  select metadata->'xp_breakdown' into v_existing_breakdown
  from public.player_progression_events
  where user_id=v_uid and source='run'
    and source_key=p_run_id::text;
  return public.get_player_progression()||jsonb_build_object(
    'xp_awarded',0,
    'xp_breakdown',v_existing_breakdown,
    'high_score',v_high_score
  );
end;
$$;

-- Update existing completed-run receipts and permanent XP totals. Missing or
-- malformed legacy metadata safely counts as one gem for that pickup.
with endless_gems as(
  select event.user_id,event.metadata->>'context_id' as context_id,
    coalesce(sum(
      case
        when coalesce(event.metadata->>'gems_awarded','')~'^[0-9]{1,18}$'
          then greatest(
            1::numeric,
            least(1000000::numeric,(event.metadata->>'gems_awarded')::numeric)
          )
        else 1::numeric
      end
    ),0)::bigint as gem_count
  from public.player_progression_events event
  where event.source='gem'
    and event.metadata->>'context_type'='endless'
    and nullif(event.metadata->>'context_id','') is not null
  group by event.user_id,event.metadata->>'context_id'
), recalculated as(
  select event.id,
    least(
      case
        when coalesce(event.metadata->>'credited_score','')~'^[0-9]{1,18}$'
          then (event.metadata->>'credited_score')::numeric
        when coalesce(event.metadata->>'claimed_score','')~'^[0-9]{1,18}$'
          then (event.metadata->>'claimed_score')::numeric
        else 0::numeric
      end,
      50000000::numeric
    ) as credited_score,
    coalesce(endless_gems.gem_count,0) as gem_count
  from public.player_progression_events event
  left join endless_gems
    on endless_gems.user_id=event.user_id
   and endless_gems.context_id=event.source_key
  where event.source='run' and event.metadata->>'scope'='endless'
), breakdowns as(
  select recalculated.id,
    app_private.endless_run_xp_breakdown(
      recalculated.credited_score::bigint,recalculated.gem_count
    ) as breakdown
  from recalculated
)
update public.player_progression_events event
set xp_awarded=(breakdowns.breakdown->>'total')::bigint,
    metadata=event.metadata||jsonb_build_object(
      'credited_score',(
        select recalculated.credited_score::bigint
        from recalculated where recalculated.id=event.id
      ),
      'gem_count',(
        select recalculated.gem_count
        from recalculated where recalculated.id=event.id
      ),
      'xp_breakdown',breakdowns.breakdown
    )
from breakdowns
where event.id=breakdowns.id;

with corrected as(
  select stats.user_id,
    coalesce(sum(event.xp_awarded),0)::bigint as lifetime_xp,
    count(*) filter(
      where event.source='run' and event.metadata->>'scope'='endless'
    )::bigint as completed_runs
  from public.player_stats stats
  left join public.player_progression_events event
    on event.user_id=stats.user_id
  group by stats.user_id
), leveled as(
  select corrected.*,
    app_private.level_for_lifetime_xp(corrected.lifetime_xp) as level
  from corrected
)
update public.player_stats stats
set lifetime_xp=leveled.lifetime_xp,
    level=leveled.level,
    xp_in_level=leveled.lifetime_xp
      -app_private.cumulative_xp_for_level(leveled.level),
    completed_runs=leveled.completed_runs,
    updated_at=now()
from leveled
where stats.user_id=leveled.user_id
  and (
    stats.lifetime_xp is distinct from leveled.lifetime_xp
    or stats.level is distinct from leveled.level
    or stats.xp_in_level is distinct from (
      leveled.lifetime_xp
      -app_private.cumulative_xp_for_level(leveled.level)
    )
    or stats.completed_runs is distinct from leveled.completed_runs
  );

update public.extraction_catalog
set passive_ability=case item_key
  when 'runner_stride' then
    'Every third lane change grants a 0.25-second dodge shield.'
  when 'runner_blitz' then
    'Can dash and destroy the first non-rock obstacle ahead. Cooldown: 10 seconds.'
  when 'medic_suture' then
    'Can reach 5 HP. Restores to full every third wave; otherwise heals 1 HP only every second wave.'
  when 'medic_beacon' then
    'Can reach 5.5 HP. At 1 HP, glows, disables spikes, and slows all obstacles by 50%.'
  else passive_ability
end
where item_key in('runner_stride','runner_blitz','medic_suture','medic_beacon')
  and item_type='character';

do $$
declare
  v_snapshot_definition text;
  v_award_definition text;
begin
  v_snapshot_definition:=pg_get_functiondef(
    to_regprocedure('app_private.one_v_one_character_snapshot(uuid,text)')
  );
  v_award_definition:=pg_get_functiondef(
    to_regprocedure('public.award_completed_run_v2(uuid,bigint,text)')
  );
  if position('medic_suture' in v_snapshot_definition)=0
     or position('medic_seraph' in v_snapshot_definition)>0
     or position('medic_oracle' in v_snapshot_definition)>0 then
    raise exception 'Healer maximum-HP correction did not install';
  end if;
  if position('metadata->>''gems_awarded''' in v_award_definition)=0 then
    raise exception 'Gem-streak XP aggregation did not install';
  end if;
  if (app_private.endless_run_xp_breakdown(0,3)->>'gems')::bigint<>300000 then
    raise exception 'Gem XP calculation is incorrect';
  end if;
end
$$;

notify pgrst,'reload schema';

commit;
