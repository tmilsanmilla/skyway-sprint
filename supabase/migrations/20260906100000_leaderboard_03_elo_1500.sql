-- Leaderboard 03 — 1500-centered Ranked Elo.
-- Rerunnable delta for databases that already installed Player 06 Levels.
-- Casual matches remain excluded by Player 06's mode-checking recorder and
-- capture trigger; this migration changes only the active Ranked-season pool.

begin;

do $$
begin
  if to_regclass('public.ranked_1v1_seasons') is null
     or to_regclass('public.player_ranked_1v1_stats') is null
     or to_regclass('public.ranked_1v1_results') is null
     or to_regprocedure(
       'app_private.apply_ranked_result_to_active_season()'
     ) is null then
    raise exception 'Run Player 06 Levels + Ranked 1v1 before this query';
  end if;
end;
$$;

-- Keep enough precision to center the complete pool without exposing decimals
-- in the UI. No-game rows are unrated and begin at exactly 1500.
alter table public.player_ranked_1v1_stats
  drop constraint if exists player_ranked_1v1_stats_rating_check;
alter table public.player_ranked_1v1_stats
  alter column rating drop default,
  alter column rating type numeric(18,6) using rating::numeric(18,6),
  alter column rating set default 1500;
alter table public.ranked_1v1_results
  alter column player_one_rating_before type numeric(18,6)
    using player_one_rating_before::numeric(18,6),
  alter column player_two_rating_before type numeric(18,6)
    using player_two_rating_before::numeric(18,6),
  alter column player_one_rating_after type numeric(18,6)
    using player_one_rating_after::numeric(18,6),
  alter column player_two_rating_after type numeric(18,6)
    using player_two_rating_after::numeric(18,6);

update public.player_ranked_1v1_stats
set rating = 1500
where matches_played = 0 and rating <> 1500;

-- Preserve existing differences and history, but move each season's current
-- pool as a whole so its established-player average is exactly 1500.
do $$
declare
  v_season_id integer;
  v_average numeric;
  v_residual numeric;
  v_anchor uuid;
begin
  for v_season_id in
    select distinct stats.season_id
    from public.player_ranked_1v1_stats stats
    where stats.matches_played > 0
  loop
    select avg(stats.rating) into v_average
    from public.player_ranked_1v1_stats stats
    where stats.season_id = v_season_id and stats.matches_played > 0;

    update public.player_ranked_1v1_stats stats
    set rating = round(stats.rating + (1500 - v_average), 6)
    where stats.season_id = v_season_id and stats.matches_played > 0;

    select 1500::numeric * count(*) - sum(stats.rating)
    into v_residual
    from public.player_ranked_1v1_stats stats
    where stats.season_id = v_season_id and stats.matches_played > 0;

    if v_residual <> 0 then
      select stats.user_id into v_anchor
      from public.player_ranked_1v1_stats stats
      where stats.season_id = v_season_id and stats.matches_played > 0
      order by stats.user_id
      limit 1;

      update public.player_ranked_1v1_stats stats
      set rating = stats.rating + v_residual
      where stats.season_id = v_season_id and stats.user_id = v_anchor;
    end if;
  end loop;
end;
$$;

create or replace function app_private.apply_ranked_result_to_active_season()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_season_id integer;
  v_one public.player_ranked_1v1_stats%rowtype;
  v_two public.player_ranked_1v1_stats%rowtype;
  v_result_one numeric;
  v_result_two numeric;
  v_expected_one numeric;
  v_expected_two numeric;
  v_k_one numeric;
  v_k_two numeric;
  v_rating_one numeric(18,6);
  v_rating_two numeric(18,6);
  v_average_rating numeric;
  v_center_offset numeric;
  v_center_residual numeric;
  v_center_anchor uuid;
  v_inserted uuid;
begin
  -- One locked season row serializes every rating settlement and its pool-wide
  -- recenter, including matches between four completely different players.
  select season.id into v_season_id
  from public.ranked_1v1_seasons season
  where season.is_active and season.starts_at <= new.recorded_at
    and (season.ends_at is null or season.ends_at > new.recorded_at)
  order by season.starts_at desc limit 1
  for update;
  if v_season_id is null
     or new.player_one_user_id is null
     or new.player_two_user_id is null then
    return new;
  end if;

  insert into public.player_ranked_1v1_stats(season_id, user_id)
  values
    (v_season_id, new.player_one_user_id),
    (v_season_id, new.player_two_user_id)
  on conflict (season_id, user_id) do nothing;

  perform stats.user_id
  from public.player_ranked_1v1_stats stats
  where stats.season_id = v_season_id
    and stats.user_id in (new.player_one_user_id, new.player_two_user_id)
  order by stats.user_id for update;

  select * into v_one from public.player_ranked_1v1_stats stats
  where stats.season_id = v_season_id
    and stats.user_id = new.player_one_user_id;
  select * into v_two from public.player_ranked_1v1_stats stats
  where stats.season_id = v_season_id
    and stats.user_id = new.player_two_user_id;

  if new.winner_user_id = new.player_one_user_id then
    v_result_one := 1; v_result_two := 0;
  elsif new.winner_user_id = new.player_two_user_id then
    v_result_one := 0; v_result_two := 1;
  else
    v_result_one := 0.5; v_result_two := 0.5;
  end if;

  v_expected_one := 1 / (
    1 + power(10::numeric, (v_two.rating - v_one.rating)::numeric / 600)
  );
  v_expected_two := 1 / (
    1 + power(10::numeric, (v_one.rating - v_two.rating)::numeric / 600)
  );
  -- matches_played still contains prior games only at this point.
  v_k_one := case
    when v_one.matches_played <= 27
      then 525::numeric / (v_one.matches_played + 10)::numeric
    else 14::numeric
  end;
  v_k_two := case
    when v_two.matches_played <= 27
      then 525::numeric / (v_two.matches_played + 10)::numeric
    else 14::numeric
  end;
  v_rating_one := round(
    v_one.rating + v_k_one * (v_result_one - v_expected_one), 6
  );
  v_rating_two := round(
    v_two.rating + v_k_two * (v_result_two - v_expected_two), 6
  );

  -- The unique receipt is inserted before any rating/stat mutation. A repeat
  -- trigger therefore returns without applying the same match twice.
  insert into public.ranked_1v1_results(
    season_id, match_id, player_one_user_id, player_two_user_id,
    winner_user_id, player_one_rating_before, player_two_rating_before,
    player_one_rating_after, player_two_rating_after
  ) values (
    v_season_id, new.match_id, new.player_one_user_id,
    new.player_two_user_id, new.winner_user_id, v_one.rating, v_two.rating,
    v_rating_one, v_rating_two
  )
  on conflict (season_id, match_id) do nothing
  returning match_id into v_inserted;
  if v_inserted is null then return new; end if;

  update public.player_ranked_1v1_stats stats
  set rating = v_rating_one,
      matches_played = stats.matches_played + 1,
      wins = stats.wins + case when v_result_one = 1 then 1 else 0 end,
      losses = stats.losses + case when v_result_one = 0 then 1 else 0 end,
      draws = stats.draws + case when v_result_one = 0.5 then 1 else 0 end,
      current_streak = case when v_result_one = 1
        then stats.current_streak + 1 else 0 end,
      best_streak = greatest(stats.best_streak, case when v_result_one = 1
        then stats.current_streak + 1 else 0 end),
      best_wave = greatest(stats.best_wave, new.player_one_wave),
      best_score = greatest(stats.best_score, new.player_one_score),
      coins_collected = stats.coins_collected + new.player_one_coins,
      obstacle_points_spent = stats.obstacle_points_spent
        + new.player_one_obstacle_points_spent,
      updated_at = now()
  where stats.season_id = v_season_id
    and stats.user_id = new.player_one_user_id;

  update public.player_ranked_1v1_stats stats
  set rating = v_rating_two,
      matches_played = stats.matches_played + 1,
      wins = stats.wins + case when v_result_two = 1 then 1 else 0 end,
      losses = stats.losses + case when v_result_two = 0 then 1 else 0 end,
      draws = stats.draws + case when v_result_two = 0.5 then 1 else 0 end,
      current_streak = case when v_result_two = 1
        then stats.current_streak + 1 else 0 end,
      best_streak = greatest(stats.best_streak, case when v_result_two = 1
        then stats.current_streak + 1 else 0 end),
      best_wave = greatest(stats.best_wave, new.player_two_wave),
      best_score = greatest(stats.best_score, new.player_two_score),
      coins_collected = stats.coins_collected + new.player_two_coins,
      obstacle_points_spent = stats.obstacle_points_spent
        + new.player_two_obstacle_points_spent,
      updated_at = now()
  where stats.season_id = v_season_id
    and stats.user_id = new.player_two_user_id;

  select avg(stats.rating) into v_average_rating
  from public.player_ranked_1v1_stats stats
  where stats.season_id = v_season_id and stats.matches_played > 0;
  v_center_offset := 1500 - v_average_rating;

  update public.player_ranked_1v1_stats stats
  set rating = round(stats.rating + v_center_offset, 6),
      updated_at = now()
  where stats.season_id = v_season_id and stats.matches_played > 0;

  select 1500::numeric * count(*) - sum(stats.rating)
  into v_center_residual
  from public.player_ranked_1v1_stats stats
  where stats.season_id = v_season_id and stats.matches_played > 0;
  if v_center_residual <> 0 then
    select stats.user_id into v_center_anchor
    from public.player_ranked_1v1_stats stats
    where stats.season_id = v_season_id and stats.matches_played > 0
    order by stats.user_id
    limit 1;
    update public.player_ranked_1v1_stats stats
    set rating = stats.rating + v_center_residual
    where stats.season_id = v_season_id
      and stats.user_id = v_center_anchor;
  end if;

  select stats.rating into v_rating_one
  from public.player_ranked_1v1_stats stats
  where stats.season_id = v_season_id
    and stats.user_id = new.player_one_user_id;
  select stats.rating into v_rating_two
  from public.player_ranked_1v1_stats stats
  where stats.season_id = v_season_id
    and stats.user_id = new.player_two_user_id;

  update public.ranked_1v1_results result
  set player_one_rating_after = v_rating_one,
      player_two_rating_after = v_rating_two
  where result.season_id = v_season_id and result.match_id = new.match_id;
  return new;
end;
$$;

revoke all on function app_private.apply_ranked_result_to_active_season()
  from public, anon, authenticated;

-- Exact ratings determine order; only the returned number is rounded.
create or replace function public.get_1v1_leaderboard(
  p_limit integer default 50,
  p_offset integer default 0
)
returns table (
  rank bigint,
  username text,
  rating integer,
  provisional boolean,
  matches_played bigint,
  wins bigint,
  losses bigint,
  draws bigint,
  win_rate numeric,
  current_streak bigint,
  best_streak bigint,
  best_wave integer,
  best_score bigint,
  coins_collected bigint,
  obstacle_points_spent bigint,
  is_self boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_season_id integer;
begin
  if v_uid is null then raise exception 'Sign in required'; end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'Leaderboard limit must be between 1 and 100';
  end if;
  if p_offset is null or p_offset < 0 or p_offset > 10000 then
    raise exception 'Leaderboard offset must be between 0 and 10000';
  end if;
  select season.id into v_season_id
  from public.ranked_1v1_seasons season
  where season.is_active order by season.starts_at desc limit 1;

  return query
  with eligible as (
    select
      stats.user_id, profile.username, stats.rating, stats.matches_played,
      stats.wins, stats.losses, stats.draws,
      round(stats.wins::numeric * 100 / nullif(stats.matches_played, 0), 1)
        as win_rate,
      stats.current_streak, stats.best_streak, stats.best_wave,
      stats.best_score, stats.coins_collected, stats.obstacle_points_spent
    from public.player_ranked_1v1_stats stats
    join public.player_profiles profile on profile.user_id = stats.user_id
    where stats.season_id = v_season_id and stats.matches_played > 0
      and not app_private.has_active_ban(stats.user_id, 'account', null)
      and not app_private.has_active_ban(stats.user_id, 'leaderboard', null)
  ), ranked as (
    select row_number() over (
      order by eligible.rating desc, eligible.wins desc,
        eligible.win_rate desc, eligible.best_wave desc,
        eligible.best_score desc, lower(eligible.username), eligible.user_id
    ) as rank, eligible.* from eligible
  )
  select ranked.rank, ranked.username, round(ranked.rating)::integer,
    ranked.matches_played < 10, ranked.matches_played, ranked.wins,
    ranked.losses, ranked.draws, ranked.win_rate, ranked.current_streak,
    ranked.best_streak, ranked.best_wave, ranked.best_score,
    ranked.coins_collected, ranked.obstacle_points_spent,
    ranked.user_id = v_uid
  from ranked order by ranked.rank limit p_limit offset p_offset;
end;
$$;

revoke all on function public.get_1v1_leaderboard(integer, integer)
  from public, anon, authenticated;
grant execute on function public.get_1v1_leaderboard(integer, integer)
  to authenticated;

notify pgrst, 'reload schema';
commit;

-- Visible rerun checks.
select
  (
    select position('1500' in coalesce(column_default, '')) > 0
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'player_ranked_1v1_stats'
      and column_name = 'rating'
  ) as new_players_start_at_1500,
  position(
    '/ 600' in pg_get_functiondef(to_regprocedure(
      'app_private.apply_ranked_result_to_active_season()'
    ))
  ) > 0 as expected_score_divisor_600,
  position(
    '525::numeric / (v_one.matches_played + 10)::numeric'
    in pg_get_functiondef(to_regprocedure(
      'app_private.apply_ranked_result_to_active_season()'
    ))
  ) > 0 as dynamic_k_installed,
  position(
    'v_center_offset := 1500 - v_average_rating'
    in pg_get_functiondef(to_regprocedure(
      'app_private.apply_ranked_result_to_active_season()'
    ))
  ) > 0 as pool_recentering_installed,
  position(
    $$new.mode = 'ranked'$$ in pg_get_functiondef(to_regprocedure(
      'app_private.capture_finished_1v1_for_leaderboard()'
    ))
  ) > 0 as casual_elo_blocked;
