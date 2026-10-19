// Isolated Unix-socket PostgreSQL only. No .env/remote URL/auth provider/mail.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { readUpdateSnapshot } from './update-2-3-snapshot.mjs';
import { makeUpdate23Transport } from './update-2-3-release-transport.mjs';
import { buildLiveFixture23 } from './build-update-2-3-live-fixture.mjs';
const [socket,port,snapshotPath,extra]=process.argv.slice(2);
assert.match(socket??'',/^\/private\/tmp\/skyway-map-sql\.[A-Za-z0-9]+$/);
assert.match(port??'',/^\d{4,5}$/);
const snapshot=readUpdateSnapshot(snapshotPath);
assert.equal(snapshot.readOnly,true);
const db=new pg.Client({host:socket,port:Number(port),database:'economy_update_23',user:process.env.USER});
const source=name=>readFileSync(new URL(`../neon/${name}`,import.meta.url),'utf8').replace(/^begin(?: read only)?;\s*$/mi,'').replace(/^(?:commit|rollback);\s*$/mi,'');
const query=(sql,values=[])=>db.query(sql,values);
const scalar=async(sql,values=[])=>Object.values((await query(sql,values)).rows[0])[0];
let assertions=0;
const check=(actual,expected,label)=>{assert.deepEqual(actual,expected,label);assertions++;};
const fail=async(sql,values,pattern)=>{
 await query('savepoint rejected');
 try {await query(sql,values);assert.fail('Expected rejection');}
 catch(e){await query('rollback to savepoint rejected');assert.match(e.message,pattern);assertions++;}
 await query('release savepoint rejected');
};
const quote=s=>`"${s.replaceAll('"','""')}"`;
const actor=uid=>query("select set_config('skyway.test_uid',$1,true)",[uid??'']);
try {
 await db.connect();
 check(await scalar('select inet_server_addr()'),null,'No TCP target');
 check(await scalar('select current_database()'),'economy_update_23','Dedicated fixture database');
 check(Number(await scalar("select count(*) from pg_tables where schemaname='public'")),0,'Empty fixture');
 await query('begin');
 await query(`create schema app_private;create schema auth;
  do $$begin
   if not exists(select 1 from pg_roles where rolname='anon') then create role anon;end if;
   if not exists(select 1 from pg_roles where rolname='anonymous') then create role anonymous;end if;
   if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated;end if;
  end$$;
  create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('skyway.test_uid',true),'')::uuid$$;
  create function app_private.is_admin_test_user(uuid) returns boolean language sql stable as $$select false$$;`);
 for(const table of snapshot.tables.filter(t=>['public','app_private'].includes(t.schema))){
  const name=table.name;
  const columns=snapshot.columns.filter(c=>c.table_schema===table.schema&&c.table_name===name).sort((a,b)=>a.ordinal_position-b.ordinal_position);
  assert.ok(columns.length,name);const schema=columns[0].table_schema;
  const defs=columns.map(c=>`${quote(c.column_name)} ${c.udt_name.startsWith('_')?quote(c.udt_name.slice(1))+'[]':quote(c.udt_name)+(c.udt_name==='numeric'&&c.numeric_precision?`(${c.numeric_precision},${c.numeric_scale})`:'')}${c.is_identity==='YES'?' generated always as identity':c.column_default?' default '+c.column_default:''}${c.is_nullable==='NO'?' not null':''}`);
  await query(`create table ${quote(schema)}.${quote(name)}(${defs.join(',')})`);
  for(const c of snapshot.constraints.filter(c=>c.table_name===name&&(!c.schema||c.schema===schema)&&!/^(FOREIGN KEY|NOT NULL)/.test(c.definition))) await query(`alter table ${quote(schema)}.${quote(name)} add constraint ${quote(c.conname)} ${c.definition}`);
 }
 if(!snapshot.constraints.some(c=>c.table_name==='extraction_catalog'&&c.definition.startsWith('PRIMARY KEY'))) await query('alter table public.extraction_catalog add primary key(item_key)');
 if(!snapshot.constraints.some(c=>c.table_name==='progression_resets'&&c.definition.startsWith('PRIMARY KEY'))) await query('alter table app_private.progression_resets add primary key(version)');
 // Import TODAY'S installed functions, not the old QOL files: replaying a
 // historical migration here could conceal drift or erase a later fix. Body
 // validation is deferred only for dependency ordering in this empty fixture.
 await query('set local check_function_bodies=off');
 for(const fn of snapshot.functions) await query(fn.definition);
 await query('set local check_function_bodies=on');
 for(const fn of snapshot.functions){
  await query(`revoke all on function ${fn.qualified_signature} from public,anon,anonymous,authenticated`);
  for(const role of ['authenticated','anon','anonymous']) if(fn.acl?.includes(`${role}=X/`)) await query(`grant execute on function ${fn.qualified_signature} to ${role}`);
 }
 // Isolate queue/setup writes from unrelated global cleanup in its read API.
 // This does not claim to test production get_1v1_state or managed JWTs.
 await query(`create or replace function public.get_1v1_state(p_match_id uuid) returns jsonb language sql as $$select jsonb_build_object('match_id',p_match_id)$$;
  insert into app_private.one_v_one_map_rules(sort_order,lane_count,healing_enabled,coin_point_reward,wave_point_reward,natural_spawn_weights,gameplay_rules,map_key,display_name,obstacle_scaling,allowed_attacks,allowed_character_classes)
  select ordinal,5,true,2,3,'{}','{}',map,map,'normal',array['log','rock'],array['runner','medic','tank','trickster','misc']
  from unnest(array['classic','factory','pitch','meadow','alley','desert','skyway','volcano','grove','terminal']) with ordinality as maps(map,ordinal);`);
 const a=randomUUID(),b=randomUUID();
 for(const uid of [a,b]) await query('insert into public.player_stats(user_id,total_gems,high_score,level,lifetime_xp,xp_in_level,completed_runs,stardust) values($1,5000,99999,40,123456,0,12,456)',[uid]);
 await query('insert into app_private.ranked_requalification values($1,true,now())',[a]);
 await query("insert into public.player_photon_fury(user_id,unlocked_at,photons) values($1,now(),1000000)",[a]);
 await query("insert into app_private.photon_unlocks(user_id,item_key,kind) values($1,'photon_tick','character'),($1,'photon_tick_divine','skin'),($1,'photon_theme_cobalt','theme')",[a]);
 await query(`create schema neon_auth;
  create table neon_auth."user"(id uuid primary key,email text,username text,created_at timestamptz default clock_timestamp());
  create table neon_auth.account(id uuid primary key,user_id uuid,provider_id text,password text);`);
 for(const uid of [a,b]){
  await query('insert into neon_auth."user" values($1,$2,$3)',[uid,uid+'@example.invalid','Synthetic']);
  await query("insert into neon_auth.account values($1,$2,'credential','synthetic-recovery-only')",[randomUUID(),uid]);
 }
 const protectedStats=(await query('select user_id,total_gems,high_score,completed_runs,stardust from public.player_stats order by user_id')).rows;
 const protectedOwnership=(await query('select * from app_private.photon_unlocks order by item_key')).rows;
 const protectedPhoton=(await query('select user_id,photons,unlocked_at from public.player_photon_fury')).rows;
 // Execute the exact generated transaction, changing ONLY its outer fixture
 // target check and removing its outer commit so all synthetic state rolls back.
 const releasePath=new URL('../../../outputs/update-2-3-release-20261019.sql',import.meta.url);
 const productionBundle=readFileSync(releasePath,'utf8');
 assert.equal((productionBundle.match(/if current_database\(\)<>'neondb' or current_user<>'neondb_owner' then/g)??[]).length,1);
 const fixtureBundle=productionBundle.replace("if current_database()<>'neondb' or current_user<>'neondb_owner' then","if current_database()<>'economy_update_23' or inet_server_addr() is not null then");
 const clearAudit=()=>query('drop table pg_temp.update23_before,pg_temp.update23_existing_modes,pg_temp.update23_expected_modes,pg_temp.update23_metadata');
 await query(makeUpdate23Transport(fixtureBundle));assertions++;
 await clearAudit();
 check((await query('select user_id,total_gems,high_score,completed_runs,stardust from public.player_stats order by user_id')).rows,protectedStats,'XP reset preserves every non-XP stat');
 check((await query('select * from app_private.photon_unlocks order by item_key')).rows,protectedOwnership,'Owned skins, themes, characters unchanged');
 check((await query('select user_id,photons,unlocked_at from public.player_photon_fury')).rows,protectedPhoton,'Photon balance and paid mode unchanged');
 check(Number(await scalar('select count(*) from public.player_stats where level<>0 or xp_in_level<>0 or lifetime_xp<>0 or progression_version<>20261017')),0,'XP-only reset');
 await actor(a);
 let progress=await scalar('select public.get_player_progression()');
 check([progress.casual_unlocked,progress.rotating_unlocked,progress.ranked_unlocked],[true,true,true],'Old modes remain earned at level zero');
 check((await scalar('select public.unlock_ranked_1v1()')).total_gems,5000,'No second Ranked fee');
 check((await scalar('select public.unlock_photon_fury()')).total_gems,5000,'No second Photon fee');
 await query('select app_private.apply_player_xp($1,51,false)',[a]);
 await query(makeUpdate23Transport(fixtureBundle));assertions++;await clearAudit();
 check(Number(await scalar('select lifetime_xp from public.player_stats where user_id=$1',[a])),51,'Replay does not reset newly earned XP');
 await fail(makeUpdate23Transport(fixtureBundle.replace('do $preservation$',"update public.player_stats set total_gems=total_gems+1;\ndo $preservation$")),[],/PROTECTED DATA CHANGED: public.player_stats/);
 check(Number(await scalar('select total_gems from public.player_stats where user_id=$1',[a])),5000,'Preservation failure rolled back wallet mutation');
 await fail(makeUpdate23Transport(fixtureBundle.replace('do $preservation$',"update neon_auth.\"user\" set email='tamper@example.invalid';\ndo $preservation$")),[],/PROTECTED DATA CHANGED: neon_auth.user/);
 check(Number(await scalar("select count(*) from neon_auth.\"user\" where email='tamper@example.invalid'")),0,'Preservation failure rolled back managed account mutation');
 await query(source('update-2-3-economy.test.sql'));assertions++;
 const newRun=randomUUID();
 await query("update app_private.progression_resets set applied_at=clock_timestamp()-interval '60 seconds' where version in(20261014,20261017)");
 await query("insert into public.player_progression_runs(run_id,user_id,started_at,active_seconds,verified_wave) values($1,$2,clock_timestamp()-interval '30 seconds',20,5)",[newRun,a]);
 for(let i=0;i<3;i++) await query("insert into public.player_progression_events(user_id,source,source_key,xp_awarded,metadata) values($1,'gem',$2,0,jsonb_build_object('context_id',$3::text,'context_type','endless','gems_awarded',9,'verified_wave',25))",[a,`${newRun}:${i}`,newRun]);
 const award=await scalar("select app_private.award_completed_run_v2_live($1,1200,'endless')",[newRun]);
 check(award.xp_breakdown,{score:1,gems:30,gem_count:3,total:31},'Physical Gem count ignores streak amount and wave');
 check((await scalar("select app_private.award_completed_run_v2_live($1,1200,'endless')",[newRun])).xp_awarded,0,'Run retry cannot duplicate XP');
 await actor(b);
 await query('delete from app_private.mode_unlock_entitlements where user_id=$1',[b]);
 await query('update public.player_stats set level=24 where user_id=$1',[b]);
 await fail('select public.unlock_photon_fury()',[],/Requires level 25/);
 await query('update public.player_stats set level=25 where user_id=$1',[b]);
 check((await scalar('select public.unlock_photon_fury()')).total_gems,4775,'Photon costs 225');
 await fail('select public.unlock_ranked_1v1()',[],/Ranked requires level 35/);
 await query('update public.player_stats set level=35 where user_id=$1',[b]);
 check((await scalar('select public.unlock_ranked_1v1()')).total_gems,4540,'Ranked costs 235 independently');
 await actor(a);
 let profile=await scalar("select public.equip_photon_character('skin:photon_tick_divine')");
 check(profile.skin_choices.photon_tick,'photon_tick_divine','Existing Divine remains equippable');
 await query("insert into app_private.photon_unlocks(user_id,item_key,kind) values($1,'photon_tick_ascendant','skin')",[a]);
 profile=await scalar("select public.equip_photon_character('skin:photon_tick_ascendant')");
 check(profile.skin_choices.photon_tick,'photon_tick_ascendant','Can choose a lower owned tier');
 check((await scalar("select public.equip_photon_character('skin:default:photon_tick')")).skin_choices.photon_tick,undefined,'Default remains equippable');
 await query('update public.player_stats set level=39 where user_id=$1',[a]);
 await fail("select public.purchase_catalog_item('photon_weapon_ninjablade')",[],/level 40/);
 await query('update public.player_stats set level=40 where user_id=$1',[a]);
 check((await scalar("select public.purchase_catalog_item('photon_weapon_ninjablade')")).already_owned,false,'Weapon unlocked at 40');
 check((await scalar("select public.begin_photon_character_run('photon_tick')")).rules_version,20261017,'New run rules bound to receipt');
 await query('insert into app_private.photon_unlocks(user_id,item_key,kind) select $1,item_key,kind from app_private.photon_qol_catalog() where kind in(\'character\',\'skin\',\'theme\') on conflict do nothing',[a]);
 profile=await scalar('select public.get_photon_fury_profile()');
 const box=await scalar('select public.extract_items(1,$1)',[`photon:${profile.box_nonce}`]);
 check(box.results.filter(r=>r.kind!=='stardust').every(r=>r.duplicate_gems===10),true,'All owned duplicates return ten');
 const replay=await scalar('select public.extract_items(1,$1)',[`photon:${profile.box_nonce}`]);
 check(replay.gems,box.gems,'Box nonce replay never repeats payment/refund');
 check(replay.stardust,box.stardust,'Box nonce replay never repeats Stardust');
 // The confirmed Bonus profile is live in this fixture, not a temporary hold.
 check((await query("select * from app_private.booster_pull_rules('bonus')")).rows[0],{character_percent:14,weights:[33,28,17,13,9,0]},'Exact confirmed Bonus profile');
 check(Number(await scalar("select count(*) from generate_series(0,99) i cross join lateral app_private.booster_roll('bonus',(i+.5)/100,.5) r where r.category='character'")),14,'Bonus category threshold is exactly 14%');
 const bonusCounts=(await query("select r.rarity,count(*)::integer n from generate_series(0,99) i cross join lateral app_private.booster_roll('bonus',.5,(i+.5)/100) r group by r.rarity")).rows;
 check(['common','uncommon','rare','epic','legendary','mythic'].map(r=>bonusCounts.find(row=>row.rarity===r)?.n??0),[33,28,17,13,9,0],'Bonus rarity boundaries are exact');
 // Every rarity/category has an actual selectable synthetic item, so a box
 // failure cannot be confused with an intentionally empty catalog fixture.
 for(const rarity of ['common','uncommon','rare','epic','legendary','mythic']) for(const type of ['character','player','obstacle','environment'])
  await query("insert into public.extraction_catalog(item_key,display_name,item_type,rarity,character_class,weapon_name,weapon_score_bonus) values($1,$1,$2,$3,$4,case when $2='character' then $1 else null end,case when $2='character' then 0 else null end)",[`fixture_${type}_${rarity}`,type,rarity,type==='character'?'runner':null]);
 for(const [kind,cost,count,mix] of [['normal',11,10,{normal:10}],['rare',19,11,{normal:7,rare:2,bonus:2}],['legendary',27,12,{normal:5,rare:3,bonus:3,legendary:1}]]){
  const before=Number(await scalar('select total_gems from public.player_stats where user_id=$1',[a]));
  const opened=await scalar('select public.extract_items(1,$1)',[kind]);
  check(opened.cost,cost,`${kind} box exact fee`);
  check(opened.gems,before-cost,`${kind} box subtracts only its stated fee`);
  check(Number(await scalar('select total_gems from public.player_stats where user_id=$1',[a])),before-cost,`${kind} box fee is committed inside the fixture transaction`);
  check(opened.results.length,count,`${kind} box exact item count`);
  check(Object.fromEntries([...new Set(opened.results.map(r=>r.draw_profile))].map(profile=>[profile,opened.results.filter(r=>r.draw_profile===profile).length])),mix,`${kind} box exact pull mix`);
  if(kind!=='legendary')check(opened.results.some(r=>r.rarity==='mythic'),false,`${kind} box has no mythic-capable pull`);
 }
 // Retain the generic prepayment guard: an invalid future profile must reject
 // atomically, not normalize odds or spend any of the actor's currencies.
 await query('savepoint invalid_profile');
 const validBonusDefinition=await scalar("select pg_get_functiondef('app_private.booster_pull_rules(text)'::regprocedure)");
 assert.ok(validBonusDefinition.includes('array[33,28,17,13,9,0]'));
 await query(validBonusDefinition.replace('array[33,28,17,13,9,0]','array[32,28,17,13,9,0]'));
 const walletBeforeInvalid=(await query('select total_gems,stardust from public.player_stats where user_id=$1',[a])).rows[0];
 await fail("select public.extract_items(1,'rare')",[],/Invalid pull odds; no Gems spent/);
 check((await query('select total_gems,stardust from public.player_stats where user_id=$1',[a])).rows[0],walletBeforeInvalid,'Invalid future profile spends neither Gems nor Stardust');
 await query('rollback to savepoint invalid_profile');
 // Apply/reapply the real variant migration and execute its queue body. Only
 // the fixture-local clock call is replaced so every NY weekday is testable.
 await query(source('update-2-3-duel-modes.sql'));
 await query(source('update-2-3-duel-modes.sql'));
 const healthGuardBefore=await scalar("select pg_get_functiondef('app_private.update_1v1_state_unadjusted(uuid,numeric,integer,bigint,text)'::regprocedure)");
 for(const name of ['gem-streak','masteries','health','guard','smoke']){
  await query(source(`update-2-3-${name}.sql`));await query(source(`update-2-3-${name}.sql`));
 }
 check(await scalar("select pg_get_functiondef('app_private.update_1v1_state_unadjusted(uuid,numeric,integer,bigint,text)'::regprocedure)"),healthGuardBefore,'Existing non-medic mid-wave heal guard is unchanged');
 check(await scalar("select app_private.rotating_mode_19('2026-10-18T03:59:59Z')"),'rng','NY Saturday until midnight');
 check(await scalar("select app_private.rotating_mode_19('2026-10-18T04:00:00Z')"),'quicksand','NY Sunday after midnight');
 check(Number(await scalar("select count(*) from app_private.one_v_one_map_rules where map_key<>'terminal' and not('snowflake'=any(allowed_attacks))")),0,'Purchased Snowflakes on every armory-enabled map');
 check(await scalar("select 'snowflake'=any(allowed_attacks) from app_private.one_v_one_map_rules where map_key='terminal'"),false,'Terminal remains the explicit no-armory exception');
 for(const [uid,name] of [[a,'FixtureA'],[b,'FixtureB']]) await query('insert into public.player_profiles(user_id,username) values($1,$2)',[uid,name]);
 for(const [key,rarity,cl] of [['runner_ace','default','runner'],['rare_runner','rare','runner'],['rare_trickster','rare','trickster'],['epic_runner','epic','runner'],['mythic_runner','mythic','runner'],['medic_remedy','rare','medic']]){
  await query("insert into public.extraction_catalog(item_key,display_name,item_type,rarity,character_class,weapon_name,weapon_score_bonus) values($1,$1,'character',$2,$3,$1,0)",[key,rarity,cl]);
  for(const uid of [a,b]) await query("insert into public.player_unlocks(user_id,item_key,item_type,rarity) values($1,$2,'character',$3)",[uid,key,rarity]);
 }
 let queueDef=await scalar("select pg_get_functiondef('public.join_1v1_queue(text)'::regprocedure)");
 queueDef=queueDef.replace('FUNCTION public.join_1v1_queue(','FUNCTION pg_temp.join_1v1_queue(').replaceAll('app_private.rotating_mode_19(now())',"current_setting('skyway.test_rotation')");
 await query(queueDef);
 await query('update public.player_stats set level=0 where user_id in($1,$2)',[a,b]);
 await query("insert into app_private.mode_unlock_entitlements(user_id,mode) values($1,'casual'),($1,'rotating'),($2,'casual'),($2,'rotating') on conflict do nothing",[a,b]);
 const pair=async mode=>{
  await query("update public.multiplayer_matches set status='finished' where status in('countdown','playing','intermission')");
  await query('delete from public.multiplayer_queue');
  await query("select set_config('skyway.test_rotation',$1,true)",[mode]);
  await actor(b);check((await scalar('select pg_temp.join_1v1_queue($1)',[mode])).status,'waiting','First player waits');
  await actor(a);return scalar('select pg_temp.join_1v1_queue($1)',[mode]);
 };
 const quick=await pair('quicksand');
 check(quick.map_key,'classic','Quicksand forces Classic');
 check((await query('select character_key,hearts::text,max_hearts::text from public.multiplayer_players where match_id=$1 order by slot',[quick.match_id])).rows,[{character_key:'runner_ace',hearts:'4.0000',max_hearts:'4.0000'},{character_key:'runner_ace',hearts:'4.0000',max_hearts:'4.0000'}],'Quicksand forces Ace and four HP');
 check(await scalar('select phase from app_private.match_setup_19 where match_id=$1',[quick.match_id]),'announce','No Quicksand map ban');
 const mundane=await pair('mundane');
 check(['classic','factory','pitch','meadow'].includes(mundane.map_key),true,'Mundane restricts map pool');
 check(await scalar('select phase from app_private.match_setup_19 where match_id=$1',[mundane.match_id]),'announce','Mundane announces map before selection');
 await query("update app_private.match_setup_19 set deadline=clock_timestamp()-interval '1 second' where match_id=$1",[mundane.match_id]);
 await query('select app_private.advance_setup_19($1)',[mundane.match_id]);
 check(await scalar('select phase from app_private.match_setup_19 where match_id=$1',[mundane.match_id]),'character','Mundane provides character selection');
 await fail('select public.choose_1v1_character($1,$2)',[mundane.match_id,'epic_runner'],/not allowed in this duel mode/);
 await fail('select public.choose_1v1_character($1,$2)',[mundane.match_id,'rare_trickster'],/not allowed in this duel mode/);
 check((await scalar('select public.choose_1v1_character($1,$2)',[mundane.match_id,'rare_runner'])).match_id,mundane.match_id,'Mundane accepts owned Rare Runner');
 await scalar('select public.choose_1v1_character($1,$2)',[mundane.match_id,'medic_remedy']);
 check((await query('select hearts::text,max_hearts::text from public.multiplayer_players where match_id=$1 and user_id=$2',[mundane.match_id,a])).rows[0],{hearts:'3.0000',max_hearts:'3.5000'},'Remedy starts at 3 with exact maximum 3.5');
 await query("update public.multiplayer_matches set status='playing' where id=$1",[mundane.match_id]);
 await query("update public.multiplayer_players set status='playing' where match_id=$1",[mundane.match_id]);
 await scalar("select public.update_1v1_state($1,1.3475,1,222,'playing')",[mundane.match_id]);
 check(await scalar('select hearts::text from public.multiplayer_players where match_id=$1 and user_id=$2',[mundane.match_id,a]),'1.3475','Four-decimal actual HP persists after a real full-state sync');
 await scalar("select public.update_1v1_state($1,2.3475,1,223,'playing')",[mundane.match_id]);
 check(await scalar('select hearts::text from public.multiplayer_players where match_id=$1 and user_id=$2',[mundane.match_id,a]),'2.3475','Medic healing preserves fractional HP without rounding it to a half heart');
 check(Number(await scalar('select app_private.rounded_health_for_conditions(2.3475)')),2.5,'Only the ability condition is rounded');
 await fail("select public.update_1v1_state($1,3.75,1,224,'playing')",[mundane.match_id],/Hearts must be between 0 and 3.5000/);
 await query("update public.multiplayer_matches set map_key='pitch',status='playing' where id=$1",[mundane.match_id]);
 await query("update public.multiplayer_players set wave=2,status='playing',katana_broken=false,last_katana_wave=2,last_katana_at=clock_timestamp()-interval '0.38 seconds' where match_id=$1 and user_id=$2",[mundane.match_id,a]);
 await fail("select public.reflect_1v1_attack($1,'expired-window','rock')",[mundane.match_id],/Katana is not active/);
 await query("update public.multiplayer_players set last_katana_wave=null,katana_cooldown_until=null where match_id=$1 and user_id=$2",[mundane.match_id,a]);
 const activated=await scalar('select public.activate_1v1_katana($1)',[mundane.match_id]);
 check(Number(await scalar("select extract(epoch from ($1::timestamptz-$2::timestamptz))",[activated.active_until,activated.activated_at])),.32,'Katana server active window follows wave speed');
 check(Number(await scalar("select extract(epoch from ($1::timestamptz-$2::timestamptz))",[activated.katana_cooldown_until,activated.activated_at])),6.4,'Katana server fixed cooldown unchanged');
 const reflected=await scalar("select public.reflect_1v1_attack($1,'valid-window','rock')",[mundane.match_id]);
 check(reflected.outcome,'broken','Valid active rock block reaches owned-match reflection logic');
 check((await scalar("select public.reflect_1v1_attack($1,'valid-window','rock')",[mundane.match_id])).duplicate,true,'Reflection retry keeps existing receipt idempotence');
 check(await scalar("select app_private.duel_character_allowed_23('casual','mythic_runner')"),false,'Casual bans mythics');
 check(await scalar("select app_private.duel_character_allowed_23('ranked','mythic_runner')"),false,'Ranked bans mythics');
 check(await scalar("select app_private.duel_character_allowed_23('unlimited','mythic_runner')"),true,'Unlimited allows mythics');
 await query('update public.player_stats set level=0 where user_id=$1',[b]);
 check(await scalar("select app_private.duel_mode_allowed_23($1,'unlimited')",[b]),false,'Unlimited requires all collection/mode/level criteria');
 for(const [prefix,n,rarity] of [['low',80,'common'],['legend',18,'legendary'],['myth',3,'mythic']]){
  await query("insert into public.extraction_catalog(item_key,display_name,item_type,rarity,character_class,weapon_name,weapon_score_bonus) select $1||i,$1||i,'character',$2,'runner',$1||i,0 from generate_series(1,$3) i",[prefix,rarity,n]);
  await query("insert into public.player_unlocks(user_id,item_key,item_type,rarity) select $1,item_key,item_type,rarity from public.extraction_catalog where item_key like $2||'%' on conflict do nothing",[b,prefix]);
 }
 await query('update public.player_stats set level=44 where user_id=$1',[b]);
 check(await scalar("select app_private.duel_mode_allowed_23($1,'unlimited')",[b]),false,'All inventory alone cannot bypass level 45');
 await query('update public.player_stats set level=45 where user_id=$1',[b]);
 check(await scalar("select app_private.duel_mode_allowed_23($1,'unlimited')",[b]),true,'Unlimited unlocks from verified own collection, modes and level');
 await query('update public.player_stats set level=0 where user_id=$1',[b]);
 check(await scalar("select app_private.duel_mode_allowed_23($1,'unlimited')",[b]),true,'Earned Unlimited survives later XP-only reset');
 check(await scalar("select has_function_privilege('authenticated','app_private.duel_mode_allowed_23(uuid,text)','execute')"),false,'Private unlock checker cannot be called by players');
 await query('savepoint unexpected_mode');
 await query("alter table public.multiplayer_matches drop constraint multiplayer_matches_mode_check;alter table public.multiplayer_matches add constraint multiplayer_matches_mode_check check(mode in('casual','ranked','unlimited','rng','hardcore_duel','quicksand','mundane','unreviewed_mode'))");
 await fail(source('update-2-3-duel-modes.sql'),[],/Unexpected mode constraint/);
 check((await scalar("select pg_get_constraintdef(oid) from pg_constraint where conrelid='public.multiplayer_matches'::regclass and conname='multiplayer_matches_mode_check'")).includes('unreviewed_mode'),true,'Unexpected existing mode is not silently removed');
 await query('rollback to savepoint unexpected_mode');
 await actor(null);await fail("select public.join_1v1_queue('quicksand')",[],/Sign in required/);
 await actor(null);await fail('select public.get_player_progression()',[],/Sign in required/);
 check(await scalar("select to_regprocedure('app_private.has_active_ban(uuid,text,text)')"),null,'No permissive fixture-only text-device ban overload exists');
 check(await scalar("select md5(pg_get_functiondef('app_private.has_active_ban(uuid,text,uuid)'::regprocedure))"),'c60dec7971e58e19600a20379eb8d757','Actual unchanged UUID-device ban helper is installed');
 await query('savepoint actual_ban_helper');
 await query("insert into public.player_bans(scope,target_user_id,starts_at,expires_at,reason,created_by) values('account',$1,now()-interval '1 hour',now()+interval '1 hour','Owned local ban regression',$1)",[a]);
 await actor(a);await fail('select public.get_mastery_profile()',[],/Account banned/);
 await query('rollback to savepoint actual_ban_helper');await query('release savepoint actual_ban_helper');
 // The exact live-fixture templates are executed ONLY against this disposable
 // local schema. No auth request is made, and these two UUIDs are synthetic.
 await query('savepoint live_template_fixture');
 // Managed Better Auth IDs may be text, while gameplay IDs are UUID. Exercise
 // that real boundary rather than relying on fixture-only UUID comparisons.
 await query('alter table neon_auth."user" alter column id type text using id::text;alter table neon_auth.account alter column user_id type text using user_id::text');
 const marker=`skyway_u23_live_${Date.now()}_a1b2c3d4`;
 const fixtureManifest={marker,fixtures:[{id:randomUUID(),email:`${marker}_a@example.invalid`},{id:randomUUID(),email:`${marker}_b@example.invalid`}]};
 const liveFixture=buildLiveFixture23(fixtureManifest);
 const localFixtureSql=sql=>sql.replace("if current_database()<>'neondb' or current_user<>'neondb_owner' then","if current_database()<>'economy_update_23' or inet_server_addr() is not null then");
 for(const [i,f] of fixtureManifest.fixtures.entries()){
  await query('insert into neon_auth."user"(id,email,username) values($1,$2,$3)',[f.id,f.email,`u23owned_fixture_${i}`]);
  await query("insert into neon_auth.account values($1,$2,'credential','synthetic-recovery-only')",[randomUUID(),f.id]);
  await query('insert into public.player_stats(user_id) values($1)',[f.id]);
  await query('insert into public.player_profiles(user_id,username) values($1,$2)',[f.id,`u23owned_fixture_${i}`]);
  await query("insert into public.player_loadouts(user_id,character_key) values($1,'runner_ace')",[f.id]);
 }
 await fail(localFixtureSql(liveFixture.seed).replace(fixtureManifest.fixtures[0].email,`${marker}_z@example.invalid`),[],/Exact synthetic account ID\/email\/creation marker mismatch/);
 const nonFixtureBefore=await scalar(liveFixture.baseline);
 await query('savepoint live_no_match_cleanup');
 await query(localFixtureSql(liveFixture.cleanup));assertions++;
 check(Number(await scalar('select count(*) from neon_auth."user" where id=any($1::text[])',[fixtureManifest.fixtures.map(f=>f.id)])),0,'Exact fixture accounts can be cleaned before any match was seeded');
 check(await scalar(liveFixture.baseline),nonFixtureBefore,'No-match cleanup preserves all non-fixture account/profile/wallet aggregates');
 await query('rollback to savepoint live_no_match_cleanup');await query('release savepoint live_no_match_cleanup');
 await query(localFixtureSql(liveFixture.seed));assertions++;
 await fail(localFixtureSql(liveFixture.seed),[],/already exists/);
 check(Number(await scalar('select count(*) from public.multiplayer_queue where user_id=any($1::uuid[])',[fixtureManifest.fixtures.map(f=>f.id)])),0,'Isolated live seed never enters a public queue');
 await query(snapshot.functions.find(f=>f.name==='get_1v1_state'&&f.schema==='public').definition);
 await actor(fixtureManifest.fixtures[0].id);
 const fixtureState=await scalar('select public.get_1v1_state($1)',[liveFixture.matchId]);
 check([fixtureState.match.id,fixtureState.match.map_key,fixtureState.match.mode,fixtureState.self.user_id,fixtureState.opponent.user_id],[liveFixture.matchId,'pitch','casual',fixtureManifest.fixtures[0].id,fixtureManifest.fixtures[1].id],'Actual current full-state API reads only the two exact seed fixtures');
 check(Number(await scalar('select public.sync_1v1_score($1,501)',[liveFixture.matchId])),501,'Seed supports score beyond 200');
 const liveKatana=await scalar('select public.activate_1v1_katana($1)',[liveFixture.matchId]);
 check(Number(await scalar('select extract(epoch from($1::timestamptz-$2::timestamptz))',[liveKatana.active_until,liveKatana.activated_at])),.32,'Seed supports real own Katana wave-two timing');
 check(typeof(await scalar('select public.get_1v1_ability_state($1)',[liveFixture.matchId])),'object','Seed supports actual own ability state');
 await actor(null);
 const sabotage=liveFixture.cleanup.replace('for item in select * from pg_temp.u23_cleanup_protected',`update public.player_stats set total_gems=total_gems+1 where user_id='${a}'::uuid;\n for item in select * from pg_temp.u23_cleanup_protected`);
 await fail(localFixtureSql(sabotage),[],/NON-FIXTURE DATA CHANGED: public.player_stats/);
 check(Number(await scalar('select count(*) from neon_auth."user" where id=any($1::text[])',[fixtureManifest.fixtures.map(f=>f.id)])),2,'Unsafe cleanup rolls back both account deletions');
 await query(localFixtureSql(liveFixture.cleanup));assertions++;
 check(await scalar(liveFixture.baseline),nonFixtureBefore,'Exact fixture cleanup leaves all non-fixture account/profile/wallet/ownership/admin aggregates unchanged');
 check(Number(await scalar('select count(*) from neon_auth."user" where id=any($1::text[])',[fixtureManifest.fixtures.map(f=>f.id)])),0,'Only two exact synthetic native accounts removed');
 check(Number(await scalar('select count(*) from public.multiplayer_players where match_id=$1',[liveFixture.matchId])),0,'Imported match rows without FK are also removed by exact match UUID');
 await query('rollback to savepoint live_template_fixture');await query('release savepoint live_template_fixture');
 if(extra==='--mastery-management'){
  const result=await (await import('./test-mastery-management-sql.mjs')).testMasteryManagement({query,scalar,check,fail,actor,source});
  await query('rollback');console.log(JSON.stringify({passed:true,assertions,...result}));
 }else{
 // Function hashes and grant booleans only: no fixture/account rows or secrets.
 const currentFunctions=(await query(`select n.nspname||'.'||p.proname||'('||pg_catalog.oidvectortypes(p.proargtypes)||')' signature,
  pg_get_functiondef(p.oid) definition,md5(pg_get_functiondef(p.oid)) md5,
  has_function_privilege('authenticated',p.oid,'execute') authenticated,
  has_function_privilege('anon',p.oid,'execute') anon,has_function_privilege('anonymous',p.oid,'execute') anonymous
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','app_private') order by n.nspname,p.proname,p.proargtypes`)).rows;
 const changed=currentFunctions.filter(f=>{
  if(f.signature==='public.get_1v1_state(uuid)')return false; // explicit fixture read stub, never release source
  const canonical=s=>s.replace(/,\s*/g,',');
  const old=snapshot.functions.find(o=>canonical(o.qualified_signature)===canonical(f.signature));
  // Keep the UNCHANGED real UUID-device ban helper as an explicit security
  // control. Never invent or export a permissive fixture-only overload.
  return canonical(f.signature)==='app_private.has_active_ban(uuid,text,uuid)'||!old||old.definition!==f.definition||f.authenticated!==old.acl?.includes('authenticated=X/')||f.anon!==old.acl?.includes('anon=X/')||f.anonymous!==old.acl?.includes('anonymous=X/');
 }).map(f=>Object.fromEntries(Object.entries(f).filter(([key])=>key!=='definition')));
 writeFileSync(new URL('../../../outputs/update-2-3-verified-functions-20261019.json',import.meta.url),JSON.stringify({update:'2.3',snapshot_captured_at:snapshot.captured_at,localFixtureVerified:true,productionApplied:false,functions:changed},null,2),{mode:0o600});
 await import('./build-update-2-3-readback.mjs');
 const readback=await scalar(readFileSync(new URL('../../../outputs/update-2-3-readback-20261019.sql',import.meta.url),'utf8'));
 check(readback.schema_checks_passed,true,'Exact aggregate production readback verifies local installed hashes/grants/RLS/XP registry');
 check(readback.function_mismatches,[],'All expected function bodies and grants match');
 check(readback.private_table_mismatches,[],'All private tables keep RLS and denied direct grants');
 await query('rollback');
 check(Number(await scalar("select count(*) from pg_tables where schemaname='public'")),0,'Everything rolled back');
 console.log(JSON.stringify({passed:true,assertions,productionConnected:false,realAccountsUsed:false,rolledBack:true}));
 }
}finally{await query('rollback').catch(()=>{});await db.end();}
