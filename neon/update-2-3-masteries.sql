-- Update 2.3 · per-account mastery quests, trials and independent Inventory flairs.
-- Additive only. No account, XP, inventory, currency or historical run reset.
-- Physics remain client simulated. Receipt ownership, event order, plausible
-- rates, elapsed time and sequential quest/trial transitions are checked here;
-- these envelopes are not a claim of server-authoritative collision detection.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

create table if not exists app_private.player_mastery_quests(
 user_id uuid not null references public.player_stats(user_id) on delete cascade,
 character_key text not null check(character_key in('runner_dash','runner_stride','medic_bloom','medic_remedy','medic_salve','runner_vault','tank_guard','trickster_smoke')),
 quest integer not null default 0 check(quest between 0 and 3),
 progress numeric not null default 0 check(progress>=0 and progress<>'NaN'::numeric),
 progress_two numeric not null default 0 check(progress_two>=0 and progress_two<>'NaN'::numeric),
 mastered boolean not null default false,
 mastery_enabled boolean not null default false,
 flair_rewrite_enabled boolean not null default false,
 purchased_at timestamptz not null default clock_timestamp(),
 mastered_at timestamptz,
 primary key(user_id,character_key),
 check(not mastered or quest=3),check(not mastery_enabled or mastered),check(not flair_rewrite_enabled or mastered)
);
create table if not exists app_private.player_mastery_preferences(
 user_id uuid primary key references public.player_stats(user_id) on delete cascade,
 active_character text,
 flair_character text,
 endless_randomizer boolean not null default false,
 foreign key(user_id,active_character) references app_private.player_mastery_quests(user_id,character_key)
);
create table if not exists app_private.mastery_sessions(
 id uuid primary key default gen_random_uuid(),user_id uuid not null references public.player_stats(user_id) on delete cascade,
 context_id uuid,context_type text not null check(context_type in('endless','1v1','trial')),
 character_key text not null,
 started_at timestamptz not null default clock_timestamp(),finished_at timestamptz,
 last_received_at timestamptz not null default clock_timestamp(),
 last_seq integer not null default 0 check(last_seq>=0),active_seconds numeric not null default 0,
 last_at numeric not null default 0,events integer not null default 0,
 event_counts jsonb not null default '{}'::jsonb,
 run_failed boolean not null default false,
 trial_failed boolean not null default false,trial_ready boolean not null default false,
 finale_at numeric,trial_wave integer not null default 1,
 trial_count integer not null default 0,trial_heat integer not null default 0,
 trial_heat_seconds numeric not null default 0,trial_low_seconds numeric not null default 0,
 trial_wave_seconds numeric not null default 0,trial_first_gem boolean not null default false,
 trial_pole_damaged boolean not null default false,
 flair_character text,gem_multiplier numeric not null default 1 check(gem_multiplier between 1 and 1.35),
 gem_fraction numeric not null default 0 check(gem_fraction>=0 and gem_fraction<1),
 constraint mastery_session_time_range check(active_seconds between 0 and 21600 and last_at between 0 and 21600)
);
create index if not exists mastery_sessions_owner_started on app_private.mastery_sessions(user_id,started_at desc);
create unique index if not exists mastery_one_active_session on app_private.mastery_sessions(user_id) where finished_at is null;
create table if not exists app_private.mastery_heal_tokens(
 match_id uuid not null references public.multiplayer_matches(id) on delete cascade,
 user_id uuid not null references public.player_stats(user_id) on delete cascade,
 event_id uuid not null,session_id uuid not null references app_private.mastery_sessions(id) on delete cascade,
 kind text not null check(kind='dash-green'),created_at timestamptz not null default clock_timestamp(),
 consumed_at timestamptz,hearts_after numeric,
 primary key(match_id,user_id,event_id)
);
alter table app_private.mastery_sessions add column if not exists last_received_at timestamptz not null default clock_timestamp();
alter table app_private.player_mastery_quests enable row level security;
alter table app_private.player_mastery_preferences enable row level security;
alter table app_private.mastery_sessions enable row level security;
alter table app_private.mastery_heal_tokens enable row level security;
revoke all on app_private.player_mastery_quests,app_private.player_mastery_preferences,app_private.mastery_sessions from public,anon,anonymous,authenticated;
revoke all on app_private.mastery_heal_tokens from public,anon,anonymous,authenticated;

create or replace function app_private.mastery_price(k text)
returns integer language sql immutable set search_path='' as $$
 select case k when 'runner_dash' then 200 when 'runner_stride' then 200
 when 'medic_bloom' then 225 when 'medic_remedy' then 225 when 'medic_salve' then 250
 when 'runner_vault' then 260 when 'tank_guard' then 260 when 'trickster_smoke' then 300 end;
$$;
create or replace function app_private.mastery_target(k text,q integer)
returns numeric language sql immutable set search_path='' as $$
 select case k when 'runner_dash' then (array[100,10,75])[q+1]
 when 'runner_stride' then (array[300,100,100])[q+1]
 when 'medic_bloom' then (array[50,10,5])[q+1]
 when 'medic_remedy' then (array[50,20,100])[q+1]
 when 'medic_salve' then (array[300,20,20])[q+1]
 when 'runner_vault' then (array[50,50,10])[q+1]
 when 'tank_guard' then (array[50,20,100])[q+1]
 when 'trickster_smoke' then (array[50,30,30])[q+1] end;
$$;
create or replace function app_private.mastery_owns_character(u uuid,k text)
returns boolean language sql stable security definer set search_path='' as $$
 select u is not null and exists(select 1 from public.extraction_catalog c
 where c.item_key=k and c.item_type='character' and c.active
 and (k in('runner_ace','medic_patch','tank_bulwark','trickster_rogue')
 or exists(select 1 from public.player_unlocks x where x.user_id=u and x.item_key=k and x.item_type='character')));
$$;
create or replace function app_private.rounded_health_for_conditions(h numeric)
returns numeric language sql immutable strict set search_path='' as $$
 select case when h<=0 or h='NaN'::numeric then 0 else greatest(.5,floor(h*2+.5)/2) end;
$$;
create or replace function public.get_mastery_profile()
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=app_private.photon_user();p app_private.player_mastery_preferences;v jsonb;f text;
begin
 select * into p from app_private.player_mastery_preferences where user_id=u;
 select coalesce(jsonb_object_agg(character_key,jsonb_build_object('quest',quest,
  'progress',case when character_key='runner_stride' and quest=2 then jsonb_build_array(progress,progress_two) else jsonb_build_array(progress) end,
  'complete',quest=3,'mastered',mastered,'masteryEnabled',mastery_enabled,'flairRewriteEnabled',flair_rewrite_enabled)),'{}'::jsonb)
 into v from app_private.player_mastery_quests where user_id=u;
 f:=p.flair_character;
 if not coalesce(app_private.mastery_owns_character(u,f),false) then
  select character_key into f from public.player_loadouts where user_id=u;
  if not coalesce(app_private.mastery_owns_character(u,f),false) then f:='runner_ace';end if;
 end if;
 return jsonb_build_object('account',jsonb_build_object('active',p.active_character,'quests',v),'flair_key',f,'randomizer',coalesce(p.endless_randomizer,false),
 'photons',(select photons from public.player_photon_fury where user_id=u and unlocked_at is not null));
end $$;
create or replace function public.purchase_mastery_quest(p_character_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=app_private.photon_user();cost integer:=app_private.mastery_price(p_character_key);b bigint;
begin
 if cost is null then raise exception 'This character has no mastery quest';end if;
 if not app_private.mastery_owns_character(u,p_character_key) then raise exception 'Unlock this character first';end if;
 if app_private.is_admin_test_user(u) then raise exception 'Turn off Test Mode before purchasing';end if;
 perform pg_advisory_xact_lock(hashtextextended(u::text,23));
 if exists(select 1 from app_private.player_mastery_quests where user_id=u and character_key=p_character_key) then return public.get_mastery_profile();end if;
 select photons into b from public.player_photon_fury where user_id=u and unlocked_at is not null for update;
 if b is null or b<cost then raise exception 'You need % photons',cost;end if;
 update public.player_photon_fury set photons=photons-cost where user_id=u;
 insert into app_private.player_mastery_quests(user_id,character_key) values(u,p_character_key);
 insert into app_private.player_mastery_preferences(user_id,active_character) values(u,p_character_key)
 on conflict(user_id) do update set active_character=coalesce(app_private.player_mastery_preferences.active_character,excluded.active_character);
 return public.get_mastery_profile();
end $$;
create or replace function public.activate_mastery_quest(p_character_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=app_private.photon_user();
begin
 perform pg_advisory_xact_lock(hashtextextended(u::text,23));
 if not app_private.mastery_owns_character(u,p_character_key) then raise exception 'Character locked';end if;
 if not exists(select 1 from app_private.player_mastery_quests where user_id=u and character_key=p_character_key and quest<3) then raise exception 'No incomplete quest for this character';end if;
 -- Expiry releases abandoned/crashed sessions without crediting anything.
 -- Sign-out must retire auth immediately rather than wait for a network save.
 update app_private.mastery_sessions s set finished_at=clock_timestamp()
 where s.user_id=u and s.finished_at is null and (
  s.context_type='trial' and s.last_received_at<clock_timestamp()-interval '60 seconds'
  or s.context_type='endless' and not exists(select 1 from public.player_progression_runs r where r.run_id=s.context_id and r.user_id=u and r.completed_at is null and r.heartbeat_active and r.last_heartbeat_at>=clock_timestamp()-interval '60 seconds')
  or s.context_type='1v1' and not exists(select 1 from public.multiplayer_players p join public.multiplayer_matches m on m.id=p.match_id
   join public.player_progression_1v1_activity a on a.match_id=p.match_id and a.user_id=p.user_id
   where p.match_id=s.context_id and p.user_id=u and m.finished_at is null and a.last_heartbeat_at>=clock_timestamp()-interval '60 seconds'));
 if exists(select 1 from app_private.mastery_sessions where user_id=u and finished_at is null) then raise exception 'Finish the current run before switching quests';end if;
 insert into app_private.player_mastery_preferences(user_id,active_character) values(u,p_character_key)
 on conflict(user_id) do update set active_character=excluded.active_character;
 return public.get_mastery_profile();
end $$;
create or replace function public.set_mastery_toggle(p_character_key text,p_which text,p_enabled boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=app_private.photon_user();
begin
 if p_which is null or p_which not in('mastery','flair') or p_enabled is null then raise exception 'Invalid mastery toggle';end if;
 if not app_private.mastery_owns_character(u,p_character_key) then raise exception 'Character locked';end if;
 update app_private.player_mastery_quests set mastery_enabled=case when p_which='mastery' then p_enabled else mastery_enabled end,
  flair_rewrite_enabled=case when p_which='flair' then p_enabled else flair_rewrite_enabled end
 where user_id=u and character_key=p_character_key and mastered;
 if not found then raise exception 'Complete this mastery trial first';end if;
 return public.get_mastery_profile();
end $$;
create or replace function public.set_player_flair(p_flair_key text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=app_private.photon_user();
begin
 if not app_private.mastery_owns_character(u,p_flair_key) then raise exception 'Unlock the flair character first';end if;
 insert into app_private.player_mastery_preferences(user_id,flair_character) values(u,p_flair_key)
 on conflict(user_id) do update set flair_character=excluded.flair_character;
 return public.get_mastery_profile();
end $$;
create or replace function public.set_endless_randomizer(p_enabled boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=app_private.photon_user();
begin
 if p_enabled is null then raise exception 'Choose on or off';end if;
 insert into app_private.player_mastery_preferences(user_id,endless_randomizer) values(u,p_enabled)
 on conflict(user_id) do update set endless_randomizer=excluded.endless_randomizer;
 return public.get_mastery_profile();
end $$;
-- Reset the selected flair only when the character actually changes, not when
-- its skin changes. The former set_player_weapon RPC remains retired.
create or replace function app_private.default_character_flair()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='INSERT' or new.character_key is distinct from old.character_key then
  if app_private.mastery_owns_character(new.user_id,new.character_key) then
   insert into app_private.player_mastery_preferences(user_id,flair_character) values(new.user_id,new.character_key)
   on conflict(user_id) do update set flair_character=excluded.flair_character;
  end if;
 end if;
 return new;
end $$;
drop trigger if exists update_23_default_character_flair on public.player_loadouts;
create trigger update_23_default_character_flair after insert or update of character_key on public.player_loadouts for each row execute function app_private.default_character_flair();

create or replace function public.begin_mastery_session(p_context_id uuid,p_context_type text,p_character_key text,p_trial_key text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=app_private.photon_user();r uuid;c text;v_trial boolean:=p_trial_key is not null;q app_private.player_mastery_quests;f text;g numeric:=1;previous app_private.mastery_sessions;
begin
 if not app_private.mastery_owns_character(u,p_character_key) then raise exception 'Character locked';end if;
 if app_private.is_admin_test_user(u) then raise exception 'Test Mode runs do not progress mastery';end if;
 if p_context_type is null or p_context_type not in('endless','1v1') or v_trial and (p_context_type<>'endless' or p_trial_key<>p_character_key) then raise exception 'Invalid mastery context';end if;
 perform pg_advisory_xact_lock(hashtextextended(u::text,23));
 select * into previous from app_private.mastery_sessions where user_id=u and context_id=p_context_id and character_key=p_character_key
  and context_type=case when v_trial then 'trial' else p_context_type end and finished_at is null;
 if previous.id is not null then return jsonb_build_object('session_id',previous.id,'trial',v_trial,'last_seq',previous.last_seq,'last_at',previous.last_at,'profile',public.get_mastery_profile());end if;
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
 select flair_character into f from app_private.player_mastery_preferences where user_id=u;
 if not coalesce(app_private.mastery_owns_character(u,f),false) then f:=p_character_key;end if;
 if f='medic_bloom' and exists(select 1 from app_private.player_mastery_quests where user_id=u and character_key=f and mastered and flair_rewrite_enabled) then g:=case when f=p_character_key then 1.35 else 1.25 end;end if;
 insert into app_private.mastery_sessions(user_id,context_id,context_type,character_key,flair_character,gem_multiplier) values(u,p_context_id,case when v_trial then 'trial' else p_context_type end,p_character_key,f,g) returning id into r;
 return jsonb_build_object('session_id',r,'trial',v_trial,'last_seq',0,'last_at',0,'profile',public.get_mastery_profile());
end $$;

-- Every batch carries {seq, at, type, ...event fields}; at is active gameplay
-- seconds since session start. Retransmissions with an already seen seq cannot
-- credit twice. Gaps, backwards clocks, oversized batches and impossible rates
-- abort atomically. The client never submits a quest total or completed flag.
create or replace function public.credit_mastery_events(p_session_id uuid,p_batch jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
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
 select active_character into active_key from app_private.player_mastery_preferences where user_id=u;
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
end $$;
create or replace function public.finish_mastery_trial(p_session_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=app_private.photon_user();s app_private.mastery_sessions;
begin
 perform pg_advisory_xact_lock(hashtextextended(u::text,23));
 select * into s from app_private.mastery_sessions where id=p_session_id and user_id=u for update;
 if s.id is null or s.context_type<>'trial' then raise exception 'Owned trial receipt required';end if;
 if not app_private.mastery_owns_character(u,s.character_key) or app_private.is_admin_test_user(u) then raise exception 'Trial no longer eligible';end if;
 if s.trial_failed or not s.trial_ready or s.finale_at is null or s.last_at<s.finale_at+3 then raise exception 'Complete the trial and collect its trophy first';end if;
 update app_private.player_mastery_quests set mastered=true,mastery_enabled=true,flair_rewrite_enabled=true,mastered_at=coalesce(mastered_at,clock_timestamp())
 where user_id=u and character_key=s.character_key and quest=3 and not mastered;
 update app_private.mastery_sessions set finished_at=coalesce(finished_at,clock_timestamp()) where id=s.id;
 return public.get_mastery_profile();
end $$;
-- Preserve the latest installed heartbeat/rate/streak/receipt implementation.
-- Apply this migration AFTER Update 2.3 economy; do not replay an older wrapper.
do $gem_wrapper$
declare f text;
begin
 if to_regprocedure('app_private.claim_player_gem_before_mastery_flairs(uuid,text)') is null then
  f:=pg_get_functiondef('public.claim_player_gem(uuid,text)'::regprocedure);
  if position('FUNCTION public.claim_player_gem(' in f)=0 then raise exception 'Unexpected gem function definition';end if;
  execute replace(f,'FUNCTION public.claim_player_gem(','FUNCTION app_private.claim_player_gem_before_mastery_flairs(');
 end if;
end $gem_wrapper$;
revoke all on function app_private.claim_player_gem_before_mastery_flairs(uuid,text) from public,anon,anonymous,authenticated;
create or replace function public.claim_player_gem(p_context_id uuid,p_pickup_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=app_private.photon_user();r jsonb;s app_private.mastery_sessions;extra bigint;carry numeric;total bigint;awarded bigint;
begin
 -- Existing implementation validates own active receipt, freshness, rate and
 -- duplicate pickup ID, and grants no currency for a marked mastery trial.
 r:=app_private.claim_player_gem_before_mastery_flairs(p_context_id,p_pickup_id);
 if (r->>'is_new')::boolean is not true or (r->>'test_mode')::boolean is true then return r;end if;
 select * into s from app_private.mastery_sessions where user_id=u and context_id=p_context_id
  and context_type in('endless','1v1') and finished_at is null order by started_at desc limit 1 for update;
 if s.id is null or s.gem_multiplier<=1 or not app_private.mastery_owns_character(u,s.flair_character) then return r;end if;
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
end $$;
revoke all on function public.claim_player_gem(uuid,text) from public,anon,anonymous;
grant execute on function public.claim_player_gem(uuid,text) to authenticated;
revoke all on function app_private.mastery_price(text),app_private.mastery_target(text,integer),
 app_private.mastery_owns_character(uuid,text),app_private.rounded_health_for_conditions(numeric),app_private.default_character_flair()
 from public,anon,anonymous,authenticated;
revoke all on function public.get_mastery_profile(),public.purchase_mastery_quest(text),public.activate_mastery_quest(text),
 public.set_mastery_toggle(text,text,boolean),public.set_player_flair(text),public.set_endless_randomizer(boolean),
 public.begin_mastery_session(uuid,text,text,text),public.credit_mastery_events(uuid,jsonb),public.finish_mastery_trial(uuid)
 from public,anon,anonymous;
grant execute on function public.get_mastery_profile(),public.purchase_mastery_quest(text),public.activate_mastery_quest(text),
 public.set_mastery_toggle(text,text,boolean),public.set_player_flair(text),public.set_endless_randomizer(boolean),
 public.begin_mastery_session(uuid,text,text,text),public.credit_mastery_events(uuid,jsonb),public.finish_mastery_trial(uuid)
 to authenticated;
notify pgrst,'reload schema';
commit;
