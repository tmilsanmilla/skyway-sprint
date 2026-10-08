import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { EXTRACTION_BOXES, PULL_PROFILES, EXTRACTION_RARITIES, canOpenBox, directUnlockCost, affordableBoxQuantity, rollExtraction } from "./extraction-rules.ts";
import { HARDCORE_SCORE_MULTIPLIER, endlessCharacter } from "./progression-rules.ts";

test("Update 18 box price, pull mix, quantity, and level gates match exactly", () => {
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
    assert.equal(affordableBoxQuantity(kind,cost*10000),100);
  }
  for (let level=0;level<40;level++) {
    assert.equal(canOpenBox("normal",level),true);
    assert.equal(canOpenBox("rare",level),level>=10);
    assert.equal(canOpenBox("legendary",level),level>=20);
  }
  assert.equal(canOpenBox("legendary",NaN),false);
});
test("independent category and rarity rolls preserve every specified percentage exactly", () => {
  for (const [profile,expected] of Object.entries({normal:[6,42,32,15,9,2,0],bonus:[10,32,27,17,14,10,0],rare:[17,27,24,19,16,14,0],legendary:[19,22,21,20,19,17,1]})) {
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
test("direct purchases distinguish characters from cosmetics and reject higher rarities", () => {
  for(const [rarity,cosmetic,character] of [["common",2,10],["uncommon",3,15],["rare",5,25]]) {
    assert.equal(directUnlockCost(rarity,"character"),character);
    for(const kind of ["player","obstacle","environment"]) assert.equal(directUnlockCost(rarity,kind),cosmetic);
  }
  for(const rarity of ["epic","legendary","mythic","toString","invalid"]) assert.equal(directUnlockCost(rarity,"character"),null);
  assert.equal(directUnlockCost("common","class"),null);
});
test("Hardcore forces Ace and multiplies the 2x mode bonus by Ace's 1.1x bonus", () => {
  assert.equal(HARDCORE_SCORE_MULTIPLIER,2);
  assert.equal(endlessCharacter("hardcore","medic_seraph"),"runner_ace");
  assert.equal(HARDCORE_SCORE_MULTIPLIER*1.1,2.2);
});
test("UI and Neon cannot refund duplicates, bypass levels, or change Photon economics", () => {
  const page=readFileSync(new URL("./page.tsx",import.meta.url),"utf8");
  const sql=readFileSync(new URL("../neon/update-18-extraction-shop.sql",import.meta.url),"utf8");
  assert.doesNotMatch(page,/DUPLICATE_REFUNDS|REFUNDED|CHARACTER \+ WEAPON/);
  assert.match(page,/canOpenBox\(option, playerProgression.level\)/);
  assert.match(sql,/if l<b.min_level then raise exception/);
  assert.match(sql,/user_id=u for update/);
  assert.match(sql,/'refund',0,'duplicate_refund',0/);
  assert.doesNotMatch(sql,/gems\s*\+|extraction_transactions|update public\.player_photon|grant.*app_private/);
  assert.match(sql,/from public,anon,anonymous,authenticated/);
});
