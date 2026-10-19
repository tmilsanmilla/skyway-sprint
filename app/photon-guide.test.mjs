import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PHOTON_GUIDE } from './photon-guide.ts';

test('the beginner guide explains four lanes,Q,single blocks,misses and photons without formulas or jargon', () => {
  assert.equal(PHOTON_GUIDE.steps.length,3);
  const copy=[PHOTON_GUIDE.introduction,...PHOTON_GUIDE.steps.map(s=>`${s.title} ${s.text}`),PHOTON_GUIDE.needle].join(' ');
  for(const pattern of [/four lanes/i,/press Q or tap LIGHTSABER/i,/one obstacle.*point/i,/half a heart/i,/unblocked needles.*cars do not/i,/Photons are this mode’s currency/i,/points turn into Photons.*end of the run/i,/at least 5 points; 8 points earn 10 Photons/i]) assert.match(copy,pattern);
  assert.doesNotMatch(copy,/formula|\d+%|\*|cooldown|durability|spawn chances/i);
  assert.ok(copy.split(/\s+/).length<175);
});
test('Photon has its own futuristic arena with aligned four-lane inputs and equipped appearance', () => {
  const view=readFileSync(new URL('./photon-fury.tsx',import.meta.url),'utf8');
  const avatar=readFileSync(new URL('./photon-avatar.tsx',import.meta.url),'utf8');
  const css=readFileSync(new URL('./photon-refresh.css',import.meta.url),'utf8');
  assert.match(view,/photon-panel photon-futuristic/);
  assert.match(view,/\[1, 2, 3\]\.map/);
  assert.match(view,/left: `\$\{\(item.lane \+ 0.5\) \* 25\}%`/);
  assert.match(avatar,/left: `\$\{\(lane \+ 0.5\) \* 25\}%`/);
  assert.match(avatar,/s\.key === skin && s\.character === character/);
  assert.match(view,/move\(Math\.sign\(dx\)\)/);
  assert.match(view,/move\(Math\.sign\(target - runRef\.current\.lane\)\)/);
  assert.match(view,/aria-label="Left lane control"[\s\S]*?onClick=\{\(\) => move\(-1\)\}/);
  assert.match(view,/aria-label="Right lane control"[\s\S]*?onClick=\{\(\) => move\(1\)\}/);
  assert.match(css,/photonArenaFlow/); assert.match(css,/prefers-reduced-motion/);
  assert.equal((css.match(/\.theme-photon_theme_\w+ \.photon-arena::before/g)||[]).length,17);
});
test('in-run progress is points only; end-of-run rewards are photons and no score exists', () => {
  const view=readFileSync(new URL('./photon-fury.tsx',import.meta.url),'utf8');
  assert.match(view,/<b>\{photonTotalPoints\(run\)\} POINTS<\/b>/);
  assert.match(view,/<b>\{photonRunReward\(run\)\} PHOTONS<\/b>/);
  assert.doesNotMatch(view,/run\.score|REFLECTIONS<|SCORE<|\{run\.reflections\} REFLECTIONS/);
  assert.match(view,/p_reflections: current\.reflections/);
  assert.match(view,/data\.rules_version !== PHOTON_RULES\.version/);
});
test('damage uses heart-only animation; cooldowns in the bottom footer show tenths and HALT is interactive', () => {
  const view=readFileSync(new URL('./photon-fury.tsx',import.meta.url),'utf8');
  assert.match(view,/className="photon-damage-hearts"/);
  assert.match(view,/aria-label=\{`\$\{damage\} hearts lost`\}/);
  assert.match(view,/className=\{damage - i < 1 \? "partial" : ""\}/);
  const footer=view.slice(view.indexOf('<footer className="photon-footer">'));
  assert.match(footer,/cooldown\.toFixed\(1\)/); assert.match(footer,/abilityCooldown\.toFixed\(1\)/);
  assert.match(view,/<h3>HALT<\/h3>/); assert.match(view,/Choose another lane\. Z \/ X \/ C \/ V/);
  assert.match(view,/event\.target\.closest\("input,textarea,select,\[contenteditable=true\]"\)/);
});
