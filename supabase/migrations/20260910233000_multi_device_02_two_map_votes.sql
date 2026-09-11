-- Multi-device 02 1v1 -- replace eight-map priorities with two equal votes.
--
-- Each player selects exactly two distinct maps. Matchmaking chooses:
--   * the one shared map when exactly one vote overlaps;
--   * uniformly between the two shared maps when both vote pairs match;
--   * uniformly from the four-map union when the pairs are disjoint.
-- Existing RPC names and p_map_order are retained for client/schema-cache
-- compatibility. map_order remains as a response alias for map_votes.

begin;

do $$
begin
  if to_regclass('public.player_1v1_map_priorities') is null
     or to_regclass('public.multiplayer_matches') is null
     or to_regclass('app_private.one_v_one_map_rules') is null
     or to_regprocedure('public.get_1v1_map_catalog()') is null then
    raise exception 'Run Multi-device 02 1v1 map setup first';
  end if;
end;
$$;

-- Preserve each existing player's first two choices while retiring the rest.
delete from public.player_1v1_map_priorities
where priority > 2;

alter table public.player_1v1_map_priorities
  drop constraint if exists player_1v1_map_priorities_priority_check;
alter table public.player_1v1_map_priorities
  add constraint player_1v1_map_priorities_priority_check
    check (priority between 1 and 2) not valid;
alter table public.player_1v1_map_priorities
  validate constraint player_1v1_map_priorities_priority_check;

alter table public.player_1v1_map_priorities enable row level security;
revoke all on table public.player_1v1_map_priorities
  from public, anon, authenticated;

comment on table public.player_1v1_map_priorities is
  'Private per-account online 1v1 map votes. Each configured player selects exactly two distinct maps; missing votes are safely randomized by matchmaking.';

create or replace function public.set_1v1_map_priorities(p_map_order text[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_order text[];
begin
  if v_uid is null then raise exception 'Sign in required'; end if;
  if p_map_order is null or cardinality(p_map_order) <> 2 then
    raise exception 'Choose exactly two maps to vote for';
  end if;

  select array_agg(lower(trim(item.map_key)) order by item.ordinality)
  into v_order
  from unnest(p_map_order) with ordinality as item(map_key, ordinality);

  if exists (select 1 from unnest(v_order) item where item is null or item = '')
     or (select count(distinct item) from unnest(v_order) item) <> 2
     or exists (
       select 1 from unnest(v_order) item
       where item not in (
         'classic', 'alley', 'desert', 'skyway',
         'pitch', 'volcano', 'factory', 'grove'
       )
     ) then
    raise exception 'Choose exactly two different maps from the map list';
  end if;

  delete from public.player_1v1_map_priorities where user_id = v_uid;
  insert into public.player_1v1_map_priorities(
    user_id, map_key, priority, updated_at
  )
  select v_uid, item.map_key, item.ordinality::smallint, now()
  from unnest(v_order) with ordinality as item(map_key, ordinality);

  return jsonb_build_object(
    'configured', true,
    'map_votes', to_jsonb(v_order),
    'map_order', to_jsonb(v_order),
    'max_selections', 2,
    'catalog', public.get_1v1_map_catalog()
  );
end;
$$;

create or replace function public.get_1v1_map_priorities()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_order text[];
begin
  if v_uid is null then raise exception 'Sign in required'; end if;

  select array_agg(vote.map_key order by vote.priority)
  into v_order
  from public.player_1v1_map_priorities vote
  where vote.user_id = v_uid;

  return jsonb_build_object(
    'configured', coalesce(cardinality(v_order), 0) = 2,
    'map_votes', coalesce(to_jsonb(v_order), '[]'::jsonb),
    'map_order', coalesce(to_jsonb(v_order), '[]'::jsonb),
    'max_selections', 2,
    'catalog', public.get_1v1_map_catalog()
  );
end;
$$;

create or replace function app_private.choose_1v1_map(
  p_player_one uuid,
  p_player_two uuid
)
returns table(map_key text, selection_method text, candidates text[])
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_all constant text[] :=
    array['classic','alley','desert','skyway','pitch','volcano','factory','grove']::text[];
  v_one_votes text[];
  v_two_votes text[];
  v_shared text[];
  v_pool text[];
  v_method text;
begin
  select array_agg(vote.map_key order by vote.priority)
  into v_one_votes
  from public.player_1v1_map_priorities vote
  where vote.user_id = p_player_one;

  if coalesce(cardinality(v_one_votes), 0) <> 2 then
    select array_agg(sample.map_key)
    into v_one_votes
    from (
      select item.map_key
      from unnest(v_all) item(map_key)
      order by random()
      limit 2
    ) sample;
  end if;

  select array_agg(vote.map_key order by vote.priority)
  into v_two_votes
  from public.player_1v1_map_priorities vote
  where vote.user_id = p_player_two;

  if coalesce(cardinality(v_two_votes), 0) <> 2 then
    select array_agg(sample.map_key)
    into v_two_votes
    from (
      select item.map_key
      from unnest(v_all) item(map_key)
      order by random()
      limit 2
    ) sample;
  end if;

  select array_agg(item order by item)
  into v_shared
  from unnest(v_one_votes) item
  where item = any(v_two_votes);

  if coalesce(cardinality(v_shared), 0) > 0 then
    v_pool := v_shared;
    v_method := 'votes_overlap';
  else
    select array_agg(distinct_votes.item order by distinct_votes.item)
    into v_pool
    from (
      select distinct candidate.item
      from unnest(v_one_votes || v_two_votes) candidate(item)
    ) distinct_votes;
    v_method := 'votes_union';
  end if;

  return query
  select v_pool[1 + floor(random() * cardinality(v_pool))::integer],
         v_method,
         v_pool;
end;
$$;

revoke all on function app_private.choose_1v1_map(uuid, uuid)
  from public, anon, authenticated;

alter table public.multiplayer_matches
  drop constraint if exists multiplayer_matches_map_selection_method_check,
  drop constraint if exists multiplayer_matches_map_candidates_check;
alter table public.multiplayer_matches
  add constraint multiplayer_matches_map_selection_method_check check (
    map_selection_method in (
      'legacy_default', 'fixed', 'preferences', 'preferences_shared_last',
      'votes_overlap', 'votes_union'
    )
  ) not valid,
  add constraint multiplayer_matches_map_candidates_check check (
    cardinality(map_candidates) between 1 and 4
  ) not valid;
alter table public.multiplayer_matches
  validate constraint multiplayer_matches_map_selection_method_check;
alter table public.multiplayer_matches
  validate constraint multiplayer_matches_map_candidates_check;

comment on function public.set_1v1_map_priorities(text[]) is
  'Replaces the caller two-map 1v1 vote atomically; both selected maps have equal weight.';
comment on function public.get_1v1_map_priorities() is
  'Returns the caller two equal 1v1 map votes and the public map catalog.';
comment on function app_private.choose_1v1_map(uuid, uuid) is
  'Selects uniformly from shared two-map votes, or from the four-map union when disjoint.';

revoke all on function public.get_1v1_map_priorities()
  from public, anon, authenticated;
revoke all on function public.set_1v1_map_priorities(text[])
  from public, anon, authenticated;
grant execute on function public.get_1v1_map_priorities() to authenticated;
grant execute on function public.set_1v1_map_priorities(text[]) to authenticated;

notify pgrst, 'reload schema';
commit;

-- Visible rerun/contract checks. Every column should return true.
select
  not exists (
    select 1
    from public.player_1v1_map_priorities vote
    group by vote.user_id
    having count(*) > 2 or max(vote.priority) > 2
  ) as at_most_two_votes_per_player,
  position(
    $$cardinality(p_map_order) <> 2$$ in pg_get_functiondef(
      to_regprocedure('public.set_1v1_map_priorities(text[])')
    )
  ) > 0 as setter_requires_two_votes,
  position(
    $$v_method := 'votes_overlap'$$ in pg_get_functiondef(
      to_regprocedure('app_private.choose_1v1_map(uuid,uuid)')
    )
  ) > 0 as overlap_pool_installed,
  position(
    $$v_method := 'votes_union'$$ in pg_get_functiondef(
      to_regprocedure('app_private.choose_1v1_map(uuid,uuid)')
    )
  ) > 0 as four_vote_union_installed,
  position(
    $$v_roll$$ in pg_get_functiondef(
      to_regprocedure('app_private.choose_1v1_map(uuid,uuid)')
    )
  ) = 0 as hidden_fixed_weights_removed,
  (
    select relation.relrowsecurity
    from pg_class relation
    where relation.oid = 'public.player_1v1_map_priorities'::regclass
  ) as vote_rls_enabled,
  not has_table_privilege(
    'authenticated', 'public.player_1v1_map_priorities', 'SELECT'
  ) and not has_table_privilege(
    'authenticated', 'public.player_1v1_map_priorities', 'INSERT'
  ) and not has_table_privilege(
    'authenticated', 'public.player_1v1_map_priorities', 'UPDATE'
  ) and not has_table_privilege(
    'authenticated', 'public.player_1v1_map_priorities', 'DELETE'
  ) as vote_rows_are_rpc_only,
  has_function_privilege(
    'authenticated', 'public.get_1v1_map_priorities()', 'EXECUTE'
  ) and has_function_privilege(
    'authenticated', 'public.set_1v1_map_priorities(text[])', 'EXECUTE'
  ) and not has_function_privilege(
    'anon', 'public.get_1v1_map_priorities()', 'EXECUTE'
  ) and not has_function_privilege(
    'anon', 'public.set_1v1_map_priorities(text[])', 'EXECUTE'
  ) as vote_rpcs_are_authenticated_only;
