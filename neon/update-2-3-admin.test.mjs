/** Isolated local PostgreSQL only. Never accepts a URI or a production database. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Client } from 'pg';
import { readUpdateSnapshot } from '../scripts/update-2-3-snapshot.mjs';
const socket=process.env.ADMIN_TEST_PG_SOCKET;
if(!socket?.startsWith('/private/tmp/skyway-admin-23.') || process.env.ADMIN_TEST_PG_DATABASE!=='admin_fixture') throw new Error('Use the isolated admin_fixture Unix-socket cluster only.');
const db=new Client({host:socket,port:55443,user:process.env.USER,database:'admin_fixture'});
let assertions=0;
const q=(s,p)=>db.query(s,p);
const one=async(s,p)=>Object.values((await q(s,p)).rows[0])[0];
const check=(actual,expected)=>{assert.deepEqual(actual,expected);assertions++;};
const admin='00000000-0000-4000-8000-000000000001',coadmin='00000000-0000-4000-8000-000000000002',player='00000000-0000-4000-8000-000000000003',locked='00000000-0000-4000-8000-000000000004';
const snapshot=readUpdateSnapshot(process.env.ADMIN_TEST_INSTALLED_SNAPSHOT);
const command=(action,target=player,kind=null,name=null,stat=null,value=null)=>one('select public.admin_player_command_v23($1,$2,$3,$4,$5,$6)',[action,target,kind,name,stat,value]);
const reject=async(sql,args,pattern)=>{await q('savepoint denied');let caught=false;try{await q(sql,args);}catch(e){caught=true;assert.match(e.message,pattern);}await q('rollback to savepoint denied');await q('release savepoint denied');assert.ok(caught);assertions++;};
try{
 await db.connect();check(await one('select current_database()'),'admin_fixture');await q('begin');
 await q(`create schema auth;create schema neon_auth;create schema app_private;
  create role authenticated;create role anon;create role anonymous;
  create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('admin.test_uid',true),'')::uuid$$;
  create function public.is_admin() returns boolean language sql stable as $$select auth.uid() in('${admin}'::uuid,'${coadmin}'::uuid)$$;
  create function public.is_main_admin() returns boolean language sql stable as $$select auth.uid()='${admin}'::uuid$$;
  create table neon_auth."user"(id uuid primary key,email text not null);
  create table public.player_stats(user_id uuid primary key,total_gems bigint default 50,high_score bigint default 700,stardust bigint default 20,updated_at timestamptz default now());
  create table public.player_photon_fury(user_id uuid primary key references public.player_stats,photons bigint default 50,unlocked_at timestamptz,selected_character_key text default 'photon_magician',selected_theme_key text default 'default',skin_choices jsonb default '{}');
  create table public.player_unlocks(user_id uuid,item_key text,item_type text,primary key(user_id,item_key));
  create table app_private.photon_unlocks(user_id uuid,item_key text,kind text,primary key(user_id,item_key));
  create table public.player_reports(id bigint generated always as identity primary key,user_id uuid,report_type text,message text,status text default 'new');
  alter table public.player_reports enable row level security;
  create policy own_reports on public.player_reports for insert to authenticated with check(user_id=auth.uid());
  grant usage on schema auth to authenticated;grant insert(user_id,report_type,message) on public.player_reports to authenticated;grant usage on sequence public.player_reports_id_seq to authenticated;
  create table public.admin_command_audit(id bigint generated always as identity primary key,actor_user_id uuid,actor_email text,target_user_id uuid,action text,command_text text,request jsonb,result jsonb,succeeded boolean,error_message text);
  create function app_private.photon_qol_catalog() returns table(item_key text,display_name text,kind text,character_key text,rarity text) language sql immutable set search_path='' as $$
    select k,n,'character',k,null from(values('photon_magician','Magician'),('photon_wizard','Wizard'),('photon_bluff','Bluff'),('photon_bell','Bell'),('photon_burner','Burner'))c(k,n)
    union all select 'photon_burner_'||t,'Burner '||t,'skin','photon_burner',t from(values('intermediate'),('pro'),('ascendant'),('divine'),('immortal'))s(t)
    union all select 'photon_theme_cobalt','Cobalt Circuit','theme',null,'common' $$;
  create function app_private.intercept_in_game_player_command(text,uuid,text,jsonb default '{}') returns jsonb language plpgsql security definer set search_path='' as $$begin
    if coalesce(current_setting('admin.active_game',true),'')='true' then return jsonb_build_object('ok',false,'error','Existing active-game command guard');end if;
    return null;end$$;
 `);
 // Clone the actual current wrapper/core. The interception helper is a local
 // fixture only; production's real auto-ban helper is preserved, never replaced.
 for(const name of ['admin_execute_player_command_core','admin_execute_player_command']) await q(snapshot.functions.find(f=>f.name===name).definition);
 await q(`
  revoke all on function public.admin_execute_player_command(text,uuid,text,text,text,bigint,text[],uuid,bigint,boolean,bigint,text,text) from public;
  grant execute on function public.admin_execute_player_command(text,uuid,text,text,text,bigint,text[],uuid,bigint,boolean,bigint,text,text) to authenticated;
 `);
 for(const u of [admin,coadmin,player,locked]){await q('insert into neon_auth."user" values($1,$2)',[u,u+'@example.invalid']);await q('insert into public.player_stats(user_id) values($1)',[u]);await q('insert into public.player_photon_fury(user_id,unlocked_at) values($1,case when $1::uuid=$2::uuid then null else now() end)',[u,locked]);}
 const source=readFileSync(new URL('./update-2-3-admin.sql',import.meta.url),'utf8').replace(/^begin;\s*$/mi,'').replace(/^commit;\s*$/mi,'');
 await q(source);await q(source);check(await one('select count(*)::int from public.admin_command_audit'),0);check(await one('select count(*)::int from app_private.player_report_permissions'),0);
 await q("select set_config('admin.test_uid',$1,true)",[admin]);await q('set local role authenticated');
 check((await command('check',player,null,null,'gems')).value,50);check((await command('check',locked,null,null,'photons')).value,null);
 check((await command('set',locked,null,null,'photons',999)).noop,true);check((await command('set',player,null,null,'photons',999)).value,999);
 check((await command('set',player,null,null,'stardust',123)).value,123);
 for(const amount of [-1,1000000001])check((await command('set',player,null,null,'photons',amount)).ok,false);
 check((await command('set',player,null,null,'coins',100)).ok,false);
 check((await command('rpta')).changed,false);check((await command('rptb')).changed,true);check((await command('rptb')).changed,false);
 await q('reset role');await q("select set_config('admin.test_uid',$1,true)",[player]);await q('set local role authenticated');
 check(await one('select public.get_my_report_permission()'),false);
 await reject("insert into public.player_reports(user_id,report_type,message) values($1,'Bug','Synthetic report')",[player],/not allowed/);
 await q('reset role');await q("select set_config('admin.test_uid',$1,true)",[admin]);await q('set local role authenticated');check((await command('rpta')).changed,true);
 for(const name of ['Magician','Wizard','Bluff','Bell'])for(const action of ['photon_grant','photon_revoke'])check((await command(action,player,'photon_character',name)).ok,false);
 check((await command('photon_grant',locked,'photon_character','Burner')).noop,true);
 const granted=await command('photon_grant',player,'photon_character','Burner');assert.equal(granted.ok,true,JSON.stringify(granted));check(granted.changed,true);check((await command('photon_grant',player,'photon_character','Burner')).changed,false);
 for(const tier of ['intermediate','pro','ascendant','divine','immortal'])check((await command('photon_grant',player,'photon_skin',tier,'Burner')).changed,true);
 check((await command('photon_grant',player,'photon_theme','Cobalt Circuit')).changed,true);
 check((await command('photon_grant',player,'photon_theme','Unknown')).ok,false);check((await command('photon_grant',player,'photon_skin','default','Burner')).ok,false);
 check((await command('photon_revoke',player,'photon_character','Burner')).changed,true);
 for(const key of ['runner_ace','medic_patch','tank_bulwark','trickster_rogue'])for(const action of ['grant','revoke'])check(await one('select public.admin_execute_player_command($1,$2,\'character\',$3)',[action,player,key]).then(r=>r.ok),false);
 check((await one("select public.admin_execute_player_command('bann',$1)",[player])).ok,false);
 await q('reset role');await q("select set_config('admin.active_game','true',true)");await q('set local role authenticated');check((await command('set',player,null,null,'stardust',7)).ok,false);
 await q('reset role');await q("select set_config('admin.active_game','',true)");
 await q("insert into public.player_reports(user_id,report_type,message,status) values($1,'Bug','Synthetic local active','new'),($1,'Bug','Synthetic local archived','closed')",[player]);await q('set local role authenticated');check((await command('rptc',null)).cleared_count,1);
 await q('reset role');check(await one('select count(*)::int from public.player_reports where status=\'closed\''),1);
 for(const u of [coadmin,player,'']){await q("select set_config('admin.test_uid',$1,true)",[u]);await q('set local role authenticated');await reject("select public.admin_player_command_v23('set',$1,null,null,'stardust',100)",[player],/Only main admins/);await q('reset role');}
 check(await one("select has_function_privilege('anon','public.admin_player_command_v23(text,uuid,text,text,text,bigint,text[],uuid,bigint,boolean,bigint,text,text)','EXECUTE')"),false);
 check(await one("select has_function_privilege('authenticated','app_private.admin_player_command_v23_core(text,uuid,text,text,text,bigint,text[],uuid,bigint,boolean,bigint,text,text)','EXECUTE')"),false);
 check(await one("select has_table_privilege('authenticated','app_private.player_report_permissions','SELECT,INSERT,UPDATE,DELETE')"),false);
 check(Number(await one('select total_gems from public.player_stats where user_id=$1',[player])),50);check(Number(await one('select stardust from public.player_stats where user_id=$1',[player])),123);check(Number(await one('select photons from public.player_photon_fury where user_id=$1',[locked])),50);
 console.log(JSON.stringify({ok:true,assertions,localOnly:true,rolledBack:true,liveSessionProof:false}));
}finally{await db.query('rollback').catch(()=>{});await db.end();}
