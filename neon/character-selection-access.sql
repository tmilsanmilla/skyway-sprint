-- Restore own-account character selection and departure from the caller's 1v1.
-- No direct inventory/table access, admin permissions or opponent actions.
-- Apply directly to Neon; saved editor copies are not deployments.
begin;
do $$declare p record;f text;begin
  select prosecdef,proconfig into p from pg_proc where oid='public.set_loadout(text,text)'::regprocedure;
  f:=pg_get_functiondef('public.set_loadout(text,text)'::regprocedure);
  if not p.prosecdef or not coalesce('search_path=""'=any(p.proconfig),false)
     or position('v_uid uuid:=auth.uid()' in f)=0
     or position('Sign in required' in f)=0
     or position('Character is not unlocked' in f)=0
     or position('Item is not unlocked for this slot' in f)=0
     or position('where user_id=v_uid' in f)=0 then
    raise exception 'Own-account loadout guard failed verification';
  end if;
end$$;
do $$declare p record;f text;begin
  select prosecdef,proconfig into p from pg_proc where oid='public.leave_1v1()'::regprocedure;
  f:=pg_get_functiondef('public.leave_1v1()'::regprocedure);
  if not p.prosecdef or not coalesce('search_path=""'=any(p.proconfig),false)
     or position('v_uid uuid := auth.uid()' in f)=0
     or position('Sign in required' in f)=0
     or position('delete from public.multiplayer_queue where user_id = v_uid' in f)=0
     or position('where player.user_id = v_uid' in f)=0
     or position('return public.finish_1v1(v_match_id)' in f)=0 then
    raise exception 'Own-match leave guard failed verification';
  end if;
end$$;
revoke all on function public.set_loadout(text,text) from public,anon,anonymous;
grant execute on function public.set_loadout(text,text) to authenticated;
revoke all on function public.leave_1v1() from public,anon,anonymous;
grant execute on function public.leave_1v1() to authenticated;
notify pgrst,'reload schema';
commit;
