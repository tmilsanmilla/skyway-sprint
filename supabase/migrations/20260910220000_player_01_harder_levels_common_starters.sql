-- Player 01 Stats — harder level curve and consistent Common starters.
--
-- Keeps every earned XP point and unlock. Existing levels are recalculated
-- from lifetime XP against the new 2x curve, while Ace, Patch, Bulwark, and
-- Rogue are normalized to Common for current and future accounts.

begin;

do $player_01_harder_levels_prerequisites$
begin
  if to_regclass('public.player_stats') is null
     or to_regclass('public.player_unlocks') is null
     or to_regclass('public.extraction_catalog') is null
     or to_regclass('public.multiplayer_queue') is null then
    raise exception 'Run the merged Player 01 Stats query first';
  end if;
end
$player_01_harder_levels_prerequisites$;

create or replace function app_private.cumulative_xp_for_level(
  p_level integer
)
returns bigint
language sql
immutable
strict
set search_path=''
as $$
  select case
    when p_level<=0 then 0::bigint
    else (
      10000000::numeric*p_level::numeric*(p_level::numeric+1)
    )::bigint
  end;
$$;

create or replace function app_private.xp_required_for_level(
  p_level integer
)
returns bigint
language sql
immutable
strict
set search_path=''
as $$
  select 20000000::bigint*(greatest(p_level,0)::bigint+1);
$$;

create or replace function app_private.level_for_lifetime_xp(
  p_lifetime_xp bigint
)
returns integer
language sql
immutable
strict
set search_path=''
as $$
  select floor(
    (
      sqrt(
        1::numeric
        +4::numeric*greatest(p_lifetime_xp,0)::numeric/10000000::numeric
      )-1::numeric
    )/2::numeric
  )::integer;
$$;

with recalculated as (
  select
    stats.user_id,
    app_private.level_for_lifetime_xp(stats.lifetime_xp) as level,
    stats.lifetime_xp
  from public.player_stats stats
)
update public.player_stats stats
set level=recalculated.level,
    xp_in_level=recalculated.lifetime_xp
      -app_private.cumulative_xp_for_level(recalculated.level),
    updated_at=now()
from recalculated
where stats.user_id=recalculated.user_id
  and (
    stats.level is distinct from recalculated.level
    or stats.xp_in_level is distinct from (
      recalculated.lifetime_xp
      -app_private.cumulative_xp_for_level(recalculated.level)
    )
  );

-- A player whose preserved lifetime XP no longer reaches Level 20 cannot
-- remain in Ranked matchmaking. Active matches and all history stay intact.
delete from public.multiplayer_queue queue
using public.player_stats stats
where queue.user_id=stats.user_id
  and lower(coalesce(queue.mode,'casual'))='ranked'
  and stats.level<20;

update public.extraction_catalog
set rarity='common'
where item_type='character'
  and item_key in(
    'runner_ace','medic_patch','tank_bulwark','trickster_rogue'
  )
  and rarity is distinct from 'common';

insert into public.player_unlocks(
  user_id,item_key,item_type,rarity,unlocked_at
)
select users.id,starter.item_key,'character','common',now()
from auth.users users
cross join(values
  ('runner_ace'),
  ('medic_patch'),
  ('tank_bulwark'),
  ('trickster_rogue')
) starter(item_key)
on conflict(user_id,item_key) do update
set item_type='character',rarity='common';

create or replace function public.provision_player_starters()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  insert into public.player_stats(user_id,total_gems,high_score,updated_at)
  values(new.id,0,0,now()) on conflict(user_id) do nothing;
  insert into public.player_unlocks(
    user_id,item_key,item_type,rarity,unlocked_at
  )
  select new.id,starter.item_key,starter.item_type,'common',now()
  from(values
    ('runner','class'),
    ('medic','class'),
    ('tank','class'),
    ('trickster','class'),
    ('runner_ace','character'),
    ('medic_patch','character'),
    ('tank_bulwark','character'),
    ('trickster_rogue','character')
  ) starter(item_key,item_type)
  on conflict(user_id,item_key) do update
  set item_type=excluded.item_type,rarity='common';
  insert into public.player_loadouts(
    user_id,class_key,character_key,updated_at
  ) values(new.id,'runner','runner_ace',now())
  on conflict(user_id) do nothing;
  return new;
end;
$$;
revoke all on function public.provision_player_starters()
  from public,anon,authenticated;

do $player_01_harder_levels_assertions$
begin
  if app_private.cumulative_xp_for_level(0)<>0
     or app_private.cumulative_xp_for_level(1)<>20000000
     or app_private.cumulative_xp_for_level(2)<>60000000
     or app_private.cumulative_xp_for_level(20)<>4200000000
     or app_private.xp_required_for_level(0)<>20000000
     or app_private.xp_required_for_level(19)<>400000000
     or app_private.level_for_lifetime_xp(19999999)<>0
     or app_private.level_for_lifetime_xp(20000000)<>1
     or app_private.level_for_lifetime_xp(4199999999)<>19
     or app_private.level_for_lifetime_xp(4200000000)<>20 then
    raise exception 'Harder XP level curve is incorrect';
  end if;
  if exists(
    select 1
    from(values
      ('runner_ace'),
      ('medic_patch'),
      ('tank_bulwark'),
      ('trickster_rogue')
    ) starter(item_key)
    left join public.extraction_catalog catalog
      on catalog.item_key=starter.item_key
     and catalog.item_type='character'
    where catalog.item_key is null or catalog.rarity<>'common'
  ) then raise exception 'Every included starter must be Common'; end if;
  if exists(
    select 1
    from auth.users users
    cross join(values
      ('runner_ace'),
      ('medic_patch'),
      ('tank_bulwark'),
      ('trickster_rogue')
    ) starter(item_key)
    left join public.player_unlocks unlock
      on unlock.user_id=users.id
     and unlock.item_key=starter.item_key
     and unlock.item_type='character'
    where unlock.item_key is null or unlock.rarity<>'common'
  ) then raise exception 'A player is missing a Common starter'; end if;
end
$player_01_harder_levels_assertions$;

notify pgrst,'reload schema';
commit;

select
  app_private.cumulative_xp_for_level(1) as level_1_cumulative_xp,
  app_private.cumulative_xp_for_level(20) as ranked_cumulative_xp,
  (select count(*) from public.extraction_catalog
    where item_type='character'
      and item_key in(
        'runner_ace','medic_patch','tank_bulwark','trickster_rogue'
      )
      and rarity='common') as common_starter_catalog_count;
