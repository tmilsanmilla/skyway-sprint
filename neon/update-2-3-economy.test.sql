-- Run after Update 2.3 in an isolated, disposable fixture database.
-- Read-only assertions; no real identities, account fixtures or mail.
begin read only;
do $$ declare l integer;total bigint:=0;row record;begin
 for l in 0..250 loop
  if app_private.xp_required_for_level(l)<>floor(400+60*power(l::numeric,1.1)) then raise exception 'Level requirement mismatch %',l;end if;
  if app_private.cumulative_xp_for_level(l)<>total then raise exception 'Cumulative XP mismatch %',l;end if;
  if app_private.level_for_lifetime_xp(total)<>l then raise exception 'Inverse XP mismatch %',l;end if;
  if l>0 and app_private.level_for_lifetime_xp(total-1)<>l-1 then raise exception 'XP boundary mismatch %',l;end if;
  total:=total+app_private.xp_required_for_level(l);
 end loop;
 if app_private.endless_run_xp_breakdown(1200,3)<>jsonb_build_object('score',1,'gems',30,'gem_count',3,'total',31) then raise exception 'Physical Gem XP mismatch';end if;
 if app_private.photon_points_reward(4)<>0 or app_private.photon_points_reward(5)<>1 or app_private.photon_points_reward(8)<>10 then raise exception 'Photon reward mismatch';end if;
 if not exists(select 1 from app_private.booster_pull_rules('bonus') where character_percent=14 and weights=array[33,28,17,13,9,0]) then raise exception 'Bonus odds differ from exact confirmed values';end if;
 if exists(select 1 from unnest(array['normal','bonus','rare','legendary']) profile cross join lateral app_private.booster_pull_rules(profile) rules where (select sum(w) from unnest(rules.weights) w)<>100) then raise exception 'Pull odds must total100';end if;
 if (select count(*) from app_private.photon_qol_catalog() where kind='skin')<>80 then raise exception 'Expected 80 paid skins';end if;
 if (select count(*) from app_private.photon_qol_catalog() where kind='theme')<>24 then raise exception 'Expected 24 paid themes plus default';end if;
 if exists(select item_key from app_private.photon_qol_catalog() group by item_key having count(*)>1) then raise exception 'Duplicate Photon catalog key';end if;
 for row in select rarity,count(*) n from app_private.photon_qol_catalog() where kind='theme' group by rarity loop
  if row.n<>4 then raise exception 'Expected four themes per rarity';end if;
 end loop;
 if has_table_privilege('authenticated','app_private.mode_unlock_entitlements','SELECT') or has_table_privilege('authenticated','app_private.mode_unlock_entitlements','INSERT') then raise exception 'Private entitlement exposure';end if;
 if has_function_privilege('authenticated','app_private.apply_player_xp(uuid,bigint,boolean)','EXECUTE') then raise exception 'Client XP award permission';end if;
 if has_function_privilege('anon','public.get_player_progression()','EXECUTE') then raise exception 'Guest progression permission';end if;
 if not has_function_privilege('authenticated','public.get_player_progression()','EXECUTE') then raise exception 'Own-account progression permission missing';end if;
end $$;
rollback;
