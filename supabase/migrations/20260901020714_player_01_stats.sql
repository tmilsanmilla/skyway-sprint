-- Player 01 Stats: permanent signed-in gems and personal best.
create table if not exists public.player_stats (
  user_id uuid primary key references auth.users(id) on delete cascade,
  total_gems bigint not null default 0 check (total_gems >= 0),
  high_score bigint not null default 0 check (high_score >= 0),
  updated_at timestamptz not null default now()
);

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema='public' and table_name='player_stats' and column_name='total_coins')
     and not exists (select 1 from information_schema.columns where table_schema='public' and table_name='player_stats' and column_name='total_gems') then
    alter table public.player_stats rename column total_coins to total_gems;
  end if;
end $$;

alter table public.player_stats enable row level security;
revoke all on table public.player_stats from anon, authenticated;
grant select, insert, update on table public.player_stats to authenticated;

drop policy if exists "Players read their own stats" on public.player_stats;
create policy "Players read their own stats" on public.player_stats for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Players create their own stats" on public.player_stats;
create policy "Players create their own stats" on public.player_stats for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "Players update their own stats" on public.player_stats;
create policy "Players update their own stats" on public.player_stats for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
