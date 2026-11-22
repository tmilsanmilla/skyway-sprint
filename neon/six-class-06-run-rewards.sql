-- Receipt-bound run traits and rewards. Existing balances, reset fences,
-- original progression receipts and existing native/account identities remain.
begin;
set local lock_timeout='3s';
create table if not exists app_private.six_class_runs(
 run_id uuid primary key references public.player_progression_runs(run_id)on delete cascade,user_id uuid not null,
 original_key text not null,current_key text not null,behavior_key text not null,muse_stage integer not null default 0,muse_classes text[]not null default '{}',checkpoint jsonb not null default '{}',
 settled_at timestamptz,settlement jsonb,last_nonce uuid,updated_at timestamptz not null default clock_timestamp());
alter table app_private.six_class_runs enable row level security;
revoke all on app_private.six_class_runs from public,anon,anonymous,authenticated;
comment on table app_private.six_class_runs is 'skyway-six-class-run-rewards-v1';

-- NEW_FUNCTION_SOURCE_GUARD
do $guard$ begin if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app_private'and p.proname='six_class_start_run'and md5(p.prosrc)<>'ab09df306a0f8d2bea797971f0110db3')then raise exception 'Unexpected existing function: app_private.six_class_start_run';end if;end $guard$;
-- END_NEW_FUNCTION_SOURCE_GUARD
create or replace function app_private.six_class_start_run()returns trigger language plpgsql security definer set search_path=''as $$
declare k text;begin
 select c.item_key into k from public.player_loadouts l join app_private.six_class_catalog c on c.item_key=l.character_key where l.user_id=new.user_id;
 k:=coalesce(k,'runner_ace');
 insert into app_private.six_class_runs(run_id,user_id,original_key,current_key,behavior_key)values(new.run_id,new.user_id,k,k,k)on conflict do nothing;
 return new;
end $$;
drop trigger if exists six_class_start_run on public.player_progression_runs;
create trigger six_class_start_run after insert on public.player_progression_runs for each row execute function app_private.six_class_start_run();
revoke all on function app_private.six_class_start_run()from public,anon,anonymous,authenticated;

-- NEW_FUNCTION_SOURCE_GUARD
do $guard$ begin if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'and p.proname='record_six_class_run_v1'and md5(p.prosrc)<>'8cec7540abd0b74faf3de00688b7402e')then raise exception 'Unexpected existing function: public.record_six_class_run_v1';end if;end $guard$;
-- END_NEW_FUNCTION_SOURCE_GUARD
create or replace function public.record_six_class_run_v1(p_run_id uuid,p_nonce uuid,p_checkpoint jsonb)returns jsonb language plpgsql security definer set search_path=''as $$
begin perform app_private.require_pixel_runtime();
 <<owned_run>>declare u uuid:=app_private.photon_user();r public.player_progression_runs;s app_private.six_class_runs;c app_private.six_class_catalog;
 elapsed numeric;k text;counter jsonb;key text;value numeric;prior numeric;cap numeric;begin
 if p_nonce is null or jsonb_typeof(p_checkpoint)is distinct from 'object'or pg_column_size(p_checkpoint)>32000 then raise exception 'Invalid run checkpoint';end if;
 select *into r from public.player_progression_runs where run_id=p_run_id and user_id=u for update;
 select *into s from app_private.six_class_runs where run_id=p_run_id and user_id=u for update;
 if r.run_id is null or s.run_id is null or r.completed_at is not null or s.settled_at is not null or r.started_at<clock_timestamp()-interval '6 hours'then raise exception 'Original active run required';end if;
 if s.last_nonce=p_nonce then return jsonb_build_object('saved',true,'nonce',p_nonce);end if;
 if p_checkpoint->>'originalKey'is distinct from s.original_key then raise exception 'Original run character differs';end if;
 elapsed:=(p_checkpoint->>'elapsed')::numeric;
 if elapsed is null or elapsed<0 or elapsed='NaN'::numeric or elapsed>21600 or elapsed>r.active_seconds+8 or elapsed>extract(epoch from(clock_timestamp()-r.started_at))+2 then raise exception 'Run checkpoint exceeded verified play';end if;
 if elapsed<coalesce((s.checkpoint->>'elapsed')::numeric,0)then raise exception 'Stale run checkpoint';end if;
 k:=p_checkpoint->>'key';select *into c from app_private.six_class_catalog where item_key=k;
 if c.item_key is null then raise exception 'Invalid run form';end if;
 if k<>s.current_key and k<>s.original_key then
  if s.behavior_key='misc_muse'then
   if s.muse_stage>=5 or c.character_class='chaotic'or c.character_class=any(s.muse_classes)or c.rarity<>(array['legendary','epic','rare','uncommon','common'])[s.muse_stage+1]then raise exception 'Original next Muse rarity and class required';end if;
   update app_private.six_class_runs set muse_stage=muse_stage+1,muse_classes=array_append(muse_classes,c.character_class)where run_id=p_run_id and user_id=u;
  elsif s.original_key='runner_pacer'then
   if elapsed<10 or c.character_class in('runner','medic')or c.rarity='mythic'then raise exception 'Invalid baton form';end if;
  elsif s.original_key='misc_muse'then
   if c.character_class='chaotic'then raise exception 'Muse cannot use Chaotic';end if;
  elsif s.original_key='chaotic_snake'then
   if s.checkpoint<>'{}'or k='chaotic_snake'then raise exception 'Original Snake choice required';end if;
  elsif s.original_key='misc_challenger'then
   if k<>'runner_sprint'or not app_private.owns_six_class_character(u,k)then raise exception 'Owned Sprint required';end if;
  elsif s.original_key='misc_weaver'then
   if k<>'runner_courier'or not app_private.owns_six_class_character(u,k)then raise exception 'Owned Courier required';end if;
  else raise exception 'This run cannot transform';end if;
 end if;
 counter:=p_checkpoint->'counters';if jsonb_typeof(counter)is distinct from 'object'then raise exception 'Run counters required';end if;
 for key in select unnest(array['moves','hits','melons','totalAshes','dispersals','prophecies','potatoWaves','flawlessTotal','flawlessAfterRevive','chipEver','queens','tens'])loop
  value:=coalesce((counter->>key)::numeric,0);prior:=coalesce((s.checkpoint->'counters'->>key)::numeric,0);
  cap:=case key when 'moves'then 2+elapsed*10 when 'hits'then 3+elapsed*4 when 'melons'then 2+elapsed/.5 when 'totalAshes'then 2+elapsed/.5 when 'dispersals'then floor((2+elapsed/.5)/20) when 'chipEver'then 1 when 'queens'then 4 when 'tens'then 4 else r.verified_wave end;
  if value<0 or value='NaN'::numeric or value<>floor(value)or value>cap or value<prior then raise exception 'Invalid bounded run counter: %',key;end if;
 end loop;
 if s.checkpoint='{}'and s.original_key='chaotic_snake'then update app_private.six_class_runs set behavior_key=k where run_id=p_run_id and user_id=u;end if;
 update app_private.six_class_runs set current_key=k,checkpoint=p_checkpoint||jsonb_build_object('behaviorRootKey',behavior_key),last_nonce=p_nonce,updated_at=clock_timestamp()where run_id=p_run_id and user_id=u;
 return jsonb_build_object('saved',true,'nonce',p_nonce);
 end owned_run;
end $$;

-- NEW_FUNCTION_SOURCE_GUARD
do $guard$ begin if exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'and p.proname='finish_six_class_run_v1'and md5(p.prosrc)<>'89f2f0de622f47541a665bf1e8c37d02')then raise exception 'Unexpected existing function: public.finish_six_class_run_v1';end if;end $guard$;
-- END_NEW_FUNCTION_SOURCE_GUARD
create or replace function public.finish_six_class_run_v1(p_run_id uuid)returns jsonb language plpgsql security definer set search_path=''as $$
begin perform app_private.require_pixel_runtime();
 <<owned_finish>>declare u uuid:=app_private.photon_user();r public.player_progression_runs;s app_private.six_class_runs;e public.player_progression_events;
 c jsonb;seconds bigint;physical bigint;base_xp bigint;score_xp bigint;gem_xp bigint;bonus_xp bigint:=0;gems bigint:=0;dust bigint:=0;
 multiplier numeric:=1;k text;result jsonb;begin
 perform pg_advisory_xact_lock(hashtextextended(u::text,0));
 select *into r from public.player_progression_runs where run_id=p_run_id and user_id=u for update;
 select *into s from app_private.six_class_runs where run_id=p_run_id and user_id=u for update;
 if r.run_id is null then raise exception 'Original owned run required';end if;
 if s.run_id is null then return public.get_player_progression();end if;
 if s.settled_at is not null then return public.get_player_progression()||s.settlement;end if;
 if r.completed_at is null then raise exception 'Finish the original progression receipt first';end if;
 select *into e from public.player_progression_events where user_id=u and source='run'and source_key=p_run_id::text;
 if e.id is null and not r.test_mode then raise exception 'Original run award receipt required';end if;
 c:=coalesce(s.checkpoint->'counters','{}');k:=s.current_key;
 seconds:=floor(least(r.active_seconds,greatest(0,coalesce((s.checkpoint->>'elapsed')::numeric,0))))::bigint;
 select count(*)into physical from public.player_progression_events where user_id=u and source='gem'and metadata->>'context_id'=p_run_id::text;
 base_xp:=coalesce(e.xp_awarded,0);score_xp:=coalesce((e.metadata->'xp_breakdown'->>'score')::bigint,0);gem_xp:=physical*10;
 if k='runner_outpost'then multiplier:=1.25;end if;
 if k='chaotic_particle'then multiplier:=2;end if;
 if k='misc_timekeeper'then multiplier:=1+coalesce((c->>'hits')::numeric,0)/100;end if;
 if k='medic_oracle'then multiplier:=1+coalesce((c->>'prophecies')::numeric,0)/100;end if;
 if k='chaotic_conic'then multiplier:=1+coalesce((c->>'potatoWaves')::numeric,0)*.09;dust:=case when coalesce((c->>'chipEver')::integer,0)>0 then floor(seconds/4.)else 0 end;end if;
 if k='misc_mimic'and c->>'mimicChoice'='2'then multiplier:=1.35;end if;
 if k='trickster_wildcard'then gem_xp:=physical*(case coalesce((c->>'queens')::integer,0)when 1 then 20 when 2 then 35 when 3 then 60 when 4 then 100 else 10 end);end if;
 if k='chaotic_glide'then gems:=floor(seconds/70.);end if;
 if k='runner_relay'and coalesce((c->>'revived')::integer,0)>0 then gems:=greatest(0,coalesce((c->>'flawlessAfterRevive')::bigint,0));end if;
 if k='misc_um'then gems:=least(coalesce((c->>'dispersals')::bigint,0),floor(coalesce((c->>'totalAshes')::numeric,0)/20));end if;
 bonus_xp:=greatest(0,floor((score_xp+gem_xp)*multiplier)::bigint-base_xp);
 if k='trickster_switch'and coalesce((c->>'moves')::bigint,0)>57 then bonus_xp:=bonus_xp+floor(((c->>'moves')::numeric-55)/3);end if;
 if r.test_mode or base_xp=0 then bonus_xp:=0;end if;
 if r.test_mode then gems:=0;dust:=0;end if;
 -- The bonus has a distinct durable source key. Repeating the result cannot
 -- credit XP, gems or stardust twice, even after a lost response.
 insert into public.player_progression_events(user_id,source,source_key,xp_awarded,metadata)
 values(u,'run','six-class:'||p_run_id::text,bonus_xp,jsonb_build_object('context_id',p_run_id,'character',k,'gems',gems,'stardust',dust))on conflict(user_id,source,source_key)do nothing;
 if not found then raise exception 'Run bonus receipt exists without a settlement';end if;
 if bonus_xp>0 then perform app_private.apply_player_xp(u,bonus_xp,false);end if;
 if gems>0 or dust>0 then update public.player_stats set total_gems=total_gems+gems,stardust=stardust+dust,updated_at=clock_timestamp()where user_id=u;end if;
 result:=jsonb_build_object('xp_awarded',base_xp+bonus_xp,'xp_breakdown',coalesce(e.metadata->'xp_breakdown','{}')||jsonb_build_object('character_bonus',bonus_xp,'total',base_xp+bonus_xp),'character_bonus_gems',gems,'character_bonus_stardust',dust);
 update app_private.six_class_runs set settled_at=clock_timestamp(),settlement=result where run_id=p_run_id;
 return public.get_player_progression()||result;
 end owned_finish;
end $$;
revoke all on function public.record_six_class_run_v1(uuid,uuid,jsonb),public.finish_six_class_run_v1(uuid)from public,anon,anonymous;
grant execute on function public.record_six_class_run_v1(uuid,uuid,jsonb),public.finish_six_class_run_v1(uuid)to authenticated;
-- SIX_CLASS_GEM_WRAPPER
do $guard$ declare h text;begin select md5(prosrc)into h from pg_proc where oid='public.claim_player_gem(uuid,text)'::regprocedure;if h not in('6c2dad36bfb416b424b96a584401f395','32fcffedc12c82f6d16605baa3e9c7ef')then raise exception 'Source drift: ordinary Gem receipt';end if;end $guard$;
do $clone$ begin if to_regprocedure('app_private.claim_player_gem_before_six_class(uuid,text)')is null then execute 'CREATE OR REPLACE FUNCTION app_private.claim_player_gem_before_six_class(p_context_id uuid, p_pickup_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''''
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
 if (r->>''is_new'')::boolean is not true or (r->>''test_mode'')::boolean is true then return r;end if;
 select * into s from app_private.mastery_sessions where user_id=u and context_id=p_context_id
  and context_type in(''endless'',''1v1'') and finished_at is null order by started_at desc limit 1 for update;
 -- Six-class update: reject legacy cross-character snapshots and disabled mastery effects.
 if s.id is null or s.character_key<>''medic_bloom'' or s.flair_character is distinct from s.character_key or s.gem_multiplier<>1.35
  or not exists(select 1 from app_private.player_mastery_quests where user_id=u and character_key=s.character_key and mastered and mastery_enabled)
  or not app_private.mastery_owns_character(u,s.character_key) then return r;end if;
 awarded:=coalesce((r->>''gems_awarded'')::bigint,0);
 if awarded<0 or awarded>1000000000 then raise exception ''Unexpected verified gem reward'';end if;
 carry:=s.gem_fraction+awarded*(s.gem_multiplier-1);extra:=floor(carry)::bigint;
 update app_private.mastery_sessions set gem_fraction=carry-extra where id=s.id;
 if extra>0 then
  update public.player_stats set total_gems=total_gems+extra,updated_at=clock_timestamp() where user_id=u returning total_gems into total;
 else select total_gems into total from public.player_stats where user_id=u;end if;
 -- The same atomic physical-pickup receipt carries its final whole reward.
 -- A lost-response retry is handled by the original idempotent implementation.
 update public.player_progression_events set metadata=metadata||jsonb_build_object(''gems_awarded'',awarded+extra,''flair_extra_gems'',extra,''flair_multiplier'',s.gem_multiplier)
 where user_id=u and source=''gem'' and source_key=p_context_id::text||'':''||trim(p_pickup_id);
 return r||jsonb_build_object(''total_gems'',total,''gems_awarded'',awarded+extra);
end;
end
$function$
';end if;if(select md5(prosrc)from pg_proc where oid='app_private.claim_player_gem_before_six_class(uuid,text)'::regprocedure)<>'6c2dad36bfb416b424b96a584401f395'then raise exception 'Original Gem counterpart drift';end if;end $clone$;
revoke all on function app_private.claim_player_gem_before_six_class(uuid,text)from public,anon,anonymous,authenticated;
create or replace function public.claim_player_gem(p_context_id uuid,p_pickup_id text)returns jsonb language plpgsql security definer set search_path=''as $$
begin perform app_private.require_pixel_runtime();
 <<original_pickup>>declare u uuid:=app_private.photon_user();r jsonb;ctx app_private.six_class_runs;k text;c jsonb;wave integer;streak bigint;awarded bigint;extra bigint:=0;dust bigint:=0;total bigint;begin
 r:=app_private.claim_player_gem_before_six_class(p_context_id,p_pickup_id);
 if(r->>'is_new')::boolean is not true or(r->>'test_mode')::boolean is true then return r;end if;
 select *into ctx from app_private.six_class_runs where run_id=p_context_id and user_id=u;
 if ctx.run_id is not null then
  k:=ctx.current_key;c:=coalesce(ctx.checkpoint->'counters','{}');
  select verified_wave into wave from public.player_progression_runs where run_id=p_context_id and user_id=u;
 else
  select current_key,checkpoint->'counters'into k,c from app_private.six_class_players where match_id=p_context_id and user_id=u;
  select p.wave into wave from public.multiplayer_players p where match_id=p_context_id and user_id=u;
 end if;
 if k is null then return r;end if;
 awarded:=coalesce((r->>'gems_awarded')::bigint,0);streak:=coalesce((r->>'streak')::bigint,1);
 if awarded<0 or awarded>1000000 or streak<1 or streak>1000000 then raise exception 'Verified pickup result outside expected bounds';end if;
 if ctx.run_id is not null and k in('misc_prospector','trickster_burglar')then extra:=greatest(0,2*streak-1-awarded);end if;
 if k='misc_engineer'then dust:=greatest(1,coalesce(wave,1))*(awarded+extra);end if;
 if k='trickster_wildcard'then dust:=least(4,greatest(0,coalesce((c->>'tens')::integer,0)))*10;end if;
 if extra>0 or dust>0 then
  update public.player_stats set total_gems=total_gems+extra,stardust=stardust+dust,updated_at=clock_timestamp()where user_id=u returning total_gems into total;
  update public.player_progression_events set metadata=metadata||jsonb_build_object('gems_awarded',awarded+extra,'six_class_extra_gems',extra,'six_class_stardust',dust)
  where user_id=u and source='gem'and source_key=p_context_id::text||':'||trim(p_pickup_id);
 else select total_gems into total from public.player_stats where user_id=u;end if;
 return r||jsonb_build_object('total_gems',total,'gems_awarded',awarded+extra,'character_stardust_awarded',dust,'progression',public.get_player_progression());
 end original_pickup;
end $$;
revoke all on function public.claim_player_gem(uuid,text)from public,anon,anonymous;
grant execute on function public.claim_player_gem(uuid,text)to authenticated;
notify pgrst,'reload schema';
commit;
