-- Update 2.3 · Guard mode and the two-tier blue-gem chain jump.
-- Apply after economy, gem-streak and masteries. Ordinary existing pickup
-- ownership, heartbeat, rate-limit and receipt checks remain authoritative.
-- Whether a spawned object is blue is still part of the client-simulated game;
-- the server additionally bounds this reward to two blue Gems per own wave.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
alter table app_private.mastery_sessions add column if not exists guard_mode boolean not null default false,
 add column if not exists guard_eligible_wave integer not null default 0,
 add column if not exists guard_blue_wave integer not null default 0,
 add column if not exists guard_blue_gems integer not null default 0 check(guard_blue_gems between 0 and 2);

create or replace function public.set_mastery_guard_mode(p_context_id uuid,p_enabled boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=app_private.photon_user();s app_private.mastery_sessions;w integer;
begin
 if p_context_id is null or p_enabled is null then raise exception 'Choose Guard mode on or off';end if;
 perform pg_advisory_xact_lock(hashtextextended(u::text,23));
 select * into s from app_private.mastery_sessions where user_id=u and context_id=p_context_id and finished_at is null and context_type in('endless','1v1') for update;
 if s.id is null or s.character_key<>'tank_guard' or not app_private.mastery_owns_character(u,'tank_guard') then raise exception 'Owned active Guard run required';end if;
 if not exists(select 1 from app_private.player_mastery_quests where user_id=u and character_key='tank_guard' and mastered and mastery_enabled) then raise exception 'Complete and enable Guard mastery first';end if;
 if s.context_type='endless' then select verified_wave into w from public.player_progression_runs where run_id=p_context_id and user_id=u and completed_at is null and not test_mode;
 else select p.wave into w from public.multiplayer_players p join public.multiplayer_matches m on m.id=p.match_id where p.match_id=p_context_id and p.user_id=u and p.character_key='tank_guard' and not p.test_mode and p.status='playing' and m.status='playing' and m.finished_at is null;end if;
 if w is null then raise exception 'Owned active Guard run or match required';end if;
 update app_private.mastery_sessions set guard_mode=p_enabled,guard_eligible_wave=case when p_enabled then w else guard_eligible_wave end where id=s.id;
 return jsonb_build_object('guard_mode',p_enabled,'context_id',p_context_id);
end $$;

create or replace function public.claim_mastery_blue_gem(p_context_id uuid,p_pickup_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=app_private.photon_user();s app_private.mastery_sessions;w integer;current_count bigint;target bigint;counter_before bigint;r jsonb;
begin
 if p_context_id is null or p_pickup_id is null or length(trim(p_pickup_id)) not between 1 and 120 then raise exception 'Valid Gem context and pickup ID required';end if;
 -- Use the existing Gem receipt serialization first; a lost-response retry
 -- cannot advance the chain, consume another blue slot, or grant twice.
 perform pg_advisory_xact_lock(hashtextextended(u::text,1));
 if exists(select 1 from public.player_progression_events where user_id=u and source='gem' and source_key=p_context_id::text||':'||trim(p_pickup_id)) then return public.claim_player_gem(p_context_id,p_pickup_id);end if;
 perform pg_advisory_xact_lock(hashtextextended(u::text,23));
 select * into s from app_private.mastery_sessions where user_id=u and context_id=p_context_id and finished_at is null and context_type in('endless','1v1') for update;
 if s.id is null or s.character_key<>'tank_guard' or not app_private.mastery_owns_character(u,'tank_guard') then raise exception 'Active Guard mode required for a blue Gem';end if;
 if not exists(select 1 from app_private.player_mastery_quests where user_id=u and character_key='tank_guard' and mastered and mastery_enabled) then raise exception 'Complete and enable Guard mastery first';end if;
 if s.context_type='1v1' then
  -- 1v1 has no Endless streak and never earns Endless XP. The regular own-match
  -- pickup function still controls its permanent Gem receipt and currency.
  return public.claim_player_gem(p_context_id,p_pickup_id);
 end if;
 select verified_wave into w from public.player_progression_runs where run_id=p_context_id and user_id=u and completed_at is null and not test_mode and heartbeat_active and last_heartbeat_at>=clock_timestamp()-interval '8 seconds' for update;
 if w is null then raise exception 'Blue Gems require recent active Endless play';end if;
 -- Objects spawned while GUARD was enabled remain blue when the player
 -- switches back. Turning it off never clears their already-earned eligibility.
 if not s.guard_mode and s.guard_eligible_wave<>w then raise exception 'Active Guard mode required for a blue Gem';end if;
 if s.guard_blue_wave<>w then s.guard_blue_wave:=w;s.guard_blue_gems:=0;end if;
 if s.guard_blue_gems>=2 then raise exception 'Only two blue objects can appear per wave';end if;
 select streak into current_count from public.player_endless_gem_streaks where run_id=p_context_id and user_id=u for update;
 if not found then select count(*) into current_count from public.player_progression_events where user_id=u and source='gem' and metadata->>'context_id'=p_context_id::text and metadata->>'context_type'='endless';end if;
 -- Blue pickup replaces the normal +1 tier with +2 tiers: current x2 -> x4.
 -- Encode the target back into the preserved five-pickup x5 plateau counter.
 target:=app_private.endless_gem_streak_award(coalesce(current_count,0))+2;
 counter_before:=case when target<=5 then target-1 else target+4 end;
 insert into public.player_endless_gem_streaks(run_id,user_id,wave,streak,updated_at) values(p_context_id,u,w,counter_before,clock_timestamp())
 on conflict(run_id) do update set wave=excluded.wave,streak=excluded.streak,updated_at=excluded.updated_at where public.player_endless_gem_streaks.user_id=u;
 r:=public.claim_player_gem(p_context_id,p_pickup_id);
 if (r->>'is_new')::boolean is not true or (r->>'test_mode')::boolean is true then raise exception 'Blue Gem requires a new active physical pickup';end if;
 update app_private.mastery_sessions set guard_blue_wave=w,guard_blue_gems=s.guard_blue_gems+1 where id=s.id;
 update public.player_progression_events set metadata=metadata||jsonb_build_object('guard_blue',true,'guard_blue_tier',target) where user_id=u and source='gem' and source_key=p_context_id::text||':'||trim(p_pickup_id);
 return r||jsonb_build_object('guard_blue',true,'guard_blue_tier',target);
end $$;
revoke all on function public.set_mastery_guard_mode(uuid,boolean),public.claim_mastery_blue_gem(uuid,text) from public,anon,anonymous;
grant execute on function public.set_mastery_guard_mode(uuid,boolean),public.claim_mastery_blue_gem(uuid,text) to authenticated;
notify pgrst,'reload schema';
commit;
