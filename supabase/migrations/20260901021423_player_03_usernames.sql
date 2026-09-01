-- Player 03 Usernames: required unique names with a 30-day change cooldown.
create table if not exists public.player_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  username text not null,
  username_changed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint username_format check (username ~ '^[A-Za-z0-9_]{3,20}$')
);
create unique index if not exists player_profiles_username_lower_idx on public.player_profiles(lower(username));
alter table public.player_profiles enable row level security;

create or replace function public.set_player_username(new_username text)
returns public.player_profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing public.player_profiles;
  result public.player_profiles;
begin
  if auth.uid() is null then raise exception 'Sign in required'; end if;
  new_username := trim(new_username);
  if new_username !~ '^[A-Za-z0-9_]{3,20}$' then raise exception 'Username must be 3-20 letters, numbers, or underscores'; end if;
  select * into existing from public.player_profiles where user_id = auth.uid();
  if found and existing.username_changed_at > now() - interval '30 days' then
    raise exception 'Username can only be changed once every 30 days';
  end if;
  insert into public.player_profiles(user_id, username)
  values (auth.uid(), new_username)
  on conflict (user_id) do update set username=excluded.username, username_changed_at=now()
  returning * into result;
  return result;
exception when unique_violation then
  raise exception 'That username is already taken';
end $$;

revoke all on function public.set_player_username(text) from public;
grant execute on function public.set_player_username(text) to authenticated;
