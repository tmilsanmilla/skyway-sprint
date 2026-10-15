import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire, registerHooks } from 'node:module';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ts from 'typescript';
import { PHOTON_STARTERS } from './photon-fury-rules.ts';
registerHooks({resolve(s,c,next){return next(s==='./photon-fury-rules'&&c.parentURL?.endsWith('photon-collection-rules.ts')?s+'.ts':s,c);}});
const { PHOTON_SKINS, PHOTON_THEMES } = await import('./photon-collection-rules.ts');

// Execute the actual TSX components, not a rewritten JSX fixture. No browser/auth/DB is involved.
const require=createRequire(import.meta.url);
const originalTs=require.extensions['.ts'],originalTsx=require.extensions['.tsx'];
const compile=(module,filename)=>module._compile(ts.transpileModule(readFileSync(filename,'utf8'),{
  compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX},fileName:filename,
}).outputText,filename);
let PhotonCollection,PhotonAvatar;
try {
  require.extensions['.ts']=compile;require.extensions['.tsx']=compile;
  ({PhotonCollection}=require('./photon-collection.tsx'));
  ({PhotonAvatar}=require('./photon-avatar.tsx'));
} finally {
  if(originalTs)require.extensions['.ts']=originalTs;else delete require.extensions['.ts'];
  if(originalTsx)require.extensions['.tsx']=originalTsx;else delete require.extensions['.tsx'];
}
const noop=()=>{};
const props={character:'photon_magician',characters:PHOTON_STARTERS,weapon:'lightsaber',skins:[],skinChoices:{},themes:[],theme:'default',weapons:[],level:15,gems:500,photons:200,busy:false,running:false,results:[],onEquip:noop,onBuyWeapon:noop,onOpen:noop,onSkin:noop,onTheme:noop};
test('actual collection SSR renders48 special skins,17 themes,default choices and no direct character purchase',()=>{
  const html=renderToStaticMarkup(React.createElement(PhotonCollection,props));
  for(const skin of PHOTON_SKINS)assert.ok(html.includes(skin.name),skin.name);
  for(const theme of PHOTON_THEMES)assert.ok(html.includes(theme.name),theme.name);
  assert.equal((html.match(/CLASS="photon-skin-preview"/gi)||[]).length,48);
  assert.match(html,/MYSTERY BOX · 200 PHOTONS/);
  assert.match(html,/CHARACTER LOCKED/);assert.match(html,/DEFAULT · OWNED/);
  assert.doesNotMatch(html,/BUY CHARACTER|DIRECT UNLOCK/);
});
test('actual avatar uses the selected skin only on its own character and retains correct four-lane coordinates',()=>{
  const own=renderToStaticMarkup(React.createElement(PhotonAvatar,{character:'photon_tick',skin:'photon_tick_divine',lane:3,guarding:true}));
  assert.match(own,/photon-skin-divine/);assert.match(own,/left:87.5%/);assert.match(own,/Eternal Hour/);assert.match(own,/photon-blade/);
  const foreign=renderToStaticMarkup(React.createElement(PhotonAvatar,{character:'photon_magician',skin:'photon_tick_divine',lane:0}));
  assert.match(foreign,/photon-skin-default/);assert.match(foreign,/left:12.5%/);assert.doesNotMatch(foreign,/Eternal Hour/);
});
test('actual reward result rendering distinguishes new rewards,duplicates and Gem bonuses',()=>{
  const html=renderToStaticMarkup(React.createElement(PhotonCollection,{...props,results:[
    {kind:'character',key:'photon_tick',is_new:true},
    {kind:'skin',key:'photon_tick_pro',is_new:false,duplicate_gems:10},
    {kind:'gems',key:'gems',amount:20},
  ]}));
  assert.match(html,/Chrono Pilot/);assert.match(html,/DUPLICATE · \+10 GEMS/);assert.match(html,/\+20 GEMS/);assert.match(html,/>NEW</);
});
