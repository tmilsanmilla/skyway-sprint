import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {OwnCookieJar,tokenClaims,expectDenied,expectBusinessRejection,expectNoRowsOrDenied,expectPrivateProfileHidden,runStagedCheck} from '../scripts/test-update-2-3-live.mjs';

test('live harness cookie jar preserves own native rotations and clears signout cookies without leaking them to foreign hosts',()=>{
 const jar=new OwnCookieJar(),headers=new Headers();
 headers.append('set-cookie','__Secure-neon-auth.session_token=fixture-opaque; Path=/; Secure; HttpOnly; SameSite=Strict');
 headers.append('set-cookie','__Secure-neon-auth.local.session_data=fixture-local; Path=/; Secure; HttpOnly');
 jar.receive(headers);assert.equal(jar.hasNativeSession(),true);assert.match(jar.header('/api/auth/token'),/session_token=fixture-opaque/);
 const deletion=new Headers();deletion.append('set-cookie','__Secure-neon-auth.session_token=; Path=/; Max-Age=0');jar.receive(deletion);assert.equal(jar.hasNativeSession(),false);
 const foreign=new Headers();foreign.append('set-cookie','__Secure-neon-auth.session_token=x; Domain=unrelated.example; Path=/');assert.throws(()=>jar.receive(foreign));
});
test('known installed private profile may be unexposed as404 without accepting a missing RPC or absent public control',()=>{
 const controls={ownPublicControl:true,installedTableVerified:true};
 for(const status of [400,403,404,406])assert.doesNotThrow(()=>expectPrivateProfileHidden({ok:false,status,data:{code:status===404?'PGRST205':'PGRST106'}},controls));
 for(const status of [200,401,429,500])assert.throws(()=>expectPrivateProfileHidden({ok:status===200,status},controls));
 assert.throws(()=>expectPrivateProfileHidden({ok:false,status:404,data:{code:'PGRST202'}},controls));
 assert.throws(()=>expectPrivateProfileHidden({ok:false,status:404},{...controls,ownPublicControl:false}));
 assert.throws(()=>expectDenied({ok:false,status:404},'unowned RPC'));
});
test('interactive assertion failure can be retested without disposing credentials and only emits an error code',async()=>{
 const outputs=[];let nextCheck=false;
 assert.equal(await runStagedCheck('initial',async()=>{assert.fail('must never echo this credential-like body');},(check,fields)=>outputs.push({check,...fields})),false);
 assert.deepEqual(outputs,[{check:'initial',passed:false,errorCode:'ASSERTION_FAILED',credentialsRetainedInMemory:true}]);
 assert.equal(await runStagedCheck('retry',async()=>{nextCheck=true;}),true);assert.equal(nextCheck,true);
 const source=readFileSync(new URL('../scripts/test-update-2-3-live.mjs',import.meta.url),'utf8');
 assert.match(source,/rpc\(actor,'set_player_username',\{new_username:actor\.username\}\)/);
 assert.match(source,/profile\.data\[0\]\.username,actor\.username/);
});
test('live harness stays inert on import, requires explicit fixture creation, never joins queues, and persists only cleanup IDs/emails',()=>{
 const source=readFileSync(new URL('../scripts/test-update-2-3-live.mjs',import.meta.url),'utf8');
 assert.match(source,/if\(!args\.has\('--create-fixtures'\)\)/);
 assert.match(source,/JSON\.stringify\(\{marker,fixtures:actors\.map\(a=>\(\{id:a\.id,email:a\.email\}\)\)\}/);
 assert.doesNotMatch(source,/find_1v1|join_1v1|create_1v1|DATABASE_URL|NEON_API_KEY|passwordHash|localStorage/);
 assert.match(source,/Match contains a real or unrelated account/);
 assert.match(source,/redirect:'manual'/);assert.match(source,/AbortSignal\.timeout\(25_000\)/);
 assert.match(source,/remaining>=0/);assert.match(source,/Expired Data API JWT/);
});
test('JWT helper checks format without treating an unverified payload as signature proof',()=>{
 const token=`e30.${Buffer.from(JSON.stringify({sub:'fixture',exp:123})).toString('base64url')}.signature`;
 assert.equal(tokenClaims(token).sub,'fixture');assert.throws(()=>tokenClaims('opaque-session'));
 // The live harness additionally requires actual protected Data API success;
 // this helper merely checks owner/expiry before sending the supported token.
});
test('live denial evidence refuses missing RPCs, 5xx, generic execute permissions and wrong business rules',()=>{
 for(const status of [404,429,500,503])assert.throws(()=>expectDenied({ok:false,status},'test'));
 assert.throws(()=>expectDenied({ok:false,status:400,data:{code:'PGRST202'}},'test'));
 assert.throws(()=>expectBusinessRejection({ok:false,status:403,data:{code:'42501',message:'permission denied'}},'unowned',/^Character locked$/));
 assert.throws(()=>expectBusinessRejection({ok:false,status:400,data:{code:'P0001',message:'Sign in required'}},'unowned',/^Character locked$/));
 assert.doesNotThrow(()=>expectBusinessRejection({ok:false,status:400,data:{code:'P0001',message:'Character locked'}},'unowned',/^Character locked$/));
 assert.throws(()=>expectNoRowsOrDenied({ok:false,status:500},'cross'));
 assert.throws(()=>expectNoRowsOrDenied({ok:true,status:200,data:[{user_id:'other'}]},'cross'));
 assert.doesNotThrow(()=>expectNoRowsOrDenied({ok:true,status:200,data:[]},'cross'));
 const source=readFileSync(new URL('../scripts/test-update-2-3-live.mjs',import.meta.url),'utf8');
 assert.match(source,/p_item:'runner_ace'/);assert.match(source,/cookieSession\(actor,\{bootstrap:true\}\)/);
 assert.equal((source.match(/bootstrap:true/g)||[]).length,1);
});
test('row isolation accepts only the managed gateway exact missing-bearer400 response',()=>{
 const missing={ok:false,status:400,data:{message:'missing authentication credentials: required authorization bearer token in JWT format',code:null,detail:null,hint:null}};
 assert.doesNotThrow(()=>expectNoRowsOrDenied(missing,'anonymous'));
 for(const data of [null,{message:'Bad request'},{message:missing.data.message+' '},{message:missing.data.message,code:'PGRST202'},{message:missing.data.message,code:'PGRST205'},{message:missing.data.message,code:'42501'}]){
  assert.throws(()=>expectNoRowsOrDenied({...missing,data},'anonymous'));
 }
 assert.throws(()=>expectBusinessRejection(missing,'unowned',/^Character locked$/));
});
