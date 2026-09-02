-- Admin 03 Player Lookup and Commands / Player Record
--
-- These COMMENT statements relabel objects created by the already-applied
-- 20260901160000 and 20260902120000 migrations. The historical migration
-- versions and function signatures remain unchanged.
--
-- Canonical label map (historical filenames stay immutable):
--   20260901033000_admin_02_roles.sql
--     Admin 02 Admins — foundation
--   20260901160000_admin_02_player_look_commands.sql
--     Admin 03 Player Lookup and Commands
--   20260902120000_admin_02_player_record.sql
--     Admin 03 Player Record
--   20260902140000_admin_02_admins.sql
--     Admin 02 Admins — hardened role management

comment on table public.player_devices is
  'Admin 03 Player Lookup and Commands: opaque app-device identities used for account/device moderation.';
comment on table public.player_device_links is
  'Admin 03 Player Lookup and Commands: server-only links between accounts and opaque app devices.';
comment on table public.player_bans is
  'Admin 03 Player Lookup and Commands: account, device, and leaderboard moderation records.';
comment on table public.admin_command_audit is
  'Admin 03 Player Lookup and Commands: append-only audit of typed player-editor commands.';

comment on function public.register_player_device(text, text) is
  'Admin 03 Player Lookup and Commands: registers an opaque browser-profile device and returns active access restrictions.';
comment on function public.check_player_device(text) is
  'Admin 03 Player Lookup and Commands: checks guest device access without exposing the raw token.';
comment on function public.admin_player_search(text, integer) is
  'Admin 03 Player Lookup and Commands: role-checked player search for main admins and co-admins.';
comment on function public.admin_get_player(uuid) is
  'Admin 03 Player Lookup and Commands: role-checked player detail and inventory lookup.';
comment on function public.admin_command_suggestions(text, text, uuid, integer) is
  'Admin 03 Player Lookup and Commands: role-checked command, catalog-item, and player suggestions.';
comment on function public.admin_execute_player_command(
  text, uuid, text, text, text, bigint, text[], uuid, bigint, boolean,
  bigint, text, text
) is
  'Admin 03 Player Lookup and Commands: main-admin-only typed player mutation and moderation command executor.';
comment on function public.admin_get_command_audit(uuid, integer) is
  'Admin 03 Player Lookup and Commands: main-admin-only command audit reader.';
comment on function public.admin_get_player_record(uuid) is
  'Admin 03 Player Record: role-checked moderation and command history for one player.';
