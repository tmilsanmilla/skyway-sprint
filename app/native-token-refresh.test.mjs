import assert from 'node:assert/strict';
import test from 'node:test';

test('long runs refresh an expiring native JWT once without crossing sign-out/accounts', async () => {
  process.env.NEXT_PUBLIC_NEON_DATA_API_URL='https://example.neon.tech/neondb/rest/v1';
  const original=globalThis.fetch;
  const uid='11111111-1111-4111-8111-111111111111';
  const other='22222222-2222-4222-8222-222222222222';
  const jwt=(sub,exp)=>`${Buffer.from('{}').toString('base64url')}.${Buffer.from(JSON.stringify({sub,exp})).toString('base64url')}.signature`;
  const fresh=jwt(uid,Date.now()/1000+3600);
  let tokens=0, hold=null, answer=fresh;
  globalThis.fetch=async(input,init)=>{
    if(String(input).endsWith('/get-session')) {
      const date=new Date().toISOString();
      return Response.json({session:{id:'synthetic-session',token:jwt(uid,1),userId:uid,expiresAt:new Date(Date.now()+3600000).toISOString(),createdAt:date,updatedAt:date},user:{id:uid,name:'Fixture',email:'fixture@example.invalid',emailVerified:true,createdAt:date,updatedAt:date}});
    }
    if(String(input).endsWith('/token')) {
      tokens++;
      if(hold) await hold;
      return Response.json({token:answer});
    }
    assert.equal(new Headers(init?.headers).get('Authorization'),`Bearer ${fresh}`);
    return Response.json({ok:true});
  };
  const c=await import('./skyway-client.ts');
  const authEvents=[];
  const {data:{subscription}}=c.supabase.auth.onAuthStateChange((event,session)=>authEvents.push({event,userId:session?.user.id??null}));
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(authEvents,[{event:'INITIAL_SESSION',userId:uid}]);
  const session=(id,token)=>({user:{id,app_metadata:{}},access_token:token});
  try {
    c.setDataSession(session(uid,jwt(uid,1)),uid);
    await Promise.all([c.supabase.rpc('test_owned'),c.supabase.rpc('test_owned')]);
    assert.equal(tokens,1);
    // The actual pinned managed SDK /token endpoint returns {token}; unlike
    // get-session refreshes this must not emit SIGNED_IN or tear down a run.
    assert.deepEqual(authEvents,[{event:'INITIAL_SESSION',userId:uid}]);
    assert.equal(c.getDataAccessToken(uid),fresh);
    // A refresh completing after sign-out must never resurrect the credential.
    let release;
    hold=new Promise(resolve=>{release=resolve;});
    c.setDataSession(session(uid,jwt(uid,1)),uid);
    const pending=Promise.resolve(c.supabase.rpc('test_owned'));
    await new Promise(resolve=>setTimeout(resolve,0));
    c.setDataSession(null,null);
    release();
    const response=await pending;
    assert.ok(response.error);
    assert.equal(c.getDataAccessToken(),null);
    hold=null;answer=jwt(other,Date.now()/1000+3600);
    c.setDataSession(session(uid,jwt(uid,1)),uid);
    assert.ok((await c.supabase.rpc('test_owned')).error);
    assert.notEqual(c.getDataAccessToken(uid),answer);
  } finally {subscription.unsubscribe();c.setDataSession(null,null);globalThis.fetch=original;}
});
