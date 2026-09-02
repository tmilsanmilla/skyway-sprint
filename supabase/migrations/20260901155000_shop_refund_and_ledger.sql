-- Shop Refund + Transaction Ledger
--
-- Historical shop code deducted gems directly from player_stats and did not
-- retain a purchase ledger. Regular-box duplicates also created no unlock row,
-- so the exact historical spend cannot be reconstructed from database tables.
--
-- This batch deliberately uses generous, audited maximum bounds:
--   * 8f1f3083-30f2-4085-a5a7-4edc0bfd7046 receives 152 gems:
--       five successful box calls * the maximum 20-gem box price (100), plus
--       four historical power-up calls * the maximum 13-gem price (52).
--   * The other two known players receive 52 gems each:
--       four possible historical power-up calls * 13 gems. Historical code did
--       not identify which account bought them, so both receive the full bound.
--
-- The compensation ledger makes the batch exactly-once even if this migration
-- is rerun. The extraction ledger records every future paid pull, including a
-- duplicate that grants no item, so later refunds can be calculated exactly.

begin;

create table if not exists public.admin_compensation_ledger (
  batch_key text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  amount bigint not null check (amount > 0),
  reason text not null,
  created_at timestamptz not null default now(),
  primary key (batch_key, user_id)
);

comment on table public.admin_compensation_ledger is
  'Server-only exactly-once credits. The batch/user key prevents duplicate compensation.';

alter table public.admin_compensation_ledger enable row level security;
revoke all on table public.admin_compensation_ledger
  from public, anon, authenticated;

create table if not exists public.extraction_transactions (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  box_type text not null check (box_type in ('regular', 'legendary')),
  gem_cost integer not null check (gem_cost > 0),
  balance_before bigint not null check (balance_before >= 0),
  balance_after bigint not null check (balance_after >= 0),
  item_key text not null,
  item_type text not null
    check (item_type in ('character', 'player', 'obstacle', 'environment')),
  rarity text not null
    check (rarity in ('common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic')),
  is_new boolean not null,
  created_at timestamptz not null default now()
);

comment on table public.extraction_transactions is
  'Server-only paid-pull ledger. Includes duplicate pulls so future refunds are exact.';

alter table public.extraction_transactions enable row level security;
revoke all on table public.extraction_transactions
  from public, anon, authenticated;

-- The pre-game power-up shop was removed from the client. Remove its legacy
-- RPC too, so boxes are the only remaining gem purchase and every future gem
-- spend is represented in extraction_transactions.
drop function if exists public.buy_powerup(text);

create index if not exists extraction_transactions_user_created_idx
  on public.extraction_transactions (user_id, created_at desc);

-- Credit only ledger rows inserted by this execution. If the batch already
-- exists, ON CONFLICT returns nothing and no player balance is changed.
with requested_refunds(user_id, amount, reason) as (
  values
    (
      '8f1f3083-30f2-4085-a5a7-4edc0bfd7046'::uuid,
      152::bigint,
      'Maximum-bound refund: 5 box calls at 20 gems plus 4 power-up calls at 13 gems'
    ),
    (
      '2643716b-0dca-4c11-9223-c4ca50ad5932'::uuid,
      52::bigint,
      'Maximum-bound refund: 4 unattributed power-up calls at 13 gems'
    ),
    (
      '64cc241e-e96f-4b57-9294-c41d94bd1130'::uuid,
      52::bigint,
      'Maximum-bound refund: 4 unattributed power-up calls at 13 gems'
    )
),
credited as (
  insert into public.admin_compensation_ledger (
    batch_key, user_id, amount, reason
  )
  select
    'shop-refund-2026-09-01-max-bound',
    requested_refunds.user_id,
    requested_refunds.amount,
    requested_refunds.reason
  from requested_refunds
  join auth.users users on users.id = requested_refunds.user_id
  on conflict (batch_key, user_id) do nothing
  returning user_id, amount
)
insert into public.player_stats (user_id, total_gems, high_score, updated_at)
select credited.user_id, credited.amount, 0, now()
from credited
on conflict (user_id) do update
set total_gems = public.player_stats.total_gems + excluded.total_gems,
    updated_at = now();

-- Preserve the current single-pull box behavior while adding an authoritative
-- transaction row after every successful paid pull. Because the RPC runs in a
-- database transaction, a ledger insertion failure also rolls back gem spend
-- and item ownership.
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
  v_cost integer;
  v_balance_before bigint;
  v_gems bigint;
  v_category text;
  v_rarity text;
  v_item_key text;
  v_item_type text;
  v_display_name text;
  v_character_class text;
  v_is_unique boolean;
  v_is_new boolean;
  v_inserted integer;
begin
  if v_uid is null then
    raise exception 'Sign in required';
  end if;
  if pull_count <> 1 then
    raise exception 'Only single-item boxes are available';
  end if;
  if v_box not in ('regular', 'legendary') then
    raise exception 'Box type must be regular or legendary';
  end if;

  v_cost := case when v_box = 'legendary' then 20 else 2 end;
  v_is_unique := v_box = 'legendary';

  insert into public.player_stats(user_id, total_gems, high_score, updated_at)
  values (v_uid, 0, 0, now())
  on conflict (user_id) do nothing;

  -- Serialize extractions for this account so simultaneous requests cannot
  -- spend the same gems or grant a duplicate from a guaranteed-unique box.
  select stats.total_gems
  into v_gems
  from public.player_stats stats
  where stats.user_id = v_uid
  for update;

  v_balance_before := v_gems;

  if v_is_unique and not exists (
    select 1
    from public.extraction_catalog catalog
    where catalog.active
      and catalog.extractable
      and not exists (
        select 1
        from public.player_unlocks unlock
        where unlock.user_id = v_uid
          and unlock.item_key = catalog.item_key
      )
  ) then
    raise exception 'Collection complete: every extraction item is already owned';
  end if;

  if v_gems < v_cost then
    raise exception 'Not enough gems';
  end if;

  update public.player_stats
  set total_gems = total_gems - v_cost,
      updated_at = now()
  where user_id = v_uid
  returning total_gems into v_gems;

  -- Character/cosmetic category chance is evaluated before rarity. If a
  -- guaranteed box has exhausted its selected category, use the other category
  -- so the paid pull is still guaranteed to be new.
  v_category := case
    when random() < case when v_box = 'legendary' then 0.20 else 0.05 end
      then 'character'
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
      and (
        not v_is_unique
        or not exists (
          select 1
          from public.player_unlocks unlock
          where unlock.user_id = v_uid
            and unlock.item_key = catalog.item_key
        )
      )
  ) then
    v_category := case
      when v_category = 'character' then 'cosmetic'
      else 'character'
    end;
  end if;

  -- The requested regular values total 100.36, so they are treated as relative
  -- weights and normalized by this draw. Legendary weights total exactly 100.
  -- For guaranteed boxes, exhausted rarity tiers are removed and the remaining
  -- requested weights are normalized, ensuring the result is always unowned.
  with weights(rarity, weight, sort_order) as (
    values
      ('common',    case when v_box = 'legendary' then  3.00 else 45.75 end::numeric, 1),
      ('uncommon',  case when v_box = 'legendary' then 12.00 else 30.20 end::numeric, 2),
      ('rare',      case when v_box = 'legendary' then 40.30 else 15.40 end::numeric, 3),
      ('epic',      case when v_box = 'legendary' then 41.50 else  8.00 end::numeric, 4),
      ('legendary', case when v_box = 'legendary' then  3.00 else  1.00 end::numeric, 5),
      ('mythic',    case when v_box = 'legendary' then  0.20 else  0.01 end::numeric, 6)
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
        and (
          not v_is_unique
          or not exists (
            select 1
            from public.player_unlocks unlock
            where unlock.user_id = v_uid
              and unlock.item_key = catalog.item_key
          )
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
    and (
      not v_is_unique
      or not exists (
        select 1
        from public.player_unlocks unlock
        where unlock.user_id = v_uid
          and unlock.item_key = catalog.item_key
      )
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

  if v_is_unique and not v_is_new then
    -- The account row lock makes this unreachable through the RPC, but retain
    -- the assertion so a guaranteed box can never silently return a duplicate.
    raise exception 'Guaranteed extraction could not grant a unique item';
  end if;

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
    v_box,
    v_cost,
    v_balance_before,
    v_gems,
    v_item_key,
    v_item_type,
    v_rarity,
    v_is_new
  );

  return jsonb_build_object(
    'box_type', v_box,
    'cost', v_cost,
    'gems', v_gems,
    'results', jsonb_build_array(jsonb_build_object(
      'item_key', v_item_key,
      'display_name', v_display_name,
      'item_type', v_item_type,
      'category', v_category,
      'character_class', v_character_class,
      'rarity', v_rarity,
      'is_new', v_is_new
    ))
  );
end;
$$;

revoke all on function public.extract_items(integer, text)
  from public, anon;
grant execute on function public.extract_items(integer, text)
  to authenticated;

notify pgrst, 'reload schema';

commit;
