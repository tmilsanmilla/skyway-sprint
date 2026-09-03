-- Player 01 Stats — Character Expansion 02
--
-- Adds four more active, extractable characters to every existing class and
-- permits all 48 character keys in saved loadouts.

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
  ('runner_vault', 'Vault', 'character', 'common', 'runner', true, true),
  ('runner_spark', 'Spark', 'character', 'uncommon', 'runner', true, true),
  ('runner_flare', 'Flare', 'character', 'rare', 'runner', true, true),
  ('runner_orbit', 'Orbit', 'character', 'epic', 'runner', true, true),

  ('medic_remedy', 'Remedy', 'character', 'common', 'medic', true, true),
  ('medic_reserve', 'Reserve', 'character', 'uncommon', 'medic', true, true),
  ('medic_mender', 'Mender', 'character', 'rare', 'medic', true, true),
  ('medic_halo', 'Halo', 'character', 'epic', 'medic', true, true),

  ('tank_drag', 'Drag', 'character', 'common', 'tank', true, true),
  ('tank_plow', 'Plow', 'character', 'uncommon', 'tank', true, true),
  ('tank_reactor', 'Reactor', 'character', 'rare', 'tank', true, true),
  ('tank_bastion', 'Bastion', 'character', 'epic', 'tank', true, true),

  ('trickster_smoke', 'Smoke', 'character', 'common', 'trickster', true, true),
  ('trickster_clockwork', 'Clockwork', 'character', 'uncommon', 'trickster', true, true),
  ('trickster_pickpocket', 'Pickpocket', 'character', 'rare', 'trickster', true, true),
  ('trickster_wildcard', 'Wildcard', 'character', 'epic', 'trickster', true, true)
on conflict (item_key) do update
set
  display_name = excluded.display_name,
  item_type = excluded.item_type,
  rarity = excluded.rarity,
  character_class = excluded.character_class,
  extractable = excluded.extractable,
  active = excluded.active;

-- Keep any pre-existing manual grants aligned with the trusted catalog without
-- granting these characters to any account automatically.
update public.player_unlocks as unlock
set
  item_type = catalog.item_type,
  rarity = catalog.rarity
from public.extraction_catalog as catalog
where unlock.item_key = catalog.item_key
  and catalog.item_key in (
    'runner_vault', 'runner_spark', 'runner_flare', 'runner_orbit',
    'medic_remedy', 'medic_reserve', 'medic_mender', 'medic_halo',
    'tank_drag', 'tank_plow', 'tank_reactor', 'tank_bastion',
    'trickster_smoke', 'trickster_clockwork', 'trickster_pickpocket',
    'trickster_wildcard'
  );

alter table public.player_loadouts
  drop constraint if exists player_loadouts_character_key_check;

alter table public.player_loadouts
  add constraint player_loadouts_character_key_check
  check (character_key in (
    'runner_ace', 'runner_scout', 'runner_vault', 'runner_drift',
    'runner_spark', 'runner_ranger', 'runner_flare', 'runner_fortune',
    'runner_orbit', 'runner_relay', 'runner_comet', 'runner_pacer',

    'medic_patch', 'medic_remedy', 'medic_bloom', 'medic_reserve',
    'medic_mercy', 'medic_mender', 'medic_pulse', 'medic_suture',
    'medic_vial', 'medic_halo', 'medic_lifeline', 'medic_seraph',

    'tank_bulwark', 'tank_drag', 'tank_glacier', 'tank_brace',
    'tank_plow', 'tank_hammer', 'tank_anchor', 'tank_reactor',
    'tank_rampart', 'tank_bastion', 'tank_sentinel', 'tank_atlas',

    'trickster_smoke', 'trickster_rogue', 'trickster_flicker',
    'trickster_clockwork', 'trickster_switch', 'trickster_pickpocket',
    'trickster_gambit', 'trickster_jester', 'trickster_mirage',
    'trickster_wildcard', 'trickster_hex', 'trickster_phantom'
  )) not valid;

alter table public.player_loadouts
  validate constraint player_loadouts_character_key_check;

notify pgrst, 'reload schema';

commit;
