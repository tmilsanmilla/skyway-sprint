-- Player 01 Stats — merged 80-character catalog
-- Adds the 32 balanced kits missing from the live extraction pool. This is an
-- idempotent forward migration; it grants no ownership and preserves the four
-- starter characters as the only non-extractable kits.

begin;

do $$
begin
  if to_regclass('public.extraction_catalog') is null
     or to_regclass('public.player_unlocks') is null
     or to_regclass('public.player_loadouts') is null
     or to_regprocedure('public.extract_items(integer,text)') is null
     or not exists (
       select 1 from information_schema.columns
       where table_schema='public' and table_name='extraction_catalog'
         and column_name='weapon_name'
     )
     or not exists (
       select 1 from information_schema.columns
       where table_schema='public' and table_name='extraction_catalog'
         and column_name='weapon_score_bonus'
     ) then
    raise exception 'Run the canonical Player 01 Stats query before this migration';
  end if;
end
$$;

create temporary table player_01_new_character_kits(
  item_key text primary key,
  display_name text not null,
  rarity text not null,
  character_class text not null,
  weapon_name text not null,
  weapon_score_bonus numeric(6,4) not null
) on commit drop;

insert into player_01_new_character_kits values
  ('runner_dash','Dash','common','runner','Jet Baton',.03),
  ('runner_stride','Stride','common','runner','Pace Blades',.03),
  ('runner_courier','Courier','uncommon','runner','Parcel Staff',.04),
  ('runner_tempo','Tempo','uncommon','runner','Rhythm Rod',.04),
  ('runner_vector','Vector','rare','runner','Arrow Lance',.05),
  ('runner_blitz','Blitz','rare','runner','Volt Cleats',.05),
  ('runner_horizon','Horizon','epic','runner','Skyline Disc',.06),
  ('runner_velocity','Velocity','legendary','runner','Turbo Spear',.07),
  ('runner_zenith','Zenith','mythic','runner','Apex Relay',.08),
  ('medic_salve','Salve','common','medic','Remedy Brush',.03),
  ('medic_sprout','Sprout','uncommon','medic','Seed Scepter',.04),
  ('medic_tonic','Tonic','rare','medic','Vital Flask',.05),
  ('medic_beacon','Beacon','epic','medic','Rescue Lamp',.06),
  ('medic_revive','Revive','legendary','medic','Phoenix Needle',.07),
  ('medic_oracle','Oracle','mythic','medic','Fate Censer',.08),
  ('tank_guard','Guard','common','tank','Iron Buckler',.03),
  ('tank_ironclad','Ironclad','uncommon','tank','Plate Hammer',.04),
  ('tank_warden','Warden','rare','tank','Lock Shield',.05),
  ('tank_citadel','Citadel','epic','tank','Rampart Axe',.06),
  ('tank_colossus','Colossus','legendary','tank','Titan Maul',.07),
  ('trickster_echo','Echo','mythic','trickster','Repeat Knives',.08),
  ('misc_nomad','Nomad','common','misc','Trail Hook',.03),
  ('misc_tinker','Tinker','common','misc','Gear Wrench',.03),
  ('misc_broker','Broker','uncommon','misc','Coin Cane',.04),
  ('misc_prospector','Prospector','uncommon','misc','Gem Pick',.04),
  ('misc_lantern','Lantern','uncommon','misc','Glow Rod',.04),
  ('misc_scribe','Scribe','rare','misc','Rune Quill',.05),
  ('misc_weaver','Weaver','rare','misc','Thread Blades',.05),
  ('misc_mimic','Mimic','epic','misc','Copy Mask',.06),
  ('misc_catalyst','Catalyst','epic','misc','Flux Vial',.06),
  ('misc_harvester','Harvester','legendary','misc','Crescent Sickle',.07),
  ('misc_muse','Muse','mythic','misc','Dream Harp',.08);

insert into public.extraction_catalog(
  item_key,display_name,item_type,rarity,character_class,extractable,active,
  weapon_name,weapon_score_bonus
)
select item_key,display_name,'character',rarity,character_class,true,true,
       weapon_name,weapon_score_bonus
from player_01_new_character_kits
on conflict(item_key) do update set
  display_name=excluded.display_name,item_type='character',
  rarity=excluded.rarity,character_class=excluded.character_class,
  extractable=true,active=true,weapon_name=excluded.weapon_name,
  weapon_score_bonus=excluded.weapon_score_bonus;

-- Correct metadata on an existing grant without granting any new item.
update public.player_unlocks unlock
set item_type='character',rarity=kit.rarity
from player_01_new_character_kits kit
where unlock.item_key=kit.item_key
  and (unlock.item_type is distinct from 'character'
       or unlock.rarity is distinct from kit.rarity);

-- Preserve an already-equipped kit if a previous partial rollout omitted its
-- ownership row, then align the saved category with the trusted catalog.
insert into public.player_unlocks(user_id,item_key,item_type,rarity,unlocked_at)
select loadout.user_id,kit.item_key,'character',kit.rarity,loadout.updated_at
from public.player_loadouts loadout
join player_01_new_character_kits kit on kit.item_key=loadout.character_key
on conflict(user_id,item_key) do update
set item_type=excluded.item_type,rarity=excluded.rarity;

update public.player_loadouts loadout
set class_key=catalog.character_class,updated_at=now()
from public.extraction_catalog catalog
where catalog.item_key=loadout.character_key
  and catalog.item_type='character'
  and loadout.class_key is distinct from catalog.character_class;

alter table public.player_loadouts
  drop constraint if exists player_loadouts_character_key_check;
do $$
declare v_character_keys text;
begin
  select string_agg(quote_literal(item_key),',' order by item_key)
  into v_character_keys
  from public.extraction_catalog
  where item_type='character' and active;
  execute 'alter table public.player_loadouts ' ||
    'add constraint player_loadouts_character_key_check ' ||
    'check(character_key in (' || v_character_keys || ')) not valid';
end
$$;
alter table public.player_loadouts
  validate constraint player_loadouts_character_key_check;

do $$
begin
  if (select count(*) from player_01_new_character_kits)<>32 then
    raise exception 'Expected exactly 32 new character definitions';
  end if;
  if (select count(*) from public.extraction_catalog
      where item_type='character' and active)<>80 then
    raise exception 'Expected exactly 80 active character kits';
  end if;
  if (select count(*) from public.extraction_catalog
      where item_type='character' and active and extractable)<>76 then
    raise exception 'Expected exactly 76 extractable character kits';
  end if;
  if exists(
    select 1 from (
      select character_class,count(*) as kit_count
      from public.extraction_catalog
      where item_type='character' and active
      group by character_class
    ) category_counts
    where character_class not in ('runner','medic','tank','trickster','misc')
       or kit_count<>16
  ) then
    raise exception 'Expected exactly 16 active kits in every category';
  end if;
  if (
    select count(*)
    from public.extraction_catalog catalog
    join player_01_new_character_kits kit using(item_key)
    where catalog.item_type='character' and catalog.active
      and catalog.extractable
      and catalog.character_class=kit.character_class
      and catalog.rarity=kit.rarity
      and catalog.weapon_name=kit.weapon_name
      and catalog.weapon_score_bonus=kit.weapon_score_bonus
  )<>32 then
    raise exception 'Not all 32 additions are active and extractable';
  end if;
  if exists(
    select 1 from public.player_loadouts loadout
    left join public.extraction_catalog catalog
      on catalog.item_key=loadout.character_key
     and catalog.item_type='character' and catalog.active
    where catalog.item_key is null
       or loadout.class_key is distinct from catalog.character_class
  ) then
    raise exception 'A saved loadout no longer matches its character category';
  end if;
end
$$;

notify pgrst,'reload schema';
commit;

select
  (select count(*) from public.extraction_catalog
   where item_type='character' and active) as active_character_kits,
  (select count(*) from public.extraction_catalog
   where item_type='character' and active and extractable)
    as extractable_character_kits,
  (select jsonb_object_agg(character_class,kit_count order by character_class)
   from (
     select character_class,count(*) as kit_count
     from public.extraction_catalog
     where item_type='character' and active
     group by character_class
   ) category_counts) as characters_by_category;
