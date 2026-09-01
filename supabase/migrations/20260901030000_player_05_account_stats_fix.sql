-- Player 05 Account Stats Fix: atomic, account-scoped gem and high-score saves.
-- The authenticated account is always taken from auth.uid(); the browser cannot
-- choose which player's row is updated.

create or replace function public.increment_player_gems()
returns bigint
language sql
security definer
set search_path = ''
as $$
  insert into public.player_stats (user_id, total_gems, high_score, updated_at)
  values ((select auth.uid()), 1, 0, now())
  on conflict (user_id) do update
    set total_gems = public.player_stats.total_gems + 1,
        updated_at = now()
  returning total_gems;
$$;

create or replace function public.save_player_high_score(new_score bigint)
returns bigint
language sql
security definer
set search_path = ''
as $$
  insert into public.player_stats (user_id, total_gems, high_score, updated_at)
  values ((select auth.uid()), 0, greatest(new_score, 0), now())
  on conflict (user_id) do update
    set high_score = greatest(public.player_stats.high_score, excluded.high_score),
        updated_at = now()
  returning high_score;
$$;

revoke all on function public.increment_player_gems() from public, anon;
revoke all on function public.save_player_high_score(bigint) from public, anon;
grant execute on function public.increment_player_gems() to authenticated;
grant execute on function public.save_player_high_score(bigint) to authenticated;
