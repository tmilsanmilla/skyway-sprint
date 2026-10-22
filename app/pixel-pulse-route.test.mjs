import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import ts from 'typescript';
import * as rules from '../lib/pixel-pulse-rules.ts';
import * as proofRules from '../lib/pixel-pulse-link-proof.ts';

// Execute the actual route, replacing only framework/provider/database I/O.
// This is offline control-flow evidence, not a production OAuth or DB check.
const source=readFileSync(new URL('./api/pixel-pulse/[action]/route.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const hash=value=>createHash('sha256').update(value).digest('hex');
const origin='http://localhost:3400',state='s'.repeat(43),nonce='n'.repeat(43),browser='b'.repeat(43),verifier='v'.repeat(43),discovery='d'.repeat(43);
const subject='11111111-1111-4111-8111-111111111111',userId='22222222-2222-4222-8222-222222222222';
const dbProfile={subject,username:'owned_player',email:'owned@example.invalid',email_verified:true,profile_version:2,credential_version:3};
const identity={iss:rules.PIXEL_ISSUER,aud:rules.PIXEL_CLIENT_ID,sub:subject,preferred_username:dbProfile.username,email:dbProfile.email,email_verified:true,profile_version:2,credential_version:3};
const flow={client_id:rules.PIXEL_CLIENT_ID,redirect_uri:origin+rules.PIXEL_CALLBACK_PATH,response_type:'code',scope:'openid profile email',state,nonce,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256',pixel_intent:'link'};
const linkContext=(mode='link')=>({phase:'link',flow,expected:{subject,profile_version:2,credential_version:3},discovery_hash:hash(discovery),target_mode:mode,...(mode==='link'?{native_user_id:userId,native_session_id:'native-session'}:{})});
const native=()=>({user:{id:userId,email:dbProfile.email},session:{id:'native-session',userId,createdAt:new Date(Date.now()-1000).toISOString(),expiresAt:new Date(Date.now()+600000).toISOString()}});
function harness(options={}) {
 const calls=[],writtenCookies=[];const cookieValues=new Map(options.cookies??[[rules.PIXEL_ATTEMPT_COOKIE.replace('__Host-',''),browser],[rules.PIXEL_DISCOVERY_COOKIE.replace('__Host-',''),discovery]]);
 class ResponseStub extends Response {
  cookies={set(...args){writtenCookies.push(args);}};
  static json(body,init){return new ResponseStub(JSON.stringify(body),{...init,headers:{'Content-Type':'application/json',...init?.headers}});}
  static redirect(url,status){return new ResponseStub(null,{status,headers:{Location:String(url)}});}
 }
 const sql=async(strings,...values)=>{
  const query=strings.join('?');const name=query.match(/app_private\.([a-z_0-9]+)/)?.[1];calls.push({name,values});
  if(name==='pixel_attempt_take_v2')return[{attempt:{verifier,nonce,context:options.context??{phase:'discovery'}}}];
  if(name==='pixel_discovery_get')return[{profile:options.discovery===undefined?dbProfile:options.discovery}];
  if(name==='pixel_signin_bound') {options.onSignin?.();if(options.signinWait)await options.signinWait;if(options.attemptState?.cancelled)throw new Error('synthetic DB callback cancelled');if(options.signinFailure)throw new Error('synthetic profile collision');return[{session:options.bound?{user_id:userId}:null}];}
  if(name==='pixel_bind_account_v2'){if(options.attemptState?.cancelled)throw new Error('synthetic DB attempt cancelled');if(options.ownershipChanged)throw new Error('synthetic DB native ownership snapshot changed');return[{session:{user_id:userId}}];}
  if(name==='pixel_attempt_cancel'){if(options.attemptState)options.attemptState.cancelled=true;return[{cancellation:{cancelled:true,connection_saved:!!options.connectionSaved}}];}
  if(name==='pixel_attempt_confirm_native_password'&&(options.attemptState?.cancelled||options.passwordStampChanged))throw new Error('synthetic SQL native password stamp changed or cancelled');
  if(name==='pixel_discovery_save'){options.onDiscovery?.();if(options.discoveryWait)await options.discoveryWait;if(options.attemptState?.cancelled)throw new Error('synthetic DB discovery cancelled');}
  return [{}];
 };
 const oidc={randomState:()=>state,randomNonce:()=>nonce,randomPKCECodeVerifier:()=>verifier,calculatePKCECodeChallenge:async value=>createHash('sha256').update(value).digest('base64url'),
  buildAuthorizationUrl:(_configuration,params)=>{const url=new URL(rules.PIXEL_ISSUER+'/oauth2/authorize');for(const [key,value]of Object.entries(params))url.searchParams.set(key,value);return url;},
  authorizationCodeGrant:async(_configuration,_url,checks)=>{calls.push({name:'codeGrant',checks});return{access_token:'synthetic-access',id_token:'synthetic-id-token',claims:()=>options.claims??identity};},
  fetchUserInfo:async()=>{calls.push({name:'userinfo'});if(options.userinfoFailure)throw new Error('synthetic provider outage');return options.info??identity;},
 };
 const server={pixelEnabled:()=>options.enabled!==false,pixelOrigin:()=>origin,pixelCallback:()=>flow.redirect_uri,pixelConfiguration:async()=>({}),pixelHash:hash,pixelRandom:()=> 'r'.repeat(43),pixelCookieName:name=>name.replace('__Host-',''),pixelCookieOptions:maxAge=>({maxAge,httpOnly:true}),pixelPublicKeys:async()=>({keys:[]}),pixelDatabaseKeys:async()=>({keys:[]}),
  getPixelSession:async()=>{calls.push({name:'getPixelSession'});if(options.sessionFailure)throw new Error('synthetic central unavailable');return options.session??null;},pixelAccessToken:async()=> 'synthetic-jwt',pixelTokenExpiresAt:session=>session.exp,
  redeemPixelLink:async(_ticket,_idToken,expected)=>{calls.push({name:'redeemLink',expected});options.onRedeem?.();if(options.redeemWait)await options.redeemWait;if(options.proofFailure)throw new Error('synthetic proof mismatch');return{jti:randomUUID(),exp:Math.floor(Date.now()/1000)+30,auth_time:Math.floor(Date.now()/1000)};},
 };
 const imports={
  'next/server':{NextResponse:ResponseStub},'next/headers':{cookies:async()=>({get:name=>cookieValues.has(name)?{value:cookieValues.get(name)}:undefined})},'openid-client':oidc,
  '@/lib/neon-auth-server':{neonAuth:{getSession:async args=>{calls.push({name:'nativeSession',args});return{data:options.native===undefined?native():options.native,error:null};}}},
  '@/lib/neon-server':{neonServerSql:sql},'@/lib/pre-auth-rate-limit-server':{consumePreAuthNetworkQuota:async()=>options.quota??'allowed'},
  '@/lib/pixel-native-password-server':{verifyPixelNativePassword:async(expected,password,checkOrigin)=>{
   calls.push({name:'nativePassword',expected,password,checkOrigin});options.onNativePassword?.();if(options.nativePasswordWait)await options.nativePasswordWait;
   if(options.nativePasswordFailure)throw new Error('Your current Skyway password could not be verified. Try again.');
   return{userId:expected.userId};
  }},
  '@/lib/pixel-canary-server':{PIXEL_CANARY_COOKIE:'__Host-skyway_pixel_canary',PIXEL_CANARY_SECONDS:900,
   issuePixelCanary:async(id)=>{calls.push({name:'issueCanary',id});if(!options.canaryIssueAllowed)throw new Error('not allowlisted');return'owned-canary-cookie';},
   verifyPixelCanary:async(raw)=>raw==='owned-canary-cookie'?options.canary??null:null,
  },
  '@/lib/pixel-pulse-rules':rules,'@/lib/pixel-pulse-server':server,'@/lib/pixel-pulse-link-proof':proofRules,
 };
 const exports={};new Function('require','exports','console',compiled)(name=>{if(!(name in imports))throw new Error('Unexpected import '+name);return imports[name];},exports,{warn(){}});
 const invoke=(action,body={},method='POST',urlQuery='')=>exports.POST(new Request(origin+'/api/pixel-pulse/'+action+urlQuery,{method,headers:method==='POST'?{Origin:options.requestOrigin??origin,'Content-Type':'application/json'}:{},...(method==='POST'?{body:JSON.stringify(body)}:{})}),{params:Promise.resolve({action})});
 return{invoke,calls,writtenCookies};
}
const callback=(h,ticket=false)=>h.invoke('callback',{},'GET','?'+new URLSearchParams({state,iss:rules.PIXEL_ISSUER,code:'owned-code',...(ticket?{pixel_link_ticket:'t'.repeat(43)}:{})}));
const named=(h,name)=>h.calls.filter(call=>call.name===name);
process.env.NEXT_PUBLIC_PIXEL_PULSE_ENABLED='true';

test('ordinary startup is read-only discovery regardless of browser Link/Create label',async()=>{
 for(const intent of ['sign-in','link','create']){const h=harness();const response=await h.invoke('start',{intent});assert.equal(response.status,200);const target=new URL((await response.json()).url);assert.equal(target.searchParams.has('pixel_intent'),false);assert.deepEqual(JSON.parse(named(h,'pixel_attempt_begin_v2')[0].values[4]),{phase:'discovery'});assert.equal(named(h,'nativeSession').length,0);assert.equal(named(h,'pixel_bind_account_v2').length,0);}
});
test('unbound OIDC callback seals discovery without provisioning or adopting an email account',async()=>{
 const h=harness();const response=await callback(h);assert.equal(response.status,303);assert.equal(response.headers.get('Location'),origin+'/connect/pixel-pulse?discovered=1');assert.equal(named(h,'pixel_signin_bound').length,1);assert.equal(named(h,'pixel_discovery_save').length,1);assert.equal(named(h,'pixel_bind_account_v2').length,0);assert.equal(named(h,'nativeSession').length,0);
 assert.ok(h.calls.findIndex(c=>c.name==='pixel_retire_credentials')<h.calls.findIndex(c=>c.name==='userinfo'));
});
test('already-bound ordinary OIDC return remains automatic with no password confirmation',async()=>{
 const h=harness({bound:true});const response=await callback(h);assert.equal(response.headers.get('Location'),origin+'/?pixel_connected=1');assert.equal(named(h,'redeemLink').length,0);assert.equal(named(h,'nativeSession').length,0);assert.equal(named(h,'pixel_discovery_save').length,0);
});
test('unverified discovery can be shown readonly but cannot start either first binding',async()=>{
 for(const intent of ['link','create']){const h=harness({discovery:{...dbProfile,email_verified:false}});assert.equal((await h.invoke('confirm-start',{intent})).status,403);assert.equal(named(h,'pixel_attempt_begin_v2').length,0);assert.equal(named(h,'nativeSession').length,0);}
});
test('Link and Create both start fresh state nonce PKCE using same link wire and sealed target',async()=>{
 for(const intent of ['link','create']){const h=harness();const response=await h.invoke('confirm-start',{intent,...(intent==='link'?{nativePassword:'fixture-native-password'}:{})});assert.equal(response.status,200);const url=new URL((await response.json()).url);assert.equal(url.searchParams.get('pixel_intent'),'link');assert.equal(url.searchParams.get('code_challenge_method'),'S256');const context=JSON.parse(named(h,'pixel_attempt_begin_v2')[0].values[4]);assert.equal(context.target_mode,intent);assert.equal(context.expected.subject,subject);assert.equal(context.discovery_hash,hash(discovery));assert.equal(named(h,'nativeSession').length,intent==='link'?1:0);if(intent==='link'){assert.equal(context.native_user_id,userId);assert.deepEqual(named(h,'nativeSession')[0].args,{query:{disableCookieCache:'true'}});}else assert.equal(context.native_user_id,undefined);}
});
test('old native cookie is not fresh native ownership even when user id is correct',async()=>{
 const stale=native();stale.session.createdAt=new Date(Date.now()-91000).toISOString();const h=harness({native:stale});assert.equal((await h.invoke('confirm-start',{intent:'link',nativePassword:'fixture-native-password'})).status,503);assert.equal(named(h,'pixel_attempt_begin_v2').length,0);
});
test('recent OAuth-style native cookie alone cannot authorize first Link without managed password check',async()=>{
 for(const value of [undefined,'', 'p'.repeat(129)]){
  const h=harness();const response=await h.invoke('confirm-start',{intent:'link',...(value===undefined?{}:{nativePassword:value})});
  assert.equal(response.status,400);assert.equal(named(h,'nativePassword').length,0);assert.equal(named(h,'pixel_attempt_begin_v2').length,0);
 }
 const h=harness();assert.equal((await h.invoke('confirm-start',{intent:'link',nativePassword:'fixture-native-password'})).status,200);
 assert.ok(h.calls.findIndex(c=>c.name==='pixel_attempt_begin_v2')<h.calls.findIndex(c=>c.name==='nativePassword'));
 assert.ok(h.calls.findIndex(c=>c.name==='nativePassword')<h.calls.findIndex(c=>c.name==='pixel_attempt_confirm_native_password'));
 assert.deepEqual(named(h,'nativePassword')[0].expected,{userId,email:dbProfile.email});
 assert.deepEqual(named(h,'pixel_attempt_confirm_native_password')[0].values,[hash(state),hash('r'.repeat(43)),userId]);
 for(const call of h.calls.filter(c=>c.values))assert.ok(!JSON.stringify(call.values).includes('fixture-native-password'),'password never enters SQL arguments/context');
});
test('failed managed native password or changed credential stamp cancels attempt without authorization URL/cookie',async()=>{
 for(const opts of [{nativePasswordFailure:true},{passwordStampChanged:true}]){
  const h=harness(opts),response=await h.invoke('confirm-start',{intent:'link',nativePassword:'fixture-native-password'});
  assert.equal(response.status,503);assert.equal((await response.json()).url,undefined);assert.equal(named(h,'pixel_attempt_cancel').length,1);
  assert.equal(h.writtenCookies.length,0);assert.equal(named(h,'pixel_attempt_confirm_native_password').length,opts.nativePasswordFailure?0:1);
 }
});
test('cancel during managed password verification prevents proof promotion and authorization response',async()=>{
 let release,entered;const nativePasswordWait=new Promise(resolve=>release=resolve),enteredPromise=new Promise(resolve=>entered=resolve),attemptState={cancelled:false};
 const h=harness({nativePasswordWait,onNativePassword:entered,attemptState});const pending=h.invoke('confirm-start',{intent:'link',nativePassword:'fixture-native-password'});
 await enteredPromise;attemptState.cancelled=true;release();const response=await pending;assert.equal(response.status,503);assert.equal(h.writtenCookies.length,0);
});
test('native password is not accepted on Create or ordinary discovery and is never forwarded to Pixel',async()=>{
 for(const [action,intent]of [['confirm-start','create'],['start','sign-in']]){
  const h=harness();assert.equal((await h.invoke(action,{intent,nativePassword:'fixture-native-password'})).status,400);assert.equal(named(h,'nativePassword').length,0);
 }
 const h=harness();await h.invoke('confirm-start',{intent:'link',nativePassword:'fixture-native-password'});
 const context=JSON.parse(named(h,'pixel_attempt_begin_v2')[0].values[4]);assert.equal('nativePassword'in context,false);assert.equal('password'in context,false);
});
test('browser cannot supply expected actor, target id, proof flags or a discovery hash',async()=>{
 for(const supplied of [{expected:{subject}},{native_user_id:userId},{confirmed:true},{discovery_hash:hash(discovery)}]){const h=harness();assert.equal((await h.invoke('confirm-start',{intent:'link',...supplied})).status,400);assert.equal(named(h,'pixel_attempt_begin_v2').length,0);}
});
test('callback uses fixed saved target, verified proof and session hash before claiming success',async()=>{
 for(const target_mode of ['link','create']){const h=harness({context:linkContext(target_mode)});const response=await callback(h,true);assert.equal(response.headers.get('Location'),origin+'/?pixel_connected=1');assert.equal(named(h,'redeemLink').length,1);const ctx=JSON.parse(named(h,'pixel_bind_account_v2')[0].values[0]);assert.equal(ctx.session_hash,hash('r'.repeat(43)));assert.equal(ctx.state_hash,hash(state));assert.equal(ctx.browser_hash,hash(browser));assert.equal(ctx.expected_subject,subject);assert.equal(ctx.target_mode,undefined);assert.equal(ctx.native_user_id,undefined);}
});
test('actor or epoch changes cannot bind after confirmation',async()=>{
 for(const patch of [{sub:randomUUID()},{credential_version:4},{profile_version:3},{email_verified:false}]){const h=harness({context:linkContext('create'),claims:{...identity,...patch},info:{...identity,...patch}});const response=await callback(h,true);assert.equal(response.status,303);assert.match(response.headers.get('Location'),/pixel_error/);assert.equal(named(h,'redeemLink').length,0);assert.equal(named(h,'pixel_bind_account_v2').length,0);}
});
test('cross-site callback succeeds without Strict native cookie using fixed saved DB ownership proof',async()=>{
 const h=harness({context:linkContext(),native:null});const response=await callback(h,true);assert.equal(response.headers.get('Location'),origin+'/?pixel_connected=1');assert.equal(named(h,'nativeSession').length,0);assert.equal(named(h,'pixel_bind_account_v2').length,1);
});
test('changed/expired native DB ownership snapshot blocks callback even with valid central confirmation',async()=>{
 const h=harness({context:linkContext(),native:null,ownershipChanged:true});const response=await callback(h,true);assert.match(response.headers.get('Location'),/pixel_error/);assert.equal(named(h,'nativeSession').length,0);assert.equal(h.writtenCookies.filter(cookie=>cookie[0]===rules.PIXEL_COOKIE.replace('__Host-','')&&cookie[2].maxAge>0).length,0);
});
test('missing sealed native target is never selected from a callback browser session',async()=>{
 const context=linkContext();delete context.native_session_id;const h=harness({context});const response=await callback(h,true);assert.match(response.headers.get('Location'),/pixel_error/);assert.equal(named(h,'nativeSession').length,0);assert.equal(named(h,'redeemLink').length,0);assert.equal(named(h,'pixel_bind_account_v2').length,0);
});
test('missing proof, invalid redemption and unexpected discovery ticket cannot bind',async()=>{
 const missing=harness({context:linkContext('create')});await callback(missing);assert.equal(named(missing,'pixel_bind_account_v2').length,0);
 const invalid=harness({context:linkContext('create'),proofFailure:true});await callback(invalid,true);assert.equal(named(invalid,'pixel_bind_account_v2').length,0);
 const unexpected=harness();await callback(unexpected,true);assert.equal(named(unexpected,'pixel_discovery_save').length,0);assert.equal(named(unexpected,'pixel_signin_bound').length,0);
});
test('verified epoch retirement is committed before a later profile collision or UserInfo outage',async()=>{
 for(const failure of [{signinFailure:true},{userinfoFailure:true},{info:{...identity,preferred_username:'different'}}]){const h=harness(failure);const response=await callback(h);assert.match(response.headers.get('Location'),/pixel_error/);assert.equal(named(h,'pixel_retire_credentials').length,1);assert.equal(named(h,'pixel_bind_account_v2').length,0);}
});
test('disabled new-link gate blocks startup AND an in-flight callback without binding',async()=>{
 process.env.NEXT_PUBLIC_PIXEL_PULSE_ENABLED='false';try{const h=harness({context:linkContext('create')});assert.equal((await h.invoke('confirm-start',{intent:'create'})).status,503);await callback(h,true);assert.equal(named(h,'redeemLink').length,0);assert.equal(named(h,'pixel_bind_account_v2').length,0);}finally{process.env.NEXT_PUBLIC_PIXEL_PULSE_ENABLED='true';}
});
test('restricted canary issuance is same-origin fresh native allowlist only and public status stays off',async()=>{
 process.env.NEXT_PUBLIC_PIXEL_PULSE_ENABLED='false';try{
  const h=harness({canaryIssueAllowed:true});assert.equal((await h.invoke('canary')).status,200);
  assert.deepEqual(h.writtenCookies,[['skyway_pixel_canary','owned-canary-cookie',{maxAge:900,httpOnly:true}]]);
  assert.deepEqual(named(h,'nativeSession')[0].args,{query:{disableCookieCache:'true'}});
  const status=await h.invoke('status',{},'GET');assert.deepEqual(await status.json(),{enabled:false});
  for(const opts of [{native:null,canaryIssueAllowed:true},{canaryIssueAllowed:false},{requestOrigin:'https://evil.invalid',canaryIssueAllowed:true}]){
   const denied=harness(opts);assert.equal((await denied.invoke('canary')).status,403);assert.equal(denied.writtenCookies.length,0);
  }
  const stale=native();stale.session.createdAt=new Date(Date.now()-91000).toISOString();assert.equal((await harness({native:stale,canaryIssueAllowed:true}).invoke('canary')).status,403);
 }finally{process.env.NEXT_PUBLIC_PIXEL_PULSE_ENABLED='true';}
});
test('public-off canary start seals UUID/jti and cannot be used by another native actor or browser flag',async()=>{
 process.env.NEXT_PUBLIC_PIXEL_PULSE_ENABLED='false';try{
  const canary={nativeUserId:userId,jti:'canary-fixture-jti',expiresAt:Date.now()/1000+900},cookies=[['skyway_pixel_canary','owned-canary-cookie']];
  const h=harness({canary,cookies}),response=await h.invoke('start',{intent:'sign-in'});assert.equal(response.status,200);
  const context=JSON.parse(named(h,'pixel_attempt_begin_v2')[0].values[4]);assert.equal(context.canary_native_user_id,userId);assert.equal(context.canary_jti,canary.jti);
  const other=native();other.user.id='33333333-3333-4333-8333-333333333333';other.session.userId=other.user.id;
  for(const opts of [{canary,cookies,native:other},{canary,cookies:[]},{canary,cookies:[['skyway_pixel_canary','forged']]}]){
   const denied=harness(opts);assert.equal((await denied.invoke('start',{intent:'sign-in'})).status,503);assert.equal(named(denied,'pixel_attempt_begin_v2').length,0);
  }
  assert.equal((await harness({canary,cookies}).invoke('start',{intent:'sign-in',confirmed:true})).status,400);
 }finally{process.env.NEXT_PUBLIC_PIXEL_PULSE_ENABLED='true';}
});
test('canary OAuth callback needs signed cookie AND exact sealed UUID/jti; Strict native cookie is not substituted',async()=>{
 process.env.NEXT_PUBLIC_PIXEL_PULSE_ENABLED='false';try{
  const canary={nativeUserId:userId,jti:'canary-fixture-jti',expiresAt:Date.now()/1000+900},context={phase:'discovery',canary_native_user_id:userId,canary_jti:canary.jti};
  const cookies=[['skyway_pixel_canary','owned-canary-cookie'],[rules.PIXEL_ATTEMPT_COOKIE.replace('__Host-',''),browser]];
  const h=harness({canary,cookies,context,native:null});const response=await callback(h);assert.equal(response.headers.get('Location'),origin+'/connect/pixel-pulse/test?discovered=1');assert.equal(named(h,'nativeSession').length,0);
  for(const opts of [{canary:null,cookies,context},{canary,cookies:[cookies[1]],context},{canary,cookies,context:{...context,canary_native_user_id:'33333333-3333-4333-8333-333333333333'}},{canary,cookies,context:{...context,canary_jti:'other'}},{canary,cookies,context:{...linkContext(),native_user_id:'33333333-3333-4333-8333-333333333333',...context,phase:'link'}}]){
   const denied=harness(opts);assert.match((await callback(denied)).headers.get('Location'),/pixel_error/);assert.equal(named(denied,'codeGrant').length,0);assert.equal(named(denied,'pixel_bind_account_v2').length,0);
  }
 }finally{process.env.NEXT_PUBLIC_PIXEL_PULSE_ENABLED='true';}
});
test('server session failure never returns native fallback or fabricated session',async()=>{
 const h=harness({sessionFailure:true,cookies:[[rules.PIXEL_COOKIE.replace('__Host-',''),'p'.repeat(43)]]});const response=await h.invoke('session',{},'GET');assert.equal(response.status,503);assert.equal(named(h,'nativeSession').length,0);assert.equal((await response.json()).session,undefined);
});
test('session response reports actual short token expiry rather than the long browser cookie',async()=>{
 const exp=Math.floor(Date.now()/1000)+20;const h=harness({session:{user_id:userId,email:dbProfile.email,username:dbProfile.username,email_verified:true,created_at:new Date().toISOString(),exp},cookies:[[rules.PIXEL_COOKIE.replace('__Host-',''),'p'.repeat(43)]]});const response=await h.invoke('session',{},'GET');const body=await response.json();assert.equal(body.session.expires_at,exp);assert.ok(body.session.expires_in<=20);assert.equal(body.session.user.id,userId);
});
test('same-origin mutations and rate limits fail before any server-owned state write',async()=>{
 for(const opts of [{requestOrigin:'https://evil.invalid'},{quota:'rate_limited'}]){const h=harness(opts);assert.ok((await h.invoke('confirm-start',{intent:'link'})).status>=400);assert.equal(named(h,'pixel_attempt_begin_v2').length,0);}
});
test('cancel/signout retires owned server attempt before clearing browser cookies',async()=>{
 for(const action of ['cancel','signout']){const h=harness();const response=await h.invoke(action);assert.equal(response.status,200);assert.equal(named(h,'pixel_attempt_cancel').length,1);assert.deepEqual(named(h,'pixel_attempt_cancel')[0].values,[hash(browser)]);assert.ok(h.writtenCookies.some(cookie=>cookie[0]===rules.PIXEL_ATTEMPT_COOKIE.replace('__Host-','')&&cookie[2].maxAge===0));}
});
test('cancel during redeemed callback makes final atomic binder reject despite captured old cookie',async()=>{
 let release,entered;const redeemWait=new Promise(resolve=>release=resolve),enteredPromise=new Promise(resolve=>entered=resolve);const attemptState={cancelled:false};
 const h=harness({context:linkContext('create'),attemptState,redeemWait,onRedeem:entered});
 const pending=callback(h,true);await enteredPromise;assert.equal((await h.invoke('cancel')).status,200);assert.equal(attemptState.cancelled,true);release();const result=await pending;assert.match(result.headers.get('Location'),/pixel_error/);assert.equal(named(h,'pixel_bind_account_v2').length,1);assert.equal(h.writtenCookies.filter(cookie=>cookie[0]===rules.PIXEL_COOKIE.replace('__Host-','')&&cookie[2].maxAge>0).length,0);
});
test('new start seals new context before retiring its source discovery and installing a fresh cookie',async()=>{
 const h=harness();assert.equal((await h.invoke('start')).status,200);assert.ok(h.calls.findIndex(call=>call.name==='pixel_attempt_begin_v2')<h.calls.findIndex(call=>call.name==='pixel_attempt_cancel'));assert.ok(h.writtenCookies.some(cookie=>cookie[0]===rules.PIXEL_ATTEMPT_COOKIE.replace('__Host-','')&&cookie[2].maxAge>0));
});
test('ordinary callback passes owned attempt hashes to atomic signin/discovery wrappers',async()=>{
 const h=harness();await callback(h);for(const name of ['pixel_signin_bound','pixel_discovery_save']){const call=named(h,name)[0];assert.equal(call.values.length,4);assert.deepEqual(call.values.slice(2),[hash(state),hash(browser)]);}
});
test('cancel during ordinary bound signin cannot mint a fresh session after oldcookie capture',async()=>{
 let release,entered;const signinWait=new Promise(resolve=>release=resolve),enteredPromise=new Promise(resolve=>entered=resolve);const attemptState={cancelled:false};const h=harness({bound:true,attemptState,signinWait,onSignin:entered});const pending=callback(h);await enteredPromise;await h.invoke('signout');release();const response=await pending;assert.match(response.headers.get('Location'),/pixel_error/);assert.equal(h.writtenCookies.filter(cookie=>cookie[0]===rules.PIXEL_COOKIE.replace('__Host-','')&&cookie[2].maxAge>0).length,0);
});
test('cancel during ordinary discovery save cannot leave new sealed connection context',async()=>{
 let release,entered;const discoveryWait=new Promise(resolve=>release=resolve),enteredPromise=new Promise(resolve=>entered=resolve);const attemptState={cancelled:false};const h=harness({attemptState,discoveryWait,onDiscovery:entered});const pending=callback(h);await enteredPromise;await h.invoke('cancel');release();const response=await pending;assert.match(response.headers.get('Location'),/pixel_error/);assert.equal(h.writtenCookies.filter(cookie=>cookie[0]===rules.PIXEL_DISCOVERY_COOKIE.replace('__Host-','')&&cookie[2].maxAge>0).length,0);
});
test('cancel after committed first binding reports saved connection without claiming unlink or data undo',async()=>{
 const h=harness({connectionSaved:true});const response=await h.invoke('cancel');assert.deepEqual(await response.json(),{ok:true,connectionSaved:true});assert.equal(named(h,'pixel_bind_account_v2').length,0);
});
