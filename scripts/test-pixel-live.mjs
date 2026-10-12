// Exact synthetic fixtures only. No real account credentials or tokens are printed.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {Pool} from 'pg';
const project='odd-unit-44587143',branch='br-holy-math-axs9gjmb',origin='https://skyway-sprint.vercel.app';
const {access_token}=JSON.parse(readFileSync('/Users/lucas/.config/neon/credentials.json','utf8'));
async function api(path,method='GET',body){
 for(let attempt=0;attempt<5;attempt++){
  const response=await fetch('https://console.neon.tech/api/v2'+path,{method,headers:{Authorization:'Bearer '+access_token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
  const text=await response.text(); const value=text?JSON.parse(text):{};
  if(response.status===423&&attempt<4){await new Promise(resolve=>setTimeout(resolve,2000));continue;}
  if(!response.ok)throw new Error('Neon setup failed ('+response.status+'): '+String(value.message||value.error||'unknown'));return value;
 }
}
const current=await api(`/projects/${project}/branches/${branch}/data-api/neondb`);
const auth=await api(`/projects/${project}/branches/${branch}/auth`);
async function nativeProbe(){const response=await fetch(auth.base_url+'/token/anonymous',{headers:{Origin:origin}});assert.equal(response.status,200);const {token}=await response.json();const probe=await fetch(current.url+'/extraction_catalog?select=item_key&limit=1',{headers:{Origin:origin,Authorization:'Bearer '+token}});return {status:probe.status,body:await probe.text()};}
const nativeBefore=await nativeProbe();
const keysResponse=await fetch(origin+'/api/pixel-pulse/database-keys');assert.equal(keysResponse.status,200);assert.ok((await keysResponse.json()).keys.length>=2);
const {uri}=await api(`/projects/${project}/connection_uri?${new URLSearchParams({branch_id:branch,database_name:'neondb',role_name:'neondb_owner'})}`);
const pool=new Pool({connectionString:uri,max:1});const db=await pool.connect();
const subject=randomUUID(),username='px_'+randomBytes(8).toString('hex'),email=username+'@example.invalid',raw=randomBytes(32).toString('base64url');
const hash=createHash('sha256').update(raw).digest('hex');let user;
const nativeName='nt_'+randomBytes(8).toString('hex'), nativeEmail=nativeName+'@example.invalid', nativePassword=randomBytes(32).toString('base64url');
let nativeUser;
try{
 assert.equal((await db.query("select current_setting('neon.branch_id') as branch")).rows[0].branch,branch);
 const jar=new Map();
 async function nativeRequest(path,body){
  const response=await fetch(origin+'/api/auth/'+path,{method:body?'POST':'GET',headers:{Origin:origin,'Content-Type':'application/json',Cookie:[...jar].map(([k,v])=>k+'='+v).join('; ')},...(body?{body:JSON.stringify(body)}:{})});
  for(const entry of response.headers.getSetCookie()){const first=entry.split(';')[0],i=first.indexOf('=');if(i>0)jar.set(first.slice(0,i),first.slice(i+1));}
  return response;
 }
 const signup=await nativeRequest('sign-up/email',{name:nativeName,email:nativeEmail,password:nativePassword});
 assert.equal(signup.status,200,'Native temporary signup failed');
 nativeUser=(await signup.json()).user?.id;assert.ok(nativeUser);
 await nativeRequest('sign-out',{});jar.clear();
 const signin=await nativeRequest('sign-in/email',{email:nativeEmail,password:nativePassword});assert.equal(signin.status,200,'Native password sign-in failed');
 assert.equal((await signin.json()).user?.id,nativeUser);
 const nativeTokenResponse=await nativeRequest('token');assert.equal(nativeTokenResponse.status,200);
 const nativeToken=(await nativeTokenResponse.json()).token;assert.ok(nativeToken);
 const nativeOwn=await fetch(current.url+'/player_stats?select=user_id&user_id=eq.'+nativeUser,{headers:{Origin:origin,Authorization:'Bearer '+nativeToken}});
 assert.equal(nativeOwn.status,200,'Native signed-user database access failed');assert.deepEqual(await nativeOwn.json(),[{user_id:nativeUser}]);
 const bound=(await db.query('select app_private.pixel_bind_account($1,$2,$3,false,null,$4,\'create\') as profile',[subject,username,email,hash])).rows[0].profile;
 user=bound.user_id;
 const cookie='__Host-skyway_pixel_session='+raw;
 const sessionResponse=await fetch(origin+'/api/pixel-pulse/session',{headers:{Cookie:cookie}});assert.equal(sessionResponse.status,200);
 const {session}=await sessionResponse.json();assert.equal(session?.user.id,user);
 const token=session.access_token;
 assert.ok((await(await fetch(origin+'/api/pixel-pulse/database-keys')).json()).keys.some(key=>key.kid===JSON.parse(Buffer.from(token.split('.')[0],'base64url').toString()).kid),'Token key is not in the trusted public set');
 const claims=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString());
 assert.equal(claims.role,'authenticated');assert.equal(claims.sub,user);assert.deepEqual(claims.aud,[new URL(auth.base_url).origin,origin]);
 const headers={Origin:origin,Authorization:'Bearer '+token,'Content-Type':'application/json'};
 const ownResponse=await fetch(current.url+'/player_stats?select=user_id,high_score,total_gems&user_id=eq.'+user,{headers});
 const own=await ownResponse.json();assert.equal(ownResponse.status,200,JSON.stringify(own));assert.equal(own.length,1);assert.equal(own[0].user_id,user);
 const otherResponse=await fetch(current.url+'/player_stats?select=user_id&user_id=neq.'+user,{headers});assert.equal(otherResponse.status,200);assert.deepEqual(await otherResponse.json(),[]);
 const infoResponse=await fetch(current.url+'/rpc/get_my_pixel_identity',{method:'POST',headers,body:'{}'});assert.equal(infoResponse.status,200);assert.equal((await infoResponse.json()).username,username);
 const roleResponse=await fetch(current.url+'/rpc/is_admin',{method:'POST',headers,body:'{}'});assert.equal(roleResponse.status,200);assert.equal(await roleResponse.json(),false);
 const privateResponse=await fetch(current.url+'/pixel_sessions',{headers:{...headers,'Accept-Profile':'app_private'}});assert.ok([400,404,406].includes(privateResponse.status));
 const forgedCookie=await fetch(origin+'/api/pixel-pulse/session',{headers:{Cookie:'__Host-skyway_pixel_session='+randomBytes(32).toString('base64url')}});assert.equal((await forgedCookie.json()).session,null);
 const signedOut=await fetch(origin+'/api/pixel-pulse/signout',{method:'POST',headers:{Origin:origin,Cookie:cookie}});assert.equal(signedOut.status,200);
 assert.equal((await(await fetch(origin+'/api/pixel-pulse/session',{headers:{Cookie:cookie}})).json()).session,null);
 assert.deepEqual(await nativeProbe(),nativeBefore);
 assert.deepEqual((await api(`/projects/${project}/branches/${branch}/data-api/neondb`)).settings,current.settings);
 console.log(JSON.stringify({passed:true,pixelToken:true,nativePasswordSignIn:true,nativeSignedUserData:true,nativeAnonymousUnchanged:true,ownRowsOnly:true,noAdminPrivilege:true,privateSchemaDenied:true,cookieRevoked:true,dataApiSettingsUnchanged:true}));
}finally{
 if(user){await db.query('begin');await db.query('delete from app_private.pixel_sessions where subject=$1',[subject]);await db.query('delete from app_private.pixel_links where subject=$1 and user_id=$2',[subject,user]);await db.query('delete from neon_auth."user" where id=$1 and email=$2',[user,email]);await db.query('commit');}
 await db.query('delete from neon_auth."user" where email=$1 and name=$2',[nativeEmail,nativeName]);
 db.release();await pool.end();
}
