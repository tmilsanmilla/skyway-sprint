import test from 'node:test';
import assert from 'node:assert/strict';
import { mapScoreBonus, mapContactDamage, resolveTerminalSword, createTerminalCourse, visibleTerminalCourse, vortexBlocksTurn, VORTEX_SPEED_FACTOR, terminalFacingForKey, isTerminalMoveAllowed, terminalMelonScore, terminalHazardForRoll } from './meadow-terminal-rules.ts';

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
  assert.ok(course.some(i=>i.kind==='rock'));
  assert.ok(course.some(i=>i.kind==='melon'&&i.attackCoinReplacement));
  assert.ok(course.some(i=>i.kind==='melon'&&!i.attackCoinReplacement));
  assert.ok(!course.some(i=>i.kind==='coin'));
  for(let at=0;at<90000;at+=100){
    const visible=visibleTerminalCourse(course,at,new Set());
    assert.equal(new Set(visible.map(item=>item.lane)).size,visible.length);
  }
  const visible=visibleTerminalCourse(course,1500,new Set());
  if(visible.length) assert.ok(!visibleTerminalCourse(course,1500,new Set([visible[0].id])).some(item=>item.id===visible[0].id));
});
test('Terminal directional sword follows Z/X/C and limits only moves against facing',()=>{
  assert.equal(terminalFacingForKey('z'),-1);assert.equal(terminalFacingForKey('X'),0);assert.equal(terminalFacingForKey('c'),1);assert.equal(terminalFacingForKey('a'),null);
  for(const facing of [-1,0,1])for(const direction of [-1,0,1])
    assert.equal(isTerminalMoveAllowed(facing,direction),direction===0||facing===0||direction===facing);
  const ready={durability:4,cooldownUntil:0};
  assert.equal(resolveTerminalSword(ready,ready,2,1,1000,-1).hit,true);
  assert.equal(resolveTerminalSword(ready,ready,2,2,1000,-1).hit,false);
  assert.equal(resolveTerminalSword(ready,ready,2,3,1000,1).hit,true);
  assert.equal(resolveTerminalSword(ready,ready,4,3,1000,1).hit,false);
  assert.equal(resolveTerminalSword(ready,ready,2,2,1000,0).hit,true);
});
test('Terminal melons preserve both ordinary and replacement multiplicative buffs',()=>{
  assert.equal(terminalMelonScore(301),452);
  assert.equal(terminalMelonScore(300,true),630);
  assert.equal(terminalMelonScore(300),450);
  const counts={};for(let i=0;i<100;i++){const k=terminalHazardForRoll((i+.5)/100);counts[k]=(counts[k]??0)+1;}
  assert.deepEqual(counts,{barrel:30,spikes:40,rock:5,car:25});
});
