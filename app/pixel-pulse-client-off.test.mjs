import assert from 'node:assert/strict';
import test from 'node:test';
process.env.NEXT_PUBLIC_PIXEL_PULSE_ENABLED='false';
process.env.NEXT_PUBLIC_NEON_DATA_API_URL='https://example.neon.invalid/rest/v1';
const uid='11111111-1111-4111-8111-111111111111';
const date=new Date().toISOString();
const nativeResponse={session:{id:'offline-native-session',token:'opaque-native',userId:uid,expiresAt:new Date(Date.now()+3600000).toISOString(),createdAt:date,updatedAt:date},user:{id:uid,name:'Offline',email:'offline@example.invalid',emailVerified:true,createdAt:date,updatedAt:date}};
const client=await import('./skyway-client.ts');
test('public gateOFF still checks HttpOnly Pixel cookie before normal native fallback',async()=>{
 const original=globalThis.fetch,calls=[];let stale=false;
 globalThis.fetch=async input=>{const url=String(input);calls.push(url);if(url.endsWith('/pixel-pulse/session'))return stale?Response.json({error:'reauthentication required'},{status:503}):Response.json({session:null});if(url.endsWith('/get-session'))return Response.json(nativeResponse);throw new Error('Unexpected request');};
 try{assert.equal(client.isPixelPulseAvailable,false);const result=await client.supabase.auth.getSession();assert.equal(result.data.session.user.id,uid);const nativeCount=calls.filter(url=>url.endsWith('/get-session')).length;stale=true;await assert.rejects(()=>client.supabase.auth.getSession());assert.equal(calls.filter(url=>url.endsWith('/get-session')).length,nativeCount);}
 finally{globalThis.fetch=original;}
});
test('public gateOFF explicit native password login/signout clears stale Pixel cookie first',async()=>{
 const original=globalThis.fetch,calls=[];
 globalThis.fetch=async input=>{const url=String(input);calls.push(url);if(url.endsWith('/pixel-pulse/signout'))return Response.json({ok:true});if(url.endsWith('/sign-in/email'))return Response.json({message:'synthetic denied',code:'INVALID_EMAIL_OR_PASSWORD'},{status:401});if(url.endsWith('/sign-out'))return Response.json({success:true});if(url.endsWith('/get-session'))return Response.json(nativeResponse);if(url.endsWith('/pixel-pulse/session'))return Response.json({session:null});throw new Error('Unexpected request');};
 try{await client.supabase.auth.signInWithPassword({email:'offline@example.invalid',password:'offline-fixture-not-a-real-password'});assert.ok(calls.indexOf('/api/pixel-pulse/signout')>=0);assert.ok(calls.findIndex(url=>url.endsWith('/pixel-pulse/signout'))<calls.findIndex(url=>url.endsWith('/sign-in/email')));calls.length=0;await client.supabase.auth.signOut();assert.ok(calls.findIndex(url=>url.endsWith('/pixel-pulse/signout'))<calls.findIndex(url=>url.endsWith('/sign-out')));}
 finally{globalThis.fetch=original;}
});
test('explicit native proof keeps readonly discovery and never sends Pixel password to Skyway',async()=>{
 const original=globalThis.fetch,calls=[];
 globalThis.fetch=async input=>{const url=String(input);calls.push(url);if(url.endsWith('/sign-in/email'))return Response.json({message:'synthetic denied',code:'INVALID_EMAIL_OR_PASSWORD'},{status:401});if(url.endsWith('/get-session'))return Response.json(nativeResponse);throw new Error('Unexpected request');};
 try{await client.signInForPixelLink({email:'offline@example.invalid',password:'offline-game-proof-only'});assert.ok(calls.some(url=>url.endsWith('/sign-in/email')));assert.equal(calls.some(url=>url.endsWith('/pixel-pulse/signout')),false);}
 finally{globalThis.fetch=original;}
});
test('gateOFF native auth events cannot bypass a presented stale Pixel cookie',async()=>{
 const original=globalThis.fetch,events=[];
 globalThis.fetch=async input=>String(input).endsWith('/pixel-pulse/session')?Response.json({error:'reauthentication required'},{status:503}):Response.json(nativeResponse);
 const {data:{subscription}}=client.supabase.auth.onAuthStateChange((event,session)=>events.push({event,userId:session?.user.id}));
 try{await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(events,[]);}
 finally{subscription.unsubscribe();globalThis.fetch=original;}
});
