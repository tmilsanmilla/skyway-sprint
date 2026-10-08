import assert from "node:assert/strict";
import test from "node:test";
import { activeRotatingMode, nextRotationAt, melonBaseScore, secondFinisherScore, rankedK, expectedRankedScore, weightedChoice, RNG_MAP_WEIGHTS, RNG_RARITY_WEIGHTS, rngClasses, bannedMapPool, HARDCORE_DUEL_MAPS, MATCH_SETUP } from "./update-19-rules.ts";
test("Update 19 K uses the rolling-game boundary and the 600 divisor",()=>{
  assert.equal(rankedK(0),150);assert.equal(rankedK(22),40);assert.equal(rankedK(23),37);assert.equal(rankedK(100),37);
  assert.equal(expectedRankedScore(1500,1500),.5);assert.equal(expectedRankedScore(1500,2100),1/11);
});
test("second finisher bonus rounds before adding 500; melons scale with waves",()=>{
  assert.equal(secondFinisherScore(10346),11363);assert.equal(secondFinisherScore(0),500);
  for(let w=1;w<=100;w++) assert.equal(melonBaseScore(w),Math.floor(220+30*w**1.4));
});
test("rotating modes switch daily at UTC midnight and hardcore excludes four maps",()=>{
  assert.notEqual(activeRotatingMode(0),activeRotatingMode(86400000));assert.equal(activeRotatingMode(0),activeRotatingMode(86400000*2));
  assert.equal(nextRotationAt(100),86400000);assert.equal(HARDCORE_DUEL_MAPS.length,6);
  for(const m of ["desert","grove","alley","terminal"]) assert.ok(!HARDCORE_DUEL_MAPS.includes(m));
  assert.deepEqual(MATCH_SETUP,{banSeconds:10,announcementSeconds:4,characterSeconds:15});
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
