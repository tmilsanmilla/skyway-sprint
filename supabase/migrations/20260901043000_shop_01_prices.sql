-- Shop 01 Prices: 2.5x prices, rounded up to whole gems.
create or replace function public.buy_powerup(powerup text)
returns bigint language plpgsql security definer set search_path='' as $$
declare cost bigint; remaining bigint; begin
  if auth.uid() is null then raise exception 'Sign in to buy permanent-account powerups'; end if;
  cost := case powerup when 'score_boost' then 8 when 'invincibility' then 13 when 'heart' then 5 else null end;
  if cost is null then raise exception 'Unknown powerup'; end if;
  update public.player_stats set total_gems=total_gems-cost,updated_at=now()
  where user_id=auth.uid() and total_gems>=cost returning total_gems into remaining;
  if remaining is null then raise exception 'Not enough gems'; end if;
  return remaining;
end; $$;
revoke all on function public.buy_powerup(text) from public;
grant execute on function public.buy_powerup(text) to authenticated;
