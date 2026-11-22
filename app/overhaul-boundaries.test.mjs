import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {OVERHAUL_CHARACTERS}from './overhaul-catalog.ts';
import {OverhaulRuntime}from './overhaul-runtime.ts';
import {readCheckpointItems,readOverhaulNetwork,sharedWaveElapsed}from './overhaul-network.ts';
import {SONG_CLIPS,SONG_LANGUAGES}from './overhaul-song-library.ts';
const key=name=>OVERHAUL_CHARACTERS.find(c=>c.name===name).key;
const run=(name,extra={})=>new OverhaulRuntime({key:key(name),owned:[],online:false,laneCount:5,random:()=>.5,...extra});
test('Conic focus excludes barrels and covers all four specified hazards',()=>{
 const r=run('Conic');const seen=new Set();for(let i=0;i<4;i++){r.counters.focusIndex=i;seen.add(r.context.form);}assert.deepEqual(seen,new Set(['spikes','log','rock','car']));
});
test('Um dispersal targets a random hazard including snowflakes, never a pickup',()=>{
 const r=run('Um',{random:()=>.999});r.counters.ashes=20;r.drain();
 assert.equal(r.activate('e',[{id:1,kind:'gem',lane:0,y:80},{id:2,kind:'log',lane:1,y:10},{id:3,kind:'snowflake',lane:3,y:20}]),true);
 assert.deepEqual(r.drain().find(e=>e.type==='clear').ids,[3]);assert.equal(r.counters.ashes,0);assert.equal(r.counters.dispersals,1);
});
test('borrowed Citadel blocks the opening hazard and consumes only one block',()=>{
 const r=run('Echo');r.borrowed=[key('Citadel')];r.beginWave(2);assert.equal(r.hit('car',1).damage,0);assert.ok(r.hit('car',1).damage>0);
});
test('borrowed Sentinel selects tied historical damage, blocks once, then halves it',()=>{
 const r=run('Echo',{random:()=>0});r.borrowed=[key('Sentinel')];r.counters['sentinelDamage:car']=5;r.counters['sentinelDamage:rock']=5;r.beginWave(2);
 const kind=r.context.counters.sentinelAnalyzed===4?'rock':'car';assert.equal(r.hit(kind,1).damage,0);assert.equal(r.hit(kind,1).damage,.5);
});
test('mirror reflection is bounded to the issued ten seconds and emits contacts without self damage',()=>{
 const r=run('Echo',{online:true,opponentKey:key('Ace')});r.counters.knowing=1;r.counters.shards=1;r.drain();assert.equal(r.death('car'),true);r.drain();assert.equal(r.hit('rock',2).damage,0);assert.deepEqual(r.drain().find(e=>e.action==='echo-hit').values,{amount:2});
 r.tick(10.01);assert.ok(r.drain().some(e=>e.action==='echo-final-row'));
});
test('delivered mirror health restores the original cap without healing after expiration',()=>{
 const r=run('Ace');r.receive('one','echo-health',{},10);assert.equal(r.maxHp,10);r.hp=2;r.tick(10.01);assert.equal(r.maxHp,3);assert.equal(r.drain().filter(e=>e.type==='health').at(-1).hp,2);
});
test('durable deliveries apply once and Conic retry uses its independent challenge clock',()=>{
 const r=run('Ace');assert.equal(r.receive('one','score',{amount:10},3),true);assert.equal(r.receive('one','score',{amount:10},3),false);assert.equal(r.drain().filter(e=>e.type==='score').length,1);
 r.receive('two','conic-check',{shape:3},10);assert.equal(r.answerInterference(2,50),false);assert.equal(r.answerInterference(3,50.99),false);assert.equal(r.answerInterference(3,51),true);
});
test('reconnect preserves original ownership, active phase identity and non-replayable deliveries',()=>{
 const r=run('Tempo');r.openChallenge('tempo');r.receive('score-once','score',{amount:10},2);const c=r.checkpoint();const other=run('Tempo');assert.equal(other.restoreCheckpoint(c),true);assert.equal(other.challengeId,r.challengeId);assert.equal(other.receive('score-once','score',{amount:10},2),false);assert.equal(run('Ace').restoreCheckpoint(c),false);
});
test('closed challenge callbacks cannot mutate a later run or resolve an old phase',()=>{
 const r=run('Tempo');r.openChallenge('tempo');const id=r.challengeId;r.resolveChallenge('tempo',3,id);r.openChallenge('tempo');assert.equal(r.resolveChallenge('tempo',1,id),false);r.close();assert.equal(r.resolveChallenge('tempo',1,r.challengeId),false);
});
test('a copied Muse retains the original Snake identity through five distinct nonchaotic class lives',()=>{
 const muse=key('Muse'),pool=OVERHAUL_CHARACTERS.filter(c=>c.name!=='Snake'),index=pool.findIndex(c=>c.key===muse);const r=run('Snake',{random:()=> (index+.1)/pool.length});assert.equal(r.originalKey,key('Snake'));assert.equal(r.behaviorRootKey,muse);
 for(let i=0;i<5;i++){assert.equal(r.phase,'muse');const choice=r.choiceCharacters()[0];assert.ok(choice);assert.equal(r.resolveChallenge('muse',choice.key,r.challengeId),true);if(i<4)assert.equal(r.death('car'),true);}
 assert.equal(r.death('car'),false);assert.equal(new Set(r.usedClasses).size,5);
});
test('visible reconnect items reject malformed ids, coordinates and excessive arrays',()=>{
 const item={id:1,kind:'car',lane:0,y:35};assert.equal(readCheckpointItems([item],5).length,1);
 for(const v of [{...item,id:NaN},{...item,lane:5},{...item,y:Infinity},{...item,kind:'script'}])assert.equal(readCheckpointItems([v],5).length,0);
 assert.equal(readCheckpointItems(Array(101).fill(item),5).length,0);
});
test('shared waves use the server clock, pause without drift and stop at forty seconds',()=>{
 const c={wave:1,startedAt:1000,serverAt:11000,receivedAt:12000,paused:false};assert.equal(sharedWaveElapsed(c,17000),15);assert.equal(sharedWaveElapsed({...c,paused:true},99999),10);assert.equal(sharedWaveElapsed(c,999999),40);
 const stamp='2026-11-22T00:00:00Z';assert.throws(()=>readOverhaulNetwork({six_class:{wave:1,wave_started_at:stamp,server_now:stamp,events:[{id:'not-uuid',action:'score',values:{},due_at:stamp,expires_at:stamp}]}}),/delivery/);
});
test('official quiz library contains exactly six clips for each of eight languages',()=>{
 assert.equal(SONG_CLIPS.length,48);assert.equal(SONG_LANGUAGES.length,8);assert.equal(new Set(SONG_CLIPS.map(c=>c.videoId)).size,48);
 for(const language of SONG_LANGUAGES)assert.equal(SONG_CLIPS.filter(c=>c.language===language).length,6);
});
test('the rejected 58seal behavior is absent from all authored runtime modules',()=>{
 for(const name of fs.readdirSync(new URL('.',import.meta.url)).filter(n=>/^overhaul-.*\.(ts|tsx)$/.test(n))){const text=fs.readFileSync(new URL(name,import.meta.url),'utf8');assert.doesNotMatch(text,/58seal|volume\s*[+*]=\s*5|location\.href\s*=/i,name);}
});

test('prepared RPC character identifiers all reference an actual retained catalog key',()=>{
 const keys=new Set(OVERHAUL_CHARACTERS.map(c=>c.key));for(const retired of ['misc_nomad','misc_scribe','runner_comet'])keys.add(retired);
 for(const file of fs.readdirSync(new URL('../neon/',import.meta.url)).filter(n=>/^six-class-.*\.sql$/.test(n))){const sql=fs.readFileSync(new URL('../neon/'+file,import.meta.url),'utf8');for(const match of sql.matchAll(/'(?:runner|medic|tank|trickster|misc|chaotic)_[a-z0-9_]+'/g))assert.ok(keys.has(match[0].slice(1,-1)),file+': '+match[0]);}
});
test('Echo awards exactly six shards and eight borrowed passives across its four class-choice quests',()=>{
 const r=run('Echo');
 const complete=()=>{r.checkEchoQuest();assert.equal(r.phase,'echo-passives');const keys=r.choiceCharacters().slice(0,2).map(c=>c.key);assert.equal(r.resolveChallenge(r.phase,keys,r.challengeId),true);};
 r.wave=5;complete();r.counters.waveEndHealing=5;complete();r.counters.damageTaken=10;complete();r.wave=15;complete();
 assert.equal(r.borrowed.length,8);r.counters.physicalGems=20;r.checkEchoQuest();assert.equal(r.phase,null);r.counters.melons=25;r.checkEchoQuest();assert.equal(r.phase,null);assert.equal(r.counters.shards,6);
 r.counters.knowingRecovered=1;r.checkEchoQuest();assert.equal(r.counters.knowing,1);assert.deepEqual(r.drain().filter(e=>e.type==='health').at(-1),{type:'health',hp:7,maxHp:7});
});
