-- Player 01 Stats — Seraph + Atlas Availability
--
-- Both characters were technically extractable as Mythics, but the combined
-- character and Mythic odds made each ordinary pull roughly 1 in 803,000.
-- Keep them rare while making them realistically obtainable from either box
-- profile. Existing owners keep their unlocks; no new unlock is granted.

begin;

update public.extraction_catalog
set rarity = 'legendary'
where item_key in ('medic_seraph', 'tank_atlas')
  and item_type = 'character';

update public.player_unlocks
set rarity = 'legendary'
where item_key in ('medic_seraph', 'tank_atlas')
  and item_type = 'character';

notify pgrst, 'reload schema';

commit;
