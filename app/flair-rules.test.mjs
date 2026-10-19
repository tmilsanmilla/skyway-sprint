import test from 'node:test';import assert from 'node:assert/strict';import {registerHooks} from 'node:module';
registerHooks({resolve(s,c,next){return next(s==='./mastery-rules'&&c.parentURL?.endsWith('flair-rules.ts')?s+'.ts':s,c);}});
const f=await import('./flair-rules.ts');
const flair=key=>({key,name:key,characterName:key,scoreBonus:.03});
test('flair ownership follows character unlocks; selection is independent and default resets with character',()=>{
 const fs=f.inventoryFlairs([{key:'runner_ace',name:'Ace'},{key:'medic_bloom',name:'Bloom'},{key:'runner_dash',name:'Dash'}],['runner_ace','medic_bloom']);assert.equal(fs.length,2);assert.equal(f.canEquipFlair('medic_bloom',['runner_ace','medic_bloom']),true);assert.equal(f.canEquipFlair('runner_dash',['runner_ace']),false);assert.equal(f.defaultFlairOnCharacterChange('runner_ace',['runner_ace']),'runner_ace');assert.equal(f.cycleFlair('runner_ace',1,fs),'medic_bloom');
});
test('rewrites require explicit enabled/unlocked input and paired-only lines never leak',()=>{
 assert.equal(f.getFlairEffects(flair('medic_bloom'),'runner_ace',false).gemMultiplier,1);assert.equal(f.getFlairEffects(flair('medic_bloom'),'runner_ace',true).gemMultiplier,1.25);assert.equal(f.getFlairEffects(flair('medic_bloom'),'medic_bloom',true).gemMultiplier,1.35);
 assert.equal(f.getFlairEffects(flair('runner_dash'),'runner_ace',true).dashCooldownReduction,0);assert.equal(f.getFlairEffects(flair('runner_dash'),'runner_dash',true).dashCooldownReduction,.5);
 assert.equal(f.getFlairEffects(flair('runner_stride'),'runner_ace',true).laneChangeScore,10);assert.equal(f.getFlairEffects(flair('runner_stride'),'runner_stride',true).laneChangeScore,25);
});
test('gem fractions accumulate across pickups but bank only wholes',()=>{let total=0;let awards=[];for(let i=0;i<4;i++){const r=f.addFlairGems(total,1,1.25);total=r.total;awards.push(r.addedWhole);}assert.deepEqual(awards,[1,1,1,2]);assert.equal(Math.floor(total),5);});
test('freeze/healing/recovery/Guard/Smoke rewrites give exact general and paired effects',()=>{
 assert.equal(f.getFlairEffects(flair('medic_remedy'),'runner_ace',true).snowflakeDurationReduction,.5);assert.equal(f.getFlairEffects(flair('medic_remedy'),'medic_remedy',true).snowflakeDurationReduction,1);
 assert.equal(f.getFlairEffects(flair('medic_salve'),'runner_ace',true,0,5).waveHealExtra,.5);assert.equal(f.getFlairEffects(flair('medic_salve'),'medic_salve',true,0,5).waveHealExtra,.75);
 assert.equal(f.getFlairEffects(flair('runner_vault'),'runner_ace',true).postHitScoreMultiplier,0);assert.equal(f.getFlairEffects(flair('runner_vault'),'runner_vault',true).postHitInvincible,true);
 assert.equal(f.getFlairEffects(flair('tank_guard'),'runner_ace',true).damageMultiplier,.85);assert.equal(f.getFlairEffects(flair('tank_guard'),'tank_guard',true).scoreMultiplier,.95);
 assert.equal(f.getFlairEffects(flair('trickster_smoke'),'runner_ace',true).opponentMildSmokeTop,.2);assert.equal(f.getFlairEffects(flair('trickster_smoke'),'trickster_smoke',true).opponentMildSmokeTop,.4);
});
