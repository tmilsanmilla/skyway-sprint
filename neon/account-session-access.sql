-- Account session access · repair the existing startup permissions only.
-- No accounts, passwords, inventory, or game stats are reset.
begin;

revoke all on function public.register_player_device(text,text),
  public.is_admin(), public.get_admin_role(), public.get_admin_test_mode(),
  public.get_player_progression()
  from public, anon, anonymous;
grant execute on function public.register_player_device(text,text),
  public.is_admin(), public.get_admin_role(), public.get_admin_test_mode(),
  public.get_player_progression()
  to authenticated;

notify pgrst, 'reload schema';
commit;
