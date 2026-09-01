-- Player 02 Reports: signed-in player issue submissions.
create table if not exists public.player_reports (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  report_type text not null check (report_type in ('Bug','Gameplay problem','Account problem','Suggestion','Other')),
  message text not null check (char_length(message) between 10 and 1500),
  status text not null default 'new' check (status in ('new','reviewing','resolved','closed')),
  created_at timestamptz not null default now()
);

create index if not exists player_reports_user_id_idx on public.player_reports(user_id);
create index if not exists player_reports_created_at_idx on public.player_reports(created_at desc);
alter table public.player_reports enable row level security;
revoke all on table public.player_reports from anon, authenticated;
grant insert on table public.player_reports to authenticated;

drop policy if exists "Players submit their own reports" on public.player_reports;
create policy "Players submit their own reports"
on public.player_reports for insert
to authenticated
with check ((select auth.uid()) = user_id);
