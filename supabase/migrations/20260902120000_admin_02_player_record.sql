-- Admin 02 Player Look and Commands: readable player action record.
--
-- The player editor intentionally exposes only the account fields requested by
-- the UI. This RPC supplies the separate moderation record, including durable
-- command-audit attribution and current actor usernames/roles where available.

begin;

create or replace function public.admin_get_player_record(p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if not public.is_admin() then
    raise exception 'Admin access required';
  end if;

  if p_user_id is null or not exists (
    select 1 from auth.users users where users.id = p_user_id
  ) then
    raise exception 'Player not found';
  end if;

  select jsonb_build_object(
    'bans', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', ban.id,
        'scope', ban.scope,
        'device_id', ban.target_device_id,
        'starts_at', ban.starts_at,
        'expires_at', ban.expires_at,
        'reason', ban.reason,
        'created_at', ban.created_at,
        'active', ban.revoked_at is null
          and ban.starts_at <= now()
          and (ban.expires_at is null or ban.expires_at > now()),
        'created_by_user_id', ban.created_by,
        'created_by_email', lower(created_actor.email),
        'created_by_username', created_profile.username,
        'created_by_role', (
          select admin.role
          from public.admin_users admin
          where admin.user_id = ban.created_by
             or (
               admin.user_id is null
               and admin.email = lower(created_actor.email)
             )
          order by (admin.user_id = ban.created_by) desc
          limit 1
        ),
        'revoked_at', ban.revoked_at,
        'revoked_reason', ban.revoked_reason,
        'revoked_by_user_id', ban.revoked_by,
        'revoked_by_email', lower(revoked_actor.email),
        'revoked_by_username', revoked_profile.username,
        'revoked_by_role', (
          select admin.role
          from public.admin_users admin
          where admin.user_id = ban.revoked_by
             or (
               admin.user_id is null
               and admin.email = lower(revoked_actor.email)
             )
          order by (admin.user_id = ban.revoked_by) desc
          limit 1
        )
      ) order by ban.created_at desc)
      from public.player_bans ban
      left join auth.users created_actor on created_actor.id = ban.created_by
      left join public.player_profiles created_profile
        on created_profile.user_id = ban.created_by
      left join auth.users revoked_actor on revoked_actor.id = ban.revoked_by
      left join public.player_profiles revoked_profile
        on revoked_profile.user_id = ban.revoked_by
      where ban.target_user_id = p_user_id
         or exists (
           select 1
           from public.player_device_links link
           where link.user_id = p_user_id
             and link.device_id = ban.target_device_id
         )
    ), '[]'::jsonb),
    'commands', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', audit.id,
        'action', audit.action,
        'command_text', audit.command_text,
        'succeeded', audit.succeeded,
        'error_message', audit.error_message,
        'created_at', audit.created_at,
        'actor_user_id', audit.actor_user_id,
        'actor_email', audit.actor_email,
        'actor_username', actor_profile.username,
        'actor_role', (
          select admin.role
          from public.admin_users admin
          where admin.user_id = audit.actor_user_id
             or (
               admin.user_id is null
               and admin.email = lower(audit.actor_email)
             )
          order by (admin.user_id = audit.actor_user_id) desc
          limit 1
        )
      ) order by audit.created_at desc)
      from public.admin_command_audit audit
      left join public.player_profiles actor_profile
        on actor_profile.user_id = audit.actor_user_id
      where audit.target_user_id = p_user_id
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.admin_get_player_record(uuid)
  from public, anon;
grant execute on function public.admin_get_player_record(uuid)
  to authenticated;

notify pgrst, 'reload schema';
commit;
