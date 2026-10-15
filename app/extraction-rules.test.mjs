import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { EXTRACTION_BOXES, PULL_PROFILES, EXTRACTION_RARITIES, EXTRACTION_MAX_QUANTITY, canOpenBox, directUnlockCost, duplicateStardust, stardustUnlockLevel, affordableBoxQuantity, rollExtraction } from "./extraction-rules.ts";
import { HARDCORE_SCORE_MULTIPLIER, endlessCharacter } from "./progression-rules.ts";

test("booster box prices, pull mixes, level gates, and 99-box maximum match exactly", () => {
  assert.equal(EXTRACTION_MAX_QUANTITY,99);
  for (const [kind,cost,minLevel,counts] of [
    ["normal",11,0,{normal:10}], ["rare",19,10,{normal:7,rare:2,bonus:2}],
    ["legendary",27,20,{normal:5,rare:3,bonus:3,legendary:1}],
  ]) {
    const box=EXTRACTION_BOXES[kind];
    assert.equal(box.cost,cost); assert.equal(box.minLevel,minLevel);
    assert.equal(box.pullCount,box.pulls.length);
    assert.deepEqual(Object.fromEntries([...new Set(box.pulls)].map(k=>[k,box.pulls.filter(p=>p===k).length])),counts);
    assert.equal(affordableBoxQuantity(kind,cost-1),0);
    assert.equal(affordableBoxQuantity(kind,cost),1);
    assert.equal(affordableBoxQuantity(kind,cost*10000),99);
  }
  for (let level=0;level<40;level++) {
    assert.equal(canOpenBox("normal",level),true);
    assert.equal(canOpenBox("rare",level),level>=10);
    assert.equal(canOpenBox("legendary",level),level>=20);
  }
  assert.equal(canOpenBox("legendary",NaN),false);
});
test("independent category and rarity rolls preserve every specified percentage exactly", () => {
  for (const [profile,expected] of Object.entries({normal:[7,42,32,15,9,2,0],bonus:[13,32,27,17,14,10,0],rare:[18,27,24,19,16,14,0],legendary:[20,22,21,20,19,17,1]})) {
    const rules=PULL_PROFILES[profile];
    assert.deepEqual([rules.characterPercent,...rules.weights],expected);
    assert.equal(rules.weights.reduce((a,b)=>a+b,0),100);
    const counts=Object.fromEntries(EXTRACTION_RARITIES.map(r=>[r,0]));let characters=0;
    for(let c=0;c<100;c++) for(let r=0;r<100;r++) {
      const draw=rollExtraction(profile,(c+.5)/100,(r+.5)/100);
      counts[draw.rarity]++;characters+=Number(draw.category==="character");
    }
    assert.equal(characters,rules.characterPercent*100);
    EXTRACTION_RARITIES.forEach((r,i)=>assert.equal(counts[r],rules.weights[i]*100));
  }
  for(const invalid of [-1,1,Infinity,NaN]) assert.throws(()=>rollExtraction("normal",invalid,.5));
});
test("no eligible box below level 20 contains any mythic-capable pull", () => {
  for(let level=0;level<20;level++) for(const [kind,box] of Object.entries(EXTRACTION_BOXES)) {
    if(canOpenBox(kind,level)) assert.ok(box.pulls.every(p=>PULL_PROFILES[p].weights[5]===0));
  }
});
test("all six rarities have exact Stardust prices with no invented level gates", () => {
  for(const [rarity,cosmetic,character] of [["common",24,120],["uncommon",32,160],["rare",48,240],["epic",80,400],["legendary",360,1800],["mythic",3200,16000]]) {
    assert.equal(directUnlockCost(rarity,"character"),character);
    for(const kind of ["player","obstacle","environment"]) assert.equal(directUnlockCost(rarity,kind),cosmetic);
    assert.equal(stardustUnlockLevel(rarity),0);
  }
  for(const rarity of ["default","toString","__proto__","invalid"]) {
    assert.equal(directUnlockCost(rarity,"character"),null);
    assert.equal(stardustUnlockLevel(rarity),null);
  }
  assert.equal(directUnlockCost("common","class"),null);
});
test("duplicate Stardust payouts match rarity, cosmetic/character, and all level boundaries", () => {
  for(const [rarity,base] of [["common",10],["uncommon",12],["rare",16],["epic",24],["legendary",38],["mythic",60]]) {
    for(const [level,multiplier] of [[0,1],[19,1],[20,1.5],[39,1.5],[40,2],[100,2]]) {
      for(const type of ["player","obstacle","environment"]) assert.equal(duplicateStardust(rarity,type,level),base*multiplier);
      assert.equal(duplicateStardust(rarity,"character",level),base*multiplier*4);
    }
  }
  for(const rarity of ["default","toString","__proto__","invalid"]) assert.equal(duplicateStardust(rarity,"character",40),0);
  assert.equal(duplicateStardust("mythic","class",40),0);
});
test("Hardcore forces Ace and multiplies the 2x mode bonus by Ace's 1.1x bonus", () => {
  assert.equal(HARDCORE_SCORE_MULTIPLIER,2);
  assert.equal(endlessCharacter("hardcore","medic_seraph"),"runner_ace");
  assert.equal(HARDCORE_SCORE_MULTIPLIER*1.1,2.2);
});
test("Neon atomically awards Stardust for duplicates and never exposes a Gem direct purchase", () => {
  const page=readFileSync(new URL("./page.tsx",import.meta.url),"utf8");
  const sql=readFileSync(new URL("../neon/qol-extraction.sql",import.meta.url),"utf8");
  assert.doesNotMatch(page,/DUPLICATE_REFUNDS|REFUNDED|CHARACTER \+ WEAPON/);
  assert.match(page,/canOpenBox\(option, playerProgression.level\)/);
  assert.match(sql,/if l<b.min_level then raise exception/);
  assert.match(sql,/user_id=u for update/);
  assert.match(sql,/'refund',0,'duplicate_refund',0/);
  assert.match(sql,/pull_count>99/);
  assert.match(sql,/stardust=stardust\+earned/);
  assert.match(sql,/stardust=stardust-price/);
  assert.match(sql,/on conflict\(user_id,item_key\) do nothing/);
  assert.doesNotMatch(sql,/l<app_private\.stardust_unlock_level|gems\s*\+|extraction_transactions|update public\.player_photon|grant.*app_private/);
  assert.match(sql,/from public,anon,anonymous,authenticated/);
});
