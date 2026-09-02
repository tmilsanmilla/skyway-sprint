-- Player 01 Stats — repair character-kit variant ownership.
--
-- Every class keeps one included default character:
--   Runner/Ace, Healer/Patch, Tank/Bulwark, Trickster/Rogue.
-- Other characters remain visible previews, but must come from a box or an
-- admin grant. An older migration granted full rosters to legacy class owners;
-- this removes only unproven grants from accounts covered by the maximum-bound
-- historical gem refund. Uncompensated accounts are left untouched.

begin;

-- Defaults are included kits, not paid-box results. Do not change any other
-- catalog flag here; future event/admin-only characters may be nonextractable.
update public.extraction_catalog
set extractable = false
where item_type = 'character'
  and item_key in (
    'runner_ace',
    'medic_patch',
    'tank_bulwark',
    'trickster_rogue'
  );

-- Move an equipped legacy-only variant back to its class default before the
-- unsupported ownership row is removed. Successful paid pulls and successful
-- admin grants are authoritative proof and are never reset here.
with proven_variants as (
  select ledger.user_id, ledger.item_key
  from public.extraction_transactions ledger
  where ledger.item_type = 'character'
    and ledger.is_new

  union

  select audit.target_user_id, audit.result ->> 'item_key'
  from public.admin_command_audit audit
  where audit.succeeded
    and audit.action = 'grant'
    and audit.target_user_id is not null
    and audit.result ->> 'item_type' = 'character'
    and audit.result ->> 'granted' = 'true'
    and coalesce(audit.result ->> 'item_key', '') <> ''
)
update public.player_loadouts loadout
set character_key = case loadout.class_key
      when 'medic' then 'medic_patch'
      when 'tank' then 'tank_bulwark'
      when 'trickster' then 'trickster_rogue'
      else 'runner_ace'
    end,
    updated_at = now()
where loadout.character_key not in (
    'runner_ace',
    'medic_patch',
    'tank_bulwark',
    'trickster_rogue'
  )
  and not exists (
    select 1
    from proven_variants proof
    where proof.user_id = loadout.user_id
      and proof.item_key = loadout.character_key
  )
  and exists (
    select 1
    from public.admin_compensation_ledger compensation
    where compensation.batch_key = 'shop-refund-2026-09-01-max-bound'
      and compensation.user_id = loadout.user_id
  );

with proven_variants as (
  select ledger.user_id, ledger.item_key
  from public.extraction_transactions ledger
  where ledger.item_type = 'character'
    and ledger.is_new

  union

  select audit.target_user_id, audit.result ->> 'item_key'
  from public.admin_command_audit audit
  where audit.succeeded
    and audit.action = 'grant'
    and audit.target_user_id is not null
    and audit.result ->> 'item_type' = 'character'
    and audit.result ->> 'granted' = 'true'
    and coalesce(audit.result ->> 'item_key', '') <> ''
)
delete from public.player_unlocks unlock
where unlock.item_type = 'character'
  and unlock.item_key not in (
    'runner_ace',
    'medic_patch',
    'tank_bulwark',
    'trickster_rogue'
  )
  and exists (
    select 1
    from public.extraction_catalog catalog
    where catalog.item_key = unlock.item_key
      and catalog.item_type = 'character'
  )
  and not exists (
    select 1
    from proven_variants proof
    where proof.user_id = unlock.user_id
      and proof.item_key = unlock.item_key
  )
  and exists (
    select 1
    from public.admin_compensation_ledger compensation
    where compensation.batch_key = 'shop-refund-2026-09-01-max-bound'
      and compensation.user_id = unlock.user_id
  );

comment on table public.player_unlocks is
  'Per-account ownership. Four default class characters are included; every other character requires a successful extraction or admin grant.';

commit;
