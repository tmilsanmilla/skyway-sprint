import assert from 'node:assert/strict';
import test from 'node:test';
process.env.NEXT_PUBLIC_PIXEL_PULSE_ENABLED='true';
const client=await import('./skyway-client.ts');
test('retired Pixel login remains disabled even with the former public flag enabled',async()=>{const before=globalThis.fetch;let requests=0;globalThis.fetch=async()=>{requests++;throw Error('unexpected IO')};try{assert.equal(client.isPixelPulseAvailable,false);assert.equal(client.isPixelPulseReturnAvailable,false);await assert.rejects(()=>client.continueWithPixelPulse(),/Skyway/);await assert.rejects(()=>client.confirmWithPixelPulse(),/Skyway/);assert.equal(requests,0);}finally{globalThis.fetch=before;}});
test('an old Pixel token cannot become native database authority',async()=>{const session={access_token:'old-pixel-token',user:{id:'11111111-1111-4111-8111-111111111111',app_metadata:{provider:'pixel-pulse'}}};assert.equal(client.setDataSession(session,session.user.id),false);await assert.rejects(()=>client.ensureNeonCompatibleSession(session),/Skyway/);});
