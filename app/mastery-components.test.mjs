import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';

// Render the actual TSX, retaining React's real SSR accessibility/markup behavior.
const require=createRequire(import.meta.url),originalTs=require.extensions['.ts'],originalTsx=require.extensions['.tsx'];
const compile=(module,filename)=>module._compile(ts.transpileModule(readFileSync(filename,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX},fileName:filename}).outputText,filename);
let MasteryShop,CharacterMastery,FlairPicker,ActiveMasteryQuest,MasteryTrialDisclaimer,MasteryTrialOverlay,DuelHub;
try{
 require.extensions['.ts']=compile;require.extensions['.tsx']=compile;
 ({MasteryShop,CharacterMastery,FlairPicker,ActiveMasteryQuest}=require('./mastery-menu.tsx'));
 ({MasteryTrialDisclaimer,MasteryTrialOverlay}=require('./mastery-trial.tsx'));
 ({DuelHub}=require('./duel-menus.tsx'));
}finally{
 if(originalTs)require.extensions['.ts']=originalTs;else delete require.extensions['.ts'];
 if(originalTsx)require.extensions['.tsx']=originalTsx;else delete require.extensions['.tsx'];
}
const noop=()=>{},render=(C,props)=>renderToStaticMarkup(React.createElement(C,props));
const quest={quest:3,progress:[100],complete:true,mastered:true,masteryEnabled:false,flairRewriteEnabled:true};
test('a trial must be exited before starting another, so replay always mounts fresh',()=>{
 const page=readFileSync(new URL('./page.tsx',import.meta.url),'utf8');
 assert.match(page,/busy=\{masteries\.busy\|\|running\|\|!!activeTrial\|\|isVersusRun\}/);
 assert.match(page,/if\(running\|\|isVersusRun\|\|activeTrial\)/);
});
test('opening the collection refreshes saved mastery grants without an account reload',()=>{
 const page=readFileSync(new URL('./page.tsx',import.meta.url),'utf8');
 const collection=page.slice(page.indexOf('const loadCollection = async () =>'),page.indexOf('const extract = async'));
 assert.match(collection,/Promise\.all\(\[/);
 assert.match(collection,/refreshMasteries\(\),/);
 assert.match(collection,/if \(userIdRef\.current !== sessionUserId\) return/);
});
test('actual mastery shop contains all eight prices and never unlocks or starts an unowned character',()=>{
 const html=render(MasteryShop,{state:{active:null,quests:{}},photons:1000,ownedCharacters:['runner_dash'],onPurchase:noop,onActivate:noop});
 assert.equal((html.match(/mastery-shop-card/g)||[]).length,8);
 assert.equal((html.match(/Unlock character first/g)||[]).length,7);
 assert.match(html,/>200 photons</);assert.equal((html.match(/disabled=""/g)||[]).length,7);
});
test('mastery/flair switches are independent and full Guard/Smoke rules are readable in the actual menu',()=>{
 const state={active:null,quests:{tank_guard:quest,trickster_smoke:quest}};
 const guard=render(CharacterMastery,{character:'tank_guard',state,onToggle:noop,onTrial:noop});
 assert.equal((guard.match(/type="checkbox"/g)||[]).length,2);
 assert.equal((guard.match(/checked=""/g)||[]).length,1);
 for(const phrase of ['35% less damage','Blue melons give 3× score','blue gems advance the streak two tiers','Independent of mastery'])assert.ok(guard.includes(phrase),phrase);
 const smoke=render(CharacterMastery,{character:'trickster_smoke',state,onToggle:noop,onTrial:noop});
 for(const phrase of ['3 shared bombs','3 seconds','5 seconds','10 seconds','20-second cooldown'])assert.ok(smoke.includes(phrase),phrase);
});
test('unmastered characters cannot see mastery switches and trial explanation names the exact failure rule',()=>{
 assert.equal(render(CharacterMastery,{character:'runner_dash',state:{active:null,quests:{}},onToggle:noop,onTrial:noop}),'');
 const html=render(MasteryTrialDisclaimer,{character:'runner_vault',onAccept:noop,onCancel:noop});
 assert.match(html,/role="dialog"/);assert.match(html,/0.25 seconds/);assert.match(html,/second ends the trial/);assert.match(html,/do not save scores/);
});
test('equipping one characters flair on another renders only its allowed general effect',()=>{
 const flairs=[{key:'runner_dash',name:'Jet Baton',characterName:'Dash',scoreBonus:.04}];
 const html=render(FlairPicker,{character:'runner_ace',flairs,selected:'runner_dash',state:{active:null,quests:{runner_dash:quest}},onEquip:noop});
 assert.match(html,/\+4% score/);assert.match(html,/do not apply to other characters/);assert.doesNotMatch(html,/green obstacles appear 1 in 90/);
});
test('trial overlay shows objective progress rather than an unlabeled timer',()=>{
 const state={key:'medic_bloom',phase:'playing',seconds:40,wave:2};
 assert.match(render(MasteryTrialOverlay,{state}),/Wave 2\/5/);
 assert.match(render(MasteryTrialOverlay,{state:{...state,key:'tank_guard'}}),/Hit every blue obstacle/);
});
test('Unlimited progress is in the main duel tab and vanishes only when it is unlocked',()=>{
 const props={special:false,mode:'unlimited',activeMode:'mundane',nextRotation:0,level:0,guest:false,rankedUnlocked:false,rankedPurchased:false,gems:0,busy:false,searching:false,unlocking:false,status:'',arenas:[],attacks:[],leaders:[],leadersError:'',leadersLoading:false,onMode:noop,onFind:noop,onCancel:noop,onUnlock:noop,onRefresh:noop,onUpdates:noop,requirements:[{key:'lower',label:'Own all 80',progress:'25/80',complete:false}]};
 const locked=render(DuelHub,props);assert.match(locked,/25\/80/);assert.match(locked,/UNLIMITED 1V1/);assert.doesNotMatch(locked,/RANKED LEADERBOARD/);
 const open=render(DuelHub,{...props,unlimitedUnlocked:true});assert.doesNotMatch(open,/25\/80/);
});
test('active quest shows live and saved progress separately in a collapsed lane-safe disclosure',()=>{
 const state={active:'runner_dash',quests:{runner_dash:{...quest,quest:0,complete:false,mastered:false,progress:[12]}}};
 const liveState={...state,quests:{runner_dash:{...state.quests.runner_dash,progress:[14]}}};
 const html=render(ActiveMasteryQuest,{state,liveState,character:'runner_dash',syncStatus:'retrying',onRetry:noop});
 assert.match(html,/<details class="active-mastery-quest"/);assert.doesNotMatch(html,/<details[^>]* open/);
 for(const phrase of ['Quest 1/3','14/100','Dash 100 times','Last saved: 12/100','Save interrupted','Retry save','never covers a lane'])assert.ok(html.includes(phrase),phrase);
 assert.match(html,/<progress[^>]*max="100"[^>]*value="14"/);
 assert.equal(render(ActiveMasteryQuest,{state:{active:null,quests:{}},liveState:{active:null,quests:{}},character:'runner_dash',syncStatus:'saved',onRetry:noop}),'');
});
test('locally completed quest stays on the saved objective until the server advances it, and shop exposes current amounts',()=>{
 const state={active:'runner_dash',quests:{runner_dash:{...quest,quest:0,complete:false,mastered:false,progress:[99]}}};
 const liveState={active:'runner_dash',quests:{runner_dash:{...state.quests.runner_dash,quest:1,progress:[0]}}};
 const html=render(ActiveMasteryQuest,{state,liveState,character:'runner_ace',syncStatus:'pending',onRetry:noop});
 assert.match(html,/100\/100/);assert.match(html,/Quest 1\/3/);assert.match(html,/Waiting for the saved quest to confirm/);assert.match(html,/Use Dash to advance/);assert.doesNotMatch(html,/Quest 2\/3/);
 const shop=render(MasteryShop,{state,liveState,syncStatus:'pending',photons:10,ownedCharacters:['runner_dash'],onPurchase:noop,onActivate:noop});
 assert.match(shop,/Quest 1 of 3 · Active/);assert.match(shop,/100 \/ 100/);assert.match(shop,/awaiting confirmation/);
});
test('mastered trials expose a reward-free replay without changing the independent switches',()=>{
 const state={active:null,quests:{runner_dash:{...quest,masteryEnabled:false,flairRewriteEnabled:false}}};
 const menu=render(CharacterMastery,{character:'runner_dash',state,onToggle:noop,onTrial:noop});
 assert.match(menu,/Replay trial of Dash/);assert.match(menu,/Practice replay only/);assert.doesNotMatch(menu,/checked=""/);
 const disclaimer=render(MasteryTrialDisclaimer,{character:'runner_dash',replay:true,onAccept:noop,onCancel:noop});
 assert.match(disclaimer,/Start replay/);assert.match(disclaimer,/Practice replay · no rewards/);assert.match(disclaimer,/settings will not change/);
 const overlay=render(MasteryTrialOverlay,{state:{key:'runner_dash',phase:'complete',seconds:45,wave:1},replay:true});
 assert.match(overlay,/Dash replay complete!/);assert.doesNotMatch(overlay,/Dash mastered!/);
});
