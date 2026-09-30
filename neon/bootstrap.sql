-- Skyway Sprint managed Neon Auth bootstrap.
--
-- Run only after enabling managed Neon Auth and the Neon Data API. Neon owns
-- neon_auth, session issuance, JWT validation, and auth.uid()/auth.jwt(). The
-- game never stores passwords, password hashes, sessions, or auth tokens in
-- public tables.

begin;

create schema if not exists app_private;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

do $managed_auth$
begin
  if to_regclass('neon_auth."user"') is null then
    raise exception 'Managed Neon Auth is not enabled for this branch';
  end if;
  if to_regprocedure('auth.uid()') is null then
    raise exception 'Neon Data API auth helpers are not installed';
  end if;
end
$managed_auth$;

revoke all on schema app_private from public, anon, anonymous, authenticated;

commit;
