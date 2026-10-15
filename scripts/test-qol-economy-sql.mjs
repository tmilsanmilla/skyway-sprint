// Disposable local PostgreSQL only. Never accepts a remote URL or .env file.
// The fixture contains schema metadata and synthetic UUIDs, never real players.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import pg from "pg";

const args=Object.fromEntries(process.argv.slice(2).reduce((pairs,value,index,all)=>{
  if(value.startsWith("--")) pairs.push([value.slice(2),all[index+1]]);
  return pairs;
},[]));
assert.match(args.socket??"",/^\/private\/tmp\/skyway-map-sql\.[A-Za-z0-9]+$/,"Use the disposable local socket");
assert.equal(args.database,"economy_test","Use the dedicated empty fixture database");
assert.match(args.port??"",/^\d{4,5}$/);
assert.ok(args["installed-snapshot"],"Pass the read-only installed definition snapshot");
const snapshot=JSON.parse(await readFile(args["installed-snapshot"],"utf8"));
assert.equal(snapshot.readOnly,true);
const client=new pg.Client({host:args.socket,port:Number(args.port),database:args.database,user:process.env.USER});
await client.connect();
const quote=value=>`"${value.replaceAll('"','""')}"`;
const source=async name=>(await readFile(new URL(`../neon/${name}`,import.meta.url),"utf8"))
  .replace(/^begin;\s*$/m,"").replace(/^commit;\s*$/m,"");
const one=async(sql,values=[]) => (await client.query(sql,values)).rows[0];
const actor=async uid=>{await client.query("select set_config('skyway.test_uid',$1,true)",[uid??""]);};
let assertions=0;
const check=(actual,expected,label)=>{assert.deepEqual(actual,expected,label);assertions++;};
const expectError=async(sql,values,message)=>{
  await client.query("savepoint expected_error");
  try { await client.query(sql,values);assert.fail(`Expected rejection: ${message}`); }
  catch(error) {
    await client.query("rollback to savepoint expected_error");
    assert.match(error.message,message);assertions++;
  } finally {await client.query("release savepoint expected_error");}
};
const migration=async name=>client.query(await source(name));
try {
  check((await one("select current_database() name,inet_server_addr() host")).name,"economy_test","Dedicated database");
  check((await one("select inet_server_addr() host")).host,null,"TCP disabled");
  check(Number((await one("select count(*) n from pg_tables where schemaname='public'")).n),0,"Empty local database");
  await client.query("begin");
  await client.query(`create schema app_private;create schema auth;
    do $$begin
      if not exists(select 1 from pg_roles where rolname='anon') then create role anon;end if;
      if not exists(select 1 from pg_roles where rolname='anonymous') then create role anonymous;end if;
      if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated;end if;
    end$$;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('skyway.test_uid',true),'')::uuid$$;
    create table app_private.fixture_bans(user_id uuid,kind text);
    create function app_private.has_active_ban(u uuid,k text,d text) returns boolean language sql stable as
      $$select exists(select 1 from app_private.fixture_bans where user_id=u and kind=k)$$;
    create function app_private.is_admin_test_user(u uuid) returns boolean language sql stable as $$select false$$;`);
  const tables=["player_stats","player_progression_runs","player_progression_events","extraction_catalog","player_unlocks",
    "player_profiles","multiplayer_queue","multiplayer_matches","multiplayer_players","player_photon_fury","progression_resets"];
  for(const table of tables) {
    const columns=snapshot.columns.filter(c=>c.table_name===table).sort((a,b)=>a.ordinal_position-b.ordinal_position);
    assert.ok(columns.length,`Missing real shape: ${table}`);
    const schema=columns[0].table_schema;
    const definitions=columns.map(c=>`${quote(c.column_name)} ${c.udt_name.startsWith("_")?`${quote(c.udt_name.slice(1))}[]`:quote(c.udt_name)}${c.column_default?` default ${c.column_default}`:""}${c.is_nullable==="NO"?" not null":""}`);
    await client.query(`create table ${quote(schema)}.${quote(table)}(${definitions.join(",")})`);
    for(const constraint of snapshot.constraints.filter(c=>c.table_name===table&&!/^(FOREIGN KEY|NOT NULL)/.test(c.definition))) {
      await client.query(`alter table ${quote(schema)}.${quote(table)} add constraint ${quote(constraint.conname)} ${constraint.definition}`);
    }
  }
  await client.query(`alter table public.extraction_catalog add primary key(item_key);
    alter table app_private.progression_resets add primary key(version);
    create table app_private.ranked_requalification(user_id uuid primary key,qualified boolean not null default false,qualified_at timestamptz);
    create table app_private.match_setup_19(match_id uuid primary key,phase text,ends_at timestamptz,rarity text);
    create table app_private.progression_reset_backup(user_id uuid,old_xp bigint);
    create function app_private.rotating_mode_19(t timestamptz) returns text language sql as $$select 'rng'::text$$;
    create function app_private.setup_19_health(u uuid) returns void language plpgsql as $$begin return;end$$;
    create function app_private.open_photon_box(u uuid) returns jsonb language sql as $$select '{"photon_routed":true}'::jsonb$$;
    create function app_private.purchase_photon_weapon(k text) returns jsonb language sql as $$select jsonb_build_object('photon_weapon_routed',k)$$;`);
  for(const name of ["photon_user","award_completed_run_v2_live","join_1v1_queue"]) {
    const fn=snapshot.functions.find(f=>f.name===name&&(name!=="join_1v1_queue"||f.definition.includes("p_mode text")));
    assert.ok(fn,`Missing installed function: ${name}`);
    await client.query(fn.definition);
  }
  const [a,b,c]=[randomUUID(),randomUUID(),randomUUID()];
  const oldReceipt=randomUUID();
  for(const [uid,label] of [[a,"FixtureA"],[b,"FixtureB"],[c,"FixtureC"]]) {
    await client.query("insert into public.player_stats(user_id,total_gems,high_score,level,lifetime_xp,xp_in_level,completed_runs) values($1,5000,99999,30,49500,0,12)",[uid]);
    await client.query("insert into public.player_profiles(user_id,username) values($1,$2)",[uid,label]);
  }
  await client.query("insert into app_private.ranked_requalification values($1,true,now())",[c]);
  await client.query("insert into public.player_photon_fury(user_id,unlocked_at,photons) values($1,now(),321)",[c]);
  await client.query("insert into app_private.progression_reset_backup values($1,4567)",[a]);
  await client.query("insert into public.player_progression_events(id,user_id,source,source_key,xp_awarded,metadata) values($1,$2,'run','old-id',4567,'{\"xp_breakdown\":{\"total\":4567},\"credited_score\":987,\"scope\":\"endless\"}')",[oldReceipt,a]);
  const beforeReset=(await client.query("select user_id,total_gems,high_score,completed_runs from public.player_stats order by user_id")).rows;
  await migration("qol-progression.sql");
  check((await client.query("select user_id,total_gems,high_score,completed_runs from public.player_stats order by user_id")).rows,beforeReset,"XP reset preserves every non-XP stat");
  check(Number((await one("select count(*) n from public.player_stats where level<>0 or lifetime_xp<>0 or xp_in_level<>0 or progression_version<>20261014")).n),0,"All fixture levels reset");
  check(await one("select id,xp_awarded::text,metadata from public.player_progression_events where id=$1",[oldReceipt]),{id:oldReceipt,xp_awarded:"0",metadata:{credited_score:987,scope:"endless"}},"Receipt ID and non-XP metadata retained");
  check((await one("select to_regclass('app_private.progression_reset_backup') value")).value,null,"Only obsolete XP snapshot removed");
  check((await one("select qualified from app_private.ranked_requalification where user_id=$1",[c])).qualified,true,"Ranked entitlement retained");
  check((await one("select photons::text from public.player_photon_fury where user_id=$1",[c])).photons,"321","Photon balance retained");
  await client.query("select app_private.apply_player_xp($1,50,false)",[a]);
  await migration("qol-progression.sql");
  check((await one("select lifetime_xp::text from public.player_stats where user_id=$1",[a])).lifetime_xp,"50","Rerunning migration does not reset new XP");
  for(let level=0;level<=100;level++) {
    const value=await one("select app_private.cumulative_xp_for_level($1)::text total,app_private.xp_required_for_level($1)::text required",[level]);
    check(value,{total:String(50*level*level+350*level),required:String(400+100*level)},"Exact cumulative curve");
    const next=50*(level+1)**2+350*(level+1);
    check((await one("select app_private.level_for_lifetime_xp($1) level",[next-1])).level,level,"Inverse threshold below");
    check((await one("select app_private.level_for_lifetime_xp($1) level",[next])).level,level+1,"Inverse threshold at");
  }
  await actor(a);
  await client.query("update app_private.progression_resets set applied_at=clock_timestamp()-interval '60 seconds' where version=20261014");
  const oldRun=randomUUID(),newRun=randomUUID();
  for(const [id,age] of [[oldRun,120],[newRun,30]]) await client.query("insert into public.player_progression_runs(run_id,user_id,started_at,active_seconds,verified_wave) values($1,$2,clock_timestamp()-$3*interval '1 second',20,5)",[id,a,age]);
  let receipt=(await one("select app_private.award_completed_run_v2_live($1,11000,'endless') value",[oldRun])).value;
  check(receipt.xp_awarded,0,"Pre-reset in-progress run cannot restore XP");
  for(const [id,wave] of [["gem1",5],["gem2",7]]) await client.query("insert into public.player_progression_events(user_id,source,source_key,xp_awarded,metadata) values($1,'gem',$2,0,jsonb_build_object('context_id',$3::text,'context_type','endless','verified_wave',$4::int,'gems_awarded',5))",[a,`${newRun}:${id}`,newRun,wave]);
  receipt=(await one("select app_private.award_completed_run_v2_live($1,11000,'endless') value",[newRun])).value;
  check(receipt.xp_breakdown,{score:158,gems:12,gem_count:10,total:170},"New score formula plus per-physical-Gem verified-wave bonus");
  check(receipt.xp_awarded,170,"Whole end-run XP award");
  const afterRun=(await one("select to_jsonb(s) value from public.player_stats s where user_id=$1",[a])).value;
  receipt=(await one("select app_private.award_completed_run_v2_live($1,11000,'endless') value",[newRun])).value;
  check(receipt.xp_awarded,0,"Run replay awards zero");
  check((await one("select to_jsonb(s) value from public.player_stats s where user_id=$1",[a])).value,afterRun,"Run replay preserves stats");
  await actor(b);
  await expectError("select app_private.award_completed_run_v2_live($1,11000,'endless')",[newRun],/Run receipt not found/);

  await actor(a);
  await client.query("update public.player_stats set level=4 where user_id=$1",[a]);
  await expectError("select public.join_1v1_queue('casual')",[],/Casual 1v1 requires level 5/);
  await client.query("update public.player_stats set level=5 where user_id=$1",[a]);
  await client.query("insert into public.multiplayer_queue values($1,now(),'casual')",[b]);
  receipt=(await one("select public.join_1v1_queue('casual') value")).value;
  check(receipt.status,"waiting","Under-level queued rival cannot be paired");
  await client.query("update public.player_stats set level=5 where user_id=$1",[b]);
  await actor(b);
  receipt=(await one("select public.join_1v1_queue('casual') value")).value;
  check(receipt.status,"countdown","Two qualified Casual entrants pair");
  const match=receipt.match_id;
  await client.query("update public.multiplayer_matches set status='finished' where id=$1",[match]);
  check((await one("select app_private.award_completed_run_v2_live($1,999999,'casual_1v1') value",[match])).value.xp_awarded,0,"1v1 result awards no XP");
  await actor(c);
  receipt=(await one("select public.unlock_ranked_1v1() value")).value;
  check(receipt.ranked_unlocked,true,"Previously paid Ranked remains playable at reset level zero");
  check(receipt.total_gems,5000,"Retained Ranked purchase is never charged twice");
  check((await one("select public.join_1v1_queue('ranked') value")).value.status,"waiting","Retained Ranked owner may queue");
  await actor(a);
  await client.query("update public.player_stats set level=24,total_gems=100 where user_id=$1",[a]);
  await expectError("select public.unlock_ranked_1v1()",[],/Ranked requires level 25/);
  await client.query("update public.player_stats set level=25,total_gems=99 where user_id=$1",[a]);
  await expectError("select public.unlock_ranked_1v1()",[],/You need 100 Gems/);
  await client.query("update public.player_stats set total_gems=100 where user_id=$1",[a]);
  check((await one("select public.unlock_ranked_1v1() value")).value.total_gems,0,"New Ranked costs final 100 Gems");
  check((await one("select public.unlock_ranked_1v1() value")).value.total_gems,0,"Repeat Ranked unlock costs zero");
  await client.query("update public.player_stats set level=14,total_gems=225 where user_id=$1",[a]);
  await expectError("select public.unlock_photon_fury()",[],/Requires level 15/);
  await client.query("update public.player_stats set level=15,total_gems=224 where user_id=$1",[a]);
  await expectError("select public.unlock_photon_fury()",[],/You need 225 Gems/);
  await client.query("update public.player_stats set total_gems=225 where user_id=$1",[a]);
  check((await one("select public.unlock_photon_fury() value")).value.total_gems,0,"New Photon costs 225 Gems");
  await client.query("update public.player_stats set level=0 where user_id=$1",[a]);
  check((await one("select public.unlock_photon_fury() value")).value.total_gems,0,"Paid Photon survives level reset without another fee");

  const rarities=["common","uncommon","rare","epic","legendary","mythic"],types=["character","player","obstacle","environment"];
  for(const rarity of rarities) for(const type of types) await client.query("insert into public.extraction_catalog(item_key,display_name,item_type,rarity,character_class) values($1,$1,$2,$3,$4)",[`${type}_${rarity}`,type,rarity,type==="character"?"runner":null]);
  for(const starter of ["runner_ace","medic_patch","tank_bulwark","trickster_rogue"]) await client.query("insert into public.extraction_catalog(item_key,display_name,item_type,rarity,character_class) values($1,$1,'character','common','runner')",[starter]);
  await client.query(`create table auth.fixture_signups(id uuid primary key);
    create function public.provision_player_starters() returns trigger language plpgsql security definer set search_path='' as $$
    begin
      insert into public.player_unlocks(user_id,item_key,item_type,rarity)
      select new.id,k,t,r from(values
        ('runner_ace','character','common'),('medic_patch','character','common'),
        ('tank_bulwark','character','common'),('trickster_rogue','character','common')
      )s(k,t,r) on conflict(user_id,item_key) do nothing;
      return new;
    end$$;
    create trigger fixture_starters after insert on auth.fixture_signups for each row execute function public.provision_player_starters();`);
  await migration("qol-extraction.sql");
  check(Number((await one("select count(*) n from public.extraction_catalog where rarity='default' and not extractable")).n),4,"Starters excluded from all paid pools");
  const futureUser=randomUUID();
  await client.query("insert into auth.fixture_signups values($1)",[futureUser]);
  check((await one("select array_agg(rarity order by item_key) rarities from public.player_unlocks where user_id=$1",[futureUser])).rarities,["default","default","default","default"],"Future provisioned starters retain Default rarity");
  for(const [profile,percent,weights] of [
    ["normal",7,[42,32,15,9,2,0]],["bonus",13,[32,27,17,14,10,0]],
    ["rare",18,[27,24,19,16,14,0]],["legendary",20,[22,21,20,19,17,1]],
  ]) {
    check(await one("select * from app_private.booster_pull_rules($1)",[profile]),{character_percent:percent,weights},"Exact SQL profile odds");
    check(Number((await one("select count(*) n from generate_series(0,99) i cross join lateral app_private.booster_roll($1,(i+.5)/100,.5) r where r.category='character'",[profile])).n),percent,"SQL category roll thresholds");
    const rows=(await client.query("select r.rarity,count(*)::integer n from generate_series(0,99) i cross join lateral app_private.booster_roll($1,.5,(i+.5)/100) r group by r.rarity",[profile])).rows;
    check(rarities.map(r=>rows.find(row=>row.rarity===r)?.n??0),weights,"SQL rarity roll thresholds");
  }
  for(const [index,rarity] of rarities.entries()) for(const [level,multiplier] of [[0,1],[19,1],[20,1.5],[39,1.5],[40,2]]) {
    for(const type of ["character","player"]) check((await one("select app_private.duplicate_stardust($1,$2,$3) value",[rarity,type,level])).value,[10,12,16,24,38,60][index]*multiplier*(type==="character"?4:1),"SQL Stardust rarity/type/level boundary");
  }
  await client.query("insert into public.player_unlocks(user_id,item_key,item_type,rarity) select $1,item_key,item_type,rarity from public.extraction_catalog",[a]);
  await client.query("update public.player_stats set level=0,total_gems=5000 where user_id=$1",[a]);
  const otherBefore=(await one("select to_jsonb(s) value from public.player_stats s where user_id=$1",[b])).value;
  await actor(a);
  receipt=(await one("select public.extract_items(99,'normal') value")).value;
  check(receipt.cost,1089,"99 boxes cost exactly 99 times price");
  check(receipt.gems,3911,"Duplicate rewards never refund Gems");
  check(receipt.results.length,990,"99 normal boxes contain 990 pulls");
  const base={common:10,uncommon:12,rare:16,epic:24,legendary:38,mythic:60};
  const dust=receipt.results.reduce((sum,r)=>sum+base[r.rarity]*(r.item_type==="character"?4:1),0);
  check(receipt.stardust_awarded,dust,"Duplicate Stardust totals exact");
  check(receipt.stardust,dust,"Duplicate Stardust deposited atomically");
  check(receipt.results.every(r=>!r.is_new&&r.duplicate_refund===0&&r.rarity!=="default"),true,"Defaults and duplicate Gem refunds excluded");
  for(const qty of [0,-1,100,null]) await expectError("select public.extract_items($1,'normal')",[qty],/Choose 1 to 99 boxes/);
  await expectError("select public.extract_items(1,'rare')",[],/Rare Box requires level 10/);
  await client.query("update public.player_stats set level=19 where user_id=$1",[a]);
  await expectError("select public.extract_items(1,'legendary')",[],/Legendary Box requires level 20/);
  for(const level of [20,40]) {
    await client.query("update public.player_stats set level=$2 where user_id=$1",[a,level]);
    receipt=(await one("select public.extract_items(1,'legendary') value")).value;
    check(receipt.stardust_awarded,receipt.results.reduce((sum,r)=>sum+base[r.rarity]*(r.item_type==="character"?4:1)*(level===20?1.5:2),0),`Level ${level} duplicate multiplier exact`);
  }
  await client.query("savepoint empty_pool");
  await client.query("update public.extraction_catalog set active=false");
  const wallet=(await one("select total_gems,stardust from public.player_stats where user_id=$1",[a]));
  await expectError("select public.extract_items(1,'normal')",[],/Missing .* catalog pool/);
  check(await one("select total_gems,stardust from public.player_stats where user_id=$1",[a]),wallet,"Missing catalog cannot charge or partially reward");
  await client.query("rollback to savepoint empty_pool");
  const cosmeticCosts=[24,32,48,80,360,3200];
  for(let index=0;index<rarities.length;index++) for(const type of types) {
    const key=`${type}_${rarities[index]}`,cost=cosmeticCosts[index]*(type==="character"?5:1);
    await client.query("delete from public.player_unlocks where user_id=$1 and item_key=$2",[a,key]);
    await client.query("update public.player_stats set level=0,total_gems=123,stardust=$2 where user_id=$1",[a,cost-1]);
    await expectError("select public.purchase_catalog_item($1)",[key],/Not enough Stardust/);
    await client.query("update public.player_stats set stardust=$2 where user_id=$1",[a,cost]);
    receipt=(await one("select public.purchase_catalog_item($1) value",[key])).value;
    check([receipt.cost,receipt.stardust,receipt.gems,receipt.currency],[cost,0,123,"stardust"],"Exact Stardust price, no level gate, Gems unchanged");
    receipt=(await one("select public.purchase_catalog_item($1) value",[key])).value;
    check([receipt.cost,receipt.already_owned,receipt.stardust],[0,true,0],"Repeated direct purchase does not charge twice");
  }
  await expectError("select public.purchase_catalog_item('runner_ace')",[],/Item is not available/);
  check((await one("select to_jsonb(s) value from public.player_stats s where user_id=$1",[b])).value,otherBefore,"Other account isolated");
  await actor(null);
  await expectError("select public.extract_items(1,'normal')",[],/Sign in required/);
  await expectError("select public.purchase_catalog_item('player_common')",[],/Sign in required/);
  await expectError("select public.get_player_progression()",[],/Sign in required/);
  check(await one(`select has_function_privilege('anon','public.extract_items(integer,text)','execute') guest,
    has_function_privilege('authenticated','public.extract_items(integer,text)','execute') signed,
    has_function_privilege('authenticated','app_private.apply_player_xp(uuid,bigint,boolean)','execute') private_xp,
    has_function_privilege('authenticated','app_private.duplicate_stardust(text,text,integer)','execute') private_dust`),
    {guest:false,signed:true,private_xp:false,private_dust:false},"Narrow RPC permissions only");
  await client.query("rollback");
  check(Number((await one("select count(*) n from pg_tables where schemaname='public'")).n),0,"All synthetic schema, player, balance, and receipt writes rolled back");
  console.log(JSON.stringify({passed:true,assertions,productionConnected:false,realAccountsUsed:false,rolledBack:true}));
} finally {
  await client.query("rollback").catch(()=>{});
  await client.end();
}
