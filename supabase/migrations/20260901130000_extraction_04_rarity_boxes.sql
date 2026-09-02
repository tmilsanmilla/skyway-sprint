-- Extraction 04 Rarity Boxes
--
-- Regular boxes cost 2 gems, can roll duplicates, and never grant a second
-- copy. Legendary boxes cost 20 gems and always grant an unowned catalog item.
-- Both box types make one pull at a time. All ownership and gem changes happen
-- in one locked transaction scoped to auth.uid().

-- Expand the existing unlock contract without replacing any owned items.
alter table public.player_unlocks
  drop constraint if exists player_unlocks_item_type_check;

alter table public.player_unlocks
  add constraint player_unlocks_item_type_check
  check (item_type in ('class', 'character', 'player', 'obstacle', 'environment'));

alter table public.player_unlocks
  drop constraint if exists player_unlocks_rarity_check;

alter table public.player_unlocks
  add constraint player_unlocks_rarity_check
  check (rarity in ('common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'));

-- Catalog metadata is server-owned. Cosmetics are deliberately visual-only;
-- there are no gameplay/stat columns in this table.
create table public.extraction_catalog (
  item_key text primary key,
  display_name text not null,
  item_type text not null
    check (item_type in ('character', 'player', 'obstacle', 'environment')),
  rarity text not null
    check (rarity in ('common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic')),
  character_class text,
  extractable boolean not null default true,
  active boolean not null default true,
  constraint extraction_catalog_character_class_check check (
    (item_type = 'character'
      and character_class is not null
      and character_class in ('runner', 'medic', 'tank', 'trickster'))
    or (item_type <> 'character' and character_class is null)
  )
);

comment on table public.extraction_catalog is
  'Server-owned extraction pool. Cosmetics are appearance-only; character_class controls loadout compatibility.';

alter table public.extraction_catalog enable row level security;
revoke all on table public.extraction_catalog from public, anon, authenticated;
grant select on table public.extraction_catalog to authenticated;

create policy "Authenticated players read extraction catalog"
on public.extraction_catalog
for select
to authenticated
using (active);

-- One free starter plus eleven separately owned roster characters. Every
-- rarity has at least one extractable character.
insert into public.extraction_catalog (
  item_key, display_name, item_type, rarity, character_class, extractable
) values
  ('runner_ace', 'Ace', 'character', 'common', 'runner', false),
  ('runner_scout', 'Scout', 'character', 'common', 'runner', true),
  ('runner_ranger', 'Ranger', 'character', 'uncommon', 'runner', true),
  ('medic_patch', 'Patch', 'character', 'common', 'medic', true),
  ('medic_mercy', 'Mercy', 'character', 'rare', 'medic', true),
  ('medic_vial', 'Vial', 'character', 'epic', 'medic', true),
  ('tank_bulwark', 'Bulwark', 'character', 'common', 'tank', true),
  ('tank_hammer', 'Hammer', 'character', 'rare', 'tank', true),
  ('tank_sentinel', 'Sentinel', 'character', 'legendary', 'tank', true),
  ('trickster_rogue', 'Rogue', 'character', 'uncommon', 'trickster', true),
  ('trickster_jester', 'Jester', 'character', 'epic', 'trickster', true),
  ('trickster_phantom', 'Phantom', 'character', 'mythic', 'trickster', true);

-- Cosmetic keys include every item from the original extraction pool and a
-- larger visual-only collection. Every cosmetic slot and rarity is represented.
insert into public.extraction_catalog (
  item_key, display_name, item_type, rarity
) values
  ('red_runner', 'Red Runner', 'player', 'common'),
  ('blue_runner', 'Blue Runner', 'player', 'common'),
  ('gold_runner', 'Gold Runner', 'player', 'common'),
  ('pixel_cap', 'Pixel Cap', 'player', 'uncommon'),
  ('mint_scarf', 'Mint Scarf', 'player', 'uncommon'),
  ('comet_cape', 'Comet Cape', 'player', 'rare'),
  ('royal_runner', 'Royal Runner', 'player', 'epic'),
  ('void_runner', 'Void Runner', 'player', 'legendary'),
  ('starforged_runner', 'Starforged Runner', 'player', 'legendary'),
  ('celestial_runner', 'Celestial Runner', 'player', 'mythic'),

  ('cardboard_obstacles', 'Cardboard Obstacles', 'obstacle', 'common'),
  ('candy_obstacles', 'Candy Obstacles', 'obstacle', 'common'),
  ('copper_obstacles', 'Copper Obstacles', 'obstacle', 'uncommon'),
  ('ice_obstacles', 'Ice Obstacles', 'obstacle', 'rare'),
  ('neon_obstacles', 'Neon Obstacles', 'obstacle', 'rare'),
  ('rust_obstacles', 'Rust Obstacles', 'obstacle', 'rare'),
  ('hologram_obstacles', 'Hologram Obstacles', 'obstacle', 'epic'),
  ('dragon_obstacles', 'Dragon Obstacles', 'obstacle', 'legendary'),
  ('cosmic_obstacles', 'Cosmic Obstacles', 'obstacle', 'mythic'),

  ('meadow_map', 'Meadow Map', 'environment', 'common'),
  ('city_map', 'City Map', 'environment', 'common'),
  ('rain_map', 'Rain Map', 'environment', 'uncommon'),
  ('ocean_map', 'Ocean Map', 'environment', 'rare'),
  ('cave_map', 'Cave Map', 'environment', 'epic'),
  ('sunset_map', 'Sunset Map', 'environment', 'epic'),
  ('snow_map', 'Snow Map', 'environment', 'epic'),
  ('aurora_map', 'Aurora Map', 'environment', 'legendary'),
  ('starlight_map', 'Starlight Map', 'environment', 'mythic');

-- Before this migration, all three avatars were free after a non-runner class
-- was extracted. Preserve that access by granting its full roster to legacy
-- class owners.
insert into public.player_unlocks (
  user_id, item_key, item_type, rarity, unlocked_at
)
select
  legacy.user_id,
  catalog.item_key,
  'character',
  catalog.rarity,
  legacy.unlocked_at
from public.player_unlocks legacy
join public.extraction_catalog catalog
  on catalog.item_type = 'character'
 and catalog.character_class = legacy.item_key
 and catalog.extractable
where legacy.item_type = 'class'
  and legacy.item_key in ('medic', 'tank', 'trickster')
on conflict (user_id, item_key) do nothing;

-- Runner Scout and Ranger were previously free choices. Grandfather them for
-- every account that already created a loadout.
insert into public.player_unlocks (
  user_id, item_key, item_type, rarity, unlocked_at
)
select
  loadout.user_id,
  catalog.item_key,
  'character',
  catalog.rarity,
  loadout.updated_at
from public.player_loadouts loadout
cross join public.extraction_catalog catalog
where catalog.item_key in ('runner_scout', 'runner_ranger')
on conflict (user_id, item_key) do nothing;

-- Preserve any selected character even if historical data is missing the
-- corresponding class row.
insert into public.player_unlocks (
  user_id, item_key, item_type, rarity, unlocked_at
)
select
  loadout.user_id,
  catalog.item_key,
  'character',
  catalog.rarity,
  loadout.updated_at
from public.player_loadouts loadout
join public.extraction_catalog catalog
  on catalog.item_key = loadout.character_key
 and catalog.item_type = 'character'
where catalog.item_key <> 'runner_ace'
on conflict (user_id, item_key) do nothing;

-- Individual character ownership is now enforced. Owning any character in a
-- non-runner class unlocks that class; historical class unlock rows continue
-- to work. Changing class selects an already-owned compatible character.
create or replace function public.set_loadout(p_slot text, p_item text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_slot text := lower(trim(p_slot));
  v_item text := lower(trim(p_item));
  v_required_class text;
  v_current_class text;
  v_current_character text;
  v_next_character text;
begin
  if v_uid is null then
    raise exception 'Sign in required';
  end if;
  if v_slot not in ('class', 'character', 'player', 'obstacle', 'environment') then
    raise exception 'Invalid loadout slot';
  end if;
  if v_item is null or v_item = '' then
    raise exception 'Invalid loadout item';
  end if;

  insert into public.player_loadouts(user_id)
  values (v_uid)
  on conflict (user_id) do nothing;

  select class_key, character_key
  into v_current_class, v_current_character
  from public.player_loadouts
  where user_id = v_uid;

  if v_slot = 'class' then
    if v_item not in ('runner', 'medic', 'tank', 'trickster') then
      raise exception 'Invalid class';
    end if;

    if v_item <> 'runner'
       and not exists (
         select 1
         from public.player_unlocks unlock
         where unlock.user_id = v_uid
           and unlock.item_type = 'class'
           and unlock.item_key = v_item
       )
       and not exists (
         select 1
         from public.player_unlocks unlock
         join public.extraction_catalog catalog
           on catalog.item_key = unlock.item_key
          and catalog.item_type = 'character'
          and catalog.character_class = v_item
         where unlock.user_id = v_uid
           and unlock.item_type = 'character'
       ) then
      raise exception 'Class is not unlocked';
    end if;

    if v_item = 'runner' then
      if v_current_class = 'runner'
         and (
           v_current_character = 'runner_ace'
           or exists (
             select 1
             from public.player_unlocks unlock
             join public.extraction_catalog catalog
               on catalog.item_key = unlock.item_key
              and catalog.item_type = 'character'
              and catalog.character_class = 'runner'
             where unlock.user_id = v_uid
               and unlock.item_type = 'character'
               and unlock.item_key = v_current_character
           )
         ) then
        v_next_character := v_current_character;
      else
        v_next_character := 'runner_ace';
      end if;
    else
      if v_current_class = v_item
         and exists (
           select 1
           from public.player_unlocks unlock
           join public.extraction_catalog catalog
             on catalog.item_key = unlock.item_key
            and catalog.item_type = 'character'
            and catalog.character_class = v_item
           where unlock.user_id = v_uid
             and unlock.item_type = 'character'
             and unlock.item_key = v_current_character
         ) then
        v_next_character := v_current_character;
      else
        select unlock.item_key
        into v_next_character
        from public.player_unlocks unlock
        join public.extraction_catalog catalog
          on catalog.item_key = unlock.item_key
         and catalog.item_type = 'character'
         and catalog.character_class = v_item
        where unlock.user_id = v_uid
          and unlock.item_type = 'character'
        order by unlock.unlocked_at, unlock.item_key
        limit 1;
      end if;

      if v_next_character is null then
        raise exception 'No owned character is available for this class';
      end if;
    end if;

    update public.player_loadouts
    set class_key = v_item,
        character_key = v_next_character,
        updated_at = now()
    where user_id = v_uid;
    return;
  end if;

  if v_slot = 'character' then
    select catalog.character_class
    into v_required_class
    from public.extraction_catalog catalog
    where catalog.item_key = v_item
      and catalog.item_type = 'character'
      and catalog.active;

    if v_required_class is null then
      raise exception 'Invalid character';
    end if;
    if v_item <> 'runner_ace'
       and not exists (
         select 1
         from public.player_unlocks unlock
         where unlock.user_id = v_uid
           and unlock.item_key = v_item
           and unlock.item_type = 'character'
       ) then
      raise exception 'Character is not unlocked';
    end if;
    if v_current_class <> v_required_class then
      raise exception 'Character does not belong to the selected class';
    end if;

    update public.player_loadouts
    set character_key = v_item,
        updated_at = now()
    where user_id = v_uid;
    return;
  end if;

  if not exists (
    select 1
    from public.player_unlocks unlock
    where unlock.user_id = v_uid
      and unlock.item_key = v_item
      and unlock.item_type = v_slot
  ) then
    raise exception 'Item is not unlocked for this slot';
  end if;

  update public.player_loadouts
  set player_cosmetic = case when v_slot = 'player' then v_item else player_cosmetic end,
      obstacle_cosmetic = case when v_slot = 'obstacle' then v_item else obstacle_cosmetic end,
      environment_cosmetic = case when v_slot = 'environment' then v_item else environment_cosmetic end,
      updated_at = now()
  where user_id = v_uid;
end;
$$;

-- Replace the old 1-or-10 pull RPC with a one-pull RPC. Keeping pull_count as
-- the first named argument lets already-open clients make regular single pulls;
-- box_type selects the new legendary box.
drop function if exists public.extract_items(integer);
drop function if exists public.extract_items(integer, text);

create function public.extract_items(
  pull_count integer,
  box_type text default 'regular'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_box text := lower(trim(coalesce(box_type, '')));
  v_cost integer;
  v_gems bigint;
  v_category text;
  v_rarity text;
  v_item_key text;
  v_item_type text;
  v_display_name text;
  v_character_class text;
  v_is_unique boolean;
  v_is_new boolean;
  v_inserted integer;
begin
  if v_uid is null then
    raise exception 'Sign in required';
  end if;
  if pull_count <> 1 then
    raise exception 'Only single-item boxes are available';
  end if;
  if v_box not in ('regular', 'legendary') then
    raise exception 'Box type must be regular or legendary';
  end if;

  v_cost := case when v_box = 'legendary' then 20 else 2 end;
  v_is_unique := v_box = 'legendary';

  insert into public.player_stats(user_id, total_gems, high_score, updated_at)
  values (v_uid, 0, 0, now())
  on conflict (user_id) do nothing;

  -- Serialize extractions for this account so simultaneous requests cannot
  -- spend the same gems or grant a duplicate from a guaranteed-unique box.
  select stats.total_gems
  into v_gems
  from public.player_stats stats
  where stats.user_id = v_uid
  for update;

  if v_is_unique and not exists (
    select 1
    from public.extraction_catalog catalog
    where catalog.active
      and catalog.extractable
      and not exists (
        select 1
        from public.player_unlocks unlock
        where unlock.user_id = v_uid
          and unlock.item_key = catalog.item_key
      )
  ) then
    raise exception 'Collection complete: every extraction item is already owned';
  end if;

  if v_gems < v_cost then
    raise exception 'Not enough gems';
  end if;

  update public.player_stats
  set total_gems = total_gems - v_cost,
      updated_at = now()
  where user_id = v_uid
  returning total_gems into v_gems;

  -- Character/cosmetic category chance is evaluated before rarity. If a
  -- guaranteed box has exhausted its selected category, use the other category
  -- so the paid pull is still guaranteed to be new.
  v_category := case
    when random() < case when v_box = 'legendary' then 0.20 else 0.05 end
      then 'character'
    else 'cosmetic'
  end;

  if not exists (
    select 1
    from public.extraction_catalog catalog
    where catalog.active
      and catalog.extractable
      and (
        (v_category = 'character' and catalog.item_type = 'character')
        or (v_category = 'cosmetic' and catalog.item_type <> 'character')
      )
      and (
        not v_is_unique
        or not exists (
          select 1
          from public.player_unlocks unlock
          where unlock.user_id = v_uid
            and unlock.item_key = catalog.item_key
        )
      )
  ) then
    v_category := case when v_category = 'character' then 'cosmetic' else 'character' end;
  end if;

  -- The requested regular values total 100.36, so they are treated as relative
  -- weights and normalized by this draw. Legendary weights total exactly 100.
  -- For guaranteed boxes, exhausted rarity tiers are removed and the remaining
  -- requested weights are normalized, ensuring the result is always unowned.
  with weights(rarity, weight, sort_order) as (
    values
      ('common',    case when v_box = 'legendary' then  3.00 else 45.75 end::numeric, 1),
      ('uncommon',  case when v_box = 'legendary' then 12.00 else 30.20 end::numeric, 2),
      ('rare',      case when v_box = 'legendary' then 40.30 else 15.40 end::numeric, 3),
      ('epic',      case when v_box = 'legendary' then 41.50 else  8.00 end::numeric, 4),
      ('legendary', case when v_box = 'legendary' then  3.00 else  1.00 end::numeric, 5),
      ('mythic',    case when v_box = 'legendary' then  0.20 else  0.01 end::numeric, 6)
  ),
  available as (
    select weights.rarity, weights.weight, weights.sort_order
    from weights
    where exists (
      select 1
      from public.extraction_catalog catalog
      where catalog.active
        and catalog.extractable
        and catalog.rarity = weights.rarity
        and (
          (v_category = 'character' and catalog.item_type = 'character')
          or (v_category = 'cosmetic' and catalog.item_type <> 'character')
        )
        and (
          not v_is_unique
          or not exists (
            select 1
            from public.player_unlocks unlock
            where unlock.user_id = v_uid
              and unlock.item_key = catalog.item_key
          )
        )
    )
  ),
  total as (
    select sum(available.weight) as weight
    from available
  ),
  draw as (
    select random() * total.weight::double precision as value
    from total
  ),
  cumulative as (
    select
      available.rarity,
      available.sort_order,
      sum(available.weight) over (order by available.sort_order)::double precision as ceiling
    from available
  )
  select cumulative.rarity
  into v_rarity
  from cumulative
  cross join draw
  where draw.value < cumulative.ceiling
  order by cumulative.sort_order
  limit 1;

  if v_rarity is null then
    raise exception 'No extraction item is available for this box';
  end if;

  select
    catalog.item_key,
    catalog.item_type,
    catalog.display_name,
    catalog.character_class
  into
    v_item_key,
    v_item_type,
    v_display_name,
    v_character_class
  from public.extraction_catalog catalog
  where catalog.active
    and catalog.extractable
    and catalog.rarity = v_rarity
    and (
      (v_category = 'character' and catalog.item_type = 'character')
      or (v_category = 'cosmetic' and catalog.item_type <> 'character')
    )
    and (
      not v_is_unique
      or not exists (
        select 1
        from public.player_unlocks unlock
        where unlock.user_id = v_uid
          and unlock.item_key = catalog.item_key
      )
    )
  order by random()
  limit 1;

  if v_item_key is null then
    raise exception 'No extraction item is available for this rarity';
  end if;

  insert into public.player_unlocks(
    user_id, item_key, item_type, rarity, unlocked_at
  ) values (
    v_uid, v_item_key, v_item_type, v_rarity, now()
  )
  on conflict (user_id, item_key) do nothing;

  get diagnostics v_inserted = row_count;
  v_is_new := v_inserted = 1;

  if v_is_unique and not v_is_new then
    -- The account row lock makes this unreachable through the RPC, but retain
    -- the assertion so a guaranteed box can never silently return a duplicate.
    raise exception 'Guaranteed extraction could not grant a unique item';
  end if;

  return jsonb_build_object(
    'box_type', v_box,
    'cost', v_cost,
    'gems', v_gems,
    'results', jsonb_build_array(jsonb_build_object(
      'item_key', v_item_key,
      'display_name', v_display_name,
      'item_type', v_item_type,
      'category', v_category,
      'character_class', v_character_class,
      'rarity', v_rarity,
      'is_new', v_is_new
    ))
  );
end;
$$;

revoke all on function public.set_loadout(text, text) from public, anon;
revoke all on function public.extract_items(integer, text) from public, anon;
grant execute on function public.set_loadout(text, text) to authenticated;
grant execute on function public.extract_items(integer, text) to authenticated;

notify pgrst, 'reload schema';
