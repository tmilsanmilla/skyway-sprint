-- Additive follow-up ONLY: admin mastery commands, rewardless trial replays,
-- and complete current mode-ownership flags in XP responses. NO XP reset.
-- Run against the audited Update 2.3 runtime, not historical import SQL.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
select pg_advisory_xact_lock(20261019,23);

do $mastery_management_preflight$
declare item record;d text;
begin
 for item in select * from(values
  ('public.admin_player_command_v23(text,uuid,text,text,text,bigint,text[],uuid,bigint,boolean,bigint,text,text)','7925824222414ea9c84a216d3d9603b4',true),
  ('public.is_main_admin()','6365ab9c99e5fe5e7ff3fced54dea71b',false),
  ('public.is_admin()','7053d4a3051e3b8ecfd26895942a3bdb',true),
  ('app_private.unlimited_1v1_requirements(uuid)','20242a3302b57832a268b0edeb31b736',false),
  ('public.get_player_progression()','ed7b6013d71fa557b8b353039c29b458',true)
 ) expected(signature,body_md5,authenticated_execute) loop
  d:=pg_get_functiondef(to_regprocedure(item.signature));
  if d is null or md5(d)<>item.body_md5 then raise exception 'Current runtime control changed: %',item.signature;end if;
  if has_function_privilege('authenticated',item.signature,'EXECUTE') is distinct from item.authenticated_execute
   or has_function_privilege('anon',item.signature,'EXECUTE') or has_function_privilege('anonymous',item.signature,'EXECUTE') then
   raise exception 'Runtime endpoint permissions changed: %',item.signature;
  end if;
 end loop;
 if position('app_private.intercept_in_game_player_command(' in pg_get_functiondef('public.admin_player_command_v23(text,uuid,text,text,text,bigint,text[],uuid,bigint,boolean,bigint,text,text)'::regprocedure))=0 then
  raise exception 'Installed admin anti-game dispatcher guard must remain intact';
 end if;
 if not exists(select 1 from pg_class where oid='app_private.mastery_sessions'::regclass and relrowsecurity)
  or has_table_privilege('authenticated','app_private.mastery_sessions','SELECT,INSERT,UPDATE,DELETE') then
  raise exception 'Private mastery session boundary changed';
 end if;
 if exists(select 1 from pg_attribute where attrelid='app_private.mastery_sessions'::regclass and attname='trial_replay' and not attisdropped)
  and not exists(select 1 from pg_attribute a join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
   where a.attrelid='app_private.mastery_sessions'::regclass and a.attname='trial_replay' and not a.attisdropped
    and a.atttypid='boolean'::regtype and a.attnotnull and pg_get_expr(d.adbin,d.adrelid)='false') then
  raise exception 'Existing trial_replay column shape changed; no automatic repair';
 end if;
end $mastery_management_preflight$;

alter table app_private.mastery_sessions add column if not exists trial_replay boolean not null default false;

do $mastery_management_patches$
declare item record;d text;before_text text;after_text text;
begin
 for item in select * from(values
  ('app_private.admin_player_command_v23_core(text,uuid,text,text,text,bigint,text[],uuid,bigint,boolean,bigint,text,text)','acc78021b22530ba257fb49e43a11748','42957602f961fc1345fccd55cbb28a3e','admin',false),
  ('public.admin_get_player(uuid)','85b13af96223f6bd193174ed79e7d05a','f384754d68052ea5f8b1629b9413c5da','lookup',true),
  ('public.begin_mastery_session(uuid,text,text,text)','af6d528c75a062393f0088114efb4fb0','4ccfb235c9ac80893664a4a9c9516886','begin',true),
  ('public.finish_mastery_trial(uuid)','d8f387b39a64015d122fc81463e2d09a','59773f1d9b11c526ce3d7fb793a843a6','finish',true),
  ('app_private.apply_player_xp(uuid,bigint,boolean)','f7386ee5b27f9be6894e8d0d759aa5c4','cd403078eef86fcc19932df28cb095ac','xp',false)
 ) expected(signature,body_md5,after_md5,kind,authenticated_execute) loop
  d:=pg_get_functiondef(to_regprocedure(item.signature));
  if not exists(select 1 from pg_proc where oid=to_regprocedure(item.signature) and prosecdef and 'search_path=""'=any(proconfig))
   or has_function_privilege('authenticated',item.signature,'EXECUTE') is distinct from item.authenticated_execute
   or has_function_privilege('anon',item.signature,'EXECUTE') or has_function_privilege('anonymous',item.signature,'EXECUTE') then
   raise exception 'Function security boundary changed: %',item.signature;
  end if;
  if md5(d)=item.after_md5 then continue;end if;
  if d is null or md5(d)<>item.body_md5 then raise exception 'Current function changed; review before patching: %',item.signature;end if;
  if item.kind='admin' then
   before_text:=E'changed integer:=0; error_text text;';
   after_text:=E'changed integer:=0; closed_sessions integer:=0; error_text text;';
   if (length(d)-length(replace(d,before_text,'')))/length(before_text)<>1 then raise exception 'Admin declaration changed';end if;
   d:=replace(d,before_text,after_text);
   before_text:=E'action not in(''check'',''set'',''rpta'',''rptb'',''rptc'',''photon_grant'',''photon_revoke'')';
   after_text:=E'action not in(''check'',''set'',''rpta'',''rptb'',''rptc'',''photon_grant'',''photon_revoke'',''grant'',''revoke'')';
   if (length(d)-length(replace(d,before_text,'')))/length(before_text)<>1 then raise exception 'Admin action guard changed';end if;
   d:=replace(d,before_text,after_text);
   before_text:=E'    if action=''rptc'' then';
   after_text:=$admin_mastery$
    -- Update 2.3 mastery management follow-up: main-admin check and the
    -- current public anti-game wrapper above this core remain unchanged.
    if action in('grant','revoke') then
      if v_kind<>'mastery' or stat<>'' or p_value is not null or app_private.mastery_price(name) is null then
        raise exception 'Choose an exact character mastery';
      end if;
      perform pg_advisory_xact_lock(hashtextextended(p_target_user_id::text,23));
      if action='grant' then
        if not app_private.mastery_owns_character(p_target_user_id,name) then
          raise exception 'This player must own the character first; grant the character separately';
        end if;
        insert into app_private.player_mastery_quests(user_id,character_key,quest,mastered,mastery_enabled,flair_rewrite_enabled,mastered_at)
        values(p_target_user_id,name,3,true,true,true,clock_timestamp())
        on conflict(user_id,character_key) do update set quest=3,mastered=true,mastery_enabled=true,flair_rewrite_enabled=true,
          mastered_at=coalesce(app_private.player_mastery_quests.mastered_at,excluded.mastered_at)
        where not app_private.player_mastery_quests.mastered;
        get diagnostics changed=row_count;
        update app_private.player_mastery_preferences set active_character=null where user_id=p_target_user_id and active_character=name;
      else
        update app_private.player_mastery_quests set mastered=false,mastery_enabled=false,flair_rewrite_enabled=false
          where user_id=p_target_user_id and character_key=name and (mastered or mastery_enabled or flair_rewrite_enabled);
        get diagnostics changed=row_count;
        -- Invalidate prior completed trials too: their otherwise valid finish
        -- receipt must not undo a later revoke. Historical dates/results stay.
        update app_private.mastery_sessions set finished_at=coalesce(finished_at,clock_timestamp()),
          trial_failed=case when context_type='trial' and finished_at is null then true else trial_failed end,
          event_counts=case when context_type='trial' then event_counts||jsonb_build_object('admin_mastery_revoked',true) else event_counts end
          where user_id=p_target_user_id and character_key=name and (finished_at is null
            or context_type='trial' and event_counts->'admin_mastery_revoked' is distinct from 'true'::jsonb);
        get diagnostics closed_sessions=row_count;
      end if;
      result:=jsonb_build_object('ok',true,'item_kind','mastery','item_key',name,'mastered',action='grant',
        'changed',changed>0 or closed_sessions>0,'noop',changed=0 and closed_sessions=0,'closed_sessions',closed_sessions,
        'message',case when action='grant' then 'Character mastery unlocked.' else 'Character mastery revoked; purchased quests and progress were kept.' end);
    elsif action='rptc' then
$admin_mastery$;
  elsif item.kind='lookup' then
   before_text:=E'  return v_result;';
   after_text:=$lookup_mastery$
  -- Update 2.3 mastery management follow-up: existing admin-only lookup.
  v_result:=v_result||jsonb_build_object('masteries',(
    select coalesce(jsonb_agg(jsonb_build_object('character_key',character_key,'quest',quest,
      'progress',case when character_key='runner_stride' and quest=2 then jsonb_build_array(progress,progress_two) else jsonb_build_array(progress) end,
      'complete',quest=3,'mastered',mastered,'masteryEnabled',mastery_enabled,'flairRewriteEnabled',flair_rewrite_enabled,
      'mastered_at',mastered_at) order by character_key),'[]'::jsonb)
    from app_private.player_mastery_quests where user_id=p_user_id));
  return v_result;
$lookup_mastery$;
  elsif item.kind='begin' then
   before_text:=E'previous app_private.mastery_sessions;';after_text:=E'previous app_private.mastery_sessions;v_replay boolean:=false;';
   if (length(d)-length(replace(d,before_text,'')))/length(before_text)<>1 then raise exception 'Mastery session declaration changed';end if;
   d:=replace(d,before_text,after_text);
   d:=replace(d,E'''trial'',v_trial,''last_seq'',previous.last_seq',E'''trial'',v_trial,''trial_replay'',previous.trial_replay,''last_seq'',previous.last_seq');
   d:=replace(d,E'''trial'',v_trial,''last_seq'',0',E'''trial'',v_trial,''trial_replay'',v_replay,''last_seq'',0');
   d:=replace(d,E'if q.quest is distinct from 3 then raise exception ''Finish all three quests before entering the trial'';end if;',
    E'if q.quest is distinct from 3 then raise exception ''Finish all three quests before entering the trial'';end if;\n  v_replay:=q.mastered;');
   before_text:=E'insert into app_private.mastery_sessions(user_id,context_id,context_type,character_key,flair_character,gem_multiplier) values(u,p_context_id,case when v_trial then ''trial'' else p_context_type end,p_character_key,f,g) returning id into r;';
   after_text:=E'-- Update 2.3 mastery management follow-up: replay is server-bound to this nonrewarding owned trial.\n insert into app_private.mastery_sessions(user_id,context_id,context_type,character_key,flair_character,gem_multiplier,trial_replay) values(u,p_context_id,case when v_trial then ''trial'' else p_context_type end,p_character_key,f,g,v_replay) returning id into r;';
  elsif item.kind='finish' then
   before_text:=E' update app_private.player_mastery_quests set mastered=true,mastery_enabled=true,flair_rewrite_enabled=true,mastered_at=coalesce(mastered_at,clock_timestamp())';
   after_text:=$finish_replay$
 if s.event_counts->'admin_mastery_revoked'='true'::jsonb then raise exception 'This trial receipt was revoked; start a new trial';end if;
 -- Update 2.3 mastery management follow-up: no repeat mastery/toggle reward.
 if s.trial_replay then
  update app_private.mastery_sessions set finished_at=coalesce(finished_at,clock_timestamp()) where id=s.id;
  return public.get_mastery_profile()||jsonb_build_object('trial_replay',true,'trial_completed',true);
 end if;
 update app_private.player_mastery_quests set mastered=true,mastery_enabled=true,flair_rewrite_enabled=true,mastered_at=coalesce(mastered_at,clock_timestamp())
$finish_replay$;
   d:=replace(d,E' return public.get_mastery_profile();',E' return public.get_mastery_profile()||jsonb_build_object(''trial_replay'',false,''trial_completed'',true);');
  else
   before_text:=E'paid boolean;';after_text:=E'paid boolean;unlimited jsonb;';
   if (length(d)-length(replace(d,before_text,'')))/length(before_text)<>1 then raise exception 'XP response declaration changed';end if;
   d:=replace(d,before_text,after_text);
   before_text:=E' return jsonb_build_object(''level'',l,';
   after_text:=E' -- Update 2.3 mastery management follow-up: report current owned modes, never purchase timing.\n unlimited:=app_private.unlimited_1v1_requirements(p_user_id);\n if (unlimited->>''unlocked'')::boolean then insert into app_private.mode_unlock_entitlements(user_id,mode) values(p_user_id,''unlimited'') on conflict do nothing;end if;\n return jsonb_build_object(''photon_unlocked'',exists(select 1 from public.player_photon_fury where user_id=p_user_id and unlocked_at is not null),\n ''unlimited_unlocked'',exists(select 1 from app_private.mode_unlock_entitlements where user_id=p_user_id and mode=''unlimited''),\n ''unlimited_requirements'',unlimited,''level'',l,';
  end if;
  if (length(d)-length(replace(d,before_text,'')))/length(before_text)<>1 then raise exception 'Patch target changed: %',item.signature;end if;
  execute replace(d,before_text,after_text);
  if md5(pg_get_functiondef(to_regprocedure(item.signature)))<>item.after_md5 then
   raise exception 'Patched function hash differs from reviewed source: %',item.signature;
  end if;
 end loop;
end $mastery_management_patches$;

-- Existing function/table ACLs are deliberately retained. No new public RPC,
-- admin permission, anonymous access or direct mastery-table grant is added.
notify pgrst,'reload schema';
commit;
