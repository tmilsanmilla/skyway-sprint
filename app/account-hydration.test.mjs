import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
const source=await readFile(new URL('./page.tsx',import.meta.url),'utf8');
const ast=ts.createSourceFile('page.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let arrow;function visit(n){if(ts.isVariableDeclaration(n)&&n.name.getText(ast)==='applySession')arrow=n.initializer;ts.forEachChild(n,visit);}visit(ast);assert(arrow);
const body=ts.transpileModule('globalThis.applySession = '+arrow.getText(ast),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
const actor={id:'original-native-id',email:'synthetic@example.invalid',app_metadata:{}};
const valid={player_stats:{total_gems:777,high_score:888,stardust:999},player_profiles:{username:'existing_runner'},player_unlocks:[],player_loadouts:null,is_admin:false,get_admin_role:null,get_player_progression:{level:7,xp:10,xp_required:100,lifetime_xp:500,progression_version:1},get_my_pixel_identity:{linked:true}};
function setup(overrides={}){
 const events=[],calls=[];const results={...valid,...overrides};
 const response=name=>{
  calls.push(name);
  const value=typeof results[name]==='function'?results[name]():results[name];
  const promise=Promise.resolve(value).then(v=>v?.error?{data:null,error:v.error}:{data:v,error:null});
  promise.select=()=>promise;promise.eq=()=>promise;promise.maybeSingle=()=>promise;return promise;
 };
 const context={console:{error(){}},Boolean,Array,Number,
  userIdRef:{current:actor.id},authSessionGenerationRef:{current:1},authSessionUserIdRef:{current:actor.id},progressionOwnerUserIdRef:{current:null},gemsRef:{current:0},highScoreRef:{current:0},runIsTestModeRef:{current:false},
  ensureNeonCompatibleSession:async session=>session,setDataSession:()=>true,verifyCurrentNeonSession:async()=>null,refreshPlayerAccess:async()=>true,isPixelPulseAvailable:true,
  normalizeOwnedLoadout:()=>({characterKey:'runner_ace',playerCosmetic:'',obstacleCosmetic:'',environmentCosmetic:''}),createEmptyPlayerProgression:()=>({}),
  applyProgressionPayload:data=>events.push(['progression',data]),supabase:{from:response,rpc:response},
 };
 for(const name of new Set(arrow.getText(ast).match(/\bset[A-Z]\w*/g)))context[name]=value=>events.push([name,value]);
 vm.createContext(context);vm.runInContext(body,context);
 return {context,events,calls,run:()=>context.applySession({user:actor},1)};
}
test('actual page hydrate restores saved account data on a fresh client',async()=>{
 const h=setup();await h.run();assert(h.events.some(([k,v])=>k==='setGems'&&v===777));assert(h.events.some(([k,v])=>k==='setUsername'&&v==='existing_runner'));assert(!h.events.some(([k,v])=>k==='setGems'&&v===0));
});
for(const relation of ['player_stats','player_profiles','player_unlocks','player_loadouts','get_player_progression'])test('actual page refuses failed '+relation+' instead of displaying an empty account',async()=>{
 const h=setup({[relation]:{error:{message:'synthetic unavailable'}}});await h.run();
 assert(h.events.some(([k,v])=>k==='setPlayerAccessError'&&v.includes('Nothing has been reset')));
 assert(!h.events.some(([k])=>['setGems','setUnlocks','setUsernameRequired','progression'].includes(k)));
});
test('new-account provisioning race rereads stats and never guesses zero',async()=>{
 let count=0;const h=setup({player_stats:()=>++count===1?null:valid.player_stats});await h.run();assert.equal(count,2);assert(h.events.some(([k,v])=>k==='setGems'&&v===777));
});
test('still-missing stats blocks the game without replacing progress',async()=>{
 const h=setup({player_stats:null});await h.run();assert(h.events.some(([k,v])=>k==='setPlayerAccessError'&&v.includes('Nothing has been reset')));assert(!h.events.some(([k])=>k==='setGems'));
});
test('late old-account reads cannot hydrate a newer sign-in generation',async()=>{
 let release;const wait=new Promise(r=>release=r);const h=setup({get_player_progression:()=>wait});
 const pending=h.run();while(!h.calls.includes('get_player_progression'))await new Promise(r=>setTimeout(r,0));
 h.context.authSessionGenerationRef.current=2;h.context.userIdRef.current='different-id';const mark=h.events.length;release(valid.get_player_progression);await pending;assert.equal(h.events.length,mark);
});
