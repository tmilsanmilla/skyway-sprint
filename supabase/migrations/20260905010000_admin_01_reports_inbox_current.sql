-- Admin 01 Reports Inbox
--
-- Canonical, rerunnable report-inbox setup. This merges the original player
-- report table, the Admin 01 TODO, the later resolve-and-delete workflow, and
-- the current least-privilege report security into one saved-query body.
--
-- Prerequisite: run Player 04 Security after the Admin 02 setup first. Admin
-- authorization and account-ban checks intentionally stay centralized there.

begin;

do $$
begin
  if to_regprocedure('public.is_admin()') is null
     or to_regprocedure('app_private.block_account_banned_actor()') is null then
    raise exception 'Current admin security is missing. Run Player 04 Security first.';
  end if;
end
$$;

-- -------------------------------------------------------------------------
-- Signed-in player reports
-- -------------------------------------------------------------------------

create table if not exists public.player_reports (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  report_type text not null
    check (report_type in (
      'Bug', 'Gameplay problem', 'Account problem', 'Suggestion', 'Other'
    )),
  message text not null check (char_length(message) between 10 and 1500),
  status text not null default 'new'
    check (status in ('new', 'reviewing', 'resolved', 'closed')),
  created_at timestamptz not null default now()
);

comment on table public.player_reports is
  'Admin 01 inbox. Signed-in players submit reports; admins read them and resolve by deleting through a checked RPC.';

create index if not exists player_reports_user_id_idx
  on public.player_reports(user_id);
create index if not exists player_reports_created_at_idx
  on public.player_reports(created_at desc);
create index if not exists player_reports_status_created_at_idx
  on public.player_reports(status, created_at desc);

alter table public.player_reports enable row level security;

-- Remove every historical report policy, regardless of its old name. This
-- also removes the former direct admin UPDATE/archive path.
do $$
declare
  policy_row record;
begin
  for policy_row in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'player_reports'
  loop
    execute format(
      'drop policy %I on public.player_reports',
      policy_row.policyname
    );
  end loop;
end
$$;

revoke all on table public.player_reports
  from public, anon, authenticated;

-- Players may supply only the three report fields. The database owns id,
-- status, and created_at. SELECT is granted at table level but RLS restricts
-- rows to admins through the policy below.
grant select on table public.player_reports to authenticated;
grant insert(user_id, report_type, message)
  on table public.player_reports to authenticated;

create policy "Players submit their own reports"
  on public.player_reports
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Admins read reports"
  on public.player_reports
  for select
  to authenticated
  using ((select public.is_admin()));

do $$
begin
  if to_regclass('public.player_reports_id_seq') is not null then
    revoke all on sequence public.player_reports_id_seq
      from public, anon, authenticated;
    grant usage on sequence public.player_reports_id_seq to authenticated;
  end if;
end
$$;

drop trigger if exists block_banned_player_reports on public.player_reports;
create trigger block_banned_player_reports
before insert or update or delete on public.player_reports
for each row execute function app_private.block_account_banned_actor();

-- The archive was removed. Resolving a report permanently deletes that one
-- report after checking the caller's immutable admin identity.
create or replace function public.resolve_player_report(report_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not public.is_admin() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;

  delete from public.player_reports report
  where report.id = report_id;

  if not found then
    raise exception 'Report not found' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.resolve_player_report(bigint)
  from public, anon, authenticated;
grant execute on function public.resolve_player_report(bigint)
  to authenticated;

-- Clean up rows created by the retired resolved-report archive. Open and
-- reviewing reports are preserved.
delete from public.player_reports where status = 'resolved';

-- -------------------------------------------------------------------------
-- Admin 01 follow-up reminder (server-only)
-- -------------------------------------------------------------------------

create table if not exists public.admin_todos (
  id bigint generated always as identity primary key,
  title text not null,
  status text not null default 'todo'
    check (status in ('todo', 'doing', 'done')),
  created_at timestamptz not null default now()
);

comment on table public.admin_todos is
  'Server-only Admin 01 implementation reminders; never exposed directly to browser roles.';

alter table public.admin_todos enable row level security;

do $$
declare
  policy_row record;
begin
  for policy_row in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'admin_todos'
  loop
    execute format(
      'drop policy %I on public.admin_todos',
      policy_row.policyname
    );
  end loop;
end
$$;

revoke all on table public.admin_todos
  from public, anon, authenticated;

do $$
begin
  if to_regclass('public.admin_todos_id_seq') is not null then
    revoke all on sequence public.admin_todos_id_seq
      from public, anon, authenticated;
  end if;
end
$$;

insert into public.admin_todos(title, status)
select
  'TODO: Continue building the report inbox and resolution workflow',
  'todo'
where not exists (
  select 1
  from public.admin_todos todo
  where todo.title =
    'TODO: Continue building the report inbox and resolution workflow'
);

notify pgrst, 'reload schema';

-- Fail instead of committing a partially secured Admin 01 installation.
do $$
begin
  if has_table_privilege('anon', 'public.player_reports', 'SELECT')
     or has_table_privilege('anon', 'public.player_reports', 'INSERT')
     or has_table_privilege('authenticated', 'public.player_reports', 'UPDATE')
     or has_table_privilege('authenticated', 'public.player_reports', 'DELETE')
     or has_table_privilege('authenticated', 'public.admin_todos', 'SELECT')
     or has_function_privilege(
       'anon', 'public.resolve_player_report(bigint)', 'EXECUTE'
     ) then
    raise exception 'Admin 01 still has an unsafe browser privilege';
  end if;

  if not has_column_privilege(
       'authenticated', 'public.player_reports', 'user_id', 'INSERT'
     )
     or not has_column_privilege(
       'authenticated', 'public.player_reports', 'report_type', 'INSERT'
     )
     or not has_column_privilege(
       'authenticated', 'public.player_reports', 'message', 'INSERT'
     )
     or not has_function_privilege(
       'authenticated', 'public.resolve_player_report(bigint)', 'EXECUTE'
     ) then
    raise exception 'Admin 01 required player/admin access is missing';
  end if;
end
$$;

commit;

select
  to_regclass('public.player_reports') is not null
    as reports_table_installed,
  exists (
    select 1
    from public.admin_todos todo
    where todo.title =
      'TODO: Continue building the report inbox and resolution workflow'
  ) as admin_01_todo_present,
  not has_table_privilege(
    'authenticated', 'public.player_reports', 'UPDATE'
  ) and not has_table_privilege(
    'authenticated', 'public.player_reports', 'DELETE'
  ) as report_mutation_requires_rpc,
  has_function_privilege(
    'authenticated', 'public.resolve_player_report(bigint)', 'EXECUTE'
  ) as resolve_rpc_installed,
  not has_function_privilege(
    'anon', 'public.resolve_player_report(bigint)', 'EXECUTE'
  ) as anonymous_cannot_resolve,
  not has_table_privilege(
    'authenticated', 'public.admin_todos', 'SELECT'
  ) as admin_todo_is_server_only;
