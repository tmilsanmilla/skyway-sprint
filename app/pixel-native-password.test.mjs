import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import * as managedServerSdk from '@neondatabase/auth/server';

const source=readFileSync(new URL('../lib/pixel-native-password-server.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const expected={userId:'22222222-2222-4222-8222-222222222222',email:'owned@example.invalid'};
const password='owned-fixture-password-only',origin='https://skyway-sprint.vercel.app';
const previous={base:process.env.NEON_AUTH_BASE_URL,secret:process.env.NEON_AUTH_COOKIE_SECRET};
process.env.NEON_AUTH_BASE_URL='https://native.example.invalid/auth';process.env.NEON_AUTH_COOKIE_SECRET='offline-fixture-secret-only'.repeat(2);
test.after(()=>{for(const[name,value]of Object.entries({NEON_AUTH_BASE_URL:previous.base,NEON_AUTH_COOKIE_SECRET:previous.secret}))if(value===undefined)delete process.env[name];else process.env[name]=value;});
function harness(options={}) {
 const calls=[];let config;
 const createAuthServer=value=>{
  config=value;
  return{signIn:{email:async args=>{
   const ctx=await config.context();calls.push({method:'signin',args,cookies:await ctx.getCookies()});
   assert.equal(await ctx.getOrigin(),origin);assert.equal(await ctx.getHeader('cookie'),null);
   if(options.cookie!==false)ctx.setCookie('__Secure-neonauth.session_token','owned-temporary-cookie',{maxAge:60});
   if(options.throwSignin)throw new Error('synthetic provider outage');
   return options.signinError?{data:null,error:{message:'synthetic wrong password'}}:{data:{user:{id:options.userId??expected.userId,email:options.email??expected.email}},error:null};
  }},signOut:async()=>{
   const ctx=await config.context();calls.push({method:'signout',cookies:await ctx.getCookies()});
   ctx.setCookie('__Secure-neonauth.session_token','',{maxAge:0});
   return{data:null,error:options.cleanupError?{message:'synthetic cleanup outage'}:null};
  }};
 };
 const imports={'server-only':{},'@neondatabase/auth/server':{createAuthServer,resolveNeonAuthLogging:args=>{assert.deepEqual(args,{logLevel:'silent'});return{level:'silent'};}}};
 const exports={};new Function('require','exports',compiled)(name=>{assert.ok(name in imports);return imports[name];},exports);
 return{verify:exports.verifyPixelNativePassword,calls,getConfig:()=>config};
}
test('native password check uses managed email signin with isolated cookies then revokes only temporary session',async()=>{
 const h=harness();assert.deepEqual(await h.verify(expected,password,origin),{userId:expected.userId});
 assert.deepEqual(h.calls[0],{method:'signin',args:{email:expected.email,password,rememberMe:false},cookies:''});
 assert.deepEqual(h.calls[1],{method:'signout',cookies:'__Secure-neonauth.session_token=owned-temporary-cookie'});
 assert.equal((await h.getConfig().context()).getCookies(),'');assert.equal(h.getConfig().sameSite,'strict');
 assert.doesNotMatch(source,/next\/headers|neonServerSql|\.query\(|console\./);
});
for(const[name,options]of Object.entries({wrongPassword:{signinError:true},wrongUuid:{userId:'33333333-3333-4333-8333-333333333333'},wrongEmail:{email:'other@example.invalid'},providerOutage:{throwSignin:true},cleanupFailure:{cleanupError:true}}))
 test(`native password ${name} never issues proof or retains temporary cookies`,async()=>{
  const h=harness(options);await assert.rejects(()=>h.verify(expected,password,origin));
  assert.equal(h.calls.filter(c=>c.method==='signout').length,1);assert.equal((await h.getConfig().context()).getCookies(),'');
 });
test('missing or oversized password is rejected before managed API or cookie work',async()=>{
 for(const value of ['', 'p'.repeat(129)]){const h=harness();await assert.rejects(()=>h.verify(expected,value,origin));assert.equal(h.calls.length,0);}
});
test('wrong password without a newly minted session never signs out an incoming browser account',async()=>{
 const h=harness({signinError:true,cookie:false});await assert.rejects(()=>h.verify(expected,password,origin));assert.equal(h.calls.length,1);assert.equal(h.calls[0].cookies,'');
});
for(const mode of ['success','wrongUuid','wrongPassword'])test(`installed managed SDK HTTP ${mode} uses isolated authority and no browser cookie relay`,async()=>{
 const calls=[],savedFetch=globalThis.fetch,temporary='offline-temporary-session-token';
 const user={id:mode==='wrongUuid'?'33333333-3333-4333-8333-333333333333':expected.userId,email:expected.email,name:'fixture',emailVerified:true};
 const exports={};new Function('require','exports',compiled)(name=>name==='server-only'?{}:name==='@neondatabase/auth/server'?managedServerSdk:(()=>{throw new Error('Unexpected import');})(),exports);
 globalThis.fetch=async(input,init={})=>{
  const url=new URL(String(input)),headers=new Headers(init.headers);assert.equal(url.origin,'https://native.example.invalid');calls.push(url.pathname);
  if(url.pathname==='/auth/sign-in/email'){
   assert.equal(headers.get('cookie'),'');assert.equal(headers.get('origin'),origin);assert.equal(headers.get('x-neon-auth-proxy'),'nextjs');
   assert.deepEqual(JSON.parse(init.body),{email:expected.email,password,rememberMe:false});
   if(mode==='wrongPassword')return Response.json({code:'INVALID_EMAIL_OR_PASSWORD',message:'Invalid email or password'},{status:401});
   return Response.json({user,token:temporary},{headers:{'Set-Cookie':`${managedServerSdk.NEON_AUTH_SESSION_COOKIE_NAME}=${temporary}; Path=/; Max-Age=60; HttpOnly; Secure; SameSite=Strict`}});
  }
  assert.ok(headers.get('cookie')?.includes(`${managedServerSdk.NEON_AUTH_SESSION_COOKIE_NAME}=${temporary}`));assert.ok(!headers.get('cookie').includes('incoming-browser'));
  assert.ok(!String(init.body??'').includes(password));
  if(url.pathname==='/auth/get-session')return Response.json({user,session:{id:'offline-temp-id',userId:user.id,token:temporary,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+60000).toISOString()}});
  assert.equal(url.pathname,'/auth/sign-out');assert.equal(headers.get('origin'),origin);
  return Response.json({success:true},{headers:{'Set-Cookie':`${managedServerSdk.NEON_AUTH_SESSION_COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`}});
 };
 try{
  if(mode==='success')assert.deepEqual(await exports.verifyPixelNativePassword(expected,password,origin),{userId:expected.userId});
  else await assert.rejects(()=>exports.verifyPixelNativePassword(expected,password,origin));
  assert.equal(calls.filter(path=>path==='/auth/sign-out').length,mode==='wrongPassword'?0:1);
 }finally{globalThis.fetch=savedFetch;}
});
