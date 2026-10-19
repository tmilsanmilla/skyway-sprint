import assert from "node:assert/strict";
import test from "node:test";
import { activeRotatingMode, nextRotationAt, melonBaseScore, secondFinisherScore, rankedK, expectedRankedScore, weightedChoice, RNG_MAP_WEIGHTS, RNG_RARITY_WEIGHTS, rngClasses, bannedMapPool, HARDCORE_DUEL_MAPS, MATCH_SETUP, MUNDANE_MAP_WEIGHTS, QUICKSAND_RULES, isDuelCharacterAllowed, unlimitedRequirements } from "./update-19-rules.ts";
test("Update 19 K uses the rolling-game boundary and the 600 divisor",()=>{
  assert.equal(rankedK(0),150);assert.equal(rankedK(22),40);assert.equal(rankedK(23),37);assert.equal(rankedK(100),37);
  assert.equal(expectedRankedScore(1500,1500),.5);assert.equal(expectedRankedScore(1500,2100),1/11);
});
test("second finisher bonus rounds before adding 500; melons scale with waves",()=>{
  assert.equal(secondFinisherScore(10346),11363);assert.equal(secondFinisherScore(0),500);
  for(let w=1;w<=100;w++) {
    assert.equal(melonBaseScore(w),Math.floor(285+45*w**1.4));
    assert.equal(melonBaseScore(w,"quicksand"),Math.floor(627+99*w**1.4));
  }
  assert.equal(melonBaseScore(NaN),330);
});
test("NY weekdays and DST control rotation; hardcore map pool stays intact",()=>{
  const days=["mundane","hardcore_duel","rng","mundane","hardcore_duel","rng","quicksand"];
  for(let d=0;d<7;d++) assert.equal(activeRotatingMode(Date.UTC(2026,9,12+d,16)),days[d]);
  assert.equal(nextRotationAt(Date.parse("2026-03-08T05:00:00Z")),Date.parse("2026-03-09T04:00:00Z"));
  assert.equal(nextRotationAt(Date.parse("2026-11-01T04:00:00Z")),Date.parse("2026-11-02T05:00:00Z"));
  assert.equal(activeRotatingMode(Date.parse("2026-10-18T03:59:59Z")),"rng");
  assert.equal(activeRotatingMode(Date.parse("2026-10-18T04:00:00Z")),"quicksand");
  assert.equal(HARDCORE_DUEL_MAPS.length,7);
  for(const m of ["unknown","grove","volcano","terminal"]) assert.ok(!HARDCORE_DUEL_MAPS.includes(m));
  for(const m of ["classic","ruins","desert","skyway","pitch","factory","meadow"]) assert.ok(HARDCORE_DUEL_MAPS.includes(m));
  assert.deepEqual(MATCH_SETUP,{banSeconds:10,announcementSeconds:4,characterSeconds:15});
});
test("Quicksand and Mundane legality never leaks mythics into regular duels",()=>{
  const character={key:"runner_ace",rarity:"default",classKey:"runner"};
  assert.equal(isDuelCharacterAllowed("quicksand",character),true);
  assert.equal(QUICKSAND_RULES.baseSpeed,4);assert.equal(QUICKSAND_RULES.scoreSpeedMultiplier,1);
  assert.equal(isDuelCharacterAllowed("casual",{...character,rarity:"mythic"}),false);
  assert.equal(isDuelCharacterAllowed("unlimited",{...character,rarity:"mythic"}),true);
  assert.equal(isDuelCharacterAllowed("mundane",{...character,rarity:"rare"}),true);
  assert.equal(isDuelCharacterAllowed("mundane",{...character,rarity:"epic"}),false);
  assert.equal(isDuelCharacterAllowed("mundane",{...character,rarity:"rare",classKey:"trickster"}),false);
  assert.equal(Object.values(MUNDANE_MAP_WEIGHTS).reduce((a,b)=>a+b,0),100);
});
test("Unlimited counts distinct ownership and hides excess progress",()=>{
  const catalog=[...Array.from({length:80},(_,i)=>({key:`low${i}`,rarity:"rare",classKey:"runner"})),...Array.from({length:20},(_,i)=>({key:`leg${i}`,rarity:"legendary",classKey:"tank"})),...Array.from({length:10},(_,i)=>({key:`myth${i}`,rarity:"mythic",classKey:"medic"}))];
  assert.deepEqual(unlimitedRequirements(catalog,[],0,false,false).map(r=>r.progress),["0/80","0/18","0/3","In progress","In progress"]);
  const owned=catalog.map(c=>c.key);
  assert.ok(unlimitedRequirements(catalog,owned.concat(owned),45,true,true).every(r=>r.complete&&r.progress==="Completed"));
});
test("RNG odds are exact, exclude starters/mythics, and never assign the same class",()=>{
  for(const weights of [RNG_MAP_WEIGHTS,RNG_RARITY_WEIGHTS]) {
    const counts={};for(let i=0;i<100;i++){const k=weightedChoice(weights,(i+.5)/100);counts[k]=(counts[k]??0)+1;}assert.deepEqual(counts,weights);
  }
  for(let a=0;a<5;a++)for(let b=0;b<4;b++) {const c=rngClasses((a+.5)/5,(b+.5)/4);assert.notEqual(c[0],c[1]);}
});
test("secret map bans leave four, three, or two candidates as specified",()=>{
  const maps=["classic","pitch","factory","meadow"];
  assert.deepEqual(bannedMapPool(maps,[]),maps);assert.equal(bannedMapPool(maps,["classic","classic"]).length,3);assert.equal(bannedMapPool(maps,["classic","pitch"]).length,2);
});
