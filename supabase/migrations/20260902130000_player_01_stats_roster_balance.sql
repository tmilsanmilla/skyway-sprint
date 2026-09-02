-- Player 01 Stats — expanded character roster and visual collection.
--
-- The four new characters are extractable and are not free starters. New
-- player, obstacle, and environment cosmetics are appearance-only. Character
-- abilities and balance values live in the game client; ownership and loadout
-- compatibility remain enforced here.

begin;

insert into public.extraction_catalog (
  item_key,
  display_name,
  item_type,
  rarity,
  character_class,
  extractable,
  active
) values
  ('runner_pacer', 'Pacer', 'character', 'rare', 'runner', true, true),
  ('medic_suture', 'Suture', 'character', 'uncommon', 'medic', true, true),
  ('tank_anchor', 'Anchor', 'character', 'rare', 'tank', true, true),
  ('trickster_mirage', 'Mirage', 'character', 'epic', 'trickster', true, true)
on conflict (item_key) do update
set
  display_name = excluded.display_name,
  item_type = excluded.item_type,
  rarity = excluded.rarity,
  character_class = excluded.character_class,
  extractable = excluded.extractable,
  active = excluded.active;

insert into public.extraction_catalog (
  item_key,
  display_name,
  item_type,
  rarity,
  character_class,
  extractable,
  active
) values
  ('monochrome_runner', 'Monochrome Runner', 'player', 'common', null, true, true),
  ('forest_cloak', 'Forest Cloak', 'player', 'uncommon', null, true, true),
  ('glitch_runner', 'Glitch Runner', 'player', 'epic', null, true, true),
  ('solar_knight', 'Solar Knight', 'player', 'legendary', null, true, true),

  ('moss_obstacles', 'Moss Obstacles', 'obstacle', 'uncommon', null, true, true),
  ('magma_obstacles', 'Magma Obstacles', 'obstacle', 'epic', null, true, true),
  ('prism_obstacles', 'Prism Obstacles', 'obstacle', 'legendary', null, true, true),

  ('desert_map', 'Desert Map', 'environment', 'uncommon', null, true, true),
  ('autumn_map', 'Autumn Map', 'environment', 'rare', null, true, true),
  ('volcano_map', 'Volcano Map', 'environment', 'legendary', null, true, true),
  ('arcade_map', 'Arcade Map', 'environment', 'mythic', null, true, true)
on conflict (item_key) do update
set
  display_name = excluded.display_name,
  item_type = excluded.item_type,
  rarity = excluded.rarity,
  character_class = excluded.character_class,
  extractable = excluded.extractable,
  active = excluded.active;

-- Keep any pre-existing admin grants for these keys aligned with the trusted
-- catalog. This does not create ownership or unlock anything automatically.
update public.player_unlocks as unlock
set
  item_type = catalog.item_type,
  rarity = catalog.rarity
from public.extraction_catalog as catalog
where unlock.item_key = catalog.item_key
  and catalog.item_key in (
    'runner_pacer', 'medic_suture', 'tank_anchor', 'trickster_mirage',
    'monochrome_runner', 'forest_cloak', 'glitch_runner', 'solar_knight',
    'moss_obstacles', 'magma_obstacles', 'prism_obstacles',
    'desert_map', 'autumn_map', 'volcano_map', 'arcade_map'
  );

alter table public.player_loadouts
  drop constraint if exists player_loadouts_character_key_check;

alter table public.player_loadouts
  add constraint player_loadouts_character_key_check
  check (character_key in (
    'runner_ace', 'runner_scout', 'runner_ranger', 'runner_pacer',
    'medic_patch', 'medic_mercy', 'medic_vial', 'medic_suture',
    'tank_bulwark', 'tank_hammer', 'tank_sentinel', 'tank_anchor',
    'trickster_rogue', 'trickster_jester', 'trickster_phantom',
    'trickster_mirage'
  )) not valid;

alter table public.player_loadouts
  validate constraint player_loadouts_character_key_check;

notify pgrst, 'reload schema';

commit;
