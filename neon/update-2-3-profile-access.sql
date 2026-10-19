-- Narrow repair for existing native username onboarding. ONE atomic statement.
-- No table writes are granted; managed Auth identities/credentials are untouched.
-- Fail closed unless the CURRENT table policy is exactly authenticated own-read.
do $profile_access_23$
declare
 definition text; backup text; body text; own_policy record; auth_role oid;
 table_owner oid; before_profiles text; before_users text; before_accounts text;
 after_profiles text; after_users text; after_accounts text;
begin
 if current_database()<>'neondb' or current_user<>'neondb_owner' then
  raise exception 'Verified Skyway neondb owner connection required';
 end if;
 perform set_config('lock_timeout','5s',true);
 lock table public.player_profiles,neon_auth."user",neon_auth.account in share row exclusive mode;
 select md5(coalesce(string_agg(md5(to_jsonb(p)::text),'' order by md5(to_jsonb(p)::text)),'')) into before_profiles from public.player_profiles p;
 select md5(coalesce(string_agg(md5(to_jsonb(p)::text),'' order by md5(to_jsonb(p)::text)),'')) into before_users from neon_auth."user" p;
 select md5(coalesce(string_agg(md5(to_jsonb(p)::text),'' order by md5(to_jsonb(p)::text)),'')) into before_accounts from neon_auth.account p;
 select oid into auth_role from pg_roles where rolname='authenticated' and not rolsuper and not rolbypassrls;
 select relowner into table_owner from pg_class where oid='public.player_profiles'::regclass and relrowsecurity;
 if auth_role is null or table_owner is null or pg_has_role(auth_role,table_owner,'MEMBER') then
  raise exception 'Authenticated own-profile RLS boundary is not intact';
 end if;
 if (select count(*) from pg_policy where polrelid='public.player_profiles'::regclass and polcmd in('r','*'))<>1 then
  raise exception 'Unexpected additional profile SELECT/ALL policy; no access granted';
 end if;
 select polname,polcmd,polroles,polpermissive,pg_get_expr(polqual,polrelid) expression into own_policy
 from pg_policy where polrelid='public.player_profiles'::regclass and polcmd='r';
 if own_policy.polname is distinct from 'Players read their profile'
  or own_policy.polroles is distinct from array[auth_role]
  or own_policy.polpermissive is distinct from true
  or own_policy.expression is distinct from '(( SELECT auth.uid() AS uid) = user_id)' then
  raise exception 'Exact authenticated own-profile SELECT policy changed; no access granted';
 end if;
 if has_table_privilege('authenticated','public.player_profiles','INSERT,UPDATE,DELETE,TRUNCATE')
  or has_any_column_privilege('authenticated','public.player_profiles','INSERT,UPDATE') then
  raise exception 'Unexpected existing direct profile write access; review before restoring names';
 end if;
 definition:=pg_get_functiondef(to_regprocedure('public.set_player_username(text)'));
 if to_regprocedure('app_private.set_player_username_before_23(text)') is null then
  if definition is null or md5(definition)<>'6d1e6603947afb2fa7f601d3e95d8bdb' then
   raise exception 'Installed username setter drifted; exact original body must be reviewed';
  end if;
  execute replace(definition,'FUNCTION public.set_player_username(','FUNCTION app_private.set_player_username_before_23(');
 end if;
 backup:=pg_get_functiondef('app_private.set_player_username_before_23(text)'::regprocedure);
 if md5(replace(backup,'FUNCTION app_private.set_player_username_before_23(','FUNCTION public.set_player_username('))<>'6d1e6603947afb2fa7f601d3e95d8bdb' then
  raise exception 'Original username backup changed; stop instead of replacing it';
 end if;
 body:=$native_username_body$
declare u uuid:=auth.uid(); existing public.player_profiles; result public.player_profiles;
 normalized text; stamp timestamptz;
begin
 if u is null then raise exception 'Sign in required';end if;
 -- Serialize concurrent first choices/renames for this immutable identity.
 perform pg_advisory_xact_lock(hashtextextended('skyway-native-username-23:'||u::text,0));
 if exists(select 1 from app_private.pixel_links where user_id=u) then
  raise exception 'Your username is managed by Pixel Pulse; change it in Pixel Account';
 end if;
 new_username:=btrim(new_username);
 select * into existing from public.player_profiles where user_id=u for update;
 -- Case-only/trim-only saves are canonical no-ops: keep the stored spelling
 -- and do not consume or extend a rename timer.
 if existing.user_id is not null and lower(existing.username)=lower(new_username) then return existing;end if;
 if new_username is null or new_username!~'^[A-Za-z0-9_]{3,20}$' then
  raise exception 'Username must be 3-20 letters, numbers, or underscores';
 end if;
 normalized:=lower(regexp_replace(new_username,'[^a-zA-Z0-9]','','g'));
 if exists(select 1 from public.username_blocklist where (length(term)<4 and normalized=term) or (length(term)>=4 and position(term in normalized)>0)) then
  raise exception 'That username is not allowed';
 end if;
 -- One lock per candidate name also protects cross-account collisions even
 -- if a historical imported database lacks its case-insensitive name index.
 perform pg_advisory_xact_lock(hashtextextended('skyway-native-name-23:'||lower(new_username),0));
 if exists(select 1 from public.player_profiles where user_id<>u and lower(username)=lower(new_username)) then
  raise exception 'That username is already taken';
 end if;
 stamp:=clock_timestamp();
 -- Original first choices use the same created/changed timestamp. They do
 -- not count as a rename; existing actual rename timestamps remain intact.
 if existing.user_id is not null and existing.username_changed_at is distinct from existing.created_at
  and existing.username_changed_at>stamp-interval '720 hours' then
  raise exception 'Username can only be changed once every 30 days';
 end if;
 if existing.user_id is null then
  insert into public.player_profiles(user_id,username,username_changed_at,created_at)
  values(u,new_username,stamp,stamp) returning * into result;
 else
  update public.player_profiles set username=new_username,username_changed_at=stamp where user_id=u returning * into result;
 end if;
 return result;
exception when unique_violation then raise exception 'That username is already taken';
end
$native_username_body$;
 if md5(definition)<>'6d1e6603947afb2fa7f601d3e95d8bdb'
  and (select prosrc from pg_proc where oid='public.set_player_username(text)'::regprocedure) is distinct from body then
  raise exception 'A different username repair is already installed; review before replacing it';
 end if;
 execute format('create or replace function public.set_player_username(new_username text) returns public.player_profiles language plpgsql security definer set search_path=%L as %L','',body);
 revoke all on function app_private.set_player_username_before_23(text) from public,anon,anonymous,authenticated;
 revoke all on function public.set_player_username(text) from public,anon,anonymous;
 grant execute on function public.set_player_username(text) to authenticated;
 grant select(user_id,username,username_changed_at) on public.player_profiles to authenticated;
 select md5(coalesce(string_agg(md5(to_jsonb(p)::text),'' order by md5(to_jsonb(p)::text)),'')) into after_profiles from public.player_profiles p;
 select md5(coalesce(string_agg(md5(to_jsonb(p)::text),'' order by md5(to_jsonb(p)::text)),'')) into after_users from neon_auth."user" p;
 select md5(coalesce(string_agg(md5(to_jsonb(p)::text),'' order by md5(to_jsonb(p)::text)),'')) into after_accounts from neon_auth.account p;
 if before_profiles is distinct from after_profiles or before_users is distinct from after_users or before_accounts is distinct from after_accounts then
  raise exception 'Profile/Auth rows changed during installation; entire repair rolled back';
 end if;
 notify pgrst,'reload schema';
 raise notice 'U23_PROFILE_ACCESS: %',jsonb_build_object('own_read_columns',3,'setter_authenticated_only',true,'direct_writes_granted',false,'profiles_preserved',true,'auth_rows_preserved',true);
end $profile_access_23$;
