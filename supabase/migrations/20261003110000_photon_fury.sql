-- Photon Fury MISC · account unlocks and idempotent Photon rewards.
begin;
create table if not exists public.player_photon_fury (
  user_id uuid primary key references public.player_stats(user_id) on delete cascade,
  unlocked_at timestamptz, photons bigint not null default 0 check(photons>=0)
);
alter table public.player_photon_fury enable row level security;
revoke all on public.player_photon_fury from public,anon,authenticated;
grant select on public.player_photon_fury to authenticated;
drop policy if exists photon_own_read on public.player_photon_fury;
create policy photon_own_read on public.player_photon_fury for select to authenticated using(user_id=auth.uid());
create table if not exists app_private.photon_fury_runs (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.player_stats(user_id) on delete cascade,
  started_at timestamptz not null default clock_timestamp(), finished_at timestamptz,
  active_seconds numeric, reflections integer, awarded bigint
);
create index if not exists photon_runs_user on app_private.photon_fury_runs(user_id,started_at desc);
revoke all on app_private.photon_fury_runs from public,anon,authenticated;
create or replace function public.get_photon_fury_profile() returns jsonb
language plpgsql security definer set search_path='' as $$
declare p public.player_photon_fury;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  select * into p from public.player_photon_fury where user_id=auth.uid();
  return jsonb_build_object('unlocked',p.unlocked_at is not null,'photons',coalesce(p.photons,0));
end $$;
create or replace function public.unlock_photon_fury() returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); s public.player_stats; p public.player_photon_fury;
begin
  if u is null then raise exception 'Sign in required'; end if;
  if app_private.has_active_ban(u,'account',null) then raise exception 'This account is banned'; end if;
  select * into s from public.player_stats where user_id=u for update;
  insert into public.player_photon_fury(user_id) values(u) on conflict do nothing;
  select * into p from public.player_photon_fury where user_id=u for update;
  if p.unlocked_at is null then
    if coalesce(s.level,0)<15 then raise exception 'Photon Fury unlocks at level 15'; end if;
    if coalesce(s.total_gems,0)<100 then raise exception 'You need 100 Gems'; end if;
    update public.player_stats set total_gems=total_gems-100,updated_at=clock_timestamp() where user_id=u returning * into s;
    update public.player_photon_fury set unlocked_at=clock_timestamp() where user_id=u;
  end if;
  return jsonb_build_object('unlocked',true,'total_gems',s.total_gems);
end $$;
create or replace function public.begin_photon_fury_run() returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); r uuid;
begin
  if u is null then raise exception 'Sign in required'; end if;
  if app_private.has_active_ban(u,'account',null) then raise exception 'This account is banned'; end if;
  if not exists(select 1 from public.player_photon_fury where user_id=u and unlocked_at is not null) then raise exception 'Unlock Photon Fury first'; end if;
  perform pg_advisory_xact_lock(hashtextextended(u::text,803100));
  if exists(select 1 from app_private.photon_fury_runs where user_id=u and started_at>clock_timestamp()-interval '1 second') then raise exception 'Please wait before starting another run'; end if;
  -- Test mode cannot mint rewards even if someone calls this RPC directly.
  if app_private.is_admin_test_user(u) then raise exception 'Test runs do not use a reward session'; end if;
  -- A new run replaces an abandoned one; overlapping sessions cannot reuse time.
  update app_private.photon_fury_runs set finished_at=clock_timestamp(),active_seconds=0,reflections=0,awarded=0 where user_id=u and finished_at is null;
  insert into app_private.photon_fury_runs(user_id) values(u) returning id into r;
  return jsonb_build_object('run_id',r);
end $$;
create or replace function public.finish_photon_fury_run(p_run_id uuid,p_active_seconds numeric,p_reflections integer) returns jsonb
language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); r app_private.photon_fury_runs; reward bigint; balance bigint; score numeric;
begin
  if u is null then raise exception 'Sign in required'; end if;
  if app_private.has_active_ban(u,'account',null) then raise exception 'This account is banned'; end if;
  select * into r from app_private.photon_fury_runs where id=p_run_id and user_id=u for update;
  if r.id is null then raise exception 'Run not found'; end if;
  if r.finished_at is not null then
    select photons into balance from public.player_photon_fury where user_id=u;
    return jsonb_build_object('awarded',r.awarded,'photons',balance);
  end if;
  if p_active_seconds is null or p_active_seconds::text in ('NaN','Infinity','-Infinity') or p_active_seconds<0 or p_active_seconds>21600
    or p_active_seconds>extract(epoch from clock_timestamp()-r.started_at)+.5 then raise exception 'Invalid active playtime'; end if;
  if p_reflections is null or p_reflections<0 or p_reflections>floor(p_active_seconds/.6)+1 then raise exception 'Invalid reflection count'; end if;
  if app_private.is_admin_test_user(u) then raise exception 'Test runs cannot earn Photons'; end if;
  score:=p_active_seconds/27*.1;
  reward:=greatest(0,floor(p_reflections*power(1+score,2)))::bigint;
  update public.player_photon_fury set photons=photons+reward where user_id=u and unlocked_at is not null returning photons into balance;
  if balance is null then raise exception 'Photon Fury is locked'; end if;
  update app_private.photon_fury_runs set finished_at=clock_timestamp(),active_seconds=p_active_seconds,reflections=p_reflections,awarded=reward where id=r.id;
  return jsonb_build_object('awarded',reward,'photons',balance,'score',floor(score));
end $$;
revoke all on function public.get_photon_fury_profile(),public.unlock_photon_fury(),public.begin_photon_fury_run(),public.finish_photon_fury_run(uuid,numeric,integer) from public,anon;
grant execute on function public.get_photon_fury_profile(),public.unlock_photon_fury(),public.begin_photon_fury_run(),public.finish_photon_fury_run(uuid,numeric,integer) to authenticated;
notify pgrst,'reload schema';
commit;
