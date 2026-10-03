-- Weapons MISC · Katana reflects one hazard and cooldown begins on unwield.
begin;
alter table public.multiplayer_players add column if not exists katana_cooldown_until timestamptz;
do $$ declare f text; begin
  f:=pg_get_functiondef('public.activate_1v1_katana(uuid)'::regprocedure);
  f:=replace(f,'v_now - interval ''6 seconds''','v_now - interval ''6.4 seconds''');
  f:=replace(f,'v_now + interval ''6 seconds''','v_now + interval ''6.4 seconds''');
  execute f;
  f:=pg_get_functiondef('public.reflect_1v1_attack(uuid,text,text,uuid)'::regprocedure);
  f:=replace(f,'interval ''1 second''','interval ''0.4 seconds''');
  f:=replace(f,'if v_activation_reflections >= 8 then','if v_activation_reflections >= 1 then');
  f:=replace(f,'v_self.last_katana_at + interval ''6 seconds''','v_self.last_katana_at + interval ''6.4 seconds''');
  -- End the guard immediately. Preserve the activation time for receipt counting;
  -- cooldown ends six seconds after the one successful block, not after key-down.
  f:=replace(f,'set last_seen_at = v_now,' || chr(10) || '      updated_at = v_now','set katana_cooldown_until=v_now+interval ''6 seconds'', last_seen_at = v_now,' || chr(10) || '      updated_at = v_now');
  f:=replace(f,'''katana_cooldown_ends_at'', v_self.last_katana_at + interval ''6.4 seconds''','''katana_cooldown_ends_at'', v_now + interval ''6 seconds''');
  f:=replace(f,'''katana_cooldown_until'', v_self.last_katana_at + interval ''6.4 seconds''','''katana_cooldown_until'', v_now + interval ''6 seconds''');
  f:=replace(f,'else v_self.last_katana_at + interval ''6.4 seconds''','else coalesce(v_self.katana_cooldown_until,v_self.last_katana_at + interval ''6.4 seconds'')');
  execute f;
end $$;
-- Activation must respect a previously consumed guard, including the .4s miss window.
do $$ declare f text; begin
  f:=pg_get_functiondef('public.activate_1v1_katana(uuid)'::regprocedure);
  f:=replace(f,'v_self.last_katana_at > v_now - interval ''6.4 seconds''','coalesce(v_self.katana_cooldown_until,v_self.last_katana_at+interval ''6.4 seconds'') > v_now');
  f:=replace(f,'set last_katana_at = v_now,','set katana_cooldown_until=v_now+interval ''6.4 seconds'', last_katana_at = v_now,');
  execute f;
  f:=pg_get_functiondef('app_private.get_1v1_state_before_new_maps(uuid)'::regprocedure);
  f:=replace(f,'v_self.last_katana_at + interval ''6 seconds''','coalesce(v_self.katana_cooldown_until,v_self.last_katana_at + interval ''6.4 seconds'')');
  f:=replace(f,'v_opponent.last_katana_at + interval ''6 seconds''','coalesce(v_opponent.katana_cooldown_until,v_opponent.last_katana_at + interval ''6.4 seconds'')');
  execute f;
end $$;
notify pgrst,'reload schema';
commit;
