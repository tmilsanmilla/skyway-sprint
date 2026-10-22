-- Application-owned, additive Pixel first-binding security. No XP/account reset.
-- Requires the audited installed Pixel01/02 functions; never replay old imports.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
select pg_advisory_xact_lock(20261021,3);

alter table app_private.pixel_sessions add column if not exists runtime_lease_until timestamptz;
alter table app_private.pixel_sessions add column if not exists login_attempt_state_hash text;
create table if not exists app_private.pixel_discoveries(
 token_hash text primary key check(token_hash~'^[a-f0-9]{64}$'),
 profile jsonb not null,expires_at timestamptz not null,
 consumed_at timestamptz);
alter table app_private.pixel_discoveries add column if not exists login_attempt_state_hash text;
create table if not exists app_private.pixel_attempts_v3(
 state_hash text primary key check(state_hash~'^[a-f0-9]{64}$'),
 browser_hash text not null check(browser_hash~'^[a-f0-9]{64}$'),
 verifier text not null,nonce text not null,context jsonb not null,
 native_credential_stamp text,native_session_stamp text,
 expires_at timestamptz not null,consumed_at timestamptz,completed_at timestamptz);
alter table app_private.pixel_attempts_v3 add column if not exists cancelled_at timestamptz;
alter table app_private.pixel_attempts_v3 add column if not exists native_password_verified_at timestamptz;
create table if not exists app_private.pixel_first_link_receipts(
 proof_jti uuid primary key,subject uuid not null,user_id uuid not null,
 target_mode text not null check(target_mode in('link','create')),
 consumed_at timestamptz not null default clock_timestamp());
alter table app_private.pixel_discoveries enable row level security;
alter table app_private.pixel_attempts_v3 enable row level security;
alter table app_private.pixel_first_link_receipts enable row level security;
revoke all on app_private.pixel_discoveries,app_private.pixel_attempts_v3,
 app_private.pixel_first_link_receipts from public,anon,anonymous,authenticated,skyway_server_api;

-- A stamp is compared only inside this database. No password/hash is returned.
create or replace function app_private.pixel_native_credential_stamp(u uuid)
returns text language sql stable security definer set search_path='' as $$
 select md5(coalesce(jsonb_agg(jsonb_build_array(a.id,a.password) order by a.id)::text,'[]'))
 from neon_auth.account a where a."userId"=u and a."providerId"='credential';
$$;
create or replace function app_private.pixel_native_session_stamp(u uuid,s text)
returns text language sql stable security definer set search_path='' as $$
 select md5(jsonb_build_array(id,"userId",extract(epoch from "createdAt"),extract(epoch from "expiresAt"))::text)
 from neon_auth.session where id::text=s and "userId"=u
 and "expiresAt">clock_timestamp();
$$;
create or replace function app_private.pixel_valid_profile(p jsonb)
returns boolean language sql immutable set search_path='' as $$
 select coalesce(jsonb_typeof(p)='object' and
  p->>'subject'~'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$' and
  p->>'username'~'^[a-z0-9_ ]{3,25}$' and p->>'email'~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  and length(p->>'email')<=254 and jsonb_typeof(p->'email_verified')='boolean'
  and jsonb_typeof(p->'profile_version')='number' and jsonb_typeof(p->'credential_version')='number'
  and (p->>'profile_version')~'^[0-9]{1,16}$' and (p->>'credential_version')~'^[0-9]{1,16}$'
  and (p->>'profile_version')::numeric<=9007199254740991
  and (p->>'credential_version')::numeric<=9007199254740991,false);
$$;
create or replace function app_private.pixel_discovery_save(p_hash text,p_profile jsonb)
returns void language plpgsql security definer set search_path='' as $$
begin
 if p_hash is null or p_hash!~'^[a-f0-9]{64}$' or not app_private.pixel_valid_profile(p_profile)
 then raise exception 'Invalid Pixel discovery';end if;
 insert into app_private.pixel_discoveries(token_hash,profile,expires_at)
 values(p_hash,p_profile,clock_timestamp()+interval '5 minutes');
end $$;
create or replace function app_private.pixel_discovery_get(p_hash text)
returns jsonb language sql stable security definer set search_path='' as $$
 select profile from app_private.pixel_discoveries where token_hash=p_hash
 and consumed_at is null and expires_at>clock_timestamp();
$$;
create or replace function app_private.pixel_discovery_take(p_hash text)
returns jsonb language sql security definer set search_path='' as $$
 update app_private.pixel_discoveries set consumed_at=clock_timestamp()
 where token_hash=p_hash and consumed_at is null and expires_at>clock_timestamp() returning profile;
$$;
create or replace function app_private.pixel_attempt_begin_v2(p_state_hash text,p_browser_hash text,p_verifier text,p_nonce text,p_context jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare d app_private.pixel_discoveries;u uuid;sid text;cs text;ss text;ctx jsonb:=p_context;
begin
 if p_state_hash is null or p_state_hash!~'^[a-f0-9]{64}$' or p_browser_hash is null or p_browser_hash!~'^[a-f0-9]{64}$'
 or p_verifier is null or p_verifier!~'^[A-Za-z0-9._~-]{43,128}$' or p_nonce is null or p_nonce!~'^[A-Za-z0-9_-]{22,255}$'
 or jsonb_typeof(ctx) is distinct from 'object' or coalesce(ctx->>'phase','') not in('discovery','link')
 then raise exception 'Invalid connection attempt';end if;
 if ctx->>'phase'='link' then
  select * into d from app_private.pixel_discoveries where token_hash=ctx->>'discovery_hash' for update;
  if d.token_hash is null or d.consumed_at is not null or d.expires_at<=clock_timestamp()
  or not coalesce((d.profile->>'email_verified')::boolean,false)
  or coalesce(ctx->>'target_mode','') not in('link','create')
  or ctx->'expected'->>'subject' is distinct from d.profile->>'subject'
  or ctx->'expected'->>'profile_version' is distinct from d.profile->>'profile_version'
  or ctx->'expected'->>'credential_version' is distinct from d.profile->>'credential_version'
  then raise exception 'This connection discovery expired or changed. Start again.';end if;
  if ctx->'flow'->>'client_id' is distinct from 'skyway-sprint'
   or ctx->'flow'->>'redirect_uri' is distinct from 'https://skyway-sprint.vercel.app/api/pixel-pulse/callback'
   or ctx->'flow'->>'pixel_intent' is distinct from 'link'
   or ctx->'flow'->>'code_challenge_method' is distinct from 'S256'
   or ctx->'flow'->>'nonce' is distinct from p_nonce
   or ctx->'flow'->>'response_type' is distinct from 'code'
   or ctx->'flow'->>'scope' is distinct from 'openid profile email'
   or encode(sha256(convert_to(ctx->'flow'->>'state','UTF8')),'hex') is distinct from p_state_hash
   or ctx->'flow'->>'code_challenge' is distinct from
    translate(rtrim(encode(sha256(convert_to(p_verifier,'UTF8')),'base64'),'='),'+/','-_')
   then raise exception 'Invalid owned linking flow';end if;
  if ctx->>'target_mode'='link' then
   u:=(ctx->>'native_user_id')::uuid;sid:=ctx->>'native_session_id';
   if not exists(select 1 from neon_auth.session where id::text=sid and "userId"=u
    and "createdAt">=clock_timestamp()-interval '90 seconds' and "createdAt"<=clock_timestamp()
    and "expiresAt">clock_timestamp()) then raise exception 'Sign into your existing Skyway account again before linking';end if;
   if not exists(select 1 from neon_auth."user" where id=u and lower(btrim(email))=lower(btrim(d.profile->>'email'))
    and "emailVerified" and (not coalesce(banned,false) or "banExpires"<clock_timestamp()))
    then raise exception 'Verify the matching email on your existing Skyway account before linking';end if;
   if not exists(select 1 from neon_auth.account where "userId"=u and "providerId"='credential' and password is not null)
    then raise exception 'A fresh Skyway password ownership check is required';end if;
   cs:=app_private.pixel_native_credential_stamp(u);ss:=app_private.pixel_native_session_stamp(u,sid);
  elsif ctx->>'native_user_id' is not null or ctx->>'native_session_id' is not null
   then raise exception 'Create cannot adopt a native account';
  end if;
  ctx:=ctx||jsonb_build_object('discovered_profile',d.profile);
  update app_private.pixel_discoveries set consumed_at=clock_timestamp() where token_hash=d.token_hash;
 end if;
 insert into app_private.pixel_attempts_v3(state_hash,browser_hash,verifier,nonce,context,native_credential_stamp,native_session_stamp,expires_at)
 values(p_state_hash,p_browser_hash,p_verifier,p_nonce,ctx,cs,ss,clock_timestamp()+interval '5 minutes');
end $$;
-- Only the trusted server calls this AFTER the managed email/password API
-- successfully verifies the sealed UUID. Recent OAuth sessions are not proof.
-- Neither passwords nor hashes enter this call or leave the database.
create or replace function app_private.pixel_attempt_confirm_native_password(p_state_hash text,p_browser_hash text,p_verified_user_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare a app_private.pixel_attempts_v3;u uuid;
begin
 select * into a from app_private.pixel_attempts_v3
 where state_hash=p_state_hash and browser_hash=p_browser_hash for update;
 if a.state_hash is null or a.context->>'phase' is distinct from 'link'
  or a.context->>'target_mode' is distinct from 'link' or a.consumed_at is not null
  or a.completed_at is not null or a.cancelled_at is not null or a.expires_at<=clock_timestamp()
  or a.native_password_verified_at is not null
 then raise exception 'The Skyway password check expired or was already used';end if;
 u:=(a.context->>'native_user_id')::uuid;
 if p_verified_user_id is distinct from u
 then raise exception 'The Skyway password check belongs to another account';end if;
 perform 1 from neon_auth."user" where id=u for share;
 perform 1 from neon_auth.session where id::text=a.context->>'native_session_id' and "userId"=u for share;
 perform 1 from neon_auth.account where "userId"=u and "providerId"='credential' for share;
 if a.native_credential_stamp is null or a.native_session_stamp is null
  or app_private.pixel_native_credential_stamp(u) is distinct from a.native_credential_stamp
  or app_private.pixel_native_session_stamp(u,a.context->>'native_session_id') is distinct from a.native_session_stamp
 then raise exception 'The Skyway ownership proof changed during password verification';end if;
 update app_private.pixel_attempts_v3 set native_password_verified_at=clock_timestamp() where state_hash=a.state_hash;
end $$;
create or replace function app_private.pixel_attempt_take_v2(p_state_hash text,p_browser_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a app_private.pixel_attempts_v3;
begin
 update app_private.pixel_attempts_v3 set consumed_at=clock_timestamp()
 where state_hash=p_state_hash and browser_hash=p_browser_hash and consumed_at is null
 and completed_at is null and cancelled_at is null and expires_at>clock_timestamp()
 and(context->>'target_mode' is distinct from 'link' or
  (native_password_verified_at is not null and native_password_verified_at<=clock_timestamp()
   and native_password_verified_at>clock_timestamp()-interval '5 minutes')) returning * into a;
 if a.state_hash is null then raise exception 'This sign-in expired or was already used. Start again.';end if;
 return jsonb_build_object('verifier',a.verifier,'nonce',a.nonce,'context',a.context,'state_hash',a.state_hash,'browser_hash',a.browser_hash);
end $$;
create or replace function app_private.pixel_attempt_cancel(p_browser_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a app_private.pixel_attempts_v3;saved boolean:=false;
begin
 if p_browser_hash is null or p_browser_hash!~'^[a-f0-9]{64}$' then raise exception 'Invalid owned connection browser';end if;
 -- All callback paths take the same row lock. If a callback wins first, revoke
 -- its newly attached cookie too. A durable first binding is preserved/honest.
 for a in select * from app_private.pixel_attempts_v3 where browser_hash=p_browser_hash order by state_hash for update loop
  saved:=saved or(a.context->>'phase'='link' and a.completed_at is not null and a.cancelled_at is null);
  update app_private.pixel_attempts_v3 set cancelled_at=coalesce(cancelled_at,clock_timestamp()),
   completed_at=coalesce(completed_at,clock_timestamp()) where state_hash=a.state_hash;
  delete from app_private.pixel_sessions where login_attempt_state_hash=a.state_hash;
  delete from app_private.pixel_discoveries where login_attempt_state_hash=a.state_hash;
 end loop;
 return jsonb_build_object('cancelled',true,'connection_saved',saved);
end $$;

create or replace function app_private.pixel_discovery_save(p_hash text,p_profile jsonb,p_state_hash text,p_browser_hash text)
returns void language plpgsql security definer set search_path='' as $$
declare a app_private.pixel_attempts_v3;
begin
 select * into a from app_private.pixel_attempts_v3 where state_hash=p_state_hash and browser_hash=p_browser_hash for update;
 if a.state_hash is null or a.context->>'phase' is distinct from 'discovery' or a.consumed_at is null
  or a.completed_at is not null or a.cancelled_at is not null or a.expires_at<=clock_timestamp()
 then raise exception 'The owned sign-in was cancelled, completed or expired';end if;
 perform app_private.pixel_discovery_save(p_hash,p_profile);
 update app_private.pixel_discoveries set login_attempt_state_hash=a.state_hash where token_hash=p_hash;
 update app_private.pixel_attempts_v3 set completed_at=clock_timestamp() where state_hash=a.state_hash;
end $$;

create or replace function app_private.pixel_session_get(h text)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('user_id',p.user_id,'subject',p.subject,'username',p.username,'email',p.email,
 'email_verified',p.email_verified,'profile_version',p.profile_version,'credential_version',p.credential_version,
 'token_hash',s.token_hash,'runtime_lease_until',s.runtime_lease_until,'expires_at',s.expires_at,'created_at',s.created_at)
 from app_private.pixel_sessions s join app_private.pixel_links p using(issuer,subject) join neon_auth."user" u on u.id=p.user_id
 where s.token_hash=h and s.expires_at>clock_timestamp() and s.credential_version=p.credential_version
 and (not coalesce(u.banned,false) or (u."banExpires" is not null and u."banExpires"<clock_timestamp()));
$$;
create or replace function app_private.pixel_session_confirm_lease(p_hash text,p_subject uuid,p_credential_version bigint,p_valid_until timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p app_private.pixel_links;
begin
 if p_hash is null or p_hash!~'^[a-f0-9]{64}$' or p_subject is null or p_credential_version is null
 or p_credential_version not between 0 and 9007199254740991 or p_valid_until is null
 or p_valid_until<=clock_timestamp() or p_valid_until>clock_timestamp()+interval '35 seconds'
 then raise exception 'Invalid current credential check';end if;
 perform pg_advisory_xact_lock(hashtextextended('skyway-pixel:'||p_subject::text,0));
 select * into p from app_private.pixel_links where issuer='https://pixel-pulse-websites.vercel.app/api/sso' and subject=p_subject for update;
 if p.user_id is null then return null;end if;
 if p_credential_version>p.credential_version then
  -- Commit retirement even if a later profile update conflicts or HTTP returns no session.
  update app_private.pixel_links set credential_version=p_credential_version where issuer=p.issuer and subject=p_subject;
  delete from app_private.pixel_sessions where issuer=p.issuer and subject=p_subject and credential_version<p_credential_version;
  return null;
 end if;
 if p_credential_version<p.credential_version then return null;end if;
 update app_private.pixel_sessions set runtime_lease_until=p_valid_until
 where token_hash=p_hash and issuer=p.issuer and subject=p_subject and credential_version=p_credential_version
 and expires_at>clock_timestamp();
 if not found then return null;end if;
 return app_private.pixel_session_get(p_hash);
end $$;

create or replace function app_private.pixel_signin_bound(p_profile jsonb,p_session_hash text,p_state_hash text,p_browser_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a app_private.pixel_attempts_v3;outcome jsonb;
begin
 select * into a from app_private.pixel_attempts_v3 where state_hash=p_state_hash and browser_hash=p_browser_hash for update;
 if a.state_hash is null or a.context->>'phase' is distinct from 'discovery' or a.consumed_at is null
  or a.completed_at is not null or a.cancelled_at is not null or a.expires_at<=clock_timestamp()
 then raise exception 'The owned sign-in was cancelled, completed or expired';end if;
 outcome:=app_private.pixel_signin_bound(p_profile,p_session_hash);
 -- Unknown subjects continue to discovery in this SAME owned attempt. A known
 -- subject completes it atomically with the attached session.
 if outcome is not null then
  update app_private.pixel_sessions set login_attempt_state_hash=a.state_hash where token_hash=p_session_hash;
  update app_private.pixel_attempts_v3 set completed_at=clock_timestamp() where state_hash=a.state_hash;
 end if;
 return outcome;
end $$;

-- The new receiver uses only this current-bound path during ordinary Continue.
-- It never looks up email or creates/adopts a user for an unknown subject.
create or replace function app_private.pixel_signin_bound(p_profile jsonb,p_session_hash text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p app_private.pixel_links;s uuid;cv bigint;
begin
 if not app_private.pixel_valid_profile(p_profile) or p_session_hash is null or p_session_hash!~'^[a-f0-9]{64}$'
 then raise exception 'Invalid signed identity';end if;
 s:=(p_profile->>'subject')::uuid;cv:=(p_profile->>'credential_version')::bigint;
 perform pg_advisory_xact_lock(hashtextextended('skyway-pixel:'||s::text,0));
 select * into p from app_private.pixel_links where issuer='https://pixel-pulse-websites.vercel.app/api/sso' and subject=s for update;
 if p.user_id is null then return null;end if;
 if cv<p.credential_version then raise exception 'This Pixel Pulse credential version is older than the saved version';end if;
 -- The HTTP receiver must commit the authoritative credential check separately
 -- BEFORE this profile transaction. A profile collision cannot roll it back.
 if cv>p.credential_version then raise exception 'A committed current-credential check is required before sign-in';end if;
 perform app_private.pixel_sync_identity(s,p_profile->>'username',p_profile->>'email',(p_profile->>'email_verified')::boolean,
  (p_profile->>'profile_version')::bigint,cv);
 insert into app_private.pixel_sessions(token_hash,issuer,subject,expires_at,credential_version,runtime_lease_until)
 values(p_session_hash,p.issuer,s,clock_timestamp()+interval '7 days',cv,clock_timestamp()+interval '30 seconds');
 return app_private.pixel_session_get(p_session_hash);
end $$;

-- Passwordless provider association uses the SAME native user UUID. It is not
-- a managed OAuth provider, new password, role import, or duplicated account.
create unique index if not exists skyway_pixel_auth_account_subject_idx
 on neon_auth.account("accountId") where "providerId"='pixel-pulse';
create or replace function app_private.pixel_ensure_auth_identity(s uuid,u uuid)
returns void language plpgsql security definer set search_path='' as $$
declare k text:='https://pixel-pulse-websites.vercel.app/api/sso#'||s::text;
begin
 if s is null or u is null or not exists(select 1 from app_private.pixel_links where subject=s and user_id=u)
 then raise exception 'The verified immutable binding is unavailable';end if;
 perform pg_advisory_xact_lock(hashtextextended('skyway-pixel-auth-directory:'||s::text,0));
 if exists(select 1 from neon_auth.account where "providerId"='pixel-pulse' and "accountId"=k and "userId"<>u)
 then raise exception 'This Pixel identity belongs to another game account';end if;
 insert into neon_auth.account("accountId","providerId","userId","updatedAt")
 select k,'pixel-pulse',u,clock_timestamp() where not exists(select 1 from neon_auth.account where "providerId"='pixel-pulse' and "accountId"=k);
end $$;

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
 return app_private.pixel_session_get(p_context->>'session_hash');
end $$;

-- Close legacy first-binding entry points, including direct management calls.
create or replace function app_private.pixel_management_bind(s uuid,n text,e text,v boolean,pv bigint,cv bigint,i text,u uuid,h text)
returns jsonb language plpgsql security definer set search_path='' as $$
begin raise exception 'First account connections require the fresh confirmed website flow';end $$;
create or replace function app_private.pixel_bind_account(p_subject uuid,p_username text,p_email text,p_verified boolean,p_link_user uuid,p_session_hash text,p_intent text)
returns jsonb language plpgsql security definer set search_path='' as $$
begin raise exception 'Start the current Pixel Pulse connection flow';end $$;
revoke all on function app_private.pixel_bind_account_v2(uuid,text,text,boolean,uuid,text,text,bigint,bigint,boolean)
 from public,anon,anonymous,authenticated,skyway_server_api;

do $acl$
declare item record;sig regprocedure;
begin
 for item in select p.oid::regprocedure as signature,p.proname,p.pronargs from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='app_private' and p.proname in('pixel_native_credential_stamp','pixel_native_session_stamp',
 'pixel_valid_profile','pixel_discovery_save','pixel_discovery_get','pixel_discovery_take',
 'pixel_attempt_begin_v2','pixel_attempt_confirm_native_password','pixel_attempt_take_v2','pixel_attempt_cancel','pixel_session_confirm_lease','pixel_signin_bound','pixel_ensure_auth_identity')
 or n.nspname='app_private' and p.proname='pixel_bind_account_v2' and p.pronargs=1 loop
  sig:=item.signature;
  execute format('revoke all on function %s from public,anon,anonymous,authenticated,skyway_server_api',sig);
  if sig::text not like '%pixel_native_credential_stamp(%' and sig::text not like '%pixel_native_session_stamp(%'
   and sig::text not like '%pixel_valid_profile(%' and sig::text not like '%pixel_ensure_auth_identity(%'
   and not(item.proname in('pixel_discovery_save','pixel_signin_bound') and item.pronargs<>4)
  then execute format('grant execute on function %s to skyway_server_api',sig);end if;
 end loop;
end $acl$;
notify pgrst,'reload schema';
commit;
