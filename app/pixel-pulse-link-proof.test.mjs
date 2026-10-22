import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash,randomUUID} from 'node:crypto';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';
import {readFileSync} from 'node:fs';
import {pixelLinkFlowDigest,verifyPixelFreshLinkProof,assertExpectedPixelActor,pixelCallbackValues,pixelNativeOwnership} from '../lib/pixel-pulse-link-proof.ts';
import {verifyPixelCredentialStatus} from '../lib/pixel-pulse-runtime-proof.ts';
import {pixelProfile,PIXEL_ISSUER,PIXEL_CLIENT_ID,SKYWAY_ORIGIN} from '../lib/pixel-pulse-rules.ts';

const {privateKey,publicKey}=await generateKeyPair('EdDSA');
const jwks={keys:[{...await exportJWK(publicKey),kid:'offline-proof-only',alg:'EdDSA',use:'sig'}]};
const now=2_000_000_000,subject='11111111-1111-4111-8111-111111111111';
const hash=value=>createHash('sha256').update(value).digest('hex');
const verifier='v'.repeat(43),state='s'.repeat(43),nonce='n'.repeat(43),code='owned-callback-code';
const flow={client_id:PIXEL_CLIENT_ID,redirect_uri:SKYWAY_ORIGIN+'/api/pixel-pulse/callback',response_type:'code',scope:'openid profile email',state,nonce,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256',pixel_intent:'link'};
const expected={subject,credentialVersion:3,code,verifier,flow};
const claims={iss:PIXEL_ISSUER,aud:PIXEL_CLIENT_ID,sub:subject,jti:randomUUID(),iat:now,exp:now+30,auth_time:now-10,purpose:'pixel-pulse-fresh-link',link_proof_version:1,intent:'link',amr:['pwd'],credential_version:3,flow_hash:pixelLinkFlowDigest(flow),oauth_state_hash:hash(state),oauth_nonce_hash:hash(nonce),pkce_challenge:flow.code_challenge,redirect_uri:flow.redirect_uri,authorization_code_hash:hash(code)};
const sign=payload=>new SignJWT(payload).setProtectedHeader({alg:'EdDSA',kid:'offline-proof-only'}).sign(privateKey);

test('actual signed fresh proof accepts only independently stored subject and exact v1 transaction',async()=>{
 const proof=await sign(claims);const verified=await verifyPixelFreshLinkProof(proof,expected,jwks,now);
 assert.equal(verified.jti,claims.jti);assert.equal(verified.credential_version,3);
});
for(const [field,value] of Object.entries({iss:'https://evil.invalid',aud:[PIXEL_CLIENT_ID],sub:randomUUID(),jti:'11111111-1111-1111-8111-111111111111',purpose:'pixel-pulse-account-management',link_proof_version:2,intent:'create',amr:['cookie'],credential_version:2,flow_hash:'0'.repeat(64),oauth_state_hash:'0'.repeat(64),oauth_nonce_hash:'0'.repeat(64),pkce_challenge:'x'.repeat(43),redirect_uri:'https://evil.invalid/callback',authorization_code_hash:'0'.repeat(64),auth_time:now-91,iat:now+1,exp:now+31})) {
 test(`fresh linking rejects signed mismatch: ${field}`,async()=>assert.rejects(()=>sign({...claims,[field]:value}).then(proof=>verifyPixelFreshLinkProof(proof,expected,jwks,now))));
}
test('proof cannot exceed original90s confirmation even if individual issuance lifetime is30s',async()=>{
 const proof=await sign({...claims,auth_time:now-80,exp:now+20});await assert.rejects(()=>verifyPixelFreshLinkProof(proof,expected,jwks,now));
});
test('proof rejects absent/wrong signatures and a current verifier on a different flow',async()=>{
 const proof=await sign(claims);
 await assert.rejects(()=>verifyPixelFreshLinkProof('true',expected,jwks,now));
 await assert.rejects(()=>verifyPixelFreshLinkProof(proof,expected,{keys:[]},now));
 for(const altered of [{...expected,code:'other'},{...expected,verifier:'x'.repeat(43)},{...expected,credentialVersion:4},{...expected,flow:{...flow,state:'x'.repeat(43)}},{...expected,flow:{...flow,pixel_intent:'create'}},{...expected,flow:{...flow,client_id:'other'}}]) await assert.rejects(()=>verifyPixelFreshLinkProof(proof,altered,jwks,now));
});
test('verified identity pins scalar issuer/audience and matching profile/credential epochs',()=>{
 const identity={iss:PIXEL_ISSUER,aud:PIXEL_CLIENT_ID,sub:subject,preferred_username:'owned_player',email:'owned@example.invalid',email_verified:true,profile_version:2,credential_version:3};
 assert.equal(pixelProfile(identity,identity).credentialVersion,3);
 for(const patch of [{aud:[PIXEL_CLIENT_ID]},{iss:'https://evil.invalid'},{profile_version:-1},{credential_version:1.2},{credential_version:undefined}]) assert.throws(()=>pixelProfile({...identity,...patch},identity));
 assert.throws(()=>pixelProfile(identity,{...identity,profile_version:3}));
 const actor={subject,profileVersion:2,credentialVersion:3,emailVerified:true};
 assert.doesNotThrow(()=>assertExpectedPixelActor(actor,actor));
 for(const patch of [{subject:randomUUID()},{profileVersion:3},{credentialVersion:4},{emailVerified:false}]) assert.throws(()=>assertExpectedPixelActor({...actor,...patch},actor));
});
test('callback rejects duplicate code/state/issuer/tickets and accepts exactly one pinned issuer',()=>{
 const url=new URL(flow.redirect_uri);for(const [key,value] of Object.entries({state,code,iss:PIXEL_ISSUER}))url.searchParams.set(key,value);
 assert.deepEqual(pixelCallbackValues(url),{state,code,ticket:null});
 for(const key of ['state','code','iss','pixel_link_ticket']) {const bad=new URL(url);if(key==='pixel_link_ticket')bad.searchParams.set(key,'one');bad.searchParams.append(key,'other');assert.throws(()=>pixelCallbackValues(bad));}
});
test('native ownership requires fresh same-user managed session not only a cookie/user id',()=>{
 const timestamp=now*1000,session={user:{id:subject},session:{id:'owned-native-session',userId:subject,createdAt:new Date(timestamp-1000).toISOString(),expiresAt:new Date(timestamp+60000).toISOString()}};
 assert.deepEqual(pixelNativeOwnership(session,timestamp),{native_user_id:subject,native_session_id:'owned-native-session'});
 for(const patch of [{userId:randomUUID()},{id:''},{createdAt:new Date(timestamp-91000).toISOString()},{createdAt:new Date(timestamp+1000).toISOString()},{expiresAt:new Date(timestamp-1).toISOString()}])assert.throws(()=>pixelNativeOwnership({...session,session:{...session.session,...patch}},timestamp));
 assert.throws(()=>pixelNativeOwnership({user:{id:subject}},timestamp));
 assert.throws(()=>pixelNativeOwnership({...session,user:{id:'-'.repeat(36)},session:{...session.session,userId:'-'.repeat(36)}},timestamp));
});
const status={iss:PIXEL_ISSUER,aud:PIXEL_CLIENT_ID,sub:subject,jti:randomUUID(),iat:now,exp:now+30,purpose:'pixel-pulse-credential-status',credential_check_version:1,credential_version:4,nonce,request_jti:claims.jti};
test('signed current credential status is nonce/request bound and exposes only currentepoch/shortexpiry',async()=>{
 assert.deepEqual(await verifyPixelCredentialStatus(await sign(status),{subject,nonce,requestJti:claims.jti},jwks,now),{credential_version:4,exp:now+30,sub:subject});
});
for(const [field,value] of Object.entries({iss:'https://evil.invalid',aud:[PIXEL_CLIENT_ID],sub:randomUUID(),purpose:'pixel-pulse-fresh-link',credential_check_version:2,credential_version:-1,nonce:'other',request_jti:randomUUID(),jti:'invalid',iat:now-31,exp:now+31}))test(`runtime status rejects signed mismatch: ${field}`,async()=>assert.rejects(()=>sign({...status,[field]:value}).then(token=>verifyPixelCredentialStatus(token,{subject,nonce,requestJti:claims.jti},jwks,now))));

test('receiver has separate discovery then explicit Link/Create; ordinary return cannot adopt by email',()=>{
 const route=readFileSync(new URL('./api/pixel-pulse/[action]/route.ts',import.meta.url),'utf8');
 assert.match(route,/phase: "discovery"/);assert.match(route,/pixel_signin_bound/);assert.match(route,/pixel_discovery_save/);
 assert.match(route,/action === "confirm-start"/);assert.match(route,/pixelNativeOwnership\(data\)/);
 assert.match(route,/pixel_attempt_begin_v2/);assert.match(route,/pixel_attempt_take_v2/);assert.match(route,/pixel_bind_account_v2/);
 assert.doesNotMatch(route,/pixel_bind_account\(/);assert.doesNotMatch(route,/pixel_intent: "create"/);
 assert.match(route,/session_hash: pixelHash\(raw\)/);assert.match(route,/proof_jti: proof.jti/);
 const server=readFileSync(new URL('../lib/pixel-pulse-server.ts',import.meta.url),'utf8');
 assert.match(server,/pixel_session_confirm_lease/);assert.match(server,/pixelTokenExpiresAt/);
 assert.match(server,/skyway_auth: "pixel"/);assert.match(server,/pixel_session_hash: session.token_hash/);
 assert.doesNotMatch(server.slice(server.indexOf('export async function redeemPixelLink'),server.indexOf('let nativeKeys')),/headers:.*(?:Cookie|Origin):/);
 assert.doesNotMatch(server.slice(server.indexOf('export async function getPixelSession')),/headers:.*(?:Cookie|Origin):/);
 assert.ok(route.indexOf('pixel_retire_credentials')<route.indexOf('const profile = pixelProfile'));
 const request=readFileSync(new URL('../lib/neon-auth-request-server.ts',import.meta.url),'utf8');
 assert.match(request,/pixel_native_admission/);assert.match(request,/disableCookieCache: "true"/);
});
