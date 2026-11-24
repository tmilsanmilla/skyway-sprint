-- One original server receipt, followed by one atomic solo result after play.
-- Currency, XP, character and quest events are never credited from local cache.
begin;
set local lock_timeout='3s';
create table if not exists app_private.solo_run_receipts(
 run_id uuid primary key references public.player_progression_runs(run_id)on delete cascade,
 user_id uuid not null,start_nonce uuid not null,created_at timestamptz not null default clock_timestamp(),
 payload_hash text,settlement jsonb,settled_at timestamptz,unique(user_id,start_nonce)
);
revoke all on app_private.solo_run_receipts from public,anon,anonymous,authenticated;
do $new_source$ begin if to_regprocedure('public.start_solo_run_v1(uuid)')is not null and(select md5(prosrc)from pg_proc where oid=to_regprocedure('public.start_solo_run_v1(uuid)'))<>'275b071ac608ae152b6efa590e34c6e0'then raise exception 'Unexpected existing solo function';end if;end $new_source$;
create or replace function public.start_solo_run_v1(p_nonce uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare u uuid;id uuid;
begin
 perform app_private.require_pixel_runtime();u:=app_private.photon_user();
 if p_nonce is null then raise exception 'Original run request required';end if;
 perform pg_advisory_xact_lock(hashtextextended(u::text,0));
 select run_id into id from app_private.solo_run_receipts where user_id=u and start_nonce=p_nonce;
 if id is not null then return id;end if;
 id:=public.start_progression_run();
 insert into app_private.solo_run_receipts(run_id,user_id,start_nonce)values(id,u,p_nonce);
 return id;
end $$;
do $new_source$ begin if to_regprocedure('public.settle_solo_run_v1(uuid,jsonb)')is not null and(select md5(prosrc)from pg_proc where oid=to_regprocedure('public.settle_solo_run_v1(uuid,jsonb)'))<>'d1cd5260b80a3b965f5261af155ee17d'then raise exception 'Unexpected existing solo function';end if;end $new_source$;
create or replace function public.settle_solo_run_v1(p_run_id uuid,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid;r public.player_progression_runs;receipt app_private.solo_run_receipts;actor_test boolean;
 elapsed numeric;score bigint;wave integer;character text;mode text;trial text;session_id uuid;
 events jsonb;actions jsonb;checkpoints jsonb;entry jsonb;part jsonb;cp jsonb;at_time numeric;prior_at numeric:=0;
 count_gems integer:=0;recent_gems jsonb:='[]';gem_result jsonb;begin_result jsonb;result jsonb;extra jsonb;
 i integer;n integer;balance bigint;dust bigint;digest text;final_profile jsonb;
begin
 perform app_private.require_pixel_runtime();u:=app_private.photon_user();
 if p_run_id is null or jsonb_typeof(p_payload)is distinct from 'object'or pg_column_size(p_payload)>8388608 then raise exception 'Invalid solo result';end if;
 digest:=md5(p_payload::text);
 perform pg_advisory_xact_lock(hashtextextended(u::text,0));
 select *into receipt from app_private.solo_run_receipts where run_id=p_run_id and user_id=u for update;
 if receipt.run_id is null then raise exception 'Original owned solo receipt required';end if;
 if receipt.settled_at is not null then
  if receipt.payload_hash is distinct from digest then raise exception 'Completed run receipt cannot change';end if;
  return receipt.settlement||jsonb_build_object('already_completed',true);
 end if;
 select *into r from public.player_progression_runs where run_id=p_run_id and user_id=u for update;
 if r.run_id is null or r.started_at<clock_timestamp()-interval '6 hours' then raise exception 'Original solo receipt expired';end if;
 if exists(select 1 from public.player_progression_events where user_id=u and source='run'and source_key=p_run_id::text)then raise exception 'This run already has a different result';end if;
 elapsed:=(p_payload->>'elapsed')::numeric;score:=(p_payload->>'score')::bigint;wave:=(p_payload->>'wave')::integer;
 character:=p_payload->>'character';mode:=p_payload->>'mode';trial:=nullif(p_payload->>'trial','');
 if elapsed is null or elapsed='NaN'::numeric or elapsed<0 or elapsed>21600 or elapsed>extract(epoch from(clock_timestamp()-r.started_at))+1
  or score is null or score<0 or score>1000000000 or wave is null or wave<1 or wave>1+floor(elapsed/15)then raise exception 'Solo result exceeds its original time bounds';end if;
 if mode is null or mode not in('normal','hardcore')or character is null or not app_private.owns_six_class_character(u,character)or(mode='hardcore'and character<>'runner_ace')then raise exception 'Owned run character required';end if;
 events:=p_payload->'events';actions:=p_payload->'actions';checkpoints:=p_payload->'checkpoints';
 if jsonb_typeof(events)is distinct from 'array'or jsonb_array_length(events)>120000
  or jsonb_typeof(actions)is distinct from 'array'or jsonb_array_length(actions)>30000
  or jsonb_typeof(checkpoints)is distinct from 'array'or jsonb_array_length(checkpoints)>10000 then raise exception 'Invalid solo receipt entries';end if;
 if trial is not null and(trial<>character or mode<>'normal'or jsonb_array_length(actions)<>0)then raise exception 'Invalid original trial';end if;
 -- A newer run may close an older unsent receipt. Only this still-unsettled,
 -- original owned receipt is reopened inside this all-or-nothing transaction.
 update public.player_progression_runs set completed_at=null,active_seconds=floor(elapsed),verified_wave=wave,last_heartbeat_at=clock_timestamp(),heartbeat_active=true where run_id=p_run_id and user_id=u;
 perform public.bind_six_class_run_v1(p_run_id,mode,character);
 actor_test:=r.test_mode or app_private.is_admin_test_user(u);
 if not actor_test then
  begin_result:=public.begin_mastery_session(p_run_id,'endless',character,trial);
  session_id:=(begin_result->>'session_id')::uuid;
  update app_private.mastery_sessions set started_at=r.started_at where id=session_id and user_id=u;
 end if;
 -- Replay physical pickups in their original active-time order. The existing
 -- pickup and character implementations still own awards and duplicate checks.
 for entry in select value from(
  select jsonb_build_object('kind','checkpoint','at',c.value->'elapsed','checkpoint',c.value)as value,c.ordinality as ordinal from jsonb_array_elements(checkpoints)with ordinality c(value,ordinality)
  union all select a.value,10000+a.ordinality from jsonb_array_elements(actions)with ordinality a(value,ordinality)
 )ordered order by(value->>'at')::numeric,ordinal loop
  at_time:=(entry->>'at')::numeric;
  if at_time is null or at_time='NaN'::numeric or at_time<prior_at or at_time>elapsed then raise exception 'Invalid original pickup time';end if;
  prior_at:=at_time;cp:=entry->'checkpoint';
  update public.player_progression_runs set active_seconds=floor(at_time),verified_wave=least(wave,1+floor(at_time/15)::integer),last_heartbeat_at=clock_timestamp(),heartbeat_active=true where run_id=p_run_id and user_id=u;
  if cp is not null then perform public.record_six_class_run_v1(p_run_id,gen_random_uuid(),cp);end if;
  if entry->>'kind'='gem'and not actor_test then
   count_gems:=count_gems+1;
   if (select count(*)from jsonb_array_elements(recent_gems)t where(t.value#>>'{}')::numeric>at_time-1)>=3 then raise exception 'Physical pickups exceed the original rate';end if;
   recent_gems:=coalesce((select jsonb_agg(t.value)from jsonb_array_elements(recent_gems)t where(t.value#>>'{}')::numeric>at_time-1),'[]')||jsonb_build_array(at_time);
   gem_result:=public.claim_player_gem(p_run_id,entry->>'id');
   if(gem_result->>'is_new')::boolean then
    update public.player_progression_events set created_at=r.started_at+at_time*interval '1 second',metadata=metadata||jsonb_build_object('settled_after_run',true,'original_active_at',at_time)
     where user_id=u and source='gem'and source_key=p_run_id::text||':'||trim(entry->>'id');
   end if;
  elsif entry->>'kind'='reset'then perform public.reset_endless_gem_streak(p_run_id);
  elsif entry->>'kind'is null or entry->>'kind'not in('gem','checkpoint','reset')then raise exception 'Invalid solo action';end if;
 end loop;
 update public.player_progression_runs set active_seconds=floor(elapsed),verified_wave=wave,last_heartbeat_at=clock_timestamp(),heartbeat_active=false where run_id=p_run_id and user_id=u;
 if not actor_test then
  n:=jsonb_array_length(events);i:=0;
  while i<n loop
   select jsonb_agg(e.value order by e.ordinality)into part from jsonb_array_elements(events)with ordinality e(value,ordinality)where e.ordinality>i and e.ordinality<=i+100;
   final_profile:=public.credit_mastery_events(session_id,part);i:=i+100;
  end loop;
 end if;
 if trial is not null then
  if coalesce((p_payload->>'finishTrial')::boolean,false)then final_profile:=public.finish_mastery_trial(session_id);
  else update app_private.mastery_sessions set finished_at=coalesce(finished_at,clock_timestamp())where id=session_id and user_id=u;end if;
  update public.player_progression_runs set completed_at=clock_timestamp(),heartbeat_active=false where run_id=p_run_id and user_id=u;
  result:=jsonb_build_object('xp_awarded',0,'test_mode',true);
 else
  result:=public.award_completed_run_v2(p_run_id,score,'endless');
  extra:=public.finish_six_class_run_v1(p_run_id);result:=result||extra;
 end if;
 select total_gems,stardust into balance,dust from public.player_stats where user_id=u;
 result:=result||jsonb_build_object('mastery',public.get_mastery_profile(),'total_gems',balance,'gems',balance,'stardust',dust,'saved',true);
 update app_private.solo_run_receipts set payload_hash=digest,settlement=result,settled_at=clock_timestamp()where run_id=p_run_id and user_id=u;
 return result;
end $$;
revoke all on function public.start_solo_run_v1(uuid),public.settle_solo_run_v1(uuid,jsonb)from public,anon,anonymous;
grant execute on function public.start_solo_run_v1(uuid),public.settle_solo_run_v1(uuid,jsonb)to authenticated;
notify pgrst,'reload schema';
commit;
