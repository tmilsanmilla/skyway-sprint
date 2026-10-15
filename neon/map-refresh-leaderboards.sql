-- Map refresh: restore the two existing, signed-in, read-only leaderboards.
-- No private account data, score edits, role changes, or anonymous access.
begin;
do $audit$
declare d text;
begin
  select pg_get_functiondef(to_regprocedure('public.get_1v1_leaderboard(integer,integer)')) into d;
  if d is null or position('Sign in required' in d)=0
    or position('player_ranked_1v1_stats' in d)=0
    or position('has_active_ban' in d)=0
    or position('p_limit > 100' in d)=0 then
    raise exception 'Ranked leaderboard reader differs from the reviewed signed-in/ban-filtered function';
  end if;
end;
$audit$;
create or replace function public.get_leaderboard()
returns table(rank bigint,username text,high_score bigint)
language sql stable security definer set search_path=''
as $reader$
  select row_number() over(order by stats.high_score desc,profile.username asc),
    profile.username,stats.high_score
  from public.player_stats stats
  join public.player_profiles profile on profile.user_id=stats.user_id
  where auth.uid() is not null and stats.high_score>0
    and app_private.is_leaderboard_visible(stats.user_id)
  order by stats.high_score desc,profile.username asc
  limit 50;
$reader$;
revoke all on function public.get_leaderboard(),public.get_1v1_leaderboard(integer,integer)
from public,anon,anonymous;
grant execute on function public.get_leaderboard(),public.get_1v1_leaderboard(integer,integer)
to authenticated;
notify pgrst,'reload schema';
commit;
