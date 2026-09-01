-- Leaderboard 1: public top scores and secure gem spending for powerups.
create or replace function public.get_leaderboard()
returns table(rank bigint, username text, high_score bigint)
language sql stable security definer set search_path='' as $$
  select row_number() over(order by ps.high_score desc, pp.username asc), pp.username, ps.high_score
  from public.player_stats ps join public.player_profiles pp on pp.user_id=ps.user_id
  where ps.high_score > 0
  order by ps.high_score desc, pp.username asc limit 50;
$$;

create or replace function public.buy_powerup(powerup text)
returns bigint language plpgsql security definer set search_path='' as $$
declare cost bigint; remaining bigint; begin
  if auth.uid() is null then raise exception 'Sign in to buy permanent-account powerups'; end if;
  cost := case powerup when 'score_boost' then 3 when 'invincibility' then 5 when 'heart' then 2 else null end;
  if cost is null then raise exception 'Unknown powerup'; end if;
  update public.player_stats set total_gems=total_gems-cost,updated_at=now()
  where user_id=auth.uid() and total_gems>=cost returning total_gems into remaining;
  if remaining is null then raise exception 'Not enough gems'; end if;
  return remaining;
end; $$;

revoke all on function public.get_leaderboard(),public.buy_powerup(text) from public;
grant execute on function public.get_leaderboard() to anon,authenticated;
grant execute on function public.buy_powerup(text) to authenticated;
