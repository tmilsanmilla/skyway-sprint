-- Multi-device 03 — durable 1v1 leaderboard
--
-- Live 1v1 rows are deliberately ephemeral and are removed after seven days.
-- This migration snapshots each completed match exactly once, maintains a
-- private Elo/stat row for each player, and exposes only sanitized leaderboard
-- fields through an authenticated RPC. Existing 1v1 gameplay remains client
-- authoritative; the ruleset marker makes that limitation explicit in history.

begin;

create table if not exists public.multiplayer_ranked_results (
  match_id uuid primary key,
  player_one_user_id uuid references auth.users(id) on delete set null,
  player_two_user_id uuid references auth.users(id) on delete set null,
  winner_user_id uuid references auth.users(id) on delete set null,
  player_one_username text not null,
  player_two_username text not null,
  player_one_wave integer not null check (player_one_wave >= 1),
  player_two_wave integer not null check (player_two_wave >= 1),
  player_one_score bigint not null check (player_one_score >= 0),
  player_two_score bigint not null check (player_two_score >= 0),
  player_one_coins bigint not null check (player_one_coins >= 0),
  player_two_coins bigint not null check (player_two_coins >= 0),
  player_one_obstacle_points_spent bigint not null
    check (player_one_obstacle_points_spent >= 0),
  player_two_obstacle_points_spent bigint not null
    check (player_two_obstacle_points_spent >= 0),
  player_one_rating_before integer not null
    check (player_one_rating_before >= 100),
  player_two_rating_before integer not null
    check (player_two_rating_before >= 100),
  player_one_rating_after integer not null
    check (player_one_rating_after >= 100),
  player_two_rating_after integer not null
    check (player_two_rating_after >= 100),
  ruleset_version text not null default 'legacy-v1-client-authoritative',
  finished_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  constraint multiplayer_ranked_results_distinct_players check (
    player_one_user_id is null
    or player_two_user_id is null
    or player_one_user_id <> player_two_user_id
  ),
  constraint multiplayer_ranked_results_known_winner check (
    winner_user_id is null
    or winner_user_id = player_one_user_id
    or winner_user_id = player_two_user_id
  )
);

create index if not exists multiplayer_ranked_results_finished_at_idx
  on public.multiplayer_ranked_results (finished_at desc);

create table if not exists public.player_1v1_stats (
  user_id uuid primary key references auth.users(id) on delete cascade,
  rating integer not null default 1000 check (rating >= 100),
  matches_played bigint not null default 0 check (matches_played >= 0),
  wins bigint not null default 0 check (wins >= 0),
  losses bigint not null default 0 check (losses >= 0),
  draws bigint not null default 0 check (draws >= 0),
  current_streak bigint not null default 0 check (current_streak >= 0),
  best_streak bigint not null default 0 check (best_streak >= 0),
  best_wave integer not null default 1 check (best_wave >= 1),
  best_score bigint not null default 0 check (best_score >= 0),
  coins_collected bigint not null default 0 check (coins_collected >= 0),
  obstacle_points_spent bigint not null default 0
    check (obstacle_points_spent >= 0),
  updated_at timestamptz not null default now(),
  constraint player_1v1_stats_outcomes_total check (
    matches_played = wins + losses + draws
  ),
  constraint player_1v1_stats_streak_order check (
    best_streak >= current_streak
  )
);

create index if not exists player_1v1_stats_rank_idx
  on public.player_1v1_stats (
    rating desc,
    wins desc,
    best_wave desc,
    best_score desc
  );

alter table public.multiplayer_ranked_results enable row level security;
alter table public.player_1v1_stats enable row level security;

revoke all on table public.multiplayer_ranked_results
  from public, anon, authenticated;
revoke all on table public.player_1v1_stats
  from public, anon, authenticated;

comment on table public.multiplayer_ranked_results is
  'Private, append-only snapshots of completed 1v1 matches. No foreign key to the ephemeral match row is intentional.';
comment on table public.player_1v1_stats is
  'Private lifetime 1v1 Elo and aggregate statistics. Clients read sanitized values only through get_1v1_leaderboard.';

-- Record one finished match. The match row lock plus the result primary key
-- make this safe across repeated finalization calls and concurrent devices.
create or replace function app_private.record_1v1_ranked_result(
  p_match_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_match public.multiplayer_matches%rowtype;
  v_player_one public.multiplayer_players%rowtype;
  v_player_two public.multiplayer_players%rowtype;
  v_stats_one public.player_1v1_stats%rowtype;
  v_stats_two public.player_1v1_stats%rowtype;
  v_result_one numeric;
  v_result_two numeric;
  v_expected_one numeric;
  v_expected_two numeric;
  v_rating_one_after integer;
  v_rating_two_after integer;
  v_spent_one bigint := 0;
  v_spent_two bigint := 0;
  v_inserted_match_id uuid;
begin
  select match.*
  into v_match
  from public.multiplayer_matches match
  where match.id = p_match_id
  for update;

  if v_match.id is null or v_match.status <> 'finished' then
    return false;
  end if;

  if exists (
    select 1
    from public.multiplayer_ranked_results result
    where result.match_id = p_match_id
  ) then
    return false;
  end if;

  select player.*
  into v_player_one
  from public.multiplayer_players player
  where player.match_id = p_match_id
    and player.slot = 1;

  select player.*
  into v_player_two
  from public.multiplayer_players player
  where player.match_id = p_match_id
    and player.slot = 2;

  if v_player_one.user_id is null or v_player_two.user_id is null then
    return false;
  end if;

  insert into public.player_1v1_stats(user_id)
  values (v_player_one.user_id), (v_player_two.user_id)
  on conflict (user_id) do nothing;

  -- Lock both rating rows in UUID order so future parallel finalizations cannot
  -- deadlock when the same account appears in adjacent matches.
  perform stats.user_id
  from public.player_1v1_stats stats
  where stats.user_id in (v_player_one.user_id, v_player_two.user_id)
  order by stats.user_id
  for update;

  select stats.*
  into v_stats_one
  from public.player_1v1_stats stats
  where stats.user_id = v_player_one.user_id;

  select stats.*
  into v_stats_two
  from public.player_1v1_stats stats
  where stats.user_id = v_player_two.user_id;

  if v_match.winner_user_id = v_player_one.user_id then
    v_result_one := 1;
    v_result_two := 0;
  elsif v_match.winner_user_id = v_player_two.user_id then
    v_result_one := 0;
    v_result_two := 1;
  else
    v_result_one := 0.5;
    v_result_two := 0.5;
  end if;

  v_expected_one := 1 / (
    1 + power(
      10::numeric,
      (v_stats_two.rating - v_stats_one.rating)::numeric / 400
    )
  );
  v_expected_two := 1 / (
    1 + power(
      10::numeric,
      (v_stats_one.rating - v_stats_two.rating)::numeric / 400
    )
  );

  v_rating_one_after := greatest(
    100,
    v_stats_one.rating + round(32 * (v_result_one - v_expected_one))::integer
  );
  v_rating_two_after := greatest(
    100,
    v_stats_two.rating + round(32 * (v_result_two - v_expected_two))::integer
  );

  select
    coalesce(sum(attack.point_cost) filter (
      where attack.sender_user_id = v_player_one.user_id
    ), 0)::bigint,
    coalesce(sum(attack.point_cost) filter (
      where attack.sender_user_id = v_player_two.user_id
    ), 0)::bigint
  into v_spent_one, v_spent_two
  from public.multiplayer_attacks attack
  where attack.match_id = p_match_id;

  insert into public.multiplayer_ranked_results (
    match_id,
    player_one_user_id,
    player_two_user_id,
    winner_user_id,
    player_one_username,
    player_two_username,
    player_one_wave,
    player_two_wave,
    player_one_score,
    player_two_score,
    player_one_coins,
    player_two_coins,
    player_one_obstacle_points_spent,
    player_two_obstacle_points_spent,
    player_one_rating_before,
    player_two_rating_before,
    player_one_rating_after,
    player_two_rating_after,
    ruleset_version,
    finished_at
  ) values (
    p_match_id,
    v_player_one.user_id,
    v_player_two.user_id,
    v_match.winner_user_id,
    v_player_one.username,
    v_player_two.username,
    v_player_one.wave,
    v_player_two.wave,
    v_player_one.score,
    v_player_two.score,
    v_player_one.melons_collected,
    v_player_two.melons_collected,
    v_spent_one,
    v_spent_two,
    v_stats_one.rating,
    v_stats_two.rating,
    v_rating_one_after,
    v_rating_two_after,
    'legacy-v1-client-authoritative',
    coalesce(v_match.finished_at, v_match.last_activity_at, now())
  )
  on conflict (match_id) do nothing
  returning match_id into v_inserted_match_id;

  if v_inserted_match_id is null then
    return false;
  end if;

  update public.player_1v1_stats stats
  set
    rating = v_rating_one_after,
    matches_played = stats.matches_played + 1,
    wins = stats.wins + case when v_result_one = 1 then 1 else 0 end,
    losses = stats.losses + case when v_result_one = 0 then 1 else 0 end,
    draws = stats.draws + case when v_result_one = 0.5 then 1 else 0 end,
    current_streak = case
      when v_result_one = 1 then stats.current_streak + 1
      else 0
    end,
    best_streak = greatest(
      stats.best_streak,
      case when v_result_one = 1 then stats.current_streak + 1 else 0 end
    ),
    best_wave = greatest(stats.best_wave, v_player_one.wave),
    best_score = greatest(stats.best_score, v_player_one.score),
    coins_collected = stats.coins_collected + v_player_one.melons_collected,
    obstacle_points_spent = stats.obstacle_points_spent + v_spent_one,
    updated_at = now()
  where stats.user_id = v_player_one.user_id;

  update public.player_1v1_stats stats
  set
    rating = v_rating_two_after,
    matches_played = stats.matches_played + 1,
    wins = stats.wins + case when v_result_two = 1 then 1 else 0 end,
    losses = stats.losses + case when v_result_two = 0 then 1 else 0 end,
    draws = stats.draws + case when v_result_two = 0.5 then 1 else 0 end,
    current_streak = case
      when v_result_two = 1 then stats.current_streak + 1
      else 0
    end,
    best_streak = greatest(
      stats.best_streak,
      case when v_result_two = 1 then stats.current_streak + 1 else 0 end
    ),
    best_wave = greatest(stats.best_wave, v_player_two.wave),
    best_score = greatest(stats.best_score, v_player_two.score),
    coins_collected = stats.coins_collected + v_player_two.melons_collected,
    obstacle_points_spent = stats.obstacle_points_spent + v_spent_two,
    updated_at = now()
  where stats.user_id = v_player_two.user_id;

  return true;
end;
$$;

create or replace function app_private.capture_finished_1v1_for_leaderboard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app_private.record_1v1_ranked_result(new.id);
  return new;
end;
$$;

revoke all on function app_private.record_1v1_ranked_result(uuid)
  from public, anon, authenticated;
revoke all on function app_private.capture_finished_1v1_for_leaderboard()
  from public, anon, authenticated;

drop trigger if exists capture_finished_1v1_for_leaderboard
  on public.multiplayer_matches;
create trigger capture_finished_1v1_for_leaderboard
after update of status on public.multiplayer_matches
for each row
when (old.status is distinct from new.status and new.status = 'finished')
execute function app_private.capture_finished_1v1_for_leaderboard();

-- Preserve the finished matches that still exist in the seven-day live-table
-- window. Chronological processing makes their Elo sequence deterministic.
do $$
declare
  v_match_id uuid;
begin
  for v_match_id in
    select match.id
    from public.multiplayer_matches match
    where match.status = 'finished'
    order by
      coalesce(match.finished_at, match.last_activity_at, match.created_at),
      match.id
  loop
    perform app_private.record_1v1_ranked_result(v_match_id);
  end loop;
end;
$$;

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
begin
  if v_uid is null then
    raise exception 'Sign in required';
  end if;
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'Leaderboard limit must be between 1 and 100';
  end if;
  if p_offset is null or p_offset < 0 or p_offset > 10000 then
    raise exception 'Leaderboard offset must be between 0 and 10000';
  end if;

  return query
  with eligible as (
    select
      stats.user_id,
      profile.username,
      stats.rating,
      stats.matches_played,
      stats.wins,
      stats.losses,
      stats.draws,
      round(
        stats.wins::numeric * 100 / nullif(stats.matches_played, 0),
        1
      ) as win_rate,
      stats.current_streak,
      stats.best_streak,
      stats.best_wave,
      stats.best_score,
      stats.coins_collected,
      stats.obstacle_points_spent
    from public.player_1v1_stats stats
    join public.player_profiles profile on profile.user_id = stats.user_id
    where stats.matches_played > 0
      and not app_private.has_active_ban(stats.user_id, 'account', null)
      and not app_private.has_active_ban(stats.user_id, 'leaderboard', null)
  ),
  ranked as (
    select
      row_number() over (
        order by
          eligible.rating desc,
          eligible.wins desc,
          eligible.win_rate desc,
          eligible.best_wave desc,
          eligible.best_score desc,
          lower(eligible.username) asc,
          eligible.user_id asc
      ) as rank,
      eligible.*
    from eligible
  )
  select
    ranked.rank,
    ranked.username,
    ranked.rating,
    ranked.matches_played < 10 as provisional,
    ranked.matches_played,
    ranked.wins,
    ranked.losses,
    ranked.draws,
    ranked.win_rate,
    ranked.current_streak,
    ranked.best_streak,
    ranked.best_wave,
    ranked.best_score,
    ranked.coins_collected,
    ranked.obstacle_points_spent,
    ranked.user_id = v_uid as is_self
  from ranked
  order by ranked.rank
  limit p_limit
  offset p_offset;
end;
$$;

comment on function public.get_1v1_leaderboard(integer, integer) is
  'Authenticated, sanitized lifetime 1v1 Elo leaderboard. Never returns account UUIDs or email addresses.';

revoke all on function public.get_1v1_leaderboard(integer, integer)
  from public, anon, authenticated;
grant execute on function public.get_1v1_leaderboard(integer, integer)
  to authenticated;

-- Keep the eventual winner's displayed best score reasonably current without
-- changing match phases. The broader update_1v1_state RPC also writes score,
-- but calling it on a timer could race an intermission transition back to
-- "playing". This narrow RPC only advances the caller's score snapshot.
create or replace function public.sync_1v1_score(
  p_match_id uuid,
  p_score bigint
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_match_status text;
  v_current_score bigint;
begin
  if v_uid is null then
    raise exception 'Sign in required';
  end if;
  if p_score is null or p_score < 0 or p_score > 1000000000000 then
    raise exception 'Invalid 1v1 score';
  end if;

  select match.status
  into v_match_status
  from public.multiplayer_matches match
  where match.id = p_match_id
  for update;

  if v_match_status is null
     or v_match_status not in ('countdown', 'playing', 'intermission') then
    raise exception '1v1 match is not active';
  end if;

  select player.score
  into v_current_score
  from public.multiplayer_players player
  where player.match_id = p_match_id
    and player.user_id = v_uid
  for update;

  if v_current_score is null then
    raise exception '1v1 match not found';
  end if;
  if p_score < v_current_score then
    raise exception 'Score cannot decrease';
  end if;

  update public.multiplayer_players player
  set score = p_score,
      last_seen_at = now(),
      updated_at = now()
  where player.match_id = p_match_id
    and player.user_id = v_uid;

  update public.multiplayer_matches match
  set last_activity_at = now()
  where match.id = p_match_id;

  return p_score;
end;
$$;

comment on function public.sync_1v1_score(uuid, bigint) is
  'Authenticated monotonic score snapshot for an active 1v1. It never changes the match phase.';

revoke all on function public.sync_1v1_score(uuid, bigint)
  from public, anon, authenticated;
grant execute on function public.sync_1v1_score(uuid, bigint)
  to authenticated;

notify pgrst, 'reload schema';

commit;
