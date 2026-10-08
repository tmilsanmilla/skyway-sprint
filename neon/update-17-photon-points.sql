-- Update 17 Photon Points · score-free payout; retain validation and idempotency.
begin;
create or replace function app_private.photon_points_reward(p_points numeric) returns bigint language sql immutable strict set search_path='' as $$
  select case when floor(p_points)>=4 then ((floor(p_points)-4)^2+1)::bigint else 0::bigint end;
$$;
revoke all on function app_private.photon_points_reward(numeric) from public,anon,anonymous,authenticated;
create or replace function public.finish_photon_character_run(p_run_id uuid,p_active_seconds numeric,p_reflections integer,p_extra_points integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare t numeric:=p_active_seconds;n integer:=p_reflections;x integer:=p_extra_points;u uuid:=app_private.photon_user();
  r app_private.photon_fury_runs;v bigint;b bigint;p numeric;h numeric;l numeric;
begin
  select * into r from app_private.photon_fury_runs where id=p_run_id and user_id=u for update;
  if r.id is null then raise exception 'No run';end if;
  if r.finished_at is not null then
    select photons into b from public.player_photon_fury where user_id=u;
    return jsonb_build_object('awarded',r.awarded,'photons',b);
  end if;
  if not coalesce(t between 0 and 21600,false) or t>extract(epoch from clock_timestamp()-r.started_at)+.5 then raise exception 'Invalid playtime';end if;
  if n is null or n<0 or n>floor(t/r.saber_cooldown_seconds)+1 then raise exception 'Invalid reflections';end if;
  if app_private.is_admin_test_user(u) then raise exception 'Test run';end if;
  h:=least(1e6,ceil((power(1.004,t/2)-1)*772)+3);
  l:=case r.character_key when 'photon_magnet' then 3*h when 'photon_bear' then 2*n+h when 'photon_wrench' then n else 0 end;
  if x is null or x<0 or x>l or (r.character_key='photon_magnet' and x%3<>0) then raise exception 'Invalid bonus';end if;
  p:=n*r.point_multiplier+x+coalesce(floor(t/nullif(r.bonus_point_seconds,0)),0);
  v:=app_private.photon_points_reward(p);
  update public.player_photon_fury set photons=photons+v where user_id=u and unlocked_at is not null returning photons into b;
  if b is null then raise exception 'Mode locked';end if;
  update app_private.photon_fury_runs set finished_at=clock_timestamp(),active_seconds=t,reflections=n,extra_points=x,awarded=v where id=r.id;
  return jsonb_build_object('awarded',v,'photons',b,'points',p);
end $$;
revoke all on function public.finish_photon_character_run(uuid,numeric,integer,integer) from public,anon,anonymous;
grant execute on function public.finish_photon_character_run(uuid,numeric,integer,integer) to authenticated;
notify pgrst,'reload schema';
commit;
