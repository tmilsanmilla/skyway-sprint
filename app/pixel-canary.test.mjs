import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createHmac,randomUUID} from 'node:crypto';
import * as jose from 'jose';
import ts from 'typescript';
import {SKYWAY_ORIGIN} from '../lib/pixel-pulse-rules.ts';
const source=readFileSync(new URL('../lib/pixel-canary-server.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const imports={'server-only':{},'node:crypto':{createHmac,randomUUID},'jose':jose,'./pixel-pulse-rules.ts':{SKYWAY_ORIGIN}};
const api={};new Function('require','exports',compiled)(name=>imports[name]??(()=>{throw new Error('Unexpected import');})(),api);
const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222',now=2_000_000_000;
const previous={ids:process.env.PIXEL_PULSE_CANARY_NATIVE_IDS,secret:process.env.NEON_AUTH_COOKIE_SECRET};
const secret='offline-canary-cookie-secret-only'.repeat(2);process.env.PIXEL_PULSE_CANARY_NATIVE_IDS=`${a},${b}`;process.env.NEON_AUTH_COOKIE_SECRET=secret;
test.after(()=>{for(const[name,value]of Object.entries({PIXEL_PULSE_CANARY_NATIVE_IDS:previous.ids,NEON_AUTH_COOKIE_SECRET:previous.secret}))if(value===undefined)delete process.env[name];else process.env[name]=value;});
const key=createHmac('sha256',secret).update('skyway-pixel-canary-gate:v1').digest();
test('signed canary admits only exact configured native UUID and15minute fixed-origin feature purpose',async()=>{
 const token=await api.issuePixelCanary(a,SKYWAY_ORIGIN,now),value=await api.verifyPixelCanary(token,SKYWAY_ORIGIN,now);
 assert.equal(value.nativeUserId,a);assert.equal(value.expiresAt,now+900);assert.ok(value.jti);
 const claims=jose.decodeJwt(token);assert.equal(claims.purpose,'skyway-pixel-canary-gate');assert.equal(claims.canary_version,1);assert.equal('role'in claims,false);
});
test('expired, forged, missing, cross-origin and allowlist-removed canaries fail closed',async()=>{
 const token=await api.issuePixelCanary(a,SKYWAY_ORIGIN,now);
 assert.equal(await api.verifyPixelCanary(token,SKYWAY_ORIGIN,now+900),null);
 assert.equal(await api.verifyPixelCanary(token.slice(0,-2)+'xx',SKYWAY_ORIGIN,now),null);
 assert.equal(await api.verifyPixelCanary(undefined,SKYWAY_ORIGIN,now),null);
 assert.equal(await api.verifyPixelCanary(token,'https://other.example.invalid',now),null);
 process.env.PIXEL_PULSE_CANARY_NATIVE_IDS=b;try{assert.equal(await api.verifyPixelCanary(token,SKYWAY_ORIGIN,now),null);await assert.rejects(()=>api.issuePixelCanary(a,SKYWAY_ORIGIN,now));}finally{process.env.PIXEL_PULSE_CANARY_NATIVE_IDS=`${a},${b}`;}
});
for(const[field,value]of Object.entries({iss:'https://evil.invalid',aud:[SKYWAY_ORIGIN],purpose:'session',canary_version:2,sub:'33333333-3333-4333-8333-333333333333',jti:'not-a-uuid',iat:now+1,exp:now+901,origin:'https://evil.invalid'}))test(`signed canary rejects mismatched ${field}`,async()=>{
 const valid=jose.decodeJwt(await api.issuePixelCanary(a,SKYWAY_ORIGIN,now));const token=await new jose.SignJWT({...valid,[field]:value}).setProtectedHeader({alg:'HS256',typ:'skyway-pixel-canary+jwt'}).sign(key);
 assert.equal(await api.verifyPixelCanary(token,SKYWAY_ORIGIN,now),null);
});
test('canary key is domain-separated from managed cookies and corrupt allowlist rejects all',async()=>{
 const claims=jose.decodeJwt(await api.issuePixelCanary(a,SKYWAY_ORIGIN,now));const token=await new jose.SignJWT(claims).setProtectedHeader({alg:'HS256',typ:'skyway-pixel-canary+jwt'}).sign(new TextEncoder().encode(secret));
 assert.equal(await api.verifyPixelCanary(token,SKYWAY_ORIGIN,now),null);
 process.env.PIXEL_PULSE_CANARY_NATIVE_IDS=`${a},*`;try{await assert.rejects(()=>api.issuePixelCanary(a,SKYWAY_ORIGIN,now));}finally{process.env.PIXEL_PULSE_CANARY_NATIVE_IDS=`${a},${b}`;}
 const server=readFileSync(new URL('../lib/pixel-pulse-server.ts',import.meta.url),'utf8');assert.match(server,/secure: process.env.NODE_ENV === "production"/);assert.match(server,/sameSite: "lax"/);
});
