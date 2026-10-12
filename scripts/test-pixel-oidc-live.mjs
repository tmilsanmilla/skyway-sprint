// Real OIDC redirects with disposable, ordinary test identities. Never print credentials.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {randomBytes,createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {Pool} from 'pg';
assert.ok(process.env.PIXEL_TEST_HELPER,'Provide the central provider disposable-account helper');
const {createPixelTestAccount}=await import(pathToFileURL(process.env.PIXEL_TEST_HELPER).href);
const origin='https://skyway-sprint.vercel.app';
const cli=process.env.NEON_CLI_PATH;
assert.ok(cli,'Provide the authenticated Neon CLI path');
const uri=execFileSync(process.execPath,[cli,'connection-string','br-holy-math-axs9gjmb','--project-id','odd-unit-44587143','--database-name','neondb','--pooled'],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const pool=new Pool({connectionString:uri,max:1});
const callbackOnly=process.argv.includes('--callback-only');
const hash=value=>createHash('sha256').update(value).digest('hex');
function browser(){
 const jar=new Map();
 const request=async(path,body)=>{
  const response=await fetch(path.startsWith('https:')?path:origin+path,{redirect:'manual',method:body?'POST':'GET',headers:{Origin:origin,'Content-Type':'application/json',Cookie:[...jar].map(([k,v])=>k+'='+v).join('; ')},...(body?{body:JSON.stringify(body)}:{})});
  for(const entry of response.headers.getSetCookie()){
   const first=entry.split(';')[0],i=first.indexOf('=');if(i>0){if(/max-age=0/i.test(entry))jar.delete(first.slice(0,i));else jar.set(first.slice(0,i),first.slice(i+1));}
  }return response;
 };request.setFixtureCookie=(name,value)=>jar.set(name,value);return request;
}
async function connect(provider,request,intent,fixtureNativeId=null){
 let url;
 if(callbackOnly){
  // When publishing is blocked, exercise the deployed callback using exact temporary
  // attempts. This is NOT a claim that the public start route/button is enabled.
  const state=randomBytes(32).toString('base64url'),nonce=randomBytes(32).toString('base64url'),verifier=randomBytes(32).toString('base64url'),cookie=randomBytes(32).toString('base64url');
  await pool.query('select app_private.pixel_attempt_begin($1,$2,$3,$4,$5,$6)',[hash(state),hash(cookie),verifier,nonce,intent,fixtureNativeId]);
  request.setFixtureCookie('__Host-skyway_pixel_attempt',cookie);
  const authorize=new URL('https://pixel-pulse-websites.vercel.app/api/sso/oauth2/authorize');
  authorize.search=new URLSearchParams({client_id:'skyway-sprint',redirect_uri:origin+'/api/pixel-pulse/callback',scope:'openid profile email',response_type:'code',state,nonce,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'}).toString();url=authorize.href;
 }else{
  const start=await request('/api/pixel-pulse/start',{intent});assert.equal(start.status,200,'Skyway OIDC start failed');({url}=await start.json());
 }
 assert.ok(!new URL(url).searchParams.has('prompt'));
 const callback=await provider.connect(url);assert.equal(callback.origin,origin);assert.equal(callback.pathname,'/api/pixel-pulse/callback');
 const response=await request(callback.href);assert.equal(response.status,303);
 return {callback,location:new URL(response.headers.get('location'),origin)};
}
async function ownSession(request){const response=await request('/api/pixel-pulse/session');assert.equal(response.status,200);const {session}=await response.json();assert.ok(session?.user?.id);return session;}
async function data(session,path,body){return fetch('https://ep-tiny-tooth-ax0800jo.apirest.c-4.us-east-2.aws.neon.tech/neondb/rest/v1/'+path,{method:body?'POST':'GET',headers:{Origin:origin,Authorization:'Bearer '+session.access_token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});}
async function cleanupSkyway(provider){
 const id=(await pool.query('select user_id from app_private.pixel_links where email=$1',[provider.email])).rows[0]?.user_id;
 if(id){await pool.query('delete from app_private.pixel_sessions where subject in(select subject from app_private.pixel_links where user_id=$1)',[id]);await pool.query('delete from app_private.pixel_links where user_id=$1 and email=$2',[id,provider.email]);}
 await pool.query('delete from neon_auth."user" where email=$1',[provider.email]);
}
let fresh,existing;
try{
 assert.equal((await pool.query("select current_setting('neon.branch_id') as id")).rows[0].id,'br-holy-math-axs9gjmb');
 assert.equal((await(await fetch(origin+'/api/pixel-pulse/status')).json()).enabled,!callbackOnly);
 fresh=await createPixelTestAccount('skyway-create');
 // Central test setup only; does not modify any real-user email policy.
 await fresh.seedVerifiedTestIdentity();
 const request=browser();
 const created=await connect(fresh,request,'create');assert.equal(created.location.searchParams.get('pixel_connected'),'1','Pixel account creation callback failed');
 const session=await ownSession(request);assert.equal(session.user.email,fresh.email);assert.equal(session.user.user_metadata.preferred_username,fresh.username);
 const owned=(await pool.query('select count(*)::int as n from player_unlocks where user_id=$1 and item_key in(select item_key from extraction_catalog where item_type=\'character\')',[session.user.id])).rows[0].n;
 assert.equal(owned,4,'New account received more than starter characters');
 assert.equal(await(await data(session,'rpc/is_admin',{})).json(),false);
 const others=await data(session,'player_stats?select=user_id&user_id=neq.'+session.user.id);assert.equal(others.status,200);assert.deepEqual(await others.json(),[]);
 const replay=await request(created.callback.href);assert.ok(new URL(replay.headers.get('location'),origin).searchParams.has('pixel_error'),'Callback replay accepted');
 await request('/api/pixel-pulse/signout',{});assert.equal((await(await request('/api/pixel-pulse/session')).json()).session,null);
 // Preserve central managed cookie but remove broker cookies to exercise no-password re-bridge.
 fresh.clearBrokerCookies();const repeat=await connect(fresh,request,'sign-in');assert.equal(repeat.location.searchParams.get('pixel_connected'),'1');assert.equal((await ownSession(request)).user.id,session.user.id);
 console.log(JSON.stringify({createFlow:true,sharedUsername:true,fourStartersOnly:true,noAdminImported:true,cookieReuseWithoutPassword:true,callbackReplayRejected:true,ownRowsOnly:true}));
 existing=await createPixelTestAccount('skyway-link');await existing.seedVerifiedTestIdentity();
 const nativeRequest=browser(),password=randomBytes(32).toString('base64url');
 const signup=await nativeRequest('/api/auth/sign-up/email',{name:'native_'+randomBytes(5).toString('hex'),email:existing.email,password});assert.equal(signup.status,200);const nativeId=(await signup.json()).user.id;
 await pool.query('update player_stats set total_gems=23,high_score=4321 where user_id=$1',[nativeId]);
 const statsBefore=(await pool.query('select to_jsonb(s) as data from player_stats s where user_id=$1',[nativeId])).rows[0].data;
 const emailOnly=await connect(existing,browser(),'sign-in');assert.match(emailOnly.location.searchParams.get('pixel_error')||'',/existing Skyway account uses this email/);
 const linked=await connect(existing,nativeRequest,'link',nativeId);assert.equal(linked.location.searchParams.get('pixel_connected'),'1','Native-proof linking callback failed');
 const linkedSession=await ownSession(nativeRequest);assert.equal(linkedSession.user.id,nativeId);assert.equal(linkedSession.user.user_metadata.preferred_username,existing.username);
 assert.deepEqual((await pool.query('select to_jsonb(s) as data from player_stats s where user_id=$1',[nativeId])).rows[0].data,statsBefore);
 await nativeRequest('/api/pixel-pulse/signout',{});await nativeRequest('/api/auth/sign-out',{});
 const signin=await nativeRequest('/api/auth/sign-in/email',{email:existing.email,password});assert.equal(signin.status,200);assert.equal((await signin.json()).user.id,nativeId);
 if(!callbackOnly){const noProof=await browser()('/api/pixel-pulse/start',{intent:'link',user_id:nativeId});assert.equal(noProof.status,401,'Client-supplied ID accepted as ownership proof');}
 console.log(JSON.stringify({nativeAccountLink:true,originalUserIdPreserved:true,progressAndInventoryPreserved:true,nativePasswordStillWorks:true,emailOnlyTakeoverRejected:true,liveCallbackTestPassed:true,publicStartRouteTested:!callbackOnly}));
}finally{
 for(const provider of [fresh,existing].filter(Boolean)){try{await cleanupSkyway(provider);}finally{await provider.cleanup();}}
 await pool.end();
}
