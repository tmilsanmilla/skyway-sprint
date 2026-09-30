-- Player-visible balance correction: Scribe is an Epic character.
-- This keeps extraction results and already-owned copies aligned with the app.

begin;

update public.extraction_catalog
set rarity = 'epic',
    weapon_score_bonus = 0.06,
    passive_ability = 'After every wave, choose one hazard. During the next wave, it can spawn at most floor(wave / 10) times, minimum 1.',
    weapon_effect = 'Rune Quill adds 6% distance score.'
where item_key = 'misc_scribe';

update public.player_unlocks
set rarity = 'epic'
where item_key = 'misc_scribe';

commit;
