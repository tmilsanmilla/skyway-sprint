/** Local PostgreSQL only. No production connection strings or real account rows. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Client } from 'pg';

const host = process.env.PHOTON_TEST_PG_SOCKET;
if (!host?.startsWith('/private/tmp/skyway-map-sql.') || process.env.PHOTON_TEST_PG_DATABASE !== 'photon_fixture')
  throw new Error('Use the dedicated photon_fixture database on the isolated Unix-socket test cluster.');
const snapshotPath = process.env.PHOTON_TEST_INSTALLED_SNAPSHOT;
if (!snapshotPath) throw new Error('Supply the read-only installed-definition snapshot.');
const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'));
const db = new Client({ host, port: 55439, user: 'lucas', database: 'photon_fixture' });
const u = '00000000-0000-4000-8000-000000000001', v = '00000000-0000-4000-8000-000000000002';
const execute = (sql, args) => db.query(sql, args);
const scalar = async (sql, args) => Object.values((await execute(sql, args)).rows[0])[0];
const fail = async (sql, args, expected) => {
  await execute('savepoint expected_rejection');
  try { await execute(sql, args); assert.fail(`Expected ${expected}`); }
  catch (error) { await execute('rollback to savepoint expected_rejection'); assert.match(error.message, expected); }
  await execute('release savepoint expected_rejection');
};
try {
  await db.connect();
  assert.equal(await scalar('select current_database()'), 'photon_fixture');
  await execute('begin');
  await execute(`
    create schema app_private; create schema auth;
    do $$ begin
      if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
      if not exists(select 1 from pg_roles where rolname='anonymous') then create role anonymous; end if;
      if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
    end $$;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('photon.test_uid',true),'')::uuid$$;
    create function app_private.has_active_ban(uuid,text,text) returns boolean language sql stable as $$select coalesce(current_setting('photon.test_banned',true),'')='true'$$;
    create function app_private.is_admin_test_user(uuid) returns boolean language sql stable as $$select coalesce(current_setting('photon.test_mode',true),'')='true'$$;
    create table public.player_stats(user_id uuid primary key,level integer not null default 0,total_gems bigint not null default 0,updated_at timestamptz not null default now(),protected_inventory jsonb not null default '{}',high_score bigint not null default 0);
  `);
  for (const [schema, name] of [['public','player_photon_fury'],['app_private','photon_fury_runs'],['public','player_unlocks'],['public','extraction_catalog']]) {
    const columns = snapshot.columns.filter(c => c.table_schema === schema && c.table_name === name).sort((a,b) => a.ordinal_position-b.ordinal_position);
    assert.ok(columns.length > 0);
    const definitions = columns.map(c => `"${c.column_name}" ${c.data_type}${c.column_default ? ` default ${c.column_default}` : ''}${c.is_nullable === 'NO' ? ' not null' : ''}`);
    definitions.push(`primary key(${name === 'extraction_catalog' ? 'item_key' : name === 'player_unlocks' ? 'user_id,item_key' : name === 'player_photon_fury' ? 'user_id' : 'id'})`);
    if(name !== 'extraction_catalog') definitions.push('foreign key(user_id) references public.player_stats(user_id) on delete cascade');
    await execute(`create table ${schema}.${name}(${definitions.join(',')})`);
  }
  const ordered = ['photon_user','photon_character_rules','owns_photon_character','photon_points_reward','begin_photon_fury_run','get_photon_fury_profile','equip_photon_character','begin_photon_character_run','finish_photon_character_run','finish_photon_fury_run','unlock_photon_fury'];
  for (const name of ordered) {
    const definition = snapshot.functions.find(f => f.name === name)?.definition;
    assert.ok(definition, `Missing actual installed ${name}`);
    await execute(definition);
  }
  await execute('insert into public.player_stats(user_id,level,total_gems,protected_inventory,high_score) values($1,40,500,\'{"keep":"original"}\',12345),($2,15,300,\'{"keep":"second"}\',6789)', [u,v]);
  await execute('insert into public.player_photon_fury(user_id,unlocked_at,photons,selected_character_key) values($1,now(),5000,\'photon_trumpet\'),($2,now(),5000,\'photon_magician\')',[u,v]);
  await execute("insert into public.player_unlocks(user_id,item_key,item_type,rarity) values($1,'photon_tick','character','uncommon')",[u]);
  // This receipt predates the update and must retain its original 40s/1.5s rules.
  const legacyId = await scalar("insert into app_private.photon_fury_runs(user_id,started_at,character_key,saber_cooldown_seconds,bonus_point_seconds) values($1,now()-interval '2 minutes','photon_magician',1.5,40) returning id",[u]);
  for (const name of ['01-catalog','02-profile','03-runs','04-box']) {
    const source = readFileSync(new URL(`../neon/qol-photon-${name}.sql`, import.meta.url),'utf8').replace(/^begin;\s*$/mi,'').replace(/^commit;\s*$/mi,'');
    await execute(source);
  }
  // Install the actual public routers unchanged, not a test reimplementation.
  const extractionSource=readFileSync(new URL('../neon/qol-extraction.sql',import.meta.url),'utf8').replace(/^begin;\s*$/mi,'').replace(/^commit;\s*$/mi,'');
  await execute(extractionSource);
  assert.match(await scalar("select pg_get_functiondef('public.extract_items(integer,text)'::regprocedure)"),/return app_private\.open_photon_box\(substr\(k,8\)::uuid\)/);
  assert.match(await scalar("select pg_get_functiondef('public.purchase_catalog_item(text)'::regprocedure)"),/return app_private\.purchase_photon_weapon/);
  // Rerunning all migrations must not recopy/replace the original legacy snapshot.
  const legacyDefinition = await scalar("select pg_get_functiondef('app_private.finish_photon_character_run_legacy(uuid,numeric,integer,integer)'::regprocedure)");
  for (const name of ['01-catalog','02-profile','03-runs','04-box']) {
    const source = readFileSync(new URL(`../neon/qol-photon-${name}.sql`, import.meta.url),'utf8').replace(/^begin;\s*$/mi,'').replace(/^commit;\s*$/mi,'');
    await execute(source);
  }
  assert.equal(await scalar("select pg_get_functiondef('app_private.finish_photon_character_run_legacy(uuid,numeric,integer,integer)'::regprocedure)"),legacyDefinition);
  assert.equal(await scalar("select count(*)::int from app_private.photon_character_rules(null)"),16);
  assert.deepEqual((await execute('select kind,count(*)::int n from app_private.photon_qol_catalog() group by kind order by kind')).rows,[{kind:'character',n:16},{kind:'skin',n:48},{kind:'theme',n:17},{kind:'weapon',n:6}]);
  await execute("select set_config('photon.test_uid',$1,true)",[u]);
  let profile = await scalar('select public.get_photon_fury_profile()');
  assert.deepEqual(new Set(profile.character_keys),new Set(['photon_magician','photon_wizard','photon_bluff','photon_bell','photon_tick']));
  assert.equal(profile.selected_character_key,'photon_magician');
  await fail("select public.equip_photon_character('photon_trumpet')",[],/Character locked/);
  await fail("select public.begin_photon_character_run('photon_trumpet')",[],/Character locked/);
  const equipped = await scalar("select public.equip_photon_character('photon_tick')"); assert.equal(equipped.selected_character_key,'photon_tick');
  await execute("select set_config('photon.test_uid',$1,true)",[v]);
  await fail("select public.equip_photon_character('photon_tick')",[],/Character locked/);
  await fail('select public.finish_photon_character_run($1,80,3,0)',[legacyId],/No run/);
  await execute("select set_config('photon.test_uid',$1,true)",[u]);
  const old = await scalar('select public.finish_photon_character_run($1,80,3,0)',[legacyId]);
  assert.equal(old.awarded,2,'legacy Magician uses40seconds, not45');
  const oldRetry = await scalar('select public.finish_photon_character_run($1,80,3,0)',[legacyId]); assert.equal(oldRetry.awarded,2); assert.equal(oldRetry.photons,old.photons);
  const began = await scalar("select public.begin_photon_character_run('photon_tick')"); assert.equal(began.rules_version,20261014);
  await execute("update app_private.photon_fury_runs set started_at=now()-interval '2 minutes' where id=$1",[began.run_id]);
  await fail('select public.finish_photon_character_run($1,80,1000,0)',[began.run_id],/Invalid reflections/);
  await fail('select public.finish_photon_character_run($1,80,5,1000)',[began.run_id],/Invalid bonus/);
  await fail('select public.finish_photon_character_run($1,8000,5,0)',[began.run_id],/Invalid playtime/);
  const finished=await scalar('select public.finish_photon_character_run($1,80,7,0)',[began.run_id]); assert.equal(finished.awarded,10); assert.equal(finished.points,7);
  const retried=await scalar('select public.finish_photon_character_run($1,80,7,0)',[began.run_id]); assert.equal(retried.already_completed,true); assert.equal(retried.photons,finished.photons);
  await execute("insert into app_private.photon_unlocks(user_id,item_key,kind) select $1,item_key,kind from app_private.photon_qol_catalog() where kind in('character','skin','theme') on conflict do nothing",[u]);
  await scalar("select public.equip_photon_character('skin:photon_tick_divine')");
  profile=await scalar("select public.equip_photon_character('theme:photon_theme_celestial')"); assert.equal(profile.selected_theme_key,'photon_theme_celestial');
  profile=await scalar("select public.equip_photon_character('skin:default:photon_tick')"); assert.equal(profile.skin_choices.photon_tick,undefined);
  profile=await scalar("select public.equip_photon_character('theme:default')"); assert.equal(profile.selected_theme_key,'default');
  const beforeBox=await scalar('select public.get_photon_fury_profile()');
  const beforeGems=await scalar('select total_gems from public.player_stats where user_id=$1',[u]);
  await execute('set local role authenticated');
  // This is the exact public call used by PhotonFury.tsx under the real player role.
  const box=await scalar("select public.extract_items(1,'photon:'||$1::text)",[beforeBox.box_nonce]);
  await execute('reset role');
  assert.equal(box.cost,200); assert.equal(box.profile.photons,beforeBox.photons-200); assert.equal(box.results.length>=5,true);
  let duplicate=0, bonus=0;
  for(const r of box.results) {
    if(r.kind==='gems') {bonus+=r.amount;continue;}
    assert.equal(r.is_new,false); const expected=r.kind==='skin' && r.part==='B'?10:5;
    assert.equal(r.duplicate_gems,expected); duplicate+=expected;
  }
  assert.equal(box.duplicate_gems,duplicate); assert.equal(box.gem_bonus,bonus); assert.equal(Number(box.gems),Number(beforeGems)+duplicate+bonus);
  const retry=await scalar("select public.extract_items(1,'photon:'||$1::text)",[beforeBox.box_nonce]);
  assert.equal(retry.already_completed,true); assert.equal(retry.profile.photons,box.profile.photons); assert.equal(retry.gems,box.gems);
  await fail("select public.extract_items(1,'photon:'||gen_random_uuid()::text)",[],/Refresh the Photon collection/);
  await fail("select public.extract_items(2,'photon:'||$1::text)",[box.profile.box_nonce],/Choose one Photon box/);
  await fail("select public.extract_items(1,'photon:not-a-uuid')",[],/invalid input syntax for type uuid/);
  assert.equal(await scalar('select photons from public.player_photon_fury where user_id=$1',[u]),String(box.profile.photons));
  // The same public purchase router must reach the private weapon store atomically.
  await execute('update public.player_photon_fury set photons=20000 where user_id=$1',[u]);
  const purchaseGems=await scalar('select total_gems from public.player_stats where user_id=$1',[u]);
  const dustBefore=await scalar('select stardust from public.player_stats where user_id=$1',[u]);
  await execute('set local role authenticated');
  const weapon=await scalar("select public.purchase_catalog_item('photon_weapon_ninjablade')");
  await execute('reset role');
  assert.equal(weapon.already_owned,false);assert.equal(weapon.profile.photons,12000);assert.equal(Number(weapon.gems),Number(purchaseGems)-240);
  assert.ok(weapon.profile.weapon_keys.includes('ninjablade'));
  assert.equal(await scalar('select stardust from public.player_stats where user_id=$1',[u]),dustBefore,'Photon weapon must not spend Skyway Stardust');
  const weaponRetry=await scalar("select public.purchase_catalog_item('photon_weapon_ninjablade')");
  assert.equal(weaponRetry.already_owned,true);assert.equal(weaponRetry.cost,0);assert.equal(weaponRetry.profile.photons,12000);assert.equal(weaponRetry.gems,weapon.gems);
  await execute("select set_config('photon.test_uid',$1,true)",[v]);
  await fail("select public.extract_items(1,'photon:'||$1::text)",[beforeBox.box_nonce],/Refresh the Photon collection/);
  await fail("select public.purchase_catalog_item('photon_weapon_ninjablade')",[],/require level 35/);
  assert.equal(await scalar("select count(*)::int from app_private.photon_unlocks where user_id=$1 and kind='weapon'",[v]),0);
  await execute("select set_config('photon.test_banned','true',true)");
  await fail('select public.get_photon_fury_profile()',[],/Account banned/);
  await fail("select public.extract_items(1,'photon:'||$1::text)",[box.profile.box_nonce],/account is banned/);
  await fail("select public.purchase_catalog_item('photon_weapon_ninjablade')",[],/account is banned/);
  await execute("select set_config('photon.test_banned','false',true)");
  await execute("select set_config('photon.test_uid','',true)");
  await fail('select public.get_photon_fury_profile()',[],/Sign in required/);
  await fail("select public.extract_items(1,'photon:'||$1::text)",[box.profile.box_nonce],/Sign in required/);
  await fail("select public.purchase_catalog_item('photon_weapon_ninjablade')",[],/Sign in required/);
  for(const role of ['anon','anonymous','authenticated']) {
    for(const fn of ['app_private.open_photon_box(uuid)','app_private.purchase_photon_weapon(text)','app_private.owns_photon_character(uuid,text)'])
      assert.equal(await scalar('select has_function_privilege($1,$2,\'execute\')',[role,fn]),false,`${role} ${fn}`);
    assert.equal(await scalar("select has_table_privilege($1,'app_private.photon_unlocks','select,insert,update,delete')",[role]),false);
  }
  for(const fn of ['public.get_photon_fury_profile()','public.equip_photon_character(text)','public.begin_photon_character_run(text)','public.finish_photon_character_run(uuid,numeric,integer,integer)','public.extract_items(integer,text)','public.purchase_catalog_item(text)']) {
    assert.equal(await scalar("select has_function_privilege('authenticated',$1,'execute')",[fn]),true);
    assert.equal(await scalar("select has_function_privilege('anon',$1,'execute')",[fn]),false);
  }
  assert.deepEqual((await execute('select user_id,protected_inventory,high_score from public.player_stats order by user_id')).rows,[{user_id:u,protected_inventory:{keep:'original'},high_score:'12345'},{user_id:v,protected_inventory:{keep:'second'},high_score:'6789'}]);
  console.log('PASS: actual-installed Photon upgrade + rerun,16 characters/48skins/17themes,4starters,locked ownership,own-account isolation,legacy receipts,versioned bounded rewards/replay,real public.extract_items as authenticated→atomic200Photon box+duplicate refunds+replay,real public.purchase_catalog_item as authenticated→weapon purchase+owned retry+level35/no-Stardust checks,default re-equip,guest/banned denial,private ACLs,protected data retained. All isolated fixtures rolled back.');
} finally {
  try { await execute('rollback'); } finally { await db.end(); }
}
