-- Leaderboard 02 — variable-quantity Normal Box extraction.
--
-- Normal pulls cost 4 gems each, so ten pulls cost 40 gems. Players may open
-- between 1 and 100 boxes per request, provided the locked account balance can
-- afford the full quantity. Every tenth pull in the request uses the former
-- Legendary Box odds profile, but it may still be a duplicate.

begin;

-- Remove the obsolete one-argument overload if a manually provisioned database
-- still has it. Leaving it in place could expose stale pricing and make RPC
-- resolution ambiguous for clients that omit box_type.
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
  v_unit_cost constant integer := 4;
  v_max_per_request constant integer := 100;
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
  if v_box <> 'regular' then
    raise exception 'Box type must be regular';
  end if;
  if pull_count is null or pull_count < 1 then
    raise exception 'Choose at least 1 Normal Box extract';
  end if;
  if pull_count > v_max_per_request then
    raise exception 'Choose no more than % Normal Box extracts at once',
      v_max_per_request;
  end if;

  v_cost := pull_count::bigint * v_unit_cost::bigint;

  insert into public.player_stats(user_id, total_gems, high_score, updated_at)
  values (v_uid, 0, 0, now())
  on conflict (user_id) do nothing;

  -- Serialize extraction purchases for this account. The balance deduction,
  -- unlock attempts, and all per-pull receipts share one database transaction.
  select stats.total_gems
  into v_gems
  from public.player_stats stats
  where stats.user_id = v_uid
  for update;

  v_balance_before := v_gems;

  if pull_count::bigint > v_gems / v_unit_cost::bigint then
    raise exception 'Not enough gems';
  end if;

  update public.player_stats
  set total_gems = total_gems - v_cost,
      updated_at = now()
  where user_id = v_uid
  returning total_gems into v_gems;

  for v_pull in 1..pull_count loop
    -- A complete group of ten keeps the existing tenth-pull bonus profile.
    -- This means 5 pulls are all Normal odds, 10 has one bonus pull, and 20
    -- has bonus pulls at positions 10 and 20.
    v_draw_profile := case
      when mod(v_pull, 10) = 0 then 'legendary'
      else 'regular'
    end;
    v_rarity := null;
    v_item_key := null;
    v_item_type := null;
    v_display_name := null;
    v_character_class := null;

    -- Bonus-profile pulls use the former Legendary Box's 20/80 category mix.
    -- No pull filters owned items, so every pull can be a duplicate.
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

    -- Normal weights total 100.36 and are intentionally normalized. The
    -- tenth-pull bonus profile totals exactly 100.
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

    -- Keep one exact receipt per paid pull. The `legendary` value records the
    -- odds profile only; standalone Legendary Boxes remain disabled.
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
      v_unit_cost,
      v_balance_before - ((v_pull - 1)::bigint * v_unit_cost::bigint),
      v_balance_before - (v_pull::bigint * v_unit_cost::bigint),
      v_item_key,
      v_item_type,
      v_rarity,
      v_is_new
    );

    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'pull_number', v_pull,
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
    'box_type', 'regular',
    'pull_count', pull_count,
    'unit_cost', v_unit_cost,
    'cost', v_cost,
    'max_per_request', v_max_per_request,
    'gems', v_gems,
    'results', v_results
  );
end;
$$;

comment on function public.extract_items(integer, text) is
  'Atomic 1-100 Normal Box extraction at 4 gems per pull. Every tenth pull uses the bonus Legendary odds profile without uniqueness protection.';

comment on column public.extraction_transactions.box_type is
  'Odds profile used by a paid pull: regular, or legendary for every tenth pull in a multi-open request. Standalone Legendary Boxes are disabled.';

revoke all on function public.extract_items(integer, text)
  from public, anon;
grant execute on function public.extract_items(integer, text)
  to authenticated;

notify pgrst, 'reload schema';

commit;
