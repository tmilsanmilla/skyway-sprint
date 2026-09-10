-- Player 01 Stats -- reported character fixes (2026-09-10).
-- Safe to rerun: catalog writes are deterministic and the snapshot function is
-- replaced in place without granting any new client permissions.

with reported_character_rules(
  item_key,
  passive_ability,
  weapon_effect
) as (values
  (
    'tank_atlas',
    'Starts at 4 HP, can reach 7 HP, and heals 1 HP after each wave. Every obstacle hit shortens Sky Crush by 0.5 seconds, to a 1-second minimum.',
    'World Maul halves obstacle damage for 2 seconds after changing lanes.'
  ),
  (
    'trickster_gambit',
    'Draws five visible cards each wave into a 10-card hand. Poker hands grant escalating one-wave and permanent HP, score, defense, revive, coin-steal, and 1v1 doubled-attack rewards, from High Card through Royal Flush.',
    'Loaded Cards stay visible between waves and enable the poker-hand rewards.'
  ),
  (
    'trickster_hex',
    'On even waves, E enters a 15-second Void Realm and can collect at most 25 Damnation per visit without advancing the wave. Void Cut phases through danger for 0.5 seconds without destroying obstacles. Hades requires 20 correctly timed rune dodges before three misses.',
    'Press R to throw Void Chakram with a 10-second cooldown, deleting one obstacle and tripling it toward the opponent in 1v1.'
  ),
  (
    'trickster_echo',
    'Completes ordered Mirror quests for six shards and selected non-mythic passives. The Knowing unlocks an 8-HP mirror phase with 80% reduction, reflected damage, shard-powered score, Mirror Realm healing, and a final reflective phase; Mirror Realm lasts 10 seconds and closes automatically.',
    'Repeat Knives channel the Mirror quests and the timed Mirror Realm.'
  ),
  (
    'misc_muse',
    'Caps the field at five obstacles and once pauses for a 15-second rhythm challenge capped at 30 hits. Its separate Muse theme and accuracy tiers unlock permanent score, slow, defense, healing music, notes, Disco Unleash, perfect revives, escalating replay challenges, and an 8-HP finale.',
    'Dream Harp powers the Muse-themed rhythm challenge and Muse Mix.'
  )
)
update public.extraction_catalog catalog
set passive_ability=rules.passive_ability,
    weapon_effect=rules.weapon_effect
from reported_character_rules rules
where catalog.item_key=rules.item_key
  and catalog.item_type='character';

-- Keep 1v1 authoritative HP aligned with Endless: Atlas begins at 4 HP on
-- every map, then the selected map's HP multiplier/bonus is applied.
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
set search_path=''
as $$
declare
  v_key text;
  v_class text;
  v_test_mode boolean:=app_private.is_admin_test_user(p_user_id);
  v_allowed text[];
  v_forced text;
  v_base_max numeric;
  v_base_start numeric;
  v_multiplier numeric;
  v_bonus numeric;
begin
  select loadout.character_key,catalog.character_class
  into v_key,v_class
  from public.player_loadouts loadout
  join public.extraction_catalog catalog
    on catalog.item_key=loadout.character_key
   and catalog.item_type='character' and catalog.active
  left join public.player_unlocks unlock
    on unlock.user_id=loadout.user_id
   and unlock.item_key=loadout.character_key
   and unlock.item_type='character'
  where loadout.user_id=p_user_id
    and (unlock.item_key is not null or v_test_mode);
  v_key:=coalesce(v_key,'runner_ace');
  v_class:=coalesce(v_class,'runner');

  select rules.allowed_character_classes,rules.forced_character_key,
         coalesce((rules.gameplay_rules->>'hp_multiplier')::numeric,1),
         coalesce((rules.gameplay_rules->>'hp_bonus')::numeric,0)
  into v_allowed,v_forced,v_multiplier,v_bonus
  from app_private.one_v_one_map_rules rules
  where rules.map_key=p_map_key;

  if not v_test_mode then
    if v_forced is not null then
      v_key:=v_forced;
      v_class:='runner';
    elsif not (v_class=any(v_allowed)) then
      v_key:='runner_ace';
      v_class:='runner';
    end if;
  end if;

  v_base_max:=case
    when v_key='tank_atlas' then 7
    when v_key='tank_colossus' then 10
    when v_key='medic_beacon' then 5.5
    when v_key='tank_guard' then 4.5
    when v_key='medic_patch' then 4
    when v_key in('medic_suture','tank_hammer') then 5
    when v_class='tank' then 4
    when v_class='trickster' then 2
    else 3
  end;
  v_base_start:=case
    when v_key='tank_atlas' then 4
    when v_class='tank' then 4
    when v_class='trickster' then 2
    else 3
  end;

  return query select v_key,v_class,
    (v_base_max*v_multiplier+v_bonus)::numeric,
    (v_base_start*v_multiplier+v_bonus)::numeric;
end;
$$;

revoke all on function app_private.one_v_one_character_snapshot(uuid,text)
  from public,anon,authenticated;
