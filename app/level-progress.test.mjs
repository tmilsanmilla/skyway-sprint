import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { broadLevelProgress } from "./progression-rules.ts";

test("the level bar moves only in broad fifths, not exact XP percentages", () => {
  assert.deepEqual([0,1,39,40,79,80,119,120,159,160,199,200].map(x=>broadLevelProgress(x,200)),[0,0,0,20,20,40,40,60,60,80,80,100]);
  assert.equal(broadLevelProgress(-1,200),0);
  assert.equal(broadLevelProgress(999,200),100);
  for (const [xp,required] of [[NaN,200],[1,0],[Infinity,200],[20,NaN]]) assert.equal(broadLevelProgress(xp,required),0);
});
test("the player display and run summary never render numerical XP", () => {
  const card=readFileSync(new URL('./level-progress.tsx',import.meta.url),'utf8');
  const page=readFileSync(new URL('./page.tsx',import.meta.url),'utf8');
  assert.doesNotMatch(card,/\bXP\b|toLocaleString|xp_required/);
  assert.match(card,/role="progressbar"/);
  assert.match(card,/aria-valuetext/);
  assert.match(page,/<LevelProgress level=\{playerProgression.level\}/);
  assert.doesNotMatch(page,/run-xp-summary|lastRunXpBreakdown|<b>XP<\/b>|XP earned this run/);
});
test("the new reset is one-time and preserves non-progression data and receipt IDs", () => {
  const sql=readFileSync(new URL('../neon/progression.sql',import.meta.url),'utf8');
  assert.match(sql,/if not exists\(select 1 from app_private.progression_resets where version=20261009\)/);
  assert.match(sql,/set level=0,xp_in_level=0,lifetime_xp=0,progression_version=20261009/);
  assert.match(sql,/Reset fence 20261009/);
  assert.doesNotMatch(sql.split('create or replace function')[0],/delete from|drop table|set total_gems|set high_score|update public.player_progression_events/);
  assert.match(sql,/VACUUM \(ANALYZE\) public.player_stats; separately/);
});
