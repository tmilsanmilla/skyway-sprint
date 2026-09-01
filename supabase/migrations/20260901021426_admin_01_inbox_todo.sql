-- Admin 01 Inbox TODO: persistent reminder that the admin workflow needs continued work.
create table if not exists public.admin_todos (
  id bigint generated always as identity primary key,
  title text not null,
  status text not null default 'todo' check (status in ('todo','doing','done')),
  created_at timestamptz not null default now()
);
alter table public.admin_todos enable row level security;
revoke all on table public.admin_todos from anon, authenticated;
grant select, update on table public.admin_todos to authenticated;
drop policy if exists "Admins manage todos" on public.admin_todos;
create policy "Admins manage todos" on public.admin_todos for all to authenticated using ((select public.is_admin())) with check ((select public.is_admin()));
insert into public.admin_todos(title, status)
select 'TODO: Continue building the report inbox and resolution workflow', 'todo'
where not exists (select 1 from public.admin_todos where title='TODO: Continue building the report inbox and resolution workflow');
