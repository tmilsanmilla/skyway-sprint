/**
 * Deliberate production test, NEVER run by the ordinary test suite.
 * --create-fixtures creates exactly two disposable native accounts. Passwords,
 * cookies and JWTs remain in memory; only exact cleanup IDs/emails are saved.
 * --interactive retains those credentials for staged, coordinator-reviewed
 * checks. It does not provision a match, join a queue, or delete anything.
 */
import assert from 'node:assert/strict';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createInterface} from 'node:readline';

export const APP_ORIGIN='https://skyway-sprint.vercel.app';
export const DATA_ORIGIN='https://ep-tiny-tooth-ax0800jo.apirest.c-4.us-east-2.aws.neon.tech';
const DATA_PATH='/neondb/rest/v1';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SESSION_COOKIE='__Secure-neon-auth.session_token';

/** The installed Neon proxy forwards __Secure-neon-auth.* cookies and mints a
 * 300-second signed local session-data cookie. Preserve all own-origin cookie
 * rotations, but never pass these cookies to the Data API or another host. */
export class OwnCookieJar {
  entries=new Map();
  receive(headers){
    for(const raw of headers.getSetCookie()){
      const parts=raw.split(';').map(s=>s.trim()),split=parts[0].indexOf('=');
      if(split<=0)continue;
      const name=parts[0].slice(0,split),value=parts[0].slice(split+1);
      const attrs=new Map(parts.slice(1).map(s=>{const i=s.indexOf('=');return i<0?[s.toLowerCase(),true]:[s.slice(0,i).toLowerCase(),s.slice(i+1)];}));
      const domain=String(attrs.get('domain')??new URL(APP_ORIGIN).hostname).replace(/^\./,'');
      assert.equal(domain,new URL(APP_ORIGIN).hostname,'Auth returned a cookie for an unexpected domain');
      if(!name.startsWith('__Secure-neon-auth.'))continue;
      const expired=attrs.has('max-age')&&Number(attrs.get('max-age'))<=0||attrs.has('expires')&&Date.parse(String(attrs.get('expires')))<=Date.now();
      if(expired||!value)this.entries.delete(name);
      else this.entries.set(name,{value,path:String(attrs.get('path')??'/')});
    }
  }
  header(path='/'){
    return [...this.entries].filter(([,c])=>path.startsWith(c.path)).map(([name,c])=>`${name}=${c.value}`).join('; ');
  }
  hasNativeSession(){return this.entries.has(SESSION_COOKIE);}
  clear(){this.entries.clear();}
}
export const tokenClaims=token=>{
  assert.equal(typeof token,'string','Expected a JWT');assert.equal(token.split('.').length,3,'Expected a signed JWT');
  return JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString('utf8'));
};
const report=(check,details={})=>process.stdout.write(`${JSON.stringify({check,...details})}\n`);
/** Missing endpoints/schema, network failures and 5xx are NOT security proof. */
export const expectDenied=(r,label,allowed=[400,401,403,406])=>{
  assert.ok(!r.ok,`${label}: access unexpectedly succeeded`);
  assert.ok(allowed.includes(r.status),`${label}: unexpected failure status ${r.status}, not a verified denial`);
  assert.ok(!['PGRST202','PGRST205','42883'].includes(r.data?.code),`${label}: missing database definition, not a verified denial`);
};
export const expectBusinessRejection=(r,label,message)=>{
  expectDenied(r,label,[400,403]);
  assert.equal(r.data?.code,'P0001',`${label}: expected the installed own-account rule, not a missing function or permission grant`);
  assert.match(String(r.data?.message??''),message,`${label}: a different server rule failed`);
};
export const expectNoRowsOrDenied=(r,label)=>{
  if(r.ok)assert.ok(Array.isArray(r.data)&&r.data.length===0,`${label}: private rows were exposed`);
  else if(r.status===400){
    // The managed gateway uses 400 (rather than 401) for a request with no
    // bearer token. Accept only the independently observed authentication
    // rejection, never an arbitrary bad request or a missing database object.
    expectDenied(r,label,[400]);
    assert.equal(r.data?.code??null,null,`${label}: unexpected gateway error code`);
    assert.equal(r.data?.message,'missing authentication credentials: required authorization bearer token in JWT format',`${label}: not the known missing-credentials rejection`);
  }
  else expectDenied(r,label,[401,403]);
};
/** The coordinator independently verified app_private.mastery_sessions in Neon.
 * Neon can intentionally omit private profiles from its exposed HTTP router,
 * yielding 404 even though the table exists. This exception is table/profile
 * specific and is never used for missing RPCs, ownership, or JWT tests. */
export const expectPrivateProfileHidden=(r,{ownPublicControl,installedTableVerified})=>{
  assert.equal(ownPublicControl,true,'An own public-table control is required');
  assert.equal(installedTableVerified,true,'Verify the private table actually exists in Neon first');
  assert.ok(!r.ok&&[400,403,404,406].includes(r.status),'The private profile must be unexposed or denied');
  assert.ok(!['PGRST202','42883'].includes(r.data?.code),'A missing RPC is not private-profile evidence');
};
const safeFailureCode=error=>error instanceof assert.AssertionError?'ASSERTION_FAILED':error?.name==='TimeoutError'?'REQUEST_TIMEOUT':'REQUEST_FAILED';
/** Interactive assertions fail visibly but do not throw away the only RAM
 * credentials. The operator can inspect/retest/quit with the same two users. */
export const runStagedCheck=async(check,operation,emit=report)=>{
  try{await operation();return true;}
  catch(error){emit(check,{passed:false,errorCode:safeFailureCode(error),credentialsRetainedInMemory:true});return false;}
};

async function main(){
  const args=new Set(process.argv.slice(2));
  if(!args.has('--create-fixtures')){
    report('usage',{instructions:'Explicitly pass --create-fixtures after coordinator approval; add --interactive for staged checks. No network request was made.'});return;
  }
  for(const arg of args)assert.ok(['--create-fixtures','--interactive'].includes(arg),'Unknown live-test flag');
  const marker=`skyway_u23_live_${Date.now()}_${randomBytes(4).toString('hex')}`;
  const fixturePath=fileURLToPath(new URL(`../outputs/${marker}.json`,import.meta.url));
  const actors=['a','b'].map((letter,index)=>({letter,email:`${marker}_${letter}@example.invalid`,username:`u23test${Date.now().toString(36)}${letter}`,id:null,password:`A!9${randomBytes(32).toString('base64url')}`,jar:new OwnCookieJar(),token:null,firstToken:null,firstExp:null,index}));
  const persist=()=>{mkdirSync(dirname(fixturePath),{recursive:true});writeFileSync(fixturePath,JSON.stringify({marker,fixtures:actors.map(a=>({id:a.id,email:a.email}))},null,2)+'\n',{mode:0o600});};
  // This ignored output intentionally contains no passwords, tokens, cookies,
  // auth response bodies, or unrelated account identifiers.
  persist();report('fixture_cleanup_manifest',{path:fixturePath,marker});
  const request=async(url,{method='GET',body,headers={}}={})=>{
    const parsed=new URL(url);assert.ok([APP_ORIGIN,DATA_ORIGIN].includes(parsed.origin),'Unexpected request destination');
    const response=await fetch(url,{method,redirect:'manual',signal:AbortSignal.timeout(25_000),headers:{...headers,...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});
    assert.ok(response.status<300||response.status>=400,'Redirect refused; no credentials were forwarded');
    let data=null;try{data=await response.json();}catch{/* Responses are never echoed. */}
    if(!response.ok)report('http_rejection',{status:response.status,errorCode:typeof data?.code==='string'&&/^[A-Za-z0-9_]{1,40}$/.test(data.code)?data.code:null});
    return {ok:response.ok,status:response.status,data,headers:response.headers};
  };
  const auth=async(actor,path,{method='GET',body}={})=>{
    assert.ok(path.startsWith('/api/auth/')||path==='/api/account/bootstrap','Unexpected auth path');
    const result=await request(`${APP_ORIGIN}${path}`,{method,body,headers:{Origin:APP_ORIGIN,Referer:`${APP_ORIGIN}/`,Cookie:actor.jar.header(path),'Cache-Control':'no-store','X-Force-Fetch':'true'}});
    actor.jar.receive(result.headers);return result;
  };
  const api=(actor,path,body,extra={})=>request(`${DATA_ORIGIN}${DATA_PATH}/${path}`,{method:body===undefined?'GET':'POST',body,headers:{...(actor?.token?{Authorization:`Bearer ${actor.token}`} : {}),...extra}});
  const rpc=(actor,name,body={})=>api(actor,`rpc/${name}`,body);
  const getToken=async actor=>{
    const result=await auth(actor,'/api/auth/token');assert.ok(result.ok,`Native token request failed (${result.status})`);
    const claims=tokenClaims(result.data?.token);assert.equal(claims.sub,actor.id,'Token belongs to another account');assert.ok(Number.isFinite(claims.exp)&&claims.exp>Date.now()/1000,'Token already expired');
    actor.token=result.data.token;return claims;
  };
  const cookieSession=async(actor,{bootstrap=false}={})=>{
    const result=await auth(actor,'/api/auth/get-session');assert.ok(result.ok,`Cookie session request failed (${result.status})`);assert.equal(result.data?.user?.id,actor.id,'Cookie session changed account');
    // Existing pre-auth quota is 120 requests per network/minute. Exercise
    // bootstrap only once after each fresh fixture sign-in (two calls total),
    // not on repeated staged checks. Never retry a quota refusal automatically.
    if(bootstrap){const checked=await auth(actor,'/api/account/bootstrap',{method:'POST'});assert.ok(checked.ok,`Own bootstrap failed (${checked.status})`);assert.equal(checked.data?.userId,actor.id);}
  };
  const signOut=async actor=>{
    const result=await auth(actor,'/api/auth/sign-out',{method:'POST',body:{}});assert.ok(result.ok,`Sign-out failed (${result.status})`);
    actor.token=null;
    const session=await auth(actor,'/api/auth/get-session');assert.ok(session.ok,'Signed-out session request failed');assert.ok(!session.data?.user?.id,'Signed-out cookie still opens an account');
    actor.jar.clear();
  };
  const initializeFixtureProfiles=async()=>{
    for(const actor of actors){
      const before=await api(actor,`player_profiles?select=user_id,username&user_id=eq.${actor.id}`);
      assert.ok(before.ok&&Array.isArray(before.data)&&before.data.length<=1,'Own profile lookup failed');
      if(before.data.length){assert.equal(before.data[0].user_id,actor.id);assert.equal(before.data[0].username,actor.username,'Do not overwrite an existing different username');}
      else{
        const chosen=await rpc(actor,'set_player_username',{new_username:actor.username});assert.ok(chosen.ok,`Fixture first-choice username failed (${chosen.status})`);
      }
      const saved=await api(actor,`player_profiles?select=user_id,username&user_id=eq.${actor.id}`);assert.ok(saved.ok&&saved.data?.length===1,'Fixture named profile did not persist');assert.equal(saved.data[0].user_id,actor.id);assert.equal(saved.data[0].username,actor.username);
    }
    report('native_first_choice_profiles_readback',{passed:true});
  };
  const verifyOwnAndIsolation=async()=>{
    for(const actor of actors){
      const rival=actors[1-actor.index];
      await cookieSession(actor);
      const own=await api(actor,`player_stats?select=user_id,total_gems,high_score&user_id=eq.${actor.id}`);
      assert.ok(own.ok,`Own stats query failed (${own.status})`);assert.equal(own.data?.length,1,'Exactly one own stats row is required');assert.equal(own.data[0].user_id,actor.id);
      const profile=await api(actor,`player_profiles?select=user_id,username&user_id=eq.${actor.id}`);
      assert.ok(profile.ok&&profile.data?.length===1,'Exactly one own named profile is required');assert.equal(profile.data[0].user_id,actor.id);assert.equal(profile.data[0].username,actor.username,'Own first-choice username did not persist');
      const cross=await api(actor,`player_stats?select=user_id,total_gems,high_score&user_id=eq.${rival.id}`);
      expectNoRowsOrDenied(cross,'Cross-account private stats');
      const privateSchema=await api(actor,'mastery_sessions?select=id&limit=1',undefined,{'Accept-Profile':'app_private'});
      expectPrivateProfileHidden(privateSchema,{ownPublicControl:own.ok&&own.data?.[0]?.user_id===actor.id,installedTableVerified:true});
      for(const name of ['get_player_progression','get_mastery_profile']){
        const result=await rpc(actor,name);assert.ok(result.ok,`Own ${name} failed (${result.status})`);assert.ok(result.data&&typeof result.data==='object',`${name} returned invalid data`);
      }
      const admin=await rpc(actor,'is_admin');assert.ok(admin.ok&&admin.data===false,'Synthetic native fixture unexpectedly has admin authority');
      const ownEquip=await rpc(actor,'set_loadout',{p_slot:'character',p_item:'runner_ace'});assert.ok(ownEquip.ok,`Installed own starter equip failed (${ownEquip.status}); cannot interpret an unowned failure as security proof`);
      // Fixture accounts are newly created and must not own non-starters.
      const unowned=await rpc(actor,'set_loadout',{p_slot:'character',p_item:'runner_dash'});expectBusinessRejection(unowned,'Unowned character equip',/^Character is not unlocked$/);
      const toggle=await rpc(actor,'set_mastery_toggle',{p_character_key:'runner_dash',p_which:'mastery',p_enabled:true});expectBusinessRejection(toggle,'Unowned mastery toggle',/^Character locked$/);
      report('native_own_and_cross_account_checks',{actor:actor.letter,passed:true});
    }
    expectDenied(await rpc(null,'get_mastery_profile'),'Anonymous mastery profile');
    const anonymous=await api(null,`player_stats?select=user_id&user_id=eq.${actors[0].id}`);
    expectNoRowsOrDenied(anonymous,'Anonymous private stats');
    report('anonymous_access_denied',{passed:true});
  };
  const verifyMatch=async matchId=>{
    assert.match(matchId,UUID,'Use the exact coordinator-seeded fixture match UUID');
    const snapshots=[];
    for(const actor of actors){
      const result=await rpc(actor,'get_1v1_state',{p_match_id:matchId});assert.ok(result.ok,`Own fixture match read failed (${result.status})`);
      const s=result.data;assert.equal(s?.match?.id,matchId);assert.equal(s?.self?.user_id,actor.id);assert.equal(s?.opponent?.user_id,actors[1-actor.index].id,'Match contains a real or unrelated account');
      assert.equal(s.match.mode,'casual','Only an isolated Casual fixture match is permitted');assert.equal(s.match.map_key,'pitch','Seed a Pitch fixture for Katana validation');assert.equal(s.match.status,'playing');assert.equal(Number(s.self.score),0,'Fixture match was already modified; do not reuse it');
      snapshots.push(s);
    }
    expectBusinessRejection(await rpc(actors[0],'sync_1v1_score',{p_match_id:randomUUID(),p_score:1}),'Unrelated match score',/^1v1 match is not active$|^1v1 match not found$/);
    expectDenied(await rpc(null,'sync_1v1_score',{p_match_id:matchId,p_score:999}),'Anonymous score mutation');
    for(const score of [201,249,501]){const result=await rpc(actors[0],'sync_1v1_score',{p_match_id:matchId,p_score:score});assert.ok(result.ok,`Own score ${score} failed (${result.status})`);assert.equal(Number(result.data),score);}
    const ownB=await rpc(actors[1],'sync_1v1_score',{p_match_id:matchId,p_score:25});assert.ok(ownB.ok,'Other fixture own score failed');
    for(const actor of actors){
      const state=await rpc(actor,'get_1v1_state',{p_match_id:matchId});assert.ok(state.ok);assert.equal(Number(state.data.self.score),actor.index?25:501);assert.equal(Number(state.data.opponent.score),actor.index?501:25);
      const abilities=await rpc(actor,'get_1v1_ability_state',{p_match_id:matchId});assert.ok(abilities.ok,`Own ability state failed (${abilities.status})`);
      const katana=await rpc(actor,'activate_1v1_katana',{p_match_id:matchId});assert.ok(katana.ok,`Own Katana activation failed (${katana.status})`);assert.equal(katana.data?.match_id,matchId);
    }
    report('fixture_match_score_above_200_katana_and_own_scope',{passed:true});
  };
  const expiryCheck=async()=>{
    const remaining=Math.max(...actors.map(a=>(a.firstExp??Infinity)-Date.now()/1000));
    if(remaining>=0){report('expiry_check_waiting',{secondsUntilExpiry:Math.ceil(remaining)+1});return;}
    for(const actor of actors){
      const current=actor.token;actor.token=actor.firstToken;
      const expired=await rpc(actor,'get_player_progression');expectDenied(expired,'Expired Data API JWT',[401,403]);actor.token=current;
      await cookieSession(actor);await getToken(actor);
      const fresh=await rpc(actor,'get_player_progression');assert.ok(fresh.ok,`Native post-expiry Data API request failed (${fresh.status})`);
    }
    report('actual_native_jwt_expiry_and_cookie_refresh',{passed:true});
  };
  try{
    for(const actor of actors){
      // Exactly one creation request per identity. Ambiguous failures are not
      // retried: its exact email is already recorded for coordinator cleanup.
      const result=await auth(actor,'/api/auth/sign-up/email',{method:'POST',body:{email:actor.email,password:actor.password,name:actor.username}});
      if(typeof result.data?.user?.id==='string'){assert.match(result.data.user.id,UUID);actor.id=result.data.user.id;persist();}
      assert.ok(result.ok&&actor.id,`Fixture ${actor.letter} signup failed (${result.status}); inspect only its saved exact email`);
      assert.ok(actor.jar.hasNativeSession(),'Signup did not issue a native own-origin session cookie');
      await cookieSession(actor);await signOut(actor);
      const signed=await auth(actor,'/api/auth/sign-in/email',{method:'POST',body:{email:actor.email,password:actor.password}});
      assert.ok(signed.ok,`Fixture ${actor.letter} sign-in failed (${signed.status})`);assert.equal(signed.data?.user?.id,actor.id,'Sign-in changed immutable native user ID');
      await cookieSession(actor,{bootstrap:true});const claims=await getToken(actor);actor.firstToken=actor.token;actor.firstExp=claims.exp;
      report('native_signup_signout_signin_same_id',{actor:actor.letter,passed:true});
    }
    const initialChecks=async()=>{await initializeFixtureProfiles();await verifyOwnAndIsolation();};
    const initialPassed=args.has('--interactive')?await runStagedCheck('initial_live_checks_failed',initialChecks):(await initialChecks(),true);
    report('initial_live_checks_complete',{passed:initialPassed,interactive:args.has('--interactive')});
    if(args.has('--interactive')){
      report('staged_commands',{commands:['profiles','verify','expiry','refresh','match <fixture-match-uuid>','quit'],note:'No credentials are accepted on stdin; match requires both exact synthetic fixture identities and Casual Pitch.'});
      const lines=createInterface({input:process.stdin,crlfDelay:Infinity,terminal:false});
      for await(const raw of lines){
        const [command,arg,...extra]=raw.trim().split(/\s+/);
        if(command==='quit'&&!arg&&!extra.length){lines.close();break;}
        await runStagedCheck('staged_check_failed',async()=>{
          assert.equal(extra.length,0,'Unexpected command arguments');
          if(command==='profiles'&&!arg)await initializeFixtureProfiles();
          else if(command==='verify'&&!arg)await verifyOwnAndIsolation();
          else if(command==='expiry'&&!arg)await expiryCheck();
          else if(command==='refresh'&&!arg){for(const actor of actors){await cookieSession(actor);await getToken(actor);}report('forced_native_token_refresh',{passed:true,actualExpiryProven:false});}
          else if(command==='match'&&arg)await verifyMatch(arg);
          else throw new Error('Unsupported staged command');
        });
      }
    }
  }finally{
    for(const actor of actors){
      if(actor.jar.hasNativeSession())try{await signOut(actor);}catch{report('fixture_signout_cleanup_pending',{actor:actor.letter});}
      actor.password=null;actor.token=null;actor.firstToken=null;actor.jar.clear();
    }
    report('credentials_discarded',{accountRowsDeleted:false,cleanupManifest:fixturePath});
  }
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  main().catch(error=>{report('live_check_failed',{errorCode:safeFailureCode(error)});process.exitCode=1;});
}
