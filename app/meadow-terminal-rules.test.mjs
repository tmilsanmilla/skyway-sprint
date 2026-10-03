import test from 'node:test';
import assert from 'node:assert/strict';
import { mapScoreBonus, mapContactDamage, resolveTerminalSword, createTerminalCourse, visibleTerminalCourse, vortexBlocksTurn, VORTEX_SPEED_FACTOR } from './meadow-terminal-rules.ts';

test('Meadow doubles contact damage only in the bonus lane and multiplies score', () => {
  assert.equal(mapScoreBonus('meadow',2,2,[]),1.4);
  assert.equal(mapScoreBonus('meadow',1,2,[]),1);
  assert.equal(mapContactDamage('meadow','barrel',.5,2,2),1);
  assert.equal(mapContactDamage('meadow','rock',2,1,2),2);
  assert.equal(VORTEX_SPEED_FACTOR,.86);
  assert.equal(vortexBlocksTurn(-1,-1,1500,1499),true);
  assert.equal(vortexBlocksTurn(1,-1,1500,1499),false);
  assert.equal(vortexBlocksTurn(-1,-1,1500,1500),false);
});
test('Terminal sword hit locks both swords; miss damages only its owner and consumes durability', () => {
  const ready={durability:4,cooldownUntil:0};
  const hit=resolveTerminalSword(ready,ready,2,2,1000);
  assert.equal(hit.rivalDamage,1);
  assert.equal(hit.self.durability,4);
  assert.equal(hit.rival.cooldownUntil,4000);
  assert.equal(resolveTerminalSword(hit.rival,hit.self,2,2,3999).used,false);
  const miss=resolveTerminalSword(ready,ready,0,4,1000);
  assert.equal(miss.selfDamage,.5);
  assert.equal(miss.self.durability,3);
  assert.equal(miss.rival.cooldownUntil,0);
  assert.equal(resolveTerminalSword({durability:0,cooldownUntil:0},ready,0,0,9999).used,false);
  assert.equal(mapContactDamage('terminal','spikes',1,1,0),2);
  assert.ok(Math.abs(1.1 * mapScoreBonus('terminal',2,0,[2])-1.54)<1e-12);
});
test('Terminal course is shared, reconnectable, and never overlaps objects in a lane', () => {
  const course=createTerminalCourse('match-id',7);
  assert.deepEqual(course,createTerminalCourse('match-id',7));
  for(let at=0;at<90000;at+=100){
    const visible=visibleTerminalCourse(course,at,new Set());
    assert.equal(new Set(visible.map(item=>item.lane)).size,visible.length);
  }
  const visible=visibleTerminalCourse(course,1500,new Set());
  if(visible.length) assert.ok(!visibleTerminalCourse(course,1500,new Set([visible[0].id])).some(item=>item.id===visible[0].id));
});
