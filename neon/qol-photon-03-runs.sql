-- Photon QOL 03: receipt-bound rules, rewards, validation, and replay protection.
begin;
alter table app_private.photon_fury_runs add column if not exists weapon_key text not null default 'lightsaber';
alter table app_private.photon_fury_runs add column if not exists rules_version integer not null default 0;
-- Raw/old lifecycle receipts remain legacy; only the owned-character wrapper stamps the new version.
alter table app_private.photon_fury_runs alter column rules_version set default 0;
do $migration$
declare d text;
begin
 if to_regprocedure('app_private.finish_photon_character_run_legacy(uuid,numeric,integer,integer)') is null then
  select pg_get_functiondef('public.finish_photon_character_run(uuid,numeric,integer,integer)'::regprocedure) into d;
  execute replace(d,'FUNCTION public.finish_photon_character_run(', 'FUNCTION app_private.finish_photon_character_run_legacy(');
 end if;
end $migration$;
revoke all on function app_private.finish_photon_character_run_legacy(uuid,numeric,integer,integer) from public,anon,anonymous,authenticated;
create or replace function public.begin_photon_character_run(p_character_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=app_private.photon_user();k text:=p_character_key;c record;p jsonb;w text;
begin
 if not app_private.owns_photon_character(u,k) then raise exception 'Character locked';end if;
 select * into c from app_private.photon_character_rules(k);
 select selected_weapon_key into w from public.player_photon_fury where user_id=u;
 if w is null or not exists(select 1 from app_private.photon_weapon_rules(w))
  or not app_private.photon_weapon_compatible(w,k)
  or(w<>'lightsaber' and not exists(select 1 from app_private.photon_unlocks where user_id=u and kind='weapon' and item_key='photon_weapon_'||w)) then w:='lightsaber';end if;
 p:=public.begin_photon_fury_run();
 update app_private.photon_fury_runs set character_key=c.character_key,weapon_key=w,rules_version=20261014,
  saber_cooldown_seconds=c.cooldown_seconds,bonus_point_seconds=c.bonus_point_seconds,
  point_multiplier=case when k='photon_burner' then 2 else 1 end where id=(p->>'run_id')::uuid and user_id=u;
 return p||jsonb_build_object('character_key',k,'weapon_key',w,'rules_version',20261014);
end $$;
create or replace function public.finish_photon_character_run(p_run_id uuid,p_active_seconds numeric,p_reflections integer,p_extra_points integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=app_private.photon_user();r app_private.photon_fury_runs;t numeric:=p_active_seconds;
 n integer:=p_reflections;x integer:=p_extra_points;h numeric;l numeric;p numeric;v bigint;b bigint;
begin
 select * into r from app_private.photon_fury_runs where id=p_run_id and user_id=u for update;
 if r.id is null then raise exception 'No run';end if;
 if r.rules_version<>20261014 then return app_private.finish_photon_character_run_legacy(p_run_id,t,n,x);end if;
 if r.finished_at is not null then
  select photons into b from public.player_photon_fury where user_id=u;
  return jsonb_build_object('awarded',r.awarded,'photons',b,'already_completed',true);
 end if;
 if not coalesce(t between 0 and 21600,false) or t>extract(epoch from clock_timestamp()-r.started_at)+.5 then raise exception 'Invalid playtime';end if;
 if n is null or n<0 or n>floor(t/r.saber_cooldown_seconds)+1 then raise exception 'Invalid reflections';end if;
 if app_private.is_admin_test_user(u) then raise exception 'Test run';end if;
 -- Conservative rate envelopes cover contact rewards and movement without accepting a client payout.
 h:=least(1e6,ceil((power(1.004,t/2)-1)*1600)+3);
 l:=case r.character_key when 'photon_magnet' then 3*h when 'photon_bear' then 2*n+h
  when 'photon_wrench' then n when 'photon_static' then n else 0 end;
 l:=l+case r.weapon_key when 'photon_blaster' then 2*n when 'magnetite_sword' then 2*n+h
  when 'ninjablade' then 4*n+2*h+coalesce(floor(t/nullif(r.bonus_point_seconds,0)),0)
  when 'jolt_shockwave' then ceil(60*t)*r.point_multiplier else 0 end;
 if x is null or x<0 or x>l then raise exception 'Invalid bonus';end if;
 p:=n*r.point_multiplier+x+coalesce(floor(t/nullif(r.bonus_point_seconds,0)),0);
 v:=case when r.weapon_key='jolt_shockwave' then case when p>=14 then (2*(p-14)^2+1)::bigint else 0 end
  else app_private.photon_points_reward(p) end;
 update public.player_photon_fury set photons=photons+v where user_id=u and unlocked_at is not null returning photons into b;
 if b is null then raise exception 'Mode locked';end if;
 update app_private.photon_fury_runs set finished_at=clock_timestamp(),active_seconds=t,reflections=n,extra_points=x,awarded=v where id=r.id;
 return jsonb_build_object('awarded',v,'photons',b,'points',p);
end $$;
revoke all on function public.begin_photon_character_run(text),public.finish_photon_character_run(uuid,numeric,integer,integer) from public,anon,anonymous;
grant execute on function public.begin_photon_character_run(text),public.finish_photon_character_run(uuid,numeric,integer,integer) to authenticated;
notify pgrst,'reload schema';
commit;
