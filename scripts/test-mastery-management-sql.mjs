// Invoked only by the dedicated disposable Unix-socket PostgreSQL fixture.
// No remote URL, native login, mail, real players, or production writes.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
export async function testMasteryManagement({query:q,scalar,check,fail,actor,source}){
 assert.equal(await scalar('select inet_server_addr()'),null);
 assert.equal(await scalar('select current_database()'),'economy_update_23');
 await q('savepoint mastery_management_local');
 const admin=randomUUID(),coadmin=randomUUID(),target=randomUUID(),other=randomUUID();
 await q('alter table neon_auth."user" add column if not exists "createdAt" timestamptz default now();create table if not exists neon_auth."session"(id uuid primary key,"userId" uuid,"createdAt" timestamptz default now())');
 for(const uid of [admin,coadmin,target,other]){
  await q('insert into neon_auth."user"(id,email,username) values($1,$2,$3)',[uid,`${uid}@example.invalid`,'SyntheticManagement']);
  await q('insert into public.player_stats(user_id,total_gems,high_score,lifetime_xp,completed_runs) values($1,123,456,17,3)',[uid]);
  await q('insert into public.player_photon_fury(user_id,unlocked_at,photons) values($1,now(),1000)',[uid]);
 }
 await q("insert into public.admin_users(user_id,email,role) values($1::uuid,$1::uuid::text||'@example.invalid','main'),($2::uuid,$2::uuid::text||'@example.invalid','co_admin')",[admin,coadmin]);
 for(const [key,kind]of [['runner_dash','runner'],['runner_stride','runner'],['medic_bloom','medic'],['medic_remedy','medic'],['medic_salve','medic'],['runner_vault','runner'],['tank_guard','tank'],['trickster_smoke','trickster']]){
  await q("insert into public.extraction_catalog(item_key,display_name,item_type,rarity,character_class,weapon_name,weapon_score_bonus) values($1,$1,'character','common',$2,$1,0) on conflict(item_key) do update set active=true",[key,kind]);
 }
 await q("insert into public.player_unlocks(user_id,item_key,item_type,rarity) values($1,'runner_dash','character','common'),($1,'runner_stride','character','common'),($1,'trickster_smoke','character','common')",[target]);
 await q("insert into app_private.player_mastery_quests(user_id,character_key,quest,progress) values($1,'runner_dash',1,7)",[target]);
 await q("insert into app_private.player_mastery_quests(user_id,character_key,quest,progress,mastered,mastery_enabled,flair_rewrite_enabled,mastered_at) values($1,'runner_stride',3,100,true,false,false,now()-interval '10 days')",[target]);
 await q("insert into app_private.player_mastery_preferences(user_id,active_character,flair_character) values($1,'runner_dash','runner_stride')",[target]);
 const signature='public.admin_player_command_v23(text,uuid,text,text,text,bigint,text[],uuid,bigint,boolean,bigint,text,text)';
 const controlSignatures=[signature,'public.is_main_admin()','public.is_admin()','app_private.unlimited_1v1_requirements(uuid)','public.get_player_progression()'];
 const controls=await scalar('select jsonb_object_agg(sig,md5(pg_get_functiondef(sig::regprocedure))) from unnest($1::text[]) sig',[controlSignatures]);
 const protectedBefore=await scalar(`select jsonb_build_object('stats',(select jsonb_agg(to_jsonb(t) order by user_id) from public.player_stats t),'auth',(select jsonb_agg(to_jsonb(t) order by id) from neon_auth."user" t),'accounts',(select jsonb_agg(to_jsonb(t) order by id) from neon_auth.account t),'ownership',(select jsonb_agg(to_jsonb(t) order by user_id,item_key) from public.player_unlocks t),'photon',(select jsonb_agg(to_jsonb(t) order by user_id) from public.player_photon_fury t),'quests',(select jsonb_agg(to_jsonb(t) order by user_id,character_key) from app_private.player_mastery_quests t),'preferences',(select jsonb_agg(to_jsonb(t) order by user_id) from app_private.player_mastery_preferences t),'resets',(select jsonb_agg(to_jsonb(t) order by version) from app_private.progression_resets t))`);
 await import('./build-mastery-followup-release.mjs');
 const productionTransport=readFileSync(new URL('../../../outputs/mastery-followup-release-20261019.sql',import.meta.url),'utf8');
 const targetGuard="if current_database()<>'neondb' or current_user<>'neondb_owner' then";
 assert.equal(productionTransport.split(targetGuard).length-1,1,'Exact production database/owner guard is present');
 const fixtureTransport=productionTransport.replace(targetGuard,"if current_database()<>'economy_update_23' or inet_server_addr() is not null then");
 await q(fixtureTransport);check(true,true,'Exact atomic preservation transport applies on current synthetic schema');
 await q('drop table pg_temp.mastery_followup_protected');
 const tamperPoint='for item in select * from pg_temp.mastery_followup_protected';
 await fail(fixtureTransport.replace(tamperPoint,`update public.player_stats set total_gems=total_gems+1 where user_id='${target}'::uuid;\n ${tamperPoint}`),[],/PLAYER DATA CHANGED: public.player_stats/);
 check(Number(await scalar('select total_gems from public.player_stats where user_id=$1',[target])),123,'Transport failure rolls back a deliberately injected wallet mutation');
 await fail(fixtureTransport.replace(tamperPoint,`grant select on app_private.player_mastery_quests to authenticated;\n ${tamperPoint}`),[],/TABLE SECURITY CHANGED: app_private.player_mastery_quests/);
 check(await scalar("select has_table_privilege('authenticated','app_private.player_mastery_quests','SELECT')"),false,'Transport failure rolls back deliberately injected private-table ACL exposure');
 await q('savepoint malformed_trial_column');await q('alter table app_private.mastery_sessions alter column trial_replay drop not null');
 await fail(source('update-2-3-mastery-management.sql'),[],/trial_replay column shape changed/);await q('rollback to savepoint malformed_trial_column');await q('release savepoint malformed_trial_column');
 for(const alteration of ["alter table app_private.mastery_sessions alter column trial_replay set default true","alter table app_private.mastery_sessions alter column trial_replay drop default;alter table app_private.mastery_sessions alter column trial_replay type text using trial_replay::text;alter table app_private.mastery_sessions alter column trial_replay set default 'false'"]){
  await q('savepoint invalid_trial_shape');await q(alteration);await fail(source('update-2-3-mastery-management.sql'),[],/trial_replay column shape changed/);await q('rollback to savepoint invalid_trial_shape');await q('release savepoint invalid_trial_shape');
 }
 await q('savepoint exposed_private_helper');await q('grant execute on function app_private.apply_player_xp(uuid,bigint,boolean) to authenticated');
 await fail(source('update-2-3-mastery-management.sql'),[],/Function security boundary changed/);await q('rollback to savepoint exposed_private_helper');await q('release savepoint exposed_private_helper');
 await q('savepoint changed_function_body');
 const expectedBegin=await scalar("select pg_get_functiondef('public.begin_mastery_session(uuid,text,text,text)'::regprocedure)");
 await q(expectedBegin.replace('v_replay boolean:=false;','v_replay boolean:=false; -- harmless local drift'));
 await fail(source('update-2-3-mastery-management.sql'),[],/Current function changed/);await q('rollback to savepoint changed_function_body');await q('release savepoint changed_function_body');
 // On first fixture pass the known post-patch hashes are exported below;
 // subsequent replay is also checked once those exact hashes are frozen.
 await q(fixtureTransport);check(true,true,'Exact atomic preservation transport replays safely');
 await q('drop table pg_temp.mastery_followup_protected');
 check(await scalar('select jsonb_object_agg(sig,md5(pg_get_functiondef(sig::regprocedure))) from unnest($1::text[]) sig',[controlSignatures]),controls,'Existing anti-game/admin/Unlimited/progression controls stay byte-identical');
 const protectedAfter=await scalar(`select jsonb_build_object('stats',(select jsonb_agg(to_jsonb(t) order by user_id) from public.player_stats t),'auth',(select jsonb_agg(to_jsonb(t) order by id) from neon_auth."user" t),'accounts',(select jsonb_agg(to_jsonb(t) order by id) from neon_auth.account t),'ownership',(select jsonb_agg(to_jsonb(t) order by user_id,item_key) from public.player_unlocks t),'photon',(select jsonb_agg(to_jsonb(t) order by user_id) from public.player_photon_fury t),'quests',(select jsonb_agg(to_jsonb(t) order by user_id,character_key) from app_private.player_mastery_quests t),'preferences',(select jsonb_agg(to_jsonb(t) order by user_id) from app_private.player_mastery_preferences t),'resets',(select jsonb_agg(to_jsonb(t) order by version) from app_private.progression_resets t))`);
 check(protectedAfter,protectedBefore,'Additive installation/replay preserves all stats/XP/reset registry/Auth/ownership/mastery/preferences');
 for(const sig of ['app_private.admin_player_command_v23_core(text,uuid,text,text,text,bigint,text[],uuid,bigint,boolean,bigint,text,text)','app_private.apply_player_xp(uuid,bigint,boolean)','app_private.award_completed_run_v2_live(uuid,bigint,text)'])
  for(const role of ['authenticated','anon','anonymous'])check(await scalar('select has_function_privilege($1,$2,\'EXECUTE\')',[role,sig]),false,`No new access to private ${sig} for ${role}`);
 for(const sig of [signature,'public.begin_mastery_session(uuid,text,text,text)','public.finish_mastery_trial(uuid)','public.admin_get_player(uuid)']){
  check(await scalar('select has_function_privilege(\'authenticated\',$1,\'EXECUTE\')',[sig]),true,'Existing signed-in entrypoint stays available');
  for(const role of ['anon','anonymous'])check(await scalar('select has_function_privilege($1,$2,\'EXECUTE\')',[role,sig]),false,'Anonymous entrypoint access remains denied');
 }
 const command=(action,key='runner_dash',args={})=>scalar('select public.admin_player_command_v23(p_action=>$1,p_target_user_id=>$2,p_item_kind=>$3,p_item_key=>$4,p_stat_key=>$5,p_value=>$6,p_command_text=>$7)',[action,target,args.kind??'mastery',key,args.stat??null,args.value??null,`/${action} mastery [${key}] synthetic`]);
 await actor(null);await fail('select public.admin_player_command_v23(\'grant\',$1,\'mastery\',\'runner_dash\')',[target],/admin|Sign in/i);
 await actor(other);await fail('select public.admin_player_command_v23(\'grant\',$1,\'mastery\',\'runner_dash\')',[target],/main admins|Admin access/i);
 await actor(coadmin);await fail('select public.admin_player_command_v23(\'grant\',$1,\'mastery\',\'runner_dash\')',[target],/main admins|Admin access/i);
 await actor(admin);
 for(const mode of ['endless','1v1']){
  await q('savepoint in_game_command_guard');
  if(mode==='endless')await q('insert into public.player_progression_runs(run_id,user_id,heartbeat_active,last_heartbeat_at) values($1,$2,true,now())',[randomUUID(),admin]);
  else{
   const mid=randomUUID();await q("insert into public.multiplayer_matches(id,host_user_id,guest_user_id,status,mode) values($1,$2,$3,'playing','casual')",[mid,admin,other]);
   await q("insert into public.multiplayer_players(match_id,user_id,slot,username,character_key,status) values($1,$2,1,'SyntheticAdmin','runner_ace','playing'),($1,$3,2,'SyntheticOther','runner_ace','playing')",[mid,admin,other]);
   await q('insert into public.player_progression_1v1_activity(match_id,user_id,heartbeat_active,last_heartbeat_at) values($1,$2,true,now())',[mid,admin]);
  }
  const intercepted=await command('grant');check([intercepted.ok,intercepted.auto_banned,intercepted.gameplay.mode],[false,true,mode],`Existing public wrapper intercepts mastery commands during ${mode}`);
  check(Number(await scalar("select count(*) from public.player_bans where target_user_id=$1 and reason='auto-banned for using commands during games.' and expires_at-starts_at=interval '1 day' and scope in('account','leaderboard')",[admin])),2,'Existing exact one-day anti-command bans preserved');
  check(await scalar("select mastered from app_private.player_mastery_quests where user_id=$1 and character_key='runner_dash'",[target]),false,'Intercepted command never reaches target mastery mutation');
  check(Number(await scalar("select count(*) from public.admin_command_audit where actor_user_id=$1 and action='anti_cheat_auto_ban' and not succeeded",[admin])),1,'Existing interception audit is retained');
  await q('rollback to savepoint in_game_command_guard');await q('release savepoint in_game_command_guard');
 }
 check((await command('grant','medic_bloom')).ok,false,'Grant requires target to own character separately');
 check(Number(await scalar("select count(*) from app_private.player_mastery_quests where user_id=$1 and character_key='medic_bloom'",[target])),0,'Unowned grant creates no mastery/character row');
 check((await command('grant','runner_ace')).ok,false,'Unsupported mastery rejected');
 check((await command('grant','runner_dash',{value:99})).ok,false,'Forged mastery amount rejected');
 check((await command('grant','runner_dash',{kind:'character'})).ok,false,'This dispatcher branch accepts only exact mastery topic');
 check((await command('set','',{kind:'',stat:'coins',value:999})).ok,false,'No coin admin setter is introduced');
 let granted=await command('grant');check([granted.ok,granted.changed,granted.mastered],[true,true,true],'Main admin grants owned mastery through existing dispatcher');
 let row=await scalar("select to_jsonb(q) from app_private.player_mastery_quests q where user_id=$1 and character_key='runner_dash'",[target]);
 check([row.quest,Number(row.progress),row.mastered,row.mastery_enabled,row.flair_rewrite_enabled],[3,7,true,true,true],'Grant retains paid quest/progress and enables earned-equivalent mastery');
 check(await scalar('select active_character from app_private.player_mastery_preferences where user_id=$1',[target]),null,'Grant retires completed active quest selection');
 const firstMasteredAt=row.mastered_at;
 await q("update app_private.player_mastery_quests set mastery_enabled=false,flair_rewrite_enabled=false where user_id=$1 and character_key='runner_dash'",[target]);
 check((await command('grant')).noop,true,'Repeated grant is idempotent');
 row=await scalar("select to_jsonb(q) from app_private.player_mastery_quests q where user_id=$1 and character_key='runner_dash'",[target]);
 check([row.mastery_enabled,row.flair_rewrite_enabled,row.mastered_at],[false,false,firstMasteredAt],'Repeated grant never resets player toggle choices or first mastery date');
 await actor(coadmin);let detail=await scalar('select public.admin_get_player($1)',[target]);
 check(detail.masteries.find(m=>m.character_key==='runner_dash').mastered,true,'Existing co-admin lookup may read mastery status without mutation permission');
 await actor(other);await fail('select public.admin_get_player($1)',[target],/Admin access/);
 await actor(target);
 const newTrial=async(key='runner_stride')=>{
  const id=randomUUID();await q('insert into public.player_progression_runs(run_id,user_id,heartbeat_active,last_heartbeat_at) values($1,$2,true,clock_timestamp())',[id,target]);
  const result=await scalar("select public.begin_mastery_session($1,'endless',$2,$2)",[id,key]);return {id,...result};
 };
 const balance=()=>scalar('select jsonb_build_object(\'stats\',to_jsonb(s),\'photon\',to_jsonb(p)) from public.player_stats s join public.player_photon_fury p using(user_id) where user_id=$1',[target]);
 const beforeReplay=await balance();const beforeReplayQuest=await scalar("select to_jsonb(q) from app_private.player_mastery_quests q where user_id=$1 and character_key='runner_stride'",[target]);
 let trial=await newTrial();check(trial.trial_replay,true,'Already-mastered trial is explicitly a server-marked replay');
 check(await scalar('select test_mode from public.player_progression_runs where run_id=$1',[trial.id]),true,'Replay run receipt is nonrewarding');
 const replayGem=await scalar("select public.claim_player_gem($1,'synthetic-replay-gem')",[trial.id]);
 check([replayGem.gems_awarded,replayGem.test_mode],[0,true],'Direct signed Gem claim also gives no replay reward');
 check((await scalar("select public.begin_mastery_session($1,'endless','runner_stride','runner_stride')",[trial.id])).trial_replay,true,'Resuming a replay retains server flag and same session');
 await q('update app_private.mastery_sessions set trial_ready=true,finale_at=45,last_at=48,active_seconds=45 where id=$1',[trial.session_id]);
 await actor(other);await fail('select public.finish_mastery_trial($1)',[trial.session_id],/Owned trial/);
 await actor(target);let finished=await scalar('select public.finish_mastery_trial($1)',[trial.session_id]);check([finished.trial_replay,finished.trial_completed],[true,true],'Replay completion is explicit');
 await scalar('select public.finish_mastery_trial($1)',[trial.session_id]);
 check(await scalar("select to_jsonb(q) from app_private.player_mastery_quests q where user_id=$1 and character_key='runner_stride'",[target]),beforeReplayQuest,'Replay/duplicate completion never changes quest/mastery/toggle/date state');
 check(await balance(),beforeReplay,'Replay/duplicate completion awards no score/XP/Gems/Photons');
 check((await scalar('select public.award_completed_run_v2($1,1200,\'endless\')',[trial.id])).xp_awarded,0,'Actual signed public completion cannot reward a marked replay');
 check(await balance(),beforeReplay,'Direct Gem/score/XP completion cannot change any replay wallet/high score/progression fields');
 await fail("select public.begin_mastery_session($1,'endless','medic_bloom','medic_bloom')",[randomUUID()],/Character locked/);
 const foreignRun=randomUUID();await q('insert into public.player_progression_runs(run_id,user_id) values($1,$2)',[foreignRun,other]);
 await fail("select public.begin_mastery_session($1,'endless','runner_stride','runner_stride')",[foreignRun],/Owned active run receipt/);
 trial=await newTrial('runner_dash');check(trial.trial_replay,true,'Admin-granted mastered characters may practice replay too');
 await q('update app_private.mastery_sessions set trial_ready=true,finale_at=45,last_at=48 where id=$1',[trial.session_id]);
 await actor(admin);let revoked=await command('revoke');check([revoked.ok,revoked.mastered,revoked.closed_sessions],[true,false,1],'Revoke retires current owned trial receipt');
 row=await scalar("select to_jsonb(q) from app_private.player_mastery_quests q where user_id=$1 and character_key='runner_dash'",[target]);
 check([row.quest,Number(row.progress),row.mastered,row.mastery_enabled,row.flair_rewrite_enabled,row.mastered_at],[3,7,false,false,false,firstMasteredAt],'Revoke preserves paid/completed quest progress and history, disables benefits');
 await actor(target);await fail('select public.finish_mastery_trial($1)',[trial.session_id],/Complete the trial/);
 trial=await newTrial('runner_dash');check(trial.trial_replay,false,'A revoked mastery can be earned again by a fresh legitimate normal trial');
 await q('update app_private.mastery_sessions set trial_ready=true,finale_at=45,last_at=48 where id=$1',[trial.session_id]);
 finished=await scalar('select public.finish_mastery_trial($1)',[trial.session_id]);check(finished.trial_replay,false,'First/re-earned completion remains normal mastery completion');
 check((await scalar('select public.get_mastery_profile()')).account.quests.runner_dash.mastered,true,'Normal earned completion still unlocks mastery');
 const completedTrial=await scalar('select to_jsonb(s) from app_private.mastery_sessions s where id=$1',[trial.session_id]);
 await actor(admin);await command('revoke');
 const revokedTrial=await scalar('select to_jsonb(s) from app_private.mastery_sessions s where id=$1',[trial.session_id]);
 check([revokedTrial.finished_at,revokedTrial.trial_failed,revokedTrial.event_counts.admin_mastery_revoked],[completedTrial.finished_at,completedTrial.trial_failed,true],'Revoke invalidates completed receipts without falsifying historical completion dates/results');
 await actor(target);await fail('select public.finish_mastery_trial($1)',[trial.session_id],/receipt was revoked/);
 check((await scalar('select public.get_mastery_profile()')).account.quests.runner_dash.mastered,false,'An old successfully completed trial cannot undo a later administrator revoke');
 await actor(admin);check((await command('revoke')).noop,true,'Repeating revoke after all receipts are retired is idempotent');
 await actor(admin);check((await command('revoke','trickster_smoke')).noop,true,'Revoking an absent quest does not create one or charge currency');
 const audits=(await q("select action,succeeded,request,result from public.admin_command_audit where actor_user_id=$1 and target_user_id=$2 order by id",[admin,target])).rows;
 check(audits.some(r=>r.action==='grant'&&!r.succeeded&&r.request.item_kind==='mastery'),true,'Failed mastery commands are audited with actor and target');
 check(audits.some(r=>r.action==='grant'&&r.succeeded&&r.result.mastered===true),true,'Successful grant is audited');
 check(audits.some(r=>r.action==='revoke'&&r.succeeded&&r.result.mastered===false),true,'Successful revoke is audited');
 // Grandfathered current mode ownership is independent from when it was bought.
 await q('insert into app_private.ranked_requalification(user_id,qualified,qualified_at) values($1,true,now()-interval \'2 years\')',[target]);
 await q("update public.player_photon_fury set unlocked_at=now()-interval '2 years' where user_id=$1",[target]);
 await q('update public.player_stats set level=0,lifetime_xp=0,xp_in_level=0 where user_id=$1',[target]);
 let requirements=await scalar('select app_private.unlimited_1v1_requirements($1)',[target]);check([requirements.modes_complete,requirements.level_complete,requirements.unlocked],[true,false,false],'Already-owned old modes remain complete below purchase levels; collection/level still required');
 let xp=await scalar('select app_private.apply_player_xp($1,0,false)',[target]);check([xp.photon_unlocked,xp.ranked_unlocked,xp.unlimited_requirements.modes_complete],[true,true,true],'Even zero-XP partial responses retain current grandfathered mode ownership');
 for(const prefix of ['low','legend','myth'])await q('insert into public.player_unlocks(user_id,item_key,item_type,rarity) select $1,item_key,item_type,rarity from public.extraction_catalog where item_key like $2||\'%\' on conflict do nothing',[target,prefix]);
 await q('update public.player_stats set level=45,lifetime_xp=app_private.cumulative_xp_for_level(45),xp_in_level=0 where user_id=$1',[target]);
 requirements=await scalar('select app_private.unlimited_1v1_requirements($1)',[target]);check([requirements.low_tier_required,requirements.legendary_required,requirements.mythic_required],[80,18,3],'Collection requirements unchanged');
 check(requirements.unlocked,true,'Required level/collection plus old owned modes qualifies without new purchases');
 xp=await scalar('select app_private.apply_player_xp($1,0,false)',[target]);check([xp.unlimited_unlocked,xp.unlimited_requirements.unlocked],[true,true],'XP response reports/persists newly qualifying Unlimited ownership');
 await q('update app_private.ranked_requalification set qualified=false where user_id=$1',[target]);check((await scalar('select app_private.unlimited_1v1_requirements($1)',[target])).modes_complete,false,'Requirement helper uses current Ranked ownership, not historical purchase dates');
 await q('update app_private.ranked_requalification set qualified=true where user_id=$1',[target]);await q('update public.player_photon_fury set unlocked_at=null where user_id=$1',[target]);check((await scalar('select app_private.unlimited_1v1_requirements($1)',[target])).modes_complete,false,'Requirement helper uses current Photon ownership');
 check(await scalar('select jsonb_object_agg(sig,md5(pg_get_functiondef(sig::regprocedure))) from unnest($1::text[]) sig',[controlSignatures]),controls,'All unmodified runtime/security/Unlimited helper bodies still exact');
 const signatures=['app_private.admin_player_command_v23_core(text,uuid,text,text,text,bigint,text[],uuid,bigint,boolean,bigint,text,text)','public.admin_get_player(uuid)','public.begin_mastery_session(uuid,text,text,text)','public.finish_mastery_trial(uuid)','app_private.apply_player_xp(uuid,bigint,boolean)'];
 const functions=(await q(`select s signature,pg_get_functiondef(s::regprocedure) definition,md5(pg_get_functiondef(s::regprocedure)) md5,has_function_privilege('authenticated',s,'EXECUTE') authenticated,has_function_privilege('anon',s,'EXECUTE') anon,has_function_privilege('anonymous',s,'EXECUTE') anonymous from unnest($1::text[]) s`,[signatures])).rows;
 writeFileSync(new URL('../../../outputs/mastery-management-verified-functions-20261019.json',import.meta.url),JSON.stringify({localFixtureVerified:true,productionApplied:false,functions,unchangedControls:controls},null,2),{mode:0o600});
 await import('./build-mastery-management-artifacts.mjs');
 const readback=await scalar(readFileSync(new URL('../../../outputs/mastery-management-readback-20261019.sql',import.meta.url),'utf8'));
 check(readback.functions_passed,true,'Independent expected body/ACL readback passes before fixture rollback');
 check(readback.trial_replay_shape,true,'Independent readback verifies exact new private column shape');
 check(readback.mastery_tables_private,true,'Independent readback verifies mastery table RLS and denied direct access');
 await q('rollback to savepoint mastery_management_local');await q('release savepoint mastery_management_local');
 return {localOnly:true,productionConnected:false,realAccountsUsed:false,rolledBack:true};
}
