-- Update 2.3 · progression, retained entitlements and Photon economy.
-- Apply ONCE after the installed QOL progression/extraction/Photon 01–04.
-- This is an authorized XP-only reset, not an account/inventory/currency reset.
-- Unexpected installed lifecycle definitions abort the entire transaction.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
select pg_advisory_xact_lock(20261017,23);

create table if not exists app_private.mode_unlock_entitlements(
 user_id uuid not null references public.player_stats(user_id) on delete cascade,
 mode text not null check(mode in('casual','rotating','unlimited')),
 unlocked_at timestamptz not null default clock_timestamp(),primary key(user_id,mode));
alter table app_private.mode_unlock_entitlements enable row level security;
revoke all on app_private.mode_unlock_entitlements from public,anon,anonymous,authenticated;
do $$ begin
 if not exists(select 1 from app_private.progression_resets where version=20261017) then
  lock table public.player_progression_runs in access exclusive mode;
  lock table public.player_stats in share row exclusive mode;
  lock table public.player_progression_events in share row exclusive mode;
  -- Both Casual and the old rotating modes were free at level 5. Preserve
  -- those already-earned entitlements BEFORE zeroing only XP/level columns.
  insert into app_private.mode_unlock_entitlements(user_id,mode)
   select user_id,mode from public.player_stats cross join(values('casual'),('rotating')) m(mode)
   where level>=5 on conflict do nothing;
  update public.player_stats set level=0,xp_in_level=0,lifetime_xp=0,
   progression_version=20261017;
  update public.player_progression_events set xp_awarded=0,metadata=metadata-'xp_breakdown'
   where xp_awarded<>0 or metadata?'xp_breakdown';
  insert into app_private.progression_resets(version) values(20261017);
 end if;
end $$;
alter table public.player_stats alter column progression_version set default 20261017;

create or replace function app_private.xp_required_for_level(p_level integer)
returns bigint language sql immutable strict set search_path='' as $$
 select floor(400+60*power(greatest(p_level,0)::numeric,1.1))::bigint;
$$;
create or replace function app_private.cumulative_xp_for_level(p_level integer)
returns bigint language sql immutable strict set search_path='' as $$
 select coalesce(sum(app_private.xp_required_for_level(n)),0)::bigint from generate_series(0,greatest(p_level,0)-1) n;
$$;
create or replace function app_private.level_for_lifetime_xp(p_lifetime_xp bigint)
returns integer language plpgsql immutable strict set search_path='' as $$
declare total numeric:=greatest(p_lifetime_xp,0);required bigint;l integer:=0;
begin
 loop
  required:=app_private.xp_required_for_level(l);
  exit when total<required;
  total:=total-required;l:=l+1;
 end loop;
 return l;
end $$;
create or replace function app_private.endless_run_xp_breakdown(p_score bigint,p_gem_count bigint)
returns jsonb language sql immutable strict set search_path='' as $$
 with awards as(select floor(power(greatest(p_score,0)::numeric/1200,2.1))::bigint score,
  greatest(p_gem_count,0)*10 gems)
 select jsonb_build_object('score',score,'gems',gems,'gem_count',greatest(p_gem_count,0),'total',score+gems) from awards;
$$;
create or replace function app_private.endless_verified_gem_xp(p_user_id uuid,p_run_id uuid)
returns bigint language sql stable strict set search_path='' as $$
 select count(*)*10 from public.player_progression_events event
 where event.user_id=p_user_id and event.source='gem'
 and event.metadata->>'context_id'=p_run_id::text and event.metadata->>'context_type'='endless';
$$;
create or replace function app_private.retain_level_mode_unlocks(p_user_id uuid,p_level integer)
returns void language sql volatile security definer set search_path='' as $$
 insert into app_private.mode_unlock_entitlements(user_id,mode)
 select p_user_id,mode from(values('casual',5),('rotating',15)) x(mode,min_level)
 where p_level>=min_level on conflict do nothing;
$$;
create or replace function app_private.has_level_mode_unlocked(p_user_id uuid,p_mode text)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from app_private.mode_unlock_entitlements where user_id=p_user_id and mode=p_mode)
 or exists(select 1 from public.player_stats where user_id=p_user_id and level>=case p_mode when 'casual' then 5 when 'rotating' then 15 else 2147483647 end);
$$;
create or replace function app_private.unlimited_1v1_requirements(p_user_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 with owned as(select distinct c.item_key,c.rarity from public.extraction_catalog c join public.player_unlocks u using(item_key)
  where u.user_id=p_user_id and c.active and c.item_type='character' and c.character_class in('runner','medic','tank','trickster','misc') and c.item_key not like 'photon_%'),
 counts as(select count(*) filter(where rarity in('common','uncommon','rare','epic')) low,
  count(*) filter(where rarity='legendary') legendary,count(*) filter(where rarity='mythic') mythic from owned),
 status as(select coalesce((select level from public.player_stats where user_id=p_user_id),0) level,
  exists(select 1 from app_private.ranked_requalification where user_id=p_user_id and qualified) ranked,
  exists(select 1 from public.player_photon_fury where user_id=p_user_id and unlocked_at is not null) photon)
 select jsonb_build_object('low_tier_owned',least(low,80),'low_tier_required',80,'legendary_owned',least(legendary,18),
  'legendary_required',18,'mythic_owned',least(mythic,3),'mythic_required',3,'modes_complete',ranked and photon,
  'level_complete',level>=45,'unlocked',low>=80 and legendary>=18 and mythic>=3 and ranked and photon and level>=45) from counts cross join status;
$$;
create or replace function public.get_player_progression()
returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid();s public.player_stats;paid boolean;unlimited jsonb;
begin
 if u is null then raise exception 'Sign in required';end if;
 insert into public.player_stats(user_id,total_gems,high_score,updated_at) values(u,0,0,now()) on conflict(user_id) do nothing;
 select * into s from public.player_stats where user_id=u;
 perform app_private.retain_level_mode_unlocks(u,s.level);
 paid:=exists(select 1 from app_private.ranked_requalification where user_id=u and qualified);
 unlimited:=app_private.unlimited_1v1_requirements(u);
 if (unlimited->>'unlocked')::boolean then insert into app_private.mode_unlock_entitlements(user_id,mode) values(u,'unlimited') on conflict do nothing;end if;
 return jsonb_build_object('level',s.level,'xp',s.xp_in_level,'xp_required',app_private.xp_required_for_level(s.level),
 'lifetime_xp',s.lifetime_xp,'completed_runs',s.completed_runs,'casual_unlocked',app_private.has_level_mode_unlocked(u,'casual'),
 'rotating_unlocked',app_private.has_level_mode_unlocked(u,'rotating'),'ranked_purchased',paid,'ranked_unlocked',paid,
 'photon_unlocked',exists(select 1 from public.player_photon_fury where user_id=u and unlocked_at is not null),
 'unlimited_unlocked',exists(select 1 from app_private.mode_unlock_entitlements where user_id=u and mode='unlimited'),
 'unlimited_requirements',unlimited,'progression_version',s.progression_version);
end $$;
create or replace function app_private.apply_player_xp(p_user_id uuid,p_amount bigint,p_completed_run boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare l integer;x bigint;t bigint;r bigint;v integer;paid boolean;
begin
 if p_user_id is null or p_amount is null or p_amount<0 or p_amount>700000000000000::bigint then raise exception 'Invalid XP award';end if;
 insert into public.player_stats(user_id,total_gems,high_score,updated_at) values(p_user_id,0,0,now()) on conflict(user_id) do nothing;
 select lifetime_xp,completed_runs,progression_version into t,r,v from public.player_stats where user_id=p_user_id for update;
 if t>9223372036854775807::bigint-p_amount then raise exception 'Lifetime XP exceeds the supported range';end if;
 t:=t+p_amount;l:=app_private.level_for_lifetime_xp(t);x:=t-app_private.cumulative_xp_for_level(l);
 r:=r+case when p_completed_run then 1 else 0 end;
 update public.player_stats set level=l,xp_in_level=x,lifetime_xp=t,completed_runs=r,updated_at=now() where user_id=p_user_id;
 perform app_private.retain_level_mode_unlocks(p_user_id,l);
 paid:=exists(select 1 from app_private.ranked_requalification where user_id=p_user_id and qualified);
 return jsonb_build_object('level',l,'xp',x,'xp_required',app_private.xp_required_for_level(l),'lifetime_xp',t,'completed_runs',r,
 'casual_unlocked',app_private.has_level_mode_unlocked(p_user_id,'casual'),'rotating_unlocked',app_private.has_level_mode_unlocked(p_user_id,'rotating'),
 'ranked_purchased',paid,'ranked_unlocked',paid,'progression_version',v,'xp_awarded',p_amount);
end $$;

-- Narrow, signature-bound substitutions keep installed bans, row locks,
-- ownership checks, receipts, anti-replay and validation intact.
do $patches$ declare d text;entry record;old_text text;new_text text;begin
 for entry in select * from(values
 ('public.unlock_ranked_1v1()','s.level<25','s.level<35'),
 ('public.unlock_ranked_1v1()','Ranked requires level 25','Ranked requires level 35'),
 ('public.unlock_ranked_1v1()','s.total_gems<100','s.total_gems<235'),
 ('public.unlock_ranked_1v1()','You need 100 Gems','You need 235 Gems'),
 ('public.unlock_ranked_1v1()','total_gems=total_gems-100','total_gems=total_gems-235'),
 ('public.unlock_photon_fury()','coalesce(s.level,0)<15','coalesce(s.level,0)<25'),
 ('public.unlock_photon_fury()','Requires level 15','Requires level 25'),
 ('app_private.purchase_photon_weapon(text)','s.level<35','s.level<40'),
 ('app_private.purchase_photon_weapon(text)','Photon weapon purchases require level 35','Photon weapon purchases require level 40')
 ) patches(signature,before_text,after_text) loop
  d:=pg_get_functiondef(entry.signature::regprocedure);old_text:=entry.before_text;new_text:=entry.after_text;
  if position(new_text in d)>0 then continue;end if;
  if (length(d)-length(replace(d,old_text,'')))/length(old_text)<>1 then raise exception 'Unexpected installed function %; aborted',entry.signature;end if;
  execute replace(d,old_text,new_text);
 end loop;
end $patches$;

-- The run award uses verified physical receipts, never streak currency amounts.
do $run_patch$ declare d text;needle text:=E'  v_xp:=(v_breakdown->>''total'')::bigint;';begin
 d:=pg_get_functiondef('app_private.award_completed_run_v2_live(uuid,bigint,text)'::regprocedure);
 if position('Update 2.3 physical Gems and XP fence' in d)=0 then
  if position(needle in d)=0 or position('for update' in lower(d))=0 or position('v_completed_at is not null' in d)=0 then raise exception 'Unexpected run award definition';end if;
  execute replace(d,needle,E'  -- Update 2.3 physical Gems and XP fence.\n'
   ||E'  v_gem_count:=app_private.endless_verified_gem_xp(v_uid,p_run_id)/10;\n'
   ||E'  v_breakdown:=app_private.endless_run_xp_breakdown(v_score,v_gem_count);\n'
   ||needle||E'\n  if v_started_at < (select applied_at from app_private.progression_resets where version=20261017) then\n'
   ||E'    v_xp:=0;v_breakdown:=jsonb_build_object(\'score\',0,\'gems\',0,\'gem_count\',v_gem_count,\'total\',0);\n  end if;');
 end if;
end $run_patch$;

create or replace function app_private.photon_points_reward(p_points numeric)
returns bigint language sql immutable strict set search_path='' as $$
 select case when floor(p_points)>=5 then ((floor(p_points)-5)^2+1)::bigint else 0::bigint end;
$$;

-- Extend, never replace/delete, the existing catalog/ownership keys.
do $catalog_backup$ declare d text;begin
 if to_regprocedure('app_private.photon_qol_catalog_pre_20261017()') is null then
  d:=pg_get_functiondef('app_private.photon_qol_catalog()'::regprocedure);
  if position('photon_theme_celestial' in d)=0 or position('divine' in d)=0 then raise exception 'Unexpected Photon catalog';end if;
  execute replace(d,'FUNCTION app_private.photon_qol_catalog(', 'FUNCTION app_private.photon_qol_catalog_pre_20261017(');
 end if;
end $catalog_backup$;
create or replace function app_private.photon_qol_catalog()
returns table(item_key text,display_name text,kind text,character_key text,rarity text)
language sql immutable set search_path='' as $$
 select * from app_private.photon_qol_catalog_pre_20261017()
 union all select c.item_key||'_'||s.tier,c.display_name||case s.tier when 'ascendant' then ' Starforged' else ' Eternity' end,
 'skin',c.item_key,s.tier from app_private.photon_qol_catalog_pre_20261017() c
 cross join(values('ascendant'),('immortal')) s(tier) where c.kind='character'
 union all select key,name,'theme',null,rarity from(values
 ('photon_theme_arcade','Arcade Atrium','common'),('photon_theme_tidal','Tidal Generator','uncommon'),
 ('photon_theme_blossom','Ion Blossom','rare'),('photon_theme_eclipse','Eclipse Observatory','epic'),
 ('photon_theme_aurora','Aurora Palace','legendary'),('photon_theme_infinity','Infinity Spire','mythic'),
 ('photon_theme_elysium','Elysium Gate','mythic')) themes(key,name,rarity);
$$;
create or replace function app_private.photon_skin_pick(intermediate_only boolean default false)
returns text language plpgsql volatile set search_path='' as $$
declare c text;t text;begin
 select character_key into c from app_private.photon_character_rules(null) order by random() limit 1;
 t:=case when intermediate_only then 'intermediate' else app_private.photon_weighted_pick(array['intermediate','pro','ascendant','divine','immortal'],array[53,35,8,3,1]) end;
 return c||'_'||t;
end $$;

do $photon_patches$ declare d text;entry record;begin
 for entry in select * from(values
 ('public.begin_photon_character_run(text)','rules_version=20261014','rules_version=20261017'),
 ('public.begin_photon_character_run(text)',E'''rules_version'',20261014',E'''rules_version'',20261017'),
 ('public.finish_photon_character_run(uuid,numeric,integer,integer)','r.rules_version<>20261014','r.rules_version not in(20261014,20261017)'),
 ('public.finish_photon_character_run(uuid,numeric,integer,integer)','when p>=14 then (2*(p-14)^2+1)::bigint','when p>=16 then (2*(p-16)^2+1)::bigint'),
 ('app_private.open_photon_box(uuid)','gem_bonus integer:=0','gem_bonus integer:=0;stardust_bonus integer:=0'),
 ('app_private.open_photon_box(uuid)','if r<.65 then','if r<.72 then'),
 ('app_private.open_photon_box(uuid)',E'elsif r<.80 then\n  gem_bonus:=20;results:=results||jsonb_build_array(jsonb_build_object(''part'',''C'',''kind'',''gems'',''key'',''gems_20'',''amount'',20,''is_new'',true,''duplicate_gems'',0));\n else keys:=array_append(keys,app_private.photon_skin_pick(true));parts:=array_append(parts,''C'');end if;',
  E'elsif r<.96 then\n  keys:=array_append(keys,app_private.photon_skin_pick(true));parts:=array_append(parts,''C'');\n else stardust_bonus:=75;results:=results||jsonb_build_array(jsonb_build_object(''part'',''C'',''kind'',''stardust'',''key'',''stardust_75'',''amount'',75,''is_new'',true,''duplicate_gems'',0));end if;'),
 ('app_private.open_photon_box(uuid)',E'case when inserted=1 then 0 when item.kind=''skin'' and parts[j]=''B'' then 10 else 5 end','case when inserted=1 then 0 else 10 end'),
 ('app_private.open_photon_box(uuid)','set total_gems=total_gems+refund_total+gem_bonus,','set total_gems=total_gems+refund_total+gem_bonus,stardust=stardust+stardust_bonus,'),
 ('app_private.open_photon_box(uuid)',E'''gem_bonus'',gem_bonus,''cost'',200',E'''gem_bonus'',gem_bonus,''stardust_awarded'',stardust_bonus,''stardust'',s.stardust,''cost'',200')
 ) patches(signature,before_text,after_text) loop
  d:=pg_get_functiondef(entry.signature::regprocedure);
  if position(entry.after_text in d)>0 then continue;end if;
  if (length(d)-length(replace(d,entry.before_text,'')))/length(entry.before_text)<>1 then raise exception 'Unexpected Photon definition %; aborted',entry.signature;end if;
  execute replace(d,entry.before_text,entry.after_text);
 end loop;
end $photon_patches$;

-- New characters/skins auto-select only on their FIRST acquisition. Existing
-- manual per-character choices are untouched by duplicates or this migration.
do $auto_skin$ declare d text;needle text:='get diagnostics inserted=row_count;';begin
 d:=pg_get_functiondef('app_private.open_photon_box(uuid)'::regprocedure);
 if position('Update 2.3 first-acquisition skin selection' in d)=0 then
  if (length(d)-length(replace(d,needle,'')))/length(needle)<>1 then raise exception 'Unexpected Photon insert receipt';end if;
  execute replace(d,needle,needle||E'\n   -- Update 2.3 first-acquisition skin selection.\n'
   ||E'   if inserted=1 and item.kind=''skin'' then update public.player_photon_fury set skin_choices=jsonb_set(skin_choices,array[item.character_key],to_jsonb(item.item_key),true) where user_id=u;end if;');
 end if;
end $auto_skin$;

create or replace function app_private.booster_pull_rules(k text)
returns table(character_percent integer,weights integer[]) language sql immutable set search_path='' as $$
 select p.character_percent,p.weights from(values
 ('normal',9,array[42,32,15,9,2,0]),('bonus',14,array[33,28,17,13,9,0]),
 ('rare',17,array[28,24,19,16,13,0]),('legendary',18,array[22,21,20,19,17,1])) p(kind,character_percent,weights) where p.kind=k;
$$;
-- Bonus rarity weights were confirmed on 2026-10-18 and total exactly100%.
-- Keep the general validation before payment to catch future invalid profiles.
do $odds_guard$ declare d text;needle text:='if g<pull_count*b.cost then';begin
 d:=pg_get_functiondef('public.extract_items(integer,text)'::regprocedure);
 if position('Update 2.3 validated pull distributions' in d)=0 then
  if position(needle in d)=0 then raise exception 'Unexpected extraction payment guard';end if;
  execute replace(d,needle,E'-- Update 2.3 validated pull distributions.\n'
   ||E'if exists(select 1 from unnest(b.profiles) profile cross join lateral app_private.booster_pull_rules(profile) rules where (select sum(w) from unnest(rules.weights) w)<>100) then raise exception ''Invalid pull odds; no Gems spent'';end if;\n'||needle);
 end if;
end $odds_guard$;

revoke all on function app_private.retain_level_mode_unlocks(uuid,integer),app_private.has_level_mode_unlocked(uuid,text),
 app_private.unlimited_1v1_requirements(uuid),app_private.photon_qol_catalog_pre_20261017(),
 app_private.xp_required_for_level(integer),app_private.cumulative_xp_for_level(integer),app_private.level_for_lifetime_xp(bigint),
 app_private.endless_run_xp_breakdown(bigint,bigint),app_private.endless_verified_gem_xp(uuid,uuid),
 app_private.apply_player_xp(uuid,bigint,boolean),app_private.photon_qol_catalog(),app_private.photon_skin_pick(boolean),
 app_private.booster_pull_rules(text),app_private.photon_points_reward(numeric)
 from public,anon,anonymous,authenticated;
revoke all on function public.get_player_progression() from public,anon,anonymous;
grant execute on function public.get_player_progression() to authenticated;
notify pgrst,'reload schema';
commit;
