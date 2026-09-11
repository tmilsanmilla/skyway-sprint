-- Multi-device 10 -- current 1v1 armory prices, all-map Current support, and
-- durable gradual attack delivery.
--
-- This rerunnable forward delta changes only the private map catalog and
-- executable rules. Existing multiplayer_attacks and Comet removal receipts
-- are intentionally not rewritten; legacy/natural Car rows remain valid.

begin;

do $preflight$
begin
  if to_regclass('app_private.one_v_one_map_rules') is null
     or to_regclass('public.multiplayer_attacks') is null
     or to_regclass('public.multiplayer_katana_events') is null
     or to_regprocedure(
       'app_private.one_v_one_map_rules_json(text)'
     ) is null
     or to_regprocedure(
       'app_private.next_1v1_attack_placement(uuid,uuid,uuid,text)'
     ) is null
     or to_regprocedure(
       'app_private.send_1v1_attack_without_gambit(uuid,text,integer)'
     ) is null
     or to_regprocedure(
       'app_private.update_1v1_state_unadjusted(uuid,numeric,integer,bigint,text)'
     ) is null
     or to_regprocedure(
       'public.send_1v1_attack(uuid,text,integer)'
     ) is null
     or to_regprocedure(
       'public.reflect_1v1_attack(uuid,text,text,uuid)'
     ) is null then
    raise exception 'Run the current Multi-device 06, 08, and 09 queries first';
  end if;
end;
$preflight$;

-- Preserve every map's existing snowflake and class restrictions. Car stays
-- valid in historical/natural data, but is no longer present in any armory.
update app_private.one_v_one_map_rules rules
set allowed_attacks = case rules.map_key
  when 'classic' then
    array['snowflake','log','spike','rock','barrel','current']::text[]
  when 'alley' then
    array['snowflake','log','spike','rock','barrel','current']::text[]
  when 'desert' then
    array['log','spike','rock','barrel','current']::text[]
  when 'skyway' then
    array['snowflake','log','spike','rock','barrel','current']::text[]
  when 'pitch' then
    array['snowflake','log','spike','rock','barrel','current']::text[]
  when 'volcano' then
    array['log','spike','rock','barrel','current']::text[]
  when 'factory' then
    array['snowflake','log','spike','rock','barrel','current']::text[]
  when 'grove' then
    array['log','spike','rock','barrel','current']::text[]
  else rules.allowed_attacks
end
where rules.map_key in (
  'classic','alley','desert','skyway','pitch','volcano','factory','grove'
);

alter table app_private.one_v_one_map_rules
  drop constraint if exists one_v_one_map_rules_disabled_healing_class_check;
alter table app_private.one_v_one_map_rules
  add constraint one_v_one_map_rules_disabled_healing_class_check check (
    not ('medic' = any(allowed_character_classes))
    or (
      healing_enabled
      and case
        when not (gameplay_rules ? 'healing_cap') then true
        when jsonb_typeof(gameplay_rules->'healing_cap') = 'number'
          then (gameplay_rules->>'healing_cap')::numeric > 1
        else false
      end
    )
  ) not valid;
alter table app_private.one_v_one_map_rules
  validate constraint one_v_one_map_rules_disabled_healing_class_check;

-- Current reflections need a receipt row. Keep Car in the event domain for
-- legacy and natural Pitch collisions; only armory availability removes it.
alter table public.multiplayer_katana_events
  drop constraint if exists multiplayer_katana_events_obstacle_type_check;
alter table public.multiplayer_katana_events
  add constraint multiplayer_katana_events_obstacle_type_check check (
    obstacle_type in (
      'barrel','log','car','snowflake','current','spike','rock'
    )
  ) not valid;
alter table public.multiplayer_katana_events
  validate constraint multiplayer_katana_events_obstacle_type_check;

create or replace function app_private.one_v_one_map_rules_json(p_map_key text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'map_key', rules.map_key,
    'display_name', rules.display_name,
    'lane_count', rules.lane_count,
    'obstacle_scaling', rules.obstacle_scaling,
    'healing_enabled', rules.healing_enabled,
    'coin_point_reward', rules.coin_point_reward,
    'wave_point_reward', rules.wave_point_reward,
    'allowed_attacks', to_jsonb(rules.allowed_attacks),
    'allowed_character_classes', to_jsonb(rules.allowed_character_classes),
    'forced_character_key', rules.forced_character_key,
    'natural_spawn_weights', rules.natural_spawn_weights,
    'attack_costs', jsonb_build_object(
      'snowflake', 4, 'log', 4, 'spike', 5,
      'rock', 5, 'barrel', 6, 'current', 8
    ),
    'gameplay', rules.gameplay_rules
  )
  from app_private.one_v_one_map_rules rules
  where rules.map_key = lower(trim(p_map_key));
$$;

revoke all on function app_private.one_v_one_map_rules_json(text)
  from public, anon, authenticated;

-- Patch only the placement implementation so later character/map behavior is
-- preserved. Alley uses Current on lanes 0/2; every other map uses 1..N-2.
do $placement_update$
declare
  v_definition text := pg_get_functiondef(
    'app_private.next_1v1_attack_placement(uuid,uuid,uuid,text)'::regprocedure
  );
  v_new_definition text;
begin
  if position($$No safe 1v1 escape lane$$ in v_definition) = 0 then
    v_new_definition := replace(
      v_definition,
$old$
  -- Current can occupy only lanes 1..4. Mapping a logical edge to its adjacent
  -- legal lane still pressures that edge via Current's one-damage rule. The
  -- parity metadata retains which opening the next wall must cover.
  v_chosen := case
    when p_obstacle_type = 'current' and v_logical_lane = 0 then 1
    when p_obstacle_type = 'current'
      and v_logical_lane = v_lane_count - 1 then v_lane_count - 2
    else v_logical_lane
  end;
  if p_obstacle_type = 'current' and v_chosen not between 1 and 4 then
    raise exception 'Current has no safe legal lane for this wall';
  end if;
$old$,
$new$
  -- Alley Current uses only lanes 0/2. Every other map uses its interior
  -- lanes; mapping a logical edge inward still pressures that edge through
  -- Current's adjacent-lane interaction. Wall parity remains logical so the
  -- next wall still closes the advertised opening.
  v_chosen := case
    when p_obstacle_type = 'current' and v_map_key = 'alley'
      and v_logical_lane = 1 and v_escape = 0 then 2
    when p_obstacle_type = 'current' and v_map_key = 'alley'
      and v_logical_lane = 1 then 0
    when p_obstacle_type = 'current' and v_map_key <> 'alley'
      and v_logical_lane = 0 then 1
    when p_obstacle_type = 'current' and v_map_key <> 'alley'
      and v_logical_lane = v_lane_count - 1 then v_lane_count - 2
    else v_logical_lane
  end;
  if p_obstacle_type = 'current' and (
       (v_map_key = 'alley' and v_chosen not in (0, 2))
       or (v_map_key <> 'alley'
           and v_chosen not between 1 and v_lane_count - 2)
     ) then
    raise exception 'Current has no safe legal lane for this wall';
  end if;

  -- The advertised escape must itself have no Current interaction. Alley uses
  -- its opposite edge; every wider map chooses the nearest lane at least two
  -- positions away from the remapped Current lane.
  if p_obstacle_type = 'current' then
    if v_map_key = 'alley' then
      v_escape := case when v_chosen = 0 then 2 else 0 end;
    else
      select candidate.lane into v_escape
      from generate_series(0, v_lane_count - 1) candidate(lane)
      where abs(candidate.lane - v_chosen) > 1
      order by
        abs(candidate.lane - coalesce(v_escape, v_target_lane, candidate.lane)),
        candidate.lane
      limit 1;
    end if;
    if v_escape is null then
      raise exception 'Current has no non-contact escape lane';
    end if;
  end if;

  -- Revalidate every row because a Current can rewrite the group's escape and
  -- a later legacy wall member can otherwise inherit its own occupied lane.
  if v_escape = v_chosen then
    select candidate.lane into v_escape
    from generate_series(0, v_lane_count - 1) candidate(lane)
    where candidate.lane <> v_chosen
    order by
      case when mod(candidate.lane, 2) <> v_parity then 0 else 1 end,
      abs(candidate.lane - coalesce(v_target_lane, candidate.lane)),
      candidate.lane
    limit 1;
  end if;
  if v_escape is null or v_escape = v_chosen then
    raise exception 'No safe 1v1 escape lane';
  end if;
$new$
    );
    if v_new_definition = v_definition then
      raise exception 'Could not update Current attack placement safely';
    end if;
    execute v_new_definition;
  end if;
end;
$placement_update$;

revoke all on function app_private.next_1v1_attack_placement(
  uuid, uuid, uuid, text
) from public, anon, authenticated;

-- Slow delivery may intentionally carry a late purchase past a wave boundary.
-- Patch the preserved state delegate so only exact client acknowledgements
-- mark attack receipts delivered; reconnects therefore see the same queue.
do $durable_delivery_update$
declare
  v_definition text := pg_get_functiondef(
    'app_private.update_1v1_state_unadjusted(uuid,numeric,integer,bigint,text)'::regprocedure
  );
  v_new_definition text;
begin
  if position($$spawn_wave < p_wave$$ in v_definition) > 0 then
    v_new_definition := replace(
      v_definition,
$old$
  if p_status = 'intermission' then
    update public.multiplayer_attacks
    set delivered_at = v_now
    where match_id = p_match_id
      and target_user_id = v_uid
      and delivered_at is null
      and spawn_wave < p_wave;
  end if;
$old$,
$new$
  -- Incoming attacks are delivered only when the client acknowledges their
  -- exact ids. Never bulk-expire a slow trickle at the wave boundary; queued
  -- attacks remain durable through a reconnect or the following wave.
$new$
    );
    if v_new_definition = v_definition
       or position($$spawn_wave < p_wave$$ in v_new_definition) > 0 then
      raise exception 'Could not preserve queued 1v1 attacks across waves';
    end if;
    execute v_new_definition;
  end if;
end;
$durable_delivery_update$;

revoke all on function app_private.update_1v1_state_unadjusted(
  uuid, numeric, integer, bigint, text
) from public, anon, authenticated;

-- Update the Comet/Mirage sender that Gambit delegates to. The public Gambit
-- wrapper itself is deliberately not replaced.
do $sender_update$
declare
  v_definition text := pg_get_functiondef(
    'app_private.send_1v1_attack_without_gambit(uuid,text,integer)'::regprocedure
  );
  v_new_definition text;
begin
  if position($$when 'snowflake' then 4$$ in v_definition) = 0
     or position($$when 'log' then 4$$ in v_definition) = 0
     or position($$when 'spike' then 5$$ in v_definition) = 0
     or position($$when 'rock' then 5$$ in v_definition) = 0
     or position($$when 'barrel' then 6$$ in v_definition) = 0
     or position($$when 'current' then 8$$ in v_definition) = 0
     or position($$when 'car' then$$ in v_definition) > 0 then
    v_new_definition := v_definition;
    v_new_definition := regexp_replace(
      v_new_definition, $$when 'snowflake' then 7$$,
      $$when 'snowflake' then 4$$, 'g'
    );
    v_new_definition := regexp_replace(
      v_new_definition, $$when 'log' then 6$$,
      $$when 'log' then 4$$, 'g'
    );
    v_new_definition := regexp_replace(
      v_new_definition, $$when 'spike' then 8$$,
      $$when 'spike' then 5$$, 'g'
    );
    v_new_definition := regexp_replace(
      v_new_definition, $$when 'rock' then 8$$,
      $$when 'rock' then 5$$, 'g'
    );
    v_new_definition := regexp_replace(
      v_new_definition, $$when 'current' then 7$$,
      $$when 'current' then 8$$, 'g'
    );
    v_new_definition := regexp_replace(
      v_new_definition, E'[ \\t]*when ''car'' then 8\\r?\\n', '', 'g'
    );
    if v_new_definition = v_definition
       or position($$when 'snowflake' then 4$$ in v_new_definition) = 0
       or position($$when 'log' then 4$$ in v_new_definition) = 0
       or position($$when 'spike' then 5$$ in v_new_definition) = 0
       or position($$when 'rock' then 5$$ in v_new_definition) = 0
       or position($$when 'barrel' then 6$$ in v_new_definition) = 0
       or position($$when 'current' then 8$$ in v_new_definition) = 0
       or position($$when 'car' then$$ in v_new_definition) > 0 then
      raise exception 'Could not install the current server-owned armory costs';
    end if;
    execute v_new_definition;
  end if;
end;
$sender_update$;

revoke all on function app_private.send_1v1_attack_without_gambit(
  uuid, text, integer
) from public, anon, authenticated;

-- Current is never natural on Pitch, but a purchased incoming Current may be
-- reflected. Keep Car here for legacy/natural katana collisions and history.
do $reflection_update$
declare
  v_definition text := pg_get_functiondef(
    'public.reflect_1v1_attack(uuid,text,text,uuid)'::regprocedure
  );
  v_new_definition text;
begin
  if position($$'snowflake', 'current', 'spike'$$ in v_definition) = 0 then
    v_new_definition := replace(
      v_definition,
      $$if v_type not in ('barrel', 'log', 'car', 'snowflake', 'spike', 'rock') then$$,
      $$if v_type not in (
    'barrel', 'log', 'car', 'snowflake', 'current', 'spike', 'rock'
  ) then$$
    );
    if v_new_definition = v_definition then
      raise exception 'Could not enable Pitch Current reflection';
    end if;
    execute v_new_definition;
  end if;
end;
$reflection_update$;

revoke all on function public.reflect_1v1_attack(uuid, text, text, uuid)
  from public, anon, authenticated;
revoke all on function public.reflect_1v1_attack(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.reflect_1v1_attack(uuid, text, text, uuid)
  to authenticated;
grant execute on function public.reflect_1v1_attack(uuid, text, text)
  to authenticated;

-- Preserve the latest Gambit public wrapper and its existing authenticated API.
revoke all on function public.send_1v1_attack(uuid, text, integer)
  from public, anon, authenticated;
grant execute on function public.send_1v1_attack(uuid, text, integer)
  to authenticated;

do $installation_assertions$
declare
  v_sender_definition text := pg_get_functiondef(
    'app_private.send_1v1_attack_without_gambit(uuid,text,integer)'::regprocedure
  );
  v_wrapper_definition text := pg_get_functiondef(
    'public.send_1v1_attack(uuid,text,integer)'::regprocedure
  );
  v_placement_definition text := pg_get_functiondef(
    'app_private.next_1v1_attack_placement(uuid,uuid,uuid,text)'::regprocedure
  );
  v_reflection_definition text := pg_get_functiondef(
    'public.reflect_1v1_attack(uuid,text,text,uuid)'::regprocedure
  );
  v_state_delegate_definition text := pg_get_functiondef(
    'app_private.update_1v1_state_unadjusted(uuid,numeric,integer,bigint,text)'::regprocedure
  );
begin
  if (select count(*) from app_private.one_v_one_map_rules) <> 8
     or exists (
       select 1 from app_private.one_v_one_map_rules rules
       where not ('current' = any(rules.allowed_attacks))
          or 'car' = any(rules.allowed_attacks)
     ) then
    raise exception 'Every 1v1 armory must expose Current and exclude Car';
  end if;
  if not exists (
       select 1 from app_private.one_v_one_map_rules rules
       where rules.map_key = 'skyway'
         and rules.natural_spawn_weights ? 'current'
     )
     or exists (
       select 1 from app_private.one_v_one_map_rules rules
       where rules.map_key <> 'skyway'
         and rules.natural_spawn_weights ? 'current'
     ) then
    raise exception 'Current must be natural only on Skyway';
  end if;
  if not exists (
       select 1 from app_private.one_v_one_map_rules rules
       where rules.map_key = 'factory'
         and rules.natural_spawn_weights ? 'car'
     ) then
    raise exception 'Natural Car compatibility was not preserved';
  end if;
  if exists (
       select 1 from app_private.one_v_one_map_rules rules
       where not rules.healing_enabled
         and 'medic' = any(rules.allowed_character_classes)
     )
     or exists (
       select 1 from app_private.one_v_one_map_rules rules
       where 'medic' = any(rules.allowed_character_classes)
         and rules.gameplay_rules ? 'healing_cap'
         and case
           when jsonb_typeof(rules.gameplay_rules->'healing_cap') = 'number'
             then (rules.gameplay_rules->>'healing_cap')::numeric <= 1
           else true
         end
     ) then
    raise exception '1v1 healing rules are inconsistent';
  end if;
  if position($$when 'snowflake' then 4$$ in v_sender_definition) = 0
     or position($$when 'log' then 4$$ in v_sender_definition) = 0
     or position($$when 'spike' then 5$$ in v_sender_definition) = 0
     or position($$when 'rock' then 5$$ in v_sender_definition) = 0
     or position($$when 'barrel' then 6$$ in v_sender_definition) = 0
     or position($$when 'current' then 8$$ in v_sender_definition) = 0
     or position($$when 'car' then$$ in v_sender_definition) > 0 then
    raise exception 'The server-authoritative armory costs are incomplete';
  end if;
  if position(
       $$app_private.send_1v1_attack_without_gambit$$ in v_wrapper_definition
     ) = 0
     or position(
       $$reward.best_hand = 'straight-flush'$$ in v_wrapper_definition
     ) = 0 then
    raise exception 'The latest Gambit public sender wrapper was not preserved';
  end if;
  if position($$v_map_key = 'alley'$$ in v_placement_definition) = 0
     or position($$v_map_key <> 'alley'$$ in v_placement_definition) = 0
     or position($$v_lane_count - 2$$ in v_placement_definition) = 0
     or position(
       $$Current has no non-contact escape lane$$ in v_placement_definition
     ) = 0
     or position(
       $$No safe 1v1 escape lane$$ in v_placement_definition
     ) = 0 then
    raise exception 'Current lane-count placement rules are incomplete';
  end if;
  if position(
       $$'snowflake', 'current', 'spike'$$ in v_reflection_definition
     ) = 0 then
    raise exception 'Pitch Current reflection is missing';
  end if;
  if position($$spawn_wave < p_wave$$ in v_state_delegate_definition) > 0
     or position(
       $$exact ids$$ in v_state_delegate_definition
     ) = 0 then
    raise exception 'Queued attack delivery is not durable across waves';
  end if;
  if not exists (
       select 1 from pg_constraint constraint_row
       where constraint_row.conrelid =
             'public.multiplayer_katana_events'::regclass
         and constraint_row.conname =
             'multiplayer_katana_events_obstacle_type_check'
         and position(
           $$'current'::text$$ in pg_get_constraintdef(constraint_row.oid)
         ) > 0
         and position(
           $$'car'::text$$ in pg_get_constraintdef(constraint_row.oid)
         ) > 0
     ) then
    raise exception 'Katana event compatibility constraint is incomplete';
  end if;
  if has_function_privilege(
       'authenticated',
       'app_private.send_1v1_attack_without_gambit(uuid,text,integer)',
       'EXECUTE'
     )
     or has_function_privilege(
       'authenticated',
       'app_private.next_1v1_attack_placement(uuid,uuid,uuid,text)',
       'EXECUTE'
     )
     or not has_function_privilege(
       'authenticated', 'public.send_1v1_attack(uuid,text,integer)', 'EXECUTE'
     )
     or has_function_privilege(
       'anon', 'public.send_1v1_attack(uuid,text,integer)', 'EXECUTE'
     )
     or not has_function_privilege(
       'authenticated',
       'public.reflect_1v1_attack(uuid,text,text,uuid)', 'EXECUTE'
     )
     or has_function_privilege(
       'anon', 'public.reflect_1v1_attack(uuid,text,text,uuid)', 'EXECUTE'
     ) then
    raise exception '1v1 armory function permissions are unsafe';
  end if;
end;
$installation_assertions$;

notify pgrst, 'reload schema';
commit;

select
  not exists (
    select 1 from app_private.one_v_one_map_rules rules
    where 'car' = any(rules.allowed_attacks)
       or not ('current' = any(rules.allowed_attacks))
  ) as armories_current_without_car,
  position(
    $$when 'snowflake' then 4$$ in pg_get_functiondef(
      'app_private.send_1v1_attack_without_gambit(uuid,text,integer)'::regprocedure
    )
  ) > 0 as canonical_costs_installed,
  position(
    $$app_private.send_1v1_attack_without_gambit$$ in pg_get_functiondef(
      'public.send_1v1_attack(uuid,text,integer)'::regprocedure
    )
  ) > 0 as gambit_wrapper_preserved;
