-- Player 01 Stats — complete account stats, inventory, character kits, and loadouts.
-- Rerunnable current-state query. It intentionally preserves the current
-- extract_items, admin, leaderboard, and historical compensation functions.

begin;

do $$
begin
  if to_regclass('public.extraction_transactions') is null
     or to_regprocedure('public.extract_items(integer,text)') is null then
    raise exception 'Current extraction setup is missing. Run Leaderboard 02 first.';
  end if;
end
$$;

-- Permanent account stats. Players read this table directly but mutate it only
-- through narrow SECURITY DEFINER RPCs.
create table if not exists public.player_stats (
  user_id uuid primary key references auth.users(id) on delete cascade,
  total_gems bigint not null default 0,
  high_score bigint not null default 0,
  updated_at timestamptz not null default now()
);

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='player_stats'
      and column_name='total_coins'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='player_stats'
      and column_name='total_gems'
  ) then
    alter table public.player_stats rename column total_coins to total_gems;
  end if;
end
$$;

alter table public.player_stats
  add column if not exists total_gems bigint not null default 0,
  add column if not exists high_score bigint not null default 0,
  add column if not exists updated_at timestamptz not null default now();
alter table public.player_stats
  drop constraint if exists player_stats_total_gems_check,
  drop constraint if exists player_stats_high_score_check;
alter table public.player_stats
  add constraint player_stats_total_gems_check check (total_gems >= 0) not valid,
  add constraint player_stats_high_score_check check (high_score >= 0) not valid;
alter table public.player_stats validate constraint player_stats_total_gems_check;
alter table public.player_stats validate constraint player_stats_high_score_check;
alter table public.player_stats enable row level security;
revoke all on table public.player_stats from public, anon, authenticated;
grant select on table public.player_stats to authenticated;
drop policy if exists "Players read their own stats" on public.player_stats;
drop policy if exists "Players create their own stats" on public.player_stats;
drop policy if exists "Players update their own stats" on public.player_stats;
create policy "Players read their own stats" on public.player_stats
  for select to authenticated using ((select auth.uid()) = user_id);

create or replace function public.increment_player_gems()
returns bigint language sql security definer set search_path='' as $$
  insert into public.player_stats(user_id,total_gems,high_score,updated_at)
  values ((select auth.uid()),1,0,now())
  on conflict (user_id) do update
    set total_gems=public.player_stats.total_gems+1,updated_at=now()
  returning total_gems;
$$;
create or replace function public.save_player_high_score(new_score bigint)
returns bigint language sql security definer set search_path='' as $$
  insert into public.player_stats(user_id,total_gems,high_score,updated_at)
  values ((select auth.uid()),0,greatest(new_score,0),now())
  on conflict (user_id) do update
    set high_score=greatest(public.player_stats.high_score,excluded.high_score),
        updated_at=now()
  returning high_score;
$$;
revoke all on function public.increment_player_gems()
  from public,anon,authenticated;
revoke all on function public.save_player_high_score(bigint)
  from public,anon,authenticated;
grant execute on function public.increment_player_gems() to authenticated;
grant execute on function public.save_player_high_score(bigint) to authenticated;

-- Per-account ownership and equipped loadout.
create table if not exists public.player_unlocks (
  user_id uuid not null references auth.users(id) on delete cascade,
  item_key text not null,
  item_type text not null,
  rarity text not null,
  unlocked_at timestamptz not null default now(),
  primary key(user_id,item_key)
);
alter table public.player_unlocks
  add column if not exists item_type text,
  add column if not exists rarity text,
  add column if not exists unlocked_at timestamptz not null default now();
alter table public.player_unlocks
  drop constraint if exists player_unlocks_item_type_check,
  drop constraint if exists player_unlocks_rarity_check;
alter table public.player_unlocks
  add constraint player_unlocks_item_type_check
    check(item_type in ('class','character','player','obstacle','environment')) not valid,
  add constraint player_unlocks_rarity_check
    check(rarity in ('common','uncommon','rare','epic','legendary','mythic')) not valid;
alter table public.player_unlocks validate constraint player_unlocks_item_type_check;
alter table public.player_unlocks validate constraint player_unlocks_rarity_check;
create unique index if not exists player_unlocks_user_item_uidx
  on public.player_unlocks(user_id,item_key);
create index if not exists player_unlocks_user_type_idx
  on public.player_unlocks(user_id,item_type,unlocked_at);

create table if not exists public.player_loadouts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  class_key text not null default 'runner',
  character_key text not null default 'runner_ace',
  player_cosmetic text,
  obstacle_cosmetic text,
  environment_cosmetic text,
  updated_at timestamptz not null default now()
);
alter table public.player_loadouts
  add column if not exists class_key text not null default 'runner',
  add column if not exists character_key text not null default 'runner_ace',
  add column if not exists player_cosmetic text,
  add column if not exists obstacle_cosmetic text,
  add column if not exists environment_cosmetic text,
  add column if not exists updated_at timestamptz not null default now();
alter table public.player_loadouts
  drop constraint if exists player_loadouts_class_key_check,
  drop constraint if exists player_loadouts_character_key_check;

alter table public.player_unlocks enable row level security;
alter table public.player_loadouts enable row level security;
revoke all on table public.player_unlocks from public,anon,authenticated;
revoke all on table public.player_loadouts from public,anon,authenticated;
grant select on table public.player_unlocks to authenticated;
grant select on table public.player_loadouts to authenticated;
drop policy if exists "Players read own unlocks" on public.player_unlocks;
create policy "Players read own unlocks" on public.player_unlocks
  for select to authenticated using ((select auth.uid())=user_id);
drop policy if exists "Players read own loadout" on public.player_loadouts;
create policy "Players read own loadout" on public.player_loadouts
  for select to authenticated using ((select auth.uid())=user_id);

-- Server-owned catalog. A character row is one atomic character + weapon kit.
create table if not exists public.extraction_catalog (
  item_key text primary key,
  display_name text not null,
  item_type text not null,
  rarity text not null,
  character_class text,
  extractable boolean not null default true,
  active boolean not null default true,
  weapon_name text,
  weapon_score_bonus numeric(6,4)
);
alter table public.extraction_catalog
  add column if not exists display_name text,
  add column if not exists item_type text,
  add column if not exists rarity text,
  add column if not exists character_class text,
  add column if not exists extractable boolean not null default true,
  add column if not exists active boolean not null default true,
  add column if not exists weapon_name text,
  add column if not exists weapon_score_bonus numeric(6,4);
alter table public.extraction_catalog
  drop constraint if exists extraction_catalog_item_type_check,
  drop constraint if exists extraction_catalog_rarity_check,
  drop constraint if exists extraction_catalog_character_class_check,
  drop constraint if exists extraction_catalog_character_kit_check;

create temporary table canonical_character_kits(
  item_key text primary key,
  display_name text not null,
  rarity text not null,
  character_class text not null,
  extractable boolean not null,
  weapon_name text not null,
  weapon_score_bonus numeric(6,4) not null
) on commit drop;
insert into canonical_character_kits values
  -- RUNNER: movement or score.
  ('runner_ace','Ace','common','runner',false,'Baton',.03),
  ('tank_glacier','Glacier','uncommon','runner',true,'Frost Shield',.04),
  ('tank_reactor','Reactor','rare','runner',true,'Core Maul',.05),
  ('medic_halo','Halo','epic','runner',true,'Sun Staff',.06),
  ('runner_orbit','Orbit','epic','runner',true,'Ring Blades',.06),
  ('runner_relay','Relay','epic','runner',true,'Circuit Baton',.06),
  ('runner_pacer','Pacer','mythic','runner',true,'Relay Rod',.08),
  -- HEALER (internal key medic): special healing or HP.
  ('medic_patch','Patch','common','medic',false,'Med Staff',.03),
  ('medic_bloom','Bloom','common','medic',true,'Bloom Wand',.03),
  ('medic_remedy','Remedy','common','medic',true,'Tonic Bell',.03),
  ('medic_reserve','Reserve','uncommon','medic',true,'Field Pack',.04),
  ('medic_mender','Mender','rare','medic',true,'Clock Needle',.05),
  ('medic_pulse','Pulse','rare','medic',true,'Pulse Syringe',.05),
  ('medic_suture','Suture','epic','medic',true,'Pulse Thread',.06),
  ('medic_lifeline','Lifeline','legendary','medic',true,'Rescue Hook',.07),
  ('medic_seraph','Seraph','legendary','medic',true,'Halo Staff',.07),
  ('tank_atlas','Atlas','legendary','medic',true,'World Maul',.07),
  -- TANK: less damage or more health without healer-style recovery.
  ('tank_bulwark','Bulwark','common','tank',false,'Tower Shield',.03),
  ('runner_vault','Vault','common','tank',true,'Spring Pole',.03),
  ('tank_brace','Brace','uncommon','tank',true,'Spike Buckler',.04),
  ('medic_mercy','Mercy','rare','tank',true,'Injector',.05),
  ('tank_hammer','Hammer','rare','tank',true,'War Hammer',.05),
  ('tank_anchor','Anchor','rare','tank',true,'Ground Hook',.05),
  ('tank_bastion','Bastion','epic','tank',true,'Fortress Shield',.06),
  ('tank_rampart','Rampart','epic','tank',true,'Siege Wall',.06),
  ('trickster_jester','Jester','epic','tank',true,'Card Fan',.06),
  ('tank_sentinel','Sentinel','legendary','tank',true,'Steel Spear',.07),
  ('trickster_phantom','Phantom','mythic','tank',true,'Moon Scythe',.08),
  -- TRICKSTER: a special action triggers invincibility or another benefit.
  ('trickster_smoke','Smoke','common','trickster',true,'Smoke Bombs',.03),
  ('runner_drift','Drift','uncommon','trickster',true,'Slipstream Shoes',.04),
  ('runner_spark','Spark','uncommon','trickster',true,'Prism Baton',.04),
  ('tank_plow','Plow','uncommon','trickster',true,'Ram Shield',.04),
  ('trickster_rogue','Rogue','uncommon','trickster',false,'Daggers',.04),
  ('trickster_clockwork','Clockwork','uncommon','trickster',true,'Time Cards',.04),
  ('trickster_flicker','Flicker','uncommon','trickster',true,'Blink Knives',.04),
  ('runner_flare','Flare','rare','trickster',true,'Signal Spear',.05),
  ('trickster_pickpocket','Pickpocket','rare','trickster',true,'Coin Dagger',.05),
  ('trickster_switch','Switch','rare','trickster',true,'Twin Coins',.05),
  ('trickster_gambit','Gambit','rare','trickster',true,'Loaded Cards',.05),
  ('medic_vial','Vial','epic','trickster',true,'Tonic Flask',.06),
  ('trickster_mirage','Mirage','epic','trickster',true,'Prism Fans',.06),
  ('runner_comet','Comet','legendary','trickster',true,'Star Spear',.07),
  ('trickster_hex','Hex','legendary','trickster',true,'Void Chakram',.07),
  -- MISC: everything outside the four defined roles.
  ('runner_scout','Scout','common','misc',true,'Twin Blades',.03),
  ('tank_drag','Drag','common','misc',true,'Chain Hook',.03),
  ('runner_ranger','Ranger','uncommon','misc',true,'Pixel Bow',.04),
  ('runner_fortune','Fortune','rare','misc',true,'Lucky Compass',.05),
  ('trickster_wildcard','Wildcard','epic','misc',true,'Dice Fans',.06);

insert into public.extraction_catalog(
  item_key,display_name,item_type,rarity,character_class,extractable,active,
  weapon_name,weapon_score_bonus
)
select item_key,display_name,'character',rarity,character_class,extractable,true,
       weapon_name,weapon_score_bonus
from canonical_character_kits
on conflict(item_key) do update set
  display_name=excluded.display_name,item_type=excluded.item_type,
  rarity=excluded.rarity,character_class=excluded.character_class,
  extractable=excluded.extractable,active=excluded.active,
  weapon_name=excluded.weapon_name,
  weapon_score_bonus=excluded.weapon_score_bonus;

create temporary table canonical_visual_cosmetics(
  item_key text primary key,
  display_name text not null,
  item_type text not null,
  rarity text not null
) on commit drop;
insert into canonical_visual_cosmetics values
  ('red_runner','Red Runner','player','common'),
  ('blue_runner','Blue Runner','player','common'),
  ('gold_runner','Gold Runner','player','common'),
  ('monochrome_runner','Monochrome Runner','player','common'),
  ('pixel_cap','Pixel Cap','player','uncommon'),
  ('mint_scarf','Mint Scarf','player','uncommon'),
  ('forest_cloak','Forest Cloak','player','uncommon'),
  ('comet_cape','Comet Cape','player','rare'),
  ('royal_runner','Royal Runner','player','epic'),
  ('glitch_runner','Glitch Runner','player','epic'),
  ('void_runner','Void Runner','player','legendary'),
  ('starforged_runner','Starforged Runner','player','legendary'),
  ('solar_knight','Solar Knight','player','legendary'),
  ('celestial_runner','Celestial Runner','player','mythic'),
  ('cardboard_obstacles','Cardboard Obstacles','obstacle','common'),
  ('candy_obstacles','Candy Obstacles','obstacle','common'),
  ('copper_obstacles','Copper Obstacles','obstacle','uncommon'),
  ('moss_obstacles','Moss Obstacles','obstacle','uncommon'),
  ('ice_obstacles','Ice Obstacles','obstacle','rare'),
  ('neon_obstacles','Neon Obstacles','obstacle','rare'),
  ('rust_obstacles','Rust Obstacles','obstacle','rare'),
  ('hologram_obstacles','Hologram Obstacles','obstacle','epic'),
  ('magma_obstacles','Magma Obstacles','obstacle','epic'),
  ('dragon_obstacles','Dragon Obstacles','obstacle','legendary'),
  ('prism_obstacles','Prism Obstacles','obstacle','legendary'),
  ('cosmic_obstacles','Cosmic Obstacles','obstacle','mythic'),
  ('meadow_map','Meadow Map','environment','common'),
  ('city_map','City Map','environment','common'),
  ('rain_map','Rain Map','environment','uncommon'),
  ('desert_map','Desert Map','environment','uncommon'),
  ('ocean_map','Ocean Map','environment','rare'),
  ('autumn_map','Autumn Map','environment','rare'),
  ('cave_map','Dark Caves','environment','epic'),
  ('sunset_map','Sunset Map','environment','epic'),
  ('snow_map','Snow Map','environment','epic'),
  ('aurora_map','Aurora Map','environment','legendary'),
  ('volcano_map','Volcano Map','environment','legendary'),
  ('starlight_map','Starlight Map','environment','mythic'),
  ('arcade_map','Arcade Map','environment','mythic');

insert into public.extraction_catalog(
  item_key,display_name,item_type,rarity,character_class,extractable,active,
  weapon_name,weapon_score_bonus
)
select item_key,display_name,item_type,rarity,null,true,true,null,null
from canonical_visual_cosmetics
on conflict(item_key) do update set
  display_name=excluded.display_name,item_type=excluded.item_type,
  rarity=excluded.rarity,character_class=null,extractable=true,active=true,
  weapon_name=null,weapon_score_bonus=null;

alter table public.extraction_catalog
  alter column display_name set not null,
  alter column item_type set not null,
  alter column rarity set not null,
  alter column extractable set not null,
  alter column active set not null;
alter table public.extraction_catalog
  add constraint extraction_catalog_item_type_check
    check(item_type in ('character','player','obstacle','environment')) not valid,
  add constraint extraction_catalog_rarity_check
    check(rarity in ('common','uncommon','rare','epic','legendary','mythic')) not valid,
  add constraint extraction_catalog_character_class_check check(
    (item_type='character' and character_class in
      ('runner','medic','tank','trickster','misc'))
    or (item_type<>'character' and character_class is null)
  ) not valid,
  add constraint extraction_catalog_character_kit_check check(
    (
      item_type='character' and nullif(trim(weapon_name),'') is not null
      and weapon_score_bonus>0 and weapon_score_bonus<=1
    )
    or (
      item_type<>'character'
      and weapon_name is null and weapon_score_bonus is null
    )
  ) not valid;
alter table public.extraction_catalog validate constraint extraction_catalog_item_type_check;
alter table public.extraction_catalog validate constraint extraction_catalog_rarity_check;
alter table public.extraction_catalog validate constraint extraction_catalog_character_class_check;
alter table public.extraction_catalog validate constraint extraction_catalog_character_kit_check;
alter table public.extraction_catalog enable row level security;
revoke all on table public.extraction_catalog from public,anon,authenticated;
grant select on table public.extraction_catalog to authenticated;
drop policy if exists "Authenticated players read extraction catalog"
  on public.extraction_catalog;
create policy "Authenticated players read extraction catalog"
  on public.extraction_catalog for select to authenticated using(active);

-- Provision missing account rows and the four included starter kits. No paid
-- or nonstarter item is granted by this backfill.
insert into public.player_stats(user_id,total_gems,high_score,updated_at)
select id,0,0,now() from auth.users on conflict(user_id) do nothing;
insert into public.player_unlocks(user_id,item_key,item_type,rarity,unlocked_at)
select users.id,starter.item_key,starter.item_type,starter.rarity,now()
from auth.users users
cross join (values
  ('runner','class','common'),('medic','class','common'),
  ('tank','class','common'),('trickster','class','common'),
  ('runner_ace','character','common'),('medic_patch','character','common'),
  ('tank_bulwark','character','common'),
  ('trickster_rogue','character','uncommon')
) starter(item_key,item_type,rarity)
on conflict(user_id,item_key) do update
set item_type=excluded.item_type,rarity=excluded.rarity;
insert into public.player_loadouts(user_id,class_key,character_key,updated_at)
select id,'runner','runner_ace',now() from auth.users
on conflict(user_id) do nothing;

-- Preserve any equipped kit if a historical ownership row is missing.
insert into public.player_unlocks(user_id,item_key,item_type,rarity,unlocked_at)
select loadout.user_id,catalog.item_key,'character',catalog.rarity,
       loadout.updated_at
from public.player_loadouts loadout
join public.extraction_catalog catalog
  on catalog.item_key=loadout.character_key and catalog.item_type='character'
on conflict(user_id,item_key) do update
set item_type=excluded.item_type,rarity=excluded.rarity;

-- Repair metadata without granting unrelated ownership, then preserve the
-- equipped character while moving its saved category.
update public.player_unlocks unlock
set item_type=catalog.item_type,rarity=catalog.rarity
from public.extraction_catalog catalog
where catalog.item_key=unlock.item_key;
update public.player_loadouts loadout
set class_key=catalog.character_class,updated_at=now()
from public.extraction_catalog catalog
where catalog.item_key=loadout.character_key
  and catalog.item_type='character'
  and loadout.class_key is distinct from catalog.character_class;

alter table public.player_loadouts
  add constraint player_loadouts_class_key_check
    check(class_key in ('runner','medic','tank','trickster','misc')) not valid,
  add constraint player_loadouts_character_key_check check(character_key in (
    'runner_ace','runner_scout','runner_vault','runner_drift',
    'runner_spark','runner_ranger','runner_flare','runner_fortune',
    'runner_orbit','runner_relay','runner_comet','runner_pacer',
    'medic_patch','medic_remedy','medic_bloom','medic_reserve',
    'medic_mercy','medic_mender','medic_pulse','medic_suture',
    'medic_vial','medic_halo','medic_lifeline','medic_seraph',
    'tank_bulwark','tank_drag','tank_glacier','tank_brace','tank_plow',
    'tank_hammer','tank_anchor','tank_reactor','tank_rampart',
    'tank_bastion','tank_sentinel','tank_atlas',
    'trickster_smoke','trickster_rogue','trickster_flicker',
    'trickster_clockwork','trickster_switch','trickster_pickpocket',
    'trickster_gambit','trickster_jester','trickster_mirage',
    'trickster_wildcard','trickster_hex','trickster_phantom'
  )) not valid;
alter table public.player_loadouts validate constraint player_loadouts_class_key_check;
alter table public.player_loadouts validate constraint player_loadouts_character_key_check;

create or replace function public.sync_player_loadout_character_class()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_character_class text;
begin
  select character_class into v_character_class
  from public.extraction_catalog
  where item_key=new.character_key and item_type='character';
  if v_character_class is null then raise exception 'Unknown loadout character'; end if;
  new.class_key:=v_character_class;
  return new;
end;
$$;
drop trigger if exists sync_player_loadout_character_class on public.player_loadouts;
create trigger sync_player_loadout_character_class
before insert or update of class_key,character_key on public.player_loadouts
for each row execute function public.sync_player_loadout_character_class();
revoke all on function public.sync_player_loadout_character_class()
  from public,anon,authenticated;

-- Catalog-driven loadout selection supports stable historical key names.
create or replace function public.set_loadout(p_slot text,p_item text)
returns void language plpgsql security definer set search_path='' as $$
declare
  v_uid uuid:=auth.uid();
  v_slot text:=lower(trim(p_slot));
  v_item text:=lower(trim(p_item));
  v_required_class text;
  v_current_class text;
  v_current_character text;
  v_next_character text;
begin
  if v_uid is null then raise exception 'Sign in required'; end if;
  if v_slot not in ('class','character','player','obstacle','environment') then
    raise exception 'Invalid loadout slot';
  end if;
  if v_item is null or v_item='' then raise exception 'Invalid loadout item'; end if;

  insert into public.player_loadouts(user_id) values(v_uid)
  on conflict(user_id) do nothing;
  select class_key,character_key into v_current_class,v_current_character
  from public.player_loadouts where user_id=v_uid;

  if v_slot='class' then
    if v_item not in ('runner','medic','tank','trickster','misc') then
      raise exception 'Invalid class';
    end if;
    if v_item<>'runner'
       and not exists(
         select 1 from public.player_unlocks
         where user_id=v_uid and item_type='class' and item_key=v_item
       )
       and not exists(
         select 1 from public.player_unlocks unlock
         join public.extraction_catalog catalog
           on catalog.item_key=unlock.item_key
          and catalog.item_type='character'
          and catalog.character_class=v_item
         where unlock.user_id=v_uid and unlock.item_type='character'
       ) then
      raise exception 'Class is not unlocked';
    end if;

    if v_item='runner' then
      if v_current_class='runner' and (
        v_current_character='runner_ace' or exists(
          select 1 from public.player_unlocks unlock
          join public.extraction_catalog catalog
            on catalog.item_key=unlock.item_key
           and catalog.item_type='character'
           and catalog.character_class='runner'
          where unlock.user_id=v_uid and unlock.item_type='character'
            and unlock.item_key=v_current_character
        )
      ) then v_next_character:=v_current_character;
      else v_next_character:='runner_ace';
      end if;
    else
      if v_current_class=v_item and exists(
        select 1 from public.player_unlocks unlock
        join public.extraction_catalog catalog
          on catalog.item_key=unlock.item_key
         and catalog.item_type='character'
         and catalog.character_class=v_item
        where unlock.user_id=v_uid and unlock.item_type='character'
          and unlock.item_key=v_current_character
      ) then v_next_character:=v_current_character;
      else
        select unlock.item_key into v_next_character
        from public.player_unlocks unlock
        join public.extraction_catalog catalog
          on catalog.item_key=unlock.item_key
         and catalog.item_type='character'
         and catalog.character_class=v_item
        where unlock.user_id=v_uid and unlock.item_type='character'
        order by unlock.unlocked_at,unlock.item_key limit 1;
      end if;
      if v_next_character is null then
        raise exception 'No owned character is available for this class';
      end if;
    end if;
    update public.player_loadouts
    set class_key=v_item,character_key=v_next_character,updated_at=now()
    where user_id=v_uid;
    return;
  end if;

  if v_slot='character' then
    select character_class into v_required_class
    from public.extraction_catalog
    where item_key=v_item and item_type='character' and active;
    if v_required_class is null then raise exception 'Invalid character'; end if;
    if v_item<>'runner_ace' and not exists(
      select 1 from public.player_unlocks
      where user_id=v_uid and item_key=v_item and item_type='character'
    ) then raise exception 'Character is not unlocked'; end if;
    if v_current_class<>v_required_class then
      raise exception 'Character does not belong to the selected class';
    end if;
    update public.player_loadouts
    set character_key=v_item,updated_at=now() where user_id=v_uid;
    return;
  end if;

  if not exists(
    select 1 from public.player_unlocks
    where user_id=v_uid and item_key=v_item and item_type=v_slot
  ) then raise exception 'Item is not unlocked for this slot'; end if;
  update public.player_loadouts set
    player_cosmetic=case when v_slot='player' then v_item else player_cosmetic end,
    obstacle_cosmetic=case when v_slot='obstacle' then v_item else obstacle_cosmetic end,
    environment_cosmetic=case when v_slot='environment' then v_item else environment_cosmetic end,
    updated_at=now()
  where user_id=v_uid;
end;
$$;
revoke all on function public.set_loadout(text,text)
  from public,anon,authenticated;
grant execute on function public.set_loadout(text,text) to authenticated;

-- Preserve the current extraction implementation while restoring only its
-- intended caller privilege.
revoke all on function public.extract_items(integer,text)
  from public,anon,authenticated;
grant execute on function public.extract_items(integer,text) to authenticated;

comment on table public.player_stats is
  'Permanent signed-in gem balance and personal high score; client mutations use secure RPCs.';
comment on table public.player_unlocks is
  'Per-account ownership. Four starter kits are included; all other kits and cosmetics require extraction or an admin grant.';
comment on table public.player_loadouts is
  'Per-account equipped category, character kit, and visual cosmetics.';
comment on table public.extraction_catalog is
  'Server-owned extraction pool. A character row atomically unlocks its visual, named weapon, passive, and weapon score bonus.';
comment on column public.extraction_catalog.weapon_name is
  'Named weapon bundled with its character; never extracted separately.';
comment on column public.extraction_catalog.weapon_score_bonus is
  'Additional distance-score fraction; 0.03 means +3 percent.';

-- Fail atomically if the canonical install is incomplete.
do $$
begin
  if (select count(*) from canonical_character_kits)<>48
     or (select count(*) from canonical_visual_cosmetics)<>39 then
    raise exception 'Canonical Player 01 catalog definition is incomplete';
  end if;
  if (
    select count(*) from canonical_character_kits kit
    join public.extraction_catalog catalog using(item_key)
    where catalog.item_type='character' and catalog.active
      and catalog.character_class=kit.character_class
      and catalog.weapon_name=kit.weapon_name
      and catalog.weapon_score_bonus=kit.weapon_score_bonus
  )<>48 then raise exception 'Not all 48 character kits were installed'; end if;
  if (
    select count(*) from canonical_character_kits kit
    join public.extraction_catalog catalog using(item_key)
    where catalog.extractable
  )<>44 then raise exception 'Expected exactly 44 extractable character kits'; end if;
  if exists(
    select 1 from public.player_loadouts loadout
    left join public.extraction_catalog catalog
      on catalog.item_key=loadout.character_key
     and catalog.item_type='character'
    where catalog.item_key is null
       or loadout.class_key is distinct from catalog.character_class
  ) then raise exception 'A loadout category does not match its character'; end if;
  if to_regprocedure('public.extract_items(integer)') is not null then
    raise exception 'Obsolete one-argument extract_items is installed';
  end if;
  if not has_function_privilege(
    'authenticated','public.extract_items(integer,text)','EXECUTE'
  ) or has_function_privilege(
    'anon','public.extract_items(integer,text)','EXECUTE'
  ) then
    raise exception 'Extraction RPC privileges are not secure';
  end if;
  if has_table_privilege('authenticated','public.player_stats','INSERT')
     or has_table_privilege('authenticated','public.player_stats','UPDATE')
     or has_table_privilege('authenticated','public.player_stats','DELETE') then
    raise exception 'Direct authenticated stat writes are still enabled';
  end if;
end
$$;

notify pgrst,'reload schema';
commit;

-- One read-only result row appears in the SQL editor after a successful run.
select
  (select count(*) from public.extraction_catalog
    where item_type='character' and active) as active_character_kits,
  (select count(*) from public.extraction_catalog
    where item_type='character' and active and extractable)
    as extractable_character_kits,
  (select count(*) from public.extraction_catalog
    where item_type='character' and active
      and weapon_name is not null and weapon_score_bonus is not null)
    as weaponized_character_kits,
  (select count(*) from public.extraction_catalog
    where item_type in ('player','obstacle','environment') and active)
    as active_visual_cosmetics,
  (select jsonb_object_agg(character_class,item_count order by character_class)
   from (
     select character_class,count(*) as item_count
     from public.extraction_catalog
     where item_type='character' and active
     group by character_class
   ) counts) as characters_by_category,
  (select count(*) from public.player_loadouts loadout
   left join public.extraction_catalog catalog
     on catalog.item_key=loadout.character_key
    and catalog.item_type='character'
   where catalog.item_key is null
      or loadout.class_key is distinct from catalog.character_class)
    as invalid_loadouts,
  (select count(*) from public.player_unlocks unlock
   join public.extraction_catalog catalog using(item_key)
   where unlock.item_type is distinct from catalog.item_type
      or unlock.rarity is distinct from catalog.rarity)
    as unlock_metadata_mismatches,
  not has_table_privilege('authenticated','public.player_stats','INSERT')
    and not has_table_privilege('authenticated','public.player_stats','UPDATE')
    and not has_table_privilege('authenticated','public.player_stats','DELETE')
    as direct_stat_writes_blocked,
  to_regprocedure('public.extract_items(integer)') is null
    and to_regprocedure('public.extract_items(integer,text)') is not null
    as current_extraction_rpc_preserved,
  has_function_privilege(
    'authenticated','public.extract_items(integer,text)','EXECUTE'
  ) and not has_function_privilege(
    'anon','public.extract_items(integer,text)','EXECUTE'
  ) as extraction_rpc_permissions_secure;
