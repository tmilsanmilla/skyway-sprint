// Full Request/Response pipeline against disposable signing keys and rolled-back DB fixtures.
// This is not a claim of a deployed endpoint or a production central-ticket test.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {Pool} from 'pg';
import {generateKeyPair,SignJWT} from 'jose';
import {handlePixelAccount} from '../lib/pixel-pulse-account-handler.ts';
import {verifyPixelManagementTicket,PIXEL_ISSUER,PIXEL_CLIENT_ID} from '../lib/pixel-pulse-rules.ts';
const cli=process.env.NEON_CLI_PATH;assert.ok(cli);
const uri=execFileSync(process.execPath,[cli,'connection-string','br-holy-math-axs9gjmb','--project-id','odd-unit-44587143','--database-name','neondb','--pooled'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const pool=new Pool({connectionString:uri,max:1}),db=await pool.connect();
const {privateKey,publicKey}=await generateKeyPair('EdDSA');const hash=s=>createHash('sha256').update(s).digest('hex');
const name='mh_'+randomBytes(6).toString('hex'),email=name+'@example.invalid',subject=randomUUID();let nativeId;
const base={sub:subject,name,preferred_username:name,email,email_verified:true,profile_version:0,credential_version:0,ticket_version:1,purpose:'pixel-pulse-account-management'};
const fp=`select md5(coalesce(string_agg(to_jsonb(t)::text,'|' order by user_id),'empty')) as hash from player_stats t`;
let proofCalls=0,statusCalls=0;
async function atomic(query,args){await db.query('savepoint rpc');try{const result=await db.query(query,args);await db.query('release savepoint rpc');return result;}catch(error){await db.query('rollback to savepoint rpc');await db.query('release savepoint rpc');throw error;}}
const deps={enabled:true,quota:async()=> 'allowed',verify:(token,op)=>verifyPixelManagementTicket(token,op,async()=>publicKey),
 status:async p=>{statusCalls++;return(await db.query('select app_private.pixel_account_status($1,$2,$3) as result',[p.subject,p.email,p.emailVerified])).rows[0].result;},
 takeTicket:async(jti,exp)=>(await db.query('select app_private.pixel_ticket_take($1,$2) as ok',[hash(jti),new Date(exp*1000)])).rows[0].ok,
 retire:async p=>(await atomic('select app_private.pixel_retire_credentials($1,$2) as result',[p.subject,p.credentialVersion])).rows[0].result,
 sync:async p=>(await atomic('select app_private.pixel_sync_identity($1,$2,$3,$4,$5,$6) as result',[p.subject,p.username,p.email,p.emailVerified,p.profileVersion,p.credentialVersion])).rows[0].result,
 nativeProof:async(mail,password)=>{proofCalls++;assert.equal(mail,email);if(password!=='fixture-only-password')throw new Error('Wrong fixture password');return nativeId;},
 bind:async(p,op,user)=>(await atomic('select app_private.pixel_management_bind($1,$2,$3,$4,$5,$6,$7,$8,$9) as result',[p.subject,p.username,p.email,p.emailVerified,p.profileVersion,p.credentialVersion,op,user,hash(randomBytes(32))])).rows[0].result};
async function token(operation,patch={}){const now=Math.floor(Date.now()/1000);return new SignJWT({...base,...patch,operation}).setProtectedHeader({alg:'EdDSA'}).setIssuer(PIXEL_ISSUER).setAudience(PIXEL_CLIENT_ID).setIssuedAt(now).setExpirationTime(now+60).setJti(randomUUID()).sign(privateKey);}
async function call(operation,patch={},body={},givenToken){
 const signed=givenToken||await token(operation,patch);
 const response=await handlePixelAccount(new Request('https://fixture.invalid/api/pixel-pulse/account',{method:'POST',headers:{Authorization:'Bearer '+signed,'Content-Type':'application/json'},body:JSON.stringify({operation,...body})}),deps);
 return {status:response.status,body:await response.json(),token:signed};
}
try{
 assert.equal((await db.query("select current_setting('neon.branch_id') as id")).rows[0].id,'br-holy-math-axs9gjmb');
 const before=(await db.query(fp)).rows[0];await db.query('begin');
 for(const f of ['pixel-pulse-01-sessions.sql','pixel-pulse-02-link.sql'])await db.query(readFileSync(new URL('../neon/'+f,import.meta.url),'utf8').replace(/^begin;$/m,'').replace(/^commit;$/m,''));
 const ticketsBefore=(await db.query('select count(*)::int as n from app_private.pixel_management_tickets')).rows[0].n;
 nativeId=(await db.query('insert into neon_auth."user"(name,email,"emailVerified") values($1,$2,false) returning id',[name,email])).rows[0].id;
 const unverified=await call('status',{email_verified:false});assert.deepEqual(unverified.body,{state:'verification_required'});
 const status=await call('status');assert.deepEqual(status.body,{state:'link_required'});assert.equal((await db.query('select count(*)::int as n from app_private.pixel_management_tickets')).rows[0].n,ticketsBefore);
 const noPassword=await call('link');assert.equal(noPassword.status,400);assert.equal(proofCalls,0);
 const wrongPassword=await call('link',{}, {existingPassword:'wrong-fixture'});assert.equal(wrongPassword.status,401);
 assert.equal((await call('link',{}, {existingPassword:'fixture-only-password'},wrongPassword.token)).status,409);
 const link=await call('link',{}, {existingPassword:'fixture-only-password',user_id:randomUUID()});assert.equal(link.status,200);assert.equal(link.body.localAccountId,nativeId);assert.equal(link.body.message,'Linking successful');
 const replay=await call('link',{}, {existingPassword:'fixture-only-password'},link.token);assert.equal(replay.status,409);
 const synced=await call('sync',{name:name+' space',preferred_username:name+' space',profile_version:1,credential_version:1});assert.equal(synced.status,200);assert.equal(synced.body.profileVersion,1);assert.equal(synced.body.credentialVersion,1);
 assert.equal(synced.body.synced,true);
 const sessionHash=hash(randomBytes(32));await db.query('select app_private.pixel_bind_account_v2($1,$2,$3,true,null,$4,\'sign-in\',1,1,true)',[subject,name+' space',email,sessionHash]);
 const partial=await call('sync',{name:name+' space',preferred_username:name+' space',email:name+'other@example.invalid',email_verified:false,profile_version:2,credential_version:2});
 assert.equal(partial.status,409);assert.equal(partial.body.state,'linked');assert.equal(partial.body.synced,false);assert.equal(partial.body.securityApplied,true);assert.equal(partial.body.credentialVersion,2);assert.equal(partial.body.profileVersion,1);
 assert.equal((await db.query('select app_private.pixel_session_get($1) as session',[sessionHash])).rows[0].session,null);
 assert.equal((await db.query('select email from neon_auth."user" where id=$1',[nativeId])).rows[0].email,email);
 const callsBefore=statusCalls;const unknown=await call('sync',{sub:randomUUID(),email_verified:false,credential_version:99});assert.equal(unknown.status,403);assert.equal(unknown.body.state,'verification_required');assert.equal(statusCalls,callsBefore);assert.equal(unknown.body.localAccountId,undefined);
 const stale=await call('sync');assert.equal(stale.status,409);
 const collision=await call('create');assert.equal(collision.status,409);
 const freshSubject=randomUUID(),freshName=name+'x';const fresh=await call('create',{sub:freshSubject,name:freshName,preferred_username:freshName,email:freshName+'@example.invalid'});assert.equal(fresh.status,200);assert.notEqual(fresh.body.localAccountId,nativeId);
 const mixed=await call('status',{}, {operation:'sync'});assert.equal(mixed.status,401);
 const missing=await handlePixelAccount(new Request('https://fixture.invalid/api/pixel-pulse/account',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'}),deps);assert.equal(missing.status,401);
 await db.query('rollback');assert.deepEqual((await db.query(fp)).rows[0],before);
 console.log(JSON.stringify({passed:true,requestResponsePipeline:true,disposableSigningKeysOnly:true,readOnlyStatus:true,noUnverifiedLookup:true,explicitPasswordProof:true,clientUserIdIgnored:true,noDuplicateCreate:true,versionsPersisted:true,staleWritesAndReplaysRejected:true,allFixturesRolledBack:true,realPlayerStatsUnchanged:true}));
}catch(error){await db.query('rollback');throw error;}finally{db.release();await pool.end();}
