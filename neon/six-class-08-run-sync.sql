-- Hardcore run binding and fractional active-time accounting. No identity,
-- loadout, currency or quest reset; only the original owner's active run changes.
begin;
set local lock_timeout='3s';
alter table app_private.six_class_runs add column if not exists run_mode text check(run_mode in('normal','hardcore'));
alter table app_private.six_class_runs add column if not exists active_fraction numeric not null default 0 check(active_fraction>=0 and active_fraction<1);
do $guard$ begin if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'and p.proname='bind_six_class_run_v1'and md5(p.prosrc)<>'b281e404a76e2c0c5e704807af849488')then raise exception 'Source drift: bind_six_class_run_v1';end if;end $guard$;
create or replace function public.bind_six_class_run_v1(p_run_id uuid,p_mode text,p_character_key text)returns jsonb language plpgsql security definer set search_path=''as $$
begin perform app_private.require_pixel_runtime();
 <<owned_run>>declare u uuid:=app_private.photon_user();r public.player_progression_runs;s app_private.six_class_runs;begin
 if p_mode is null or p_mode not in('normal','hardcore')or p_character_key is null or not app_private.owns_six_class_character(u,p_character_key)then raise exception 'Owned run character required';end if;
 if p_mode='hardcore'and p_character_key<>'runner_ace'then raise exception 'Hardcore requires Ace';end if;
 select *into r from public.player_progression_runs where run_id=p_run_id and user_id=u for update;
 select *into s from app_private.six_class_runs where run_id=p_run_id and user_id=u for update;
 if r.run_id is null or s.run_id is null or r.completed_at is not null or s.settled_at is not null or r.started_at<clock_timestamp()-interval '6 hours'then raise exception 'Original active run required';end if;
 if s.run_mode is not null then
  if s.run_mode<>p_mode or s.original_key<>p_character_key then raise exception 'Original run binding cannot change';end if;
  return jsonb_build_object('bound',true,'run_id',p_run_id);
 end if;
 if s.checkpoint<>'{}'or s.last_nonce is not null then raise exception 'Run character must bind before play';end if;
 update app_private.six_class_runs set run_mode=p_mode,original_key=p_character_key,current_key=p_character_key,behavior_key=p_character_key where run_id=p_run_id and user_id=u;
 return jsonb_build_object('bound',true,'run_id',p_run_id);
 end owned_run;
end $$;
revoke all on function public.bind_six_class_run_v1(uuid,text,text)from public,anon,anonymous;
grant execute on function public.bind_six_class_run_v1(uuid,text,text)to authenticated;
do $guard$ begin if(select md5(prosrc)from pg_proc where oid='sync_progression_run(uuid,integer,boolean)'::regprocedure)not in('3028e2e337416318b549d959091961e6','0c4e10b186e3747568742b009e69dd55')then raise exception 'Source drift: sync_progression_run(uuid,integer,boolean)';end if;end $guard$;
CREATE OR REPLACE FUNCTION public.sync_progression_run(p_run_id uuid, p_wave integer, p_active boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  -- Pixel runtime boundary: before original variable initializers or writes.
  perform app_private.require_pixel_runtime();
  <<skyway_original>>
declare
  v_uid uuid:=auth.uid(); v_now timestamptz;
  v_last_heartbeat timestamptz; v_active_seconds bigint;
  v_verified_wave integer; v_was_active boolean;
  v_increment bigint; v_max_wave integer; v_fraction numeric:=0; v_total numeric:=0;
begin
  if v_uid is null then raise exception 'Sign in required'; end if;
  if p_run_id is null then raise exception 'Run ID is required'; end if;
  if p_wave is null or p_wave<1 or p_wave>100000 then
    raise exception 'Invalid run wave';
  end if;
  if p_active is null then raise exception 'Run activity state is required'; end if;
  select last_heartbeat_at,active_seconds,verified_wave,heartbeat_active
  into v_last_heartbeat,v_active_seconds,v_verified_wave,v_was_active
  from public.player_progression_runs where run_id=p_run_id
    and user_id=v_uid and completed_at is null for update;
  if not found then raise exception 'Active run receipt not found'; end if;
  v_now:=clock_timestamp();
  select active_fraction into v_fraction from app_private.six_class_runs where run_id=p_run_id and user_id=v_uid for update;
  v_fraction:=coalesce(v_fraction,0);
  v_total:=v_fraction+case when v_was_active then least(6::numeric,greatest(0,extract(epoch from(v_now-coalesce(v_last_heartbeat,v_now)))))else 0 end;
  v_increment:=floor(v_total)::bigint;
  update app_private.six_class_runs set active_fraction=v_total-v_increment where run_id=p_run_id and user_id=v_uid;
  v_active_seconds:=least(21600::bigint,v_active_seconds+v_increment);
  v_max_wave:=least(100000,
    1+floor(v_active_seconds::numeric/15)::integer);
  v_verified_wave:=least(greatest(v_verified_wave,p_wave),
    v_verified_wave+1,v_max_wave);
  update public.player_progression_runs set active_seconds=v_active_seconds,
    verified_wave=v_verified_wave,last_heartbeat_at=v_now,
    heartbeat_active=p_active
  where run_id=p_run_id;
  return jsonb_build_object('active_seconds',v_active_seconds,
    'verified_wave',v_verified_wave,'active',p_active);
end;
end
$function$
;
do $guard$ begin if(select md5(prosrc)from pg_proc where oid='begin_mastery_session(uuid,text,text,text)'::regprocedure)not in('e3adfb4ac5e49c8fd983be4f258edd1b','55e294558a14b8bcf0a781ef198f07f1')then raise exception 'Source drift: begin_mastery_session(uuid,text,text,text)';end if;end $guard$;
CREATE OR REPLACE FUNCTION public.begin_mastery_session(p_context_id uuid, p_context_type text, p_character_key text, p_trial_key text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  -- Pixel runtime boundary: before original variable initializers or writes.
  perform app_private.require_pixel_runtime();
  <<skyway_original>>
declare u uuid:=app_private.photon_user();r uuid;c text;v_trial boolean:=p_trial_key is not null;q app_private.player_mastery_quests;f text;g numeric:=1;previous app_private.mastery_sessions;v_replay boolean:=false;
begin
 if not app_private.owns_six_class_character(u,p_character_key) then raise exception 'Character locked';end if;
 if app_private.is_admin_test_user(u) then raise exception 'Test Mode runs do not progress mastery';end if;
 if p_context_type is null or p_context_type not in('endless','1v1') or v_trial and (p_context_type<>'endless' or p_trial_key<>p_character_key) then raise exception 'Invalid mastery context';end if;
 perform pg_advisory_xact_lock(hashtextextended(u::text,23));
 select * into previous from app_private.mastery_sessions where user_id=u and context_id=p_context_id and character_key=p_character_key
  and context_type=case when v_trial then 'trial' else p_context_type end and finished_at is null;
 if previous.id is not null then return jsonb_build_object('session_id',previous.id,'trial',v_trial,'trial_replay',previous.trial_replay,'last_seq',previous.last_seq,'last_at',previous.last_at,'profile',public.get_mastery_profile());end if;
 if p_context_type='endless' then
  if not exists(select 1 from public.player_progression_runs where run_id=p_context_id and user_id=u and completed_at is null and not test_mode) then raise exception 'Owned active run receipt required';end if;
  select character_key into c from public.player_loadouts where user_id=u;
  if not v_trial and not exists(select 1 from app_private.six_class_runs sr where sr.run_id=p_context_id and sr.user_id=u and sr.run_mode is not null and sr.original_key=p_character_key)and coalesce(c,'runner_ace')<>p_character_key and not exists(select 1 from app_private.player_mastery_preferences where user_id=u and endless_randomizer) then raise exception 'Mastery character does not match the run loadout';end if;
 elsif p_context_type='1v1' then
  if not exists(select 1 from public.multiplayer_players p join public.multiplayer_matches m on m.id=p.match_id
   where p.match_id=p_context_id and p.user_id=u and p.character_key=p_character_key and not p.test_mode and m.finished_at is null) then raise exception 'Owned active match required';end if;
 end if;
 if v_trial then
  select * into q from app_private.player_mastery_quests where user_id=u and character_key=p_character_key;
  if q.quest is distinct from 3 then raise exception 'Finish all three quests before entering the trial';end if;
  v_replay:=q.mastered;
  -- An ordinary owned server run receipt is irreversibly marked nonrewarding
  -- before the trial begins. Existing native reward/test guards cover direct
  -- RPC calls as well as this UI; no admin permission or preference changes.
  update public.player_progression_runs set test_mode=true where run_id=p_context_id and user_id=u and completed_at is null;
  if not found then raise exception 'Owned active trial run required';end if;
 end if;
 -- Closing a stale session keeps only one active per player and does not grant completion.
 update app_private.mastery_sessions set finished_at=clock_timestamp() where user_id=u and finished_at is null;
 if not v_trial then
  update app_private.player_mastery_quests set progress=0,progress_two=0 where user_id=u and character_key=p_character_key
   and ((character_key='runner_dash' and quest=1) or (character_key in('runner_stride','medic_bloom','runner_vault') and quest=2));
 end if;
 -- Six-class update: only this original character's enabled mastery carries its embedded effects.
 f:=null;
 if exists(select 1 from app_private.player_mastery_quests where user_id=u and character_key=p_character_key and mastered and mastery_enabled) then f:=p_character_key;end if;
 if f='medic_bloom' then g:=1.35;end if;
 -- Update 2.3 mastery management follow-up: replay is server-bound to this nonrewarding owned trial.
 insert into app_private.mastery_sessions(user_id,context_id,context_type,character_key,flair_character,gem_multiplier,trial_replay) values(u,p_context_id,case when v_trial then 'trial' else p_context_type end,p_character_key,f,g,v_replay) returning id into r;
 return jsonb_build_object('session_id',r,'trial',v_trial,'trial_replay',v_replay,'last_seq',0,'last_at',0,'profile',public.get_mastery_profile());
end;
end
$function$
;
do $guard$ begin if(select md5(prosrc)from pg_proc where oid='credit_mastery_events(uuid,jsonb)'::regprocedure)not in('681a1cafd20739bce257ddd32e8a56c9','bb6a4ded9bff3e5db59d545e38073ed3')then raise exception 'Source drift: credit_mastery_events(uuid,jsonb)';end if;end $guard$;
CREATE OR REPLACE FUNCTION public.credit_mastery_events(p_session_id uuid, p_batch jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  -- Pixel runtime boundary: before original variable initializers or writes.
  perform app_private.require_pixel_runtime();
  <<skyway_original>>
declare u uuid:=app_private.photon_user();s app_private.mastery_sessions;q app_private.player_mastery_quests;
 e jsonb;t text;n integer;a numeric;dt numeric;amount numeric;hp numeric;d numeric;b numeric;event_count integer;event_limit numeric;verified_seconds bigint;
 wave integer;active_key text;target numeric;prior numeric;v_progress numeric;v_two numeric;v_quest integer;risk numeric;ratio numeric;
begin
 if jsonb_typeof(p_batch)<>'array' or jsonb_array_length(p_batch)>512 or octet_length(p_batch::text)>262144 then raise exception 'Invalid mastery event batch';end if;
 perform pg_advisory_xact_lock(hashtextextended(u::text,23));
 select * into s from app_private.mastery_sessions where id=p_session_id and user_id=u for update;
 if s.id is null then raise exception 'Owned mastery session not found';end if;
 if s.finished_at is not null then return public.get_mastery_profile()||jsonb_build_object('already_finished',true);end if;
 if not app_private.owns_six_class_character(u,s.character_key) or app_private.is_admin_test_user(u) then raise exception 'Mastery session no longer eligible';end if;
 if s.context_type='endless' then
  select active_seconds into verified_seconds from public.player_progression_runs where run_id=s.context_id and user_id=u and not test_mode;
  if verified_seconds is null then raise exception 'Owned progression receipt required';end if;
 elsif s.context_type='1v1' then
  select a.active_seconds into verified_seconds from public.player_progression_1v1_activity a
   join public.multiplayer_players p on p.match_id=a.match_id and p.user_id=a.user_id
   where a.match_id=s.context_id and a.user_id=u and p.character_key=s.character_key and not p.test_mode;
  if verified_seconds is null then raise exception 'Owned match activity receipt required';end if;
 end if;
 -- Six-class update: the owned run character automatically tracks its purchased quest.
 active_key:=s.character_key;
 for e in select value from jsonb_array_elements(p_batch) loop
  if jsonb_typeof(e)<>'object' or not coalesce(e->>'seq','')~'^[0-9]{1,8}$' then raise exception 'Invalid mastery event sequence';end if;
  n:=(e->>'seq')::integer;
  if n<=s.last_seq then continue;end if;
  if n<>s.last_seq+1 then raise exception 'Mastery event sequence gap';end if;
  a:=(e->>'at')::numeric;
  if a is null or a='NaN'::numeric or a<s.last_at or a>21600 or a>extract(epoch from clock_timestamp()-s.started_at)+2 then raise exception 'Invalid mastery event clock';end if;
  if s.context_type<>'trial' and a>verified_seconds+8 then raise exception 'Mastery progress exceeded verified playtime';end if;
  s.last_at:=a;s.last_seq:=n;s.events:=s.events+1;
  if s.events>ceil((a+2)*120) then raise exception 'Mastery event rate exceeded';end if;
  t:=e->>'type';
  if t not in('dash','lane-change','block','gem','heal','snowflake','frame','salve-heal','wave','vault','damage','smoke','run-start','run-end','trial-special','trial-gem','trial-vault','trial-wave','trial-died') then raise exception 'Unknown mastery event';end if;
  event_count:=coalesce((s.event_counts->>t)::integer,0)+1;
  event_limit:=case t when 'dash' then 1+floor(a/2) when 'lane-change' then 2+floor(a*10)
   when 'smoke' then 1+floor(a/5) when 'salve-heal' then 2+floor(a/10)
   when 'block' then 3+floor(a*4) when 'heal' then 3+floor(a*3)
   when 'snowflake' then 3+floor(a*2) when 'vault' then 3+floor(a*4)
   when 'damage' then 3+floor(a*4) when 'trial-vault' then 3+floor(a*4)
   when 'trial-gem' then 3+floor(a*2) when 'trial-special' then 3+floor(a*4)
   else ceil((a+2)*120) end;
  if event_count>event_limit then raise exception 'Mastery action rate exceeded';end if;
  if t='salve-heal' and (s.character_key<>'medic_salve' or event_count>case when exists(select 1 from app_private.player_mastery_quests where user_id=u and character_key='medic_salve' and mastered and mastery_enabled) then 3 else 2 end) then raise exception 'Salve has used all special heals for this run';end if;
  if t='gem' then
   select count(*) into prior from public.player_progression_events where user_id=u and source='gem' and metadata->>'context_id'=s.context_id::text;
   if event_count>prior then raise exception 'Verified physical gem receipt required';end if;
  end if;
  s.event_counts:=jsonb_set(s.event_counts,array[t],to_jsonb(event_count),true);
  if t='dash' then
   s.event_counts:=s.event_counts||jsonb_build_object('last-dash-at',a,'green-blocks-this-dash',0);
  elsif t='block' and e->>'source'='dash' and (e->>'green')::boolean is true and s.context_type='1v1' then
   if s.character_key<>'runner_dash' or not exists(select 1 from app_private.player_mastery_quests where user_id=u and character_key='runner_dash' and mastered and mastery_enabled)
    or not coalesce(e->>'event_id','')~'^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    or not(s.event_counts?'last-dash-at') or a-(s.event_counts->>'last-dash-at')::numeric not between 0 and .8
    or coalesce((s.event_counts->>'green-blocks-this-dash')::integer,0)>=4 then raise exception 'A recent owned mastered Dash block is required for healing';end if;
   insert into app_private.mastery_heal_tokens(match_id,user_id,event_id,session_id,kind) values(s.context_id,u,(e->>'event_id')::uuid,s.id,'dash-green') on conflict do nothing;
   s.event_counts:=jsonb_set(s.event_counts,array['green-blocks-this-dash'],to_jsonb(coalesce((s.event_counts->>'green-blocks-this-dash')::integer,0)+1),true);
  end if;
  dt:=0;amount:=0;hp:=0;d:=0;b:=0;wave:=0;
  if t='frame' then
   dt:=(e->>'seconds')::numeric;hp:=(e->>'hp')::numeric;
   if dt is null or dt<0 or dt>1 or dt='NaN'::numeric or hp is null or hp<0 or hp>100 or hp='NaN'::numeric then raise exception 'Invalid mastery frame';end if;
   s.active_seconds:=s.active_seconds+dt;
   if s.active_seconds>a+1 or s.active_seconds>21600 then raise exception 'Mastery active time exceeded';end if;
  end if;
  if t='heal' then
   amount:=(e->>'amount')::numeric;
   if amount is null or amount<0 or amount>10 or amount='NaN'::numeric then raise exception 'Invalid healing event';end if;
  end if;
  if t='damage' then
   hp:=(e->>'before')::numeric;d:=(e->>'damage')::numeric;b:=(e->>'baseDamage')::numeric;
   if hp is null or d is null or b is null or hp='NaN'::numeric or d='NaN'::numeric or b='NaN'::numeric or hp<0 or hp>100 or d<0 or d>20 or b<0 or b>20 then raise exception 'Invalid damage event';end if;
  end if;
  if t in('wave','trial-wave') then
   wave:=(e->>'wave')::integer;
   if wave is null or wave<1 or wave>100000 or wave>1+floor(s.active_seconds/10) then raise exception 'Invalid mastery wave';end if;
  end if;
  if s.context_type='trial' then
   if s.trial_failed then
    -- A failed trial must still be abandonable; otherwise its own session
    -- would prevent changing the active quest for up to 24 hours.
    if t='run-end' then s.finished_at:=clock_timestamp();end if;
    continue;
   end if;
   if t='trial-died' then s.trial_failed:=true;end if;
   if t='frame' then
    if hp<=0 then s.trial_failed:=true;continue;end if;
    if s.trial_ready then continue;end if;
    if s.character_key in('runner_dash','runner_stride') and s.active_seconds>=45 or s.character_key='trickster_smoke' and s.active_seconds>=200 then s.trial_ready:=true;s.finale_at:=a;end if;
    if s.character_key='medic_remedy' then
     s.trial_heat_seconds:=s.trial_heat_seconds+dt;
     while s.trial_heat_seconds>=2 loop s.trial_heat_seconds:=s.trial_heat_seconds-2;s.trial_heat:=s.trial_heat+1;end loop;
     if s.trial_heat>=10 then s.trial_failed:=true;end if;
    end if;
    if s.character_key='medic_salve' then
     s.trial_wave_seconds:=s.trial_wave_seconds+dt;
     if hp>0 and app_private.rounded_health_for_conditions(hp)<=1 then s.trial_low_seconds:=s.trial_low_seconds+dt;end if;
    end if;
   elsif t='trial-special' then
    if s.character_key='runner_dash' and e->>'action'<>'dash' or s.character_key='runner_stride' and e->>'action'<>'stride-third' or s.character_key='tank_guard' and e->>'action'<>'hit' then s.trial_failed:=true;end if;
    if s.character_key='tank_guard' and e->>'action'='hit' then s.trial_count:=s.trial_count+1;end if;
   elsif t='trial-gem' and s.character_key='medic_bloom' then
    if not s.trial_first_gem and (e->>'collected')::boolean is not true then s.trial_failed:=true;end if;s.trial_first_gem:=true;
   elsif t='snowflake' and s.character_key='medic_remedy' then s.trial_heat:=1;s.trial_heat_seconds:=0;
   elsif t='trial-vault' and s.character_key='runner_vault' then
    if (e->>'vaulted')::boolean is not true or s.trial_pole_damaged and (e->>'timed')::boolean is not true then s.trial_failed:=true;
    else s.trial_count:=s.trial_count+1;if (e->>'timed')::boolean is not true then s.trial_pole_damaged:=true;end if;
     if s.trial_count>=20 and not s.trial_ready then s.trial_ready:=true;s.finale_at:=a;end if;
    end if;
   elsif t='trial-wave' then
    if wave<>s.trial_wave then raise exception 'Trial wave sequence gap';end if;
    if s.character_key<>'medic_salve' and s.active_seconds<wave*30 then raise exception 'Trial wave is not complete';end if;
    if s.character_key='medic_bloom' and not s.trial_first_gem then s.trial_failed:=true;end if;
    if s.character_key='tank_guard' and s.trial_count<>(array[1,2,3,5])[least(4,wave)] then s.trial_failed:=true;end if;
    if s.character_key='medic_salve' then
     if s.trial_wave_seconds<60 then raise exception 'Treatment is not complete';end if;
     ratio:=s.trial_low_seconds/s.trial_wave_seconds;
     risk:=case when ratio<.1 then 1 when ratio<.3 then .5 when ratio<.6 then .25 when ratio<=.75 then .1 else 0 end;
     -- A server roll decides the battlefield check, not a caller-supplied roll.
     if random()<risk then s.trial_failed:=true;else s.trial_count:=s.trial_count+1;end if;
     s.trial_low_seconds:=0;s.trial_wave_seconds:=0;
     if s.trial_count>=4 and not s.trial_failed then s.trial_ready:=true;s.finale_at:=a;end if;
    elsif not s.trial_failed and (s.character_key in('medic_bloom','medic_remedy') and wave=5 or s.character_key='tank_guard' and wave=4) then s.trial_ready:=true;s.finale_at:=a;
    end if;
    if s.character_key='tank_guard' then s.trial_count:=0;end if;
    s.trial_wave:=wave+1;s.trial_first_gem:=false;
   end if;
  elsif active_key=s.character_key then
   select * into q from app_private.player_mastery_quests where user_id=u and character_key=s.character_key for update;
   if q.quest<3 then
    v_progress:=q.progress;v_two:=q.progress_two;v_quest:=q.quest;
    case s.character_key
    when 'runner_dash' then
     if q.quest<2 and t='dash' then v_progress:=v_progress+1;end if;
     if q.quest=1 and (t='damage' and d>0 or t='run-end') then v_progress:=0;end if;
     if q.quest=2 and t='block' and e->>'source'='dash' then v_progress:=v_progress+1;end if;
    when 'runner_stride' then
     if q.quest in(0,2) and t='lane-change' then v_progress:=v_progress+1;end if;
     if q.quest=1 and t='block' and e->>'source'='stride-third' then v_progress:=v_progress+1;end if;
     if q.quest=2 and t='block' and e->>'source' in('stride','stride-third') then v_two:=v_two+1;end if;
     if q.quest=2 and (t='damage' and d>0 or t='run-end') then v_progress:=0;v_two:=0;end if;
    when 'medic_bloom' then
     if q.quest=0 and t='gem' then v_progress:=v_progress+1;end if;
     if q.quest>0 and t='heal' and e->>'source'='bloom' then v_progress:=v_progress+amount;end if;
     if q.quest=2 and t='run-end' then v_progress:=0;end if;
    when 'medic_remedy' then
     if t='heal' and (q.quest=0 or q.quest=1 and e->>'source'='snowflake') then v_progress:=v_progress+amount;end if;
     if q.quest=2 and t='snowflake' then v_progress:=v_progress+1;end if;
    when 'medic_salve' then
     if q.quest=0 and t='frame' and hp>0 and app_private.rounded_health_for_conditions(hp)<=1 then v_progress:=v_progress+dt;end if;
     if q.quest=1 and t='salve-heal' then v_progress:=v_progress+1;end if;
     if q.quest=2 and t='wave' and (e->>'salveExhausted')::boolean then v_progress:=v_progress+1;end if;
    when 'runner_vault' then
     if q.quest in(0,1) and t='vault' and e->>'hazard'=(case q.quest when 0 then 'log' else 'spikes' end) then v_progress:=v_progress+1;end if;
     if q.quest=2 and t='damage' and d>0 and e->>'hazard' in('log','spikes') then s.run_failed:=true;end if;
     if q.quest=2 and t='wave' and not s.run_failed then v_progress:=greatest(v_progress,wave);end if;
     if q.quest=2 and t='run-end' then v_progress:=0;end if;
    when 'tank_guard' then
     if t='damage' then
      if q.quest=0 then v_progress:=v_progress+greatest(0,b-d);end if;
      if q.quest=1 and hp>d and hp<=b then v_progress:=v_progress+1;end if;
      if q.quest=2 then v_progress:=v_progress+d;end if;
     end if;
    when 'trickster_smoke' then
     if t='smoke' and(q.quest=0 or q.quest=1 and s.context_type='1v1' and (e->>'opponent')::boolean is true
      or q.quest=2 and (e->>'opponent')::boolean is not true and (e->>'timeToImpact')::numeric between 0 and .25) then v_progress:=v_progress+1;end if;
    else null;
    end case;
    target:=app_private.mastery_target(s.character_key,q.quest);
    if v_progress>=target and (s.character_key<>'runner_stride' or q.quest<>2 or v_two>=25) then
     v_quest:=q.quest+1;v_progress:=case when v_quest=3 then v_progress else 0 end;v_two:=0;
     if v_quest=3 then update app_private.player_mastery_preferences set active_character=null where user_id=u;active_key:=null;end if;
    end if;
    update app_private.player_mastery_quests set quest=v_quest,progress=v_progress,progress_two=v_two where user_id=u and character_key=s.character_key;
   end if;
  end if;
  if t='run-end' then s.finished_at:=clock_timestamp();end if;
 end loop;
 update app_private.mastery_sessions set last_received_at=clock_timestamp(),last_seq=s.last_seq,last_at=s.last_at,active_seconds=s.active_seconds,events=s.events,event_counts=s.event_counts,
  run_failed=s.run_failed,trial_failed=s.trial_failed,trial_ready=s.trial_ready,finale_at=s.finale_at,trial_wave=s.trial_wave,
  trial_count=s.trial_count,trial_heat=s.trial_heat,trial_heat_seconds=s.trial_heat_seconds,trial_low_seconds=s.trial_low_seconds,
  trial_wave_seconds=s.trial_wave_seconds,trial_first_gem=s.trial_first_gem,trial_pole_damaged=s.trial_pole_damaged,finished_at=s.finished_at where id=s.id;
 return public.get_mastery_profile()||jsonb_build_object('last_seq',s.last_seq,'trial_failed',s.trial_failed,'trial_ready',s.trial_ready);
end;
end
$function$
;
notify pgrst,'reload schema';
commit;
