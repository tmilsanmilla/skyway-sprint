-- Six-class multiplayer: original-match custody, durable opponent deliveries,
-- shared active wave clock and bounded phase ownership. No account replacement.
begin;
set local lock_timeout='3s';
create table if not exists app_private.six_class_players(
 match_id uuid not null,user_id uuid not null,original_key text not null,current_key text not null,behavior_key text not null,muse_stage integer not null default 0,muse_classes text[]not null default '{}',
 checkpoint jsonb not null default '{}',cooldowns jsonb not null default '{}',wave_earnings jsonb not null default '{}',
 phase_id integer not null default 0,phase_kind text,phase_until timestamptz,
 updated_at timestamptz not null default clock_timestamp(),primary key(match_id,user_id),
 foreign key(match_id,user_id)references public.multiplayer_players(match_id,user_id)on delete cascade);
create table if not exists app_private.six_class_clocks(
 match_id uuid primary key references public.multiplayer_matches(id)on delete cascade,wave integer not null,
 wave_started_at timestamptz not null,paused_at timestamptz);
create table if not exists app_private.six_class_events(
 id uuid primary key default gen_random_uuid(),match_id uuid not null references public.multiplayer_matches(id)on delete cascade,
 sender_user_id uuid not null,target_user_id uuid not null,action text not null,values jsonb not null default '{}',
 due_at timestamptz not null,expires_at timestamptz not null,acknowledged_at timestamptz,retry_at timestamptz,
 foreign key(match_id,sender_user_id)references public.multiplayer_players(match_id,user_id)on delete cascade,
 foreign key(match_id,target_user_id)references public.multiplayer_players(match_id,user_id)on delete cascade,
 check(expires_at>=due_at));
create index if not exists six_class_pending_events on app_private.six_class_events(match_id,target_user_id,due_at)where acknowledged_at is null;
create table if not exists app_private.six_class_commands(
 match_id uuid not null,user_id uuid not null,command_id uuid not null,payload_hash text not null,result jsonb not null,
 primary key(match_id,user_id,command_id),foreign key(match_id,user_id)references public.multiplayer_players(match_id,user_id)on delete cascade);
comment on table app_private.six_class_players is 'skyway-six-class-runtime-v1';
comment on table app_private.six_class_clocks is 'skyway-six-class-runtime-v1';
comment on table app_private.six_class_events is 'skyway-six-class-runtime-v1';
comment on table app_private.six_class_commands is 'skyway-six-class-runtime-v1';
alter table app_private.six_class_players enable row level security;
alter table app_private.six_class_clocks enable row level security;
alter table app_private.six_class_events enable row level security;
alter table app_private.six_class_commands enable row level security;
revoke all on app_private.six_class_players,app_private.six_class_clocks,app_private.six_class_events,app_private.six_class_commands from public,anon,anonymous,authenticated;

-- NEW_FUNCTION_SOURCE_GUARD
do $guard$ begin if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app_private'and p.proname='ensure_six_class_match'and md5(p.prosrc)<>'868348e50348d1aca5f6af005b15c082')then raise exception 'Unexpected existing function: app_private.ensure_six_class_match';end if;end $guard$;
-- END_NEW_FUNCTION_SOURCE_GUARD
create or replace function app_private.ensure_six_class_match(mid uuid,u uuid)returns void language plpgsql security definer set search_path=''as $$
declare m public.multiplayer_matches;c app_private.six_class_clocks;at_time timestamptz:=clock_timestamp();paused boolean;e record;begin
 select *into m from public.multiplayer_matches where id=mid for update;
 if m.id is null or not exists(select 1 from public.multiplayer_players where match_id=mid and user_id=u)then raise exception 'Owned match required';end if;
 insert into app_private.six_class_players(match_id,user_id,original_key,current_key,behavior_key)
 select mid,p.user_id,p.character_key,p.character_key,p.character_key from public.multiplayer_players p where p.match_id=mid on conflict do nothing;
 insert into app_private.six_class_clocks(match_id,wave,wave_started_at)
 values(mid,m.current_wave,coalesce((select min(wave_started_at)from public.multiplayer_players where match_id=mid and wave=m.current_wave and status not in('left','eliminated','finished')),m.started_at,at_time))on conflict do nothing;
 if m.status='countdown'then
  update app_private.six_class_players s set original_key=p.character_key,current_key=p.character_key,behavior_key=p.character_key,checkpoint='{}',cooldowns='{}'
  from public.multiplayer_players p where p.match_id=mid and s.match_id=p.match_id and s.user_id=p.user_id and s.original_key<>p.character_key;
 end if;
 select *into c from app_private.six_class_clocks where match_id=mid for update;
 if m.status='intermission'and m.intermission_ends_at<=at_time then
  update public.multiplayer_matches set status='playing',last_activity_at=at_time where id=mid returning *into m;
  update public.multiplayer_players set status='playing',wave_started_at=m.intermission_ends_at where match_id=mid and status='intermission';
 end if;
 if c.wave<>m.current_wave then
  update app_private.six_class_clocks set wave=m.current_wave,wave_started_at=coalesce(m.intermission_ends_at,at_time),paused_at=null where match_id=mid returning *into c;
 end if;
 -- A timed-out owned challenge cannot freeze the other player's match forever.
 for e in select *from app_private.six_class_players where match_id=mid and phase_kind is not null and phase_until<at_time for update loop
  update app_private.six_class_players set phase_kind=null,phase_until=null where match_id=mid and user_id=e.user_id;
  update public.multiplayer_players set hearts=0,status='eliminated'where match_id=mid and user_id=e.user_id and status not in('eliminated','left','finished');
  perform app_private.mark_1v1_eliminated(mid,e.user_id,at_time);
 end loop;
 select exists(select 1 from app_private.six_class_players where match_id=mid and phase_kind is not null and phase_until>=at_time)into paused;
 if paused and c.paused_at is null and m.status='playing'and at_time<c.wave_started_at+interval '40 seconds'then
  update app_private.six_class_clocks set paused_at=at_time where match_id=mid;
 elsif not paused and c.paused_at is not null then
  update app_private.six_class_events set due_at=due_at+(at_time-c.paused_at),expires_at=expires_at+(at_time-c.paused_at)where match_id=mid and acknowledged_at is null;
  update app_private.six_class_clocks set wave_started_at=wave_started_at+(at_time-paused_at),paused_at=null where match_id=mid;
 end if;
 for e in select *from app_private.six_class_events where match_id=mid and action in('pterodactyl','infinity')and acknowledged_at is null and expires_at<=at_time for update loop
  update app_private.six_class_events set acknowledged_at=at_time where id=e.id;
  update public.multiplayer_players set hearts=0,status='eliminated'where match_id=mid and user_id=e.target_user_id and status not in('eliminated','left','finished');
  perform app_private.mark_1v1_eliminated(mid,e.target_user_id,at_time);
 end loop;
 perform app_private.finalize_1v1_after_second_death(mid,at_time);
end $$;

-- NEW_FUNCTION_SOURCE_GUARD
do $guard$ begin if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app_private'and p.proname='six_class_delivery'and md5(p.prosrc)<>'4a8215752c93c34f15d6cdfd835f6aa4')then raise exception 'Unexpected existing function: app_private.six_class_delivery';end if;end $guard$;
-- END_NEW_FUNCTION_SOURCE_GUARD
create or replace function app_private.six_class_delivery(mid uuid,sender uuid,target uuid,kind text,payload jsonb,delay_seconds numeric,duration numeric)returns uuid language plpgsql security definer set search_path=''as $$
declare result uuid;begin
 if sender=target or delay_seconds<0 or delay_seconds>40 or duration<0 or duration>300 then raise exception 'Invalid character delivery';end if;
 insert into app_private.six_class_events(match_id,sender_user_id,target_user_id,action,values,due_at,expires_at)
 values(mid,sender,target,kind,payload,clock_timestamp()+delay_seconds*interval '1 second',clock_timestamp()+(delay_seconds+duration)*interval '1 second')returning id into result;
 return result;
end $$;

-- NEW_FUNCTION_SOURCE_GUARD
do $guard$ begin if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'and p.proname='six_class_ability_v1'and md5(p.prosrc)<>'eeef8d935c1c549538abc9b5c6de51d8')then raise exception 'Unexpected existing function: public.six_class_ability_v1';end if;end $guard$;
-- END_NEW_FUNCTION_SOURCE_GUARD
create or replace function public.six_class_ability_v1(p_match_id uuid,p_command_id uuid,p_action text,p_values jsonb default '{}')returns jsonb language plpgsql security definer set search_path=''as $$
begin
 perform app_private.require_pixel_runtime();
 <<owned_command>>declare
 u uuid:=app_private.photon_user();m public.multiplayer_matches;a public.multiplayer_players;b public.multiplayer_players;s app_private.six_class_players;
 c app_private.six_class_clocks;old app_private.six_class_commands;e app_private.six_class_events;
 now_at timestamptz:=clock_timestamp();fingerprint text;cooldown_key text;seconds numeric:=0;delay numeric:=0;duration numeric:=0;
 payload jsonb:='{}';kind text:=p_action;amount numeric;answer integer;lane integer;ready_at timestamptz;result jsonb;begin
 if p_match_id is null or p_command_id is null or p_action is null or jsonb_typeof(p_values)is distinct from 'object'or pg_column_size(p_values)>2048 then raise exception 'Invalid character command';end if;
 perform app_private.ensure_six_class_match(p_match_id,u);
 select *into m from public.multiplayer_matches where id=p_match_id for update;
 select *into a from public.multiplayer_players where match_id=p_match_id and user_id=u for update;
 select *into b from public.multiplayer_players where match_id=p_match_id and user_id<>u order by slot limit 1 for update;
 select *into s from app_private.six_class_players where match_id=p_match_id and user_id=u for update;
 select *into c from app_private.six_class_clocks where match_id=p_match_id;
 fingerprint:=md5(p_action||p_values::text);
 select *into old from app_private.six_class_commands where match_id=p_match_id and user_id=u and command_id=p_command_id;
 if old.command_id is not null then if old.payload_hash<>fingerprint then raise exception 'Command identity conflict';end if;return old.result;end if;
 if m.status not in('playing','intermission')or a.status in('eliminated','left','finished')then raise exception 'Character action is not available';end if;
 if p_action in('duck','conic-answer')then
  select *into e from app_private.six_class_events where id=(p_values->>'event')::uuid and match_id=p_match_id and target_user_id=u for update;
  if e.id is null or e.acknowledged_at is not null or now_at<e.due_at or now_at>e.expires_at then raise exception 'Original live challenge required';end if;
  if p_action='duck'then
   if e.action not in('pterodactyl','infinity')or p_values->>'key'<>(case when e.action='infinity'then 'p'else 'b'end)then raise exception 'Wrong duck key';end if;
   update app_private.six_class_events set acknowledged_at=now_at where id=e.id;
  else
   if e.action<>'conic-check'or coalesce(e.retry_at,now_at)>now_at then raise exception 'Shape answer is not ready';end if;
   answer:=(p_values->>'answer')::integer;
   if answer=(e.values->>'shape')::integer then update app_private.six_class_events set acknowledged_at=now_at where id=e.id;
   else update app_private.six_class_events set retry_at=now_at+interval '1 second'where id=e.id;end if;
  end if;
 elsif p_action='phase-open'then
  if p_values->>'kind'is null or not(p_values->>'kind'=any(array['tempo','pulse','gambit','imagination','bowling','math','language','conic','drawing','void','hades-keys','hades-targets','oracle','echo-passives','pacer','muse','mimic','lantern','adaptation','wildcard','zenith-stop']))then raise exception 'Invalid character phase';end if;
  if (p_values->>'id')::integer<=s.phase_id then raise exception 'Stale character phase';end if;
  -- A phase belongs to the original server-selected character or a validated form.
  if not((p_values->>'kind'='language'and(s.current_key='chaotic_polyglot'or exists(select 1 from app_private.six_class_events where match_id=p_match_id and target_user_id=u and action='language'and acknowledged_at is null)))
   or (p_values->>'kind'='tempo'and s.current_key='runner_tempo')
   or (p_values->>'kind'='pulse'and(s.current_key='medic_pulse'or(s.current_key='trickster_echo'and s.checkpoint->'borrowed' ? 'medic_pulse')))
   or (p_values->>'kind'='gambit'and s.current_key='trickster_gambit')
   or (p_values->>'kind'='imagination'and s.current_key='chaotic_imagination')
   or (p_values->>'kind'='bowling'and s.current_key='chaotic_bowler')
   or (p_values->>'kind'='math'and s.current_key='chaotic_prodigy')
   or (p_values->>'kind'='conic'and s.current_key='chaotic_conic')
   or (p_values->>'kind'='drawing'and s.current_key='runner_cartographer')
   or (p_values->>'kind' in('void','hades-keys','hades-targets')and s.current_key='trickster_hex')
   or (p_values->>'kind'='oracle'and s.current_key='medic_oracle')
   or (p_values->>'kind'='echo-passives'and s.current_key='trickster_echo')
   or (p_values->>'kind'='pacer'and s.current_key='runner_pacer')
   or (p_values->>'kind'='muse'and s.behavior_key='misc_muse'and s.muse_stage<5)
   or (p_values->>'kind'='mimic'and s.current_key='misc_mimic')
   or (p_values->>'kind'='lantern'and s.current_key='misc_lantern')
   or (p_values->>'kind'='adaptation'and s.current_key='tank_general')
   or (p_values->>'kind'='wildcard'and s.current_key='trickster_wildcard')
   or (p_values->>'kind'='zenith-stop'and s.current_key='runner_zenith'and a.wave=15))then raise exception 'Character cannot open this phase';end if;
  update app_private.six_class_players set phase_id=(p_values->>'id')::integer,phase_kind=p_values->>'kind',phase_until=now_at+interval '120 seconds'where match_id=p_match_id and user_id=u;
 elsif p_action='phase-close'then
  if (p_values->>'id')::integer<>s.phase_id or s.phase_kind is null then raise exception 'Original open phase required';end if;
  update app_private.six_class_players set phase_kind=null,phase_until=null where match_id=p_match_id and user_id=u;
 elsif p_action='ack'then
  update app_private.six_class_events set acknowledged_at=now_at where id=(p_values->>'event')::uuid and match_id=p_match_id and target_user_id=u and action not in('pterodactyl','infinity','conic-check')and due_at<=now_at;
 else
  if b.user_id is null or b.status in('left','finished','eliminated')then raise exception 'Living rival required';end if;
  if exists(select 1 from app_private.six_class_events where match_id=p_match_id and target_user_id=u and action='conic-check'and acknowledged_at is null)then raise exception 'Answer the shape first';end if;
  cooldown_key:=p_action;
  case p_action
   when 'pickpocket'then if s.current_key<>'trickster_pickpocket'or b.character_key=s.current_key then raise exception 'Pickpocket is unavailable';end if;cooldown_key:=p_action||':'||a.wave;
    update public.multiplayer_players set score=greatest(0,score-300)where match_id=p_match_id and user_id=b.user_id;
    update public.multiplayer_players set score=score+300 where match_id=p_match_id and user_id=u;
    perform app_private.six_class_delivery(p_match_id,u,b.user_id,'score','{"amount":-300}',0,30);
   when 'burglar'then if s.current_key<>'trickster_burglar'or b.character_key=s.current_key then raise exception 'Burglar is unavailable';end if;cooldown_key:=p_action||':'||a.wave;
    select floor(coalesce((wave_earnings->>greatest(1,a.wave-1)::text)::numeric,0)*.1)into amount from app_private.six_class_players where match_id=p_match_id and user_id=b.user_id;
    update public.multiplayer_players set obstacle_points=least(1000000000,obstacle_points+coalesce(amount,0))where match_id=p_match_id and user_id=u;
   when 'mirage'then if s.current_key not in('trickster_mirage','trickster_wildcard')then raise exception 'Mirage is unavailable';end if;seconds:=20;
    select lane_count into lane from app_private.one_v_one_map_rules where map_key=m.map_key;
    answer:=floor(random()*(lane-1));if answer>=coalesce(b.lane_index,0)then answer:=answer+1;end if;payload:=jsonb_build_object('lane',answer);duration:=10;
   when 'vial'then if s.current_key<>'medic_vial'or b.character_key=s.current_key or now_at<m.started_at+interval '10 seconds'then raise exception 'Vial is unavailable';end if;seconds:=80;duration:=15;
   when 'flicker'then if s.current_key<>'trickster_flicker'then raise exception 'Flicker is unavailable';end if;cooldown_key:=p_action||':'||a.wave;duration:=1;
   when 'handflipper'then if s.current_key<>'trickster_handflipper'then raise exception 'Handflipper is unavailable';end if;seconds:=25;duration:=7;payload:='{"percent":10}';
   when 'pterodactyl'then if s.current_key<>'trickster_pterodactyl'then raise exception 'Pterodactyl is unavailable';end if;cooldown_key:=p_action||':'||a.wave;duration:=3;
   when 'infinity'then if s.current_key<>'chaotic_conic'then raise exception 'Infinity is unavailable';end if;cooldown_key:=p_action||':'||a.wave;duration:=1;delay:=greatest(0,least(34,greatest(5,(p_values->>'at')::numeric))-extract(epoch from(now_at-c.wave_started_at)));
   when 'conic-check'then if s.current_key<>'chaotic_conic'then raise exception 'Check is unavailable';end if;
    if exists(select 1 from app_private.six_class_events where match_id=p_match_id and target_user_id=b.user_id and action='conic-check'and acknowledged_at is null)then raise exception 'Rival is already answering';end if;
    payload:=jsonb_build_object('shape',floor(random()*10)::integer);seconds:=1;duration:=300;
   when 'spiral'then if s.current_key<>'chaotic_conic'then raise exception 'Spiral is unavailable';end if;seconds:=40;duration:=5;
   when 'flat-tire'then if s.current_key<>'chaotic_conic'or now_at<c.wave_started_at+interval '5 seconds'then raise exception 'Flat tire is unavailable';end if;seconds:=15;duration:=20;
   when 'potato'then if s.current_key<>'chaotic_conic'then raise exception 'Potato is unavailable';end if;cooldown_key:=p_action||':'||a.wave;duration:=40;
   when 'chip'then if s.current_key<>'chaotic_conic'then raise exception 'Chip is unavailable';end if;cooldown_key:=p_action||':'||a.wave;duration:=5;delay:=greatest(0,least(30,greatest(5,(p_values->>'at')::numeric))-extract(epoch from(now_at-c.wave_started_at)));
   when 'cloak'then if s.current_key<>'chaotic_cloak'then raise exception 'Cloak is unavailable';end if;cooldown_key:=p_action||':'||a.wave;duration:=300;
   when 'streaker'then if s.current_key<>'runner_streaker'or a.wave%2<>0 then raise exception 'Streaker is unavailable';end if;cooldown_key:=p_action||':'||a.wave;duration:=3;
   when 'spawn'then if s.current_key<>'tank_plow'or b.character_key=s.current_key or p_values->>'kind'<>'snowflake'then raise exception 'Snowflake return is unavailable';end if;seconds:=1;duration:=20;payload:='{"kind":"snowflake","amount":1}';
   when 'give-score'then if s.current_key<>'trickster_jester'then raise exception 'Jester is unavailable';end if;cooldown_key:=p_action||':'||a.wave;amount:=(p_values->>'amount')::numeric;if amount not in(500,1000)then raise exception 'Invalid Jester gift';end if;
    update public.multiplayer_players set score=score+amount where match_id=p_match_id and user_id=b.user_id;kind:='score';payload:=jsonb_build_object('amount',amount);duration:=30;
   when 'quantum-gravity'then if s.current_key<>'misc_prospector'or b.character_key=s.current_key then raise exception 'Quantum gravity is unavailable';end if;seconds:=2;duration:=1;
   when 'coin-override'then if s.current_key<>'runner_fortune'then raise exception 'Fortune is unavailable';end if;seconds:=.2;payload:=jsonb_build_object('percent',least(20,greatest(0,(p_values->>'percent')::numeric)));duration:=300;
   when 'wildcard-melon'then if s.current_key<>'trickster_wildcard'then raise exception 'Card is unavailable';end if;seconds:=1;payload:=jsonb_build_object('percent',least(27,greatest(0,(p_values->>'percent')::numeric)));duration:=300;
   when 'wildcard-delay'then if s.current_key<>'trickster_wildcard'then raise exception 'Card is unavailable';end if;seconds:=1;payload:=jsonb_build_object('seconds',least(.16,greatest(0,(p_values->>'seconds')::numeric)));duration:=300;
   when 'wildcard-confuse'then if s.current_key<>'trickster_wildcard'then raise exception 'Card is unavailable';end if;seconds:=1;payload:=jsonb_build_object('percent',least(8,greatest(0,(p_values->>'percent')::numeric)));duration:=300;
   when 'wildcard-jack'then if s.current_key<>'trickster_wildcard'or p_values->>'suit'not in('H','D','C')then raise exception 'Card is unavailable';end if;cooldown_key:=p_action||':'||(p_values->>'suit');payload:=jsonb_build_object('suit',p_values->>'suit');duration:=30;
   when 'wildcard-club'then if s.current_key<>'trickster_wildcard'then raise exception 'Card is unavailable';end if;cooldown_key:=p_action;duration:=30;
   when 'hyperlink'then if s.current_key<>'chaotic_hyperlink'then raise exception 'Hyperlink is unavailable';end if;seconds:=5;duration:=1;
   when 'echo-reflective'then if s.current_key<>'trickster_echo'or b.character_key=s.current_key then raise exception 'Mirror is unavailable';end if;cooldown_key:=p_action;duration:=10;
    update app_private.six_class_players set cooldowns=jsonb_set(cooldowns,array['mirror-until'],to_jsonb(now_at+interval '10 seconds'))where match_id=p_match_id and user_id=u;
    perform app_private.six_class_delivery(p_match_id,u,b.user_id,'echo-health','{}',0,10);
   when 'echo-hit'then
    if s.current_key<>'trickster_echo'or coalesce((s.cooldowns->>'mirror-until')::timestamptz,now_at)<=now_at then raise exception 'Original reflective phase required';end if;
    amount:=(p_values->>'amount')::numeric;if amount is null or amount<=0 or amount>7 or amount='NaN'::numeric then raise exception 'Invalid reflected contact';end if;
    seconds:=.1;kind:='echo-damage';payload:=jsonb_build_object('amount',amount);duration:=3;
   when 'echo-final-row'then if s.current_key<>'trickster_echo'or b.character_key=s.current_key then raise exception 'Mirror is unavailable';end if;cooldown_key:=p_action;duration:=30;
   when 'language'then if s.current_key<>'chaotic_polyglot'or b.character_key in('chaotic_polyglot','chaotic_prodigy')then raise exception 'Language challenge is unavailable';end if;cooldown_key:=p_action||':'||a.wave;
    answer:=(p_values->>'clip')::integer;if answer not between 0 and 47 then raise exception 'Invalid official clip';end if;payload:=jsonb_build_object('clip',answer);duration:=120;
   else raise exception 'Unsupported character action';
  end case;
  ready_at:=(s.cooldowns->>cooldown_key)::timestamptz;
  if ready_at is not null and now_at<ready_at then raise exception 'Ability cooldown';end if;
  update app_private.six_class_players set cooldowns=jsonb_set(cooldowns,array[cooldown_key],to_jsonb(case when seconds>0 then now_at+seconds*interval '1 second'else now_at+interval '6 hours'end))where match_id=p_match_id and user_id=u;
  if p_action not in('pickpocket','burglar')then perform app_private.six_class_delivery(p_match_id,u,b.user_id,kind,payload,delay,duration);end if;
 end if;
 result:=jsonb_build_object('accepted',true,'command_id',p_command_id);
 insert into app_private.six_class_commands values(p_match_id,u,p_command_id,fingerprint,result);
 perform app_private.ensure_six_class_match(p_match_id,u);
 return result;
 end owned_command;
end $$;

-- NEW_FUNCTION_SOURCE_GUARD
do $guard$ begin if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'and p.proname='six_class_checkpoint_v1'and md5(p.prosrc)<>'52148b386ddfe8aaee4e894e149ae7cd')then raise exception 'Unexpected existing function: public.six_class_checkpoint_v1';end if;end $guard$;
-- END_NEW_FUNCTION_SOURCE_GUARD
create or replace function public.six_class_checkpoint_v1(p_match_id uuid,p_nonce uuid,p_checkpoint jsonb)returns jsonb language plpgsql security definer set search_path=''as $$
begin perform app_private.require_pixel_runtime();
 <<checkpoint>>declare u uuid:=app_private.photon_user();s app_private.six_class_players;m public.multiplayer_matches;c app_private.six_class_catalog;k text;h numeric;begin
 if p_nonce is null or jsonb_typeof(p_checkpoint)is distinct from 'object'or pg_column_size(p_checkpoint)>20000 then raise exception 'Invalid character checkpoint';end if;
 perform app_private.ensure_six_class_match(p_match_id,u);
 select *into s from app_private.six_class_players where match_id=p_match_id and user_id=u for update;
 select *into m from public.multiplayer_matches where id=p_match_id;
 if m.status not in('playing','intermission')then raise exception 'Match has ended';end if;
 k:=p_checkpoint->>'key';select *into c from app_private.six_class_catalog where item_key=k;
 if c.item_key is null then raise exception 'Invalid current form';end if;
 if k<>s.current_key and k<>s.original_key then
  if s.behavior_key='misc_muse'then
   if s.phase_kind<>'muse'or s.muse_stage>=5 or c.character_class='chaotic'or c.character_class=any(s.muse_classes)or c.rarity<>(array['legendary','epic','rare','uncommon','common'])[s.muse_stage+1]then raise exception 'Original next Muse rarity and class required';end if;
   update app_private.six_class_players set muse_stage=muse_stage+1,muse_classes=array_append(muse_classes,c.character_class)where match_id=p_match_id and user_id=u;
  elsif s.original_key='misc_mimic'then
   if not app_private.owns_six_class_character(u,k)or not exists(select 1 from public.multiplayer_players where match_id=p_match_id and user_id<>u and character_key=k)then raise exception 'Owned rival form required';end if;
  elsif s.original_key='runner_pacer'then
   if s.phase_kind<>'pacer'or c.character_class in('runner','medic')or c.rarity='mythic'then raise exception 'Invalid baton form';end if;
  elsif s.original_key='misc_muse'then
   if s.phase_kind<>'muse'or c.character_class='chaotic'then raise exception 'Invalid Muse form';end if;
  elsif s.original_key='chaotic_snake'then
   if s.checkpoint<>'{}'or c.item_key='chaotic_snake'then raise exception 'Snake form already chosen';end if;
  elsif s.original_key='misc_challenger'then
   if k<>'runner_sprint'or not app_private.owns_six_class_character(u,k)then raise exception 'Invalid second life';end if;
  elsif s.original_key='misc_weaver'then
   if k<>'runner_courier'or not app_private.owns_six_class_character(u,k)then raise exception 'Invalid second life';end if;
  elsif s.original_key in('chaotic_polyglot','chaotic_prodigy')then
   if k<>'trickster_rogue'or not exists(select 1 from public.multiplayer_players where match_id=p_match_id and user_id<>u and character_key in('chaotic_polyglot','chaotic_prodigy'))then raise exception 'Invalid paired form';end if;
  else raise exception 'Character cannot transform';end if;
 end if;
 if not exists(select 1 from app_private.one_v_one_map_rules where map_key=m.map_key and c.character_class=any(allowed_character_classes))then raise exception 'Form is not legal on this map';end if;
 h:=(p_checkpoint->>'maxHp')::numeric;
 if h is null or h<.5 or h='NaN'::numeric or(h>c.max_hp and k not in('tank_juggernaut','trickster_echo')and not(h=10 and exists(select 1 from app_private.six_class_events where match_id=p_match_id and target_user_id=u and action='echo-health'and expires_at>clock_timestamp())))or(k='tank_juggernaut'and h>14)or(k='trickster_echo'and h>7)then raise exception 'Invalid form health';end if;
 if jsonb_typeof(p_checkpoint->'items')is distinct from 'array'or jsonb_array_length(p_checkpoint->'items')>100 then raise exception 'Invalid visible items';end if;
 if s.checkpoint='{}'and s.original_key in('misc_mimic','chaotic_snake')then update app_private.six_class_players set behavior_key=k where match_id=p_match_id and user_id=u;end if;
 update app_private.six_class_players set current_key=k,checkpoint=p_checkpoint||jsonb_build_object('behaviorRootKey',behavior_key),updated_at=clock_timestamp()where match_id=p_match_id and user_id=u;
 update public.multiplayer_players set max_hearts=h,hearts=least(hearts,h)where match_id=p_match_id and user_id=u;
 return jsonb_build_object('saved',true,'nonce',p_nonce);
 end checkpoint;
end $$;

-- NEW_FUNCTION_SOURCE_GUARD
do $guard$ begin if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'and p.proname='acknowledge_six_class_events'and md5(p.prosrc)<>'c03f93dc3c85d2ee32bfd0543805d2a6')then raise exception 'Unexpected existing function: public.acknowledge_six_class_events';end if;end $guard$;
-- END_NEW_FUNCTION_SOURCE_GUARD
create or replace function public.acknowledge_six_class_events(p_match_id uuid,p_event_ids uuid[])returns void language plpgsql security definer set search_path=''as $$
begin perform app_private.require_pixel_runtime();
 <<ack>>declare u uuid:=app_private.photon_user();begin
 if p_event_ids is null or cardinality(p_event_ids)>200 then raise exception 'Invalid event acknowledgments';end if;
 perform app_private.ensure_six_class_match(p_match_id,u);
 update app_private.six_class_events set acknowledged_at=clock_timestamp()where id=any(p_event_ids)and match_id=p_match_id and target_user_id=u and action not in('conic-check','pterodactyl','infinity')and due_at<=clock_timestamp();
 end ack;
end $$;

-- NEW_FUNCTION_SOURCE_GUARD
do $guard$ begin if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app_private'and p.proname='six_class_network'and md5(p.prosrc)<>'01033ac6c5324c25eac7104176134ad6')then raise exception 'Unexpected existing function: app_private.six_class_network';end if;end $guard$;
-- END_NEW_FUNCTION_SOURCE_GUARD
create or replace function app_private.six_class_network(mid uuid,u uuid)returns jsonb language plpgsql security definer set search_path=''as $$
declare c app_private.six_class_clocks;events jsonb;checkpoint jsonb;rival jsonb;begin
 perform app_private.ensure_six_class_match(mid,u);
 select *into c from app_private.six_class_clocks where match_id=mid;
 select p.checkpoint into checkpoint from app_private.six_class_players p where match_id=mid and user_id=u;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'action',action,'values',values,'due_at',due_at,'expires_at',expires_at)order by due_at,id),'[]')into events from app_private.six_class_events where match_id=mid and target_user_id=u and acknowledged_at is null and expires_at>=clock_timestamp();
 select jsonb_build_object('lane',p.lane_index,'items',coalesce((select jsonb_agg(jsonb_build_object('id',v->'id','kind',v->'kind','lane',v->'lane','y',v->'y'))from jsonb_array_elements(coalesce(s.checkpoint->'items','[]'))v),'[]'))into rival from public.multiplayer_players p join app_private.six_class_players s on s.match_id=p.match_id and s.user_id=p.user_id where p.match_id=mid and p.user_id<>u limit 1;
 return jsonb_build_object('rival',rival,'wave',c.wave,'wave_started_at',c.wave_started_at,'server_now',coalesce(c.paused_at,clock_timestamp()),'paused',c.paused_at is not null,'events',events,'checkpoint',checkpoint);
end $$;

revoke all on function app_private.ensure_six_class_match(uuid,uuid),app_private.six_class_delivery(uuid,uuid,uuid,text,jsonb,numeric,numeric),app_private.six_class_network(uuid,uuid)from public,anon,anonymous,authenticated;
revoke all on function public.six_class_ability_v1(uuid,uuid,text,jsonb),public.six_class_checkpoint_v1(uuid,uuid,jsonb),public.acknowledge_six_class_events(uuid,uuid[])from public,anon,anonymous;
grant execute on function public.six_class_ability_v1(uuid,uuid,text,jsonb),public.six_class_checkpoint_v1(uuid,uuid,jsonb),public.acknowledge_six_class_events(uuid,uuid[])to authenticated;
do $guard$ declare h text;begin select md5(prosrc)into h from pg_proc where oid='public.get_1v1_state(uuid)'::regprocedure;if h not in('5d5089eb9451bac308c8dc46cd2e76d4','5c2b92aae87c3de6554edd17d319eec1')then raise exception 'Source drift: public.get_1v1_state(uuid)';end if;end $guard$;
do $clone$ begin if to_regprocedure('app_private.get_1v1_state_before_six_class(uuid)')is null then execute 'CREATE OR REPLACE FUNCTION app_private.get_1v1_state_before_six_class(p_match_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''''
AS $function$
begin
  -- Pixel runtime boundary: before original variable initializers or writes.
  perform app_private.require_pixel_runtime();
  <<skyway_original>>
declare u uuid:=auth.uid();p jsonb;w integer;
begin
 if u is null or not exists(select 1 from public.multiplayer_players where match_id=p_match_id and user_id=u) then raise exception ''Match not found'';end if;
 perform app_private.settle_ruins_completed_pumpkins(p_match_id); p:=app_private.get_1v1_state_qol_base(p_match_id);w:=(p->''match''->>''current_wave'')::integer;
 return p||jsonb_build_object(''self'',(p->''self'')||jsonb_build_object(
  ''purchase_counts'',app_private.armory_purchase_counts(p_match_id,u,w),
  ''ruins_pumpkins_missed'',(select ruins_pumpkins_missed from public.multiplayer_players where match_id=p_match_id and user_id=u),
  ''ruins_pumpkin_last_wave'',(select ruins_pumpkin_last_wave from public.multiplayer_players where match_id=p_match_id and user_id=u),
  ''terminal_facing'',(select terminal_facing from public.multiplayer_players where match_id=p_match_id and user_id=u),
  ''ruins_banned_characters'',(select coalesce(jsonb_agg(character_key order by character_key),''[]'') from app_private.ruins_character_bans where match_id=p_match_id)));
end;
end
$function$
';end if;if(select md5(prosrc)from pg_proc where oid='app_private.get_1v1_state_before_six_class(uuid)'::regprocedure)<>'5d5089eb9451bac308c8dc46cd2e76d4'then raise exception 'Original protected counterpart drift';end if;end $clone$;
revoke all on function app_private.get_1v1_state_before_six_class(uuid)from public,anon,anonymous,authenticated;
create or replace function public.get_1v1_state(p_match_id uuid)returns jsonb language plpgsql security definer set search_path=''as $$
begin perform app_private.require_pixel_runtime();
 <<owned_read>>declare u uuid:=app_private.photon_user();p jsonb;begin
 perform app_private.ensure_six_class_match(p_match_id,u);
 p:=app_private.get_1v1_state_before_six_class(p_match_id);
 return p||jsonb_build_object('six_class',app_private.six_class_network(p_match_id,u));
 end owned_read;
end $$;
do $guard$ declare h text;begin select md5(prosrc)into h from pg_proc where oid='public.update_1v1_state(uuid,numeric,integer,bigint,text)'::regprocedure;if h not in('77b5624409c06bf787960d2f97864fa5','e7b14030af40625de2f899f1eb535cc4')then raise exception 'Source drift: public.update_1v1_state(uuid,numeric,integer,bigint,text)';end if;end $guard$;
do $clone$ begin if to_regprocedure('app_private.update_1v1_state_before_six_class(uuid,numeric,integer,bigint,text)')is null then execute 'CREATE OR REPLACE FUNCTION app_private.update_1v1_state_before_six_class(p_match_id uuid, p_hearts numeric, p_wave integer, p_score bigint, p_status text DEFAULT ''playing''::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''''
AS $function$
begin
  -- Pixel runtime boundary: before original variable initializers or writes.
  perform app_private.require_pixel_runtime();
  <<skyway_original>>
declare
  v_uid uuid := auth.uid();
  v_match public.multiplayer_matches;
  v_self public.multiplayer_players;
  v_opponent public.multiplayer_players;
  v_heat_consumed numeric := 0;
  v_damage numeric;
  v_damage_multiplier numeric := 1;
  v_effective_hearts numeric := p_hearts;
  v_effective_status text := p_status;
begin
  if exists(select 1 from public.multiplayer_matches m where m.id=p_match_id and m.status=''countdown'') then return public.get_1v1_state(p_match_id); end if;
  if v_uid is not null then
    select * into v_match
    from public.multiplayer_matches match_row
    where match_row.id = p_match_id
    for update;
    perform 1
    from public.multiplayer_players player
    where player.match_id = p_match_id
    order by player.slot
    for update;
    select * into v_self
    from public.multiplayer_players player
    where player.match_id = p_match_id and player.user_id = v_uid;
    select * into v_opponent
    from public.multiplayer_players player
    where player.match_id = p_match_id and player.user_id <> v_uid
    limit 1;
  end if;

  if v_match.status = ''playing''
     and v_self.status = ''playing''
     and p_hearts is not null
     and p_hearts < v_self.hearts then
    select coalesce(ledger.consumed, 0)
    into v_heat_consumed
    from public.multiplayer_heatfeast ledger
    where ledger.match_id = p_match_id;
    if coalesce(v_heat_consumed, 0) >= 100 then
      if v_self.character_key = ''runner_comet'' then
        v_damage_multiplier := v_damage_multiplier * 0.75;
      end if;
      if v_opponent.character_key = ''runner_comet'' then
        v_damage_multiplier := v_damage_multiplier * 1.25;
      end if;
      v_damage := v_self.hearts - p_hearts;
      v_effective_hearts := greatest(
        0,
        v_self.hearts - v_damage * v_damage_multiplier
      );
      if v_effective_hearts > 0 and v_effective_status = ''eliminated'' then
        v_effective_status := ''playing'';
      end if;
    end if;
  end if;

  return app_private.update_1v1_state_unadjusted(
    p_match_id,
    v_effective_hearts,
    p_wave,
    p_score,
    v_effective_status
  );
end;
end
$function$

';end if;if(select md5(prosrc)from pg_proc where oid='app_private.update_1v1_state_before_six_class(uuid,numeric,integer,bigint,text)'::regprocedure)<>'77b5624409c06bf787960d2f97864fa5'then raise exception 'Original protected counterpart drift';end if;end $clone$;
revoke all on function app_private.update_1v1_state_before_six_class(uuid,numeric,integer,bigint,text)from public,anon,anonymous,authenticated;
create or replace function public.update_1v1_state(p_match_id uuid,p_hearts numeric,p_wave integer,p_score bigint,p_status text default 'playing')returns jsonb language plpgsql security definer set search_path=''as $$
begin perform app_private.require_pixel_runtime();
 <<owned_update>>declare u uuid:=app_private.photon_user();c app_private.six_class_clocks;m public.multiplayer_matches;begin
 perform app_private.ensure_six_class_match(p_match_id,u);
 select *into m from public.multiplayer_matches where id=p_match_id;
 select *into c from app_private.six_class_clocks where match_id=p_match_id;
 if p_status='intermission'and(p_wave>c.wave+1 or coalesce(c.paused_at,clock_timestamp())<c.wave_started_at+interval '40 seconds'or exists(select 1 from app_private.six_class_players where match_id=p_match_id and phase_kind is not null))then return public.get_1v1_state(p_match_id);end if;
 return app_private.update_1v1_state_before_six_class(p_match_id,p_hearts,p_wave,p_score,p_status);
 end owned_update;
end $$;
do $guard$ declare h text;begin select md5(prosrc)into h from pg_proc where oid='app_private.update_1v1_state_unadjusted(uuid,numeric,integer,bigint,text)'::regprocedure;if h not in('ffae87670923d18ff930f480dcb837d8','ab409af3987dd6a2f550db78a3c41e27')then raise exception 'Source drift: app_private.update_1v1_state_unadjusted(uuid,numeric,integer,bigint,text)';end if;end $guard$;
CREATE OR REPLACE FUNCTION app_private.update_1v1_state_unadjusted(p_match_id uuid, p_hearts numeric, p_wave integer, p_score bigint, p_status text DEFAULT 'playing'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid uuid := auth.uid();
  v_match public.multiplayer_matches;
  v_self public.multiplayer_players;
  v_completed_wave integer;
  v_wave_reward numeric := 0;
  v_standard_wave_reward numeric := 0;
  v_ready_players integer := 0;
  v_active_players integer := 0;
  v_ready_min_wave integer;
  v_ready_max_wave integer;
  v_verified_wave integer := 1;
  v_finalized boolean := false;
  v_now timestamptz := clock_timestamp();
begin
  if v_uid is null then raise exception 'Sign in required'; end if;
  if p_wave is null or p_wave < 1 or p_score is null or p_score < 0 then
    raise exception 'Invalid 1v1 state';
  end if;
  if p_status not in ('playing', 'intermission', 'eliminated') then
    raise exception 'Invalid player status';
  end if;

  select * into v_match from public.multiplayer_matches
  where id = p_match_id for update;
  select * into v_self from public.multiplayer_players
  where match_id = p_match_id and user_id = v_uid for update;
  if v_match.id is null or v_self.user_id is null then
    raise exception '1v1 match not found';
  end if;
  if v_match.status not in ('countdown', 'playing', 'intermission') then
    return public.get_1v1_state(p_match_id);
  end if;
  if v_self.status in ('eliminated', 'left', 'finished') then
    return public.get_1v1_state(p_match_id);
  end if;
  if p_hearts is null or p_hearts < 0 or p_hearts > v_self.max_hearts then
    raise exception 'Hearts must be between 0 and %', v_self.max_hearts;
  end if;
  if v_match.map_key = 'desert' and p_hearts > v_self.hearts then
    raise exception 'Healing is disabled on Desert';
  end if;
  if p_wave > v_self.wave + 1 then
    raise exception 'Wave can only advance one at a time';
  end if;
  select coalesce(max(activity.verified_wave), 1)
  into v_verified_wave
  from public.player_progression_1v1_activity activity
  where activity.match_id = p_match_id and activity.user_id = v_uid;
  if p_wave > v_verified_wave + 1 then
    raise exception 'Wave is ahead of verified active play';
  end if;
  if p_wave = v_self.wave and p_hearts > v_self.hearts
     and v_self.character_class <> 'medic'
     and not exists(select 1 from app_private.six_class_players s join app_private.six_class_catalog c on c.item_key=s.current_key where s.match_id=p_match_id and s.user_id=v_uid and(exists(select 1 from app_private.six_class_events e where e.match_id=s.match_id and e.target_user_id=s.user_id and e.action='echo-health'and e.expires_at>clock_timestamp())or c.character_class='medic'or s.behavior_key='misc_muse'or c.item_key in('trickster_gambit','runner_relay','medic_lifeline','trickster_phantom','trickster_paradox','trickster_hex','trickster_echo','chaotic_conic','chaotic_prism','tank_knight','misc_muse','tank_general','medic_seraph','chaotic_cloak'))) then
    raise exception 'Mid-wave healing is not available to this character';
  end if;

  -- Narrow score heartbeats may arrive before an older full-state packet.
  if p_wave < v_self.wave then
    update public.multiplayer_players
    set score = greatest(score, p_score),
        last_seen_at = v_now, updated_at = v_now
    where match_id = p_match_id and user_id = v_uid;
    update public.multiplayer_matches set last_activity_at = v_now
    where id = p_match_id;
    return public.get_1v1_state(p_match_id);
  end if;

  -- A duplicate completion cannot reopen an intermission after that wave began.
  if p_status = 'intermission' and p_wave <= v_match.current_wave then
    update public.multiplayer_players
    set score = greatest(score, p_score),
        last_seen_at = v_now, updated_at = v_now
    where match_id = p_match_id and user_id = v_uid;
    return public.get_1v1_state(p_match_id);
  end if;

  -- Do not let a late playing heartbeat cancel either a global countdown or a
  -- player's local ready state while another living player reaches the barrier.
  if p_status = 'playing' and (
       (v_match.status = 'intermission' and v_match.intermission_ends_at > v_now)
       or (v_match.status = 'playing' and v_self.status = 'intermission')
     ) then
    update public.multiplayer_players
    set score = greatest(score, p_score),
        last_seen_at = v_now, updated_at = v_now
    where match_id = p_match_id and user_id = v_uid;
    return public.get_1v1_state(p_match_id);
  end if;

  v_completed_wave := greatest(0, p_wave - 1);
  if v_match.map_key <> 'grove'
     and v_completed_wave > v_self.last_rewarded_wave then
    select rules.wave_point_reward into v_standard_wave_reward
    from app_private.one_v_one_map_rules rules
    where rules.map_key = v_match.map_key;
    v_wave_reward :=
      (v_completed_wave - v_self.last_rewarded_wave) * v_standard_wave_reward;
  end if;

  update public.multiplayer_players
  set hearts = p_hearts,
      wave = greatest(wave, p_wave),
      score = greatest(score, p_score),
      obstacle_points = obstacle_points + v_wave_reward,
      last_rewarded_wave = case
        when v_match.map_key = 'grove' then last_rewarded_wave
        else greatest(last_rewarded_wave, v_completed_wave)
      end,
      status = case
        when p_hearts = 0 or p_status = 'eliminated' then 'eliminated'
        else p_status
      end,
      last_seen_at = v_now,
      updated_at = v_now
  where match_id = p_match_id and user_id = v_uid;

  -- Incoming attacks are delivered only when the client acknowledges their
  -- exact ids. Never bulk-expire a slow trickle at the wave boundary; queued
  -- attacks remain durable through a reconnect or the following wave.

  if p_hearts = 0 or p_status = 'eliminated' then
    perform app_private.mark_1v1_eliminated(p_match_id, v_uid, v_now);
    v_finalized := app_private.finalize_1v1_after_second_death(
      p_match_id, v_now
    );
    if not v_finalized then
      -- If the survivor already reached the wave barrier, begin their solo
      -- intermission now instead of leaving them permanently waiting.
      select
        count(*) filter (
          where status not in ('eliminated', 'left', 'finished')
        ),
        count(*) filter (where status = 'intermission'),
        min(wave) filter (
          where status not in ('eliminated', 'left', 'finished')
        ),
        max(wave) filter (
          where status not in ('eliminated', 'left', 'finished')
        )
      into v_active_players, v_ready_players,
           v_ready_min_wave, v_ready_max_wave
      from public.multiplayer_players
      where match_id = p_match_id;
      if v_active_players > 0
         and v_ready_players = v_active_players
         and v_ready_min_wave = v_ready_max_wave then
        if v_match.map_key = 'grove' then
          v_finalized := app_private.settle_grove_wave(
            p_match_id, greatest(1, v_ready_max_wave - 1), v_now
          );
        end if;
        if not v_finalized then
          update public.multiplayer_matches
          set status = 'intermission',
              current_wave = v_ready_max_wave,
              winner_user_id = null,
              intermission_ends_at = v_now + interval '10 seconds',
              last_activity_at = v_now
          where id = p_match_id;
        end if;
      else
        update public.multiplayer_matches
        set status = 'playing',
            winner_user_id = null,
            intermission_ends_at = null,
            last_activity_at = v_now
        where id = p_match_id;
      end if;
    end if;
    return public.get_1v1_state(p_match_id);
  end if;

  if p_status = 'intermission' then
    select
      count(*) filter (
        where status not in ('eliminated', 'left', 'finished')
      ),
      count(*) filter (where status = 'intermission'),
      min(wave) filter (
        where status not in ('eliminated', 'left', 'finished')
      ),
      max(wave) filter (
        where status not in ('eliminated', 'left', 'finished')
      )
    into v_active_players, v_ready_players,
         v_ready_min_wave, v_ready_max_wave
    from public.multiplayer_players
    where match_id = p_match_id;

    if v_active_players > 0
       and v_ready_players = v_active_players
       and v_ready_min_wave = v_ready_max_wave then
      if v_match.map_key = 'grove' then
        v_finalized := app_private.settle_grove_wave(
          p_match_id, greatest(1, v_ready_max_wave - 1), v_now
        );
      end if;
      if not v_finalized then
        update public.multiplayer_matches
        set status = 'intermission',
            current_wave = v_ready_max_wave,
            intermission_ends_at = case
              when status = 'intermission' and intermission_ends_at > v_now
                then intermission_ends_at
              else v_now + interval '10 seconds'
            end,
            last_activity_at = v_now
        where id = p_match_id;
      end if;
    else
      update public.multiplayer_matches set last_activity_at = v_now
      where id = p_match_id;
    end if;
  elsif p_status = 'playing' then
    if v_match.status = 'intermission' then
      update public.multiplayer_players
      set status = 'playing', updated_at = v_now
      where match_id = p_match_id and status = 'intermission';
      update public.multiplayer_matches
      set status = 'playing', intermission_ends_at = null,
          last_activity_at = v_now
      where id = p_match_id;
    elsif v_match.status = 'countdown' then
      update public.multiplayer_matches
      set status = 'playing', last_activity_at = v_now
      where id = p_match_id;
    else
      update public.multiplayer_matches set last_activity_at = v_now
      where id = p_match_id;
    end if;
  end if;

  return public.get_1v1_state(p_match_id);
end;
$function$
;
-- NEW_FUNCTION_SOURCE_GUARD
do $guard$ begin if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app_private'and p.proname='six_class_shared_start'and md5(p.prosrc)<>'5a8def41692963bfe4d15ca2362cd2e8')then raise exception 'Unexpected existing function: app_private.six_class_shared_start';end if;end $guard$;
-- END_NEW_FUNCTION_SOURCE_GUARD
create or replace function app_private.six_class_shared_start()returns trigger language plpgsql security definer set search_path=''as $$
declare start_at timestamptz;begin
 if new.status='playing'and old.status is distinct from 'playing'then
  start_at:=case when old.status='intermission'then coalesce(old.intermission_ends_at,clock_timestamp())else coalesce(new.started_at,clock_timestamp())end;
  update app_private.six_class_clocks set wave=new.current_wave,wave_started_at=start_at,paused_at=null where match_id=new.id;
  update public.multiplayer_players set wave_started_at=start_at where match_id=new.id and status not in('eliminated','left','finished');
 end if;return new;
end $$;
drop trigger if exists six_class_shared_start on public.multiplayer_matches;
create trigger six_class_shared_start after update of status on public.multiplayer_matches for each row execute function app_private.six_class_shared_start();
revoke all on function app_private.six_class_shared_start()from public,anon,anonymous,authenticated;
-- NEW_FUNCTION_SOURCE_GUARD
do $guard$ begin if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app_private'and p.proname='six_class_point_earnings'and md5(p.prosrc)<>'0fa590bcf8860324548d79ebee17864f')then raise exception 'Unexpected existing function: app_private.six_class_point_earnings';end if;end $guard$;
-- END_NEW_FUNCTION_SOURCE_GUARD
create or replace function app_private.six_class_point_earnings()returns trigger language plpgsql security definer set search_path=''as $$
declare gained numeric;begin
 if new.obstacle_points>old.obstacle_points and coalesce(current_setting('app.six_class_internal_award',true),'')<>'on'then
  gained:=new.obstacle_points-old.obstacle_points;
  update app_private.six_class_players set wave_earnings=jsonb_set(wave_earnings,array[new.wave::text],to_jsonb(coalesce((wave_earnings->>new.wave::text)::numeric,0)+gained))where match_id=new.match_id and user_id=new.user_id;
 end if;return new;
end $$;
drop trigger if exists six_class_point_earnings on public.multiplayer_players;
create trigger six_class_point_earnings after update of obstacle_points on public.multiplayer_players for each row execute function app_private.six_class_point_earnings();
revoke all on function app_private.six_class_point_earnings()from public,anon,anonymous,authenticated;

create table if not exists app_private.six_class_coin_transfers(
 match_id uuid not null,user_id uuid not null,pickup_id text not null,beneficiary uuid not null,amount numeric not null check(amount>=0),settled boolean not null default false,
 primary key(match_id,user_id,pickup_id),foreign key(match_id,user_id)references public.multiplayer_players(match_id,user_id)on delete cascade);
alter table app_private.six_class_coin_transfers enable row level security;
revoke all on app_private.six_class_coin_transfers from public,anon,anonymous,authenticated;
-- NEW_FUNCTION_SOURCE_GUARD
do $guard$ begin if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app_private'and p.proname='six_class_coin_prepare'and md5(p.prosrc)<>'27e8c6e6accdcc1a1c2ac511bf47bb4a')then raise exception 'Unexpected existing function: app_private.six_class_coin_prepare';end if;end $guard$;
-- END_NEW_FUNCTION_SOURCE_GUARD
create or replace function app_private.six_class_coin_prepare()returns trigger language plpgsql security definer set search_path=''as $$
declare own_key text;other_id uuid;other_key text;transfer app_private.six_class_coin_transfers;begin
 if new.source<>'coin'or exists(select 1 from public.multiplayer_point_events e where e.match_id=new.match_id and e.user_id=new.user_id and e.pickup_id=new.pickup_id)then return new;end if;
 select coalesce(s.current_key,p.character_key)into own_key from public.multiplayer_players p left join app_private.six_class_players s on s.match_id=p.match_id and s.user_id=p.user_id where p.match_id=new.match_id and p.user_id=new.user_id;
 if own_key='misc_challenger'then new.points_awarded:=new.points_awarded*2;end if;
 select p.user_id,coalesce(s.current_key,p.character_key)into other_id,other_key from public.multiplayer_players p left join app_private.six_class_players s on s.match_id=p.match_id and s.user_id=p.user_id where p.match_id=new.match_id and p.user_id<>new.user_id and p.status not in('left','eliminated','finished')limit 1;
 if other_key<>'chaotic_spring'or other_id is null then return new;end if;
 select *into transfer from app_private.six_class_coin_transfers where match_id=new.match_id and user_id=new.user_id and pickup_id=new.pickup_id;
 if transfer.match_id is null and random()<.15 then
  insert into app_private.six_class_coin_transfers(match_id,user_id,pickup_id,beneficiary,amount)values(new.match_id,new.user_id,new.pickup_id,other_id,new.points_awarded)on conflict do nothing;
  select *into transfer from app_private.six_class_coin_transfers where match_id=new.match_id and user_id=new.user_id and pickup_id=new.pickup_id;
 end if;
 if transfer.match_id is not null then new.points_awarded:=0;end if;
 return new;
end $$;
-- NEW_FUNCTION_SOURCE_GUARD
do $guard$ begin if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app_private'and p.proname='six_class_coin_settle'and md5(p.prosrc)<>'f85a1135af63979deef25d1eb255249e')then raise exception 'Unexpected existing function: app_private.six_class_coin_settle';end if;end $guard$;
-- END_NEW_FUNCTION_SOURCE_GUARD
create or replace function app_private.six_class_coin_settle()returns trigger language plpgsql security definer set search_path=''as $$
declare transfer app_private.six_class_coin_transfers;begin
 update app_private.six_class_coin_transfers set settled=true where match_id=new.match_id and user_id=new.user_id and pickup_id=new.pickup_id and not settled returning *into transfer;
 if transfer.match_id is not null then
  update public.multiplayer_players set obstacle_points=least(1000000000,obstacle_points+transfer.amount)where match_id=new.match_id and user_id=transfer.beneficiary;
  perform app_private.six_class_delivery(new.match_id,transfer.beneficiary,new.user_id,'stun','{}',0,.7);
 end if;return new;
end $$;
drop trigger if exists zz_six_class_coin_prepare on public.multiplayer_point_events;
create trigger zz_six_class_coin_prepare before insert on public.multiplayer_point_events for each row execute function app_private.six_class_coin_prepare();
drop trigger if exists six_class_coin_settle on public.multiplayer_point_events;
create trigger six_class_coin_settle after insert on public.multiplayer_point_events for each row execute function app_private.six_class_coin_settle();
revoke all on function app_private.six_class_coin_prepare(),app_private.six_class_coin_settle()from public,anon,anonymous,authenticated;

notify pgrst,'reload schema';
commit;
