-- Admin 03 Player Lookup and Commands
-- Revoke every active ban attached to one player without requiring ban IDs.

create or replace function public.admin_unban_player(
  p_target_user_id uuid,
  p_reason text default null,
  p_command_text text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_email text;
  v_reason text := coalesce(
    nullif(trim(p_reason), ''),
    'Issued from admin player editor'
  );
  v_request jsonb;
  v_result jsonb;
  v_error text;
  v_sqlstate text;
  v_revoked_count integer := 0;
  v_revoked_ban_ids jsonb := '[]'::jsonb;
begin
  if not public.is_main_admin() then
    raise exception 'Only main admins can run player commands';
  end if;

  if not exists (
    select 1
    from auth.users users
    where users.id = p_target_user_id
  ) then
    raise exception 'Player not found';
  end if;

  select lower(users.email)::text
  into v_actor_email
  from auth.users users
  where users.id = v_actor;

  if char_length(v_reason) > 500 then
    raise exception 'Reason must be 500 characters or fewer';
  end if;

  v_request := jsonb_build_object(
    'target_user_id', p_target_user_id,
    'mode', 'all_active_bans_for_player',
    'reason', v_reason
  );

  begin
    with revoked as (
      update public.player_bans ban
      set revoked_at = now(),
          revoked_by = v_actor,
          revoked_reason = v_reason
      where ban.revoked_at is null
        and ban.starts_at <= now()
        and (ban.expires_at is null or ban.expires_at > now())
        and (
          ban.target_user_id = p_target_user_id
          or exists (
            select 1
            from public.player_device_links link
            where link.user_id = p_target_user_id
              and link.device_id = ban.target_device_id
          )
        )
      returning ban.id
    )
    select
      count(*)::integer,
      coalesce(jsonb_agg(revoked.id order by revoked.id), '[]'::jsonb)
    into v_revoked_count, v_revoked_ban_ids
    from revoked;

    if v_revoked_count = 0 then
      raise exception 'This player has no active bans';
    end if;

    v_result := jsonb_build_object(
      'ok', true,
      'action', 'unban',
      'target_user_id', p_target_user_id,
      'revoked_count', v_revoked_count,
      'revoked_ban_ids', v_revoked_ban_ids
    );
  exception when others then
    get stacked diagnostics
      v_error = message_text,
      v_sqlstate = returned_sqlstate;

    insert into public.admin_command_audit(
      actor_user_id,
      actor_email,
      target_user_id,
      action,
      command_text,
      request,
      result,
      succeeded,
      error_message,
      created_at
    ) values (
      v_actor,
      coalesce(v_actor_email, ''),
      p_target_user_id,
      'unban',
      nullif(left(coalesce(p_command_text, ''), 1000), ''),
      v_request,
      jsonb_build_object('sqlstate', v_sqlstate),
      false,
      left(v_error, 1000),
      now()
    );

    return jsonb_build_object(
      'ok', false,
      'action', 'unban',
      'target_user_id', p_target_user_id,
      'error', v_error
    );
  end;

  insert into public.admin_command_audit(
    actor_user_id,
    actor_email,
    target_user_id,
    action,
    command_text,
    request,
    result,
    succeeded,
    created_at
  ) values (
    v_actor,
    coalesce(v_actor_email, ''),
    p_target_user_id,
    'unban',
    nullif(left(coalesce(p_command_text, ''), 1000), ''),
    v_request,
    v_result,
    true,
    now()
  );

  return v_result;
end;
$$;

revoke all on function public.admin_unban_player(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.admin_unban_player(uuid, text, text)
  to authenticated;

comment on function public.admin_unban_player(uuid, text, text) is
  'Admin 03 Player Lookup and Commands: main-admin-only revocation of every active account, device, and leaderboard ban attached to one player.';
