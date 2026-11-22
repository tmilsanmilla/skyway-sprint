-- Add the requested commands. Applying this migration executes NO command.
-- Keep the installed public session/in-game boundary and all prior commands.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

create or replace function app_private.admin_player_command_v24_core(
 p_action text,p_target_user_id uuid,p_item_kind text default null,p_item_key text default null,
 p_stat_key text default null,p_value bigint default null,p_ban_scopes text[] default null,
 p_device_id uuid default null,p_duration_seconds bigint default null,p_permanent boolean default false,
 p_ban_id bigint default null,p_reason text default null,p_command_text text default null
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 actor uuid:=auth.uid(); action text:=lower(trim(coalesce(p_action,'')));
 item_kind text:=lower(trim(coalesce(p_item_kind,''))); requested_key text:=lower(trim(coalesce(p_item_key,'')));
 actor_email text; result jsonb; item record; appeal record; changed integer:=0;
 owned boolean; games bigint; rating numeric; closed integer:=0; error_text text;
begin
 if actor is null or not public.is_main_admin() then
  raise exception 'Only main admins can run player commands' using errcode='42501';
 end if;
 if action not in('appeal_accept_all','appeal_reject_all','appeal_count','ranked_owned','ranked_elo','ranked_games','mastery_reset')
  and not(action in('photon_grant','photon_revoke') and item_kind='photon_weapon') then
  return app_private.admin_player_command_v23_core(p_action,p_target_user_id,p_item_kind,p_item_key,p_stat_key,p_value,p_ban_scopes,p_device_id,p_duration_seconds,p_permanent,p_ban_id,p_reason,p_command_text);
 end if;
 if char_length(coalesce(p_command_text,''))>1000 or p_stat_key is not null or p_value is not null
  or p_ban_scopes is not null or p_device_id is not null or p_duration_seconds is not null
  or coalesce(p_permanent,false) or p_ban_id is not null or p_reason is not null then
  raise exception 'Unexpected command fields' using errcode='22023';
 end if;
 select lower(u.email) into actor_email from neon_auth."user" u where u.id::text=actor::text;
 if actor_email is null then raise exception 'Signed-in admin not found';end if;
 begin
  if action like 'appeal_%' then
   if p_target_user_id is not null or item_kind<>'' or requested_key<>'' then raise exception 'Appeal commands have no player or item argument';end if;
   if action='appeal_count' then
    select count(*) into changed from public.player_ban_appeals where status='pending';
    result:=jsonb_build_object('ok',true,'value',changed);
   else
    -- Fixed original pending-row snapshot, in ID order. Never skip a locked
    -- appeal or bypass its safe original-ban snapshot via a bulk table update.
    for appeal in select id from public.player_ban_appeals where status='pending' order by id for update loop
     perform public.resolve_ban_appeal(appeal.id,case when action='appeal_accept_all' then 'approve' else 'deny' end,null);
     changed:=changed+1;
    end loop;
    result:=jsonb_build_object('ok',true,'changed_count',changed);
   end if;
  else
   if p_target_user_id is null or not exists(select 1 from neon_auth."user" u where u.id::text=p_target_user_id::text) then
    raise exception 'Player not found' using errcode='P0002';
   end if;
   if action like 'ranked_%' then
    if item_kind<>'' or requested_key<>'' then raise exception 'Ranked commands accept only the player';end if;
    owned:=exists(select 1 from app_private.ranked_requalification where user_id=p_target_user_id and qualified);
    select coalesce(sum(r.matches_played),0) into games from public.player_ranked_1v1_stats r where r.user_id=p_target_user_id;
    select r.rating into rating from public.player_ranked_1v1_stats r join public.ranked_1v1_seasons s on s.id=r.season_id
     where r.user_id=p_target_user_id and s.is_active;
    result:=jsonb_build_object('ok',true,'value',case
     when action='ranked_owned' then to_jsonb(case when owned then 1 else 0 end)
     when not owned then 'null'::jsonb
     when action='ranked_games' then to_jsonb(games)
     when games<5 or rating is null then 'null'::jsonb
     else to_jsonb(round(rating)::text||case when games<=20 then 'P' else '' end) end);
   elsif action='mastery_reset' then
    if item_kind<>'mastery' or app_private.mastery_price(requested_key) is null then raise exception 'Choose an exact supported mastery';end if;
    perform pg_advisory_xact_lock(hashtextextended(p_target_user_id::text,23));
    -- Close receipts first; old trial finishes and pending quest batches cannot
    -- restore a deleted purchase. Character ownership is never deleted.
    update app_private.mastery_sessions set finished_at=coalesce(finished_at,clock_timestamp()),
     trial_failed=case when context_type='trial' then true else trial_failed end,
     event_counts=event_counts||jsonb_build_object('admin_mastery_revoked',true,'admin_mastery_reset',true)
     where user_id=p_target_user_id and character_key=requested_key;
    get diagnostics closed=row_count;
    update app_private.player_mastery_preferences set active_character=null
     where user_id=p_target_user_id and active_character=requested_key;
    delete from app_private.player_mastery_quests where user_id=p_target_user_id and character_key=requested_key;
    get diagnostics changed=row_count;
    result:=jsonb_build_object('ok',true,'changed',changed>0,'closed_sessions',closed,'character_owned_unchanged',true);
   else
    if item_kind<>'photon_weapon' or requested_key='' then raise exception 'Choose an exact Photon weapon';end if;
    select * into item from app_private.photon_weapon_rules(null) w where lower(w.weapon_key)=requested_key or lower(w.display_name)=requested_key;
    if item.weapon_key is null then raise exception 'Unknown Photon weapon';end if;
    if item.weapon_key='lightsaber' then raise exception 'Lightsaber is included and cannot be granted or revoked';end if;
    perform 1 from public.player_photon_fury where user_id=p_target_user_id and unlocked_at is not null for update;
    if not found then raise exception 'Photon Fury is locked for this player';end if;
    if action='photon_grant' then
     insert into app_private.photon_unlocks(user_id,item_key,kind) values(p_target_user_id,'photon_weapon_'||item.weapon_key,'weapon') on conflict(user_id,item_key) do nothing;
     get diagnostics changed=row_count;
    else
     delete from app_private.photon_unlocks where user_id=p_target_user_id and kind='weapon' and item_key='photon_weapon_'||item.weapon_key;
     get diagnostics changed=row_count;
     update public.player_photon_fury set selected_weapon_key='lightsaber' where user_id=p_target_user_id and selected_weapon_key=item.weapon_key;
    end if;
    result:=jsonb_build_object('ok',true,'changed',changed>0,'noop',changed=0,'item_key',item.weapon_key);
   end if;
  end if;
 exception when others then
  get stacked diagnostics error_text=message_text;
  insert into public.admin_command_audit(actor_user_id,actor_email,target_user_id,action,command_text,request,result,succeeded,error_message)
   values(actor,actor_email,p_target_user_id,action,left(p_command_text,1000),jsonb_build_object('item_kind',item_kind,'item_key',requested_key),null,false,left(error_text,1000));
  return jsonb_build_object('ok',false,'error',error_text);
 end;
 insert into public.admin_command_audit(actor_user_id,actor_email,target_user_id,action,command_text,request,result,succeeded)
  values(actor,actor_email,p_target_user_id,action,left(p_command_text,1000),jsonb_build_object('item_kind',item_kind,'item_key',requested_key),result,true);
 return result;
end $$;
revoke all on function app_private.admin_player_command_v24_core(text,uuid,text,text,text,bigint,text[],uuid,bigint,boolean,bigint,text,text) from public,anon,anonymous,authenticated;

do $clone_guarded_public_boundary$
declare d text; needle text:='app_private.admin_player_command_v23_core(';
begin
 d:=pg_get_functiondef(to_regprocedure('public.admin_player_command_v23(text,uuid,text,text,text,bigint,text[],uuid,bigint,boolean,bigint,text,text)'));
 if d is null or md5(d)<>'3ad393598fdf511e17ffb1bd18a40868'
  or position('app_private.require_pixel_runtime()' in d)=0
  or position('app_private.intercept_in_game_player_command(' in d)=0
  or (length(d)-length(replace(d,needle,'')))/length(needle)<>1
  or not exists(select 1 from pg_proc where oid=to_regprocedure('public.admin_player_command_v23(text,uuid,text,text,text,bigint,text[],uuid,bigint,boolean,bigint,text,text)') and prosecdef and 'search_path=""'=any(proconfig)) then
  raise exception 'Installed main-admin/session/in-game command boundary changed; review current source';
 end if;
 d:=replace(d,'FUNCTION public.admin_player_command_v23(','FUNCTION public.admin_player_command_v24(');
 execute replace(d,needle,'app_private.admin_player_command_v24_core(');
end $clone_guarded_public_boundary$;
revoke all on function public.admin_player_command_v24(text,uuid,text,text,text,bigint,text[],uuid,bigint,boolean,bigint,text,text) from public,anon,anonymous;
grant execute on function public.admin_player_command_v24(text,uuid,text,text,text,bigint,text[],uuid,bigint,boolean,bigint,text,text) to authenticated;
notify pgrst,'reload schema';
commit;
