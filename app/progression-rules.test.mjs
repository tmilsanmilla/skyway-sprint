import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { cumulativeXpForLevel, xpRequiredForLevel, levelForLifetimeXp, endlessScoreXp, endlessCharacter, MODE_UNLOCKS, isOlderProgression, PROGRESSION_VERSION } from "./progression-rules.ts";

test("levels start at zero and require 200, 300, 400 XP, rising by 100", () => {
  assert.deepEqual([0,1,2,74].map(xpRequiredForLevel),[200,300,400,7600]);
  assert.deepEqual([0,1,2,3,15,25,75].map(cumulativeXpForLevel),[0,200,500,900,13500,35000,292500]);
});
test("the inverse level curve is exact at every threshold and carries remaining XP", () => {
  for(let l=1;l<=10000;l++) {
    const threshold=cumulativeXpForLevel(l);
    assert.equal(levelForLifetimeXp(threshold-1),l-1);
    assert.equal(levelForLifetimeXp(threshold),l);
    assert.equal(levelForLifetimeXp(threshold+1),l);
    assert.equal(cumulativeXpForLevel(l)-cumulativeXpForLevel(l-1),100+100*l);
  }
  assert.equal(levelForLifetimeXp(-10),0);
});
test("Endless XP uses score to the 2.2 power, divided by three million and floored once", () => {
  for(const score of [0,1,1000,8000,10000,50000,100000,50000000]) {
    assert.equal(endlessScoreXp(score),Math.floor(score**2.2/3000000));
  }
  assert.equal(endlessScoreXp(-1),0); assert.equal(endlessScoreXp(NaN),0);
});
test("Photon and Ranked have independent level and gem requirements", () => {
  assert.deepEqual(MODE_UNLOCKS,{photon:{level:15,gems:100},ranked:{level:25,gems:100}});
});
test("Hardcore always forces Ace, while Normal keeps the selected character", () => {
  for(const character of ["runner_ace","runner_pacer","medic_seraph","trickster_echo","tank_hammer"]) {
    assert.equal(endlessCharacter("hardcore",character),"runner_ace");
    assert.equal(endlessCharacter("normal",character),character);
  }
  const view=readFileSync(new URL("./page.tsx",import.meta.url),"utf8");
  assert.doesNotMatch(view,/impossible|IMPOSSIBLE/);
  assert.match(view,/endlessCharacter\(mode, availableCharacter\)/);
  assert.match(view,/endlessCharacter\(mode, candidateCharacter\)/);
});
test("a reset version can lower XP, but old or reordered responses cannot overwrite it", () => {
  const before={progression_version:0,lifetime_xp:900000000};
  const reset={progression_version:PROGRESSION_VERSION,lifetime_xp:0};
  assert.equal(isOlderProgression(before,reset),false);
  assert.equal(isOlderProgression(reset,before),true);
  assert.equal(isOlderProgression({...reset,lifetime_xp:200},reset),true);
  assert.equal(isOlderProgression(reset,{...reset,lifetime_xp:200}),false);
});
test("Update 17 erases prior XP once, including snapshots, but retains run validation", () => {
  const sql=readFileSync(new URL("../neon/update-17-progression.sql",import.meta.url),"utf8");
  assert.match(sql,/if not exists\(select 1 from app_private.progression_resets where version=20261008\)/);
  assert.match(sql,/set level=0,xp_in_level=0,lifetime_xp=0,progression_version=20261008/);
  assert.match(sql,/set xp_awarded=0,metadata=metadata-'xp_breakdown'/);
  assert.match(sql,/drop table if exists app_private.progression_reset_backup/);
  assert.match(sql,/progression_version set default 20261008/);
  assert.match(sql,/power\(greatest\(p_score,0\)::numeric,2\.2\)\/3000000/);
  assert.doesNotMatch(sql,/delete from|set total_gems=0|set high_score=0|player_unlocks|player_photon_fury/);
  assert.match(sql,/entitlement.user_id=queue.user_id and entitlement.qualified/);
  assert.match(sql,/for update/);
  assert.match(sql,/from public,anon,anonymous,authenticated/);
});
test("Photon UI has no score counter and server awards the same points-only reward", () => {
  const view=readFileSync(new URL("./photon-fury.tsx",import.meta.url),"utf8");
  assert.doesNotMatch(view,/photonScore|SCORE/);
  assert.match(view,/photonTotalPoints\(run\)/);
  const sql=readFileSync(new URL("../neon/update-17-photon-points.sql",import.meta.url),"utf8");
  assert.match(sql,/floor\(p_points\)>=4.*\(floor\(p_points\)-4\)\^2\+1/);
  assert.match(sql,/r.finished_at is not null/);
  assert.match(sql,/user_id=u for update/);
  assert.match(sql,/Invalid playtime/);
  assert.match(sql,/Invalid reflections/);
  assert.match(sql,/Invalid bonus/);
  assert.doesNotMatch(sql,/'score'|t\/270/);
});
