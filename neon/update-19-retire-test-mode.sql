-- Admin 05 Test Mode · retired in Update 19. Historical test receipts remain excluded.
begin;
-- Test Mode is retired. Historical test receipts remain excluded from rewards.
create or replace function app_private.is_admin_test_user(p_user_id uuid) returns boolean language sql stable security definer set search_path='' as $$select false$$;
create or replace function public.get_admin_test_mode() returns jsonb language sql stable security definer set search_path='' as $$select jsonb_build_object('enabled',false)$$;
create or replace function public.set_admin_test_mode(p_enabled boolean) returns jsonb language plpgsql security definer set search_path='' as $$begin raise exception 'Test Mode has been removed';end$$;
create or replace function app_private.snapshot_1v1_test_mode() returns trigger language plpgsql set search_path='' as $$begin new.test_mode:=false;return new;end$$;
notify pgrst,'reload schema';
commit;
