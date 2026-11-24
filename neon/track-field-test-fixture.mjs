import fs from 'node:fs';
import assert from 'node:assert/strict';
import {sixClassFixture}from './six-class-test-fixture.mjs';
const dir=process.env.SKYWAY_TEST_TRACK_ARTIFACTS;
assert(dir?.endsWith('/outputs/skyway-track-field-20261123'));
const read=name=>JSON.parse(fs.readFileSync(`${dir}/${name}`,'utf8'));
const metadata=JSON.parse(read('installed-metadata.json').content[0].text)[1][0].metadata;
export const functions=[...read('all-functions.json'),...read('final-helper-metadata.json').structuredContent.data[1].rows];
export const functionBody=name=>functions.find(f=>f.signature.split('(')[0].split('.').at(-1)===name)?.definition;
export async function trackFieldFixture(){
 const db=await sixClassFixture();
 const tableKeys={mastery_sessions:['id'],mastery_heal_tokens:['match_id','user_id','event_id'],player_mastery_quests:['user_id','character_key'],player_mastery_preferences:['user_id'],photon_race_entitlements:['user_id'],photon_race_matches:['id'],photon_unlocks:['user_id','item_key'],ranked_1v1_seasons:['id'],ranked_1v1_results:['season_id','match_id'],player_ranked_1v1_stats:['season_id','user_id'],six_class_runs:['run_id'],progression_resets:['user_id']};
 const groups=Map.groupBy(metadata.columns,c=>`${c.table_schema}.${c.table_name}`);
 for(const [name,columns]of groups){
  const present=(await db.query('select to_regclass($1)as id',[name])).rows[0].id;
  const definitions=columns.sort((a,b)=>a.ordinal_position-b.ordinal_position).map(c=>{
   const type=c.data_type==='ARRAY'?c.udt_name.slice(1)+'[]':c.data_type==='USER-DEFINED'?`${c.udt_schema}.${c.udt_name}`:c.data_type;
   const value=c.column_default&&!c.column_default.includes('nextval(')?' default '+c.column_default:'';
   return `"${c.column_name}" ${type}${value}${c.is_nullable==='NO'?' not null':''}`;
  });
  if(!present){const candidate=tableKeys[columns[0].table_name];const keys=candidate?.every(k=>columns.some(c=>c.column_name===k))?candidate:null;await db.exec(`create table ${name}(${definitions.join(',')}${keys?',primary key('+keys.join(',')+')':''})`);}
  else for(const def of definitions)await db.exec(`alter table ${name} add column if not exists ${def}`);
 }
 await db.exec(`create schema neon_auth;create table neon_auth."user"(id uuid primary key,banned boolean,"banExpires"timestamptz,email text);
 create function auth.jwt()returns jsonb language sql as $$select coalesce(nullif(current_setting('test.claims',true),''),'{}')::jsonb$$;
 create table app_private.mode_unlock_entitlements(user_id uuid,mode text,primary key(user_id,mode));
 create table public.player_endless_gem_streaks(run_id uuid primary key,user_id uuid,wave integer,streak bigint,updated_at timestamptz);
 create table app_private.photon_box_receipts(user_id uuid,nonce uuid,result jsonb,created_at timestamptz,primary key(user_id,nonce));
 create function app_private.is_test_run_context(r uuid,u uuid)returns boolean language sql as $$select exists(select 1 from public.player_progression_runs where run_id=r and user_id=u and test_mode)$$;
 create function public.is_main_admin()returns boolean language sql as $$select false$$;
 insert into neon_auth."user"(id,email)values('11111111-1111-4111-8111-111111111111','synthetic@example.invalid'),('22222222-2222-4222-8222-222222222222','other@example.invalid');
 select set_config('test.uid','11111111-1111-4111-8111-111111111111',false);
 select set_config('test.claims','{"sub":"11111111-1111-4111-8111-111111111111","iss":"https://ep-tiny-tooth-ax0800jo.neonauth.c-4.us-east-2.aws.neon.tech"}',false);`);
 const names=['endless_verified_gem_xp','photon_weapon_rules','photon_weapon_compatible','photon_user','photon_weighted_pick','photon_character_rules','photon_qol_catalog_pre_20261017','photon_qol_catalog','photon_skin_pick','open_photon_box','booster_box_rules','pixel_native_admission','pixel_runtime_admitted','require_pixel_runtime','xp_required_for_level','cumulative_xp_for_level','level_for_lifetime_xp','retain_level_mode_unlocks','has_level_mode_unlocked','unlimited_1v1_requirements','apply_player_xp','get_player_progression','start_progression_run','get_mastery_profile','mastery_price','mastery_target','mastery_owns_character','get_mastery_smoke_effect','begin_mastery_session','credit_mastery_events','finish_mastery_trial','bind_six_class_run_v1','record_six_class_run_v1','finish_six_class_run_v1','endless_run_xp_breakdown','endless_gem_streak_award','claim_player_gem_before_mastery_flairs','claim_player_gem_live','claim_player_gem_before_six_class','claim_player_gem','reset_endless_gem_streak','award_completed_run_v2_live','award_completed_run_v2','unlock_photon_race'];
 let pending=names.map(n=>({name:n,definition:functionBody(n)}));for(const p of pending)assert(p.definition,p.name);
 // SQL-language declarations can depend on declarations later in the list.
 for(let pass=0;pending.length;pass++){
  const failed=[];for(const p of pending)try{await db.exec(p.definition);}catch(error){failed.push({...p,error});}
  if(failed.length===pending.length)throw Error(failed.map(p=>`${p.name}: ${p.error.message}`).join('\n'));
  pending=failed;assert(pass<10);
 }
 const constraints=read('reset-constraint-correction.json').structuredContent.data[1].rows;
 for(const c of constraints)await db.exec(`alter table ${c.schema_name}.${c.table_name}add constraint ${c.conname} ${c.definition}`.replace('statsadd','stats add').replace('seasonsadd','seasons add'));
 const trigger=fs.readFileSync(new URL('./six-class-06-run-rewards.sql',import.meta.url),'utf8').match(/create or replace function app_private\.six_class_start_run\(\)[\s\S]*?end \$\$;/)[0];
 await db.exec(trigger);await db.exec('create trigger six_class_start_run after insert on public.player_progression_runs for each row execute function app_private.six_class_start_run()');
 const admin=read('ranked-and-admin-metadata.json').structuredContent.data[1].rows.find(f=>f.signature.startsWith('app_private.admin_player_command_v23_core('));await db.exec(admin.definition);
 return db;
}
