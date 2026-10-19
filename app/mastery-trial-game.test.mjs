import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as rules from './mastery-rules.ts';

/** Execute the actual component with a controlled animation clock. This is not a browser/DB test. */
function fixture(character,random=Math.random){
 const cells=[],events=[],listeners=new Map();let index=0,effects=[],time=1,frame;
 const same=(a,b)=>a&&b&&a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));
 const react={
  useState(initial){const i=index++;if(!(i in cells))cells[i]=typeof initial==='function'?initial():initial;return[cells[i],v=>{cells[i]=typeof v==='function'?v(cells[i]):v;}];},
  useRef(value){const i=index++;return cells[i]??={current:value};},
  useCallback(fn,deps){const i=index++,old=cells[i];if(old&&same(old.deps,deps))return old.fn;cells[i]={fn,deps};return fn;},
  useEffect(fn,deps){const i=index++,old=cells[i];if(old&&same(old.deps,deps))return;cells[i]={deps};effects.push(()=>{old?.cleanup?.();cells[i].cleanup=fn();});},
 };
 class Element {constructor(editable=false){this.editable=editable;}closest(){return this.editable?this:null;}}
 const doc={hidden:false};
 const jsx=(type,props)=>({type,props});
 const require=name=>name==='react'?react:name==='react/jsx-runtime'?{jsx,jsxs:jsx}:name==='./mastery-rules'?rules:name==='./audio-engine'?{audioEngine:{playSfx(){return Promise.resolve();}}}:name==='./obstacle-sprite'?{Obstacle:'Obstacle'}:name==='./mastery-trial'?{MasteryTrialOverlay:'Overlay'}:name.endsWith('.css')?{}:(()=>{throw new Error(name);})();
 const compiled=ts.transpileModule(readFileSync(new URL('./mastery-trial-game.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 const exports={};vm.runInNewContext(compiled,{exports,require,HTMLElement:Element,document:doc,Promise,Math:Object.assign(Object.create(Math),{random}),Number,window:{addEventListener(k,fn){listeners.set(k,fn);},removeEventListener(k){listeners.delete(k);}},requestAnimationFrame(fn){frame=fn;return 1;},cancelAnimationFrame(){frame=null;}});
 const onEvent=e=>events.push(e),onFinish=async()=>true,onExit=()=>{};
 const render=()=>{index=0;effects=[];const tree=exports.MasteryTrialGame({character,onEvent,onFinish,onExit});for(const fn of effects)fn();return tree;};
 render();frame(time);
 return {events,doc,render,get state(){return cells[1].current;},step(ms=50){time+=ms;const next=frame;frame=null;next(time);},key(key,{editable=false}={}){let prevented=false;listeners.get('keydown')({key,target:new Element(editable),repeat:false,preventDefault(){prevented=true;}});return prevented;}};
}

test('trial keyboard movement still works after a game button is focused, but not while editing text',()=>{
 const f=fixture('runner_dash');assert.equal(f.state.lane,2);
 assert.equal(f.key('ArrowLeft'),true);assert.equal(f.state.lane,1);
 assert.equal(f.key('ArrowRight',{editable:true}),false);assert.equal(f.state.lane,1);
 assert.equal(f.key('e'),true);assert.ok(f.state.shield>0);
});
test('every frozen turn waits .25 active seconds and a hidden tab cannot finish the queued move',()=>{
 const f=fixture('runner_stride');f.state.freeze=3;
 f.key('ArrowLeft');assert.equal(f.state.lane,2);
 for(let i=0;i<4;i++)f.step();assert.equal(f.state.lane,2);
 f.doc.hidden=true;for(let i=0;i<20;i++)f.step();assert.equal(f.state.lane,2);
 f.doc.hidden=false;f.step();assert.equal(f.state.lane,1);
 f.key('ArrowRight');for(let i=0;i<4;i++)f.step();assert.equal(f.state.lane,1);
 f.step();assert.equal(f.state.lane,2);
 assert.ok(f.state.freeze>f.state.clock);
});
test('a later missed Bloom trial gem which removes the last HP immediately fails and reports death',()=>{
 const f=fixture('medic_bloom');f.state.hp=1;f.state.trial.waveGemSeen=true;
 f.state.pieces=[{id:1,lane:0,y:109,kind:'gem',special:false}];
 f.step();assert.equal(f.state.hp,0);assert.equal(f.state.trial.phase,'failed');
 assert.equal(f.events.filter(e=>e.type==='trial-died').length,1);
});
test('a queued frozen move cannot happen once a trial has ended',()=>{
 const f=fixture('runner_dash');f.state.freeze=3;f.key('ArrowLeft');f.state.trial.phase='failed';
 for(let i=0;i<30;i++)f.step();assert.equal(f.state.lane,2);
});
test('Guard final-wave quota cannot be starved by rolls that would otherwise always choose snowflakes',()=>{
 const f=fixture('tank_guard',()=>.999);f.state.wave=4;f.state.trial.wave=4;f.state.trial.seconds=90;f.state.clock=90;
 // Clear previous pieces to isolate spawn planning, not to simulate a win.
 for(let i=1;i<=5;i++){
  f.state.pieces=[];f.state.spawn=.8;f.step();
  assert.equal(f.state.blue,i);assert.equal(f.state.pieces.length,1);
  assert.equal(f.state.pieces[0].special,true);assert.notEqual(f.state.pieces[0].kind,'snowflake');
 }
 f.state.pieces=[];f.state.spawn=.8;f.step();
 assert.equal(f.state.blue,5);assert.equal(f.state.pieces[0].special,false);
});
