-- Admin session access · restore existing role-checked tools, not admin roles.
-- No report, player, ban, inventory, account, or admin membership is changed.
begin;

do $audit$
declare f record; definition text;
begin
  for f in select * from (values
    ('public.get_admin_reports()','public.is_admin()'),
    ('public.resolve_player_report(bigint)','public.is_admin()'),
    ('public.list_admins()','public.is_admin()'),
    ('public.manage_admin(text,text)','public.is_main_admin()'),
    ('public.admin_player_search(text,integer)','public.is_admin()'),
    ('public.admin_get_player(uuid)','public.is_admin()'),
    ('public.admin_get_player_record(uuid)','public.is_admin()'),
    ('public.admin_command_suggestions(text,text,uuid,integer)','public.is_admin()'),
    ('public.admin_execute_player_command(text,uuid,text,text,text,bigint,text[],uuid,bigint,boolean,bigint,text,text)','app_private.admin_execute_player_command_core('),
    ('public.admin_unban_player(uuid,text,text)','app_private.admin_unban_player_core('),
    ('app_private.admin_execute_player_command_core(text,uuid,text,text,text,bigint,text[],uuid,bigint,boolean,bigint,text,text)','public.is_main_admin()'),
    ('app_private.admin_unban_player_core(uuid,text,text)','public.is_main_admin()'),
    ('public.get_admin_ban_appeals(text)','public.is_admin()'),
    ('public.resolve_ban_appeal(bigint,text,text)','public.is_main_admin()'),
    ('public.set_admin_test_mode(boolean)','Test Mode is only available to admins')
  ) as checks(signature,guard)
  loop
    if to_regprocedure(f.signature) is null then
      raise exception 'Missing role-checked function: %',f.signature;
    end if;
    select pg_get_functiondef(p.oid) into definition from pg_proc p
      where p.oid=to_regprocedure(f.signature)
        and p.prosecdef and 'search_path=""'=any(p.proconfig);
    if definition is null or position(f.guard in definition)=0 then
      raise exception 'Admin entry guard failed verification: %',f.signature;
    end if;
  end loop;
end
$audit$;

-- The managed Neon Auth tables use Better Auth field names. Repair only the
-- existing lookup readers; keep their full data shape and role guards intact.
do $auth_fields$
declare signature text; definition text;
begin
  foreach signature in array array[
    'public.admin_player_search(text,integer)', 'public.admin_get_player(uuid)'
  ] loop
    definition := pg_get_functiondef(to_regprocedure(signature));
    if position('public.is_admin()' in definition)=0
       or position('neon_auth."user"' in definition)=0 then
      raise exception 'Unexpected admin lookup definition: %',signature;
    end if;
    definition := replace(definition,'users.created_at','users."createdAt"');
    definition := replace(definition,'users.last_sign_in_at',
      '(select max(session."createdAt") from neon_auth."session" session where session."userId"=users.id)');
    -- Better Auth records whether an email is verified, not its verification
    -- timestamp. Do not fabricate a timestamp in the legacy JSON field.
    definition := replace(definition,'users.email_confirmed_at','null::timestamptz');
    execute definition;
  end loop;
end
$auth_fields$;

revoke all on function public.get_admin_reports(),
  public.resolve_player_report(bigint), public.list_admins(),
  public.manage_admin(text,text), public.admin_player_search(text,integer),
  public.admin_get_player(uuid), public.admin_get_player_record(uuid),
  public.admin_command_suggestions(text,text,uuid,integer),
  public.admin_execute_player_command(text,uuid,text,text,text,bigint,text[],uuid,bigint,boolean,bigint,text,text),
  public.admin_unban_player(uuid,text,text), public.get_admin_ban_appeals(text),
  public.resolve_ban_appeal(bigint,text,text), public.set_admin_test_mode(boolean)
  from public, anon, anonymous;
grant execute on function public.get_admin_reports(),
  public.resolve_player_report(bigint), public.list_admins(),
  public.manage_admin(text,text), public.admin_player_search(text,integer),
  public.admin_get_player(uuid), public.admin_get_player_record(uuid),
  public.admin_command_suggestions(text,text,uuid,integer),
  public.admin_execute_player_command(text,uuid,text,text,text,bigint,text[],uuid,bigint,boolean,bigint,text,text),
  public.admin_unban_player(uuid,text,text), public.get_admin_ban_appeals(text),
  public.resolve_ban_appeal(bigint,text,text), public.set_admin_test_mode(boolean)
  to authenticated;

notify pgrst,'reload schema';
commit;
