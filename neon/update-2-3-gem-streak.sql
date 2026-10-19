-- Update 2.3: a hitless chain spans the whole Endless run and has no x7 cap.
-- Run before update-2-3-masteries.sql. Keep all installed receipt, heartbeat,
-- rate, own-account and test-run guards; unexpected source aborts the patch.
begin;
create or replace function app_private.endless_gem_streak_award(p_consecutive_pickups bigint)
returns bigint language sql immutable set search_path='' as $$
 select case when coalesce(p_consecutive_pickups,0)<=0 then 0
 when p_consecutive_pickups<=5 then p_consecutive_pickups
 when p_consecutive_pickups<=10 then 5 else p_consecutive_pickups-5 end;
$$;
revoke all on function app_private.endless_gem_streak_award(bigint) from public,anon,anonymous,authenticated;
do $patch$
declare d text;needle text;
begin
 d:=pg_get_functiondef('app_private.claim_player_gem_live(uuid,text)'::regprocedure);
 if position('Hitless streak Update 2.3' in d)=0 then
  if position('v_uid uuid:=auth.uid()' in d)=0 or position('Gem pickups arrived too quickly' in d)=0
   or position('on conflict(user_id,source,source_key) do nothing' in d)=0
   or position('for update' in lower(d))=0 then raise exception 'Gem claim ownership/receipt validation differs; review current source';end if;
  needle:=E'v_streak:=case when v_stored_wave=v_verified_wave\n      then greatest(coalesce(v_stored_streak,0),0)+1 else 1 end;';
  if position(needle in d)=0 or position('v_gems_awarded:=v_streak;' in d)=0 then raise exception 'Unexpected gem streak source';end if;
  d:=replace(d,needle,E'-- Hitless streak Update 2.3: only explicit damage reset breaks the chain.\n    v_streak:=greatest(coalesce(v_stored_streak,0),0)+1;');
  d:=replace(d,'v_gems_awarded:=v_streak;','v_gems_awarded:=app_private.endless_gem_streak_award(v_streak);');
  -- Existing reset rows are retained. Receipt fallback is only for a run that
  -- has never had a streak row, not an opportunity to undo a damage reset.
  needle:=E'        and coalesce(\n          (event.metadata->>''streak_wave'')::integer,\n          (event.metadata->>''verified_wave'')::integer\n        )=v_verified_wave';
  if position(needle in d)=0 then raise exception 'Unexpected gem fallback source';end if;
  d:=replace(d,needle,'');
  execute d;
 end if;
 -- Older capped wrapper versions normalised the private counter down to12.
 -- Remove exactly that cap if present; never replace an unrelated wrapper.
 d:=pg_get_functiondef('public.claim_player_gem(uuid,text)'::regprocedure);
 needle:='v_streak:=least(12,greatest(1,coalesce((v_result->>''streak'')::bigint,1)));';
 if position(needle in d)>0 then
  if position('return v_result||jsonb_build_object' in d)=0 or position('app_private.claim_player_gem_live' in d)=0 then raise exception 'Unexpected capped gem wrapper';end if;
  execute replace(d,needle,'v_streak:=greatest(1,coalesce((v_result->>''streak'')::bigint,1));');
 end if;
end
$patch$;
notify pgrst,'reload schema';
commit;
