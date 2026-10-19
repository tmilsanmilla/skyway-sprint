-- Update 2.3 · retained unlocks, New York rotation and new casual variants.
-- Run after update-2-3-economy.sql; preserves installed match lifecycle code.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
select pg_advisory_xact_lock(20261017,24);

create or replace function app_private.rotating_mode_19(t timestamptz)
returns text language sql stable strict set search_path='' as $$
 select case extract(isodow from t at time zone 'America/New_York')::integer
 when 1 then 'mundane' when 2 then 'hardcore_duel' when 3 then 'rng'
 when 4 then 'mundane' when 5 then 'hardcore_duel' when 6 then 'rng' else 'quicksand' end;
$$;
create or replace function public.get_rotating_mode()
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('active_mode',app_private.rotating_mode_19(now()),'required_level',15,
  'next_rotation_at',(((now() at time zone 'America/New_York')::date+1)::timestamp at time zone 'America/New_York'));
$$;
create or replace function app_private.duel_mode_allowed_23(p_user_id uuid,p_mode text)
returns boolean language plpgsql security definer set search_path='' as $$
declare requirements jsonb;begin
 if p_user_id is null then return false;end if;
 if p_mode='casual' then return app_private.has_level_mode_unlocked(p_user_id,'casual');end if;
 if p_mode in('rng','hardcore_duel','quicksand','mundane') then return app_private.has_level_mode_unlocked(p_user_id,'rotating');end if;
 if p_mode='ranked' then return exists(select 1 from app_private.ranked_requalification where user_id=p_user_id and qualified);end if;
 if p_mode='unlimited' then
  if exists(select 1 from app_private.mode_unlock_entitlements where user_id=p_user_id and mode='unlimited') then return true;end if;
  requirements:=app_private.unlimited_1v1_requirements(p_user_id);
  if (requirements->>'unlocked')::boolean then
   insert into app_private.mode_unlock_entitlements(user_id,mode) values(p_user_id,'unlimited') on conflict do nothing;
   return true;
  end if;
 end if;
 return false;
end $$;
create or replace function app_private.duel_character_allowed_23(p_mode text,p_character_key text)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.extraction_catalog c where c.item_key=p_character_key and c.active and c.item_type='character'
  and c.item_key not like 'photon_%'
  and case when p_mode in('quicksand','hardcore_duel') then c.item_key='runner_ace'
   when p_mode='unlimited' then true
   when p_mode='mundane' then c.character_class<>'trickster' and c.rarity in('default','common','uncommon','rare')
   when p_mode in('casual','ranked','rng') then c.rarity<>'mythic' else false end);
$$;

-- Exact known constraints only. Existing values remain legal; no history reset.
do $$ declare name text;table_name text;d text;modes text[];begin
 for table_name,name in values('multiplayer_matches','multiplayer_matches_mode_check'),('multiplayer_queue','multiplayer_queue_mode_check') loop
  select pg_get_constraintdef(oid) into d from pg_constraint where conrelid=('public.'||table_name)::regclass and conname=name;
  select array_agg(distinct hit[1] order by hit[1]) into modes from regexp_matches(d,'''([^'']+)''','g') hit;
  if modes=array['casual','hardcore_duel','mundane','quicksand','ranked','rng','unlimited'] then continue;end if;
  if modes is distinct from array['casual','hardcore_duel','ranked','rng'] then raise exception 'Unexpected mode constraint';end if;
  if position('quicksand' in d)=0 then
   execute format('alter table public.%I drop constraint %I',table_name,name);
   execute format('alter table public.%I add constraint %I check(mode in(''casual'',''ranked'',''unlimited'',''rng'',''hardcore_duel'',''quicksand'',''mundane''))',table_name,name);
  end if;
 end loop;
end $$;

-- Purchased Snowflakes are available on every armory-enabled map; Terminal
-- remains the explicit no-armory exception. Natural spawn weights stay.
update app_private.one_v_one_map_rules set allowed_attacks=array_append(allowed_attacks,'snowflake')
 where map_key<>'terminal' and not('snowflake'=any(allowed_attacks));

do $queue$ declare d text;entry record;begin
 d:=pg_get_functiondef('public.join_1v1_queue(text)'::regprocedure);
 if position('Update 2.3 queue mode rules' in d)=0 then
  if position('pg_advisory_xact_lock' in d)=0 or position('for update of q skip locked' in lower(d))=0 then raise exception 'Unexpected queue serialization';end if;
  for entry in select * from(values
   (E'k not in(''casual'',''ranked'',''rng'',''hardcore_duel'')',E'k not in(''casual'',''ranked'',''unlimited'',''rng'',''hardcore_duel'',''quicksand'',''mundane'')'),
   (E'if k=''casual'' and coalesce((select level from public.player_stats where user_id=u),0)<5 then raise exception ''Casual 1v1 requires level 5'';end if;',
    E'-- Update 2.3 queue mode rules.\nif not app_private.duel_mode_allowed_23(u,k) then raise exception ''Complete the unlock requirements for this duel mode'';end if;'),
   (E'if k in(''rng'',''hardcore_duel'') and (coalesce((select level from public.player_stats where user_id=u),0)<5 or k<>app_private.rotating_mode_19(now())) then raise exception ''Reach level 5 and choose today''''s active mode'';end if;',
    E'if k in(''rng'',''hardcore_duel'',''quicksand'',''mundane'') and k<>app_private.rotating_mode_19(now()) then raise exception ''Choose today''''s active New York mode'';end if;'),
   (E'and (k not in(''casual'',''rng'',''hardcore_duel'') or st.level>=5)',E'and app_private.duel_mode_allowed_23(q.user_id,k)'),
   (E'case when k=''rng'' then ''rng'' else ''bans'' end',E'case when k=''rng'' then ''rng'' when k in(''quicksand'',''mundane'') then ''fixed'' else ''bans'' end'),
   (E'case when k=''rng'' then ''announce'' else ''ban'' end',E'case when k in(''rng'',''quicksand'',''mundane'') then ''announce'' else ''ban'' end'),
   (E'case when k=''rng'' then interval ''4 seconds'' else interval ''10 seconds'' end',E'case when k in(''rng'',''quicksand'',''mundane'') then interval ''4 seconds'' else interval ''10 seconds'' end'),
   (E'if k=''rng'' then perform app_private.setup_19_health(mid);end if;',E'if k in(''rng'',''quicksand'',''mundane'') then perform app_private.setup_19_health(mid);end if;')
  ) p(before_text,after_text) loop
   if (length(d)-length(replace(d,entry.before_text,'')))/length(entry.before_text)<>1 then raise exception 'Unexpected queue patch target %',entry.before_text;end if;
   d:=replace(d,entry.before_text,entry.after_text);
  end loop;
  -- Assign the non-voting map before inserting the match/setup announcement.
  if position('insert into public.multiplayer_matches(host_user_id' in d)=0 then raise exception 'Unexpected queue match creation';end if;
  d:=replace(d,'insert into public.multiplayer_matches(host_user_id',
   E'if k=''quicksand'' then map:=''classic'';candidates:=array[map];\n'
   ||E'elsif k=''mundane'' then r:=random();map:=case when r<.55 then ''classic'' when r<.80 then ''factory'' when r<.90 then ''meadow'' else ''pitch'' end;candidates:=array[map];end if;\n'
   ||'insert into public.multiplayer_matches(host_user_id');
  execute d;
 end if;
end $queue$;

do $setup$ declare d text;entry record;begin
 for entry in select * from(values
  ('app_private.setup_19_health(uuid)',E'elsif m.map_key=''terminal'' then',E'elsif m.mode=''quicksand'' then select ''runner_ace''::text character_key,''runner''::text character_class,4::numeric max_hearts,4::numeric starting_hearts into h;\nelsif m.map_key=''terminal'' then'),
  ('app_private.advance_setup_19(uuid)',E'm.mode in(''rng'',''hardcore_duel'')',E'm.mode in(''rng'',''hardcore_duel'',''quicksand'')'),
  ('public.choose_1v1_character(uuid,text)',E'if m.mode=''ranked'' and c.rarity=''mythic'' then raise exception ''Mythics are not allowed in Ranked'';end if;',
   E'if not app_private.duel_character_allowed_23(m.mode,c.item_key) then raise exception ''Character is not allowed in this duel mode'';end if;')
 ) p(signature,before_text,after_text) loop
  d:=pg_get_functiondef(entry.signature::regprocedure);
  if position(entry.after_text in d)>0 then continue;end if;
  if (length(d)-length(replace(d,entry.before_text,'')))/length(entry.before_text)<>1 then raise exception 'Unexpected setup definition %',entry.signature;end if;
  execute replace(d,entry.before_text,entry.after_text);
 end loop;
end $setup$;

-- Shorten only the active window. All installed cooldown/broken-weapon/
-- own-match/active-play checks remain, including the fixed 6-second cooldown.
do $katana$ declare d text;before_text text:=E'''active_until'', v_now + interval ''0.4 seconds''';after_text text:=E'''active_until'', v_now + interval ''0.4 seconds''/(1+.25*greatest(v_self.wave-1,0))';begin
 d:=pg_get_functiondef('public.activate_1v1_katana(uuid)'::regprocedure);
 if position(after_text in d)=0 then
  if (length(d)-length(replace(d,before_text,'')))/length(before_text)<>1 or position('for update' in lower(d))=0 then raise exception 'Unexpected Katana activation definition';end if;
  execute replace(d,before_text,after_text);
 end if;
end $katana$;
do $katana_reflect$ declare d text;before_text text:=E'v_self.last_katana_at < v_now - interval ''0.4 seconds''';after_text text:=E'v_self.last_katana_at < v_now - interval ''0.4 seconds''/(1+.25*greatest(v_self.wave-1,0))';begin
 d:=pg_get_functiondef('public.reflect_1v1_attack(uuid,text,text,uuid)'::regprocedure);
 if position(after_text in d)=0 then
  if (length(d)-length(replace(d,before_text,'')))/length(before_text)<>1 or position('v_activation_reflections >= 1' in d)=0 then raise exception 'Unexpected Katana reflection definition';end if;
  execute replace(d,before_text,after_text);
 end if;
end $katana_reflect$;

revoke all on function app_private.rotating_mode_19(timestamptz),app_private.duel_mode_allowed_23(uuid,text),app_private.duel_character_allowed_23(text,text)
 from public,anon,anonymous,authenticated;
-- Existing own-match RPC grants are retained, never broadened.
notify pgrst,'reload schema';
commit;
