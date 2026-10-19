-- Update 2.3: restore ONLY audited own-match browser entrypoints.
-- Run before rule-body changes from this update. No body/data/role is changed.
-- Each exact reviewed installed body is pinned; drift stops the transaction.
-- In particular NEVER grant cleanup/finish/global reward/private helpers.
begin;
do $access$
declare item record; definition text; reviewed_definition text; function_id oid;
begin
  for item in select * from (values
    ('public.acknowledge_1v1_attacks(uuid,uuid[])','2e9bb36506d61f984774dbe3d628fb16'),
    ('public.activate_1v1_mirage(uuid,integer)','fdfa573194904c7ed194e7f299be5877'),
    ('public.activate_1v1_zenith_time_stop(uuid,bigint)','9b5923f72e1915d34dcbd1c32b462f19'),
    ('public.apply_1v1_mirage_damage(uuid,numeric)','03e3ae2a03641b7085ec412a35dfd07f'),
    ('public.award_1v1_mushroom(uuid,integer,text)','a7e0ced417532f86324ceaebdc0ae946'),
    ('public.consume_1v1_heatfeast(uuid,integer)','8868b87adb1a869f0bcf1d2f360bd338'),
    ('public.discard_1v1_gambit_cards(uuid,text[])','9115b4707ff212bd9c9ca36765f6e27c'),
    ('public.draw_1v1_gambit_wave(uuid,integer)','0b9c05f5394d8851f498991cdeb99ae9'),
    ('public.get_1v1_ability_state(uuid)','9e0a7dd43b2e1cc5a7213917338f80e0'),
    ('public.get_1v1_gambit_state(uuid)','c5a718f271c59c45d1e43410ffeafe11'),
    ('public.purchase_1v1_comet_removal(uuid,text,text)','c8685a5f1aa22c71386d20e809b9be49'),
    ('public.redeem_1v1_comet_removal(uuid,uuid,text)','7f0799caf042b702c63fd8783311af5f'),
    ('public.reflect_1v1_attack(uuid,text,text,uuid)','198df696acaef1ce0036706f7d778281'),
    ('public.reflect_1v1_attack(uuid,text,text)','5df81fe46ecb558db5656389963b0192'),
    ('public.send_1v1_attack(uuid,text,integer)','02f3021540cac9a393348309330130d7'),
    ('public.sync_1v1_intermission_coins(uuid,text[])','006077c3bf0ee4ed993ee76dabcdbcaf'),
    ('public.sync_1v1_score(uuid,bigint)','ca3ea0bcd3d4e9b832846133e613a9f5')
  ) entries(signature,body_md5)
  loop
    function_id:=to_regprocedure(item.signature);
    select pg_get_functiondef(p.oid) into definition from pg_proc p
      where p.oid=function_id and p.prosecdef and 'search_path=""'=any(p.proconfig);
    reviewed_definition:=definition;
    if item.signature='public.reflect_1v1_attack(uuid,text,text,uuid)' then
      -- Reapplying the complete release sees the exact, already-reviewed
      -- wave-speed window substitution from update-2-3-duel-modes.sql.
      reviewed_definition:=replace(reviewed_definition,E'v_self.last_katana_at < v_now - interval ''0.4 seconds''/(1+.25*greatest(v_self.wave-1,0))',E'v_self.last_katana_at < v_now - interval ''0.4 seconds''');
    end if;
    if definition is null or md5(reviewed_definition)<>item.body_md5 then
      raise exception 'Duel access preflight changed/missing body: %. Review exact current source before granting access.',item.signature;
    end if;
    if item.signature='public.reflect_1v1_attack(uuid,text,text)' then
      if position('select public.reflect_1v1_attack(' in definition)=0 then raise exception 'Reflection forwarding guard changed'; end if;
    elsif item.signature='public.send_1v1_attack(uuid,text,integer)' then
      if position('u uuid:=auth.uid()' in definition)=0
        or position('where match_id=p_match_id and user_id=u' in definition)=0
        or position('app_private.send_1v1_attack_qol_base(p_match_id,k,p_cost)' in definition)=0 then
        raise exception 'QOL sender ownership/delegate guard changed';
      end if;
    elsif position('auth.uid()' in definition)=0 or position('public.multiplayer_players' in definition)=0
      or position('p_match_id' in definition)=0 or position('v_uid' in definition)=0 then
      raise exception 'Own-match guard missing: %',item.signature;
    end if;
    execute format('revoke all on function %s from public,anon,anonymous',item.signature);
    execute format('grant execute on function %s to authenticated',item.signature);
  end loop;
  -- October 19 current sender keeps the newer QOL per-wave purchase cap and
  -- formula, then delegates through the Gambit layer to the own-match core.
  -- Pin BOTH reviewed layers; granting the public entrypoint never exposes
  -- either private helper or replaces the newer installed balance rules.
  for item in select * from(values
    ('app_private.send_1v1_attack_qol_base(uuid,text,integer)','e065054c00e85bc701a2fae838f4f5fa'),
    ('app_private.send_1v1_attack_without_gambit(uuid,text,integer)','eb4cdd3e4045ea0276cd4032f9606181')
  ) delegates(signature,body_md5) loop
    definition:=pg_get_functiondef(to_regprocedure(item.signature));
    if definition is null or md5(definition)<>item.body_md5 then
      raise exception 'Attack sender delegate changed; review ownership checks first: %',item.signature;
    end if;
    if has_function_privilege('authenticated',item.signature,'EXECUTE')
      or has_function_privilege('anon',item.signature,'EXECUTE')
      or has_function_privilege('anonymous',item.signature,'EXECUTE') then
      raise exception 'Attack delegate unexpectedly exposed; do not broaden access';
    end if;
  end loop;
end
$access$;
notify pgrst,'reload schema';
commit;
