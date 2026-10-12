-- Canonical signed profiles, unique stable game IDs, explicit proof, verified-only adoption.
-- Apply after pixel-pulse-01-sessions.sql. No account, password, role or progress resets.
begin;
alter table public.player_profiles drop constraint if exists username_format;
alter table public.player_profiles add constraint username_format check(username~'^[A-Za-z0-9_ ]{3,25}$');

create or replace function app_private.pixel_sync_identity(s uuid,n text,e text,v boolean,pv bigint,cv bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p app_private.pixel_links;canonical text:=lower(btrim(regexp_replace(n,'[[:space:]]+',' ','g')));mail text:=lower(btrim(e));
begin
 if s is null or canonical is null or canonical!~'^[a-z0-9_ ]{3,25}$'
  or replace(canonical,' ','') in('admin','administrator','support','recall','system','root','moderator','pixelpulse','pixel_pulse','guest','anonymous','username_not_set','usernamenotset')
  or mail is null or length(mail)>254 or mail!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or v is null
  or pv is null or pv not between 0 and 9007199254740991 or cv is null or cv not between 0 and 9007199254740991 then raise exception 'Invalid Pixel Pulse profile';end if;
 if exists(select 1 from public.username_blocklist where
  (length(term)<4 and lower(regexp_replace(canonical,'[^a-zA-Z0-9]','','g'))=term) or
  (length(term)>=4 and position(term in lower(regexp_replace(canonical,'[^a-zA-Z0-9]','','g')))>0)) then raise exception 'Choose a different shared username; this name is not allowed on Skyway';end if;
 perform pg_advisory_xact_lock(hashtextextended('skyway-pixel:'||s::text,0));
 select * into p from app_private.pixel_links where issuer='https://pixel-pulse-websites.vercel.app/api/sso' and subject=s for update;
 if p.user_id is null then raise exception 'This Pixel Pulse account is not linked';end if;
 if pv<p.profile_version or cv<p.credential_version then raise exception 'This Pixel Pulse profile is older than the saved profile';end if;
 if pv=p.profile_version and (canonical<>p.username or mail<>p.email or v<>p.email_verified) then raise exception 'This Pixel Pulse profile version conflicts with the saved profile';end if;
 if mail<>p.email and not v then raise exception 'Verify your new email on Pixel Pulse before syncing';end if;
 perform pg_advisory_xact_lock(hashtextextended('skyway-pixel-email:'||mail,0));
 if mail='tmilsanmilla@gmail.com' and not exists(select 1 from neon_auth."user" where id=p.user_id and lower(btrim(email))=mail) then raise exception 'Link the existing administrator account instead';end if;
 if exists(select 1 from neon_auth."user" where id<>p.user_id and lower(btrim(email))=mail) then raise exception 'Your shared email is used by another Skyway account. No accounts were merged.';end if;
 if exists(select 1 from public.player_profiles where user_id<>p.user_id and lower(username)=canonical) then raise exception 'This shared username belongs to another Skyway player. No accounts were merged.';end if;
 update app_private.pixel_links set username=canonical,email=mail,email_verified=v,profile_version=pv,credential_version=cv where subject=s and issuer=p.issuer;
 if canonical<>p.username or mail<>p.email or v<>p.email_verified then
  update neon_auth."user" set name=canonical,email=mail,
   "emailVerified"=case when lower(btrim(email))=mail then "emailVerified" or v else v end,"updatedAt"=clock_timestamp() where id=p.user_id;
  insert into public.player_profiles(user_id,username,username_changed_at) values(p.user_id,canonical,clock_timestamp())
   on conflict(user_id) do update set username=excluded.username,username_changed_at=case when public.player_profiles.username<>excluded.username then excluded.username_changed_at else public.player_profiles.username_changed_at end;
 end if;
 if cv>p.credential_version then delete from app_private.pixel_sessions where issuer=p.issuer and subject=s and credential_version<cv;end if;
 return jsonb_build_object('state','linked','localAccountId',p.user_id,'profileVersion',pv,'credentialVersion',cv);
end $$;

create or replace function app_private.pixel_bind_account_v2(p_subject uuid,p_username text,p_email text,p_verified boolean,p_link_user uuid,p_session_hash text,p_intent text,p_profile_version bigint,p_credential_version bigint,p_adopt_verified boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_issuer text:='https://pixel-pulse-websites.vercel.app/api/sso';p app_private.pixel_links;u uuid;e text:=lower(btrim(p_email));n text:=lower(btrim(regexp_replace(p_username,'[[:space:]]+',' ','g')));matches integer;
begin
 if p_subject is null or n is null or n!~'^[a-z0-9_ ]{3,25}$'
  or e is null or length(e)>254 or e!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or p_verified is null
  or p_profile_version is null or p_profile_version not between 0 and 9007199254740991 or p_credential_version is null or p_credential_version not between 0 and 9007199254740991
  or p_session_hash is null or p_session_hash!~'^[a-f0-9]{64}$' or p_intent is null or p_intent not in('sign-in','create','link')
  or(p_intent='link' and p_link_user is null) or(p_intent<>'link' and p_link_user is not null) or p_adopt_verified is null
  or(p_adopt_verified and p_intent<>'sign-in') then raise exception 'Invalid Pixel Pulse profile';end if;
 perform pg_advisory_xact_lock(hashtextextended('skyway-pixel:'||p_subject::text,0));
 perform pg_advisory_xact_lock(hashtextextended('skyway-pixel-email:'||e,0));
 select * into p from app_private.pixel_links where pixel_links.issuer=v_issuer and subject=p_subject for update;
 if p.user_id is not null and p_link_user is not null and p.user_id<>p_link_user then raise exception 'This Pixel Pulse account is already linked to another Skyway account';end if;
 u:=coalesce(p.user_id,p_link_user);
 if u is null then
  select count(*) into matches from neon_auth."user" where lower(btrim(email))=e;
  if matches>0 then
   -- Normal Continue may adopt only when BOTH provider and native email are verified.
   -- Explicit Link never uses this path: its target must come from native password/session proof.
   if p_adopt_verified and p_verified and matches=1 then
    select id into u from neon_auth."user" where lower(btrim(email))=e and "emailVerified";
   end if;
   if u is null then raise exception 'An existing Skyway account uses this email. Use Link account in Pixel Pulse to keep your progress.';end if;
  else
   if e='tmilsanmilla@gmail.com' then raise exception 'Link the existing administrator account instead';end if;
   if exists(select 1 from public.player_profiles where lower(username)=n) then raise exception 'This shared username is already used by another Skyway player. No accounts were merged.';end if;
   insert into neon_auth."user"(name,email,"emailVerified") values(n,e,p_verified) returning id into u;
  end if;
 end if;
 if not exists(select 1 from neon_auth."user" where id=u) then raise exception 'The existing Skyway account is unavailable';end if;
 if e='tmilsanmilla@gmail.com' and not exists(select 1 from neon_auth."user" where id=u and lower(btrim(email))=e) then raise exception 'Link the existing administrator account instead';end if;
 if p.user_id is null and not exists(select 1 from neon_auth."user" where id=u and lower(btrim(email))=e) then raise exception 'Use the same email on Pixel Pulse and your existing Skyway account before linking';end if;
 if exists(select 1 from app_private.pixel_links where user_id=u and subject<>p_subject) then raise exception 'This Skyway account is linked to another Pixel Pulse account';end if;
 if p.user_id is null then
  insert into app_private.pixel_links(issuer,subject,user_id,username,email,email_verified,profile_version,credential_version) values(v_issuer,p_subject,u,n,e,p_verified,p_profile_version,p_credential_version);
  -- Sync still checks profanity, collisions and reserved names before this transaction commits.
  perform app_private.pixel_sync_identity(p_subject,n,e,p_verified,p_profile_version,p_credential_version);
  update neon_auth."user" set name=n,email=e,"emailVerified"="emailVerified" or p_verified,"updatedAt"=clock_timestamp() where id=u;
  insert into public.player_profiles(user_id,username,username_changed_at) values(u,n,clock_timestamp())
   on conflict(user_id) do update set username=excluded.username,username_changed_at=case when public.player_profiles.username<>excluded.username then excluded.username_changed_at else public.player_profiles.username_changed_at end;
 else
  perform app_private.pixel_sync_identity(p_subject,n,e,p_verified,p_profile_version,p_credential_version);
 end if;
 delete from app_private.pixel_sessions where expires_at<clock_timestamp();
 insert into app_private.pixel_sessions(token_hash,issuer,subject,expires_at,credential_version) values(p_session_hash,v_issuer,p_subject,clock_timestamp()+interval '7 days',p_credential_version);
 return app_private.pixel_session_get(p_session_hash);
end $$;

-- Backward-compatible private proof-only wrapper for the currently deployed callback.
create or replace function app_private.pixel_bind_account(p_subject uuid,p_username text,p_email text,p_verified boolean,p_link_user uuid,p_session_hash text,p_intent text)
returns jsonb language sql security definer set search_path='' as $$
 select app_private.pixel_bind_account_v2(p_subject,p_username,p_email,p_verified,p_link_user,p_session_hash,p_intent,0,0,false);
$$;

create or replace function app_private.pixel_account_status(s uuid,e text,v boolean)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare p app_private.pixel_links;c integer;
begin
 if s is null or e is null or v is null then raise exception 'Invalid Pixel Pulse profile';end if;
 select * into p from app_private.pixel_links where issuer='https://pixel-pulse-websites.vercel.app/api/sso' and subject=s;
 if p.user_id is not null then return jsonb_build_object('state','linked','localAccountId',p.user_id,'profileVersion',p.profile_version,'credentialVersion',p.credential_version);end if;
 if not v then return jsonb_build_object('state','verification_required');end if;
 select count(*) into c from neon_auth."user" where lower(btrim(email))=lower(btrim(e));
 if c>1 or exists(select 1 from app_private.pixel_links where lower(email)=lower(btrim(e))) then return jsonb_build_object('state','conflict');end if;
 return jsonb_build_object('state',case when c=1 then 'link_required' else 'create_available' end);
end $$;

create or replace function app_private.pixel_management_bind(s uuid,n text,e text,v boolean,pv bigint,cv bigint,i text,u uuid,h text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare status jsonb;
begin
 if not coalesce(v,false) or i not in('link','create') then raise exception 'Verify your email on Pixel Pulse before linking';end if;
 status:=app_private.pixel_account_status(s,e,v);
 if i='create' and status->>'state'<>'create_available' then raise exception 'This account must be linked, not created again';end if;
 if i='link' and status->>'state' not in('link_required','linked') then raise exception 'No existing account is available to link';end if;
 perform app_private.pixel_bind_account_v2(s,n,e,v,u,h,i,pv,cv,false);
 perform app_private.pixel_session_revoke(h);
 return app_private.pixel_account_status(s,e,v);
end $$;

create or replace function app_private.enforce_pixel_username()
returns trigger language plpgsql security definer set search_path='' as $$
declare canonical text;
begin
 select username into canonical from app_private.pixel_links where user_id=new.user_id;
 if canonical is not null and new.username<>canonical then raise exception 'Your username is managed by Pixel Pulse and shared across connected websites';end if;
 return new;
end $$;
drop trigger if exists pixel_username_guard on public.player_profiles;
create trigger pixel_username_guard before insert or update of username on public.player_profiles for each row execute function app_private.enforce_pixel_username();
create or replace function app_private.enforce_pixel_auth_profile()
returns trigger language plpgsql security definer set search_path='' as $$
declare p app_private.pixel_links;
begin
 select * into p from app_private.pixel_links where user_id=new.id;
 if p.user_id is not null and (new.name<>p.username or lower(btrim(new.email))<>p.email) then raise exception 'Your linked username and email are managed by Pixel Pulse';end if;
 return new;
end $$;
drop trigger if exists pixel_auth_profile_guard on neon_auth."user";
create trigger pixel_auth_profile_guard before update of name,email on neon_auth."user" for each row execute function app_private.enforce_pixel_auth_profile();
create or replace function public.get_my_pixel_identity()
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('linked',true,'username',username,'profileVersion',profile_version,'credentialVersion',credential_version) from app_private.pixel_links where user_id=auth.uid();
$$;
revoke all on function app_private.pixel_bind_account(uuid,text,text,boolean,uuid,text,text),app_private.pixel_bind_account_v2(uuid,text,text,boolean,uuid,text,text,bigint,bigint,boolean),app_private.pixel_sync_identity(uuid,text,text,boolean,bigint,bigint),app_private.pixel_account_status(uuid,text,boolean),app_private.pixel_management_bind(uuid,text,text,boolean,bigint,bigint,text,uuid,text),app_private.enforce_pixel_username(),app_private.enforce_pixel_auth_profile() from public,anon,anonymous,authenticated;
grant execute on function app_private.pixel_bind_account(uuid,text,text,boolean,uuid,text,text),app_private.pixel_bind_account_v2(uuid,text,text,boolean,uuid,text,text,bigint,bigint,boolean),app_private.pixel_sync_identity(uuid,text,text,boolean,bigint,bigint),app_private.pixel_account_status(uuid,text,boolean),app_private.pixel_management_bind(uuid,text,text,boolean,bigint,bigint,text,uuid,text) to skyway_server_api;
revoke all on function public.get_my_pixel_identity() from public,anon,anonymous;
grant execute on function public.get_my_pixel_identity() to authenticated;
notify pgrst,'reload schema';
commit;
