-- PREPARED ONLY: own-account appearance and audio preferences. Existing account,
-- username, inventory, balances, roles, credentials and results are untouched.
begin;
set local lock_timeout='3s';
set local statement_timeout='20s';
do $prerequisites$
begin
 if to_regclass('public.player_profiles') is null
    or to_regprocedure('app_private.require_pixel_runtime()') is null
    or to_regprocedure('app_private.photon_user()') is null
    or not exists(select 1 from pg_roles where rolname='authenticated') then
   raise exception 'Existing Skyway account/runtime prerequisites missing';
 end if;
end
$prerequisites$;

create table app_private.player_account_preferences(
 user_id uuid primary key references public.player_profiles(user_id) on delete cascade,
 avatar_color text not null default '#6b7280' check(avatar_color~'^#[a-f0-9]{6}$'),
 avatar_font text not null default 'pixel' check(avatar_font in('pixel','sans','serif','mono')),
 soundtrack text not null default 'energetic' check(soundtrack in('energetic','jazz','calm')),
 music_volume double precision not null default 0.45 check(music_volume between 0 and 1),
 sfx_volume double precision not null default 0.7 check(sfx_volume between 0 and 1),
 revision bigint not null default 1 check(revision between 1 and 9007199254740991),
 updated_at timestamptz not null default clock_timestamp()
);
alter table app_private.player_account_preferences enable row level security;
revoke all on app_private.player_account_preferences from public,anon,anonymous,authenticated;

create function public.get_player_account_preferences(p_expected_user uuid)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare u uuid; p app_private.player_account_preferences;
begin
 perform app_private.require_pixel_runtime();
 u:=app_private.photon_user();
 if p_expected_user is null or p_expected_user<>u then raise exception 'Signed-in account changed';end if;
 select * into p from app_private.player_account_preferences where user_id=u;
 return jsonb_build_object('avatarColor',coalesce(p.avatar_color,'#6b7280'),
  'avatarFont',coalesce(p.avatar_font,'pixel'),'soundtrack',coalesce(p.soundtrack,'energetic'),
  'musicVolume',coalesce(p.music_volume,0.45),'sfxVolume',coalesce(p.sfx_volume,0.7),
  'revision',coalesce(p.revision,0));
end
$function$;

create function public.set_player_account_preferences(p_expected_user uuid,p_expected_revision bigint,
 p_avatar_color text,p_avatar_font text,p_soundtrack text,p_music_volume double precision,p_sfx_volume double precision)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare u uuid; p app_private.player_account_preferences;
begin
 perform app_private.require_pixel_runtime();
 u:=app_private.photon_user();
 if p_expected_user is null or p_expected_user<>u then raise exception 'Signed-in account changed';end if;
 if p_expected_revision is null or p_expected_revision<0 or p_expected_revision>=9007199254740991
    or p_avatar_color is null or p_avatar_color!~*'^#[a-f0-9]{6}$'
    or p_avatar_font is null or p_avatar_font not in('pixel','sans','serif','mono')
    or p_soundtrack is null or p_soundtrack not in('energetic','jazz','calm')
    or p_music_volume is null or p_music_volume not between 0 and 1
    or p_sfx_volume is null or p_sfx_volume not between 0 and 1 then
  raise exception 'Invalid account settings';
 end if;
 if p_expected_revision=0 then
  insert into app_private.player_account_preferences(user_id,avatar_color,avatar_font,soundtrack,music_volume,sfx_volume)
   values(u,lower(p_avatar_color),p_avatar_font,p_soundtrack,p_music_volume,p_sfx_volume)
   on conflict(user_id) do nothing returning * into p;
 else
  update app_private.player_account_preferences set avatar_color=lower(p_avatar_color),avatar_font=p_avatar_font,
   soundtrack=p_soundtrack,music_volume=p_music_volume,sfx_volume=p_sfx_volume,
   revision=revision+1,updated_at=clock_timestamp()
   where user_id=u and revision=p_expected_revision returning * into p;
 end if;
 if p.user_id is null then raise exception using errcode='40001',message='Account settings changed; reload before saving';end if;
 return public.get_player_account_preferences(u);
end
$function$;
revoke all on function public.get_player_account_preferences(uuid),
 public.set_player_account_preferences(uuid,bigint,text,text,text,double precision,double precision)
 from public,anon,anonymous;
grant execute on function public.get_player_account_preferences(uuid),
 public.set_player_account_preferences(uuid,bigint,text,text,text,double precision,double precision)
 to authenticated;
notify pgrst,'reload schema';
commit;
