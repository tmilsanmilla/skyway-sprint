/** Disposable local PostgreSQL only. Never consumes DATABASE_URL or remote credentials. */
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { readUpdateSnapshot } from './update-2-3-snapshot.mjs';
const bin=process.env.MASTERY_TEST_PG_BIN || '/opt/homebrew/opt/postgresql@17/bin';
const root=realpathSync(resolve(import.meta.dirname,'..'));
const dir=mkdtempSync(join(tmpdir(),'skyway-mastery-pg-'));
const data=join(dir,'data'), socket=join(dir,'socket');mkdirSync(socket);
let started=false;
const localEnv={...process.env};for(const k of Object.keys(localEnv))if(k.startsWith('PG')||k.includes('DATABASE_URL'))delete localEnv[k];
Object.assign(localEnv,{PGHOST:socket,PGPORT:'55432',PGDATABASE:'postgres',PGUSER:process.env.USER,PGSSLMODE:'disable'});
const run=(program,args,input)=>{const p=spawnSync(join(bin,program),args,{encoding:'utf8',input,env:localEnv,maxBuffer:8*1024*1024});if(p.status!==0)throw new Error(`${program} failed: ${p.stderr||p.stdout||p.error}`);return p.stdout;};
const sql=input=>run('psql',['-X','-h',socket,'-p','55432','-v','ON_ERROR_STOP=1','-q'],"select set_config('skyway.local_mastery_fixture','skyway-mastery-disposable-v1',false);\n"+input);
try {
 run('initdb',['-D',data,'-A','trust','--no-locale','-E','UTF8']);
 run('pg_ctl',['-D',data,'-l',join(dir,'postgres.log'),'-o',`-k ${socket} -h '' -p 55432`,'-w','start']);started=true;
 run('createdb',['-h',socket,'-p','55432','skyway_mastery_fixture']);localEnv.PGDATABASE='skyway_mastery_fixture';
 sql(`create schema auth;create schema app_private;
 create table app_private.local_test_fixture_marker(marker text primary key);
 insert into app_private.local_test_fixture_marker values('skyway-mastery-disposable-v1');
 create role anon;create role anonymous;create role authenticated;
 create function auth.uid()returns uuid language sql as $$select nullif(current_setting('skyway.test_uid',true),'')::uuid$$;
 create table public.player_stats(user_id uuid primary key,total_gems bigint not null default 0,high_score bigint not null default 0,updated_at timestamptz default now());
 create table public.player_photon_fury(user_id uuid primary key references public.player_stats,unlocked_at timestamptz,photons bigint not null default 0);
 create table public.player_unlocks(user_id uuid references public.player_stats,item_key text,item_type text,rarity text,ownership_proven_at timestamptz,primary key(user_id,item_key));
 create table public.extraction_catalog(item_key text primary key,item_type text,active boolean default true,rarity text,weapon_score_bonus numeric);
 create table public.player_loadouts(user_id uuid primary key references public.player_stats,character_key text default 'runner_ace');
 create table public.player_progression_runs(run_id uuid primary key default gen_random_uuid(),user_id uuid references public.player_stats,started_at timestamptz default now(),active_seconds bigint default 0,completed_at timestamptz,test_mode boolean default false,heartbeat_active boolean default false,last_heartbeat_at timestamptz);
 create table public.multiplayer_matches(id uuid primary key,finished_at timestamptz);
 create table public.multiplayer_players(match_id uuid references public.multiplayer_matches,user_id uuid references public.player_stats,character_key text,test_mode boolean default false);
 create table public.player_progression_1v1_activity(match_id uuid,user_id uuid,active_seconds bigint,last_heartbeat_at timestamptz);
 create table public.player_progression_events(id uuid primary key default gen_random_uuid(),user_id uuid references public.player_stats,source text,source_key text,metadata jsonb,unique(user_id,source,source_key));
 create function app_private.has_active_ban(uuid,text,text)returns boolean language sql as $$select false$$;
 create function app_private.is_admin_test_user(uuid)returns boolean language sql as $$select false$$;
 create function app_private.photon_user()returns uuid language plpgsql security definer set search_path='' as $$declare u uuid:=auth.uid();begin if u is null then raise exception 'Sign in required';end if;return u;end$$;
 create function public.set_player_weapon(text)returns void language plpgsql as $$begin raise exception 'Removed';end$$;
 revoke all on function public.set_player_weapon(text)from public;
 create function public.claim_player_gem(p_context_id uuid,p_pickup_id text)returns jsonb language plpgsql security definer set search_path='' as $$
 declare u uuid:=auth.uid();n boolean;b bigint;
 begin
 if u is null then raise exception 'Sign in required';end if;
 insert into public.player_progression_events(user_id,source,source_key,metadata)values(u,'gem',p_context_id::text||':'||trim(p_pickup_id),jsonb_build_object('context_id',p_context_id,'gems_awarded',1))on conflict do nothing returning true into n;
 if coalesce(n,false)then update public.player_stats set total_gems=total_gems+1 where user_id=u;end if;
 select total_gems into b from public.player_stats where user_id=u;
 return jsonb_build_object('is_new',coalesce(n,false),'gems_awarded',1,'total_gems',b);
 end$$;
 insert into public.player_stats(user_id)values('11111111-1111-4111-8111-111111111111'),('22222222-2222-4222-8222-222222222222');
 insert into public.extraction_catalog(item_key,item_type,rarity)select k,'character','common' from unnest(array['runner_ace','runner_dash','runner_stride','medic_patch','medic_bloom','medic_remedy','medic_salve','tank_bulwark','runner_vault','tank_guard','trickster_rogue','trickster_smoke'])k;
 `);
 // Negative safety test: the same local server's ordinary postgres database
 // must refuse before any fixture/table/function access. Never a remote test.
 const guardedTest=readFileSync(join(root,process.argv.includes('--gem-streak')?'neon/update-2-3-gem-streak.test.sql':'neon/update-2-3-masteries.test.sql'),'utf8');
 localEnv.PGDATABASE='postgres';let refused=false;
 try{sql(guardedTest);}catch(error){if(!String(error).includes('LOCAL-ONLY'))throw error;refused=true;}
 finally{localEnv.PGDATABASE='skyway_mastery_fixture';}
 if(!refused)throw new Error('Local-only guard failed to reject a nonfixture database');
 if(process.argv.includes('--gem-streak')){
  // Only the three real installed function definitions are imported into this
  // empty local fixture. No connection metadata or account rows are imported.
  const snapshotOption=process.argv.indexOf('--installed-snapshot');
  const installed=readUpdateSnapshot(snapshotOption>=0?process.argv[snapshotOption+1]:resolve(root,'../../outputs/update-2-3-live-audit-20261019.json'));
  sql(`alter table public.player_progression_runs add column verified_wave integer not null default 1;
   alter table public.player_progression_events add column xp_awarded bigint not null default 0,add column created_at timestamptz not null default now();
   alter table public.multiplayer_matches add column status text,add column started_at timestamptz;
   alter table public.multiplayer_players add column status text;
   alter table public.player_progression_1v1_activity add column verified_wave integer,add column heartbeat_active boolean;
   create table public.multiplayer_point_events(match_id uuid,user_id uuid,created_at timestamptz default now());
   create table public.player_endless_gem_streaks(run_id uuid primary key,user_id uuid,wave integer,streak bigint,updated_at timestamptz);
   create function public.get_player_progression()returns jsonb language sql as $$select '{}'::jsonb$$;
   create function app_private.is_test_run_context(r uuid,u uuid)returns boolean language sql as $$select exists(select 1 from public.player_progression_runs where run_id=r and user_id=u and test_mode)$$;`);
  for(const [schema,name]of [['app_private','claim_player_gem_live'],['public','claim_player_gem'],['public','reset_endless_gem_streak']]){
   const f=installed.functions.find(f=>f.schema===schema&&f.name===name);if(!f)throw new Error('Installed function missing: '+schema+'.'+name);sql(f.definition);
  }
  sql(`revoke all on function app_private.claim_player_gem_live(uuid,text) from public,anon,anonymous,authenticated;
   revoke all on function public.claim_player_gem(uuid,text),public.reset_endless_gem_streak(uuid)from public,anon,anonymous;
   grant execute on function public.claim_player_gem(uuid,text),public.reset_endless_gem_streak(uuid)to authenticated;
   grant usage on schema auth to authenticated;grant execute on function auth.uid()to authenticated;`);
  const patch=readFileSync(join(root,'neon/update-2-3-gem-streak.sql'),'utf8');sql(patch);sql(patch);
  console.log(sql(readFileSync(join(root,'neon/update-2-3-gem-streak.test.sql'),'utf8')).trim());
  // Exercise the migration's explicitly supported historical public-wrapper
  // branch as a separate local fixture; current production has no such cap.
  sql(`create or replace function public.claim_player_gem(p_context_id uuid,p_pickup_id text)returns jsonb language plpgsql security definer set search_path='' as $$
   declare v_result jsonb;v_streak bigint;
   begin
    v_result:=app_private.claim_player_gem_live(p_context_id,p_pickup_id);
    v_streak:=least(12,greatest(1,coalesce((v_result->>'streak')::bigint,1)));
    return v_result||jsonb_build_object('streak',v_streak);
   end$$;`);
  sql(patch);
  sql(`begin;select set_config('skyway.test_uid','11111111-1111-4111-8111-111111111111',true);
   insert into public.player_progression_runs(run_id,user_id,active_seconds,verified_wave,last_heartbeat_at,heartbeat_active)
   values('33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111',300,2,clock_timestamp(),true);
   insert into public.player_endless_gem_streaks(run_id,user_id,wave,streak)values('33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111',1,20);
   do $$declare p jsonb;d text;begin
    d:=pg_get_functiondef('public.claim_player_gem(uuid,text)'::regprocedure);
    if position('least(12' in d)>0 then raise exception 'Legacy public cap remained';end if;
    p:=public.claim_player_gem('33333333-3333-4333-8333-333333333333','legacy-cap-regression');
    if (p->>'streak')::integer<>21 or (p->>'gems_awarded')::integer<>16 then raise exception 'Legacy wrapper still capped or wave-reset';end if;
   end$$;rollback;`);
  console.log('PASS: actual installed gem-function bodies patched/reapplied in isolated local PostgreSQL.');
  if(process.argv.includes('--actions')){
   sql(`alter table public.multiplayer_players add column if not exists hearts numeric not null default 3,add column if not exists max_hearts numeric not null default 3,add column if not exists wave integer not null default 1,add column if not exists last_seen_at timestamptz,add column if not exists updated_at timestamptz;
    alter table public.multiplayer_matches add column if not exists map_key text not null default 'classic';`);
   for(const name of ['masteries','smoke','guard']){
    const migration=readFileSync(join(root,`neon/update-2-3-${name}.sql`),'utf8');sql(migration);sql(migration);
   }
   const actual=readUpdateSnapshot(process.argv.includes('--installed-snapshot')?process.argv[process.argv.indexOf('--installed-snapshot')+1]:resolve(root,'../../outputs/update-2-3-live-audit-20261019.json'));
   sql(`alter table public.extraction_catalog add column if not exists character_class text;
    create table app_private.one_v_one_map_rules(map_key text primary key,allowed_character_classes text[],forced_character_key text,gameplay_rules jsonb);`);
   sql(actual.functions.find(f=>f.name==='character_selection_snapshot').definition);
   const health=readFileSync(join(root,'neon/update-2-3-health.sql'),'utf8');sql(health);sql(health);
   console.log(sql(readFileSync(join(root,'neon/update-2-3-mastery-actions.test.sql'),'utf8')).trim());
  }
 }else{
 const migration=readFileSync(join(root,'neon/update-2-3-masteries.sql'),'utf8');
 sql(migration);sql(migration); // idempotent additive reapplication
 const result=sql(readFileSync(join(root,'neon/update-2-3-masteries.test.sql'),'utf8'));
 console.log(result.trim());
 // Authoritative fractional reward carry and lost-response replay, using only
 // the local stub of the already verified underlying pickup lifecycle.
 sql(`begin;select set_config('skyway.test_uid','11111111-1111-4111-8111-111111111111',true);
 insert into public.player_unlocks(user_id,item_key,item_type,rarity)values('11111111-1111-4111-8111-111111111111','medic_bloom','character','common');
 insert into app_private.mastery_sessions(user_id,context_id,context_type,character_key,flair_character,gem_multiplier)values('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333','endless','runner_ace','medic_bloom',1.25);
 do $$declare r jsonb;n integer;begin for n in 1..4 loop r:=public.claim_player_gem('33333333-3333-4333-8333-333333333333',n::text);end loop;
 if (r->>'total_gems')::integer<>5 or (r->>'gems_awarded')::integer<>2 then raise exception 'Fraction carry failed';end if;
 r:=public.claim_player_gem('33333333-3333-4333-8333-333333333333','4');
 if (r->>'total_gems')::integer<>5 or (r->>'is_new')::boolean is not false then raise exception 'Gem retry duplicated bonus';end if;
 end$$;rollback;`);
 console.log('PASS: isolated migration/reapply, rollback checks and authoritative flair fractions/replay.');
 }
} finally {
 if(started){run('pg_ctl',['-D',data,'-m','fast','-w','stop']);started=false;}
 rmSync(dir,{recursive:true,force:true});
}
