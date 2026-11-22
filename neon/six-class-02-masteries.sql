-- Six-class update: automatic equipped-character quests and embedded mastery effects.
-- Source-pinned against the installed protected wrappers, read with transaction_read_only=on.
-- No quest/ownership/account/history rows are reset or removed. Existing grants,
-- owners and runtime/ban/context/receipt guards remain in each original function.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $six_mastery_0$
declare d text;
begin
 if md5(pg_get_functiondef('public.begin_mastery_session(uuid,text,text,text)'::regprocedure))='c23fe29c4aa35902d60cfbaab38a9f15' then
  execute $six_definition_0$CREATE OR REPLACE FUNCTION public.begin_mastery_session(p_context_id uuid, p_context_type text, p_character_key text, p_trial_key text DEFAULT NULL::text)
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
 if not app_private.mastery_owns_character(u,p_character_key) then raise exception 'Character locked';end if;
 if app_private.is_admin_test_user(u) then raise exception 'Test Mode runs do not progress mastery';end if;
 if p_context_type is null or p_context_type not in('endless','1v1') or v_trial and (p_context_type<>'endless' or p_trial_key<>p_character_key) then raise exception 'Invalid mastery context';end if;
 perform pg_advisory_xact_lock(hashtextextended(u::text,23));
 select * into previous from app_private.mastery_sessions where user_id=u and context_id=p_context_id and character_key=p_character_key
  and context_type=case when v_trial then 'trial' else p_context_type end and finished_at is null;
 if previous.id is not null then return jsonb_build_object('session_id',previous.id,'trial',v_trial,'trial_replay',previous.trial_replay,'last_seq',previous.last_seq,'last_at',previous.last_at,'profile',public.get_mastery_profile());end if;
 if p_context_type='endless' then
  if not exists(select 1 from public.player_progression_runs where run_id=p_context_id and user_id=u and completed_at is null and not test_mode) then raise exception 'Owned active run receipt required';end if;
  select character_key into c from public.player_loadouts where user_id=u;
  if not v_trial and coalesce(c,'runner_ace')<>p_character_key and not exists(select 1 from app_private.player_mastery_preferences where user_id=u and endless_randomizer) then raise exception 'Mastery character does not match the run loadout';end if;
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
$six_definition_0$;
 elsif (select md5(prosrc) from pg_proc where oid='public.begin_mastery_session(uuid,text,text,text)'::regprocedure) is distinct from 'e3adfb4ac5e49c8fd983be4f258edd1b' then
  raise exception 'Unreviewed six-class mastery source: public.begin_mastery_session(uuid,text,text,text)';
 end if;
end
$six_mastery_0$;
do $six_mastery_1$
declare d text;
begin
 if md5(pg_get_functiondef('public.credit_mastery_events(uuid,jsonb)'::regprocedure))='3e97d4a58b52b1829b46ffc17acd0d92' then
  execute $six_definition_1$CREATE OR REPLACE FUNCTION public.credit_mastery_events(p_session_id uuid, p_batch jsonb)
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
 if not app_private.mastery_owns_character(u,s.character_key) or app_private.is_admin_test_user(u) then raise exception 'Mastery session no longer eligible';end if;
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
$six_definition_1$;
 elsif (select md5(prosrc) from pg_proc where oid='public.credit_mastery_events(uuid,jsonb)'::regprocedure) is distinct from '681a1cafd20739bce257ddd32e8a56c9' then
  raise exception 'Unreviewed six-class mastery source: public.credit_mastery_events(uuid,jsonb)';
 end if;
end
$six_mastery_1$;
do $six_mastery_2$
declare d text;
begin
 if md5(pg_get_functiondef('public.claim_player_gem(uuid,text)'::regprocedure))='b66d65859c30e7db09f948ae2bc26da5' then
  execute $six_definition_2$CREATE OR REPLACE FUNCTION public.claim_player_gem(p_context_id uuid, p_pickup_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  -- Pixel runtime boundary: before original variable initializers or writes.
  perform app_private.require_pixel_runtime();
  <<skyway_original>>
declare u uuid:=app_private.photon_user();r jsonb;s app_private.mastery_sessions;extra bigint;carry numeric;total bigint;awarded bigint;
begin
 -- Existing implementation validates own active receipt, freshness, rate and
 -- duplicate pickup ID, and grants no currency for a marked mastery trial.
 r:=app_private.claim_player_gem_before_mastery_flairs(p_context_id,p_pickup_id);
 if (r->>'is_new')::boolean is not true or (r->>'test_mode')::boolean is true then return r;end if;
 select * into s from app_private.mastery_sessions where user_id=u and context_id=p_context_id
  and context_type in('endless','1v1') and finished_at is null order by started_at desc limit 1 for update;
 -- Six-class update: reject legacy cross-character snapshots and disabled mastery effects.
 if s.id is null or s.character_key<>'medic_bloom' or s.flair_character is distinct from s.character_key or s.gem_multiplier<>1.35
  or not exists(select 1 from app_private.player_mastery_quests where user_id=u and character_key=s.character_key and mastered and mastery_enabled)
  or not app_private.mastery_owns_character(u,s.character_key) then return r;end if;
 awarded:=coalesce((r->>'gems_awarded')::bigint,0);
 if awarded<0 or awarded>1000000000 then raise exception 'Unexpected verified gem reward';end if;
 carry:=s.gem_fraction+awarded*(s.gem_multiplier-1);extra:=floor(carry)::bigint;
 update app_private.mastery_sessions set gem_fraction=carry-extra where id=s.id;
 if extra>0 then
  update public.player_stats set total_gems=total_gems+extra,updated_at=clock_timestamp() where user_id=u returning total_gems into total;
 else select total_gems into total from public.player_stats where user_id=u;end if;
 -- The same atomic physical-pickup receipt carries its final whole reward.
 -- A lost-response retry is handled by the original idempotent implementation.
 update public.player_progression_events set metadata=metadata||jsonb_build_object('gems_awarded',awarded+extra,'flair_extra_gems',extra,'flair_multiplier',s.gem_multiplier)
 where user_id=u and source='gem' and source_key=p_context_id::text||':'||trim(p_pickup_id);
 return r||jsonb_build_object('total_gems',total,'gems_awarded',awarded+extra);
end;
end
$function$
$six_definition_2$;
 elsif (select md5(prosrc) from pg_proc where oid='public.claim_player_gem(uuid,text)'::regprocedure) is distinct from '6c2dad36bfb416b424b96a584401f395' then
  raise exception 'Unreviewed six-class mastery source: public.claim_player_gem(uuid,text)';
 end if;
end
$six_mastery_2$;
do $six_mastery_3$
declare d text;
begin
 if md5(pg_get_functiondef('public.get_mastery_smoke_effect(uuid)'::regprocedure))='3e3fa068762737b22974416346076779' then
  execute $six_definition_3$CREATE OR REPLACE FUNCTION public.get_mastery_smoke_effect(p_match_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  -- Pixel runtime boundary: before original variable initializers or writes.
  perform app_private.require_pixel_runtime();
  <<skyway_original>>
declare u uuid:=app_private.photon_user();p public.multiplayer_players;o public.multiplayer_players;m public.multiplayer_matches;
 s app_private.mastery_smoke_state;e app_private.mastery_smoke_actions;top numeric:=0;mastered boolean:=false;
begin
 select * into m from public.multiplayer_matches where id=p_match_id;
 select * into p from public.multiplayer_players where match_id=p_match_id and user_id=u;
 if m.id is null or p.user_id is null then raise exception 'Owned 1v1 match required';end if;
 select * into o from public.multiplayer_players where match_id=p_match_id and user_id<>u limit 1;
 if m.status='playing' and m.finished_at is null and p.status='playing' then
  select * into e from app_private.mastery_smoke_actions where match_id=p_match_id and user_id=o.user_id and active_until>clock_timestamp() order by created_at desc limit 1;
  if exists(select 1 from app_private.mastery_sessions ms join app_private.player_mastery_quests q on q.user_id=ms.user_id and q.character_key='trickster_smoke'
   where ms.user_id=o.user_id and ms.context_id=p_match_id and ms.context_type='1v1' and ms.finished_at is null and ms.flair_character='trickster_smoke' and ms.character_key='trickster_smoke' and o.character_key='trickster_smoke'
    and q.mastered and q.mastery_enabled and app_private.mastery_owns_character(o.user_id,'trickster_smoke')) then
   top:=case when o.character_key='trickster_smoke' then .4 else .2 end;
  end if;
 end if;
 select coalesce(bool_or(q.mastered and q.mastery_enabled),false) into mastered from app_private.player_mastery_quests q where q.user_id=u and q.character_key='trickster_smoke';
 select * into s from app_private.mastery_smoke_state where match_id=p_match_id and user_id=u;
 return jsonb_build_object('strength',e.strength,'active_until',e.active_until,'flair_top',top,
  'own_bombs_remaining',case when p.character_key='trickster_smoke' and mastered then 3-case when s.wave=p.wave then coalesce(s.bombs_used,0) else 0 end else null end,
  'own_cooldown_until',s.cooldown_until,'self_heavy',p.character_key='trickster_smoke' and mastered and s.wave=p.wave and s.bombs_used=3);
end;
end
$function$
$six_definition_3$;
 elsif (select md5(prosrc) from pg_proc where oid='public.get_mastery_smoke_effect(uuid)'::regprocedure) is distinct from '17700fa46a2e2ce0705ff7bad0a49db8' then
  raise exception 'Unreviewed six-class mastery source: public.get_mastery_smoke_effect(uuid)';
 end if;
end
$six_mastery_3$;
do $six_mastery_4$
declare d text;
begin
 if md5(pg_get_functiondef('public.set_player_flair(text)'::regprocedure))='de91676a7da1427b9a5a70b564dae631' then
  execute $six_definition_4$CREATE OR REPLACE FUNCTION public.set_player_flair(p_flair_key text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  -- Pixel runtime boundary: before original variable initializers or writes.
  perform app_private.require_pixel_runtime();
  raise exception 'Flairs are part of their original enabled mastery and cannot be equipped separately';
  <<skyway_original>>
declare u uuid:=app_private.photon_user();
begin
 if not app_private.mastery_owns_character(u,p_flair_key) then raise exception 'Unlock the flair character first';end if;
 insert into app_private.player_mastery_preferences(user_id,flair_character) values(u,p_flair_key)
 on conflict(user_id) do update set flair_character=excluded.flair_character;
 return public.get_mastery_profile();
end;
end
$function$
$six_definition_4$;
 elsif (select md5(prosrc) from pg_proc where oid='public.set_player_flair(text)'::regprocedure) is distinct from '714375c65d94c9c3e790d0d6556b0ca0' then
  raise exception 'Unreviewed six-class mastery source: public.set_player_flair(text)';
 end if;
end
$six_mastery_4$;
do $six_mastery_5$
declare d text;
begin
 if md5(pg_get_functiondef('public.set_mastery_toggle(text,text,boolean)'::regprocedure))='5c068c41efa8635939600d40dbc7cc85' then
  execute $six_definition_5$CREATE OR REPLACE FUNCTION public.set_mastery_toggle(p_character_key text, p_which text, p_enabled boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  -- Pixel runtime boundary: before original variable initializers or writes.
  perform app_private.require_pixel_runtime();
  if p_which='flair' then raise exception 'Use the original character mastery toggle';end if;
  <<skyway_original>>
declare u uuid:=app_private.photon_user();
begin
 if p_which is null or p_which not in('mastery','flair') or p_enabled is null then raise exception 'Invalid mastery toggle';end if;
 if not app_private.mastery_owns_character(u,p_character_key) then raise exception 'Character locked';end if;
 update app_private.player_mastery_quests set mastery_enabled=case when p_which='mastery' then p_enabled else mastery_enabled end,
  flair_rewrite_enabled=case when p_which='flair' then p_enabled else flair_rewrite_enabled end
 where user_id=u and character_key=p_character_key and mastered;
 if not found then raise exception 'Complete this mastery trial first';end if;
 return public.get_mastery_profile();
end;
end
$function$
$six_definition_5$;
 elsif (select md5(prosrc) from pg_proc where oid='public.set_mastery_toggle(text,text,boolean)'::regprocedure) is distinct from 'bcee3e442e772af10bedac8d9ba36928' then
  raise exception 'Unreviewed six-class mastery source: public.set_mastery_toggle(text,text,boolean)';
 end if;
end
$six_mastery_5$;
commit;
