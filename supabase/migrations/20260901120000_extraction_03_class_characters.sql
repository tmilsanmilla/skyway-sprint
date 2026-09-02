-- Extraction 03 Class Characters
-- Each class has three built-in character choices. Unlocking a class unlocks
-- its character roster; runner characters are available to every account.

-- Pre-game powerup purchases were removed from the game. Drop only their
-- purchase RPC; historical stats columns remain intact for safe deployment.
drop function if exists public.buy_powerup(text);

alter table public.player_loadouts
  add column if not exists character_key text not null default 'runner_ace';

alter table public.player_loadouts
  alter column character_key set default 'runner_ace';

-- Give existing class loadouts a compatible default. The predicate also makes
-- this safe to rerun without replacing a character the player already chose.
update public.player_loadouts
set character_key = case class_key
  when 'medic' then 'medic_patch'
  when 'tank' then 'tank_bulwark'
  when 'trickster' then 'trickster_rogue'
  else 'runner_ace'
end,
updated_at = now()
where character_key is null
   or character_key not in (
     'runner_ace', 'runner_scout', 'runner_ranger',
     'medic_patch', 'medic_mercy', 'medic_vial',
     'tank_bulwark', 'tank_hammer', 'tank_sentinel',
     'trickster_rogue', 'trickster_jester', 'trickster_phantom'
   )
   or (class_key = 'runner' and character_key not in ('runner_ace', 'runner_scout', 'runner_ranger'))
   or (class_key = 'medic' and character_key not in ('medic_patch', 'medic_mercy', 'medic_vial'))
   or (class_key = 'tank' and character_key not in ('tank_bulwark', 'tank_hammer', 'tank_sentinel'))
   or (class_key = 'trickster' and character_key not in ('trickster_rogue', 'trickster_jester', 'trickster_phantom'));

alter table public.player_loadouts
  alter column character_key set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.player_loadouts'::regclass
      and conname = 'player_loadouts_character_key_check'
  ) then
    alter table public.player_loadouts
      add constraint player_loadouts_character_key_check
      check (character_key in (
        'runner_ace', 'runner_scout', 'runner_ranger',
        'medic_patch', 'medic_mercy', 'medic_vial',
        'tank_bulwark', 'tank_hammer', 'tank_sentinel',
        'trickster_rogue', 'trickster_jester', 'trickster_phantom'
      )) not valid;
  end if;
end
$$;

alter table public.player_loadouts
  validate constraint player_loadouts_character_key_check;

comment on column public.player_loadouts.character_key is
  'Selected class character. The set_loadout RPC enforces class ownership and compatibility.';

create or replace function public.set_loadout(p_slot text, p_item text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_slot text := lower(trim(p_slot));
  v_item text := trim(p_item);
  v_required_class text;
  v_current_class text;
begin
  if v_uid is null then
    raise exception 'Sign in required';
  end if;
  if v_slot not in ('class', 'character', 'player', 'obstacle', 'environment') then
    raise exception 'Invalid loadout slot';
  end if;
  if v_item is null or v_item = '' then
    raise exception 'Invalid loadout item';
  end if;

  insert into public.player_loadouts(user_id)
  values (v_uid)
  on conflict (user_id) do nothing;

  if v_slot = 'class' then
    if v_item not in ('runner', 'medic', 'tank', 'trickster') then
      raise exception 'Invalid class';
    end if;
    if v_item <> 'runner'
       and not exists (
         select 1
         from public.player_unlocks u
         where u.user_id = v_uid
           and u.item_key = v_item
           and u.item_type = 'class'
       ) then
      raise exception 'Class is not unlocked';
    end if;

    update public.player_loadouts
    set class_key = v_item,
        character_key = case v_item
          when 'medic' then 'medic_patch'
          when 'tank' then 'tank_bulwark'
          when 'trickster' then 'trickster_rogue'
          else 'runner_ace'
        end,
        updated_at = now()
    where user_id = v_uid;
    return;
  end if;

  if v_slot = 'character' then
    v_required_class := case
      when v_item in ('runner_ace', 'runner_scout', 'runner_ranger') then 'runner'
      when v_item in ('medic_patch', 'medic_mercy', 'medic_vial') then 'medic'
      when v_item in ('tank_bulwark', 'tank_hammer', 'tank_sentinel') then 'tank'
      when v_item in ('trickster_rogue', 'trickster_jester', 'trickster_phantom') then 'trickster'
      else null
    end;

    if v_required_class is null then
      raise exception 'Invalid character';
    end if;
    if v_required_class <> 'runner'
       and not exists (
         select 1
         from public.player_unlocks u
         where u.user_id = v_uid
           and u.item_key = v_required_class
           and u.item_type = 'class'
       ) then
      raise exception 'Character class is not unlocked';
    end if;

    select l.class_key
    into v_current_class
    from public.player_loadouts l
    where l.user_id = v_uid;

    if v_current_class <> v_required_class then
      raise exception 'Character does not belong to the selected class';
    end if;

    update public.player_loadouts
    set character_key = v_item,
        updated_at = now()
    where user_id = v_uid;
    return;
  end if;

  -- Preserve the existing cosmetic contract: the item must be owned by this
  -- account and its unlock type must exactly match the requested slot.
  if not exists (
    select 1
    from public.player_unlocks u
    where u.user_id = v_uid
      and u.item_key = v_item
      and u.item_type = v_slot
  ) then
    raise exception 'Item is not unlocked for this slot';
  end if;

  update public.player_loadouts
  set player_cosmetic = case when v_slot = 'player' then v_item else player_cosmetic end,
      obstacle_cosmetic = case when v_slot = 'obstacle' then v_item else obstacle_cosmetic end,
      environment_cosmetic = case when v_slot = 'environment' then v_item else environment_cosmetic end,
      updated_at = now()
  where user_id = v_uid;
end;
$$;

revoke all on function public.set_loadout(text, text) from public, anon;
grant execute on function public.set_loadout(text, text) to authenticated;

notify pgrst, 'reload schema';
