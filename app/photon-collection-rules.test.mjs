import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PHOTON_CHARACTERS } from './photon-fury-rules.ts';
import { PHOTON_SKINS, PHOTON_THEMES, PHOTON_BOX_COST, PHOTON_BOX_ODDS, rollPhotonMysteryBox, settlePhotonMysteryBox, photonDuplicateGems } from './photon-collection-rules.ts';
const sequence = (values) => { let i=0; return () => { assert.ok(i<values.length,'roll requested an unexpected random value'); return values[i++]; }; };
// A, B=one Rush character +2skins, C. Every RNG decision is independently supplied.
const oneBonusBox = (a,c,tail=[]) => rollPhotonMysteryBox(sequence([a,.35,0,0,0,0,.999,.999,c,...tail]));

test('48 uniquely named special skins give every character Intermediate/Pro/Divine and no duplicate key', () => {
  assert.equal(PHOTON_SKINS.length,48); assert.equal(new Set(PHOTON_SKINS.map(s=>s.key)).size,48);
  assert.equal(new Set(PHOTON_SKINS.map(s=>s.name)).size,48);
  for(const key of Object.keys(PHOTON_CHARACTERS)) assert.deepEqual(PHOTON_SKINS.filter(s=>s.character===key).map(s=>s.tier),['intermediate','pro','divine']);
  for(const s of PHOTON_SKINS) {assert.match(s.description,/Cosmetic only/);assert.match(s.color,/^#[a-f0-9]{6}$/i);assert.ok(s.emblem);}
});
test('17 purely cosmetic themes use3 of each rarity and2 Mythics, with different color identities', () => {
  assert.equal(PHOTON_THEMES.length,17); assert.equal(new Set(PHOTON_THEMES.map(t=>t.key)).size,17);
  for(const rarity of ['common','uncommon','rare','epic','legendary','mythic']) assert.equal(PHOTON_THEMES.filter(t=>t.rarity===rarity).length,rarity==='mythic'?2:3);
  assert.equal(new Set(PHOTON_THEMES.map(t=>[t.floor,t.glow,t.accent].join(':'))).size,17);
});
test('exact box price and each independent odds pool sum to100%', () => {
  assert.equal(PHOTON_BOX_COST,200);
  for(const pool of ['traditional','rush','strategic','wild','skins','partC']) assert.equal(PHOTON_BOX_ODDS[pool].reduce((a,b)=>a+b,0),100,pool);
  assert.equal(PHOTON_BOX_ODDS.themes.reduce((a,b)=>a+b,0),10000);
  assert.deepEqual(PHOTON_BOX_ODDS.partC,[65,15,20]);
});
test('PartA uses exact48/29/23 Traditional boundaries and never a starter', () => {
  for(const [roll,key] of [[0,'photon_tick'],[.47999,'photon_tick'],[.48,'photon_trumpet'],[.76999,'photon_trumpet'],[.77,'photon_saxophone'],[.99999,'photon_saxophone']]) assert.deepEqual(oneBonusBox(roll,.65)[0],{kind:'character',key,part:'A'});
});
test('PartB35% branch selects2 different categories and1 skin,65% branch selects1 category and2skins', () => {
  const two = rollPhotonMysteryBox(sequence([0,.34999,0,0,0,0,0,0,.65]));
  const b=two.filter(r=>r.part==='B'); assert.deepEqual(b.map(r=>r.kind),['character','character','skin']);
  assert.deepEqual(b.slice(0,2).map(r=>PHOTON_CHARACTERS[r.key].category),['rush','strategic']);
  assert.deepEqual(oneBonusBox(0,.65).filter(r=>r.part==='B').map(r=>r.kind),['character','skin','skin']);
});
test('bonus categories and character boundaries use exact separate pools; Wild skin substitute can belong to any character', () => {
  const cases=[
    [0,0,'photon_bull'],[0,.41,'photon_nuclear'],[0,.74,'photon_burner'],
    [.34,0,'photon_wrench'],[.34,.57,'photon_bear'],[.34,.89,'photon_magnet'],
    [.67,0,'photon_oyster'],[.67,.26,'photon_static'],[.67,.44,'photon_spade'],
  ];
  for(const [category,roll,key] of cases) {
    const box=rollPhotonMysteryBox(sequence([0,.5,category,roll,0,0,0,0,.65]));
    assert.equal(box[1].key,key);
  }
  const wildSkin=rollPhotonMysteryBox(sequence([0,.5,.67,.55,0,0,0,0,0,0,.65]));
  assert.deepEqual(wildSkin[1],{kind:'skin',key:'photon_magician_intermediate',part:'B'});
});
test('all16 characters are equally selectable for skins and tier boundaries are55/40/5', () => {
  const keys=Object.keys(PHOTON_CHARACTERS);
  for(let i=0;i<16;i++) {
    const box=rollPhotonMysteryBox(sequence([0,.5,0,0,i/16,0,0,0,.65]));
    assert.equal(box[2].key,`${keys[i]}_intermediate`);
  }
  for(const [roll,tier] of [[0,'intermediate'],[.5499,'intermediate'],[.55,'pro'],[.9499,'pro'],[.95,'divine'],[.999,'divine']]) {
    const box=rollPhotonMysteryBox(sequence([0,.5,0,0,0,roll,0,0,.65]));
    assert.equal(box[2].key,`photon_magician_${tier}`);
  }
});
test('PartC awards exactly2 independently rolled themes,20Gems,or one Intermediate-only skin at its boundaries', () => {
  const themes=oneBonusBox(0,.6499,[0,0,.9999,.9999]).filter(r=>r.part==='C');
  assert.equal(themes.length,2); assert.equal(themes[0].key,'photon_theme_cobalt'); assert.equal(themes[1].key,'photon_theme_celestial');
  for(const roll of [.65,.7999]) assert.deepEqual(oneBonusBox(0,roll).at(-1),{kind:'gems',key:'gems',amount:20,part:'C'});
  for(const roll of [.8,.999]) assert.deepEqual(oneBonusBox(0,roll,[.999]).at(-1),{kind:'skin',key:'photon_spade_intermediate',part:'C'});
});
test('theme tier boundaries use40/30/15.1/11.4/3.3/.2 and equal choices within each tier', () => {
  for(const [roll,rarity] of [[0,'common'],[.4,'uncommon'],[.7,'rare'],[.851,'epic'],[.965,'legendary'],[.998,'mythic']]) {
    const pool=PHOTON_THEMES.filter(t=>t.rarity===rarity);
    for(let i=0;i<pool.length;i++) {
      const chosen=oneBonusBox(0,0,[roll,i/pool.length,0,0]).filter(r=>r.part==='C')[0];
      assert.equal(chosen.key,pool[i].key);
    }
  }
});
test('duplicate refunds distinguish Bskins10 from final Cskins5; characters/themes5 including same-box duplicates', () => {
  assert.equal(photonDuplicateGems('skin','B'),10); assert.equal(photonDuplicateGems('skin','C'),5);
  assert.equal(photonDuplicateGems('character','A'),5); assert.equal(photonDuplicateGems('theme','C'),5);
  const items=[{kind:'character',key:'photon_tick',part:'A'},
    {kind:'skin',key:'photon_tick_pro',part:'B'},{kind:'skin',key:'photon_tick_pro',part:'B'},
    {kind:'skin',key:'photon_tick_pro',part:'C'},{kind:'theme',key:'photon_theme_nova',part:'C'},
    {kind:'gems',key:'gems',amount:20,part:'C'}];
  const result=settlePhotonMysteryBox(items,['photon_tick','photon_theme_nova']);
  assert.deepEqual(result.results.map(r=>r.duplicate_gems),[5,0,10,5,5,0]);
  assert.equal(result.gems,45);assert.equal(result.ownedKeys.filter(k=>k==='photon_tick_pro').length,1);
  assert.deepEqual(items[1],{kind:'skin',key:'photon_tick_pro',part:'B'},'inputs are not mutated');
});
test('invalid RNG never silently changes rewards or selects an out-of-range item', () => {
  for(const n of [-.1,1,NaN,Infinity]) assert.throws(()=>rollPhotonMysteryBox(()=>n),/Invalid box roll/);
});
test('SQL is server-rolled,locks actor balances and one nonce,retains no pull-history and mirrors odds/refunds', () => {
  const sql=readFileSync(new URL('../neon/qol-photon-04-box.sql',import.meta.url),'utf8');
  assert.match(sql,/u uuid:=app_private\.photon_user\(\)/);
  assert.equal((sql.match(/where user_id=u for update/g)||[]).length,2);
  assert.match(sql,/if p_nonce=p\.last_box_nonce then return p\.last_box_result/);
  assert.match(sql,/p_nonce is distinct from p\.box_nonce/);
  assert.match(sql,/on conflict\(user_id,item_key\) do nothing/);
  assert.match(sql,/item\.kind='skin' and parts\[j\]='B' then 10 else 5/);
  assert.match(sql,/photons=photons-200/); assert.match(sql,/box_nonce=gen_random_uuid\(\)/);
  assert.match(sql,/array\[4000,3000,1510,1140,330,20\]/);
  assert.doesNotMatch(sql,/create table|delete from|p_gems|p_photons|p_results|extraction_transactions/);
});
