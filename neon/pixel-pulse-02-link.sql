-- Pixel Pulse: preserve existing game UUIDs; explicit native-session proof required for linking.
begin;
alter table public.player_profiles drop constraint if exists username_format;
alter table public.player_profiles add constraint username_format check(username~'^[A-Za-z0-9_]{3,24}$');
create or replace function app_private.pixel_bind_account(p_subject uuid,p_username text,p_email text,p_verified boolean,p_link_user uuid,p_session_hash text,p_intent text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_issuer text:='https://pixel-pulse-websites.vercel.app/api/sso';p app_private.pixel_links;u uuid;e text:=lower(btrim(p_email));
begin
 if p_subject is null or p_username is null or p_username!~'^[a-z0-9_]{3,24}$' or p_username in('admin','administrator','support','recall','system','root','moderator','pixelpulse','pixel_pulse','guest','anonymous','username_not_set','usernamenotset')
  or e is null or length(e)>254 or e!~'^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or p_verified is null
  or p_session_hash is null or p_session_hash!~'^[a-f0-9]{64}$' or p_intent is null or p_intent not in('sign-in','create','link')
  or(p_intent='link' and p_link_user is null) or(p_intent<>'link' and p_link_user is not null) then raise exception 'Invalid Pixel Pulse profile';end if;
 if exists(select 1 from public.username_blocklist where
  (length(term)<4 and lower(regexp_replace(p_username,'[^a-zA-Z0-9]','','g'))=term) or
  (length(term)>=4 and position(term in lower(regexp_replace(p_username,'[^a-zA-Z0-9]','','g')))>0)) then raise exception 'Choose a different shared username; this name is not allowed on Skyway';end if;
 perform pg_advisory_xact_lock(hashtextextended('skyway-pixel:'||p_subject::text,0));
 perform pg_advisory_xact_lock(hashtextextended('skyway-pixel-email:'||e,0));
 select * into p from app_private.pixel_links where pixel_links.issuer=v_issuer and subject=p_subject for update;
 if p.user_id is not null and p_link_user is not null and p.user_id<>p_link_user then raise exception 'This Pixel Pulse account is already linked to another Skyway account';end if;
 u:=coalesce(p.user_id,p_link_user);
 if u is null then
  -- Email, even verified email, is not game-account ownership proof.
  if exists(select 1 from neon_auth."user" where lower(btrim(email))=e) then
   raise exception 'An existing Skyway account uses this email. Sign in to it and choose Link Pixel Pulse (highly recommended) to keep your progress.';end if;
  if e='tmilsanmilla@gmail.com' then raise exception 'Link the existing administrator account instead';end if;
  if exists(select 1 from public.player_profiles where lower(username)=p_username) then raise exception 'This shared username is already used by another Skyway player. No accounts were merged.';end if;
  insert into neon_auth."user"(name,email,"emailVerified") values(p_username,e,p_verified) returning id into u;
 else
  if not exists(select 1 from neon_auth."user" where id=u) then raise exception 'The existing Skyway account is unavailable';end if;
  if p.user_id is null and not exists(select 1 from neon_auth."user" where id=u and lower(btrim(email))=e) then
   raise exception 'Use the same email on Pixel Pulse and your existing Skyway account before linking';end if;
  if exists(select 1 from app_private.pixel_links where user_id=u and subject<>p_subject) then raise exception 'This Skyway account is linked to another Pixel Pulse account';end if;
  if exists(select 1 from neon_auth."user" where id<>u and lower(btrim(email))=e) then raise exception 'Your shared email is used by another Skyway account. No accounts were merged.';end if;
  if exists(select 1 from public.player_profiles where user_id<>u and lower(username)=p_username) then raise exception 'This shared username belongs to another Skyway player. No accounts were merged.';end if;
 end if;
 if p.user_id is not null and p.username<>p_username then raise exception 'Shared usernames are immutable. Contact Pixel Pulse support.';end if;
 insert into app_private.pixel_links(issuer,subject,user_id,username,email,email_verified) values(v_issuer,p_subject,u,p_username,e,p_verified)
 on conflict(issuer,subject) do update set email=excluded.email,email_verified=excluded.email_verified;
 update neon_auth."user" set name=p_username,email=e,"emailVerified"=p_verified,"updatedAt"=clock_timestamp() where id=u;
 insert into public.player_profiles(user_id,username,username_changed_at) values(u,p_username,clock_timestamp())
 on conflict(user_id) do update set username=excluded.username,username_changed_at=case when public.player_profiles.username<>excluded.username then excluded.username_changed_at else public.player_profiles.username_changed_at end;
 delete from app_private.pixel_sessions where expires_at<clock_timestamp();
 insert into app_private.pixel_sessions(token_hash,issuer,subject,expires_at) values(p_session_hash,v_issuer,p_subject,clock_timestamp()+interval '7 days');
 return app_private.pixel_session_get(p_session_hash);
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
create or replace function public.get_my_pixel_identity()
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('linked',true,'username',username) from app_private.pixel_links where user_id=auth.uid();
$$;
revoke all on function app_private.pixel_bind_account(uuid,text,text,boolean,uuid,text,text),app_private.enforce_pixel_username() from public,anon,anonymous,authenticated;
grant execute on function app_private.pixel_bind_account(uuid,text,text,boolean,uuid,text,text) to skyway_server_api;
revoke all on function public.get_my_pixel_identity() from public,anon,anonymous;
grant execute on function public.get_my_pixel_identity() to authenticated;
notify pgrst,'reload schema';
commit;
