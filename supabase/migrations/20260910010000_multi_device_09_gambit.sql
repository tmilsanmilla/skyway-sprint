-- Multi-device 09 -- server-owned Gambit deck, poker rewards, and 1v1 effects.
--
-- The browser never receives the draw pile or shuffle seed. Every mutation is
-- serialized against the authenticated participant's immutable character
-- snapshot, and every wave reward is recorded once before it changes coins.

begin;

do $gambit_requirements$
begin
  if to_regclass('public.multiplayer_matches') is null
     or to_regclass('public.multiplayer_players') is null
     or to_regclass('public.multiplayer_attacks') is null
     or to_regprocedure(
       'app_private.next_1v1_attack_placement(uuid,uuid,uuid,text)'
     ) is null
     or to_regprocedure(
       'public.send_1v1_attack(uuid,text,integer)'
     ) is null then
    raise exception 'Run the current Multi-device 01 query first';
  end if;
end;
$gambit_requirements$;

create schema if not exists app_private;

create table if not exists app_private.multiplayer_gambit_state (
  match_id uuid not null,
  user_id uuid not null,
  deck_cycle integer not null default 0,
  draw_pile text[] not null,
  discard_pile text[] not null default array[]::text[],
  hand text[] not null default array[]::text[],
  last_draw_wave integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (match_id, user_id),
  foreign key (match_id, user_id)
    references public.multiplayer_players(match_id, user_id)
    on delete cascade,
  constraint multiplayer_gambit_state_cycle_check
    check (deck_cycle >= 0),
  constraint multiplayer_gambit_state_wave_check
    check (last_draw_wave >= 0),
  constraint multiplayer_gambit_state_hand_check
    check (cardinality(hand) between 0 and 10),
  constraint multiplayer_gambit_state_card_count_check
    check (
      cardinality(draw_pile) + cardinality(discard_pile) + cardinality(hand)
      = 52
    )
);

create table if not exists app_private.multiplayer_gambit_rewards (
  match_id uuid not null,
  user_id uuid not null,
  wave integer not null,
  best_hand text not null,
  stolen_coins numeric(16,4) not null default 0,
  doubled_coins numeric(16,4) not null default 0,
  self_coins_after numeric(16,4) not null default 0,
  opponent_coins_after numeric(16,4) not null default 0,
  created_at timestamptz not null default now(),
  primary key (match_id, user_id, wave),
  foreign key (match_id, user_id)
    references public.multiplayer_players(match_id, user_id)
    on delete cascade,
  constraint multiplayer_gambit_rewards_wave_check check (wave >= 1),
  constraint multiplayer_gambit_rewards_hand_check check (best_hand in (
    'high-card', 'pair', 'two-pair', 'three-of-a-kind', 'straight',
    'flush', 'full-house', 'four-of-a-kind', 'straight-flush',
    'royal-flush'
  )),
  constraint multiplayer_gambit_rewards_coin_check check (
    stolen_coins >= 0 and doubled_coins >= 0
    and self_coins_after >= 0 and opponent_coins_after >= 0
  )
);

alter table app_private.multiplayer_gambit_state enable row level security;
alter table app_private.multiplayer_gambit_state force row level security;
alter table app_private.multiplayer_gambit_rewards enable row level security;
alter table app_private.multiplayer_gambit_rewards force row level security;
revoke all on table app_private.multiplayer_gambit_state
  from public, anon, authenticated;
revoke all on table app_private.multiplayer_gambit_rewards
  from public, anon, authenticated;

comment on table app_private.multiplayer_gambit_state is
  'Private server-owned Gambit deck. Clients receive only their current hand.';
comment on table app_private.multiplayer_gambit_rewards is
  'Private idempotency ledger for one server-evaluated Gambit reward per wave.';

create or replace function app_private.gambit_full_deck()
returns text[]
language sql
immutable
security definer
set search_path = ''
as $$
  select array_agg(suit || '-' || rank order by suit_order, rank_order)
  from unnest(array['clubs','diamonds','hearts','spades'])
    with ordinality as suits(suit, suit_order)
  cross join unnest(array['2','3','4','5','6','7','8','9','10','J','Q','K','A'])
    with ordinality as ranks(rank, rank_order);
$$;

create or replace function app_private.gambit_shuffle(
  p_cards text[],
  p_nonce uuid
)
returns text[]
language sql
immutable
security definer
set search_path = ''
as $$
  select coalesce(
    array_agg(card order by md5(p_nonce::text || ':' || card)),
    array[]::text[]
  )
  from unnest(coalesce(p_cards, array[]::text[])) as cards(card);
$$;

create or replace function app_private.gambit_rank_value(p_rank text)
returns integer
language sql
immutable
security definer
set search_path = ''
as $$
  select case p_rank
    when 'J' then 11 when 'Q' then 12 when 'K' then 13 when 'A' then 14
    else p_rank::integer
  end;
$$;

create or replace function app_private.gambit_hand_strength(p_hand text)
returns integer
language sql
immutable
security definer
set search_path = ''
as $$
  select case p_hand
    when 'high-card' then 0 when 'pair' then 1 when 'two-pair' then 2
    when 'three-of-a-kind' then 3 when 'straight' then 4 when 'flush' then 5
    when 'full-house' then 6 when 'four-of-a-kind' then 7
    when 'straight-flush' then 8 when 'royal-flush' then 9 else -1 end;
$$;

create or replace function app_private.gambit_five_card_hand(p_cards text[])
returns text
language plpgsql
immutable
security definer
set search_path = ''
as $$
declare
  v_ranks integer[];
  v_groups integer[];
  v_flush boolean;
  v_straight boolean;
  v_royal boolean;
begin
  if cardinality(p_cards) <> 5 then
    raise exception 'A poker hand must contain exactly five cards';
  end if;
  select array_agg(distinct app_private.gambit_rank_value(
           split_part(card, '-', 2)
         ) order by app_private.gambit_rank_value(split_part(card, '-', 2)))
  into v_ranks
  from unnest(p_cards) as cards(card);
  select array_agg(amount order by amount desc)
  into v_groups
  from (
    select count(*)::integer as amount
    from unnest(p_cards) as cards(card)
    group by split_part(card, '-', 2)
  ) grouped;
  select count(distinct split_part(card, '-', 1)) = 1
  into v_flush
  from unnest(p_cards) as cards(card);
  v_straight := cardinality(v_ranks) = 5 and (
    v_ranks = array[2,3,4,5,14]
    or v_ranks[5] - v_ranks[1] = 4
  );
  v_royal := v_straight and v_flush
    and v_ranks = array[10,11,12,13,14];
  if v_royal then return 'royal-flush'; end if;
  if v_straight and v_flush then return 'straight-flush'; end if;
  if v_groups[1] = 4 then return 'four-of-a-kind'; end if;
  if v_groups[1] = 3 and v_groups[2] = 2 then return 'full-house'; end if;
  if v_flush then return 'flush'; end if;
  if v_straight then return 'straight'; end if;
  if v_groups[1] = 3 then return 'three-of-a-kind'; end if;
  if v_groups[1] = 2 and v_groups[2] = 2 then return 'two-pair'; end if;
  if v_groups[1] = 2 then return 'pair'; end if;
  return 'high-card';
end;
$$;

create or replace function app_private.gambit_best_hand(p_cards text[])
returns text
language plpgsql
immutable
security definer
set search_path = ''
as $$
declare
  v_count integer := cardinality(p_cards);
  v_best text := 'high-card';
  v_candidate text;
  a integer;
  b integer;
  c integer;
  d integer;
  e integer;
begin
  if v_count < 5 or v_count > 10 then return null; end if;
  for a in 1..v_count - 4 loop
    for b in a + 1..v_count - 3 loop
      for c in b + 1..v_count - 2 loop
        for d in c + 1..v_count - 1 loop
          for e in d + 1..v_count loop
            v_candidate := app_private.gambit_five_card_hand(array[
              p_cards[a], p_cards[b], p_cards[c], p_cards[d], p_cards[e]
            ]);
            if app_private.gambit_hand_strength(v_candidate)
               > app_private.gambit_hand_strength(v_best) then
              v_best := v_candidate;
            end if;
          end loop;
        end loop;
      end loop;
    end loop;
  end loop;
  return v_best;
end;
$$;

create or replace function app_private.gambit_reward_label(p_hand text)
returns text
language sql
immutable
security definer
set search_path = ''
as $$
  select case p_hand
    when 'high-card' then 'HIGH CARD · +5% SCORE THIS WAVE'
    when 'pair' then 'PAIR · +15% SCORE · 30% LESS DAMAGE THIS WAVE'
    when 'two-pair' then 'TWO PAIR · HEAL FULL · STEAL 25% COINS · +30% SCORE'
    when 'three-of-a-kind' then 'THREE OF A KIND · 75% LESS DAMAGE THIS WAVE'
    when 'straight' then 'STRAIGHT · SET 5 HP · MAX HP 4 · +50% SCORE'
    when 'flush' then 'FLUSH · SET 1 HP · 95% LESS DAMAGE THIS WAVE'
    when 'full-house' then 'FULL HOUSE · THREE-OF-A-KIND REWARD'
    when 'four-of-a-kind' then 'FOUR OF A KIND · SET 10 HP'
    when 'straight-flush' then 'STRAIGHT FLUSH · INVINCIBLE · ×3 SCORE · ×2 SENDS THIS WAVE'
    when 'royal-flush' then 'ROYAL FLUSH · 10 MAX HP · TAKE AND DOUBLE COINS'
    else 'COUNTING CARDS'
  end;
$$;

create or replace function app_private.gambit_public_state(
  p_match_id uuid,
  p_user_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_state app_private.multiplayer_gambit_state;
  v_cards jsonb := '[]'::jsonb;
  v_rewards jsonb := '[]'::jsonb;
begin
  select * into v_state
  from app_private.multiplayer_gambit_state state_row
  where state_row.match_id = p_match_id and state_row.user_id = p_user_id;
  if v_state.user_id is not null then
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', card,
      'suit', split_part(card, '-', 1),
      'rank', split_part(card, '-', 2)
    ) order by position), '[]'::jsonb)
    into v_cards
    from unnest(v_state.hand) with ordinality as cards(card, position);
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'wave', reward.wave,
    'hand', reward.best_hand,
    'label', app_private.gambit_reward_label(reward.best_hand),
    'stolen_coins', reward.stolen_coins,
    'doubled_coins', reward.doubled_coins
  ) order by reward.wave), '[]'::jsonb)
  into v_rewards
  from app_private.multiplayer_gambit_rewards reward
  where reward.match_id = p_match_id and reward.user_id = p_user_id;
  return jsonb_build_object(
    'hand', v_cards,
    'hand_size', coalesce(cardinality(v_state.hand), 0),
    'draw_remaining', coalesce(cardinality(v_state.draw_pile), 52),
    'discard_count', coalesce(cardinality(v_state.discard_pile), 0),
    'deck_cycle', coalesce(v_state.deck_cycle, 0),
    'last_draw_wave', coalesce(v_state.last_draw_wave, 0),
    'best_hand', case when v_state.user_id is null then null
      else app_private.gambit_best_hand(v_state.hand) end,
    'reward_history', v_rewards
  );
end;
$$;

create or replace function public.get_1v1_gambit_state(p_match_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_self public.multiplayer_players;
begin
  if v_uid is null then raise exception 'Sign in required'; end if;
  select * into v_self from public.multiplayer_players player
  where player.match_id = p_match_id and player.user_id = v_uid;
  if v_self.user_id is null then raise exception '1v1 match not found'; end if;
  if v_self.character_key <> 'trickster_gambit' then
    raise exception 'Counting Cards belongs to Gambit';
  end if;
  return app_private.gambit_public_state(p_match_id, v_uid);
end;
$$;

create or replace function public.discard_1v1_gambit_cards(
  p_match_id uuid,
  p_card_ids text[]
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_match public.multiplayer_matches;
  v_self public.multiplayer_players;
  v_state app_private.multiplayer_gambit_state;
  v_distinct_count integer;
begin
  if v_uid is null then raise exception 'Sign in required'; end if;
  if cardinality(coalesce(p_card_ids, array[]::text[])) not between 1 and 10 then
    raise exception 'Choose between 1 and 10 cards to discard';
  end if;
  select count(distinct card) into v_distinct_count
  from unnest(p_card_ids) as cards(card);
  if v_distinct_count <> cardinality(p_card_ids) then
    raise exception 'Each discarded card must be unique';
  end if;
  select * into v_match from public.multiplayer_matches match_row
  where match_row.id = p_match_id for update;
  perform 1 from public.multiplayer_players player
  where player.match_id = p_match_id order by player.slot for update;
  select * into v_self from public.multiplayer_players player
  where player.match_id = p_match_id and player.user_id = v_uid;
  if v_match.id is null or v_self.user_id is null then
    raise exception '1v1 match not found';
  end if;
  if v_self.character_key <> 'trickster_gambit' then
    raise exception 'Counting Cards belongs to Gambit';
  end if;
  if v_match.status not in ('countdown','playing','intermission')
     or v_self.status in ('eliminated','left','finished') then
    raise exception 'Cards cannot be changed after this run';
  end if;
  select * into v_state from app_private.multiplayer_gambit_state state_row
  where state_row.match_id = p_match_id and state_row.user_id = v_uid
  for update;
  if v_state.user_id is null then
    raise exception 'Draw the first Gambit hand before discarding';
  end if;
  if exists (
    select 1 from unnest(p_card_ids) as chosen(card)
    where not (chosen.card = any(v_state.hand))
  ) then
    raise exception 'A selected card is not in your current hand';
  end if;
  update app_private.multiplayer_gambit_state state_row
  set hand = array(
        select card from unnest(state_row.hand) with ordinality held(card, pos)
        where not (card = any(p_card_ids)) order by pos
      ),
      discard_pile = state_row.discard_pile || p_card_ids,
      updated_at = now()
  where state_row.match_id = p_match_id and state_row.user_id = v_uid;
  return app_private.gambit_public_state(p_match_id, v_uid)
    || jsonb_build_object('discarded_count', cardinality(p_card_ids));
end;
$$;

create or replace function public.draw_1v1_gambit_wave(
  p_match_id uuid,
  p_wave integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_match public.multiplayer_matches;
  v_self public.multiplayer_players;
  v_opponent public.multiplayer_players;
  v_state app_private.multiplayer_gambit_state;
  v_card text;
  v_hand text[];
  v_draw text[];
  v_discard text[];
  v_cycle integer;
  v_index integer;
  v_hand_name text;
  v_reward_inserted boolean := false;
  v_stolen numeric := 0;
  v_doubled numeric := 0;
  v_self_after numeric := 0;
  v_opponent_after numeric := 0;
begin
  if v_uid is null then raise exception 'Sign in required'; end if;
  if p_wave is null or p_wave < 1 then raise exception 'Invalid Gambit wave'; end if;
  select * into v_match from public.multiplayer_matches match_row
  where match_row.id = p_match_id for update;
  perform 1 from public.multiplayer_players player
  where player.match_id = p_match_id order by player.slot for update;
  select * into v_self from public.multiplayer_players player
  where player.match_id = p_match_id and player.user_id = v_uid;
  select * into v_opponent from public.multiplayer_players player
  where player.match_id = p_match_id and player.user_id <> v_uid limit 1;
  if v_match.id is null or v_self.user_id is null or v_opponent.user_id is null then
    raise exception '1v1 match not found';
  end if;
  if v_self.character_key <> 'trickster_gambit' then
    raise exception 'Counting Cards belongs to Gambit';
  end if;
  if v_match.status not in ('countdown','playing')
     or v_self.status <> 'playing' then
    raise exception 'Gambit draws only at the start of a live wave';
  end if;
  if p_wave <> v_self.wave or p_wave < v_match.current_wave then
    raise exception 'That Gambit wave is not active';
  end if;

  insert into app_private.multiplayer_gambit_state(
    match_id, user_id, draw_pile
  ) values (
    p_match_id, v_uid,
    app_private.gambit_shuffle(
      app_private.gambit_full_deck(), gen_random_uuid()
    )
  ) on conflict (match_id, user_id) do nothing;
  select * into v_state from app_private.multiplayer_gambit_state state_row
  where state_row.match_id = p_match_id and state_row.user_id = v_uid
  for update;

  if v_state.last_draw_wave >= p_wave then
    return app_private.gambit_public_state(p_match_id, v_uid)
      || jsonb_build_object('reward_applied', false, 'duplicate', true);
  end if;
  if cardinality(v_state.hand) > 5 then
    return app_private.gambit_public_state(p_match_id, v_uid)
      || jsonb_build_object(
        'reward_applied', false,
        'discard_required', cardinality(v_state.hand) - 5
      );
  end if;

  v_hand := v_state.hand;
  v_draw := v_state.draw_pile;
  v_discard := v_state.discard_pile;
  v_cycle := v_state.deck_cycle;
  for v_index in 1..5 loop
    if cardinality(v_draw) = 0 then
      if cardinality(v_discard) = 0 then
        raise exception 'Gambit deck state is incomplete';
      end if;
      v_cycle := v_cycle + 1;
      v_draw := app_private.gambit_shuffle(v_discard, gen_random_uuid());
      v_discard := array[]::text[];
    end if;
    v_card := v_draw[1];
    v_draw := coalesce(v_draw[2:cardinality(v_draw)], array[]::text[]);
    v_hand := array_append(v_hand, v_card);
  end loop;
  if cardinality(v_hand) > 10 then raise exception 'Gambit hand exceeded 10 cards'; end if;
  v_hand_name := app_private.gambit_best_hand(v_hand);

  update app_private.multiplayer_gambit_state state_row
  set deck_cycle = v_cycle, draw_pile = v_draw, discard_pile = v_discard,
      hand = v_hand, last_draw_wave = p_wave, updated_at = now()
  where state_row.match_id = p_match_id and state_row.user_id = v_uid;

  insert into app_private.multiplayer_gambit_rewards(
    match_id, user_id, wave, best_hand
  ) values (p_match_id, v_uid, p_wave, v_hand_name)
  on conflict (match_id, user_id, wave) do nothing
  returning true into v_reward_inserted;
  v_reward_inserted := coalesce(v_reward_inserted, false);

  if v_reward_inserted and v_hand_name in ('two-pair','royal-flush') then
    if v_hand_name = 'two-pair' then
      v_stolen := round(v_opponent.obstacle_points * 0.25, 4);
      v_self_after := least(1000000000::numeric,
        v_self.obstacle_points + v_stolen);
      v_stolen := v_self_after - v_self.obstacle_points;
      v_opponent_after := v_opponent.obstacle_points - v_stolen;
    else
      v_stolen := v_opponent.obstacle_points;
      v_opponent_after := 0;
      v_self_after := least(1000000000::numeric,
        (v_self.obstacle_points + v_stolen) * 2);
      v_doubled := greatest(0,
        v_self_after - (v_self.obstacle_points + v_stolen));
    end if;
    perform set_config(
      'app_private.skip_1v1_point_multiplier', 'on', true
    );
    update public.multiplayer_players player
    set obstacle_points = case
          when player.user_id = v_uid then v_self_after
          else v_opponent_after
        end,
        updated_at = now()
    where player.match_id = p_match_id
      and player.user_id in (v_uid, v_opponent.user_id);
    perform set_config(
      'app_private.skip_1v1_point_multiplier', 'off', true
    );
  else
    v_self_after := v_self.obstacle_points;
    v_opponent_after := v_opponent.obstacle_points;
  end if;
  if v_reward_inserted then
    update app_private.multiplayer_gambit_rewards reward
    set stolen_coins = v_stolen, doubled_coins = v_doubled,
        self_coins_after = v_self_after,
        opponent_coins_after = v_opponent_after
    where reward.match_id = p_match_id and reward.user_id = v_uid
      and reward.wave = p_wave;
  end if;
  update public.multiplayer_matches match_row set last_activity_at = now()
  where match_row.id = p_match_id;
  return app_private.gambit_public_state(p_match_id, v_uid)
    || jsonb_build_object(
      'reward_applied', v_reward_inserted,
      'reward_wave', p_wave,
      'reward_hand', v_hand_name,
      'reward_label', app_private.gambit_reward_label(v_hand_name),
      'stolen_coins', v_stolen,
      'doubled_coins', v_doubled,
      'self_coins', v_self_after,
      'opponent_coins', v_opponent_after
    );
end;
$$;

-- Preserve the newest Comet/Mirage sender, then add only Gambit's free copy.
-- Reruns keep the original delegate instead of wrapping this wrapper again.
do $gambit_send_delegate$
declare
  v_public regprocedure := to_regprocedure(
    'public.send_1v1_attack(uuid,text,integer)'
  );
  v_definition text;
  v_private_definition text;
begin
  v_definition := pg_get_functiondef(v_public);
  if position('app_private.send_1v1_attack_without_gambit' in v_definition) = 0 then
    v_private_definition := regexp_replace(
      v_definition,
      '^CREATE OR REPLACE FUNCTION public\.send_1v1_attack\(',
      'CREATE OR REPLACE FUNCTION app_private.send_1v1_attack_without_gambit(',
      'i'
    );
    if v_private_definition = v_definition then
      raise exception 'Could not preserve the current send_1v1_attack RPC';
    end if;
    execute v_private_definition;
  elsif to_regprocedure(
    'app_private.send_1v1_attack_without_gambit(uuid,text,integer)'
  ) is null then
    raise exception 'The Gambit attack delegate is missing';
  end if;
end;
$gambit_send_delegate$;

revoke all on function app_private.send_1v1_attack_without_gambit(
  uuid, text, integer
) from public, anon, authenticated;

alter table public.multiplayer_attacks
  drop constraint if exists multiplayer_attacks_source_check,
  drop constraint if exists multiplayer_attacks_source_cost_check;
alter table public.multiplayer_attacks
  add constraint multiplayer_attacks_source_check check (source in (
    'purchased', 'katana', 'comet_bonus', 'heatfeast_return', 'gambit_bonus'
  )) not valid,
  add constraint multiplayer_attacks_source_cost_check check (
    (source = 'purchased' and point_cost between 1 and 8)
    or (source in ('katana','comet_bonus','gambit_bonus') and point_cost = 0)
    or (source = 'heatfeast_return' and point_cost between 0 and 8)
  ) not valid;
alter table public.multiplayer_attacks
  validate constraint multiplayer_attacks_source_check;
alter table public.multiplayer_attacks
  validate constraint multiplayer_attacks_source_cost_check;

create or replace function public.send_1v1_attack(
  p_match_id uuid,
  p_obstacle_type text,
  p_cost integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_result jsonb;
  v_match public.multiplayer_matches;
  v_self public.multiplayer_players;
  v_target public.multiplayer_players;
  v_type text := lower(trim(p_obstacle_type));
  v_base_quantity integer;
  v_bonus_quantity integer := 0;
  v_returned integer := 0;
  v_total_returned integer := 0;
  v_index integer;
  v_attack_id uuid;
  v_attack_ids jsonb;
  v_placement record;
  v_actual_sender uuid;
  v_actual_target uuid;
  v_source text;
  v_split_count integer;
  v_heat_consumed numeric := 0;
begin
  if v_uid is null then raise exception 'Sign in required'; end if;
  v_result := app_private.send_1v1_attack_without_gambit(
    p_match_id, p_obstacle_type, p_cost
  );
  select * into v_match from public.multiplayer_matches match_row
  where match_row.id = p_match_id;
  select * into v_self from public.multiplayer_players player
  where player.match_id = p_match_id and player.user_id = v_uid;
  select * into v_target from public.multiplayer_players player
  where player.match_id = p_match_id and player.user_id <> v_uid limit 1;
  if v_type = 'spikes' then v_type := 'spike'; end if;
  v_base_quantity := greatest(1, coalesce((v_result->>'quantity')::integer, 1));
  v_total_returned := greatest(0,
    coalesce((v_result->>'returned_quantity')::integer, 0));
  v_attack_ids := coalesce(v_result->'attack_ids', '[]'::jsonb);

  -- A Straight Flush doubles only purchases made in the intermission directly
  -- after the reward wave. It never becomes a permanent send multiplier.
  if v_self.character_key = 'trickster_gambit'
     and v_match.status = 'intermission'
     and exists (
       select 1 from app_private.multiplayer_gambit_rewards reward
       where reward.match_id = p_match_id and reward.user_id = v_uid
         and reward.wave = greatest(1, v_match.current_wave - 1)
         and reward.best_hand = 'straight-flush'
     ) then
    v_bonus_quantity := v_base_quantity;
  end if;
  if v_bonus_quantity = 0 then return v_result; end if;

  if v_target.character_key = 'runner_comet' then
    select coalesce(ledger.consumed, 0) into v_heat_consumed
    from public.multiplayer_heatfeast ledger
    where ledger.match_id = p_match_id;
  end if;
  for v_index in 1..v_bonus_quantity loop
    v_actual_sender := v_uid;
    v_actual_target := v_target.user_id;
    v_source := 'gambit_bonus';
    if v_target.character_key = 'runner_comet'
       and v_heat_consumed >= 1000 then
      insert into public.multiplayer_heatfeast_split_state(
        match_id, comet_user_id, wave, incoming_count, updated_at
      ) values (p_match_id, v_target.user_id, v_match.current_wave, 1, now())
      on conflict (match_id, comet_user_id, wave) do update
        set incoming_count =
              public.multiplayer_heatfeast_split_state.incoming_count + 1,
            updated_at = excluded.updated_at
      returning incoming_count into v_split_count;
      if mod(v_split_count, 2) = 0 then
        v_actual_sender := v_target.user_id;
        v_actual_target := v_uid;
        v_source := 'heatfeast_return';
        v_returned := v_returned + 1;
      end if;
    end if;
    select * into v_placement from app_private.next_1v1_attack_placement(
      p_match_id, v_actual_sender, v_actual_target, v_type
    );
    insert into public.multiplayer_attacks(
      match_id, sender_user_id, target_user_id, obstacle_type, point_cost,
      spawn_wave, source, lane_index, lane_group, lane_position,
      escape_lane_index, wall_parity, wall_lane_index, wall_size
    ) values (
      p_match_id, v_actual_sender, v_actual_target, v_type, 0,
      v_match.current_wave, v_source, v_placement.lane_index,
      v_placement.lane_group, v_placement.lane_position,
      v_placement.escape_lane_index, v_placement.wall_parity,
      v_placement.wall_lane_index, v_placement.wall_size
    ) returning id into v_attack_id;
    v_attack_ids := v_attack_ids || jsonb_build_array(v_attack_id);
  end loop;
  v_total_returned := v_total_returned + v_returned;
  return v_result || jsonb_build_object(
    'attack_ids', v_attack_ids,
    'quantity', v_base_quantity + v_bonus_quantity,
    'gambit_bonus_quantity', v_bonus_quantity,
    'returned_quantity', v_total_returned,
    'delivered_to_opponent_quantity',
      v_base_quantity + v_bonus_quantity - v_total_returned
  );
end;
$$;

revoke all on function app_private.gambit_full_deck()
  from public, anon, authenticated;
revoke all on function app_private.gambit_shuffle(text[], uuid)
  from public, anon, authenticated;
revoke all on function app_private.gambit_rank_value(text)
  from public, anon, authenticated;
revoke all on function app_private.gambit_hand_strength(text)
  from public, anon, authenticated;
revoke all on function app_private.gambit_five_card_hand(text[])
  from public, anon, authenticated;
revoke all on function app_private.gambit_best_hand(text[])
  from public, anon, authenticated;
revoke all on function app_private.gambit_reward_label(text)
  from public, anon, authenticated;
revoke all on function app_private.gambit_public_state(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.get_1v1_gambit_state(uuid)
  from public, anon, authenticated;
revoke all on function public.discard_1v1_gambit_cards(uuid, text[])
  from public, anon, authenticated;
revoke all on function public.draw_1v1_gambit_wave(uuid, integer)
  from public, anon, authenticated;
revoke all on function public.send_1v1_attack(uuid, text, integer)
  from public, anon, authenticated;
grant execute on function public.get_1v1_gambit_state(uuid)
  to authenticated;
grant execute on function public.discard_1v1_gambit_cards(uuid, text[])
  to authenticated;
grant execute on function public.draw_1v1_gambit_wave(uuid, integer)
  to authenticated;
grant execute on function public.send_1v1_attack(uuid, text, integer)
  to authenticated;

do $gambit_installation_assertions$
begin
  if has_table_privilege(
       'authenticated', 'app_private.multiplayer_gambit_state', 'SELECT'
     )
     or has_table_privilege(
       'authenticated', 'app_private.multiplayer_gambit_rewards', 'SELECT'
     ) then
    raise exception 'Gambit private state is exposed';
  end if;
  if position(
       $$reward.best_hand = 'straight-flush'$$ in pg_get_functiondef(
         'public.send_1v1_attack(uuid,text,integer)'::regprocedure
       )
     ) = 0 then
    raise exception 'Gambit one-wave send multiplier is missing';
  end if;
  if position(
       $$app_private.send_1v1_attack_without_gambit$$ in pg_get_functiondef(
         'public.send_1v1_attack(uuid,text,integer)'::regprocedure
       )
     ) = 0
     or position(
       $$when 'snowflake' then 4$$ in pg_get_functiondef(
         'app_private.send_1v1_attack_without_gambit(uuid,text,integer)'::regprocedure
       )
     ) = 0
     or position(
       $$when 'current' then 8$$ in pg_get_functiondef(
         'app_private.send_1v1_attack_without_gambit(uuid,text,integer)'::regprocedure
       )
     ) = 0
     or position(
       $$when 'car' then$$ in pg_get_functiondef(
         'app_private.send_1v1_attack_without_gambit(uuid,text,integer)'::regprocedure
       )
     ) > 0 then
    raise exception 'Gambit delegate does not own the current armory rules';
  end if;
end;
$gambit_installation_assertions$;

notify pgrst, 'reload schema';
commit;

select
  to_regprocedure('public.get_1v1_gambit_state(uuid)') is not null
    as gambit_state_installed,
  to_regprocedure('public.draw_1v1_gambit_wave(uuid,integer)') is not null
    as gambit_draw_installed,
  to_regprocedure('public.discard_1v1_gambit_cards(uuid,text[])') is not null
    as gambit_discard_installed,
  not has_table_privilege(
    'authenticated', 'app_private.multiplayer_gambit_state', 'SELECT'
  ) as gambit_deck_private;
