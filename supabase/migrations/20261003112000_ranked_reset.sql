-- Multi-device 03 Ranked · fresh ratings; previous unlocks do not carry over.
-- Requalification stays locked until the new entry requirement is decided.
begin;
create table if not exists app_private.ranked_requalification (
  user_id uuid primary key references public.player_stats(user_id) on delete cascade,
  qualified boolean not null default false, qualified_at timestamptz
);
revoke all on app_private.ranked_requalification from public,anon,authenticated;
-- Reset once, not on every rerun of this saved query.
do $$ begin
  if not exists(select 1 from public.ranked_1v1_seasons where id=20261003) then
    update public.player_ranked_1v1_stats set rating=1500,matches_played=0,wins=0,losses=0,draws=0,current_streak=0,best_streak=0,updated_at=clock_timestamp();
    update public.player_1v1_stats set rating=1500;
    update public.ranked_1v1_seasons set is_active=false,ends_at=coalesce(ends_at,clock_timestamp()) where is_active;
    insert into public.ranked_1v1_seasons(id,name,is_active) values(20261003,'Photon Fury Update',true);
    update public.multiplayer_matches set status='cancelled',finished_at=clock_timestamp() where mode='ranked' and status in ('countdown','playing','intermission');
    delete from public.multiplayer_queue where mode='ranked';
  end if;
end $$;
alter table public.player_ranked_1v1_stats alter column rating set default 1500;
-- A new ranked-pool row always starts at 1500; no old-season rating is copied.
do $$ declare f text; begin
  for f in select pg_get_functiondef(oid) from pg_proc where oid in (
    'public.get_player_progression()'::regprocedure,
    'app_private.apply_player_xp(uuid,bigint,boolean)'::regprocedure
  ) loop
    f:=replace(replace(f,'v_stats.level>=20','false'),'v_level>=20','false');
    execute f;
  end loop;
  f:=pg_get_functiondef('public.join_1v1_queue(text)'::regprocedure);
  if position('ranked_requalification' in f)=0 then
    f:=replace(f,'begin' || chr(10),'begin' || chr(10) || '  if v_mode=''ranked'' and not exists(select 1 from app_private.ranked_requalification where user_id=v_uid and qualified) then raise exception ''Ranked is locked after the rating reset''; end if;' || chr(10));
    execute f;
  end if;
end $$;
notify pgrst,'reload schema';
commit;
