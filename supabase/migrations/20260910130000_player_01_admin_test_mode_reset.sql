-- Player 01 Stats — admin Test Mode and one-time character reset.
--
-- Test Mode is an account-backed admin preference. It never creates ownership,
-- never enters Ranked, and its run snapshots cannot award permanent gems, XP,
-- completed runs, high scores, or leaderboard results. The one-time reset keeps
-- only Ace, Patch, Bulwark, and Rogue while preserving every cosmetic, class,
-- currency, stat, receipt, and audit record.

begin;

do $player_01_test_mode_prerequisites$
begin
  if to_regclass('public.player_stats') is null
     or to_regclass('public.player_unlocks') is null
     or to_regclass('public.player_loadouts') is null
     or to_regclass('public.extraction_catalog') is null
     or to_regclass('public.extraction_transactions') is null
     or to_regclass('public.player_progression_runs') is null
     or to_regclass('public.player_progression_1v1_activity') is null
     or to_regclass('public.multiplayer_queue') is null
     or to_regclass('public.multiplayer_matches') is null
     or to_regclass('public.multiplayer_players') is null
     or to_regclass('public.admin_users') is null
     or to_regclass('app_private.one_v_one_map_rules') is null
     or to_regprocedure('public.is_admin()') is null
     or to_regprocedure('app_private.has_active_ban(uuid,text,uuid)') is null then
    raise exception 'Run the merged Player 01, Admin 02, Security, and Multi-device 01 queries first';
  end if;
end
$player_01_test_mode_prerequisites$;

alter table public.player_stats
  add column if not exists admin_test_mode_enabled boolean not null default false;
alter table public.player_progression_runs
  add column if not exists test_mode boolean not null default false;
alter table public.multiplayer_players
  add column if not exists test_mode boolean not null default false;
alter table public.player_unlocks
  add column if not exists ownership_proven_at timestamptz
    default clock_timestamp();
update public.player_unlocks
set ownership_proven_at=clock_timestamp()
where ownership_proven_at is null;
alter table public.player_unlocks
  alter column ownership_proven_at set default clock_timestamp(),
  alter column ownership_proven_at set not null;

-- Alley doubles HP. The largest testable kit (Colossus) therefore reaches
-- exactly 20 HP; keep the authoritative state constraints aligned with that
-- legitimate snapshot while still rejecting negative or over-max values.
alter table public.multiplayer_players
  drop constraint if exists multiplayer_players_hearts_check,
  drop constraint if exists multiplayer_players_max_hearts_check,
  drop constraint if exists multiplayer_players_hearts_within_character_max_check;
alter table public.multiplayer_players
  add constraint multiplayer_players_max_hearts_check
    check(max_hearts between 1 and 20) not valid,
  add constraint multiplayer_players_hearts_check
    check(hearts between 0 and 20) not valid,
  add constraint multiplayer_players_hearts_within_character_max_check
    check(hearts<=max_hearts) not valid;
alter table public.multiplayer_players
  validate constraint multiplayer_players_max_hearts_check;
alter table public.multiplayer_players
  validate constraint multiplayer_players_hearts_check;
alter table public.multiplayer_players
  validate constraint multiplayer_players_hearts_within_character_max_check;

comment on column public.player_stats.admin_test_mode_enabled is
  'Admin-only saved Test Mode preference. Eligibility is rechecked server-side.';
comment on column public.player_progression_runs.test_mode is
  'Sticky server snapshot. Test runs never award permanent progression or rankings.';
comment on column public.multiplayer_players.test_mode is
  'Sticky per-player 1v1 Test Mode snapshot. Test players cannot enter Ranked.';

create table if not exists app_private.character_ownership_resets(
  reset_key text primary key,
  reset_scope text not null,
  reset_at timestamptz not null,
  affected_users integer not null default 0,
  revoked_characters integer not null default 0,
  preserved_non_character_unlocks integer not null default 0,
  completed_at timestamptz
);
revoke all on table app_private.character_ownership_resets
  from public,anon,authenticated;

create table if not exists app_private.player_unlock_quarantine(
  batch_key text not null,
  user_id uuid not null,
  item_key text not null,
  item_type text not null,
  rarity text not null,
  original_unlocked_at timestamptz not null,
  quarantined_at timestamptz not null default now(),
  reason text not null,
  primary key(batch_key,user_id,item_key)
);
revoke all on table app_private.player_unlock_quarantine
  from public,anon,authenticated;

create or replace function app_private.is_admin_test_user(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select p_user_id is not null
    and exists(
      select 1 from public.admin_users admin
      join public.player_stats stats on stats.user_id=admin.user_id
      where admin.user_id=p_user_id
        and admin.role in('main','co_admin')
        and stats.admin_test_mode_enabled
    )
    and not app_private.has_active_ban(p_user_id,'account',null);
$$;
revoke all on function app_private.is_admin_test_user(uuid)
  from public,anon,authenticated;

-- Execute the requested global reset exactly once. Historical receipts and
-- command history remain intact, but the reset timestamp is the new ownership
-- proof boundary for future Player 01 reruns.
do $player_01_global_character_reset$
declare
  v_reset_at timestamptz;
  v_non_character_unlocks integer;
  v_affected_users integer;
  v_revoked integer;
begin
  perform pg_advisory_xact_lock(
    hashtextextended('global-character-reset-2026-09-10',0)
  );
  if exists(
    select 1 from app_private.character_ownership_resets
    where reset_key='global-character-reset-2026-09-10'
  ) then return; end if;

  lock table public.player_stats in share row exclusive mode;
  lock table public.player_unlocks in share row exclusive mode;
  lock table public.player_loadouts in share row exclusive mode;
  lock table public.extraction_transactions in share row exclusive mode;
  if to_regclass('public.admin_command_audit') is not null then
    lock table public.admin_command_audit in share row exclusive mode;
  end if;

  v_reset_at:=clock_timestamp();
  insert into app_private.character_ownership_resets(
    reset_key,reset_scope,reset_at
  ) values(
    'global-character-reset-2026-09-10','global_characters',v_reset_at
  );
  perform set_config('skyway.character_reset_performed','true',true);

  select count(*)::integer into v_non_character_unlocks
  from public.player_unlocks unlock
  where unlock.item_type<>'character';

  insert into public.player_unlocks(
    user_id,item_key,item_type,rarity,unlocked_at
  )
  select users.id,starter.item_key,'character',starter.rarity,v_reset_at
  from auth.users users
  cross join(values
    ('runner_ace','common'),
    ('medic_patch','common'),
    ('tank_bulwark','common'),
    ('trickster_rogue','uncommon')
  ) starter(item_key,rarity)
  on conflict(user_id,item_key) do update
  set item_type='character',rarity=excluded.rarity;

  select count(distinct unlock.user_id)::integer,count(*)::integer
  into v_affected_users,v_revoked
  from public.player_unlocks unlock
  where unlock.item_type='character'
    and unlock.item_key not in(
      'runner_ace','medic_patch','tank_bulwark','trickster_rogue'
    );

  insert into app_private.player_unlock_quarantine(
    batch_key,user_id,item_key,item_type,rarity,original_unlocked_at,reason
  )
  select 'global-character-reset-2026-09-10',unlock.user_id,
    unlock.item_key,unlock.item_type,unlock.rarity,unlock.unlocked_at,
    'Global character reset requested by the main admin'
  from public.player_unlocks unlock
  where unlock.item_type='character'
    and unlock.item_key not in(
      'runner_ace','medic_patch','tank_bulwark','trickster_rogue'
    )
  on conflict(batch_key,user_id,item_key) do nothing;

  update public.player_loadouts loadout
  set class_key=case catalog.character_class
        when 'medic' then 'medic'
        when 'tank' then 'tank'
        when 'trickster' then 'trickster'
        else 'runner'
      end,
      character_key=case catalog.character_class
        when 'medic' then 'medic_patch'
        when 'tank' then 'tank_bulwark'
        when 'trickster' then 'trickster_rogue'
        else 'runner_ace'
      end,
      updated_at=now()
  from public.extraction_catalog catalog
  where catalog.item_key=loadout.character_key
    and catalog.item_type='character'
    and loadout.character_key not in(
      'runner_ace','medic_patch','tank_bulwark','trickster_rogue'
    );

  delete from public.player_unlocks unlock
  where unlock.item_type='character'
    and unlock.item_key not in(
      'runner_ace','medic_patch','tank_bulwark','trickster_rogue'
    );

  update public.player_loadouts loadout
  set class_key='runner',character_key='runner_ace',updated_at=now()
  where not exists(
    select 1 from public.player_unlocks unlock
    where unlock.user_id=loadout.user_id
      and unlock.item_type='character'
      and unlock.item_key=loadout.character_key
  );

  if (select count(*) from public.player_unlocks
      where item_type<>'character')<>v_non_character_unlocks then
    raise exception 'Character reset changed a non-character unlock';
  end if;

  update app_private.character_ownership_resets
  set affected_users=coalesce(v_affected_users,0),
      revoked_characters=coalesce(v_revoked,0),
      preserved_non_character_unlocks=v_non_character_unlocks,
      completed_at=clock_timestamp()
  where reset_key='global-character-reset-2026-09-10';
end
$player_01_global_character_reset$;

create or replace function public.get_admin_test_mode()
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_uid uuid:=auth.uid();
  v_role text;
begin
  if v_uid is null then raise exception 'Sign in required'; end if;
  select admin.role into v_role
  from public.admin_users admin
  where admin.user_id=v_uid
    and admin.role in('main','co_admin')
    and not app_private.has_active_ban(v_uid,'account',null);
  return jsonb_build_object(
    'enabled',v_role is not null and app_private.is_admin_test_user(v_uid),
    'eligible',v_role is not null,
    'role',v_role
  );
end;
$$;

create or replace function public.set_admin_test_mode(p_enabled boolean)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_uid uuid:=auth.uid();
  v_role text;
begin
  if v_uid is null then raise exception 'Sign in required'; end if;
  if p_enabled is null then raise exception 'Test Mode choice is required'; end if;
  select admin.role into v_role
  from public.admin_users admin
  where admin.user_id=v_uid
    and admin.role in('main','co_admin')
    and not app_private.has_active_ban(v_uid,'account',null)
  for update;
  if v_role is null then
    raise exception 'Test Mode is only available to admins';
  end if;

  insert into public.player_stats(
    user_id,total_gems,high_score,admin_test_mode_enabled,updated_at
  ) values(v_uid,0,0,p_enabled,now())
  on conflict(user_id) do update
  set admin_test_mode_enabled=excluded.admin_test_mode_enabled,
      updated_at=now();

  delete from public.multiplayer_queue where user_id=v_uid;

  if not p_enabled then
    update public.player_loadouts loadout
    set class_key='runner',character_key='runner_ace',updated_at=now()
    where loadout.user_id=v_uid
      and not exists(
        select 1 from public.player_unlocks unlock
        where unlock.user_id=v_uid
          and unlock.item_type='character'
          and unlock.item_key=loadout.character_key
      );
  end if;

  return jsonb_build_object(
    'enabled',p_enabled,'eligible',true,'role',v_role,
    'applies_to_active_run',false
  );
end;
$$;

revoke all on function public.get_admin_test_mode()
  from public,anon,authenticated;
revoke all on function public.set_admin_test_mode(boolean)
  from public,anon,authenticated;
grant execute on function public.get_admin_test_mode() to authenticated;
grant execute on function public.set_admin_test_mode(boolean) to authenticated;

-- Loadouts may use a catalog character without ownership only while the same
-- account is an eligible admin with Test Mode enabled. No unlock row is made.
create or replace function public.sync_player_loadout_character_class()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_character_class text;
begin
  select character_class into v_character_class
  from public.extraction_catalog
  where item_key=new.character_key and item_type='character' and active;
  if v_character_class is null then raise exception 'Unknown loadout character'; end if;
  if not exists(
    select 1 from public.player_unlocks unlock
    where unlock.user_id=new.user_id
      and unlock.item_key=new.character_key
      and unlock.item_type='character'
  ) and not app_private.is_admin_test_user(new.user_id) then
    raise exception 'Loadout character is not owned';
  end if;
  new.class_key:=v_character_class;
  return new;
end;
$$;
revoke all on function public.sync_player_loadout_character_class()
  from public,anon,authenticated;

create or replace function public.set_loadout(p_slot text,p_item text)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  v_uid uuid:=auth.uid();
  v_slot text:=lower(trim(p_slot));
  v_item text:=lower(trim(coalesce(p_item,'')));
  v_required_class text;
  v_current_class text;
  v_current_character text;
  v_next_character text;
  v_test_mode boolean:=false;
begin
  if v_uid is null then raise exception 'Sign in required'; end if;
  if v_slot not in('class','character','player','obstacle','environment') then
    raise exception 'Invalid loadout slot';
  end if;
  v_test_mode:=app_private.is_admin_test_user(v_uid);

  if v_slot in('player','obstacle','environment')
     and v_item in('','default','none') then
    insert into public.player_loadouts(user_id)
    values(v_uid) on conflict(user_id) do nothing;
    update public.player_loadouts
    set player_cosmetic=case when v_slot='player' then null else player_cosmetic end,
        obstacle_cosmetic=case when v_slot='obstacle' then null else obstacle_cosmetic end,
        environment_cosmetic=case when v_slot='environment' then null else environment_cosmetic end,
        updated_at=now()
    where user_id=v_uid;
    return;
  end if;
  if v_item='' then raise exception 'Invalid loadout item'; end if;

  insert into public.player_loadouts(user_id)
  values(v_uid) on conflict(user_id) do nothing;
  select class_key,character_key into v_current_class,v_current_character
  from public.player_loadouts where user_id=v_uid for update;

  if v_slot='class' then
    if v_item not in('runner','medic','tank','trickster','misc') then
      raise exception 'Invalid class';
    end if;
    if not v_test_mode
       and v_item<>'runner'
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
       ) then raise exception 'Class is not unlocked'; end if;

    if v_current_class=v_item and exists(
      select 1 from public.extraction_catalog catalog
      left join public.player_unlocks unlock
        on unlock.user_id=v_uid and unlock.item_key=catalog.item_key
       and unlock.item_type='character'
      where catalog.item_key=v_current_character
        and catalog.item_type='character' and catalog.active
        and catalog.character_class=v_item
        and (unlock.item_key is not null or v_test_mode)
    ) then
      v_next_character:=v_current_character;
    elsif v_test_mode then
      select catalog.item_key into v_next_character
      from public.extraction_catalog catalog
      where catalog.item_type='character' and catalog.active
        and catalog.character_class=v_item
      order by catalog.extractable,catalog.item_key limit 1;
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
      raise exception 'No available character exists for this class';
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
    if not v_test_mode and not exists(
      select 1 from public.player_unlocks
      where user_id=v_uid and item_key=v_item and item_type='character'
    ) then raise exception 'Character is not unlocked'; end if;
    update public.player_loadouts
    set class_key=v_required_class,character_key=v_item,updated_at=now()
    where user_id=v_uid;
    return;
  end if;

  if not exists(
    select 1 from public.player_unlocks
    where user_id=v_uid and item_key=v_item and item_type=v_slot
  ) then raise exception 'Item is not unlocked for this slot'; end if;
  update public.player_loadouts
  set player_cosmetic=case when v_slot='player' then v_item else player_cosmetic end,
      obstacle_cosmetic=case when v_slot='obstacle' then v_item else obstacle_cosmetic end,
      environment_cosmetic=case when v_slot='environment' then v_item else environment_cosmetic end,
      updated_at=now()
  where user_id=v_uid;
end;
$$;
revoke all on function public.set_loadout(text,text)
  from public,anon,authenticated;
grant execute on function public.set_loadout(text,text) to authenticated;

create or replace function app_private.snapshot_progression_test_mode()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  new.test_mode:=app_private.is_admin_test_user(new.user_id);
  return new;
end;
$$;
revoke all on function app_private.snapshot_progression_test_mode()
  from public,anon,authenticated;
drop trigger if exists snapshot_progression_test_mode
  on public.player_progression_runs;
create trigger snapshot_progression_test_mode
before insert on public.player_progression_runs
for each row execute function app_private.snapshot_progression_test_mode();

create or replace function app_private.snapshot_1v1_test_mode()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  new.test_mode:=app_private.is_admin_test_user(new.user_id);
  return new;
end;
$$;
revoke all on function app_private.snapshot_1v1_test_mode()
  from public,anon,authenticated;
drop trigger if exists snapshot_1v1_test_mode on public.multiplayer_players;
create trigger snapshot_1v1_test_mode
before insert on public.multiplayer_players
for each row execute function app_private.snapshot_1v1_test_mode();

create or replace function app_private.guard_ranked_test_queue()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if lower(coalesce(new.mode,'casual'))='ranked'
     and app_private.is_admin_test_user(new.user_id) then
    raise exception 'Test Mode can only enter Casual 1v1';
  end if;
  return new;
end;
$$;
revoke all on function app_private.guard_ranked_test_queue()
  from public,anon,authenticated;

create or replace function app_private.guard_ranked_test_match()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if lower(coalesce(new.mode,'casual'))='ranked'
     and (app_private.is_admin_test_user(new.host_user_id)
          or app_private.is_admin_test_user(new.guest_user_id)
          or exists(
            select 1 from public.multiplayer_players player
            where player.match_id=new.id and player.test_mode
          )) then
    raise exception 'Test Mode can only enter Casual 1v1';
  end if;
  return new;
end;
$$;
revoke all on function app_private.guard_ranked_test_match()
  from public,anon,authenticated;
drop trigger if exists guard_ranked_test_queue on public.multiplayer_queue;
create trigger guard_ranked_test_queue
before insert or update of mode,user_id on public.multiplayer_queue
for each row execute function app_private.guard_ranked_test_queue();
drop trigger if exists guard_ranked_test_match on public.multiplayer_matches;
create trigger guard_ranked_test_match
before insert or update of mode,host_user_id,guest_user_id
on public.multiplayer_matches
for each row execute function app_private.guard_ranked_test_match();

create or replace function public.get_1v1_test_mode(p_match_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_uid uuid:=auth.uid();
  v_test_mode boolean;
begin
  if v_uid is null then raise exception 'Sign in required'; end if;
  select player.test_mode into v_test_mode
  from public.multiplayer_players player
  where player.match_id=p_match_id and player.user_id=v_uid;
  if v_test_mode is null then raise exception '1v1 match not found'; end if;
  return v_test_mode;
end;
$$;
revoke all on function public.get_1v1_test_mode(uuid)
  from public,anon,authenticated;
grant execute on function public.get_1v1_test_mode(uuid) to authenticated;

create or replace function app_private.one_v_one_character_snapshot(
  p_user_id uuid,
  p_map_key text
)
returns table(
  character_key text,
  character_class text,
  max_hearts numeric,
  starting_hearts numeric
)
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_key text;
  v_class text;
  v_test_mode boolean:=app_private.is_admin_test_user(p_user_id);
  v_allowed text[];
  v_forced text;
  v_base_max numeric;
  v_base_start numeric;
  v_multiplier numeric;
  v_bonus numeric;
begin
  select loadout.character_key,catalog.character_class
  into v_key,v_class
  from public.player_loadouts loadout
  join public.extraction_catalog catalog
    on catalog.item_key=loadout.character_key
   and catalog.item_type='character' and catalog.active
  left join public.player_unlocks unlock
    on unlock.user_id=loadout.user_id
   and unlock.item_key=loadout.character_key
   and unlock.item_type='character'
  where loadout.user_id=p_user_id
    and (unlock.item_key is not null or v_test_mode);
  v_key:=coalesce(v_key,'runner_ace');
  v_class:=coalesce(v_class,'runner');

  select rules.allowed_character_classes,rules.forced_character_key,
         coalesce((rules.gameplay_rules->>'hp_multiplier')::numeric,1),
         coalesce((rules.gameplay_rules->>'hp_bonus')::numeric,0)
  into v_allowed,v_forced,v_multiplier,v_bonus
  from app_private.one_v_one_map_rules rules
  where rules.map_key=p_map_key;

  if not v_test_mode then
    if v_forced is not null then
      v_key:=v_forced;
      v_class:='runner';
    elsif not (v_class=any(v_allowed)) then
      v_key:='runner_ace';
      v_class:='runner';
    end if;
  end if;

  v_base_max:=case
    when v_key='tank_atlas' then 7
    when v_key='tank_colossus' then 10
    when v_key='medic_beacon' then 5.5
    when v_key='tank_guard' then 4.5
    when v_key='medic_patch' then 4
    when v_key in('medic_suture','tank_hammer') then 5
    when v_class='tank' then 4
    when v_class='trickster' then 2
    else 3
  end;
  v_base_start:=case
    when v_class='tank' then 4
    when v_class='trickster' then 2
    else 3
  end;

  return query select v_key,v_class,
    (v_base_max*v_multiplier+v_bonus)::numeric,
    (v_base_start*v_multiplier+v_bonus)::numeric;
end;
$$;
revoke all on function app_private.one_v_one_character_snapshot(uuid,text)
  from public,anon,authenticated;

create or replace function app_private.is_test_run_context(
  p_context_id uuid,
  p_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select exists(
    select 1 from public.player_progression_runs run
    where run.run_id=p_context_id and run.user_id=p_user_id and run.test_mode
  ) or exists(
    select 1 from public.multiplayer_players player
    where player.match_id=p_context_id and player.user_id=p_user_id
      and player.test_mode
  );
$$;
revoke all on function app_private.is_test_run_context(uuid,uuid)
  from public,anon,authenticated;

-- Preserve the current receipt-backed award implementations behind private
-- names, then put a test-snapshot guard at the public API boundary.
do $player_01_wrap_test_awards$
begin
  -- A full Player 01 rerun recreates the public live implementations before
  -- reaching this extension. Refresh the private copies in that case, while a
  -- standalone rerun keeps the already-wrapped implementations untouched.
  if to_regprocedure('app_private.claim_player_gem_live(uuid,text)') is not null
     and to_regprocedure('public.claim_player_gem(uuid,text)') is not null
     and position(
       'app_private.claim_player_gem_live' in pg_get_functiondef(
         to_regprocedure('public.claim_player_gem(uuid,text)')
       )
     )=0 then
    drop function app_private.claim_player_gem_live(uuid,text);
  end if;
  if to_regprocedure('app_private.claim_player_gem_live(uuid,text)') is null then
    if to_regprocedure('public.claim_player_gem(uuid,text)') is null then
      raise exception 'Player gem claim RPC is missing';
    end if;
    alter function public.claim_player_gem(uuid,text)
      rename to claim_player_gem_live;
    alter function public.claim_player_gem_live(uuid,text)
      set schema app_private;
  end if;
  if to_regprocedure(
       'app_private.award_completed_run_v2_live(uuid,bigint,text)'
     ) is not null
     and to_regprocedure(
       'public.award_completed_run_v2(uuid,bigint,text)'
     ) is not null
     and position(
       'app_private.award_completed_run_v2_live' in pg_get_functiondef(
         to_regprocedure(
           'public.award_completed_run_v2(uuid,bigint,text)'
         )
       )
     )=0 then
    drop function app_private.award_completed_run_v2_live(uuid,bigint,text);
  end if;
  if to_regprocedure(
       'app_private.award_completed_run_v2_live(uuid,bigint,text)'
     ) is null then
    if to_regprocedure('public.award_completed_run_v2(uuid,bigint,text)') is null then
      raise exception 'Completed run award RPC is missing';
    end if;
    alter function public.award_completed_run_v2(uuid,bigint,text)
      rename to award_completed_run_v2_live;
    alter function public.award_completed_run_v2_live(uuid,bigint,text)
      set schema app_private;
  end if;
end
$player_01_wrap_test_awards$;

revoke all on function app_private.claim_player_gem_live(uuid,text)
  from public,anon,authenticated;
revoke all on function app_private.award_completed_run_v2_live(uuid,bigint,text)
  from public,anon,authenticated;

create or replace function public.claim_player_gem(
  p_context_id uuid,
  p_pickup_id text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_uid uuid:=auth.uid();
  v_pickup_id text:=trim(p_pickup_id);
  v_total bigint;
  v_test_context_active boolean;
begin
  -- The private live implementation retains the verified heartbeat_active and
  -- active_seconds envelope, including "Gem pickups arrived too quickly".
  if v_uid is null then raise exception 'Sign in required'; end if;
  if p_context_id is null or v_pickup_id is null
     or length(v_pickup_id) not between 1 and 120 then
    raise exception 'Valid gem context and pickup ID are required';
  end if;
  if app_private.is_test_run_context(p_context_id,v_uid) then
    select exists(
      select 1 from public.player_progression_runs run
      where run.run_id=p_context_id and run.user_id=v_uid and run.test_mode
        and run.completed_at is null
        and run.started_at>now()-interval '6 hours'
        and run.heartbeat_active
        and run.last_heartbeat_at>=clock_timestamp()-interval '8 seconds'
    ) or exists(
      select 1
      from public.multiplayer_matches match
      join public.multiplayer_players player
        on player.match_id=match.id and player.user_id=v_uid
      join public.player_progression_1v1_activity activity
        on activity.match_id=match.id and activity.user_id=v_uid
      where match.id=p_context_id and player.test_mode
        and match.status='playing' and player.status='playing'
        and activity.heartbeat_active
        and activity.last_heartbeat_at>=clock_timestamp()-interval '8 seconds'
    ) into v_test_context_active;
    if not v_test_context_active then
      raise exception 'Gem collection requires active test play';
    end if;
    select total_gems into v_total
    from public.player_stats where user_id=v_uid;
    return jsonb_build_object(
      'total_gems',coalesce(v_total,0),'gems_awarded',0,'streak',0,
      'is_new',true,'test_mode',true,
      'progression',public.get_player_progression()
    );
  end if;
  return app_private.claim_player_gem_live(p_context_id,p_pickup_id);
end;
$$;

create or replace function public.award_completed_run_v2(
  p_run_id uuid,
  p_score bigint,
  p_scope text
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_uid uuid:=auth.uid();
  v_scope text:=lower(trim(p_scope));
  v_high_score bigint;
  v_context_valid boolean;
begin
  if v_uid is null then raise exception 'Sign in required'; end if;
  if p_run_id is null then raise exception 'Run ID is required'; end if;
  if p_score is null or p_score<0 or p_score>1000000000 then
    raise exception 'Invalid run score';
  end if;
  if v_scope is null
     or v_scope not in('endless','casual_1v1','ranked_1v1') then
    raise exception 'Invalid run type';
  end if;
  if app_private.is_test_run_context(p_run_id,v_uid) then
    select case
      when v_scope='endless' then exists(
        select 1 from public.player_progression_runs run
        where run.run_id=p_run_id and run.user_id=v_uid and run.test_mode
      )
      else exists(
        select 1
        from public.multiplayer_matches match
        join public.multiplayer_players player
          on player.match_id=match.id and player.user_id=v_uid
        where match.id=p_run_id and player.test_mode
          and match.status='finished'
          and v_scope=match.mode||'_1v1'
      )
    end into v_context_valid;
    if not v_context_valid then raise exception 'Invalid test run result'; end if;
    update public.player_progression_runs
    set completed_at=coalesce(completed_at,now()),claimed_score=p_score,
        credited_score=0,heartbeat_active=false
    where run_id=p_run_id and user_id=v_uid;
    select high_score into v_high_score
    from public.player_stats where user_id=v_uid;
    return public.get_player_progression()||jsonb_build_object(
      'xp_awarded',0,
      'xp_breakdown',jsonb_build_object(
        'score',0,'gems',0,'gem_count',0,'total',0
      ),
      'high_score',coalesce(v_high_score,0),'test_mode',true
    );
  end if;
  return app_private.award_completed_run_v2_live(p_run_id,p_score,v_scope);
end;
$$;

create or replace function public.award_completed_run(
  p_run_id uuid,p_score bigint,p_scope text
)
returns jsonb
language sql
security invoker
set search_path=''
as $$
  select public.award_completed_run_v2(p_run_id,p_score,p_scope);
$$;

revoke all on function public.claim_player_gem(uuid,text)
  from public,anon,authenticated;
revoke all on function public.award_completed_run_v2(uuid,bigint,text)
  from public,anon,authenticated;
revoke all on function public.award_completed_run(uuid,bigint,text)
  from public,anon,authenticated;
revoke all on function public.save_player_high_score(bigint)
  from public,anon,authenticated;
grant execute on function public.claim_player_gem(uuid,text) to authenticated;
grant execute on function public.award_completed_run_v2(uuid,bigint,text)
  to authenticated;
grant execute on function public.award_completed_run(uuid,bigint,text)
  to authenticated;

-- Defense in depth: even if a future caller bypasses the queue guard, a match
-- with a test snapshot is never recorded in Ranked history or Elo.
do $player_01_ranked_recorder_guard$
begin
  if to_regprocedure(
       'app_private.record_1v1_ranked_result_unchecked(uuid)'
     ) is not null
     and to_regprocedure(
       'app_private.record_1v1_ranked_result(uuid)'
     ) is not null
     and position(
       'app_private.record_1v1_ranked_result_unchecked' in pg_get_functiondef(
         to_regprocedure('app_private.record_1v1_ranked_result(uuid)')
       )
     )=0 then
    drop function app_private.record_1v1_ranked_result_unchecked(uuid);
  end if;
  if to_regprocedure(
       'app_private.record_1v1_ranked_result_unchecked(uuid)'
     ) is null then
    if to_regprocedure(
         'app_private.record_1v1_ranked_result(uuid)'
       ) is null then
      raise exception 'Ranked result recorder is missing';
    end if;
    alter function app_private.record_1v1_ranked_result(uuid)
      rename to record_1v1_ranked_result_unchecked;
  end if;
end
$player_01_ranked_recorder_guard$;

create or replace function app_private.record_1v1_ranked_result(
  p_match_id uuid
)
returns boolean
language plpgsql
security definer
set search_path=''
as $$
declare
  v_mode text;
begin
  select match.mode into v_mode
  from public.multiplayer_matches match where match.id=p_match_id;
  if v_mode is distinct from 'ranked' or exists(
    select 1 from public.multiplayer_players player
    where player.match_id=p_match_id and player.test_mode
  ) then return false; end if;
  return app_private.record_1v1_ranked_result_unchecked(p_match_id);
end;
$$;
revoke all on function app_private.record_1v1_ranked_result(uuid)
  from public,anon,authenticated;
revoke all on function app_private.record_1v1_ranked_result_unchecked(uuid)
  from public,anon,authenticated;

-- A removed/demoted admin cannot retain effective Test Mode or an unowned
-- saved character. Main↔co-admin role changes keep the preference.
create or replace function app_private.clear_departed_admin_test_mode()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if tg_op='DELETE'
     or (tg_op='UPDATE' and new.role not in('main','co_admin')) then
    update public.player_loadouts
    set class_key='runner',character_key='runner_ace',updated_at=now()
    where user_id=old.user_id
      and not exists(
        select 1 from public.player_unlocks unlock
        where unlock.user_id=old.user_id
          and unlock.item_type='character'
          and unlock.item_key=public.player_loadouts.character_key
      );
    update public.player_stats
    set admin_test_mode_enabled=false,updated_at=now()
    where user_id=old.user_id;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end;
$$;
revoke all on function app_private.clear_departed_admin_test_mode()
  from public,anon,authenticated;
drop trigger if exists clear_departed_admin_test_mode on public.admin_users;
create trigger clear_departed_admin_test_mode
after delete or update of role on public.admin_users
for each row execute function app_private.clear_departed_admin_test_mode();

alter table public.player_stats enable row level security;
alter table public.player_progression_runs enable row level security;
alter table public.multiplayer_players enable row level security;
revoke insert,update,delete on public.player_stats from authenticated;
revoke all on table public.player_progression_runs from public,anon,authenticated;

do $player_01_test_mode_assertions$
begin
  if current_setting('skyway.character_reset_performed',true)='true'
     and exists(
    select 1 from public.player_unlocks unlock
    where unlock.item_type='character'
      and unlock.item_key not in(
        'runner_ace','medic_patch','tank_bulwark','trickster_rogue'
      )
  ) then raise exception 'A non-default character remained after the reset'; end if;
  if exists(
    select 1 from auth.users users
    cross join(values
      ('runner_ace'),('medic_patch'),('tank_bulwark'),('trickster_rogue')
    ) starter(item_key)
    left join public.player_unlocks unlock
      on unlock.user_id=users.id and unlock.item_key=starter.item_key
     and unlock.item_type='character'
    where unlock.item_key is null
  ) then raise exception 'A player is missing a default character'; end if;
  if exists(
    select 1 from public.player_loadouts loadout
    left join public.player_unlocks unlock
      on unlock.user_id=loadout.user_id
     and unlock.item_type='character'
     and unlock.item_key=loadout.character_key
    where unlock.item_key is null
      and not exists(
        select 1
        from public.admin_users admin
        join public.player_stats stats on stats.user_id=admin.user_id
        join public.extraction_catalog catalog
          on catalog.item_key=loadout.character_key
         and catalog.item_type='character' and catalog.active
        where admin.user_id=loadout.user_id
          and admin.role in('main','co_admin')
          and stats.admin_test_mode_enabled
      )
  ) then raise exception 'An unowned character remained equipped'; end if;
  if has_function_privilege(
       'anon','public.set_admin_test_mode(boolean)','EXECUTE'
     ) or not has_function_privilege(
       'authenticated','public.set_admin_test_mode(boolean)','EXECUTE'
     ) or has_function_privilege(
       'anon','public.get_1v1_test_mode(uuid)','EXECUTE'
     ) or not has_function_privilege(
       'authenticated','public.get_1v1_test_mode(uuid)','EXECUTE'
     ) then raise exception 'Test Mode RPC privileges are incorrect'; end if;
  if has_function_privilege(
       'authenticated','public.save_player_high_score(bigint)','EXECUTE'
     ) or has_function_privilege(
       'anon','public.save_player_high_score(bigint)','EXECUTE'
     ) then raise exception 'Direct high-score saving became callable'; end if;
  if to_regprocedure(
       'app_private.claim_player_gem_live(uuid,text)'
     ) is null or to_regprocedure(
       'app_private.award_completed_run_v2_live(uuid,bigint,text)'
     ) is null then
    raise exception 'Verified reward implementations were not preserved';
  end if;
  if position('heartbeat_active' in pg_get_functiondef(
       to_regprocedure('app_private.claim_player_gem_live(uuid,text)')
     ))=0
     or position('active_seconds' in pg_get_functiondef(
       to_regprocedure(
         'app_private.award_completed_run_v2_live(uuid,bigint,text)'
       )
     ))=0 then
    raise exception 'Verified reward implementations were not preserved';
  end if;
  if to_regprocedure(
       'app_private.record_1v1_ranked_result(uuid)'
     ) is null then raise exception 'Ranked Test Mode guard is missing'; end if;
  if position('player.test_mode' in pg_get_functiondef(
       to_regprocedure('app_private.record_1v1_ranked_result(uuid)')
     ))=0 then raise exception 'Ranked Test Mode guard is missing'; end if;
  if exists(
    select 1
    from(values
      ('runner_ace','runner'),('medic_patch','medic'),
      ('tank_bulwark','tank'),('trickster_rogue','trickster')
    ) starter(item_key,character_class)
    left join public.extraction_catalog catalog
      on catalog.item_key=starter.item_key and catalog.item_type='character'
    where catalog.item_key is null or not catalog.active
       or catalog.character_class<>starter.character_class
  ) then raise exception 'A default character is missing from the catalog'; end if;
  if has_table_privilege('authenticated','public.player_stats','UPDATE')
     or has_table_privilege(
       'authenticated','public.player_progression_runs','SELECT'
     ) then raise exception 'Test Mode storage is exposed to browser writes'; end if;
end
$player_01_test_mode_assertions$;

notify pgrst,'reload schema';
commit;

select
  reset.reset_at,
  reset.affected_users,
  reset.revoked_characters,
  reset.preserved_non_character_unlocks,
  (select count(*) from public.player_unlocks unlock
    where unlock.item_type='character'
      and unlock.item_key not in(
        'runner_ace','medic_patch','tank_bulwark','trickster_rogue'
      )) as currently_owned_non_default_characters,
  (select count(*) from auth.users users
    cross join(values
      ('runner_ace'),('medic_patch'),('tank_bulwark'),('trickster_rogue')
    ) starter(item_key)
    left join public.player_unlocks unlock
      on unlock.user_id=users.id and unlock.item_key=starter.item_key
     and unlock.item_type='character'
    where unlock.item_key is null) as missing_default_characters,
  to_regprocedure('public.set_admin_test_mode(boolean)') is not null
    as admin_test_mode_installed
from app_private.character_ownership_resets reset
where reset.reset_key='global-character-reset-2026-09-10';
