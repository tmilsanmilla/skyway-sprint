-- Player 01 Stats — account cosmetic ownership + loadout persistence.
-- This script creates or repairs storage only. It grants NO characters or cosmetics.
begin;

create table if not exists public.player_unlocks (
  user_id uuid not null references auth.users(id) on delete cascade,
  item_key text not null,
  item_type text not null,
  rarity text not null,
  unlocked_at timestamptz not null default now(),
  primary key (user_id, item_key)
);

alter table public.player_unlocks
  add column if not exists user_id uuid references auth.users(id) on delete cascade,
  add column if not exists item_key text,
  add column if not exists item_type text,
  add column if not exists rarity text,
  add column if not exists unlocked_at timestamptz not null default now();

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

create unique index if not exists player_unlocks_user_item_uidx
  on public.player_unlocks (user_id, item_key);
create index if not exists player_unlocks_user_type_idx
  on public.player_unlocks (user_id, item_type, unlocked_at);

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
  drop constraint if exists player_loadouts_class_key_check;
alter table public.player_loadouts
  add constraint player_loadouts_class_key_check
  check (class_key in ('runner', 'medic', 'tank', 'trickster'));

alter table public.player_loadouts
  drop constraint if exists player_loadouts_character_key_check;
alter table public.player_loadouts
  add constraint player_loadouts_character_key_check
  check (character_key in (
    'runner_ace', 'runner_scout', 'runner_ranger',
    'medic_patch', 'medic_mercy', 'medic_vial',
    'tank_bulwark', 'tank_hammer', 'tank_sentinel',
    'trickster_rogue', 'trickster_jester', 'trickster_phantom'
  ));

alter table public.player_unlocks enable row level security;
alter table public.player_loadouts enable row level security;

revoke all on table public.player_unlocks from public, anon, authenticated;
revoke all on table public.player_loadouts from public, anon, authenticated;
grant select on table public.player_unlocks to authenticated;
grant select on table public.player_loadouts to authenticated;

drop policy if exists "Players read own unlocks" on public.player_unlocks;
create policy "Players read own unlocks"
  on public.player_unlocks for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Players read own loadout" on public.player_loadouts;
create policy "Players read own loadout"
  on public.player_loadouts for select to authenticated
  using ((select auth.uid()) = user_id);

comment on table public.player_unlocks is
  'Per-account ownership. Rows are created only by trusted server-side extraction or grant flows.';
comment on table public.player_loadouts is
  'Per-account equipped class, character, and visual cosmetics.';

notify pgrst, 'reload schema';
commit;
