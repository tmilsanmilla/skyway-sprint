import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PHOTON_CHARACTERS } from './photon-fury-rules.ts';
import { registerHooks } from 'node:module';
registerHooks({resolve(s,c,next){return next(s==='./photon-fury-rules'&&c.parentURL?.endsWith('photon-collection-rules.ts')?s+'.ts':s,c);}});
const { PHOTON_SKINS, PHOTON_SKIN_TIERS, PHOTON_THEMES, PHOTON_BOX_COST, PHOTON_BOX_ODDS, rollPhotonMysteryBox, settlePhotonMysteryBox, photonDuplicateGems } = await import('./photon-collection-rules.ts');
const sequence = values => { let i=0; return () => { assert.ok(i<values.length,'unexpected random request'); return values[i++]; }; };
const oneBonusBox = (a,c,tail=[]) => rollPhotonMysteryBox(sequence([a,.35,0,0,0,0,.999,.999,c,...tail]));
test('all existing skin keys remain alongside two new tiers per character',()=>{
  assert.equal(PHOTON_SKINS.length,80);assert.equal(new Set(PHOTON_SKINS.map(s=>s.key)).size,80);
  assert.equal(new Set(PHOTON_SKINS.map(s=>s.name)).size,80);
  assert.deepEqual(PHOTON_SKIN_TIERS,['intermediate','pro','ascendant','divine','immortal']);
  for(const key of Object.keys(PHOTON_CHARACTERS)) assert.deepEqual(PHOTON_SKINS.filter(s=>s.character===key).map(s=>s.tier),PHOTON_SKIN_TIERS);
  assert.equal(PHOTON_SKINS.find(s=>s.key==='photon_magician_divine').name,'Astral Sovereign');
  for(const s of PHOTON_SKINS) {assert.match(s.description,/Cosmetic only/);assert.match(s.color,/^#[a-f0-9]{6}$/i);}
});
test('24 paid themes plus default form a 5 by 5 inventory and retain every existing theme',()=>{
  assert.equal(PHOTON_THEMES.length,24);assert.equal(new Set(PHOTON_THEMES.map(t=>t.key)).size,24);
  for(const rarity of ['common','uncommon','rare','epic','legendary','mythic']) assert.equal(PHOTON_THEMES.filter(t=>t.rarity===rarity).length,4);
  for(const old of ['cobalt','hangar','terminal','reactor','polar','sunset','abyss','quartz','mars','storm','void','garden','nova','chrono','prism','singularity','celestial']) assert.ok(PHOTON_THEMES.some(t=>t.key===`photon_theme_${old}`));
});
test('all independent odds are exact and sum to 100%',()=>{
  assert.equal(PHOTON_BOX_COST,200);
  for(const key of ['traditional','rush','strategic','wild','skins','partC']) assert.equal(PHOTON_BOX_ODDS[key].reduce((a,b)=>a+b,0),100);
  assert.equal(PHOTON_BOX_ODDS.themes.reduce((a,b)=>a+b,0),10000);
  assert.deepEqual(PHOTON_BOX_ODDS.skins,[53,35,8,3,1]);assert.deepEqual(PHOTON_BOX_ODDS.partC,[72,24,4]);
});
test('retained character/category boundaries and no repeated bonus category',()=>{
  for(const [roll,key] of [[0,'photon_tick'],[.48,'photon_trumpet'],[.77,'photon_saxophone']]) assert.deepEqual(oneBonusBox(roll,.99)[0],{kind:'character',key,part:'A'});
  const box=rollPhotonMysteryBox(sequence([0,.34999,0,0,0,0,0,0,.99]));
  const b=box.filter(r=>r.part==='B');assert.deepEqual(b.map(r=>r.kind),['character','character','skin']);
  assert.deepEqual(b.slice(0,2).map(r=>PHOTON_CHARACTERS[r.key].category),['rush','strategic']);
  assert.deepEqual(oneBonusBox(0,.99).filter(r=>r.part==='B').map(r=>r.kind),['character','skin','skin']);
});
test('all 16 characters and all five skin tiers can be pulled at exact boundaries',()=>{
  const keys=Object.keys(PHOTON_CHARACTERS);
  for(let i=0;i<16;i++) {
    const box=rollPhotonMysteryBox(sequence([0,.5,0,0,i/16,0,0,0,.99]));
    assert.equal(box[2].key,`${keys[i]}_intermediate`);
  }
  for(const [roll,tier] of [[0,'intermediate'],[.529999,'intermediate'],[.53,'pro'],[.879999,'pro'],[.88,'ascendant'],[.959999,'ascendant'],[.96,'divine'],[.989999,'divine'],[.99,'immortal']]) {
    const box=rollPhotonMysteryBox(sequence([0,.5,0,0,0,roll,0,0,.99]));
    assert.equal(box[2].key,`photon_magician_${tier}`);
  }
});
test('Part C exact 72/24/4 boundaries give themes, Intermediate skin, or 75 Stardust',()=>{
  const themes=oneBonusBox(0,.71999,[0,0,.9999,.9999]).filter(r=>r.part==='C');
  assert.equal(themes.length,2);assert.equal(themes[0].key,'photon_theme_cobalt');assert.equal(themes[1].key,'photon_theme_elysium');
  for(const roll of [.72,.95999]) assert.deepEqual(oneBonusBox(0,roll,[.999]).at(-1),{kind:'skin',key:'photon_spade_intermediate',part:'C'});
  for(const roll of [.96,.99999]) assert.deepEqual(oneBonusBox(0,roll).at(-1),{kind:'stardust',key:'stardust_75',amount:75,part:'C'});
});
test('all four themes in every rarity are actually selectable',()=>{
  for(const [roll,rarity] of [[0,'common'],[.4,'uncommon'],[.7,'rare'],[.851,'epic'],[.965,'legendary'],[.998,'mythic']]) {
    const pool=PHOTON_THEMES.filter(t=>t.rarity===rarity);
    for(let i=0;i<4;i++) assert.equal(oneBonusBox(0,0,[roll,i/4,0,0]).filter(r=>r.part==='C')[0].key,pool[i].key);
  }
});
test('all item duplicates return ten, including same-box duplicates; Stardust never becomes ownership',()=>{
  for(const kind of ['character','skin','theme']) for(const part of ['A','B','C']) assert.equal(photonDuplicateGems(kind,part),10);
  const items=[{kind:'character',key:'photon_tick',part:'A'},{kind:'skin',key:'photon_tick_pro',part:'B'},{kind:'skin',key:'photon_tick_pro',part:'C'},{kind:'theme',key:'photon_theme_nova',part:'C'},{kind:'stardust',key:'stardust_75',amount:75,part:'C'}];
  const settled=settlePhotonMysteryBox(items,['photon_tick','photon_theme_nova']);
  assert.deepEqual(settled.results.map(r=>r.duplicate_gems),[10,0,10,10,0]);assert.equal(settled.gems,30);assert.equal(settled.stardust,75);
  assert.ok(!settled.ownedKeys.includes('stardust_75'));assert.equal(settled.ownedKeys.filter(k=>k==='photon_tick_pro').length,1);
});
test('invalid RNG fails without selecting a reward',()=>{
  for(const n of [-.1,1,NaN,Infinity]) assert.throws(()=>rollPhotonMysteryBox(()=>n),/Invalid box roll/);
});
test('migration preserves nonce/locks by patching existing server lifecycle and adds owned equip tiers',()=>{
  const sql=readFileSync(new URL('../neon/update-2-3-economy.sql',import.meta.url),'utf8');
  assert.match(sql,/pg_get_functiondef/);assert.match(sql,/Unexpected Photon definition/);
  assert.match(sql,/array\[53,35,8,3,1\]/);assert.match(sql,/case when inserted=1 then 0 else 10 end/);
  assert.match(sql,/stardust_bonus:=75/);assert.match(sql,/if r<\.72 then/);assert.match(sql,/elsif r<\.96 then/);
  assert.match(sql,/inserted=1 and item\.kind=''skin''/);assert.match(sql,/skin_choices=jsonb_set/);
  assert.doesNotMatch(sql,/delete from .*photon_unlocks|truncate|drop table/i);
});
