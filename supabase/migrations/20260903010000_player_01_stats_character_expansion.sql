-- Player 01 Stats — Character Expansion
--
-- Adds four extractable characters to every class, rebalances Pacer and
-- Suture rarities, and permits every character key in saved loadouts.

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
  ('runner_drift', 'Drift', 'character', 'uncommon', 'runner', true, true),
  ('runner_fortune', 'Fortune', 'character', 'rare', 'runner', true, true),
  ('runner_relay', 'Relay', 'character', 'epic', 'runner', true, true),
  ('runner_comet', 'Comet', 'character', 'legendary', 'runner', true, true),
  ('runner_pacer', 'Pacer', 'character', 'mythic', 'runner', true, true),

  ('medic_bloom', 'Bloom', 'character', 'common', 'medic', true, true),
  ('medic_pulse', 'Pulse', 'character', 'rare', 'medic', true, true),
  ('medic_lifeline', 'Lifeline', 'character', 'legendary', 'medic', true, true),
  ('medic_seraph', 'Seraph', 'character', 'mythic', 'medic', true, true),
  ('medic_suture', 'Suture', 'character', 'epic', 'medic', true, true),

  ('tank_glacier', 'Glacier', 'character', 'uncommon', 'tank', true, true),
  ('tank_brace', 'Brace', 'character', 'uncommon', 'tank', true, true),
  ('tank_rampart', 'Rampart', 'character', 'epic', 'tank', true, true),
  ('tank_atlas', 'Atlas', 'character', 'mythic', 'tank', true, true),

  ('trickster_flicker', 'Flicker', 'character', 'uncommon', 'trickster', true, true),
  ('trickster_switch', 'Switch', 'character', 'rare', 'trickster', true, true),
  ('trickster_gambit', 'Gambit', 'character', 'rare', 'trickster', true, true),
  ('trickster_hex', 'Hex', 'character', 'legendary', 'trickster', true, true)
on conflict (item_key) do update
set
  display_name = excluded.display_name,
  item_type = excluded.item_type,
  rarity = excluded.rarity,
  character_class = excluded.character_class,
  extractable = excluded.extractable,
  active = excluded.active;

update public.player_unlocks as unlock
set
  item_type = catalog.item_type,
  rarity = catalog.rarity
from public.extraction_catalog as catalog
where unlock.item_key = catalog.item_key
  and catalog.item_key in (
    'runner_drift', 'runner_fortune', 'runner_relay', 'runner_comet',
    'runner_pacer',
    'medic_bloom', 'medic_pulse', 'medic_lifeline', 'medic_seraph',
    'medic_suture',
    'tank_glacier', 'tank_brace', 'tank_rampart', 'tank_atlas',
    'trickster_flicker', 'trickster_switch', 'trickster_gambit',
    'trickster_hex'
  );

alter table public.player_loadouts
  drop constraint if exists player_loadouts_character_key_check;

alter table public.player_loadouts
  add constraint player_loadouts_character_key_check
  check (character_key in (
    'runner_ace', 'runner_scout', 'runner_drift', 'runner_ranger',
    'runner_fortune', 'runner_relay', 'runner_comet', 'runner_pacer',
    'medic_patch', 'medic_bloom', 'medic_mercy', 'medic_pulse',
    'medic_suture', 'medic_vial', 'medic_lifeline', 'medic_seraph',
    'tank_bulwark', 'tank_glacier', 'tank_brace', 'tank_hammer',
    'tank_anchor', 'tank_rampart', 'tank_sentinel', 'tank_atlas',
    'trickster_rogue', 'trickster_flicker', 'trickster_switch',
    'trickster_gambit', 'trickster_jester', 'trickster_mirage',
    'trickster_hex', 'trickster_phantom'
  )) not valid;

alter table public.player_loadouts
  validate constraint player_loadouts_character_key_check;

notify pgrst, 'reload schema';

commit;
