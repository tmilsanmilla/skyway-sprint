import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import ts from 'typescript';
const raw=await readFile(new URL('./account-preferences.ts',import.meta.url),'utf8');
const compiled=ts.transpileModule(raw,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
const {AccountPreferencesController,DEFAULT_ACCOUNT_PREFERENCES,parseAccountPreferences,accountInitial,avatarInk}=await import('data:text/javascript;base64,'+Buffer.from(compiled).toString('base64'));
const fresh=()=>({...DEFAULT_ACCOUNT_PREFERENCES});
function memory(){
 const rows=new Map();let writes=0,reads=0;
 return {rows,get writes(){return writes;},get reads(){return reads;},api:{
  async load(id){reads++;return {...(rows.get(id)||fresh())};},
  async save(id,revision,value){writes++;const old=rows.get(id)||fresh();assert.equal(revision,old.revision,'CAS revision');const next={...value,revision:revision+1};rows.set(id,next);return {...next};}
 }};
}
test('new account defaults are gray/pixel and do not contain device state',()=>{
 assert.equal(fresh().avatarColor,'#6b7280');assert.equal(fresh().avatarFont,'pixel');
 assert.equal(accountInitial(' tedmils '),'T');assert.equal(accountInitial(''),'?');
 assert.equal(accountInitial('9runner'),'9');assert.equal(avatarInk('#ffffff'),'#000000');assert.equal(avatarInk('#000000'),'#ffffff');
});
test('malformed or unconfirmed server settings are rejected',()=>{
 for(const change of [{avatarColor:'url(javascript:bad)'},{avatarFont:'arbitrary'},{musicVolume:NaN},{sfxVolume:2},{revision:-1},{revision:0.5}])assert.throws(()=>parseAccountPreferences({...fresh(),...change}));
 assert.equal(parseAccountPreferences({...fresh(),avatarColor:'#AABBCC'}).avatarColor,'#aabbcc');
});
test('a fresh independent client restores account settings with no seeded storage',async()=>{
 const db=memory(),views=[];const first=new AccountPreferencesController('same-id',db.api,()=>true,v=>views.push(v));
 await first.load();first.patch({avatarColor:'#2563eb',avatarFont:'serif',soundtrack:'jazz',musicVolume:0.2,sfxVolume:0.3});await first.flush();first.close();
 const second=new AccountPreferencesController('same-id',db.api,()=>true,()=>{});await second.load();
 assert.equal(second.view().value.avatarColor,'#2563eb');assert.equal(second.view().value.avatarFont,'serif');assert.equal(second.view().value.soundtrack,'jazz');assert.equal(second.view().value.musicVolume,0.2);assert.equal(second.view().status,'saved');assert.equal(db.writes,1);second.close();
});
test('an unconfirmed write is not success, and retry reconciles an actual committed value without a second write',async()=>{
 const db=memory();let lose=true;
 const api={...db.api,async save(...args){const value=await db.api.save(...args);if(lose){lose=false;throw Error('lost ack');}return value;}};
 const c=new AccountPreferencesController('owner',api,()=>true,()=>{});await c.load();c.patch({avatarColor:'#be123c'});await c.flush();
 assert.equal(c.view().status,'error');assert.equal(db.writes,1);await c.flush();assert.equal(c.view().status,'saved');assert.equal(db.writes,1);c.close();
});
test('editing after an uncertain save reads authoritative state before another write',async()=>{
 const db=memory();let lose=true;
 const api={...db.api,async save(...args){const result=await db.api.save(...args);if(lose){lose=false;throw Error('lost ack');}return result;}};
 const c=new AccountPreferencesController('owner',api,()=>true,()=>{});await c.load();c.patch({avatarColor:'#be123c'});await c.flush();
 c.patch({avatarFont:'mono'});await c.flush();assert.equal(c.view().status,'saved');assert.equal(db.rows.get('owner').avatarColor,'#be123c');assert.equal(db.rows.get('owner').avatarFont,'mono');assert.equal(db.rows.get('owner').revision,2);assert.equal(db.reads,2);c.close();
});
test('late account A load cannot hydrate account B or emit after the controller closes',async()=>{
 let resolve;const events=[];let owner='a';
 const c=new AccountPreferencesController('a',{load:()=>new Promise(r=>resolve=r),save:async()=>{throw Error('must not save');}},()=>owner==='a',v=>events.push(v));
 const pending=c.load();owner='b';c.close();const count=events.length;resolve({...fresh(),avatarColor:'#2563eb'});await pending;assert.equal(events.length,count);assert.equal(c.view().loaded,false);
});
test('edits before an authoritative load cannot write defaults over account data',async()=>{
 const db=memory();const c=new AccountPreferencesController('owner',db.api,()=>true,()=>{});c.patch({avatarColor:'#2563eb'});assert.equal(c.view().status,'error');assert.equal(db.writes,0);c.close();
});
test('changes made during a save remain pending until their own acknowledgment',async()=>{
 const db=memory();let release;let first=true;
 const api={...db.api,async save(...args){if(first){first=false;await new Promise(r=>release=r);}return db.api.save(...args);}};
 const c=new AccountPreferencesController('owner',api,()=>true,()=>{});await c.load();c.patch({musicVolume:0.1});const writing=c.flush();c.patch({musicVolume:0.9});release();await writing;
 assert.equal(db.rows.get('owner').musicVolume,0.9);assert.equal(db.rows.get('owner').revision,2);assert.equal(c.view().status,'saved');c.close();
});
test('failed loads do not become a saved empty account',async()=>{
 const c=new AccountPreferencesController('owner',{load:async()=>{throw Error('unavailable');},save:async()=>{throw Error('must not write');}},()=>true,()=>{});
 await c.load();assert.equal(c.view().loaded,false);assert.equal(c.view().status,'error');assert.match(c.view().error,/not replaced/);c.close();
});
