-- Existing-bound return only. No new bindings, accounts, grants or auth changes.
-- Requires installed Pixel03. Keep the first-link/public-discovery gates OFF.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
select pg_advisory_xact_lock(20261024,5);

-- Refuse an unreviewed installed wrapper rather than replacing arbitrary code.
-- CREATE OR REPLACE retains the existing OID/owner/ACL; assert that explicitly.
do $preflight$
declare item record;before_state jsonb;
begin
 for item in select x.*,p.oid,p.proowner,p.prosecdef,p.proconfig,p.proacl,p.prosrc
  from (values
   ('app_private.pixel_discovery_save(text,jsonb,text,text)','04507dcb22798cd654d588a368c3351a','c0487df1e594d063accf78568dca09b9'),
   ('app_private.pixel_signin_bound(jsonb,text,text,text)','8ac7a4e895f6a3f03f4327e3055e2f9f','3a890b1806445d07745c841cfa1a83cd')
  ) as x(signature,before_hash,after_hash)
  left join pg_proc p on p.oid=to_regprocedure(x.signature)
 loop
  if item.oid is null or not item.prosecdef or item.proowner<>(select oid from pg_roles where rolname=current_user)
   or item.proconfig is distinct from array['search_path=""']::text[]
   or md5(item.prosrc) not in(item.before_hash,item.after_hash)
   or not has_function_privilege('skyway_server_api',item.oid,'EXECUTE')
   or has_function_privilege('authenticated',item.oid,'EXECUTE')
   or has_function_privilege('anon',item.oid,'EXECUTE')
   or has_function_privilege('anonymous',item.oid,'EXECUTE')
   or exists(select 1 from aclexplode(coalesce(item.proacl,acldefault('f',item.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE')
  then raise exception 'Unreviewed bound-return wrapper: %',item.signature;end if;
 end loop;
 if to_regprocedure('app_private.pixel_signin_bound(jsonb,text)') is null
  or has_function_privilege('skyway_server_api','app_private.pixel_signin_bound(jsonb,text)','EXECUTE')
  or has_function_privilege('authenticated','app_private.pixel_signin_bound(jsonb,text)','EXECUTE')
  or has_function_privilege('anon','app_private.pixel_signin_bound(jsonb,text)','EXECUTE')
  or has_function_privilege('anonymous','app_private.pixel_signin_bound(jsonb,text)','EXECUTE')
 then raise exception 'The inner bound-signin helper must remain private';end if;
 if to_regprocedure('app_private.pixel_discovery_save(text,jsonb)') is null
  or has_function_privilege('skyway_server_api','app_private.pixel_discovery_save(text,jsonb)','EXECUTE')
  or has_function_privilege('authenticated','app_private.pixel_discovery_save(text,jsonb)','EXECUTE')
  or has_function_privilege('anon','app_private.pixel_discovery_save(text,jsonb)','EXECUTE')
  or has_function_privilege('anonymous','app_private.pixel_discovery_save(text,jsonb)','EXECUTE')
 then raise exception 'The inner discovery helper must remain private';end if;
 select jsonb_agg(jsonb_build_object('oid',p.oid,'owner',p.proowner,'definer',p.prosecdef,
  'config',p.proconfig,'acl',p.proacl::text) order by p.oid) into before_state
 from pg_proc p where p.oid in('app_private.pixel_discovery_save(text,jsonb,text,text)'::regprocedure,
  'app_private.pixel_signin_bound(jsonb,text,text,text)'::regprocedure);
 perform set_config('skyway.bound_return_wrapper_boundary',before_state::text,true);
end $preflight$;

create or replace function app_private.pixel_discovery_save(p_hash text,p_profile jsonb,p_state_hash text,p_browser_hash text)
returns void language plpgsql security definer set search_path='' as $$
declare a app_private.pixel_attempts_v3;
begin
 select * into a from app_private.pixel_attempts_v3 where state_hash=p_state_hash and browser_hash=p_browser_hash for update;
 if a.state_hash is null or a.context->>'phase' is distinct from 'discovery' or a.consumed_at is null
  or a.completed_at is not null or a.cancelled_at is not null or a.expires_at<=clock_timestamp()
 then raise exception 'The owned sign-in was cancelled, completed or expired';end if;
 -- A bound-only attempt never becomes a discovery or a first-link source,
 -- even if a future HTTP caller accidentally tries the ordinary fallback.
 if a.context?'entry_mode' then raise exception 'This sign-in cannot create an account connection';end if;
 perform app_private.pixel_discovery_save(p_hash,p_profile);
 update app_private.pixel_discoveries set login_attempt_state_hash=a.state_hash where token_hash=p_hash;
 update app_private.pixel_attempts_v3 set completed_at=clock_timestamp() where state_hash=a.state_hash;
end $$;

create or replace function app_private.pixel_signin_bound(p_profile jsonb,p_session_hash text,p_state_hash text,p_browser_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a app_private.pixel_attempts_v3;outcome jsonb;s uuid;bound_user uuid;canary_user text;bound_only boolean;
begin
 select * into a from app_private.pixel_attempts_v3 where state_hash=p_state_hash and browser_hash=p_browser_hash for update;
 if a.state_hash is null or a.context->>'phase' is distinct from 'discovery' or a.consumed_at is null
  or a.completed_at is not null or a.cancelled_at is not null or a.expires_at<=clock_timestamp()
 then raise exception 'The owned sign-in was cancelled, completed or expired';end if;
 bound_only:=a.context->>'entry_mode'='bound-return';
 if a.context?'entry_mode' and(a.context->>'entry_mode' is distinct from 'bound-return'
  or jsonb_typeof(a.context->'entry_mode') is distinct from 'string'
  or a.context-array['phase','entry_mode']::text[]<>'{}'::jsonb)
 then raise exception 'Invalid owned bound-return attempt';end if;
 if not app_private.pixel_valid_profile(p_profile) or p_session_hash is null or p_session_hash!~'^[a-f0-9]{64}$'
 then raise exception 'Invalid signed identity';end if;
 if a.context?'canary_native_user_id' or a.context?'canary_jti' then
  canary_user:=a.context->>'canary_native_user_id';
  if jsonb_typeof(a.context->'canary_native_user_id') is distinct from 'string'
   or coalesce(canary_user,'')!~'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
   or jsonb_typeof(a.context->'canary_jti') is distinct from 'string'
   or coalesce(a.context->>'canary_jti','')!~'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
  then raise exception 'Invalid restricted sign-in target';end if;
 end if;
 s:=(p_profile->>'subject')::uuid;
 -- Hold the same immutable-subject lock used by the inner mint/sync helper.
 -- Compare the persisted game UUID before profile sync or session insertion.
 perform pg_advisory_xact_lock(hashtextextended('skyway-pixel:'||s::text,0));
 select user_id into bound_user from app_private.pixel_links
 where issuer='https://pixel-pulse-websites.vercel.app/api/sso' and subject=s for update;
 if bound_user is not null and canary_user is not null and bound_user is distinct from canary_user::uuid
 then raise exception 'The restricted sign-in belongs to another Skyway account';end if;
 if bound_only and bound_user is null then
  -- Terminal, one-use failure: no email/native-user lookup, discovery or mint.
  update app_private.pixel_attempts_v3 set completed_at=clock_timestamp() where state_hash=a.state_hash;
  return null;
 end if;
 outcome:=app_private.pixel_signin_bound(p_profile,p_session_hash);
 if outcome is not null then
  update app_private.pixel_sessions set login_attempt_state_hash=a.state_hash where token_hash=p_session_hash;
  update app_private.pixel_attempts_v3 set completed_at=clock_timestamp() where state_hash=a.state_hash;
 end if;
 return outcome;
end $$;

do $boundary$
declare after_state jsonb;
begin
 select jsonb_agg(jsonb_build_object('oid',p.oid,'owner',p.proowner,'definer',p.prosecdef,
  'config',p.proconfig,'acl',p.proacl::text) order by p.oid) into after_state
 from pg_proc p where p.oid in('app_private.pixel_discovery_save(text,jsonb,text,text)'::regprocedure,
  'app_private.pixel_signin_bound(jsonb,text,text,text)'::regprocedure);
 if after_state is distinct from current_setting('skyway.bound_return_wrapper_boundary')::jsonb
 then raise exception 'The bound-return wrapper privilege boundary changed';end if;
end $boundary$;
commit;
