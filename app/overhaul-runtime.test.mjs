import assert from "node:assert/strict";
import test from "node:test";
import {OVERHAUL_CHARACTERS,OVERHAUL_STARTERS,overhaulCharacter} from "./overhaul-catalog.ts";
import {OverhaulRuntime} from "./overhaul-runtime.ts";
import {overhaulWaveSeconds,overhaulWaveSpeed,tempoResult} from "./overhaul-passives.ts";
import {STATE_OUTLINES} from "./state-outlines.ts";
import {cartographyMultiAccuracy} from "./overhaul-challenges.ts";
const character=name=>{const c=OVERHAUL_CHARACTERS.find(c=>c.name===name);assert.ok(c,name);return c;};
const run=(name,extra={})=>new OverhaulRuntime({key:character(name).key,owned:[],online:false,laneCount:5,random:()=>0.5,...extra});
const resolve=(r,value)=>r.resolveChallenge(r.phase,value,r.challengeId);
test("132 stable unique characters in six complete classes, with five real starters and safe starting HP",()=>{
  assert.equal(OVERHAUL_CHARACTERS.length,132);assert.equal(new Set(OVERHAUL_CHARACTERS.map(c=>c.key)).size,132);
  assert.deepEqual(Object.fromEntries(["runner","medic","tank","trickster","misc","chaotic"].map(k=>[k,OVERHAUL_CHARACTERS.filter(c=>c.classKey===k).length])),{runner:22,medic:22,tank:22,trickster:22,misc:22,chaotic:22});
  assert.equal(OVERHAUL_STARTERS.size,5);
  for(const c of OVERHAUL_CHARACTERS){assert.ok(c.startingHp>0&&Number.isFinite(c.startingHp)&&c.startingHp<=c.maxHp,c.name);assert.ok(c.description.length>20,c.name);assert.doesNotMatch(c.description,/58seal|zero.*gems|500%.*volume/i);}
  assert.equal(character("Phoenix").key,"medic_revive");assert.equal(character("Knight").maxHp,Infinity);
  assert.equal(character("Bulwark").startingHp,4);assert.equal(character("Nurse").maxHp,4);
});
test("all character engines start, tick, progress waves and expose finite independent score/speed",()=>{
  for(const c of OVERHAUL_CHARACTERS){const r=new OverhaulRuntime({key:c.key,owned:[],online:false,laneCount:5,random:()=>0.5});
    for(let wave=1;wave<=20;wave++){r.beginWave(wave);r.tick(0.5);const m=r.modifiers();assert.ok(Number.isFinite(m.score)&&m.score>=0,c.name);assert.ok(Number.isFinite(m.speed)&&m.speed>=0,c.name);}
  }
  const r=run("Rocket");r.beginWave(15);assert.equal(r.modifiers().speed,1.6);assert.equal(r.modifiers().score,1.95);
  assert.equal(overhaulWaveSeconds("Ace",false),40);assert.equal(overhaulWaveSeconds("Coil",false),15);assert.equal(overhaulWaveSeconds("Coil",true),40);
  assert.equal(overhaulWaveSpeed("Streaker",6),2.75);assert.equal(overhaulWaveSpeed("Ace",6),2);
});
test("Stride's fourth move has an unshortened windup and blocks movement during the whole shield",()=>{
  const r=run("Stride");for(const lane of [1,2,1,2])assert.equal(r.move(lane),true);
  assert.equal(r.modifiers().invincible,false);assert.equal(r.move(3),false);
  r.tick(0.049);assert.equal(r.modifiers().invincible,false);r.tick(0.002);assert.equal(r.modifiers().invincible,true);
  assert.equal(r.move(3),false);r.tick(0.3);assert.equal(r.move(3),true);
});
test("Tonic pays once, brews on active time, stores one potion, and cannot overlap brews",()=>{
  const r=run("Tonic");for(let i=0;i<8;i++)r.pickup("gem");assert.equal(r.counters.ingredients,32);
  assert.equal(r.activate("4"),true);assert.equal(r.counters.ingredients,2);assert.equal(r.activate("1"),false);
  r.tick(14.99);assert.equal(r.activate("e"),false);r.tick(.02);assert.equal(r.counters.potion,4);
  assert.equal(r.activate("1"),false);assert.equal(r.activate("e"),true);assert.equal(r.drain().filter(e=>e.type==="heal").at(-1).amount,4);
  assert.equal(r.activate("e"),false);
});
test("Salve heals low HP twice, then exhausts ordinary wave healing",()=>{
  const r=run("Salve");r.synchronize(.5,3,2);assert.equal(r.waveEnd().healing,2);r.beginWave(2);assert.equal(r.waveEnd().healing,2);r.beginWave(3);assert.equal(r.waveEnd().healing,0);
});
test("Gambit death gives only one original challenge and duplicate or stale resolutions cannot revive again",()=>{
  const r=run("Gambit");assert.equal(r.death("rock"),true);const id=r.challengeId;assert.equal(r.phase,"gambit");
  assert.equal(r.resolveChallenge("gambit",[8,8,8,8,8,8],id),true);assert.equal(r.modifiers().score,2.23);assert.equal(r.modifiers().canHeal,false);
  assert.equal(r.resolveChallenge("gambit",[8,8,8,8,8,8],id),false);assert.equal(r.death("rock"),false);
  assert.deepEqual(r.drain().filter(e=>e.type==="health"),[{type:"health",hp:2,maxHp:2}]);
});
test("Muse exhausts five distinct non-Chaotic classes across rarities without granting ownership",()=>{
  const r=run("Muse"),classes=new Set();
  for(let life=0;life<5;life++){
    assert.equal(r.phase,"muse");const offered=r.choiceCharacters();assert.ok(offered.length);const chosen=offered[0];assert.equal(classes.has(chosen.classKey),false);classes.add(chosen.classKey);assert.equal(resolve(r,chosen.key),true);
    if(life<4)assert.equal(r.death("rock"),true);else assert.equal(r.death("rock"),false);
  }
  assert.equal(classes.size,5);assert.equal(r.owned.size,0);
});
test("Mimic copies an owned mythic opponent, refuses unowned copying, and secret Polyglot pair is one-HP Rogue",()=>{
  const opponent=character("Zenith").key;
  assert.equal(run("Mimic",{online:true,opponentKey:opponent,owned:[opponent]}).key,opponent);
  const missing=run("Mimic",{online:true,opponentKey:opponent});assert.equal(missing.name,"Mimic");assert.equal(missing.modifiers().score,1.06);
  for(const [a,b] of [["Polyglot","Polyglot"],["Prodigy","Polyglot"],["Polyglot","Prodigy"]]){
    const r=run(a,{online:true,opponentKey:character(b).key});assert.equal(r.name,"Rogue");assert.equal(r.hp,1);assert.equal(r.maxHp,1);assert.equal(r.phase,null);
  }
});
test("Wildcard original 24-card deck depletes once, delayed cards use active time, timeout ends the run",()=>{
  const r=run("Wildcard");r.cards=["9S"];r.waveEnd();assert.equal(resolve(r,0),true);r.drain();r.tick(14.9);assert.equal(r.drain().some(e=>e.type==="collect"),false);r.tick(.11);assert.equal(r.drain().filter(e=>e.type==="collect").length,1);r.tick(50);assert.equal(r.drain().filter(e=>e.type==="collect").length,0);
  r.waveEnd();assert.ok(r.drain().some(e=>e.type==="finish"));
  const timeout=run("Wildcard");timeout.waveEnd();assert.equal(resolve(timeout,-1),true);assert.ok(timeout.drain().some(e=>e.type==="finish"));
});
test("Hades requires both independent stages; failures never grant god state",()=>{
  const r=run("Hex");r.counters.damnation=90;r.waveEnd();assert.equal(resolve(r,12),true);assert.equal(r.phase,"hades-keys");
  assert.equal(resolve(r,{correct:25,wrong:1}),true);assert.equal(r.phase,"hades-targets");assert.equal(resolve(r,15),true);assert.equal(r.counters.god,1);
  const fail=run("Hex");fail.counters.damnation=100;fail.waveEnd();resolve(fail,0);resolve(fail,{correct:25,wrong:2});assert.equal(fail.counters.god,undefined);
});
test("Cartographer has every US state, island paths, scale invariant scoring and no empty-drawing reward",()=>{
  assert.equal(STATE_OUTLINES.length,50);assert.equal(new Set(STATE_OUTLINES.map(s=>s.code)).size,50);assert.ok(STATE_OUTLINES.find(s=>s.code==="HI").paths.length>1);
  for(const state of STATE_OUTLINES){assert.ok(state.paths.length&&state.paths[0].length>=4);const scaled=state.paths.map(path=>path.map(([x,y])=>[x*2+200,y*2-20]));assert.ok(cartographyMultiAccuracy(scaled,state.paths)>.999,state.name);}
  assert.equal(cartographyMultiAccuracy([],STATE_OUTLINES[0].paths),0);
});
test("closed run and already-issued challenge ID fence late UI actions",()=>{
  const r=run("Tempo");r.waveEnd();const id=r.challengeId;resolve(r,4);r.waveEnd();assert.equal(r.resolveChallenge("tempo",4,id),false);assert.equal(r.phase,"tempo");r.close();assert.equal(resolve(r,4),false);r.tick(90);assert.deepEqual(r.drain(),[]);
  assert.equal(tempoResult(4).score,1.5);assert.equal(tempoResult(2).harmfulGems,true);
});
