// Synthetic, empty owned PostgreSQL only. No environment credentials/provider.
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {spawn,execFileSync} from 'node:child_process';
import {createServer} from 'node:net';
import {once} from 'node:events';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import ts from 'typescript';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const require=createRequire(path.join(repo,'package.json'));const {Pool}=require('pg');
const out='/Users/lucas/Documents/Codex/deployment-policy/account-durability-20261109';
const raw=await readFile(path.join(repo,'app/account-preferences.ts'),'utf8');
const js=ts.transpileModule(raw,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {AccountPreferencesController}=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
const migration=await readFile(path.join(repo,'neon/account-preferences.sql'),'utf8');
const dir=await mkdtemp('/private/tmp/skyway-account-prefs-');const data=path.join(dir,'data');
const env={PATH:'/usr/bin:/bin',LANG:'C',LC_ALL:'C',TZ:'UTC'},bin='/opt/homebrew/opt/postgresql@17/bin';
const users=['11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222'];
let child,exited,pool,timer,stopping=false;const passes=[];
const receipt={startedAtUtc:new Date().toISOString(),ownedDirectory:dir,scope:'Actual prepared SQL and account controller, synthetic authenticated session settings only; no production/native provider/identity calls',postgresVersion:execFileSync(path.join(bin,'postgres'),['--version'],{env,encoding:'utf8'}).trim(),pgVersion:require('pg/package.json').version,migrationSha256:createHash('sha256').update(migration).digest('hex'),controllerSha256:createHash('sha256').update(raw).digest('hex')};
const pass=name=>{passes.push(name);console.log('PASS '+name);};
try{
 execFileSync(path.join(bin,'initdb'),['-D',data,'-U','local_test_admin','--auth=trust','--no-locale','--encoding=UTF8'],{env,stdio:['ignore','pipe','pipe']});
 const sock=createServer();sock.listen(0,'127.0.0.1');await once(sock,'listening');const port=sock.address().port;await new Promise(r=>sock.close(r));
 receipt.port=port;
 child=spawn(path.join(bin,'postgres'),['-D',data,'-h','127.0.0.1','-p',String(port),'-c','unix_socket_directories=','-c','shared_memory_type=mmap','-c','dynamic_shared_memory_type=mmap'],{env,stdio:['ignore','pipe','pipe']});
 let serverLog='';child.stdout.on('data',b=>serverLog+=b);child.stderr.on('data',b=>serverLog+=b);exited=once(child,'exit');
 timer=setTimeout(()=>child.kill('SIGINT'),120000);receipt.pid=child.pid;
 pool=new Pool({host:'127.0.0.1',port,database:'postgres',user:'local_test_admin',ssl:false,max:8,connectionTimeoutMillis:1000});
 pool.on('error',e=>{(receipt.poolErrors??=[]).push({code:e.code,stopping});if(!stopping)process.exitCode=1;});
 let ready=false;for(let i=0;i<50;i++){try{await pool.query('SELECT 1');ready=true;break;}catch{if(child.exitCode!==null)throw Error(serverLog);await new Promise(r=>setTimeout(r,100));}}assert(ready);
 assert.equal(Number((await readFile(path.join(data,'postmaster.pid'),'utf8')).split('\n')[0]),child.pid);
 await pool.query(`CREATE ROLE authenticated;CREATE ROLE anon;CREATE ROLE anonymous;
  CREATE SCHEMA auth;CREATE SCHEMA app_private;REVOKE ALL ON SCHEMA app_private FROM PUBLIC;
  CREATE TABLE public.player_profiles(user_id uuid PRIMARY KEY,username text NOT NULL);
  CREATE TABLE public.original_progress_fixture(user_id uuid PRIMARY KEY,gems integer,role text);
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
  CREATE FUNCTION app_private.require_pixel_runtime() RETURNS void LANGUAGE plpgsql AS $$BEGIN IF current_setting('test.runtime_admitted',true) IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'Runtime session denied'; END IF; END$$;
  CREATE FUNCTION app_private.photon_user() RETURNS uuid LANGUAGE plpgsql AS $$DECLARE u uuid:=auth.uid();BEGIN IF u IS NULL THEN RAISE EXCEPTION 'Sign in required';END IF;RETURN u;END$$;`);
 for(let i=0;i<2;i++){await pool.query('INSERT INTO public.player_profiles VALUES($1,$2)',[users[i],'original_'+i]);await pool.query('INSERT INTO public.original_progress_fixture VALUES($1,$2,$3)',[users[i],100+i,i?'member':'admin']);}
 const before=(await pool.query("SELECT md5(jsonb_agg(to_jsonb(p) ORDER BY user_id)::text) h FROM public.original_progress_fixture p")).rows[0].h;
 const profilesBefore=(await pool.query("SELECT md5(jsonb_agg(to_jsonb(p) ORDER BY user_id)::text) h FROM public.player_profiles p")).rows[0].h;
 await pool.query(migration);pass('Exact additive preference DDL applies with existing runtime prerequisites');
 const rpc=async(subject,name,values=[],admitted=true,role='authenticated')=>{
  const client=await pool.connect();try{
   await client.query('BEGIN');await client.query('SELECT set_config($1,$2,true),set_config($3,$4,true)',['request.jwt.claim.sub',subject||'','test.runtime_admitted',String(admitted)]);
   assert(['authenticated','anon'].includes(role));await client.query('SET LOCAL ROLE '+role);
   const answer=(await client.query('SELECT public.'+name+'('+values.map((_,i)=>'$'+(i+1)).join(',')+') AS value',values)).rows[0].value;
   await client.query('COMMIT');return answer;
  }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
 };
 const get=(subject,expected=subject,admitted=true,role='authenticated')=>rpc(subject,'get_player_account_preferences',[expected],admitted,role);
 const set=(subject,revision,p,expected=subject)=>rpc(subject,'set_player_account_preferences',[expected,revision,p.avatarColor,p.avatarFont,p.soundtrack,p.musicVolume,p.sfxVolume]);
 const defaults=await get(users[0]);assert.equal(defaults.revision,0);assert.equal(defaults.avatarColor,'#6b7280');assert.equal(defaults.avatarFont,'pixel');
 assert.equal((await pool.query('SELECT count(*)::int n FROM app_private.player_account_preferences')).rows[0].n,0);pass('Fresh authenticated defaults are server-derived without inventing a saved row');
 await assert.rejects(()=>get(users[0],users[0],true,'anon'),e=>e.code==='42501');
 const unauthorized=await pool.connect();try{await unauthorized.query('SET ROLE authenticated');await assert.rejects(()=>unauthorized.query('SELECT * FROM app_private.player_account_preferences'),e=>e.code==='42501');await unauthorized.query('RESET ROLE');}finally{unauthorized.release();}
 pass('Anonymous RPC and authenticated direct private-table access are denied');
 await assert.rejects(()=>get(users[0],users[0],false),e=>e.message==='Runtime session denied');await assert.rejects(()=>get('',users[0]),e=>e.message==='Sign in required');pass('Existing runtime and authenticated-user gates run before preference access');
 let writes=0;
 const api={load:id=>get(id),save:async(id,rev,p)=>{writes++;return set(id,rev,p);}};
 const first=new AccountPreferencesController(users[0],api,()=>true,()=>{});await first.load();
 first.patch({avatarColor:'#2563eb',avatarFont:'mono',soundtrack:'jazz',musicVolume:0.15,sfxVolume:0.25});await first.flush();assert.equal(first.view().status,'saved');first.close();
 // These two instances share only the authenticated UUID and actual database;
 // neither client has localStorage, a device seed or a shared browser store.
 const second=new AccountPreferencesController(users[0],api,()=>true,()=>{});await second.load();
 assert.equal(second.view().value.avatarFont,'mono');assert.equal(second.view().value.avatarColor,'#2563eb');assert.equal(second.view().value.soundtrack,'jazz');assert.equal(second.view().value.musicVolume,0.15);assert.equal(writes,1);second.close();
 pass('A second empty client restores avatar and audio solely from actual Neon-shaped SQL rows');
 const other=await get(users[1]);assert.equal(other.revision,0);assert.equal(other.avatarColor,'#6b7280');
 await assert.rejects(()=>set(users[1],0,{...defaults,avatarColor:'#be123c'},users[0]),e=>e.message==='Signed-in account changed');
 await assert.rejects(()=>get(users[1],users[0]),e=>e.message==='Signed-in account changed');assert.equal((await get(users[1])).revision,0);pass('Cross-account expected-ID assertions refuse reads/writes without touching another account');
 const saved=await get(users[0]);const competing=await Promise.allSettled([set(users[0],saved.revision,{...saved,avatarFont:'serif'}),set(users[0],saved.revision,{...saved,sfxVolume:0.4})]);
 assert.equal(competing.filter(x=>x.status==='fulfilled').length,1);assert.equal(competing.filter(x=>x.status==='rejected'&&x.reason.code==='40001').length,1);pass('Concurrent same-revision saves have one winner and one exact CAS refusal');
 let lost=true;let lossWrites=0;
 const lossApi={load:id=>get(id),save:async(id,rev,p)=>{lossWrites++;const result=await set(id,rev,p);if(lost){lost=false;throw Error('synthetic lost response after actual COMMIT');}return result;}};
 const c=new AccountPreferencesController(users[0],lossApi,()=>true,()=>{});await c.load();c.patch({avatarColor:'#047857'});await c.flush();assert.equal(c.view().status,'error');const committed=await get(users[0]);await c.flush();assert.equal(c.view().status,'saved');assert.equal(lossWrites,1);assert.equal((await get(users[0])).revision,committed.revision);c.close();pass('Actual committed save with lost response reconciles before another write');
 for(const patch of [{avatarColor:'red'},{avatarFont:'url(javascript:bad)'},{musicVolume:2},{sfxVolume:NaN}]){const p=await get(users[0]);await assert.rejects(()=>set(users[0],p.revision,{...p,...patch}),e=>e.message==='Invalid account settings');}pass('Actual SQL validation refuses malformed color/font/volume and NaN');
 const after=(await pool.query("SELECT md5(jsonb_agg(to_jsonb(p) ORDER BY user_id)::text) h FROM public.original_progress_fixture p")).rows[0].h;
 const profilesAfter=(await pool.query("SELECT md5(jsonb_agg(to_jsonb(p) ORDER BY user_id)::text) h FROM public.player_profiles p")).rows[0].h;
 assert.equal(before,after);assert.equal(profilesBefore,profilesAfter);pass('All original synthetic IDs, usernames, balances and roles remain byte-identical');
 receipt.success=true;receipt.pass=passes.length;receipt.fail=0;receipt.checks=passes;
}catch(e){receipt.success=false;receipt.error={name:e.name,message:e.message,stack:e.stack};console.error(e);process.exitCode=1;}
finally{
 stopping=true;clearTimeout(timer);if(pool)await pool.end();
 if(child){if(child.exitCode===null)child.kill('SIGINT');const [code,signal]=await exited;receipt.actualExit={code,signal};}
 if(!child||child.exitCode!==null||receipt.actualExit){await rm(dir,{recursive:true,force:true});receipt.ownedTemporaryDirectoryRemoved=true;}
 receipt.completedAtUtc=new Date().toISOString();await writeFile(path.join(out,'skyway-preferences-native-rehearsal.json'),JSON.stringify(receipt,null,2)+'\n');
 console.log(JSON.stringify({success:receipt.success,pass:receipt.pass,actualExit:receipt.actualExit,ownedTemporaryDirectoryRemoved:receipt.ownedTemporaryDirectoryRemoved}));
}
