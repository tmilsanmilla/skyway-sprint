import assert from 'node:assert/strict';
import test from 'node:test';
process.env.NEXT_PUBLIC_PIXEL_PULSE_ENABLED='true';
process.env.NEXT_PUBLIC_NEON_DATA_API_URL='https://example.neon.invalid/rest/v1';
const uid='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222';
const client=await import('./skyway-client.ts');
const pixel=id=>({access_token:'offline-pixel-jwt',user:{id,email:'owned@example.invalid',app_metadata:{provider:'pixel-pulse'},user_metadata:{pixel_pulse:true}}});
const date=new Date().toISOString();
const nativeResponse={session:{id:'offline-native',token:'offline-token',userId:uid,createdAt:date,updatedAt:date,expiresAt:new Date(Date.now()+3600000).toISOString()},user:{id:uid,name:'Native',email:'native@example.invalid',emailVerified:true,createdAt:date,updatedAt:date}};
const flush=()=>new Promise(resolve=>setImmediate(resolve));

test('actual adapter preserves INITIAL_SESSION and refreshes duplicate same-Pixel notifications without re-sign-in',async()=>{
 const original=globalThis.fetch,events=[];let current=pixel(uid);
 globalThis.fetch=async input=>String(input).endsWith('/pixel-pulse/session')?Response.json({session:current}):Response.json(nativeResponse);
 const {data:{subscription}}=client.supabase.auth.onAuthStateChange((event,session)=>events.push({event,userId:session?.user.id??null}));
 try{
  await flush();assert.deepEqual(events,[{event:'INITIAL_SESSION',userId:uid}]);
  await subscription.callback('TOKEN_REFRESHED',null);await subscription.callback('SIGNED_IN',null);await subscription.callback('USER_UPDATED',null);
  assert.deepEqual(events.slice(1),Array.from({length:3},()=>({event:'TOKEN_REFRESHED',userId:uid})));
  current=pixel(other);await subscription.callback('SIGNED_IN',null);assert.deepEqual(events.at(-1),{event:'SIGNED_IN',userId:other});
  current=null;await subscription.callback('SIGNED_OUT',null);assert.deepEqual(events.at(-1),{event:'SIGNED_OUT',userId:null});
  await subscription.callback('PASSWORD_RECOVERY',{user:{id:uid}});assert.deepEqual(events.at(-1),{event:'PASSWORD_RECOVERY',userId:uid});
 }finally{subscription.unsubscribe();globalThis.fetch=original;}
});
test('late old Pixel check cannot override a newer identity notification or fire after unsubscribe',async()=>{
 const original=globalThis.fetch,events=[],waiting=[];let deferred=false;
 globalThis.fetch=async input=>{if(String(input).endsWith('/pixel-pulse/session'))return deferred?new Promise(resolve=>waiting.push(resolve)):Response.json({session:pixel(uid)});return Response.json(nativeResponse);};
 const {data:{subscription}}=client.supabase.auth.onAuthStateChange((event,session)=>events.push({event,userId:session?.user.id??null}));
 try{
  await flush();deferred=true;const old=subscription.callback('TOKEN_REFRESHED',null);const fresh=subscription.callback('SIGNED_IN',null);assert.equal(waiting.length,2);
  waiting[1](Response.json({session:pixel(other)}));await fresh;waiting[0](Response.json({session:pixel(uid)}));await old;assert.deepEqual(events,[{event:'INITIAL_SESSION',userId:uid},{event:'SIGNED_IN',userId:other}]);
  const pending=subscription.callback('TOKEN_REFRESHED',null);subscription.unsubscribe();waiting[2](Response.json({session:pixel(other)}));await pending;assert.equal(events.length,2);
 }finally{subscription.unsubscribe();globalThis.fetch=original;}
});
