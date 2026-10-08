-- Photon Fury MISC · Traditional, Rush + Strategic, isolated roster and run receipts.
begin;
alter table public.player_photon_fury add column if not exists selected_character_key text not null default 'photon_magician';
-- These rules never enter the ordinary Skyway extraction catalog or loadout.
create or replace function app_private.photon_character_rules(p_key text)
returns table(character_key text,max_hp numeric,durability integer,guard_seconds numeric,cooldown_seconds numeric,bonus_point_seconds integer,heal_amount numeric,heal_cooldown_seconds numeric)
language sql immutable set search_path='' as $$
  select * from (values
    ('photon_magician'::text,4::numeric,7,.4,1.5,40,0::numeric,0::numeric),
    ('photon_tick',4,7,.5,1.2,null,0,0),
    ('photon_trumpet',5,12,.4,1.2,null,0,0),
    ('photon_saxophone',4,5,.4,.2,null,.5,25),
    ('photon_wizard',4,7,.4,1.5,null,0,0),
    ('photon_burner',4,7,.3,2,null,0,0),
    ('photon_bluff',5,7,.3,1.5,null,0,0),
    ('photon_magnet',4,7,.4,1.5,null,0,0),
    ('photon_bear',4,7,.4,1.5,null,0,0),
    ('photon_wrench',4,7,.9,3.5,null,0,0)
  ) c(character_key,max_hp,durability,guard_seconds,cooldown_seconds,bonus_point_seconds,heal_amount,heal_cooldown_seconds)
  where p_key is null or c.character_key=p_key;
$$;
revoke all on function app_private.photon_character_rules(text) from public,anon,authenticated;
alter table app_private.photon_fury_runs add column if not exists character_key text;
-- NULL character identifies a legacy 0.6s run; its payout remains unchanged.
alter table app_private.photon_fury_runs add column if not exists saber_cooldown_seconds numeric not null default .6;
alter table app_private.photon_fury_runs add column if not exists bonus_point_seconds integer;
alter table app_private.photon_fury_runs add column if not exists point_multiplier numeric not null default 1;
alter table app_private.photon_fury_runs add column if not exists extra_points integer not null default 0;
create or replace function public.get_photon_fury_profile() returns jsonb
language plpgsql security definer set search_path='' as $$
declare p public.player_photon_fury; keys jsonb;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  select * into p from public.player_photon_fury where user_id=auth.uid();
  select coalesce(jsonb_agg(character_key),'[]'::jsonb) into keys from app_private.photon_character_rules(null) where p.unlocked_at is not null;
  return jsonb_build_object('unlocked',p.unlocked_at is not null,'photons',coalesce(p.photons,0),'character_keys',keys,'selected_character_key',p.selected_character_key);
end $$;
create or replace function public.equip_photon_character(p_character_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();
begin
  if u is null then raise exception 'Sign in required'; end if;
  if app_private.has_active_ban(u,'account',null) then raise exception 'This account is banned'; end if;
  if p_character_key is null then raise exception 'Choose a Photon Fury character'; end if;
  perform 1 from app_private.photon_character_rules(p_character_key);
  if not found then raise exception 'Choose a Photon Fury character'; end if;
  update public.player_photon_fury set selected_character_key=p_character_key where user_id=u and unlocked_at is not null;
  if not found then raise exception 'Unlock Photon Fury first'; end if;
  -- This edits the next run's selection, never an existing run's snapshot.
  return public.get_photon_fury_profile();
end $$;
create or replace function public.begin_photon_character_run(p_character_key text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); c record; payload jsonb;
begin
  if u is null then raise exception 'Sign in required'; end if;
  select * into c from app_private.photon_character_rules(p_character_key);
  if c.character_key is null or p_character_key is null then raise exception 'Choose a Photon Fury character'; end if;
  payload:=public.begin_photon_fury_run();
  update app_private.photon_fury_runs set character_key=c.character_key,saber_cooldown_seconds=c.cooldown_seconds,bonus_point_seconds=c.bonus_point_seconds,point_multiplier=case when c.character_key='photon_burner' then 2 else 1 end where id=(payload->>'run_id')::uuid and user_id=u;
  return payload||jsonb_build_object('character_key',c.character_key);
end $$;
-- Clients send raw reflection counts. Multipliers/bonuses come from the receipt.
create or replace function public.finish_photon_character_run(p_run_id uuid,p_active_seconds numeric,p_reflections integer,p_extra_points integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); r app_private.photon_fury_runs; reward bigint; balance bigint; points numeric; spawn_limit numeric; extra_limit numeric;
begin
  if u is null then raise exception 'Sign in required'; end if;
  if app_private.has_active_ban(u,'account',null) then raise exception 'This account is banned'; end if;
  select * into r from app_private.photon_fury_runs where id=p_run_id and user_id=u for update;
  if r.id is null then raise exception 'Run not found'; end if;
  if r.finished_at is not null then
    select photons into balance from public.player_photon_fury where user_id=u;
    return jsonb_build_object('awarded',r.awarded,'photons',balance);
  end if;
  if p_active_seconds is null or p_active_seconds::text in('NaN','Infinity','-Infinity') or p_active_seconds<0 or p_active_seconds>21600
    or p_active_seconds>extract(epoch from clock_timestamp()-r.started_at)+.5 then raise exception 'Invalid active playtime'; end if;
  if p_reflections is null or p_reflections<0 or p_reflections>floor(p_active_seconds/r.saber_cooldown_seconds)+1 then raise exception 'Invalid reflection count'; end if;
  -- Conservative spawn ceiling from the active-time spawn curve. Counts remain
  -- separate so direct pickups never bypass the saber reflection-rate bound.
  spawn_limit:=least(1000000,ceil((power(1.004,p_active_seconds/2)-1)*772)+3);
  extra_limit:=case r.character_key when 'photon_magnet' then 3*spawn_limit when 'photon_bear' then 2*p_reflections+spawn_limit when 'photon_wrench' then p_reflections else 0 end;
  if p_extra_points is null or p_extra_points<0 or p_extra_points>extra_limit or (r.character_key='photon_magnet' and p_extra_points%3<>0) then raise exception 'Invalid extra points'; end if;
  if app_private.is_admin_test_user(u) then raise exception 'Test runs cannot earn Photons'; end if;
  points:=p_reflections*r.point_multiplier+p_extra_points+case when r.bonus_point_seconds>0 then floor(p_active_seconds/r.bonus_point_seconds) else 0 end;
  reward:=case when points>=4 then ((points-4)^2+1)::bigint else 0 end;
  update public.player_photon_fury set photons=photons+reward where user_id=u and unlocked_at is not null returning photons into balance;
  if balance is null then raise exception 'Photon Fury is locked'; end if;
  update app_private.photon_fury_runs set finished_at=clock_timestamp(),active_seconds=p_active_seconds,reflections=p_reflections,extra_points=p_extra_points,awarded=reward where id=r.id;
  return jsonb_build_object('awarded',reward,'photons',balance,'points',points);
end $$;
-- The three-argument endpoint keeps older published clients working unchanged.
create or replace function public.finish_photon_fury_run(p_run_id uuid,p_active_seconds numeric,p_reflections integer) returns jsonb
language sql security definer set search_path='' as $$ select public.finish_photon_character_run(p_run_id,p_active_seconds,p_reflections,0); $$;
revoke all on function public.equip_photon_character(text),public.begin_photon_character_run(text),public.finish_photon_character_run(uuid,numeric,integer,integer) from public,anon;
grant execute on function public.equip_photon_character(text),public.begin_photon_character_run(text),public.finish_photon_character_run(uuid,numeric,integer,integer) to authenticated;
notify pgrst,'reload schema';
commit;
