-- Admin 02 Admins
--
-- Main admins manage the admin team through narrow SECURITY DEFINER RPCs.
-- The underlying tables remain inaccessible to client roles. Immutable Auth
-- user IDs are authoritative; email is retained as a display/legacy lookup
-- field and is synchronized when an admin changes their Auth email.

begin;

create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;

-- -------------------------------------------------------------------------
-- Canonical admin identities and server-only storage
-- -------------------------------------------------------------------------

alter table public.admin_users enable row level security;
revoke all on table public.admin_users from public, anon, authenticated;

-- Detect ambiguous legacy rows before changing either unique identity. A
-- collision needs deliberate operator review; silently merging admin roles is
-- never safe.
do $$
begin
  if exists (
    select 1
    from public.admin_users legacy
    join auth.users users
      on legacy.user_id is null
     and legacy.email = lower(users.email)
    join public.admin_users linked
      on linked.user_id = users.id
     and linked.email <> legacy.email
  ) then
    raise exception 'Admin identity collision: an Auth user has multiple admin rows';
  end if;

  if exists (
    select 1
    from public.admin_users admin
    join auth.users users on users.id = admin.user_id
    join public.admin_users collision
      on collision.email = lower(users.email)
     and collision.email <> admin.email
  ) then
    raise exception 'Admin identity collision: a current Auth email belongs to another admin row';
  end if;
end;
$$;

-- Link legacy email-only rows, then refresh the denormalized display email for
-- rows that already have an immutable Auth user ID.
update public.admin_users admin
set user_id = users.id
from auth.users users
where admin.user_id is null
  and users.email is not null
  and admin.email = lower(users.email);

update public.admin_users admin
set email = lower(users.email)
from auth.users users
where admin.user_id = users.id
  and users.email is not null
  and admin.email <> lower(users.email);

do $$
begin
  if not exists (
    select 1 from public.admin_users admin where admin.role = 'main'
  ) then
    raise exception 'At least one main admin is required before Admin 02 can be installed';
  end if;
end;
$$;

create or replace function app_private.sync_admin_user_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text;
begin
  v_email := lower(new.email);

  if v_email is null then
    if exists (
      select 1
      from public.admin_users admin
      where admin.user_id = new.id
    ) then
      raise exception 'Admin accounts must keep an email address'
        using errcode = '23514';
    end if;
    return new;
  end if;

  if tg_op = 'INSERT' then
    update public.admin_users admin
    set user_id = new.id
    where admin.user_id is null
      and admin.email = v_email;
  else
    -- Linked rows follow the current Auth email. The second update repairs the
    -- unlikely case where a legacy row existed before this trigger was added.
    update public.admin_users admin
    set email = v_email
    where admin.user_id = new.id
      and admin.email <> v_email;

    update public.admin_users admin
    set user_id = new.id,
        email = v_email
    where admin.user_id is null
      and admin.email = lower(old.email);
  end if;

  return new;
exception
  when unique_violation then
    raise exception 'Admin identity collision while synchronizing Auth user %', new.id
      using errcode = '23505';
end;
$$;

revoke all on function app_private.sync_admin_user_identity()
  from public, anon, authenticated;

drop trigger if exists sync_admin_identity_after_user_insert on auth.users;
create trigger sync_admin_identity_after_user_insert
after insert on auth.users
for each row execute function app_private.sync_admin_user_identity();

drop trigger if exists sync_admin_identity_after_email_change on auth.users;
create trigger sync_admin_identity_after_email_change
after update of email on auth.users
for each row
when (old.email is distinct from new.email)
execute function app_private.sync_admin_user_identity();

-- -------------------------------------------------------------------------
-- Durable role-change audit
-- -------------------------------------------------------------------------

create table if not exists public.admin_role_audit (
  id bigint generated always as identity primary key,
  actor_user_id uuid,
  actor_email text,
  target_user_id uuid,
  target_email text not null,
  action text not null
    check (action in ('add', 'promote', 'demote', 'remove')),
  old_role text
    check (old_role is null or old_role in ('main', 'co_admin')),
  new_role text
    check (new_role is null or new_role in ('main', 'co_admin')),
  created_at timestamptz not null default now()
);

comment on table public.admin_role_audit is
  'Admin 02 server-only audit of successful admin-team role changes. Identity snapshots remain after Auth account deletion.';

create index if not exists admin_role_audit_target_created_idx
  on public.admin_role_audit(target_user_id, created_at desc);
create index if not exists admin_role_audit_actor_created_idx
  on public.admin_role_audit(actor_user_id, created_at desc);

alter table public.admin_role_audit enable row level security;
revoke all on table public.admin_role_audit from public, anon, authenticated;
revoke all on sequence public.admin_role_audit_id_seq
  from public, anon, authenticated;

create or replace function app_private.audit_admin_role_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_email text;
  v_action text;
begin
  select lower(users.email)::text
  into v_actor_email
  from auth.users users
  where users.id = auth.uid();

  v_actor_email := coalesce(
    v_actor_email,
    nullif(lower(auth.jwt()->>'email'), '')
  );

  if tg_op = 'INSERT' then
    v_action := 'add';
    insert into public.admin_role_audit(
      actor_user_id, actor_email, target_user_id, target_email,
      action, old_role, new_role, created_at
    ) values (
      auth.uid(), v_actor_email, new.user_id, new.email,
      v_action, null, new.role, now()
    );
    return new;
  end if;

  if tg_op = 'UPDATE' then
    v_action := case
      when old.role = 'co_admin' and new.role = 'main' then 'promote'
      else 'demote'
    end;
    insert into public.admin_role_audit(
      actor_user_id, actor_email, target_user_id, target_email,
      action, old_role, new_role, created_at
    ) values (
      auth.uid(), v_actor_email, new.user_id, new.email,
      v_action, old.role, new.role, now()
    );
    return new;
  end if;

  insert into public.admin_role_audit(
    actor_user_id, actor_email, target_user_id, target_email,
    action, old_role, new_role, created_at
  ) values (
    auth.uid(), v_actor_email, old.user_id, old.email,
    'remove', old.role, null, now()
  );
  return old;
end;
$$;

revoke all on function app_private.audit_admin_role_change()
  from public, anon, authenticated;

drop trigger if exists audit_admin_role_insert on public.admin_users;
create trigger audit_admin_role_insert
after insert on public.admin_users
for each row execute function app_private.audit_admin_role_change();

drop trigger if exists audit_admin_role_update on public.admin_users;
create trigger audit_admin_role_update
after update of role on public.admin_users
for each row
when (old.role is distinct from new.role)
execute function app_private.audit_admin_role_change();

drop trigger if exists audit_admin_role_delete on public.admin_users;
create trigger audit_admin_role_delete
after delete on public.admin_users
for each row execute function app_private.audit_admin_role_change();

-- -------------------------------------------------------------------------
-- Serialized cross-table security invariants
-- -------------------------------------------------------------------------

-- Updating one private mutex row serializes every security-state check. At
-- READ COMMITTED a waiter continues with the newest committed state; at
-- REPEATABLE READ/SERIALIZABLE a stale writer receives PostgreSQL's normal
-- serialization failure instead of committing an invariant violation.
create table if not exists app_private.admin_security_mutex (
  singleton boolean primary key default true check (singleton),
  revision bigint not null default 0
);

insert into app_private.admin_security_mutex(singleton, revision)
values (true, 0)
on conflict (singleton) do nothing;

alter table app_private.admin_security_mutex enable row level security;
revoke all on table app_private.admin_security_mutex
  from public, anon, authenticated;

create or replace function app_private.lock_admin_security_state()
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
begin
  update app_private.admin_security_mutex mutex
  set revision = mutex.revision + 1
  where mutex.singleton;

  if not found then
    raise exception 'Admin security mutex is not initialized'
      using errcode = '55000';
  end if;
end;
$$;

revoke all on function app_private.lock_admin_security_state()
  from public, anon, authenticated;

-- Admin-role grants and unexpired account bans are mutually exclusive. Both
-- sides lock the private mutex before checking the other table, so a
-- concurrent grant/ban pair cannot both pass an absence check. The trigger
-- protections also cover trusted service-role writes that bypass the public
-- RPCs and RLS.
create or replace function app_private.guard_admin_account_ban()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old_user_id uuid;
  v_new_user_id uuid;
  v_is_grant boolean;
begin
  perform app_private.lock_admin_security_state();

  v_new_user_id := new.user_id;
  if v_new_user_id is null then
    select users.id
    into v_new_user_id
    from auth.users users
    where users.email is not null
      and lower(users.email) = lower(new.email)
    order by users.id
    limit 1;
  end if;

  if tg_op = 'INSERT' then
    v_is_grant := true;
  else
    v_old_user_id := old.user_id;
    if v_old_user_id is null then
      select users.id
      into v_old_user_id
      from auth.users users
      where users.email is not null
        and lower(users.email) = lower(old.email)
      order by users.id
      limit 1;
    end if;

    v_is_grant := v_new_user_id is distinct from v_old_user_id
      or (old.role = 'co_admin' and new.role = 'main');
  end if;

  if v_is_grant
     and v_new_user_id is not null
     and exists (
       select 1
       from public.player_bans ban
       where ban.scope = 'account'
         and ban.target_user_id = v_new_user_id
         and ban.revoked_at is null
         and (ban.expires_at is null or ban.expires_at > now())
     ) then
    raise exception 'Remove the unexpired account ban before granting admin access'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function app_private.guard_admin_account_ban()
  from public, anon, authenticated;

drop trigger if exists guard_admin_account_ban_write on public.admin_users;
create trigger guard_admin_account_ban_write
before insert or update of email, user_id, role on public.admin_users
for each row execute function app_private.guard_admin_account_ban();

create or replace function app_private.guard_account_ban_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.scope <> 'account'
     or new.target_user_id is null
     or new.revoked_at is not null
     or (new.expires_at is not null and new.expires_at <= now()) then
    return new;
  end if;

  perform app_private.lock_admin_security_state();

  if exists (
    select 1
    from public.admin_users admin
    left join auth.users users on users.id = new.target_user_id
    where admin.user_id = new.target_user_id
       or (
         admin.user_id is null
         and users.email is not null
         and admin.email = lower(users.email)
       )
  ) then
    raise exception 'Remove this player from the admin team before banning them'
      using errcode = '23514';
  end if;

  return new;
end;
$$;

revoke all on function app_private.guard_account_ban_admin()
  from public, anon, authenticated;

drop trigger if exists guard_account_ban_admin_write on public.player_bans;
create trigger guard_account_ban_admin_write
before insert or update of
  scope, target_user_id, starts_at, expires_at, revoked_at
on public.player_bans
for each row execute function app_private.guard_account_ban_admin();

-- Every operation that can reduce the main-admin count locks the same mutex as
-- promotions/inserts above. This makes the final-main check safe even for two
-- concurrent direct writes or two concurrent Auth cascade deletes.

create or replace function app_private.guard_last_main_admin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.role <> 'main' then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' and new.role = 'main' then
    return new;
  end if;

  perform app_private.lock_admin_security_state();

  if not exists (
    select 1
    from public.admin_users admin
    where admin.role = 'main'
      and admin.email <> old.email
  ) then
    raise exception 'The last main admin cannot be demoted or removed. Promote a replacement first.'
      using errcode = '23514';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function app_private.guard_last_main_admin()
  from public, anon, authenticated;

drop trigger if exists guard_last_main_admin_update on public.admin_users;
create trigger guard_last_main_admin_update
before update of role on public.admin_users
for each row
when (old.role is distinct from new.role)
execute function app_private.guard_last_main_admin();

drop trigger if exists guard_last_main_admin_delete on public.admin_users;
create trigger guard_last_main_admin_delete
before delete on public.admin_users
for each row execute function app_private.guard_last_main_admin();

-- -------------------------------------------------------------------------
-- Stable client RPC surface
-- -------------------------------------------------------------------------

create or replace function public.list_admins()
returns table(user_id uuid, email text, username text, role text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;

  return query
  select
    users.id,
    lower(users.email)::text,
    profile.username::text,
    admin.role
  from public.admin_users admin
  join auth.users users
    on (admin.user_id is not null and users.id = admin.user_id)
    or (
      admin.user_id is null
      and users.email is not null
      and lower(users.email) = admin.email
    )
  left join public.player_profiles profile on profile.user_id = users.id
  order by
    case when admin.role = 'main' then 0 else 1 end,
    lower(users.email);
end;
$$;

create or replace function public.manage_admin(target text, admin_action text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := auth.uid();
  v_target text := lower(trim(coalesce(target, '')));
  v_action text := lower(trim(coalesce(admin_action, '')));
  v_target_id uuid;
  v_target_email text;
  v_existing_email text;
  v_existing_role text;
  v_has_admin boolean := false;
  v_main_count bigint;
begin
  if not public.is_main_admin() then
    raise exception 'Only main admins can manage admins' using errcode = '42501';
  end if;

  if v_action = 'kick' then
    v_action := 'remove';
  end if;
  if v_action not in ('add', 'promote', 'demote', 'remove') then
    raise exception 'Admin action must be add, promote, demote, or remove'
      using errcode = '22023';
  end if;
  if v_target = '' then
    raise exception 'Enter an email or username' using errcode = '22023';
  end if;

  -- Only one main-admin role mutation may proceed at a time. Rechecking after
  -- the lock prevents an actor who was demoted while waiting from continuing.
  lock table public.admin_users in share row exclusive mode;

  -- Serialize this grant path with account-ban creation. The write triggers
  -- below recheck the invariant as defense in depth for every caller.
  perform app_private.lock_admin_security_state();

  if not public.is_main_admin() then
    raise exception 'Only main admins can manage admins' using errcode = '42501';
  end if;

  select users.id, lower(users.email)::text
  into v_target_id, v_target_email
  from auth.users users
  left join public.player_profiles profile on profile.user_id = users.id
  where users.email is not null
    and (
      lower(users.email) = v_target
      or lower(profile.username) = v_target
    )
  order by case when lower(users.email) = v_target then 0 else 1 end
  limit 1;

  if v_target_id is null or v_target_email is null then
    raise exception 'No player found with that email or username';
  end if;

  select admin.email, admin.role
  into v_existing_email, v_existing_role
  from public.admin_users admin
  where admin.user_id = v_target_id
     or (
       admin.user_id is null
       and admin.email = v_target_email
     )
  order by (admin.user_id = v_target_id) desc nulls last
  limit 1
  for update;

  v_has_admin := found;

  if exists (
    select 1
    from public.admin_users collision
    where collision.email = v_target_email
      and (
        not v_has_admin
        or collision.email <> v_existing_email
      )
  ) then
    raise exception 'Admin identity conflict for that Auth email';
  end if;

  if v_actor_id = v_target_id and v_action in ('demote', 'remove') then
    raise exception 'You cannot remove or demote yourself';
  end if;

  if v_action in ('add', 'promote')
     and exists (
       select 1
       from public.player_bans ban
       where ban.scope = 'account'
         and ban.target_user_id = v_target_id
         and ban.revoked_at is null
         and (ban.expires_at is null or ban.expires_at > now())
     ) then
    raise exception 'Remove the unexpired account ban before granting admin access';
  end if;

  if v_action = 'add' then
    if v_has_admin then
      raise exception 'That player is already an admin';
    end if;

    insert into public.admin_users(email, user_id, role)
    values (v_target_email, v_target_id, 'co_admin');
    return;
  end if;

  if not v_has_admin then
    raise exception 'Add this player as a co-admin first';
  end if;

  if v_action = 'promote' then
    if v_existing_role = 'main' then
      raise exception 'That player is already a main admin';
    end if;

    update public.admin_users admin
    set email = v_target_email,
        user_id = v_target_id,
        role = 'main'
    where admin.email = v_existing_email;
    return;
  end if;

  if v_action = 'demote' then
    if v_existing_role <> 'main' then
      raise exception 'That player is already a co-admin';
    end if;

    select count(*)
    into v_main_count
    from public.admin_users admin
    where admin.role = 'main';

    if v_main_count <= 1 then
      raise exception 'The last main admin cannot be demoted. Promote a replacement first.';
    end if;

    update public.admin_users admin
    set email = v_target_email,
        user_id = v_target_id,
        role = 'co_admin'
    where admin.email = v_existing_email;
    return;
  end if;

  if v_existing_role = 'main' then
    raise exception 'Demote this main admin before removing them';
  end if;

  delete from public.admin_users admin
  where admin.email = v_existing_email;
end;
$$;

comment on table public.admin_users is
  'Admin 02 role registry. Direct client access is denied; use role-checked RPCs.';
comment on function public.list_admins() is
  'Admin 02: lists the current main-admin and co-admin team for authenticated admins.';
comment on function public.manage_admin(text, text) is
  'Admin 02: main-admin-only add, promote, demote, and remove operations. Accepts email or username.';

revoke all on function public.list_admins() from public, anon;
revoke all on function public.manage_admin(text, text) from public, anon;
grant execute on function public.list_admins() to authenticated;
grant execute on function public.manage_admin(text, text) to authenticated;

notify pgrst, 'reload schema';

commit;
