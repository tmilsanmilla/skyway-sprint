import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {pixelProfile,validatePixelMetadata,PIXEL_ISSUER} from '../lib/pixel-pulse-rules.ts';
const sub='11111111-1111-4111-8111-111111111111';
const profile={sub,preferred_username:'pixel_runner',email:'player@example.invalid',email_verified:false};
test('Pixel identity uses a stable subject and exact canonical profile; verification is never invented',()=>{
 assert.deepEqual(pixelProfile(profile,profile),{subject:sub,username:'pixel_runner',email:'player@example.invalid',emailVerified:false});
 for(const invalid of [{...profile,sub:'another'},{...profile,preferred_username:'another_runner'},{...profile,email:'another@example.invalid'},{...profile,email_verified:true}]) assert.throws(()=>pixelProfile(profile,invalid));
});
test('provider metadata rejects alternate issuers, endpoints, algorithms and missing issuer response protection',()=>{
 const metadata={issuer:PIXEL_ISSUER,authorization_response_iss_parameter_supported:true,id_token_signing_alg_values_supported:['EdDSA'],authorization_endpoint:PIXEL_ISSUER+'/oauth2/authorize',token_endpoint:PIXEL_ISSUER+'/oauth2/token',userinfo_endpoint:PIXEL_ISSUER+'/oauth2/userinfo',jwks_uri:PIXEL_ISSUER+'/jwks'};
 assert.equal(validatePixelMetadata(metadata),'EdDSA');
 for(const invalid of [{...metadata,issuer:'https://evil.invalid'},{...metadata,jwks_uri:'https://evil.invalid/keys'},{...metadata,authorization_response_iss_parameter_supported:false},{...metadata,id_token_signing_alg_values_supported:['none']}]) assert.throws(()=>validatePixelMetadata(invalid));
});
test('shared sign-in binds state, nonce and PKCE; never forces a new provider password or imports admin roles',()=>{
 const source=readFileSync(new URL('./api/pixel-pulse/[action]/route.ts',import.meta.url),'utf8');
 assert.match(source,/code_challenge_method: "S256"/);
 assert.match(source,/expectedState: state/);assert.match(source,/expectedNonce: attempt.nonce/);assert.match(source,/pkceCodeVerifier: attempt.verifier/);
 assert.doesNotMatch(source,/prompt:\s*["']login/);assert.match(source,/neonAuth.getSession\(\)/);
 assert.doesNotMatch(source,/claims\.role|claims\.admin|userInfo\.role/);
 const sql=readFileSync(new URL('../neon/pixel-pulse-02-link.sql',import.meta.url),'utf8');
 assert.match(sql,/Email, even verified email, is not game-account ownership proof/);
 assert.doesNotMatch(sql,/grant.*(?:to authenticated|to public).*pixel_bind_account/i);
 assert.match(sql,/where user_id=auth.uid\(\)/);
});
test('Pixel and native signing keys coexist, the Pixel token always uses the game UUID and fixed non-admin role',()=>{
 const source=readFileSync(new URL('../lib/pixel-pulse-server.ts',import.meta.url),'utf8');
 assert.match(source,/\.well-known\/jwks\.json/);assert.match(source,/nativeKeys.keys/);
 assert.match(source,/role: "authenticated"/);assert.match(source,/setSubject\(session.user_id\)/);
 assert.doesNotMatch(source,/setSubject\(session.subject\)|role: session\./);
 assert.match(source,/\+ 120/);
});
test('a logged-in Pixel session gets a renewable Neon Data API token, without using the native password or token endpoint',async()=>{
 process.env.NEXT_PUBLIC_PIXEL_PULSE_ENABLED='true';process.env.NEXT_PUBLIC_NEON_DATA_API_URL='https://example.neon.invalid/rest/v1';
 const oldFetch=globalThis.fetch,requests=[];let live=true;
 const jwt=`${Buffer.from(JSON.stringify({alg:'RS256'})).toString('base64url')}.${Buffer.from(JSON.stringify({sub,exp:Math.floor(Date.now()/1000)+120})).toString('base64url')}.signature`;
 const session={access_token:jwt,user:{id:sub,email:profile.email,app_metadata:{provider:'pixel-pulse'},user_metadata:{pixel_pulse:true}}};
 globalThis.fetch=async(input,init)=>{
  const url=String(input);requests.push(url);
  if(url.endsWith('/pixel-pulse/session'))return Response.json({session:live?session:null});
  if(url.endsWith('/pixel-pulse/signout')){live=false;return Response.json({ok:true});}
  if(url.endsWith('/sign-out'))return Response.json({success:true});
  if(url.includes('/rpc/get_player_progression')) {assert.equal(new Headers(init?.headers).get('Authorization'),`Bearer ${jwt}`);return Response.json({level:0});}
  throw new Error('Unexpected request: '+url);
 };
 const client=await import('./skyway-client.ts');
 try{
  const {data}=await client.supabase.auth.getSession();assert.equal(data.session.user.id,sub);
  const confirmed=await client.ensureNeonCompatibleSession(data.session);client.setDataSession(confirmed,sub);
  assert.equal((await client.supabase.rpc('get_player_progression')).data.level,0);
  assert.ok(!requests.some(url=>url.endsWith('/token')||url.endsWith('/get-session')));
  await client.supabase.auth.signOut();assert.equal(live,false);
 }finally{client.setDataSession(null,null);globalThis.fetch=oldFetch;}
});
