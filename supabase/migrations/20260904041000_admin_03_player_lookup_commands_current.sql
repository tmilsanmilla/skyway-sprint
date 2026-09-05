-- Admin 03 Player Lookup and Commands
-- Receipt-free player details, durable moderation record, and exact /unban RPC.

begin;

do $$
begin
  if to_regclass('public.admin_users') is null
     or to_regclass('public.admin_command_audit') is null
     or to_regclass('public.player_bans') is null
     or to_regclass('public.player_device_links') is null
     or to_regprocedure('public.is_admin()') is null
     or to_regprocedure('public.is_main_admin()') is null then
    raise exception 'Admin base setup is missing. Run Player 04 Security after the existing Admin 02 setup first.';
  end if;
end
$$;

create or replace function public.admin_get_player(p_user_id uuid)
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
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  if p_user_id is null or not exists (
    select 1 from auth.users users where users.id = p_user_id
  ) then
    raise exception 'Player not found' using errcode = 'P0002';
  end if;

  select jsonb_build_object(
    'account', jsonb_build_object(
      'user_id', users.id,
      'email', lower(users.email),
      'created_at', users.created_at,
      'last_sign_in_at', users.last_sign_in_at,
      'email_confirmed_at', users.email_confirmed_at,
      'admin_role', coalesce((
        select admin.role from public.admin_users admin
        where admin.user_id = users.id limit 1
      ), 'player'),
      'account_banned', app_private.has_active_ban(users.id, 'account', null),
      'leaderboard_banned', app_private.has_active_ban(users.id, 'leaderboard', null)
    ),
    'profile', jsonb_build_object(
      'username', profile.username,
      'username_changed_at', profile.username_changed_at,
      'created_at', profile.created_at
    ),
    'stats', jsonb_build_object(
      'total_gems', coalesce(stats.total_gems, 0),
      'high_score', coalesce(stats.high_score, 0),
      'updated_at', stats.updated_at
    ),
    'loadout', jsonb_build_object(
      'class_key', coalesce(loadout.class_key, 'runner'),
      'character_key', coalesce(loadout.character_key, 'runner_ace'),
      'player_cosmetic', loadout.player_cosmetic,
      'obstacle_cosmetic', loadout.obstacle_cosmetic,
      'environment_cosmetic', loadout.environment_cosmetic,
      'updated_at', loadout.updated_at
    ),
    'unlocks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'item_key', unlock.item_key,
        'display_name', coalesce(
          catalog.display_name,
          initcap(replace(unlock.item_key, '_', ' '))
        ),
        'item_type', unlock.item_type,
        'rarity', unlock.rarity,
        'character_class', catalog.character_class,
        'weapon_name', catalog.weapon_name,
        'weapon_score_bonus', catalog.weapon_score_bonus,
        'unlocked_at', unlock.unlocked_at
      ) order by unlock.item_type, unlock.unlocked_at, unlock.item_key)
      from public.player_unlocks unlock
      left join public.extraction_catalog catalog
        on catalog.item_key = unlock.item_key
      where unlock.user_id = users.id
    ), '[]'::jsonb),
    'devices', coalesce((
      select jsonb_agg(jsonb_build_object(
        'device_id', device.id,
        'token_hint', device.token_hint,
        'label', device.label,
        'first_seen_at', link.first_seen_at,
        'last_seen_at', link.last_seen_at,
        'device_banned', app_private.has_active_ban(
          users.id, 'device', device.id
        )
      ) order by link.last_seen_at desc, device.id)
      from public.player_device_links link
      join public.player_devices device on device.id = link.device_id
      where link.user_id = users.id
    ), '[]'::jsonb)
  ) into v_result
  from auth.users users
  left join public.player_profiles profile on profile.user_id = users.id
  left join public.player_stats stats on stats.user_id = users.id
  left join public.player_loadouts loadout on loadout.user_id = users.id
  where users.id = p_user_id;

  return v_result;
end;
$$;

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
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  if p_user_id is null or not exists (
    select 1 from auth.users users where users.id = p_user_id
  ) then
    raise exception 'Player not found' using errcode = 'P0002';
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
          select admin.role from public.admin_users admin
          where admin.user_id = ban.created_by limit 1
        ),
        'revoked_at', ban.revoked_at,
        'revoked_reason', ban.revoked_reason,
        'revoked_by_user_id', ban.revoked_by,
        'revoked_by_email', lower(revoked_actor.email),
        'revoked_by_username', revoked_profile.username,
        'revoked_by_role', (
          select admin.role from public.admin_users admin
          where admin.user_id = ban.revoked_by limit 1
        )
      ) order by ban.created_at desc, ban.id desc)
      from public.player_bans ban
      left join auth.users created_actor on created_actor.id = ban.created_by
      left join public.player_profiles created_profile
        on created_profile.user_id = ban.created_by
      left join auth.users revoked_actor on revoked_actor.id = ban.revoked_by
      left join public.player_profiles revoked_profile
        on revoked_profile.user_id = ban.revoked_by
      where ban.target_user_id = p_user_id
         or exists (
           select 1 from public.player_device_links link
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
          select admin.role from public.admin_users admin
          where admin.user_id = audit.actor_user_id limit 1
        )
      ) order by audit.created_at desc, audit.id desc)
      from public.admin_command_audit audit
      left join public.player_profiles actor_profile
        on actor_profile.user_id = audit.actor_user_id
      where audit.target_user_id = p_user_id
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

-- Recreate, rather than replace, so the exact named-argument surface is
-- guaranteed even if a stale live function used different parameter names.
drop function if exists public.admin_unban_player(uuid, text, text);

create function public.admin_unban_player(
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
    nullif(trim(p_reason), ''), 'Issued from admin player editor'
  );
  v_revoked_count integer := 0;
  v_revoked_ban_ids jsonb := '[]'::jsonb;
  v_result jsonb;
begin
  if not public.is_main_admin() then
    raise exception 'Only main admins can run player commands'
      using errcode = '42501';
  end if;
  if p_target_user_id is null or not exists (
    select 1 from auth.users users where users.id = p_target_user_id
  ) then
    raise exception 'Player not found' using errcode = 'P0002';
  end if;
  if char_length(v_reason) > 500 then
    raise exception 'Reason must be 500 characters or fewer'
      using errcode = '22023';
  end if;

  select lower(users.email)::text into v_actor_email
  from auth.users users where users.id = v_actor;

  with revoked as (
    update public.player_bans ban
    set revoked_at = now(), revoked_by = v_actor, revoked_reason = v_reason
    where ban.revoked_at is null
      and ban.starts_at <= now()
      and (ban.expires_at is null or ban.expires_at > now())
      and (
        ban.target_user_id = p_target_user_id
        or exists (
          select 1 from public.player_device_links link
          where link.user_id = p_target_user_id
            and link.device_id = ban.target_device_id
        )
      )
    returning ban.id
  )
  select count(*)::integer,
         coalesce(jsonb_agg(revoked.id order by revoked.id), '[]'::jsonb)
  into v_revoked_count, v_revoked_ban_ids
  from revoked;

  v_result := jsonb_build_object(
    'ok', true,
    'action', 'unban',
    'target_user_id', p_target_user_id,
    'revoked_count', v_revoked_count,
    'revoked_ban_ids', v_revoked_ban_ids
  );

  insert into public.admin_command_audit(
    actor_user_id, actor_email, target_user_id, action, command_text,
    request, result, succeeded, created_at
  ) values (
    v_actor, coalesce(v_actor_email, ''), p_target_user_id, 'unban',
    nullif(left(coalesce(p_command_text, ''), 1000), ''),
    jsonb_build_object(
      'target_user_id', p_target_user_id,
      'mode', 'all_active_bans_for_player',
      'reason', v_reason
    ),
    v_result, true, now()
  );

  return v_result;
end;
$$;

revoke all on function public.admin_get_player(uuid)
  from public, anon, authenticated;
revoke all on function public.admin_get_player_record(uuid)
  from public, anon, authenticated;
revoke all on function public.admin_unban_player(uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.admin_get_player(uuid) to authenticated;
grant execute on function public.admin_get_player_record(uuid) to authenticated;
grant execute on function public.admin_unban_player(uuid, text, text)
  to authenticated;

comment on function public.admin_get_player(uuid) is
  'Admin 03: role-checked account, inventory, stats, loadout, and device lookup. Shop receipts are intentionally excluded.';
comment on function public.admin_get_player_record(uuid) is
  'Admin 03: role-checked ban and command history for one player.';
comment on function public.admin_unban_player(uuid, text, text) is
  'Admin 03: main-admin-only idempotent revocation of all active bans attached to one player.';

notify pgrst, 'reload schema';

do $$
declare
  v_unban_oid oid := to_regprocedure(
    'public.admin_unban_player(uuid,text,text)'
  );
begin
  if v_unban_oid is null or not exists (
    select 1 from pg_proc procedure
    where procedure.oid = v_unban_oid
      and procedure.prosecdef
      and procedure.proargnames = array[
        'p_target_user_id', 'p_reason', 'p_command_text'
      ]::text[]
      and exists (
        select 1
        from unnest(coalesce(procedure.proconfig, array[]::text[])) setting
        where setting like 'search_path=%'
          and setting not like '%public%'
      )
  ) then
    raise exception 'admin_unban_player signature or security settings are incorrect';
  end if;

  if position(
    'extraction_transactions' in lower(
      pg_get_functiondef(to_regprocedure('public.admin_get_player(uuid)'))
    )
  ) > 0 then
    raise exception 'admin_get_player still exposes shop receipts';
  end if;
end
$$;

commit;

select
  to_regprocedure('public.admin_unban_player(uuid,text,text)') is not null
    as exact_unban_rpc_installed,
  has_function_privilege(
    'authenticated', 'public.admin_unban_player(uuid,text,text)', 'EXECUTE'
  ) as authenticated_can_call_unban,
  not has_function_privilege(
    'anon', 'public.admin_unban_player(uuid,text,text)', 'EXECUTE'
  ) as anonymous_cannot_call_unban,
  position(
    'extraction_transactions' in lower(
      pg_get_functiondef(to_regprocedure('public.admin_get_player(uuid)'))
    )
  ) = 0 as player_lookup_is_receipt_free;
