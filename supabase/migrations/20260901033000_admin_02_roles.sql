-- Admin 02 Roles: main/co-admin management and non-archived report resolution.
alter table public.admin_users add column if not exists user_id uuid unique references auth.users(id) on delete cascade;
alter table public.admin_users add column if not exists role text not null default 'co_admin' check (role in ('main','co_admin'));

update public.admin_users set role='main', user_id=(select id from auth.users where lower(email)='tmilsanmilla@gmail.com' limit 1) where email='tmilsanmilla@gmail.com';

create or replace function public.is_main_admin() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.admin_users where email=lower(coalesce(auth.jwt()->>'email','')) and role='main');
$$;
create or replace function public.get_admin_role() returns text language sql stable security definer set search_path='' as $$
 select role from public.admin_users where email=lower(coalesce(auth.jwt()->>'email',''));
$$;
create or replace function public.list_admins() returns table(user_id uuid,email text,username text,role text)
language plpgsql stable security definer set search_path='' as $$ begin
 if not public.is_admin() then raise exception 'Admin access required'; end if;
 return query select au.id,lower(au.email)::text,pp.username,ad.role from public.admin_users ad join auth.users au on lower(au.email)=ad.email left join public.player_profiles pp on pp.user_id=au.id order by case when ad.role='main' then 0 else 1 end,lower(au.email);
end; $$;
create or replace function public.manage_admin(target text,admin_action text) returns void language plpgsql security definer set search_path='' as $$
declare found_id uuid; found_email text; begin
 if not public.is_main_admin() then raise exception 'Only main admins can manage admins'; end if;
 select au.id,lower(au.email) into found_id,found_email from auth.users au left join public.player_profiles pp on pp.user_id=au.id where lower(au.email)=lower(trim(target)) or lower(pp.username)=lower(trim(target)) limit 1;
 if found_id is null then raise exception 'No player found with that email or username'; end if;
 if found_email=lower(coalesce(auth.jwt()->>'email','')) and admin_action in ('remove','demote') then raise exception 'You cannot remove or demote yourself'; end if;
 if admin_action='add' then insert into public.admin_users(email,user_id,role) values(found_email,found_id,'co_admin') on conflict(email) do update set user_id=excluded.user_id;
 elsif admin_action='promote' then update public.admin_users set role='main',user_id=found_id where email=found_email; if not found then raise exception 'Add this player as a co-admin first'; end if;
 elsif admin_action='demote' then update public.admin_users set role='co_admin' where email=found_email and role='main';
 elsif admin_action='remove' then delete from public.admin_users where email=found_email and role='co_admin';
 else raise exception 'Invalid admin action'; end if;
end; $$;
create or replace function public.resolve_player_report(report_id bigint) returns void language plpgsql security definer set search_path='' as $$ begin
 if not public.is_admin() then raise exception 'Admin access required'; end if; delete from public.player_reports where id=report_id;
end; $$;

delete from public.player_reports where status='resolved';
revoke all on function public.is_main_admin(),public.get_admin_role(),public.list_admins(),public.manage_admin(text,text),public.resolve_player_report(bigint) from public;
grant execute on function public.is_main_admin(),public.get_admin_role(),public.list_admins(),public.manage_admin(text,text),public.resolve_player_report(bigint) to authenticated;
