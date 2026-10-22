import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import ts from 'typescript';
import * as jose from 'jose';
import * as rules from '../lib/pixel-pulse-rules.ts';
import * as linkRules from '../lib/pixel-pulse-link-proof.ts';
import * as runtimeRules from '../lib/pixel-pulse-runtime-proof.ts';

// Real receiver signing/verifier code with local throwaway keys and mocked I/O.
// No existing credentials, network request, native account or database is used.
const {privateKey:gamePrivate,publicKey:gamePublic}=await jose.generateKeyPair('RS256',{extractable:true});
const gameJwk={...await jose.exportJWK(gamePrivate),kid:'offline-game-only',alg:'RS256'};
const {privateKey:centralPrivate,publicKey:centralPublic}=await jose.generateKeyPair('EdDSA');
const centralJwks={keys:[{...await jose.exportJWK(centralPublic),kid:'offline-central-only',alg:'EdDSA',use:'sig'}]};
const subject='11111111-1111-4111-8111-111111111111',userId='22222222-2222-4222-8222-222222222222',raw='p'.repeat(43),hash=value=>createHash('sha256').update(value).digest('hex');
const compiled=path=>ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const serverCode=compiled('../lib/pixel-pulse-server.ts');
const requestCode=compiled('../lib/neon-auth-request-server.ts');
const load=(source,imports)=>{const exports={};new Function('require','exports',source)(name=>{if(!(name in imports))throw new Error('Unexpected import '+name);return imports[name];},exports);return exports;};
function serverHarness(options={}) {
 const calls=[];const saved={user_id:userId,subject,username:'owned_player',email:'owned@example.invalid',email_verified:true,created_at:new Date().toISOString(),expires_at:new Date(Date.now()+86400000).toISOString(),credential_version:3,token_hash:hash(raw),runtime_lease_until:new Date(Date.now()-1000).toISOString()};
 const sql=async(strings,...values)=>{const name=strings.join('?').match(/app_private\.([a-z_0-9]+)/)?.[1];calls.push({name,values});if(name==='pixel_session_get')return[{session:options.missing?null:saved}];if(name==='pixel_session_confirm_lease')return[{session:options.decline?null:{...saved,runtime_lease_until:values[3]}}];throw new Error('Unexpected DB call');};
 const jar={get:()=>options.cookie===null?undefined:{value:options.cookie??raw}};
 const server=load(serverCode,{'server-only':{},'node:crypto':{createHash,randomBytes:size=>Buffer.alloc(size,1),randomUUID},'next/headers':{cookies:async()=>jar},'jose':jose,'openid-client':{},'@/lib/neon-server':{neonServerSql:sql},'@/lib/pixel-pulse-rules':rules,'@/lib/pixel-pulse-link-proof':linkRules,'@/lib/pixel-pulse-runtime-proof':runtimeRules});
 const fetch=async(url,init)=>{
  calls.push({name:'http',url:String(url),init});
  assert.equal(new Headers(init?.headers).has('Cookie'),false);assert.equal(new Headers(init?.headers).has('Origin'),false);assert.equal(init.redirect,'error');
  if(String(url)===rules.PIXEL_ISSUER+'/jwks')return Response.json(centralJwks);
  assert.equal(String(url),rules.PIXEL_ISSUER+'/pixel-pulse/credential-status');assert.equal(init.method,'POST');assert.equal(init.body,'{}');
  if(options.outage)throw new Error('synthetic network outage');
  const request=await jose.jwtVerify(new Headers(init.headers).get('Authorization').replace(/^Bearer /,''),gamePublic,{issuer:rules.SKYWAY_ORIGIN,audience:rules.PIXEL_ISSUER,algorithms:['RS256']});
  assert.equal(request.payload.sub,subject);assert.equal(request.payload.purpose,'pixel-pulse-credential-check');assert.equal(request.payload.client_id,rules.PIXEL_CLIENT_ID);assert.equal(request.payload.credential_check_version,1);assert.equal(request.payload.exp-request.payload.iat,30);
  const now=Math.floor(Date.now()/1000);const status={iss:rules.PIXEL_ISSUER,aud:rules.PIXEL_CLIENT_ID,sub:subject,jti:randomUUID(),iat:now,exp:now+30,purpose:'pixel-pulse-credential-status',credential_check_version:1,credential_version:options.epoch??3,nonce:request.payload.nonce,request_jti:request.payload.jti,...options.statusPatch};
  return Response.json({proof:await new jose.SignJWT(status).setProtectedHeader({alg:'EdDSA',kid:'offline-central-only'}).sign(centralPrivate)});
 };
 return{server,calls,fetch,saved};
}
const before={enabled:process.env.PIXEL_PULSE_ENABLED,key:process.env.PIXEL_PULSE_GAME_SIGNING_KEY,native:process.env.NEON_AUTH_BASE_URL};
process.env.PIXEL_PULSE_ENABLED='true';process.env.PIXEL_PULSE_GAME_SIGNING_KEY=JSON.stringify(gameJwk);process.env.NEON_AUTH_BASE_URL='https://native.example.invalid/auth';
test.after(()=>{for(const [name,value]of Object.entries({PIXEL_PULSE_ENABLED:before.enabled,PIXEL_PULSE_GAME_SIGNING_KEY:before.key,NEON_AUTH_BASE_URL:before.native}))if(value===undefined)delete process.env[name];else process.env[name]=value;});
async function withFetch(h,action){const original=globalThis.fetch;globalThis.fetch=h.fetch;try{return await action();}finally{globalThis.fetch=original;}}

test('actual session renewal verifies signed nonce-bound epoch and caps game JWT to central30s lease',async()=>{
 const h=serverHarness();await withFetch(h,async()=>{const session=await h.server.getPixelSession();assert.equal(session.user_id,userId);assert.equal(h.calls.find(c=>c.name==='pixel_session_confirm_lease').values[2],3);const jwt=await h.server.pixelAccessToken(session);const {payload}=await jose.jwtVerify(jwt,gamePublic,{issuer:rules.SKYWAY_ORIGIN+'/api/pixel-pulse',audience:rules.SKYWAY_ORIGIN,algorithms:['RS256']});assert.equal(payload.sub,userId);assert.equal(payload.role,'authenticated');assert.equal(payload.skyway_auth,'pixel');assert.equal(payload.pixel_subject,subject);assert.equal(payload.pixel_credential_version,3);assert.equal(payload.pixel_session_hash,hash(raw));assert.ok(payload.exp<=Math.floor(Date.now()/1000)+30);assert.equal(payload.exp,h.server.pixelTokenExpiresAt(session));});
});
test('presented missing/revoked/malformed/empty Pixel cookies never look like anonymous native fallback',async()=>{
 for(const options of [{missing:true},{cookie:'malformed'},{cookie:''}]){const h=serverHarness(options);await withFetch(h,()=>assert.rejects(()=>h.server.getPixelSession()));}
 const h=serverHarness({cookie:null});await withFetch(h,async()=>assert.equal(await h.server.getPixelSession(),null));assert.equal(h.calls.length,0);
});
test('central outage, bad signature context or expired status cannot renew or mint a stale lease',async()=>{
 for(const options of [{outage:true},{statusPatch:{aud:[rules.PIXEL_CLIENT_ID]}},{statusPatch:{nonce:'other'}},{statusPatch:{request_jti:randomUUID()}},{statusPatch:{exp:Math.floor(Date.now()/1000)-1}}]){const h=serverHarness(options);await withFetch(h,()=>assert.rejects(()=>h.server.getPixelSession()));assert.equal(h.calls.filter(c=>c.name==='pixel_session_confirm_lease').length,0);}
 const h=serverHarness();await assert.rejects(()=>h.server.pixelAccessToken(h.saved));
});
test('higher central credential epoch reaches atomic retirement before returning reauthentication failure',async()=>{
 const h=serverHarness({epoch:4,decline:true});await withFetch(h,()=>assert.rejects(()=>h.server.getPixelSession()));const confirmation=h.calls.find(c=>c.name==='pixel_session_confirm_lease');assert.equal(confirmation.values[1],subject);assert.equal(confirmation.values[2],4);assert.equal(confirmation.values[0],hash(raw));
});
function requestHarness(pixelResult,nativeAllowed=true) {
 const calls=[];const imports={'server-only':{},'@/lib/neon-auth-server':{neonAuth:{getSession:async args=>{calls.push({name:'native',args});return{data:{user:{id:userId,email:'owned@example.invalid'},session:{id:'native'}}};}}},'@/lib/pixel-pulse-server':{getPixelSession:async()=>{if(pixelResult instanceof Error)throw pixelResult;return pixelResult;}},'@/lib/neon-server':{neonServerSql:async()=>{calls.push({name:'admission'});return[{allowed:nativeAllowed}];}}};
 return{request:load(requestCode,imports),calls};
}
test('actual account/realtime verifier never falls back to any native cookie after Pixel failure',async()=>{
 const h=requestHarness(new Error('synthetic Pixel outage'));await assert.rejects(()=>h.request.verifyNeonRequest());assert.equal(h.calls.length,0);
});
test('actual native verifier bypasses cache and denies linked native account without altering password',async()=>{
 const denied=requestHarness(null,false);assert.equal(await denied.request.verifyNeonRequest(),null);assert.deepEqual(denied.calls[0].args,{query:{disableCookieCache:'true'}});assert.equal(denied.calls[1].name,'admission');const allowed=requestHarness(null,true);assert.equal((await allowed.request.verifyNeonRequest()).user.id,userId);
});
