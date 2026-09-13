-- Player 01 Stats: proportional duplicate refunds
--
-- A Normal pull costs three gems. Common through Rare duplicates return one
-- gem (one-third). Epic through Mythic duplicates use a one-half refund,
-- rounded up to two gems because player gem balances are whole numbers.

begin;

do $$
begin
  if to_regprocedure('app_private.duplicate_gem_refund(text)') is null
     or to_regprocedure('public.extract_items(integer,text)') is null then
    raise exception
      'Player 01 Stats must be installed before proportional duplicate refunds';
  end if;
end;
$$;

create or replace function app_private.duplicate_gem_refund(
  p_rarity text
)
returns integer
language sql
immutable
strict
set search_path=''
as $$
  select case lower(p_rarity)
    when 'common' then 1
    when 'uncommon' then 1
    when 'rare' then 1
    when 'epic' then 2
    when 'legendary' then 2
    when 'mythic' then 2
    else null
  end;
$$;

revoke all on function app_private.duplicate_gem_refund(text)
  from public, anon, authenticated;

comment on function public.extract_items(integer,text) is
  'Atomic QTY 1-100 Normal/ten-box extraction at 3 gems per item. Common through Rare duplicates refund one-third; Epic through Mythic refund one-half rounded up to a whole gem.';

do $$
begin
  if app_private.duplicate_gem_refund('common')<>1
     or app_private.duplicate_gem_refund('uncommon')<>1
     or app_private.duplicate_gem_refund('rare')<>1
     or app_private.duplicate_gem_refund('epic')<>2
     or app_private.duplicate_gem_refund('legendary')<>2
     or app_private.duplicate_gem_refund('mythic')<>2 then
    raise exception 'Proportional duplicate refund schedule is incorrect';
  end if;
end;
$$;

commit;
