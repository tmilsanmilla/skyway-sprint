import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { cumulativeXpForLevel, xpRequiredForLevel, levelForLifetimeXp, endlessScoreXp, endlessGemXp, endlessCharacter, MODE_UNLOCKS, isOlderProgression, PROGRESSION_VERSION } from "./progression-rules.ts";

test("levels start at zero and require 400, 500, 600 XP, rising by 100", () => {
  assert.deepEqual([0,1,2,74].map(xpRequiredForLevel),[400,500,600,7800]);
  assert.deepEqual([0,1,2,3,5,15,25,75].map(cumulativeXpForLevel),[0,400,900,1500,3000,16500,40000,307500]);
});
test("the inverse level curve is exact at every threshold and carries remaining XP", () => {
  for(let l=1;l<=10000;l++) {
    const threshold=cumulativeXpForLevel(l);
    assert.equal(levelForLifetimeXp(threshold-1),l-1);
    assert.equal(levelForLifetimeXp(threshold),l);
    assert.equal(levelForLifetimeXp(threshold+1),l);
    assert.equal(cumulativeXpForLevel(l)-cumulativeXpForLevel(l-1),300+100*l);
  }
  assert.equal(levelForLifetimeXp(-10),0);
});
test("Endless score XP divides score by 1100 before the 2.2 power, then floors once", () => {
  for(const score of [0,1,1000,8000,10000,50000,100000,50000000]) {
    assert.equal(endlessScoreXp(score),Math.floor((score/1100)**2.2));
  }
  assert.equal(endlessScoreXp(-1),0); assert.equal(endlessScoreXp(NaN),0);
  assert.equal(endlessScoreXp(1099),0); assert.equal(endlessScoreXp(1100),1);
  assert.deepEqual([0,1,5,25,NaN].map(endlessGemXp),[1,1,5,25,1]);
});
test("Casual, Photon, and Ranked have independent final level and gem requirements", () => {
  assert.deepEqual(MODE_UNLOCKS,{casual:{level:5,gems:0},photon:{level:15,gems:225},ranked:{level:25,gems:100}});
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
test("Map Refresh resets XP once including old receipt values, but retains account data and run validation", () => {
  const sql=readFileSync(new URL("../neon/qol-progression.sql",import.meta.url),"utf8");
  assert.equal(PROGRESSION_VERSION,20261014);
  assert.match(sql,/if not exists\(select 1 from app_private.progression_resets where version=20261014\)/);
  assert.match(sql,/set level=0,xp_in_level=0,lifetime_xp=0,\s+progression_version=20261014/);
  assert.match(sql,/set xp_awarded=0,metadata=metadata-'xp_breakdown'/);
  assert.match(sql,/drop table if exists app_private.progression_reset_backup/);
  assert.match(sql,/progression_version set default 20261014/);
  assert.match(sql,/power\(greatest\(p_score,0\)::numeric\/1100,2\.2\)/);
  const reset=sql.slice(0,sql.indexOf("create or replace function"));
  assert.doesNotMatch(reset,/delete from|set total_gems=0|set high_score=0|player_unlocks|player_photon_fury|ranked_requalification/);
  assert.match(sql,/Reset fence 20261014/);
  assert.match(sql,/endless_verified_gem_xp\(v_uid,p_run_id\)/);
  assert.match(sql,/Map Refresh Casual level 5/);
  assert.match(sql,/k not in\(''casual'',''rng'',''hardcore_duel''\) or st.level>=5/);
  assert.match(sql,/'ranked_purchased',paid,'ranked_unlocked',paid/);
  assert.match(sql,/total_gems=total_gems-225/);
  assert.match(sql,/for update/);
  assert.match(sql,/from public,anon,anonymous,authenticated/);
});
test("Photon UI has no score counter and server awards the same points-only reward", () => {
  const view=readFileSync(new URL("./photon-fury.tsx",import.meta.url),"utf8");
  assert.doesNotMatch(view,/photonScore|SCORE/);
  assert.match(view,/photonRunReward\(run\)/);
  const sql=readFileSync(new URL("../neon/update-17-photon-points.sql",import.meta.url),"utf8");
  assert.match(sql,/floor\(p_points\)>=4.*\(floor\(p_points\)-4\)\^2\+1/);
  assert.match(sql,/r.finished_at is not null/);
  assert.match(sql,/user_id=u for update/);
  assert.match(sql,/Invalid playtime/);
  assert.match(sql,/Invalid reflections/);
  assert.match(sql,/Invalid bonus/);
  assert.doesNotMatch(sql,/'score'|t\/270/);
});
