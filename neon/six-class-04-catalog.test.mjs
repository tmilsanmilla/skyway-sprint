import assert from "node:assert/strict";
import fs from "node:fs";
import {pathToFileURL} from "node:url";
import {OVERHAUL_CHARACTERS} from "../app/overhaul-catalog.ts";
const artifacts=process.env.SKYWAY_TEST_ARTIFACTS;
assert.ok(artifacts?.endsWith("/outputs/skyway-six-class-overhaul-20261121"));
const file=name=>JSON.parse(fs.readFileSync(`${artifacts}/${name}`,"utf8"));
const decode=name=>{const d=file(name);return d.content?JSON.parse(d.content[0].text):d;};
const metadata=decode("game-installed-metadata.json"),tables=metadata[1][0].tables;
const functions=decode("game-core-functions.json")[1];
const {PGlite}=await import(pathToFileURL(process.env.SKYWAY_TEST_PGLITE_MODULE).href),db=new PGlite();
let checks=0;const eq=(a,b)=>{assert.deepEqual(a,b);checks++;};
const v=async(sql,args)=>Object.values((await db.query(sql,args)).rows[0])[0];
const u="11111111-1111-4111-8111-111111111111",x="22222222-2222-4222-8222-222222222222";
try{
 await db.exec(`create schema app_private;create schema auth;create role anon;create role anonymous;create role authenticated;
 create function auth.uid()returns uuid language sql as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
 create function app_private.require_pixel_runtime()returns void language plpgsql as $$begin if current_setting('test.runtime',true)='off'then raise exception 'Runtime closed';end if;end$$;
 create function app_private.is_admin_test_user(uuid)returns boolean language sql as $$select false$$;
 create function app_private.has_active_ban(uuid,text,text)returns boolean language sql as $$select false$$;
 create table app_private.match_setup_19(match_id uuid primary key,phase text,deadline timestamptz,rng_rarity text);
 create table app_private.ruins_character_bans(match_id uuid,character_key text);
 create table app_private.ranked_requalification(user_id uuid primary key,qualified boolean);
 `);
 for(const table of tables){
  const columns=table.columns.map(c=>`"${c.name}" ${c.type}${c.default&&!c.default.includes('nextval(')?' default '+c.default:''}${c.notnull?' not null':''}`);
  const keys=table.constraints.filter(c=>c.startsWith("PRIMARY KEY")||c.startsWith("UNIQUE"));
  await db.exec(`create table ${table.schema}.${table.table}(${[...columns,...keys].join(',')})`);
 }
 for(const c of file("game-constraints.json"))await db.exec(`alter table ${c.schema}.${c.table_name} add constraint ${c.name} ${c.definition}`);
 const targets=new Set(file("catalog-patch-manifest.json").map(f=>f.function.split('(')[0]));
 for(const f of functions)if(targets.has(f.schema+'.'+f.name))await db.exec(f.definition);
 await db.exec(fs.readFileSync(`${artifacts}/public.join_1v1_queue.sql`,"utf8"));
 await db.exec(`create function public.get_1v1_state(uuid)returns jsonb language sql as $$select '{}'::jsonb$$;
 insert into public.extraction_catalog(item_key,display_name,item_type,rarity,character_class,extractable,active,weapon_name,weapon_score_bonus)values
 ('runner_ace','Ace','character','default','runner',false,true,'Momentum',0),
 ('misc_nomad','Nomad','character','rare','misc',true,true,'Old weapon',0),
 ('runner_comet','Comet','character','mythic','runner',true,true,'Old weapon',0);
 insert into public.player_loadouts(user_id,character_key,class_key)values('${u}','runner_comet','runner');
 insert into public.player_unlocks(user_id,item_key,item_type,rarity)values('${u}','runner_comet','character','mythic'),('${u}','misc_nomad','character','rare');
 insert into public.player_stats(user_id,total_gems,stardust,level)values('${u}',987,654,50),('${x}',123,456,50);
 insert into public.player_photon_fury(user_id,unlocked_at,photons)values('${u}',clock_timestamp(),1100);
 insert into app_private.ranked_requalification values('${u}',true);
 insert into app_private.one_v_one_map_rules(map_key,sort_order,display_name,lane_count,obstacle_scaling,healing_enabled,coin_point_reward,wave_point_reward,allowed_attacks,allowed_character_classes,natural_spawn_weights,gameplay_rules)
 values('classic',0,'Classic',5,1,true,1,1,'{}',array['runner','medic','tank','trickster','misc'],'{}','{}'),
 ('desert',1,'Desert',5,1,false,1,1,'{}',array['runner','medic','tank','trickster','misc'],'{}','{}');
 `);
 const sql=fs.readFileSync(new URL("./six-class-04-catalog.sql",import.meta.url),"utf8");await db.exec(sql);checks++;await db.exec(sql);checks++;
 eq(Number(await v("select count(*)::int from app_private.six_class_catalog")),132);
 eq(Number(await v("select count(*)::int from public.extraction_catalog where item_type='character'and active")),132);
 eq(Number(await v("select count(*)::int from public.player_unlocks")),2);
 eq(await v("select character_key from public.player_loadouts where user_id=$1",[u]),"runner_comet");
 eq(Number(await v("select total_gems from public.player_stats where user_id=$1",[u])),987);
 eq(Number(await v("select stardust from public.player_stats where user_id=$1",[x])),456);
 eq(await v("select active from public.extraction_catalog where item_key='misc_nomad'"),false);
 eq(await v("select 'chaotic'=any(allowed_character_classes)from app_private.one_v_one_map_rules where map_key='classic'"),true);
 eq(await v("select 'chaotic'=any(allowed_character_classes)from app_private.one_v_one_map_rules where map_key='desert'"),false);
 await v("select set_config('test.uid',$1,false)",[u]);
 await v("select public.set_loadout('character','chaotic_particle')");eq(await v("select class_key from public.player_loadouts where user_id=$1",[u]),"chaotic");
 await v("select public.set_loadout('class','medic')");eq(await v("select character_key from public.player_loadouts where user_id=$1",[u]),"medic_patch");
 await assert.rejects(v("select public.set_loadout('character','runner_zenith')"),/not unlocked/);checks++;
 for(const c of OVERHAUL_CHARACTERS){
  const rows=(await db.query("select *from app_private.character_selection_snapshot($1,'classic',$2)",[u,c.key])).rows[0];
  eq(rows.character_key,c.key);eq(rows.character_class,c.classKey);eq(Number(rows.starting_hearts),c.startingHp);eq(Number(rows.max_hearts),c.maxHp);
 }
 for(const c of OVERHAUL_CHARACTERS.filter(c=>!c.starter))await db.query("insert into public.player_unlocks(user_id,item_key,item_type,rarity)values($1,$2,'character',$3)on conflict do nothing",[u,c.key,c.rarity]);
 const unlocked=await v("select app_private.unlimited_1v1_requirements($1)",[u]);eq(unlocked.low_tier_required,96);eq(unlocked.legendary_required,21);eq(unlocked.mythic_required,5);eq(unlocked.low_tier_owned,96);eq(unlocked.unlocked,true);
 eq(Number(await v("select bonus_point_seconds from app_private.photon_character_rules('photon_magician')")),40);
 eq(await v("select has_table_privilege('authenticated','app_private.six_class_catalog','UPDATE')"),false);
 eq(await v("select has_function_privilege('authenticated','app_private.owns_six_class_character(uuid,text)','EXECUTE')"),false);
 await v("select set_config('test.runtime','off',false)");await assert.rejects(v("select public.set_loadout('character','runner_ace')"),/Runtime closed/);checks++;
 console.log(`PASS ${checks} six-class catalog WASM/source-pair checks; native/hosted/account cases 0`);
}finally{await db.close();}
