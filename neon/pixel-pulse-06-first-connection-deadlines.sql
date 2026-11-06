-- Exact one-helper first-connection deadline correction. No schema, row or ACL changes.
-- Apply only on the independently pinned Skyway branch after source/native review.
SET LOCAL statement_timeout='15s';
SET LOCAL lock_timeout='2s';
DO $guard$
BEGIN
 IF current_database()<>'neondb' OR current_schema()<>'public' OR
    md5(pg_get_functiondef('app_private.pixel_bind_account_v2(jsonb)'::regprocedure))<>'b767dce62ea05450e0137c54e90a917a'
 THEN RAISE EXCEPTION 'Skyway binding source/target changed; stop and reconcile'; END IF;
END $guard$;
create or replace function app_private.pixel_bind_account_v2(p_context jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a app_private.pixel_attempts_v3;p jsonb:=p_context->'profile';s uuid;u uuid;mode text;outcome jsonb;
begin
 if jsonb_typeof(p_context) is distinct from 'object' or not app_private.pixel_valid_profile(p)
 or not coalesce((p->>'email_verified')::boolean,false)
 or p_context->>'session_hash' is null or p_context->>'session_hash'!~'^[a-f0-9]{64}$'
 or p_context->>'proof_jti' is null or p_context->>'proof_jti'!~'^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'
 then raise exception 'A fresh verified Pixel password confirmation is required';end if;
 select * into a from app_private.pixel_attempts_v3 where state_hash=p_context->>'state_hash'
 and browser_hash=p_context->>'browser_hash' for update;
 if a.state_hash is null or a.consumed_at is null or a.completed_at is not null or a.cancelled_at is not null or a.expires_at<=clock_timestamp()
 or a.context->>'phase' is distinct from 'link' or a.context->'expected'->>'subject' is distinct from p->>'subject'
 or a.context->'expected'->>'credential_version' is distinct from p->>'credential_version'
 or a.context->'expected'->>'profile_version' is distinct from p->>'profile_version'
 or a.context->'discovered_profile' is distinct from p
 then raise exception 'The confirmed identity does not match the owned connection attempt';end if;
 if coalesce(p_context->>'proof_auth_time','')!~'^[0-9]{1,12}$' or coalesce(p_context->>'proof_exp','')!~'^[0-9]{1,12}$'
 or to_timestamp((p_context->>'proof_auth_time')::bigint)>clock_timestamp()
 or to_timestamp((p_context->>'proof_auth_time')::bigint)<clock_timestamp()-interval '90 seconds'
 or to_timestamp((p_context->>'proof_exp')::bigint)<=clock_timestamp()
 or (p_context->>'proof_exp')::bigint>(p_context->>'proof_auth_time')::bigint+90
 then raise exception 'The current-password confirmation expired';end if;
 s:=(p->>'subject')::uuid;mode:=a.context->>'target_mode';
 perform pg_advisory_xact_lock(hashtextextended('skyway-pixel:'||s::text,0));
 perform pg_advisory_xact_lock(hashtextextended('skyway-pixel-email:'||lower(btrim(p->>'email')),0));
 if exists(select 1 from app_private.pixel_first_link_receipts where proof_jti=(p_context->>'proof_jti')::uuid)
 then raise exception 'This password confirmation was already used';end if;
 if exists(select 1 from app_private.pixel_links where subject=s)
 then raise exception 'This Pixel account is already linked; use ordinary Continue';end if;
 if mode='link' then
  if a.native_password_verified_at is null or a.native_password_verified_at>clock_timestamp()
   or a.native_password_verified_at<=clock_timestamp()-interval '5 minutes'
  then raise exception 'A current Skyway password confirmation is required';end if;
  u:=(a.context->>'native_user_id')::uuid;
  perform pg_advisory_xact_lock(hashtextextended('skyway-pixel-native:'||u::text,0));
  -- Serialize the final ownership decision with native password resets/logout.
  -- The user lock also prevents a new credential row appearing via its FK.
  perform 1 from neon_auth."user" where id=u for update;
  if not found then raise exception 'The existing Skyway account is unavailable';end if;
  perform 1 from neon_auth.session where id::text=a.context->>'native_session_id' and "userId"=u for share;
  perform 1 from neon_auth.account where "userId"=u and "providerId"='credential' for share;
  if a.native_session_stamp is null or a.native_credential_stamp is null
   or app_private.pixel_native_session_stamp(u,a.context->>'native_session_id') is distinct from a.native_session_stamp
   or app_private.pixel_native_credential_stamp(u) is distinct from a.native_credential_stamp
   then raise exception 'The Skyway ownership proof changed or expired; sign in again';end if;
  if not exists(select 1 from neon_auth."user" where id=u and lower(btrim(email))=lower(btrim(p->>'email')) and "emailVerified"
   and(not coalesce(banned,false) or("banExpires" is not null and "banExpires"<clock_timestamp())))
   then raise exception 'Use the same verified email on both accounts';end if;
 elsif mode='create' then
  if exists(select 1 from neon_auth."user" where lower(btrim(email))=lower(btrim(p->>'email')))
   then raise exception 'An existing Skyway account uses this email. Choose Link to preserve its progress.';end if;
 else raise exception 'Invalid first connection target';end if;

 -- Time spent waiting for any advisory lock, native row or storage constraint
 -- spends the ORIGINAL attempt/proof lifetime. Raising rolls back every write.
 if clock_timestamp()>=least(a.expires_at,
      to_timestamp((p_context->>'proof_exp')::bigint),
      to_timestamp((p_context->>'proof_auth_time')::bigint)+interval '90 seconds',
      case when mode='link' then a.native_password_verified_at+interval '5 minutes' end)
 then raise exception 'The current-password confirmation expired while saving this connection';end if;

 -- Typed legacy helper is private-only below; passing false forbids email adoption.
 outcome:=app_private.pixel_bind_account_v2(s,p->>'username',p->>'email',true,u,p_context->>'session_hash',mode,
  (p->>'profile_version')::bigint,(p->>'credential_version')::bigint,false);
 u:=(outcome->>'user_id')::uuid;
 perform app_private.pixel_ensure_auth_identity(s,u);
 update app_private.pixel_sessions set runtime_lease_until=clock_timestamp()+interval '30 seconds',login_attempt_state_hash=a.state_hash
 where token_hash=p_context->>'session_hash';
 insert into app_private.pixel_first_link_receipts(proof_jti,subject,user_id,target_mode)
 values((p_context->>'proof_jti')::uuid,s,u,mode);
 update app_private.pixel_attempts_v3 set completed_at=clock_timestamp() where state_hash=a.state_hash;

 -- Time spent waiting for any advisory lock, native row or storage constraint
 -- spends the ORIGINAL attempt/proof lifetime. Raising rolls back every write.
 if clock_timestamp()>=least(a.expires_at,
      to_timestamp((p_context->>'proof_exp')::bigint),
      to_timestamp((p_context->>'proof_auth_time')::bigint)+interval '90 seconds',
      case when mode='link' then a.native_password_verified_at+interval '5 minutes' end)
 then raise exception 'The current-password confirmation expired while saving this connection';end if;

 outcome:=app_private.pixel_session_get(p_context->>'session_hash');
 -- Time spent waiting for any advisory lock, native row or storage constraint
 -- spends the ORIGINAL attempt/proof lifetime. Raising rolls back every write.
 if clock_timestamp()>=least(a.expires_at,
      to_timestamp((p_context->>'proof_exp')::bigint),
      to_timestamp((p_context->>'proof_auth_time')::bigint)+interval '90 seconds',
      case when mode='link' then a.native_password_verified_at+interval '5 minutes' end)
 then raise exception 'The current-password confirmation expired while saving this connection';end if;

 return outcome;
end $$;
