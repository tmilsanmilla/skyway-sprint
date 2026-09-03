-- Leaderboard 02 — allow QTY 1-100 for both extraction products.
--
-- `pull_count` is the number of boxes requested. A regular box contains one
-- item and costs 4 gems; a ten box contains ten items and costs 40 gems. This
-- preserves compatibility with the previous client call of 10 regular boxes:
-- extract_items(10, 'regular') still returns 10 items and costs 40 gems.

begin;

-- A stale one-argument overload can otherwise bypass current pricing or make
-- PostgREST RPC resolution ambiguous when the optional box_type is omitted.
drop function if exists public.extract_items(integer);

create or replace function public.extract_items(
  pull_count integer,
  box_type text default 'regular'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_box text := lower(trim(coalesce(box_type, '')));
  v_item_cost constant integer := 4;
  v_max_box_quantity constant integer := 100;
  v_items_per_box integer;
  v_box_cost integer;
  v_total_pulls integer;
  v_cost bigint;
  v_balance_before bigint;
  v_gems bigint;
  v_pull integer;
  v_draw_profile text;
  v_category text;
  v_rarity text;
  v_item_key text;
  v_item_type text;
  v_display_name text;
  v_character_class text;
  v_is_new boolean;
  v_inserted integer;
  v_results jsonb := '[]'::jsonb;
begin
  if v_uid is null then
    raise exception 'Sign in required';
  end if;
  if v_box = 'legendary' then
    raise exception 'Standalone Legendary Boxes are no longer available';
  end if;
  if v_box not in ('regular', 'ten') then
    raise exception 'Box type must be regular or ten';
  end if;
  if pull_count is null or pull_count < 1 then
    raise exception 'Choose at least 1 box';
  end if;
  if pull_count > v_max_box_quantity then
    raise exception 'Choose no more than % boxes at once',
      v_max_box_quantity;
  end if;

  v_items_per_box := case when v_box = 'ten' then 10 else 1 end;
  v_box_cost := v_items_per_box * v_item_cost;
  v_total_pulls := pull_count * v_items_per_box;
  v_cost := pull_count::bigint * v_box_cost::bigint;

  insert into public.player_stats(user_id, total_gems, high_score, updated_at)
  values (v_uid, 0, 0, now())
  on conflict (user_id) do nothing;

  -- Serialize purchases per account. Balance validation, the single balance
  -- deduction, all unlock attempts, and all receipts share this transaction.
  select stats.total_gems
  into v_gems
  from public.player_stats stats
  where stats.user_id = v_uid
  for update;

  v_balance_before := v_gems;

  if v_gems < v_cost then
    raise exception 'Not enough gems';
  end if;

  update public.player_stats
  set total_gems = total_gems - v_cost,
      updated_at = now()
  where user_id = v_uid
  returning total_gems into v_gems;

  for v_pull in 1..v_total_pulls loop
    -- Every tenth item in the atomic request receives the bonus profile. Thus
    -- each ten box has one bonus item, while 10 regular boxes retain the same
    -- tenth-item bonus behavior as the previous API.
    v_draw_profile := case
      when mod(v_pull, 10) = 0 then 'legendary'
      else 'regular'
    end;
    v_rarity := null;
    v_item_key := null;
    v_item_type := null;
    v_display_name := null;
    v_character_class := null;

    -- Bonus-profile items use the retired Legendary Box's 20/80 category mix.
    -- Owned items are not filtered, so duplicates remain possible by design.
    v_category := case
      when random() < case
        when v_draw_profile = 'legendary' then 0.20
        else 0.05
      end then 'character'
      else 'cosmetic'
    end;

    if not exists (
      select 1
      from public.extraction_catalog catalog
      where catalog.active
        and catalog.extractable
        and (
          (v_category = 'character' and catalog.item_type = 'character')
          or (v_category = 'cosmetic' and catalog.item_type <> 'character')
        )
    ) then
      v_category := case
        when v_category = 'character' then 'cosmetic'
        else 'character'
      end;
    end if;

    -- Normal weights total 100.36 and are intentionally normalized. Bonus
    -- weights total 100. Only tiers represented in the active catalog enter
    -- the draw, so catalog changes cannot produce an empty chosen tier.
    with weights(rarity, weight, sort_order) as (
      values
        ('common',    case when v_draw_profile = 'legendary' then  3.00 else 45.75 end::numeric, 1),
        ('uncommon',  case when v_draw_profile = 'legendary' then 12.00 else 30.20 end::numeric, 2),
        ('rare',      case when v_draw_profile = 'legendary' then 40.30 else 15.40 end::numeric, 3),
        ('epic',      case when v_draw_profile = 'legendary' then 41.50 else  8.00 end::numeric, 4),
        ('legendary', case when v_draw_profile = 'legendary' then  3.00 else  1.00 end::numeric, 5),
        ('mythic',    case when v_draw_profile = 'legendary' then  0.20 else  0.01 end::numeric, 6)
    ),
    available as (
      select weights.rarity, weights.weight, weights.sort_order
      from weights
      where exists (
        select 1
        from public.extraction_catalog catalog
        where catalog.active
          and catalog.extractable
          and catalog.rarity = weights.rarity
          and (
            (v_category = 'character' and catalog.item_type = 'character')
            or (v_category = 'cosmetic' and catalog.item_type <> 'character')
          )
      )
    ),
    total as (
      select sum(available.weight) as weight
      from available
    ),
    draw as (
      select random() * total.weight::double precision as value
      from total
    ),
    cumulative as (
      select
        available.rarity,
        available.sort_order,
        sum(available.weight) over (
          order by available.sort_order
        )::double precision as ceiling
      from available
    )
    select cumulative.rarity
    into v_rarity
    from cumulative
    cross join draw
    where draw.value < cumulative.ceiling
    order by cumulative.sort_order
    limit 1;

    if v_rarity is null then
      raise exception 'No extraction item is available for this box';
    end if;

    select
      catalog.item_key,
      catalog.item_type,
      catalog.display_name,
      catalog.character_class
    into
      v_item_key,
      v_item_type,
      v_display_name,
      v_character_class
    from public.extraction_catalog catalog
    where catalog.active
      and catalog.extractable
      and catalog.rarity = v_rarity
      and (
        (v_category = 'character' and catalog.item_type = 'character')
        or (v_category = 'cosmetic' and catalog.item_type <> 'character')
      )
    order by random()
    limit 1;

    if v_item_key is null then
      raise exception 'No extraction item is available for this rarity';
    end if;

    insert into public.player_unlocks(
      user_id, item_key, item_type, rarity, unlocked_at
    ) values (
      v_uid, v_item_key, v_item_type, v_rarity, now()
    )
    on conflict (user_id, item_key) do nothing;

    get diagnostics v_inserted = row_count;
    v_is_new := v_inserted = 1;

    -- One exact receipt per paid item keeps balances auditable even though the
    -- account balance is deducted once. `legendary` records only odds profile.
    insert into public.extraction_transactions (
      user_id,
      box_type,
      gem_cost,
      balance_before,
      balance_after,
      item_key,
      item_type,
      rarity,
      is_new
    ) values (
      v_uid,
      v_draw_profile,
      v_item_cost,
      v_balance_before - ((v_pull - 1)::bigint * v_item_cost::bigint),
      v_balance_before - (v_pull::bigint * v_item_cost::bigint),
      v_item_key,
      v_item_type,
      v_rarity,
      v_is_new
    );

    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'pull_number', v_pull,
      'box_number', ((v_pull - 1) / v_items_per_box) + 1,
      'item_in_box', mod(v_pull - 1, v_items_per_box) + 1,
      'draw_profile', v_draw_profile,
      'item_key', v_item_key,
      'display_name', v_display_name,
      'item_type', v_item_type,
      'category', v_category,
      'character_class', v_character_class,
      'rarity', v_rarity,
      'is_new', v_is_new
    ));
  end loop;

  return jsonb_build_object(
    'box_type', v_box,
    'box_quantity', pull_count,
    'items_per_box', v_items_per_box,
    'pull_count', v_total_pulls,
    'item_count', v_total_pulls,
    'item_cost', v_item_cost,
    'box_cost', v_box_cost,
    'cost', v_cost,
    'max_box_quantity', v_max_box_quantity,
    'max_items_per_request', v_max_box_quantity * 10,
    'max_affordable_box_quantity', least(
      v_max_box_quantity::bigint,
      v_gems / v_box_cost::bigint
    ),
    'gems', v_gems,
    'results', v_results
  );
end;
$$;

comment on function public.extract_items(integer, text) is
  'Atomic QTY 1-100 box extraction. Regular boxes contain 1 item for 4 gems; ten boxes contain 10 items for 40 gems. Every tenth item uses bonus Legendary odds without uniqueness protection.';

comment on column public.extraction_transactions.box_type is
  'Odds profile used by a paid item: regular, or legendary for every tenth item in an extraction request. Standalone Legendary Boxes remain disabled.';

-- CREATE OR REPLACE preserves old privileges, so clear every application role
-- before restoring only the authenticated RPC grant.
revoke all on function public.extract_items(integer, text)
  from public, anon, authenticated;
grant execute on function public.extract_items(integer, text)
  to authenticated;

notify pgrst, 'reload schema';

commit;
