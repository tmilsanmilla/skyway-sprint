-- Run with a generated secret. The password is never committed:
--   psql "$DATABASE_URL" -v skyway_server_password="..." \
--     -f neon/create-server-runtime-role.sql

\if :{?skyway_server_password}
\else
  \echo 'skyway_server_password is required'
  \quit
\endif

begin;

do $role$
begin
  if not exists (
    select 1 from pg_roles where rolname = 'skyway_server_runtime'
  ) then
    create role skyway_server_runtime
      nologin inherit nosuperuser nocreaterole nocreatedb
      noreplication nobypassrls;
  end if;
end
$role$;

do $role_audit$
declare
  runtime_role record;
begin
  select * into runtime_role from pg_roles
  where rolname = 'skyway_server_runtime';

  if runtime_role.rolsuper
     or runtime_role.rolbypassrls
     or runtime_role.rolcreaterole
     or runtime_role.rolcreatedb
     or runtime_role.rolreplication then
    raise exception 'skyway_server_runtime received unsafe role attributes';
  end if;
end
$role_audit$;

alter role skyway_server_runtime login password :'skyway_server_password';

revoke all on schema public, app_private from skyway_server_runtime;
revoke all on all tables in schema public, app_private
  from skyway_server_runtime;
revoke all on all sequences in schema public, app_private
  from skyway_server_runtime;
revoke all on all functions in schema public, app_private
  from skyway_server_runtime;

grant skyway_server_api to skyway_server_runtime;

commit;
