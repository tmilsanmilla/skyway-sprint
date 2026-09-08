-- Player 01 Stats — repair accidental all-character ownership.
--
-- The only automatic character grants are Ace, Patch, Bulwark, and Rogue.
-- Every other character must have a successful paid-extraction receipt or a
-- successful admin-grant audit row. Unproven rows are quarantined before they
-- are removed, and an invalid equipped character falls back to the starter for
-- its gameplay class (or Ace for the Misc section).

begin;

do $$
begin
  if to_regclass('public.player_stats') is null
     or to_regclass('public.player_unlocks') is null
     or to_regclass('public.player_loadouts') is null
     or to_regclass('public.extraction_catalog') is null
     or to_regclass('public.extraction_transactions') is null then
    raise exception 'Run the merged Player 01 Stats query first';
  end if;
  if (select count(*) from public.extraction_catalog
      where item_type='character' and active)<>80 then
    raise exception 'Run the merged 80-character Player 01 Stats query first';
  end if;
end
$$;

-- Enforce the current four-starter extraction boundary without deriving any
-- ownership from the catalog itself.
update public.extraction_catalog
set extractable=item_key not in(
  'runner_ace','medic_patch','tank_bulwark','trickster_rogue'
)
where item_type='character' and active;

insert into public.player_stats(user_id,total_gems,high_score,updated_at)
select users.id,0,0,now() from auth.users users
on conflict(user_id) do nothing;

insert into public.player_unlocks(
  user_id,item_key,item_type,rarity,unlocked_at
)
select users.id,starter.item_key,starter.item_type,starter.rarity,now()
from auth.users users
cross join(values
  ('runner','class','common'),('medic','class','common'),
  ('tank','class','common'),('trickster','class','common'),
  ('runner_ace','character','common'),
  ('medic_patch','character','common'),
  ('tank_bulwark','character','common'),
  ('trickster_rogue','character','uncommon')
) starter(item_key,item_type,rarity)
on conflict(user_id,item_key) do update
set item_type=excluded.item_type,rarity=excluded.rarity;

insert into public.player_loadouts(user_id,class_key,character_key,updated_at)
select users.id,'runner','runner_ace',now() from auth.users users
on conflict(user_id) do nothing;

-- Normalize existing rows before provenance checks, so a wrongly labelled
-- catalog character cannot evade the cleanup by claiming another item type.
update public.player_unlocks unlock
set item_type='character',rarity=catalog.rarity
from public.extraction_catalog catalog
where catalog.item_key=unlock.item_key and catalog.item_type='character'
  and (unlock.item_type is distinct from 'character'
       or unlock.rarity is distinct from catalog.rarity);

-- Future signups receive only the explicitly listed starter rows. Do not
-- replace this list with a catalog join or an equipped-loadout backfill.
create or replace function public.provision_player_starters()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into public.player_stats(user_id,total_gems,high_score,updated_at)
  values(new.id,0,0,now()) on conflict(user_id) do nothing;
  insert into public.player_unlocks(
    user_id,item_key,item_type,rarity,unlocked_at
  )
  select new.id,starter.item_key,starter.item_type,starter.rarity,now()
  from(values
    ('runner','class','common'),('medic','class','common'),
    ('tank','class','common'),('trickster','class','common'),
    ('runner_ace','character','common'),
    ('medic_patch','character','common'),
    ('tank_bulwark','character','common'),
    ('trickster_rogue','character','uncommon')
  ) starter(item_key,item_type,rarity)
  on conflict(user_id,item_key) do update
  set item_type=excluded.item_type,rarity=excluded.rarity;
  insert into public.player_loadouts(
    user_id,class_key,character_key,updated_at
  ) values(new.id,'runner','runner_ace',now())
  on conflict(user_id) do nothing;
  return new;
end;
$$;
revoke all on function public.provision_player_starters()
  from public,anon,authenticated;
drop trigger if exists provision_player_starters_after_signup on auth.users;
create trigger provision_player_starters_after_signup
after insert on auth.users
for each row execute function public.provision_player_starters();

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

-- Freeze ownership writes while the proof snapshot and cleanup run. Both box
-- extraction and admin grants write player_unlocks before their receipt/audit
-- row, so this order lets an in-flight transaction finish and prevents a new
-- legitimate unlock from landing between verification and deletion.
lock table public.player_unlocks in share row exclusive mode;
lock table public.player_loadouts in share row exclusive mode;
lock table public.extraction_transactions in share row exclusive mode;
do $player_01_lock_admin_audit$
begin
  if to_regclass('public.admin_command_audit') is not null then
    execute 'lock table public.admin_command_audit in share row exclusive mode';
  end if;
end
$player_01_lock_admin_audit$;

create temporary table verified_character_ownership(
  user_id uuid not null,
  item_key text not null,
  source text not null,
  proof_at timestamptz not null,
  primary key(user_id,item_key)
) on commit drop;

insert into verified_character_ownership(user_id,item_key,source,proof_at)
select users.id,starter.item_key,'starter','infinity'::timestamptz
from auth.users users
cross join(values
  ('runner_ace'),('medic_patch'),('tank_bulwark'),('trickster_rogue')
) starter(item_key);

insert into verified_character_ownership(user_id,item_key,source,proof_at)
select distinct on(receipt.user_id,receipt.item_key)
  receipt.user_id,receipt.item_key,'extraction',receipt.created_at
from public.extraction_transactions receipt
join public.extraction_catalog catalog on catalog.item_key=receipt.item_key
  and catalog.item_type='character'
where receipt.item_type='character' and receipt.is_new
order by receipt.user_id,receipt.item_key,receipt.created_at desc,receipt.id desc
on conflict(user_id,item_key) do update
set source=excluded.source,proof_at=excluded.proof_at
where verified_character_ownership.source<>'starter'
  and excluded.proof_at>verified_character_ownership.proof_at;

do $player_01_admin_proof$
begin
  if to_regclass('public.admin_command_audit') is not null then
    execute $sql$
      insert into verified_character_ownership(
        user_id,item_key,source,proof_at
      )
      select distinct on(audit.target_user_id,audit.result->>'item_key')
        audit.target_user_id,audit.result->>'item_key','admin_grant',
        audit.created_at
      from public.admin_command_audit audit
      join public.extraction_catalog catalog
        on catalog.item_key=audit.result->>'item_key'
       and catalog.item_type='character'
      where audit.succeeded and audit.action='grant'
        and audit.target_user_id is not null
        and audit.result->>'item_type'='character'
        and audit.result->>'granted'='true'
      order by audit.target_user_id,audit.result->>'item_key',
        audit.created_at desc,audit.id desc
      on conflict(user_id,item_key) do update
      set source=excluded.source,proof_at=excluded.proof_at
      where verified_character_ownership.source<>'starter'
        and excluded.proof_at>verified_character_ownership.proof_at
    $sql$;
    execute $sql$
      delete from verified_character_ownership proof
      using public.admin_command_audit audit
      where proof.source<>'starter'
        and audit.succeeded and audit.action='revoke'
        and audit.target_user_id=proof.user_id
        and audit.result->>'item_key'=proof.item_key
        and audit.result->>'item_type'='character'
        and audit.result->>'revoked'='true'
        and audit.created_at>=proof.proof_at
    $sql$;
  end if;
end
$player_01_admin_proof$;

-- Recreate only ownership that has authoritative positive proof. This protects
-- legitimate purchases/grants if an older cleanup removed their unlock row.
insert into public.player_unlocks(
  user_id,item_key,item_type,rarity,unlocked_at
)
select proof.user_id,proof.item_key,'character',catalog.rarity,proof.proof_at
from verified_character_ownership proof
join public.extraction_catalog catalog on catalog.item_key=proof.item_key
  and catalog.item_type='character'
where proof.source<>'starter'
on conflict(user_id,item_key) do update
set item_type=excluded.item_type,rarity=excluded.rarity;

-- Save unsupported rows before removal so a database owner can inspect or
-- restore them manually if external evidence appears later.
insert into app_private.player_unlock_quarantine(
  batch_key,user_id,item_key,item_type,rarity,original_unlocked_at,reason
)
select 'player-01-character-ownership-repair-v2-2026-09-06',
  unlock.user_id,unlock.item_key,unlock.item_type,unlock.rarity,
  unlock.unlocked_at,'No starter, extraction, or admin-grant proof'
from public.player_unlocks unlock
join public.extraction_catalog catalog on catalog.item_key=unlock.item_key
  and catalog.item_type='character'
left join verified_character_ownership proof
  on proof.user_id=unlock.user_id and proof.item_key=unlock.item_key
where unlock.item_type='character' and proof.item_key is null
on conflict(batch_key,user_id,item_key) do nothing;

-- Repair an invalid equipped kit before deleting its unsupported ownership.
update public.player_loadouts loadout
set class_key=case coalesce((
      select catalog.character_class from public.extraction_catalog catalog
      where catalog.item_key=loadout.character_key
        and catalog.item_type='character'
    ),loadout.class_key)
      when 'medic' then 'medic'
      when 'tank' then 'tank'
      when 'trickster' then 'trickster'
      else 'runner'
    end,
    character_key=case coalesce((
      select catalog.character_class from public.extraction_catalog catalog
      where catalog.item_key=loadout.character_key
        and catalog.item_type='character'
    ),loadout.class_key)
      when 'medic' then 'medic_patch'
      when 'tank' then 'tank_bulwark'
      when 'trickster' then 'trickster_rogue'
      else 'runner_ace'
    end,
    updated_at=now()
where not exists(
  select 1 from verified_character_ownership proof
  where proof.user_id=loadout.user_id
    and proof.item_key=loadout.character_key
);

delete from public.player_unlocks unlock
using public.extraction_catalog catalog
where catalog.item_key=unlock.item_key and catalog.item_type='character'
  and unlock.item_type='character'
  and not exists(
    select 1 from verified_character_ownership proof
    where proof.user_id=unlock.user_id and proof.item_key=unlock.item_key
  );

update public.player_loadouts loadout
set class_key=catalog.character_class,updated_at=now()
from public.extraction_catalog catalog
where catalog.item_key=loadout.character_key
  and catalog.item_type='character'
  and loadout.class_key is distinct from catalog.character_class;

-- Enforce ownership at the final loadout boundary. Catalog membership or a
-- stale equipped value can no longer manufacture ownership.
create or replace function public.sync_player_loadout_character_class()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_character_class text;
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
  ) then raise exception 'Loadout character is not owned'; end if;
  new.class_key:=v_character_class;
  return new;
end;
$$;
revoke all on function public.sync_player_loadout_character_class()
  from public,anon,authenticated;
drop trigger if exists sync_player_loadout_character_class
  on public.player_loadouts;
create trigger sync_player_loadout_character_class
before insert or update of class_key,character_key on public.player_loadouts
for each row execute function public.sync_player_loadout_character_class();

alter table public.player_unlocks enable row level security;
alter table public.player_loadouts enable row level security;
revoke all on table public.player_unlocks from public,anon,authenticated;
revoke all on table public.player_loadouts from public,anon,authenticated;
grant select on table public.player_unlocks to authenticated;
grant select on table public.player_loadouts to authenticated;

do $$
begin
  if (select count(*) from public.extraction_catalog
      where item_type='character' and active and not extractable)<>4
     or exists(
       select 1 from public.extraction_catalog
       where item_key in(
         'runner_ace','medic_patch','tank_bulwark','trickster_rogue'
       ) and (item_type<>'character' or not active or extractable)
     ) then raise exception 'Exactly four starter characters must be nonextractable'; end if;
  if exists(
    select 1 from auth.users users
    cross join(values
      ('runner_ace'),('medic_patch'),('tank_bulwark'),('trickster_rogue')
    ) starter(item_key)
    left join public.player_unlocks unlock on unlock.user_id=users.id
      and unlock.item_key=starter.item_key and unlock.item_type='character'
    where unlock.item_key is null
  ) then raise exception 'A player is missing an included starter character'; end if;
  if exists(
    select 1 from public.player_unlocks unlock
    join public.extraction_catalog catalog on catalog.item_key=unlock.item_key
      and catalog.item_type='character'
    left join verified_character_ownership proof
      on proof.user_id=unlock.user_id and proof.item_key=unlock.item_key
    where unlock.item_type='character' and proof.item_key is null
  ) then raise exception 'An unverified character unlock remains'; end if;
  if exists(
    select 1 from public.player_loadouts loadout
    left join public.player_unlocks unlock on unlock.user_id=loadout.user_id
      and unlock.item_key=loadout.character_key
      and unlock.item_type='character'
    where unlock.item_key is null
  ) then raise exception 'A loadout uses an unowned character'; end if;
  if has_table_privilege('authenticated','public.player_unlocks','INSERT')
     or has_table_privilege('authenticated','public.player_unlocks','UPDATE')
     or has_table_privilege('authenticated','public.player_unlocks','DELETE')
     or has_table_privilege('authenticated','public.player_loadouts','INSERT')
     or has_table_privilege('authenticated','public.player_loadouts','UPDATE')
     or has_table_privilege('authenticated','public.player_loadouts','DELETE') then
    raise exception 'Direct authenticated inventory writes are enabled';
  end if;
end
$$;

notify pgrst,'reload schema';
commit;

select
  (select count(*) from public.extraction_catalog
    where item_type='character' and active) as active_characters,
  (select count(*) from public.extraction_catalog
    where item_type='character' and active and extractable)
    as extractable_characters,
  (select count(*) from app_private.player_unlock_quarantine
    where batch_key='player-01-character-ownership-repair-v2-2026-09-06')
    as quarantined_unproven_characters,
  (select count(*) from public.player_loadouts loadout
    left join public.player_unlocks unlock on unlock.user_id=loadout.user_id
      and unlock.item_key=loadout.character_key
      and unlock.item_type='character'
    where unlock.item_key is null) as invalid_loadouts,
  not has_table_privilege('authenticated','public.player_unlocks','INSERT')
    and not has_table_privilege('authenticated','public.player_unlocks','UPDATE')
    and not has_table_privilege('authenticated','public.player_unlocks','DELETE')
    as direct_unlock_writes_blocked;
