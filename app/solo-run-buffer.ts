/** Solo progress is staged locally and committed by one owned, idempotent
 * settlement after play. Local recovery data never authorizes a reward. */
type ObjectValue = Record<string, unknown>;
export type SoloRpcResult = {data: unknown;error: {message:string;code?:string}|null};
type Rpc = (name:string,args?:ObjectValue,options?:ObjectValue)=>PromiseLike<SoloRpcResult>;
type Checkpoint = ObjectValue & {elapsed?:number;key?:string;originalKey?:string};
type Action = {kind:"gem"|"reset";id?:string;at:number;wave:number;checkpoint?:Checkpoint};
type Draft = {owner:string;runId:string;mode:string;character:string;checkpoints:Checkpoint[];latest:Checkpoint|null;actions:Action[];events:ObjectValue[];trial:string|null;replay:boolean;gems:number;streak:number;score:number;ending:boolean;packet:ObjectValue|null;result:unknown|null};
export type SoloView = {runId:string|null;score:number;wave:number;gems:number;checkpoint:Checkpoint|null};
const object=(value:unknown):ObjectValue=>value&&typeof value==="object"&&!Array.isArray(value)?value as ObjectValue:{};
const number=(value:unknown,fallback=0)=>typeof value==="number"&&Number.isFinite(value)?value:fallback;
const copy=<T,>(value:T):T=>JSON.parse(JSON.stringify(value));
const ok=(data:unknown):SoloRpcResult=>({data,error:null});
const failure=(message:string):SoloRpcResult=>({data:null,error:{message}});
const cleanCheckpoint=(value:unknown):Checkpoint|null=>{
 const c=object(value);if(typeof c.originalKey!=="string"||typeof c.key!=="string"||!Number.isFinite(c.elapsed))return null;
 return copy({version:1,originalKey:c.originalKey,key:c.key,elapsed:number(c.elapsed),counters:object(c.counters),maxHp:c.maxHp});
};
export function createSoloRunBuffer({rpc,owner,view,storage}:{rpc:Rpc;owner:()=>string|null;view:()=>SoloView|null;storage?:()=>Storage|null}){
 const drafts=new Map<string,Draft>(),flights=new Map<string,Promise<SoloRpcResult>>();let currentOwner:string|null=null,profile:ObjectValue={},startNonce:string|null=null;let startFlight:Promise<SoloRpcResult>|null=null;
 const key=(id:string)=>`skyway-solo-results-v1:${id}`;
 const persist=()=>{if(!currentOwner)return;try{storage?.()?.setItem(key(currentOwner),JSON.stringify([...drafts.values()].filter(d=>d.owner===currentOwner&&d.ending&&!d.result)));}catch{/* Retain memory and the original receipt until a confirmed save. */}};
 const reconcileOwner=()=>{
  const next=owner();if(next===currentOwner)return;drafts.clear();flights.clear();profile={};startNonce=null;startFlight=null;currentOwner=next;
  if(!next)return;try{startNonce=storage?.()?.getItem(key(next)+":start")||null;const saved=JSON.parse(storage?.()?.getItem(key(next))||"[]");if(Array.isArray(saved))for(const d of saved)if(d&&d.owner===next&&typeof d.runId==="string"&&d.ending&&d.packet&&Array.isArray(d.events)&&Array.isArray(d.actions))drafts.set(d.runId,d);}catch{/* Invalid cache is not account authority. */}
 };
 const live=(d:Draft)=>owner()===d.owner&&drafts.get(d.runId)===d;
 const capture=(d:Draft,checkpoint?:unknown)=>{
  const next=cleanCheckpoint(checkpoint??(view()?.runId===d.runId?view()?.checkpoint:null));if(!next)return;
  if(d.latest&&d.latest.key!==next.key)d.checkpoints.push(d.latest);
  d.latest=next;
 };
 const packet=(d:Draft):ObjectValue=>{
  if(d.packet)return d.packet;
  capture(d);const v=view();if(v?.runId===d.runId)d.score=Math.max(0,Math.floor(v.score));
  const elapsed=d.trial?number(d.events.at(-1)?.at):number(d.latest?.elapsed,number(d.events.at(-1)?.at));
  d.packet=copy({version:1,mode:d.mode,character:d.character,elapsed,score:d.score,wave:d.trial?1:v?.runId===d.runId?v.wave:1,checkpoints:d.trial?[]:[...d.checkpoints,...(d.latest?[d.latest]:[])],actions:d.actions,events:d.events,trial:d.trial,finishTrial:false});
  return d.packet;
 };
 const submit=(d:Draft,finishTrial=false):Promise<SoloRpcResult>=>{
  if(!live(d))return Promise.resolve(failure("The signed-in account changed."));
  if(d.result)return Promise.resolve(ok(d.result));
  const flight=flights.get(d.runId);if(flight)return flight;
  d.ending=true;const body=packet(d);if(finishTrial)body.finishTrial=true;persist();
  const task=Promise.resolve(rpc("settle_solo_run_v1",{p_run_id:d.runId,p_payload:body})).then(result=>{
   if(!live(d))return failure("The signed-in account changed.");
   if(!result.error){d.result=result.data;const data=object(result.data);if(data.mastery)profile=object(data.mastery);persist();}
   return result;
  }).catch(()=>failure("Run save is pending. Retry after the connection returns.")).finally(()=>{if(flights.get(d.runId)===task)flights.delete(d.runId);});
  flights.set(d.runId,task);return task;
 };
 const raw=async(name:string,args?:ObjectValue,options?:ObjectValue)=>{
  const actor=owner(),r=await rpc(name,args,options);
  if(actor&&owner()===actor&&name==="get_mastery_profile"&&!r.error)profile=object(r.data);
  return r;
 };
 return {
  async rpc(name:string,args:ObjectValue={},options?:ObjectValue):Promise<SoloRpcResult>{
   reconcileOwner();
   if(name==="start_progression_run"){
    if(startFlight)return startFlight;
    const actor=owner();if(!actor)return raw(name,args,options);
    startNonce??=crypto.randomUUID();const nonce=startNonce;
    try{storage?.()?.setItem(key(actor)+":start",nonce);}catch{/* Original request remains in memory. */}
    const request=raw("start_solo_run_v1",{p_nonce:nonce},options).then(r=>{
     if(owner()===actor&&!r.error&&typeof r.data==="string"){
      if(!drafts.has(r.data))drafts.set(r.data,{owner:actor,runId:r.data,mode:"normal",character:"runner_ace",checkpoints:[],latest:null,actions:[],events:[],trial:null,replay:false,gems:Math.max(0,number(view()?.gems)),streak:0,score:0,ending:false,packet:null,result:null});
      startNonce=null;try{storage?.()?.removeItem(key(actor)+":start");}catch{/* Confirmed original receipt is already in memory. */}
     }return r;
    }).catch(()=>failure("The run could not connect. Retry to recover the same start receipt.")).finally(()=>{if(startFlight===request)startFlight=null;});
    startFlight=request;return request;
   }
   const id=typeof args.p_run_id==="string"?args.p_run_id:typeof args.p_context_id==="string"?args.p_context_id:typeof args.p_session_id==="string"?args.p_session_id:null;
   const d=id?drafts.get(id):undefined;if(!d||!live(d))return raw(name,args,options);
   if(name==="bind_six_class_run_v1"){d.mode=String(args.p_mode);d.character=String(args.p_character_key);return ok({bound:true,buffered:true,run_id:d.runId});}
   if(name==="begin_mastery_session"&&args.p_context_type==="endless"){
    d.character=String(args.p_character_key);d.trial=typeof args.p_trial_key==="string"?args.p_trial_key:null;d.replay=!!object(object(object(profile.account).quests??profile.quests)[d.character]).mastered;
    return ok({session_id:d.runId,trial:!!d.trial,trial_replay:!!d.trial&&d.replay,last_seq:0,last_at:0,buffered:true});
   }
   if(name==="credit_mastery_events"){
    if(!Array.isArray(args.p_batch))return failure("Invalid local run events.");
    for(const value of args.p_batch){const event=object(value),seq=number(event.seq,-1);if(!Number.isSafeInteger(seq)||seq<1)return failure("Invalid local run sequence.");
     if(seq<=d.events.length){if(JSON.stringify(d.events[seq-1])!==JSON.stringify(event))return failure("Run receipt changed during retry.");continue;}
     if(seq!==d.events.length+1||d.events.length>=120000)return failure("Run receipt sequence is incomplete.");d.events.push(copy(event));
    }
    if(d.events.at(-1)?.type==="run-end"){d.ending=true;packet(d);persist();}
    return ok({buffered:true});
   }
   if(name==="sync_progression_run"){capture(d);return ok({active_seconds:Math.floor(number(d.latest?.elapsed)),verified_wave:number(args.p_wave,1),active:args.p_active,buffered:true});}
   if(name==="record_six_class_run_v1"){capture(d,args.p_checkpoint);return ok({buffered:true,nonce:args.p_nonce});}
   if(name==="reset_endless_gem_streak"){capture(d);d.streak=0;d.actions.push({kind:"reset",at:number(d.latest?.elapsed),wave:number(view()?.wave,1)});return ok({streak:0,buffered:true});}
   if(name==="claim_player_gem"){
    capture(d);const pickup=String(args.p_pickup_id),previous=d.actions.find(a=>a.kind==="gem"&&a.id===pickup);if(previous)return ok({is_new:false,total_gems:d.gems,buffered:true});
    d.streak++;let amount=d.streak<=5?d.streak:d.streak<=10?5:d.streak-5;const character=String(d.latest?.key||d.character);if(["misc_prospector","trickster_burglar"].includes(character))amount=2*d.streak-1;
    d.gems+=amount;d.actions.push({kind:"gem",id:pickup,at:number(d.latest?.elapsed),wave:number(view()?.wave,1),checkpoint:d.latest?copy(d.latest):undefined});
    return ok({is_new:true,total_gems:d.gems,gems_awarded:amount,streak:d.streak,buffered:true});
   }
   if(name==="award_completed_run_v2"||name==="award_completed_run"){
    if(args.p_scope!=="endless")return raw(name,args,options);d.score=Math.max(0,Math.floor(number(args.p_score)));if(!d.packet)packet(d);return submit(d);
   }
   if(name==="finish_six_class_run_v1")return d.result?ok(d.result):submit(d);
   if(name==="finish_mastery_trial")return submit(d,true);
   if(name==="settle_solo_trial_exit_v1")return submit(d);
   return raw(name,args,options);
  },
  async retryPending(){reconcileOwner();const results:SoloRpcResult[]=[];for(const d of drafts.values())if(d.ending&&!d.result){const r=await submit(d);results.push(r);if(r.error)break;}return results;},
  capture(){reconcileOwner();const v=view();if(v?.runId){const d=drafts.get(v.runId);if(d&&!d.ending)capture(d);}},
  pending(){reconcileOwner();return [...drafts.values()].filter(d=>d.ending&&!d.result).length;},
 };
}
