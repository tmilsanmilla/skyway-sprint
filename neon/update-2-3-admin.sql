-- Update 2.3: additive, typed main-admin commands and server-side report controls.
-- Apply only with the matching client. No command is executed by this migration:
-- notably it DOES NOT clear reports, change balances, or revoke owned items.
begin;

do $preflight$
begin
  if to_regprocedure('public.is_admin()') is null
    or to_regprocedure('public.is_main_admin()') is null
    or to_regprocedure('app_private.photon_qol_catalog()') is null
    or to_regclass('public.player_photon_fury') is null
    or to_regclass('public.player_reports') is null
    or to_regclass('public.admin_command_audit') is null then
    raise exception 'Current admin, report, and Photon setup is required';
  end if;
end
$preflight$;

create table if not exists app_private.player_report_permissions (
  user_id uuid primary key references public.player_stats(user_id) on delete cascade,
  allowed boolean not null,
  updated_by uuid not null,
  updated_at timestamptz not null default clock_timestamp()
);
alter table app_private.player_report_permissions enable row level security;
revoke all on app_private.player_report_permissions from public,anon,anonymous,authenticated;

create or replace function public.get_my_report_permission()
returns boolean language plpgsql stable security definer set search_path='' as $$
declare u uuid := auth.uid();
begin
  if u is null then raise exception 'Sign in required' using errcode='42501'; end if;
  return coalesce((select allowed from app_private.player_report_permissions where user_id=u),true);
end $$;

create or replace function app_private.enforce_report_permission()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  -- The matching admin mutation takes the same lock; a concurrent report cannot
  -- slip through after a report ban has committed. Existing own-row RLS remains.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('report-permission:'||new.user_id::text,0));
  if exists(select 1 from app_private.player_report_permissions p where p.user_id=new.user_id and not p.allowed) then
    raise exception 'This account is not allowed to submit reports' using errcode='42501';
  end if;
  return new;
end $$;
revoke all on function app_private.enforce_report_permission() from public,anon,anonymous,authenticated;
drop trigger if exists enforce_report_permission on public.player_reports;
create trigger enforce_report_permission before insert on public.player_reports
for each row execute function app_private.enforce_report_permission();

-- Keep the current command implementation (audit, bans, own-game protections)
-- behind a stricter boundary rather than replacing it with an old SQL copy.
do $legacy$
declare signature text:='app_private.admin_execute_player_command_core(text,uuid,text,text,text,bigint,text[],uuid,bigint,boolean,bigint,text,text)'; definition text;
begin
  select pg_get_functiondef(p.oid) into definition from pg_proc p where p.oid=to_regprocedure(signature)
    and p.prosecdef and 'search_path=""'=any(p.proconfig);
  if definition is null or position('public.is_main_admin()' in definition)=0 then raise exception 'Current guarded admin core is missing'; end if;
  if to_regprocedure('app_private.admin_execute_player_command_pre_v23(text,uuid,text,text,text,bigint,text[],uuid,bigint,boolean,bigint,text,text)') is null then
    if position('Update 2.3 strict legacy command boundary' in definition)>0 then raise exception 'Legacy core snapshot missing'; end if;
    if md5(definition)<>'94e544a706963d9cd0e73387c426ad46' then raise exception 'Installed admin core differs from the October 19 audited body';end if;
    execute replace(definition,'FUNCTION app_private.admin_execute_player_command_core(','FUNCTION app_private.admin_execute_player_command_pre_v23(');
  elsif position('Update 2.3 strict legacy command boundary' in definition)=0 then
    raise exception 'Legacy admin core changed since Update 2.3; review before reapplying';
  end if;
  definition:=pg_get_functiondef('app_private.admin_execute_player_command_pre_v23(text,uuid,text,text,text,bigint,text[],uuid,bigint,boolean,bigint,text,text)'::regprocedure);
  if md5(replace(definition,'FUNCTION app_private.admin_execute_player_command_pre_v23(','FUNCTION app_private.admin_execute_player_command_core('))<>'94e544a706963d9cd0e73387c426ad46' then raise exception 'Audited original admin delegate changed';end if;
end
$legacy$;
revoke all on function app_private.admin_execute_player_command_pre_v23(text,uuid,text,text,text,bigint,text[],uuid,bigint,boolean,bigint,text,text)
  from public,anon,anonymous,authenticated;

create or replace function app_private.admin_execute_player_command_core(
  p_action text,p_target_user_id uuid,p_item_kind text default null,p_item_key text default null,
  p_stat_key text default null,p_value bigint default null,p_ban_scopes text[] default null,
  p_device_id uuid default null,p_duration_seconds bigint default null,p_permanent boolean default false,
  p_ban_id bigint default null,p_reason text default null,p_command_text text default null
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); action text:=lower(trim(coalesce(p_action,''))); error_text text; actor_email text;
begin
  -- Update 2.3 strict legacy command boundary. The delegate keeps its old audit.
  if actor is null or not public.is_main_admin() then raise exception 'Only main admins can run player commands' using errcode='42501'; end if;
  if action not in('grant','revoke','set','ban','unban') then error_text:='Unknown player command. Use /ban, not /bann.';
  elsif action in('grant','revoke') and lower(trim(coalesce(p_item_key,''))) in('runner_ace','medic_patch','tank_bulwark','trickster_rogue','photon_magician','photon_wizard','photon_bluff','photon_bell') then
    error_text:='The four starter characters cannot be granted or revoked';
  elsif action='set' and lower(trim(coalesce(p_stat_key,''))) not in('gems','high_score','score') then
    error_text:='Only gems and high score use this command. Coin balances cannot be changed.';
  elsif action='ban' and (p_ban_scopes is distinct from array['account']::text[] or p_device_id is not null
    or (not coalesce(p_permanent,false) and (p_duration_seconds is null or p_duration_seconds<60
      or p_duration_seconds>3155760000 or mod(p_duration_seconds,60)<>0))) then
    error_text:='Use /ban username/email integer minutes; 0 is permanent. This command bans the account only.';
  end if;
  if error_text is not null then
    select lower(u.email) into actor_email from neon_auth."user" u where u.id::text=actor::text;
    insert into public.admin_command_audit(actor_user_id,actor_email,target_user_id,action,command_text,request,result,succeeded,error_message)
      values(actor,coalesce(actor_email,''),p_target_user_id,action,left(p_command_text,1000),jsonb_build_object('item_key',p_item_key,'stat_key',p_stat_key),null,false,error_text);
    return jsonb_build_object('ok',false,'error',error_text);
  end if;
  return app_private.admin_execute_player_command_pre_v23(p_action,p_target_user_id,p_item_kind,p_item_key,p_stat_key,p_value,
    p_ban_scopes,p_device_id,p_duration_seconds,p_permanent,p_ban_id,p_reason,p_command_text);
end $$;
revoke all on function app_private.admin_execute_player_command_core(text,uuid,text,text,text,bigint,text[],uuid,bigint,boolean,bigint,text,text)
  from public,anon,anonymous,authenticated;

-- The new dispatcher deliberately shares the existing typed argument surface.
-- For Photon edits p_item_key is the exact item name, and p_stat_key contains
-- the exact character name only for skin edits. Names never become SQL text.
create or replace function app_private.admin_player_command_v23_core(
  p_action text,p_target_user_id uuid,p_item_kind text default null,p_item_key text default null,
  p_stat_key text default null,p_value bigint default null,p_ban_scopes text[] default null,
  p_device_id uuid default null,p_duration_seconds bigint default null,p_permanent boolean default false,
  p_ban_id bigint default null,p_reason text default null,p_command_text text default null
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid:=auth.uid(); action text:=lower(trim(coalesce(p_action,'')));
  stat text:=lower(trim(coalesce(p_stat_key,''))); v_kind text:=lower(trim(coalesce(p_item_kind,'')));
  name text:=lower(trim(coalesce(p_item_key,''))); actor_email text;
  target_profile public.player_photon_fury; wallet public.player_stats; item record; character record;
  result jsonb; request jsonb; changed integer:=0; error_text text; error_state text; old_allowed boolean;
begin
  if actor is null or not public.is_main_admin() then
    raise exception 'Only main admins can run player commands' using errcode='42501';
  end if;
  select lower(u.email) into actor_email from neon_auth."user" u where u.id::text=actor::text;
  if actor_email is null then raise exception 'Signed-in admin account not found' using errcode='42501'; end if;
  if char_length(coalesce(p_command_text,''))>1000 then raise exception 'Command is too long'; end if;
  if action<>'rptc' and (p_target_user_id is null or not exists(
    select 1 from neon_auth."user" u where u.id::text=p_target_user_id::text)) then
    raise exception 'Player not found' using errcode='P0002';
  end if;
  request:=jsonb_build_object('item_kind',v_kind,'item_name',name,'stat_key',stat,'value',p_value);
  begin
    if action not in('check','set','rpta','rptb','rptc','photon_grant','photon_revoke') then
      raise exception 'Unknown Update 2.3 command';
    end if;
    if p_ban_scopes is not null or p_device_id is not null or p_duration_seconds is not null
      or coalesce(p_permanent,false) or p_ban_id is not null then
      raise exception 'Unexpected command arguments';
    end if;
    if action='rptc' then
      if p_target_user_id is not null or v_kind<>'' or name<>'' or stat<>'' or p_value is not null then
        raise exception '/rptc does not accept a player or value';
      end if;
      -- Only invoking /rptc does this; installation never clears real reports.
      delete from public.player_reports where status in('new','reviewing');
      get diagnostics changed=row_count;
      result:=jsonb_build_object('ok',true,'cleared_count',changed);
    elsif action in('rpta','rptb') then
      if v_kind<>'' or name<>'' or stat<>'' or p_value is not null then raise exception 'Unexpected report-control argument'; end if;
      perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('report-permission:'||p_target_user_id::text,0));
      old_allowed:=coalesce((select allowed from app_private.player_report_permissions where user_id=p_target_user_id),true);
      if old_allowed<>(action='rpta') then
        insert into app_private.player_report_permissions(user_id,allowed,updated_by)
        values(p_target_user_id,action='rpta',actor)
        on conflict(user_id) do update set allowed=excluded.allowed,updated_by=excluded.updated_by,updated_at=clock_timestamp();
        changed:=1;
      end if;
      result:=jsonb_build_object('ok',true,'reports_allowed',action='rpta','changed',changed=1,'noop',changed=0,
        'message',case when action='rpta' then 'Reports are allowed for this player.' else 'Reports are blocked for this player.' end);
    elsif action='check' then
      if stat not in('gems','photons','stardust') or name<>'' or v_kind<>'' or p_value is not null then
        raise exception 'Check accepts gems, photons, or stardust only';
      end if;
      if stat='photons' then
        select * into target_profile from public.player_photon_fury where user_id=p_target_user_id;
        result:=jsonb_build_object('ok',true,'stat_key',stat,'value',case when target_profile.unlocked_at is not null then target_profile.photons else null end);
      else
        select * into wallet from public.player_stats where user_id=p_target_user_id;
        if not found then raise exception 'Player stats not found'; end if;
        result:=jsonb_build_object('ok',true,'stat_key',stat,'value',case when stat='gems' then wallet.total_gems else wallet.stardust end);
      end if;
    elsif action='set' then
      if stat not in('photons','stardust') or name<>'' or v_kind<>'' then raise exception 'Choose photons or stardust'; end if;
      if p_value is null or p_value<0 or p_value>1000000000 then raise exception 'Balance must be a whole number between 0 and 1000000000'; end if;
      if stat='photons' then
        select * into target_profile from public.player_photon_fury where user_id=p_target_user_id for update;
        if target_profile.unlocked_at is null then
          result:=jsonb_build_object('ok',true,'noop',true,'message','Photon Fury is locked; nothing was changed.');
        else
          update public.player_photon_fury set photons=p_value where user_id=p_target_user_id;
          result:=jsonb_build_object('ok',true,'stat_key',stat,'value',p_value);
        end if;
      else
        update public.player_stats set stardust=p_value,updated_at=clock_timestamp() where user_id=p_target_user_id;
        if not found then raise exception 'Player stats not found'; end if;
        result:=jsonb_build_object('ok',true,'stat_key',stat,'value',p_value);
      end if;
    else
      if v_kind not in('photon_character','photon_skin','photon_theme') or p_value is not null or name='' then
        raise exception 'Choose an exact Photon character, skin, or theme';
      end if;
      select * into target_profile from public.player_photon_fury where user_id=p_target_user_id for update;
      if target_profile.unlocked_at is null then
        result:=jsonb_build_object('ok',true,'noop',true,'message','Photon Fury is locked; nothing was changed.');
      else
        if v_kind='photon_skin' then
          if name not in('intermediate','pro','ascendant','divine','immortal') then raise exception 'Unknown Photon skin tier'; end if;
          select * into character from app_private.photon_qol_catalog() c where c.kind='character'
            and (lower(c.item_key)=stat or lower(c.display_name)=stat);
          if character.item_key is null then raise exception 'Unknown Photon character'; end if;
          select * into item from app_private.photon_qol_catalog() c where c.kind='skin'
            and c.character_key=character.item_key and c.rarity=name;
        else
          if stat<>'' then raise exception 'Unexpected Photon item argument'; end if;
          select * into item from app_private.photon_qol_catalog() c
            where c.kind=case v_kind when 'photon_character' then 'character' else 'theme' end
            and (lower(c.item_key)=name or lower(c.display_name)=name);
        end if;
        if item.item_key is null then raise exception 'Unknown Photon catalog item'; end if;
        if item.kind='character' and item.item_key in('photon_magician','photon_wizard','photon_bluff','photon_bell') then
          raise exception 'The four starter characters cannot be granted or revoked';
        end if;
        if action='photon_grant' then
          insert into app_private.photon_unlocks(user_id,item_key,kind) values(p_target_user_id,item.item_key,item.kind)
            on conflict(user_id,item_key) do nothing;
          get diagnostics changed=row_count;
        else
          delete from app_private.photon_unlocks where user_id=p_target_user_id and item_key=item.item_key and kind=item.kind;
          get diagnostics changed=row_count;
          if item.kind='character' then
            -- Imported explicit character ownership is also consulted by owns_photon_character.
            delete from public.player_unlocks where user_id=p_target_user_id and item_key=item.item_key and item_type='character';
            if found then changed:=1; end if;
            update public.player_photon_fury set selected_character_key='photon_magician'
              where user_id=p_target_user_id and selected_character_key=item.item_key;
          elsif item.kind='skin' then
            update public.player_photon_fury set skin_choices=skin_choices-item.character_key
              where user_id=p_target_user_id and skin_choices->>item.character_key=item.item_key;
          else
            update public.player_photon_fury set selected_theme_key='default'
              where user_id=p_target_user_id and selected_theme_key=item.item_key;
          end if;
        end if;
        result:=jsonb_build_object('ok',true,'item_key',item.item_key,'changed',changed>0,'noop',changed=0,'message','No ownership changes were needed.');
      end if;
    end if;
  exception when others then
    get stacked diagnostics error_text=message_text,error_state=returned_sqlstate;
    insert into public.admin_command_audit(actor_user_id,actor_email,target_user_id,action,command_text,request,result,succeeded,error_message)
    values(actor,actor_email,p_target_user_id,action,p_command_text,request,jsonb_build_object('sqlstate',error_state),false,left(error_text,1000));
    return jsonb_build_object('ok',false,'error',error_text);
  end;
  insert into public.admin_command_audit(actor_user_id,actor_email,target_user_id,action,command_text,request,result,succeeded)
    values(actor,actor_email,p_target_user_id,action,p_command_text,request,result,true);
  return result;
end $$;
revoke all on function app_private.admin_player_command_v23_core(text,uuid,text,text,text,bigint,text[],uuid,bigint,boolean,bigint,text,text)
  from public,anon,anonymous,authenticated;

-- Preserve the actual installed public wrapper, including its anti-command-game
-- guard. Do NOT recreate an old wrapper from a historical Supabase definition.
-- Source/body checks intentionally fail closed if that surface has changed.
do $dispatcher$
declare source text; legacy text; signature text:='public.admin_execute_player_command(text,uuid,text,text,text,bigint,text[],uuid,bigint,boolean,bigint,text,text)';
begin
  select pg_get_functiondef(p.oid) into source from pg_proc p where p.oid=to_regprocedure(signature)
    and p.prosecdef and 'search_path=""'=any(p.proconfig);
  if source is null or (length(source)-length(replace(source,'app_private.admin_execute_player_command_core(','')))/length('app_private.admin_execute_player_command_core(')<>1 then
    raise exception 'Installed admin command wrapper is unexpected; review its current anti-game guard before applying';
  end if;
  if md5(source)<>'a5039d2716c73dc97464894bdb7eff84' or position('app_private.intercept_in_game_player_command(' in source)=0 then raise exception 'Current in-game command interception changed; review before applying';end if;
  legacy:=pg_get_functiondef(to_regprocedure('app_private.admin_execute_player_command_core(text,uuid,text,text,text,bigint,text[],uuid,bigint,boolean,bigint,text,text)'));
  if legacy is null or position('public.is_main_admin()' in legacy)=0 then raise exception 'Current main-admin core is missing'; end if;
  source:=replace(source,'FUNCTION public.admin_execute_player_command(','FUNCTION public.admin_player_command_v23(');
  source:=replace(source,'app_private.admin_execute_player_command_core(','app_private.admin_player_command_v23_core(');
  execute source;
end
$dispatcher$;

revoke all on function public.admin_player_command_v23(text,uuid,text,text,text,bigint,text[],uuid,bigint,boolean,bigint,text,text)
  from public,anon,anonymous;
grant execute on function public.admin_player_command_v23(text,uuid,text,text,text,bigint,text[],uuid,bigint,boolean,bigint,text,text)
  to authenticated;

revoke all on function public.get_my_report_permission() from public,anon,anonymous;
grant execute on function public.get_my_report_permission() to authenticated;
notify pgrst,'reload schema';
commit;
