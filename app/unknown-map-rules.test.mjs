import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { MAP_IDS } from './arena-map-rules.ts';
import { UNKNOWN_MAP_GUIDE, unknownMapCandidate, isUnknownMapReveal } from './unknown-map-rules.ts';

const require=createRequire(import.meta.url),oldTs=require.extensions['.ts'],oldTsx=require.extensions['.tsx'];
const compile=(module,filename)=>module._compile(ts.transpileModule(readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX},fileName:filename}).outputText,filename);
let MatchSetupPanel,DuelHub;
try {
  require.extensions['.ts']=compile;require.extensions['.tsx']=compile;
  ({MatchSetupPanel,DuelHub}=require('./duel-menus.tsx'));
} finally {
  if(oldTs)require.extensions['.ts']=oldTs;else delete require.extensions['.ts'];
  if(oldTsx)require.extensions['.tsx']=oldTsx;else delete require.extensions['.tsx'];
}
const candidates=Object.freeze(['meadow','classic','pitch','factory']);
const arenas=candidates.map(key=>({key,name:key.toUpperCase(),description:`${key} arena description`,rules:[`${key} normal restrictions`]}));
const noop=()=>{};
const props={mode:'ranked',setup:{phase:'ban',deadline:10000,candidates,ownBan:null,revealedBans:[],confirmed:false,rarity:null},now:0,map:arenas[0],arenas,characters:[{key:'runner_ace',name:'Ace',classKey:'runner',rarity:'default',description:'Ace ability'}],selfName:'Runner One',rivalName:'Runner Two',selfCharacter:'Ace',rivalCharacter:'Ace',selected:'runner_ace',busy:false,status:'',onBan:noop,onPick:noop,onLeave:noop};
const render=p=>renderToStaticMarkup(React.createElement(MatchSetupPanel,p));

test('Unknown covers one shared server-drawn candidate in Ranked only, without changing candidate IDs',()=>{
  assert.equal(unknownMapCandidate('ranked',candidates),'meadow');
  assert.deepEqual(candidates,['meadow','classic','pitch','factory']);
  for(const mode of ['casual','unlimited','rng','hardcore_duel','quicksand','mundane'])assert.equal(unknownMapCandidate(mode,candidates),null);
  assert.ok(!MAP_IDS.includes('unknown'));
});
test('malformed, repeated and non-map candidates never create a mystery card',()=>{
  for(const pool of [[],['meadow'],['meadow','classic','pitch'],[...candidates,'ruins'],['meadow','meadow','pitch','factory'],['unknown','classic','pitch','factory']])assert.equal(unknownMapCandidate('ranked',pool),null);
});
test('every real arena can occupy the shared mystery slot without any client random roll',()=>{
  for(let i=0;i<MAP_IDS.length;i++){
    const pool=Array.from({length:4},(_,n)=>MAP_IDS[(i+n)%MAP_IDS.length]);
    assert.equal(unknownMapCandidate('ranked',pool),MAP_IDS[i]);
    assert.equal(unknownMapCandidate('ranked',[...pool]),MAP_IDS[i]);
  }
});
test('actual ban UI shows exactly three named maps and one mystery, concealing the covered map copy',()=>{
  const html=render(props);
  assert.equal((html.match(/aria-label="Ban /g)||[]).length,4);
  assert.match(html,/aria-label="Ban Unknown Map"/);assert.match(html,/unknown-map-card/);
  assert.doesNotMatch(html,/>MEADOW<|meadow arena description|meadow normal restrictions/);
  for(const name of ['CLASSIC','PITCH','FACTORY'])assert.ok(html.includes(name));
});
test('actual mystery ban callback submits its original server map key rather than an unsupported Unknown ID',()=>{
  // Execute the actual component body with a deterministic hook fixture, retaining
  // its real JSX tree and onClick closures rather than recreating button logic.
  const code=ts.transpileModule(readFileSync(new URL('./duel-menus.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  const exports={};new Function('require','exports',code)(name=>name==='react'?{...React,useState:initial=>[initial,noop]}:name==='./unknown-map-rules'?{UNKNOWN_MAP_GUIDE,unknownMapCandidate,isUnknownMapReveal}:name==='./update-19-rules'?{isDuelCharacterAllowed:()=>true}:require(name),exports);
  const bans=[];const tree=exports.MatchSetupPanel({...props,onBan:key=>bans.push(key)});
  const nodes=[];function walk(node){if(!node||typeof node!=='object')return;if(Array.isArray(node)){node.forEach(walk);return;}nodes.push(node);walk(node.props?.children);}walk(tree);
  const button=nodes.find(node=>node.type==='button'&&node.props['aria-label']==='Ban Unknown Map');
  assert.ok(button);button.props.onClick();assert.deepEqual(bans,['meadow']);
});
test('Casual and rotating setup keep all four original visible cards',()=>{
  for(const mode of ['casual','unlimited','rng','hardcore_duel','quicksand','mundane']){
    const html=render({...props,mode});assert.doesNotMatch(html,/unknown-map-card|Ban Unknown Map/);assert.match(html,/>MEADOW</);
  }
});
test('the reveal uses the selected authoritative arena and keeps its rules before character choice',()=>{
  const html=render({...props,setup:{...props.setup,phase:'announce',deadline:4000}});
  assert.match(html,/UNKNOWN MAP REVEALED/);assert.match(html,/MEADOW/);assert.match(html,/meadow normal restrictions/);assert.match(html,/>4s</);
  const character=render({...props,setup:{...props.setup,phase:'character',deadline:15000}});
  assert.match(character,/Unknown Map revealed: MEADOW/);assert.match(character,/CHOOSE YOUR CHARACTER/);assert.match(character,/>15s</);
  assert.doesNotMatch(render({...props,map:arenas[1],setup:{...props.setup,phase:'announce'}}),/UNKNOWN MAP REVEALED/);
});
test('existing ban lock, busy and timeout rules still disable the mystery button',()=>{
  for(const p of [{...props,busy:true},{...props,now:10000},{...props,setup:{...props.setup,ownBan:'meadow'}}]){
    const html=render(p);assert.match(html,/<button disabled="" aria-label="Ban Unknown Map"/);
  }
  assert.match(render({...props,setup:{...props.setup,ownBan:'meadow'}}),/YOUR BAN/);
});
test('the hub explains Unknown only for Ranked, leaving other arena guides unchanged',()=>{
  const base={special:false,mode:'ranked',activeMode:'rng',nextRotation:Date.UTC(2026,10,19),level:40,guest:false,rankedUnlocked:true,rankedPurchased:true,gems:0,busy:false,searching:false,unlocking:false,status:'',arenas,attacks:[],leaders:[],leadersError:'',leadersLoading:false,onMode:noop,onFind:noop,onCancel:noop,onUnlock:noop,onRefresh:noop,onUpdates:noop};
  const html=p=>renderToStaticMarkup(React.createElement(DuelHub,p));
  assert.match(html(base),/Unknown Map/);assert.match(html(base),/normal lanes, hazards, character restrictions and scoring/);
  assert.doesNotMatch(html({...base,mode:'casual'}),/Unknown Map/);
  assert.doesNotMatch(html({...base,special:true,mode:'rng'}),/Unknown Map/);
});
