-- Rollback-only fixtures; run after photon-starter.sql (or inside its transaction).
begin;
do $$
declare d text;f text;
begin
  d:=pg_get_functiondef('app_private.photon_user()'::regprocedure);
  d:=replace(d,'FUNCTION app_private.photon_user()','FUNCTION pg_temp.photon_user()');
  d:=replace(d,'auth.uid()','nullif(current_setting(''skyway.test_uid'',true),'''')::uuid');
  execute d;
  foreach f in array array['get_photon_fury_profile()','equip_photon_character(text)',
    'begin_photon_fury_run()','begin_photon_character_run(text)'] loop
    d:=pg_get_functiondef(('public.'||f)::regprocedure);
    d:=replace(d,'FUNCTION public.','FUNCTION pg_temp.');
    d:=replace(d,'app_private.photon_user()','pg_temp.photon_user()');
    d:=replace(d,'public.get_photon_fury_profile()','pg_temp.get_photon_fury_profile()');
    d:=replace(d,'public.begin_photon_fury_run()','pg_temp.begin_photon_fury_run()');
    execute d;
  end loop;
end $$;
do $$
declare u uuid;other_user uuid;p jsonb;r jsonb;b bigint;f text;
begin
  select s.user_id into u from public.player_stats s
    where not app_private.has_active_ban(s.user_id,'account',null)
      and not exists(select 1 from app_private.photon_fury_runs r
        where r.user_id=s.user_id and (r.finished_at is null or r.started_at>clock_timestamp()-interval '2s'))
    order by s.user_id limit 1;
  if u is null then raise exception 'Need an idle, unbanned test account';end if;
  select user_id into other_user from public.player_stats where user_id<>u order by user_id limit 1;
  perform set_config('skyway.test_uid',u::text,true);
  insert into public.player_photon_fury(user_id) values(u) on conflict do nothing;
  update public.player_photon_fury set unlocked_at=clock_timestamp(),selected_character_key='photon_trumpet' where user_id=u;
  select photons into b from public.player_photon_fury where user_id=u;
  p:=pg_temp.get_photon_fury_profile();
  if p->'character_keys'<>'["photon_magician"]'::jsonb or p->>'selected_character_key'<>'photon_magician'
    then raise exception 'Only Magician must be included; stale selections must fall back';end if;
  foreach f in array array['photon_tick','photon_trumpet','photon_saxophone','photon_wizard',
    'photon_burner','photon_bluff','photon_magnet','photon_bear','photon_wrench','photon_oyster','runner_ace'] loop
    begin
      perform pg_temp.equip_photon_character(f);
      raise exception 'Unowned equip was accepted';
    exception when others then if sqlerrm<>'Character locked' then raise;end if;end;
    begin
      perform pg_temp.begin_photon_character_run(f);
      raise exception 'Unowned run was accepted';
    exception when others then if sqlerrm<>'Character locked' then raise;end if;end;
  end loop;
  p:=pg_temp.equip_photon_character('photon_magician');
  if p->>'selected_character_key'<>'photon_magician' then raise exception 'Magician equip failed';end if;
  r:=pg_temp.begin_photon_character_run('photon_magician');
  if r->>'character_key'<>'photon_magician' or not exists(select 1 from app_private.photon_fury_runs
    where id=(r->>'run_id')::uuid and user_id=u and character_key='photon_magician')
    then raise exception 'Magician run receipt failed';end if;
  insert into public.player_unlocks(user_id,item_key,item_type,rarity,ownership_proven_at)
    values(u,'photon_tick','character','uncommon',clock_timestamp());
  if not app_private.owns_photon_character(u,'photon_tick') or app_private.owns_photon_character(other_user,'photon_tick')
    then raise exception 'Explicit ownership must be account-specific';end if;
  p:=pg_temp.equip_photon_character('photon_tick');
  if not (p->'character_keys' ? 'photon_tick') or p->>'selected_character_key'<>'photon_tick'
    then raise exception 'Explicit unlock was not preserved';end if;
  if (select photons from public.player_photon_fury where user_id=u)<>b
    then raise exception 'Ownership changes must not change Photons';end if;
  perform set_config('skyway.test_uid','',true);
  begin
    perform pg_temp.get_photon_fury_profile();raise exception 'Guest was accepted';
  exception when others then if sqlerrm<>'Sign in required' then raise;end if;end;
  if has_function_privilege('authenticated','app_private.owns_photon_character(uuid,text)','execute')
    or has_function_privilege('anon','app_private.owns_photon_character(uuid,text)','execute')
    then raise exception 'Ownership helper must remain private';end if;
  foreach f in array array['public.get_photon_fury_profile()','public.equip_photon_character(text)',
    'public.begin_photon_character_run(text)'] loop
    if not has_function_privilege('authenticated',f,'execute') or has_function_privilege('anon',f,'execute')
      then raise exception 'Existing RPC access changed';end if;
  end loop;
end $$;
select 'PASS: Magician-only starter, stale selection fallback, locked equip/run rejection, explicit unlock preservation, own account and unchanged Photons' as result;
rollback;
