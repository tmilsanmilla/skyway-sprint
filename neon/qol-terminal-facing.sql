-- Terminal facing is server-owned: Z=left, X=forward, C=right.
-- Apply after qol-maps.sql/qol-armory.sql; existing hashes, accounts and roles stay unchanged.
begin;
alter table public.multiplayer_players add column if not exists terminal_facing smallint not null default 0 check(terminal_facing between -1 and 1);
create or replace function public.set_1v1_terminal_facing(p_match_id uuid,p_facing integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();m public.multiplayer_matches;a public.multiplayer_players;
begin
 if u is null then raise exception 'Sign in required';end if;
 select * into m from public.multiplayer_matches where id=p_match_id for update;
 select * into a from public.multiplayer_players where match_id=p_match_id and user_id=u for update;
 if a.user_id is null then raise exception 'Match not found';end if;
 if m.map_key<>'terminal' or m.status<>'playing' or a.status<>'playing' then raise exception 'Facing requires active Terminal play';end if;
 if p_facing is null or p_facing not between -1 and 1 then raise exception 'Choose left, forward or right';end if;
 if app_private.has_active_ban(u,'account',null) then raise exception 'This account is banned';end if;
 update public.multiplayer_players set terminal_facing=p_facing,last_seen_at=clock_timestamp(),updated_at=clock_timestamp()
 where match_id=p_match_id and user_id=u;
 return public.get_1v1_state(p_match_id);
end $$;
do $migration$
declare d text;needle text;replacement text;
begin
 d:=pg_get_functiondef('public.use_1v1_terminal_sword(uuid)'::regprocedure);
 needle:='hit:=a.lane_index=b.lane_index;';
 replacement:='hit:=a.lane_index+a.terminal_facing=b.lane_index;';
 if position(replacement in d)=0 then
  if (length(d)-length(replace(d,needle,'')))/length(needle)<>1 then raise exception 'Unexpected Terminal sword definition';end if;
  execute replace(d,needle,replacement);
 end if;
 d:=pg_get_functiondef('public.update_1v1_position(uuid,integer)'::regprocedure);
 needle:='if m.map_key=''terminal'' and abs(p_lane_index-a.lane_index)>1 then';
 replacement:=$patch$-- QOL Terminal facing movement guard. Edge wraps follow their input direction.
  if m.map_key='terminal' and a.terminal_facing<>0 and p_lane_index<>a.lane_index and
    (case when a.lane_index=0 and p_lane_index=4 then -1
          when a.lane_index=4 and p_lane_index=0 then 1
          else sign(p_lane_index-a.lane_index) end)<>a.terminal_facing then
    raise exception 'Face forward or toward that lane before moving';
  end if;
  if m.map_key='terminal' and abs(p_lane_index-a.lane_index)>1 then$patch$;
 if position(replacement in d)=0 then
  if (length(d)-length(replace(d,needle,'')))/length(needle)<>1 or position('QOL Terminal facing movement guard' in d)>0 then
   raise exception 'Unexpected Terminal movement definition';end if;
  execute replace(d,needle,replacement);
 end if;
 d:=pg_get_functiondef('public.get_1v1_state(uuid)'::regprocedure);
 needle:='''purchase_counts'',app_private.armory_purchase_counts(p_match_id,u,w),';
 replacement:=needle||E'\n  ''terminal_facing'',(select terminal_facing from public.multiplayer_players where match_id=p_match_id and user_id=u),';
 if position('''terminal_facing'',(select terminal_facing from public.multiplayer_players where match_id=p_match_id and user_id=u)' in d)=0 then
  if (length(d)-length(replace(d,needle,'')))/length(needle)<>1 or position('''terminal_facing''' in d)>0 then
   raise exception 'Unexpected Terminal state reader';end if;
  execute replace(d,needle,replacement);
 end if;
end $migration$;
revoke all on function public.set_1v1_terminal_facing(uuid,integer) from public,anon,anonymous;
grant execute on function public.set_1v1_terminal_facing(uuid,integer) to authenticated;
notify pgrst,'reload schema';
commit;
