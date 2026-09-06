-- Admin 04 Appeals and Bans
-- Secure, rerunnable appeal workflow for account, device, and leaderboard bans.
-- Players may keep one pending appeal at a time. Main admins and co-admins may
-- view the inbox, but only main admins may decide an appeal. Approval revokes
-- only the bans snapshotted when the player submitted it, so a later ban can
-- never be removed accidentally.

begin;

do $$
begin
  if to_regclass('public.admin_users') is null
     or to_regclass('public.player_bans') is null
     or to_regclass('public.player_device_links') is null
     or to_regclass('public.admin_command_audit') is null
     or to_regprocedure('public.is_admin()') is null
     or to_regprocedure('public.is_main_admin()') is null then
    raise exception
      'Admin 02 and the merged Admin 03 setup must be installed before Admin 04.';
  end if;
end
$$;

create table if not exists public.player_ban_appeals (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  ban_id bigint references public.player_bans(id) on delete set null,
  appealed_ban_ids bigint[] not null default '{}'::bigint[],
  player_note text not null,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'denied')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users(id) on delete set null,
  admin_note text,
  constraint player_ban_appeals_player_note_check
    check (char_length(player_note) between 10 and 1500),
  constraint player_ban_appeals_admin_note_check
    check (admin_note is null or char_length(admin_note) between 1 and 500),
  constraint player_ban_appeals_pending_snapshot_check
    check (status <> 'pending' or cardinality(appealed_ban_ids) > 0),
  constraint player_ban_appeals_review_check check (
    (status = 'pending'
      and reviewed_at is null
      and reviewed_by is null
      and admin_note is null)
    or
    (status in ('approved', 'denied')
      and reviewed_at is not null
      and reviewed_by is not null)
  )
);

-- Compatibility with the first Admin 04 draft if it was installed before
-- this hardened version. A legacy appeal can safely reference only its
-- original ban: we never guess that later bans belonged to its old snapshot.
alter table public.player_ban_appeals
  add column if not exists appealed_ban_ids bigint[];

update public.player_ban_appeals appeal
set appealed_ban_ids = case
  when appeal.ban_id is null then '{}'::bigint[]
  else array[appeal.ban_id]::bigint[]
end
where appeal.appealed_ban_ids is null;

alter table public.player_ban_appeals
  alter column appealed_ban_ids set default '{}'::bigint[],
  alter column appealed_ban_ids set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint constraint_row
    where constraint_row.conrelid = 'public.player_ban_appeals'::regclass
      and constraint_row.conname = 'player_ban_appeals_pending_snapshot_check'
  ) then
    -- NOT VALID preserves a malformed legacy row for manual review while
    -- still requiring every new or changed pending appeal to have a snapshot.
    alter table public.player_ban_appeals
      add constraint player_ban_appeals_pending_snapshot_check
      check (status <> 'pending' or cardinality(appealed_ban_ids) > 0)
      not valid;
  end if;
end
$$;

create unique index if not exists player_ban_appeals_one_pending_idx
  on public.player_ban_appeals(user_id)
  where status = 'pending';

create unique index if not exists player_ban_appeals_one_per_ban_idx
  on public.player_ban_appeals(user_id, ban_id)
  where ban_id is not null;

create index if not exists player_ban_appeals_status_created_idx
  on public.player_ban_appeals(status, created_at desc);

alter table public.player_ban_appeals enable row level security;
revoke all on table public.player_ban_appeals
  from public, anon, authenticated;
revoke all on sequence public.player_ban_appeals_id_seq
  from public, anon, authenticated;

-- There are intentionally no direct table policies. All access crosses a
-- narrow SECURITY DEFINER endpoint with an immutable Auth-user check.

drop function if exists public.get_my_ban_appeal();

create function public.get_my_ban_appeal()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_has_active_ban boolean;
  v_can_appeal boolean;
  v_appeal jsonb;
begin
  if v_user_id is null then
    raise exception 'Sign in required' using errcode = '42501';
  end if;

  select exists (
    select 1
    from public.player_bans ban
    where ban.starts_at <= now()
      and ban.revoked_at is null
      and (ban.expires_at is null or ban.expires_at > now())
      and (
        ban.target_user_id = v_user_id
        or exists (
          select 1
          from public.player_device_links link
          where link.user_id = v_user_id
            and link.device_id = ban.target_device_id
        )
      )
  ) into v_has_active_ban;

  select not exists (
    select 1
    from public.player_ban_appeals appeal
    where appeal.user_id = v_user_id
      and appeal.status = 'pending'
  ) and exists (
    select 1
    from public.player_bans ban
    where ban.starts_at <= now()
      and ban.revoked_at is null
      and (ban.expires_at is null or ban.expires_at > now())
      and (
        ban.target_user_id = v_user_id
        or exists (
          select 1
          from public.player_device_links link
          where link.user_id = v_user_id
            and link.device_id = ban.target_device_id
        )
      )
      and not exists (
        select 1
        from public.player_ban_appeals prior
        where prior.user_id = v_user_id
          and ban.id = any(prior.appealed_ban_ids)
      )
  ) into v_can_appeal;

  select jsonb_build_object(
    'id', appeal.id,
    'ban_id', appeal.ban_id,
    'appealed_ban_count', cardinality(appeal.appealed_ban_ids),
    'player_note', appeal.player_note,
    'status', appeal.status,
    'created_at', appeal.created_at,
    'reviewed_at', appeal.reviewed_at,
    'admin_note', appeal.admin_note
  )
  into v_appeal
  from public.player_ban_appeals appeal
  where appeal.user_id = v_user_id
  order by (appeal.status = 'pending') desc, appeal.created_at desc
  limit 1;

  return jsonb_build_object(
    'has_active_ban', v_has_active_ban,
    'can_appeal', v_can_appeal,
    'appeal', v_appeal
  );
end;
$$;

drop function if exists public.submit_ban_appeal(text);

create function public.submit_ban_appeal(p_note text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_note text := trim(coalesce(p_note, ''));
  v_ban_id bigint;
  v_ban_ids bigint[];
  v_appeal public.player_ban_appeals%rowtype;
begin
  if v_user_id is null then
    raise exception 'Sign in required' using errcode = '42501';
  end if;
  if char_length(v_note) < 10 or char_length(v_note) > 1500 then
    raise exception 'Appeal note must be between 10 and 1500 characters'
      using errcode = '22023';
  end if;
  if exists (
    select 1
    from public.player_ban_appeals appeal
    where appeal.user_id = v_user_id
      and appeal.status = 'pending'
  ) then
    raise exception 'You already have a pending appeal';
  end if;

  select ban.id
  into v_ban_id
  from public.player_bans ban
  where ban.starts_at <= now()
    and ban.revoked_at is null
    and (ban.expires_at is null or ban.expires_at > now())
    and (
      ban.target_user_id = v_user_id
      or exists (
        select 1
        from public.player_device_links link
        where link.user_id = v_user_id
          and link.device_id = ban.target_device_id
      )
    )
    and not exists (
      select 1
      from public.player_ban_appeals prior
      where prior.user_id = v_user_id
        and ban.id = any(prior.appealed_ban_ids)
    )
  order by
    case ban.scope
      when 'account' then 0
      when 'device' then 1
      else 2
    end,
    ban.created_at desc
  limit 1;

  if v_ban_id is null then
    if exists (
      select 1
      from public.player_bans ban
      where ban.starts_at <= now()
        and ban.revoked_at is null
        and (ban.expires_at is null or ban.expires_at > now())
        and (
          ban.target_user_id = v_user_id
          or exists (
            select 1
            from public.player_device_links link
            where link.user_id = v_user_id
              and link.device_id = ban.target_device_id
          )
        )
    ) then
      raise exception 'An appeal has already been submitted for this active ban';
    end if;
    raise exception 'There is no active ban to appeal';
  end if;

  -- Freeze the complete set now. The resolution RPC uses this array rather
  -- than searching by player, which protects bans created after submission.
  select array_agg(ban.id order by ban.id)
  into v_ban_ids
  from public.player_bans ban
  where ban.starts_at <= now()
    and ban.revoked_at is null
    and (ban.expires_at is null or ban.expires_at > now())
    and (
      ban.target_user_id = v_user_id
      or exists (
        select 1
        from public.player_device_links link
        where link.user_id = v_user_id
          and link.device_id = ban.target_device_id
      )
    );

  if coalesce(cardinality(v_ban_ids), 0) = 0 then
    raise exception 'There is no active ban to appeal';
  end if;

  insert into public.player_ban_appeals(
    user_id, ban_id, appealed_ban_ids, player_note
  )
  values (v_user_id, v_ban_id, v_ban_ids, v_note)
  returning * into v_appeal;

  return jsonb_build_object(
    'ok', true,
    'id', v_appeal.id,
    'status', v_appeal.status,
    'created_at', v_appeal.created_at
  );
exception
  when unique_violation then
    raise exception 'You already have a pending appeal';
end;
$$;

drop function if exists public.get_admin_ban_appeals(text);

create function public.get_admin_ban_appeals(p_status text default 'pending')
returns table(
  id bigint,
  user_id uuid,
  username text,
  email text,
  ban_id bigint,
  ban_scope text,
  ban_note text,
  player_note text,
  status text,
  created_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by_username text,
  reviewed_by_email text,
  admin_note text,
  appealed_ban_count integer,
  snapshot_active_ban_count bigint,
  active_ban_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_status text := lower(trim(coalesce(p_status, 'pending')));
begin
  if not public.is_admin() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;
  if v_status not in ('pending', 'approved', 'denied', 'all') then
    raise exception 'Appeal status must be pending, approved, denied, or all'
      using errcode = '22023';
  end if;

  return query
  select
    appeal.id,
    appeal.user_id,
    profile.username::text,
    lower(users.email)::text,
    appeal.ban_id,
    original_ban.scope::text,
    original_ban.reason::text,
    appeal.player_note::text,
    appeal.status::text,
    appeal.created_at,
    appeal.reviewed_at,
    reviewer_profile.username::text,
    lower(reviewer.email)::text,
    appeal.admin_note::text,
    cardinality(appeal.appealed_ban_ids),
    (
      select count(*)
      from public.player_bans snapshotted_ban
      where snapshotted_ban.id = any(appeal.appealed_ban_ids)
        and snapshotted_ban.starts_at <= now()
        and snapshotted_ban.revoked_at is null
        and (
          snapshotted_ban.expires_at is null
          or snapshotted_ban.expires_at > now()
        )
    )::bigint,
    (
      select count(*)
      from public.player_bans active_ban
      where active_ban.starts_at <= now()
        and active_ban.revoked_at is null
        and (active_ban.expires_at is null or active_ban.expires_at > now())
        and (
          active_ban.target_user_id = appeal.user_id
          or exists (
            select 1
            from public.player_device_links link
            where link.user_id = appeal.user_id
              and link.device_id = active_ban.target_device_id
          )
        )
    )::bigint
  from public.player_ban_appeals appeal
  join auth.users users on users.id = appeal.user_id
  left join public.player_profiles profile on profile.user_id = appeal.user_id
  left join public.player_bans original_ban on original_ban.id = appeal.ban_id
  left join auth.users reviewer on reviewer.id = appeal.reviewed_by
  left join public.player_profiles reviewer_profile
    on reviewer_profile.user_id = appeal.reviewed_by
  where v_status = 'all' or appeal.status = v_status
  order by
    case when appeal.status = 'pending' then 0 else 1 end,
    appeal.created_at desc;
end;
$$;

drop function if exists public.resolve_ban_appeal(bigint, text, text);

create function public.resolve_ban_appeal(
  p_appeal_id bigint,
  p_action text,
  p_admin_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_actor_email text;
  v_action text := lower(trim(coalesce(p_action, '')));
  v_admin_note text := nullif(trim(coalesce(p_admin_note, '')), '');
  v_appeal public.player_ban_appeals%rowtype;
  v_revoked_count integer := 0;
  v_result jsonb;
begin
  if not public.is_main_admin() then
    raise exception 'Only main admins can resolve appeals'
      using errcode = '42501';
  end if;
  if v_action not in ('approve', 'deny') then
    raise exception 'Appeal action must be approve or deny'
      using errcode = '22023';
  end if;
  if v_admin_note is not null and char_length(v_admin_note) > 500 then
    raise exception 'Admin note must be 500 characters or fewer'
      using errcode = '22023';
  end if;

  select appeal.*
  into v_appeal
  from public.player_ban_appeals appeal
  where appeal.id = p_appeal_id
  for update;

  if not found then
    raise exception 'Appeal not found' using errcode = 'P0002';
  end if;
  if v_appeal.status <> 'pending' then
    raise exception 'That appeal has already been reviewed';
  end if;
  if v_action = 'approve'
     and coalesce(cardinality(v_appeal.appealed_ban_ids), 0) = 0 then
    raise exception
      'This legacy appeal has no safe ban snapshot and cannot auto-unban';
  end if;

  if v_action = 'approve' then
    with revoked as (
      update public.player_bans ban
      set revoked_at = now(),
          revoked_by = v_actor,
          revoked_reason = left(
            case
              when v_admin_note is null then 'Appeal approved'
              else 'Appeal approved: ' || v_admin_note
            end,
            500
          )
      where ban.starts_at <= now()
        and ban.revoked_at is null
        and (ban.expires_at is null or ban.expires_at > now())
        and ban.id = any(v_appeal.appealed_ban_ids)
        and (
          ban.target_user_id = v_appeal.user_id
          or exists (
            select 1
            from public.player_device_links link
            where link.user_id = v_appeal.user_id
              and link.device_id = ban.target_device_id
          )
        )
      returning ban.id
    )
    select count(*)::integer into v_revoked_count from revoked;

    update public.player_ban_appeals appeal
    set status = 'approved',
        reviewed_at = now(),
        reviewed_by = v_actor,
        admin_note = v_admin_note
    where appeal.id = v_appeal.id;
  else
    update public.player_ban_appeals appeal
    set status = 'denied',
        reviewed_at = now(),
        reviewed_by = v_actor,
        admin_note = v_admin_note
    where appeal.id = v_appeal.id;
  end if;

  select lower(users.email) into v_actor_email
  from auth.users users where users.id = v_actor;

  v_result := jsonb_build_object(
    'ok', true,
    'appeal_id', v_appeal.id,
    'status', case when v_action = 'approve' then 'approved' else 'denied' end,
    'target_user_id', v_appeal.user_id,
    'revoked_count', v_revoked_count
  );

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
    v_appeal.user_id,
    case when v_action = 'approve' then 'appeal_approve_unban' else 'appeal_deny' end,
    null,
    jsonb_build_object(
      'appeal_id', v_appeal.id,
      'admin_note', v_admin_note
    ),
    v_result,
    true,
    now()
  );

  return v_result;
end;
$$;

revoke all on function public.get_my_ban_appeal()
  from public, anon, authenticated;
revoke all on function public.submit_ban_appeal(text)
  from public, anon, authenticated;
revoke all on function public.get_admin_ban_appeals(text)
  from public, anon, authenticated;
revoke all on function public.resolve_ban_appeal(bigint, text, text)
  from public, anon, authenticated;

grant execute on function public.get_my_ban_appeal() to authenticated;
grant execute on function public.submit_ban_appeal(text) to authenticated;
grant execute on function public.get_admin_ban_appeals(text) to authenticated;
grant execute on function public.resolve_ban_appeal(bigint, text, text)
  to authenticated;

comment on table public.player_ban_appeals is
  'Admin 04 server-only ban appeals. Direct client table access is denied.';
comment on function public.get_my_ban_appeal() is
  'Admin 04: returns only the signed-in player''s latest appeal and active-ban state.';
comment on function public.submit_ban_appeal(text) is
  'Admin 04: creates one pending appeal for the signed-in banned player.';
comment on function public.get_admin_ban_appeals(text) is
  'Admin 04: admin-only appeal inbox. Accepts pending, approved, denied, or all.';
comment on function public.resolve_ban_appeal(bigint, text, text) is
  'Admin 04: main-admin-only appeal review. Approval revokes only the ban-ID snapshot captured at submission.';

notify pgrst, 'reload schema';

do $$
declare
  v_signature text;
  v_oid oid;
begin
  foreach v_signature in array array[
    'public.get_my_ban_appeal()',
    'public.submit_ban_appeal(text)',
    'public.get_admin_ban_appeals(text)',
    'public.resolve_ban_appeal(bigint,text,text)'
  ]
  loop
    v_oid := to_regprocedure(v_signature);
    if v_oid is null or not exists (
      select 1
      from pg_proc procedure
      where procedure.oid = v_oid
        and procedure.prosecdef
        and exists (
          select 1
          from unnest(coalesce(procedure.proconfig, array[]::text[])) setting
          where setting like 'search_path=%'
            and setting not like '%public%'
        )
    ) then
      raise exception 'Missing or unsafe Admin 04 function: %', v_signature;
    end if;
  end loop;

  if has_table_privilege(
       'authenticated', 'public.player_ban_appeals', 'SELECT'
     )
     or has_table_privilege(
       'authenticated', 'public.player_ban_appeals', 'INSERT'
     )
     or has_table_privilege(
       'authenticated', 'public.player_ban_appeals', 'UPDATE'
     ) then
    raise exception 'Authenticated clients have direct appeal-table access';
  end if;

  if not exists (
    select 1
    from pg_attribute attribute
    where attribute.attrelid = 'public.player_ban_appeals'::regclass
      and attribute.attname = 'appealed_ban_ids'
      and attribute.attnotnull
      and not attribute.attisdropped
  ) or not exists (
    select 1
    from pg_constraint constraint_row
    where constraint_row.conrelid = 'public.player_ban_appeals'::regclass
      and constraint_row.conname = 'player_ban_appeals_pending_snapshot_check'
  ) then
    raise exception 'The Admin 04 ban snapshot is not safely constrained';
  end if;

  if position(
       'array_agg(ban.id' in lower(pg_get_functiondef(
         to_regprocedure('public.submit_ban_appeal(text)')
       ))
     ) = 0
     or position(
       'appealed_ban_ids' in lower(pg_get_functiondef(
         to_regprocedure('public.resolve_ban_appeal(bigint,text,text)')
       ))
     ) = 0
     or position(
       'is_main_admin' in lower(pg_get_functiondef(
         to_regprocedure('public.resolve_ban_appeal(bigint,text,text)')
       ))
     ) = 0 then
    raise exception 'Admin 04 snapshot or main-admin guard is missing';
  end if;

  if has_function_privilege(
       'anon', 'public.submit_ban_appeal(text)', 'EXECUTE'
     )
     or has_function_privilege(
       'anon', 'public.get_admin_ban_appeals(text)', 'EXECUTE'
     )
     or has_function_privilege(
       'anon', 'public.resolve_ban_appeal(bigint,text,text)', 'EXECUTE'
     ) then
    raise exception 'Anonymous clients can execute an Admin 04 endpoint';
  end if;
end
$$;

commit;

select
  to_regclass('public.player_ban_appeals') is not null
    as appeal_table_installed,
  to_regprocedure('public.submit_ban_appeal(text)') is not null
    as player_appeal_rpc_installed,
  to_regprocedure('public.get_admin_ban_appeals(text)') is not null
    as admin_appeal_inbox_installed,
  to_regprocedure('public.resolve_ban_appeal(bigint,text,text)') is not null
    as appeal_resolution_installed,
  not has_table_privilege(
    'authenticated', 'public.player_ban_appeals', 'SELECT'
  ) as direct_appeal_reads_blocked,
  not has_function_privilege(
    'anon', 'public.submit_ban_appeal(text)', 'EXECUTE'
  ) as anonymous_appeals_blocked,
  exists (
    select 1
    from pg_attribute attribute
    where attribute.attrelid = 'public.player_ban_appeals'::regclass
      and attribute.attname = 'appealed_ban_ids'
      and attribute.attnotnull
      and not attribute.attisdropped
  ) as ban_snapshot_installed,
  position(
    'is_main_admin' in lower(pg_get_functiondef(
      to_regprocedure('public.resolve_ban_appeal(bigint,text,text)')
    ))
  ) > 0 as main_admin_resolution_required;
