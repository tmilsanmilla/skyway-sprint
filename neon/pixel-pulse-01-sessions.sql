-- Pixel Pulse: private one-use PKCE attempts, hash-only bounded local sessions.
-- No passwords, role imports, account resets, or email-only linking.
begin;
create table if not exists app_private.pixel_links(
 issuer text not null check(issuer='https://pixel-pulse-websites.vercel.app/api/sso'),subject uuid not null,
 user_id uuid not null unique references neon_auth."user"(id) on delete cascade,
 username text not null unique check(username~'^[a-z0-9_]{3,24}$'),email text not null,email_verified boolean not null,
 linked_at timestamptz not null default clock_timestamp(),primary key(issuer,subject));
create table if not exists app_private.pixel_login_attempts(
 state_hash text primary key check(state_hash~'^[a-f0-9]{64}$'),browser_hash text not null,
 verifier text not null,nonce text not null,link_user_id uuid references neon_auth."user"(id),
 intent text not null check(intent in('sign-in','link','create')),expires_at timestamptz not null);
create table if not exists app_private.pixel_sessions(
 token_hash text primary key check(token_hash~'^[a-f0-9]{64}$'),issuer text not null,subject uuid not null,
 created_at timestamptz not null default clock_timestamp(),expires_at timestamptz not null,
 foreign key(issuer,subject) references app_private.pixel_links(issuer,subject) on delete cascade);
alter table app_private.pixel_links enable row level security;
alter table app_private.pixel_login_attempts enable row level security;
alter table app_private.pixel_sessions enable row level security;
revoke all on app_private.pixel_links,app_private.pixel_login_attempts,app_private.pixel_sessions from public,anon,anonymous,authenticated,skyway_server_api;
create or replace function app_private.pixel_attempt_begin(s text,b text,v text,n text,i text,u uuid)
returns void language plpgsql security definer set search_path='' as $$
begin
 if s!~'^[a-f0-9]{64}$' or b!~'^[a-f0-9]{64}$' or v!~'^[A-Za-z0-9_-]{43,128}$' or n!~'^[A-Za-z0-9_-]{32,128}$'
  or i not in('sign-in','link','create') or (i='link' and u is null) or (i<>'link' and u is not null) then raise exception 'Invalid connection attempt';end if;
 delete from app_private.pixel_login_attempts where expires_at<clock_timestamp();
 insert into app_private.pixel_login_attempts values(s,b,v,n,u,i,clock_timestamp()+interval '5 minutes');
end $$;
create or replace function app_private.pixel_attempt_take(s text,b text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a app_private.pixel_login_attempts;
begin
 delete from app_private.pixel_login_attempts where state_hash=s and browser_hash=b and expires_at>clock_timestamp() returning * into a;
 if a.state_hash is null then raise exception 'This sign-in expired or was already used. Start again.';end if;
 return jsonb_build_object('verifier',a.verifier,'nonce',a.nonce,'link_user_id',a.link_user_id,'intent',a.intent);
end $$;
create or replace function app_private.pixel_session_get(h text)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('user_id',p.user_id,'subject',p.subject,'username',p.username,'email',p.email,
 'email_verified',p.email_verified,'expires_at',s.expires_at,'created_at',s.created_at)
 from app_private.pixel_sessions s join app_private.pixel_links p using(issuer,subject) join neon_auth."user" u on u.id=p.user_id
 where s.token_hash=h and s.expires_at>clock_timestamp() and
 (not coalesce(u.banned,false) or (u."banExpires" is not null and u."banExpires"<clock_timestamp()));
$$;
create or replace function app_private.pixel_session_revoke(h text)
returns void language sql security definer set search_path='' as $$delete from app_private.pixel_sessions where token_hash=h$$;
revoke all on function app_private.pixel_attempt_begin(text,text,text,text,text,uuid),app_private.pixel_attempt_take(text,text),
 app_private.pixel_session_get(text),app_private.pixel_session_revoke(text) from public,anon,anonymous,authenticated;
grant execute on function app_private.pixel_attempt_begin(text,text,text,text,text,uuid),app_private.pixel_attempt_take(text,text),
 app_private.pixel_session_get(text),app_private.pixel_session_revoke(text) to skyway_server_api;
commit;
