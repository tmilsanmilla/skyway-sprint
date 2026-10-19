"use client";
import {useCallback, useEffect, useLayoutEffect, useRef, useState} from "react";
import {supabase} from "./skyway-client";
import {emptyMasteryAccount, reduceMasteryQuest, type MasteryAccountState, type MasteryKey, type MasteryQuestEvent} from "./mastery-rules";

type ReceiptEvent = MasteryQuestEvent & {seq:number;at:number};
export type MasterySyncStatus = "idle" | "starting" | "saved" | "pending" | "syncing" | "retrying";
type SessionQueue = {uid:string;epoch:number;id:string;character:string;trial:boolean;preview:MasteryAccountState;events:ReceiptEvent[];batch:ReceiptEvent[]|null;failed:boolean;sequence:number;seconds:number;flight:Promise<boolean>|null;ending:boolean;endRecorded:boolean};
type View = {owner:string|null;account:MasteryAccountState;liveAccount:MasteryAccountState;syncStatus:MasterySyncStatus;pendingEvents:number;flair:string|null;randomizer:boolean;photons:number;busy:boolean;error:string;trialFailed:boolean;trialReplay:boolean};
const emptyView = (owner:string|null=null):View => {const account=emptyMasteryAccount();return{owner,account,liveAccount:account,syncStatus:"idle",pendingEvents:0,flair:null,randomizer:false,photons:0,busy:false,error:"",trialFailed:false,trialReplay:false};};
const SYNC_ERROR="Quest progress could not sync. It will retry.";

/** Own-account receipts are the authority. Failed batches retain their original
 * sequence and active timestamps; only one batch may be in flight. */
export function useMasteries(userId: string | null) {
  const [snapshot,setSnapshot]=useState<View>(emptyView);
  const owner=useRef(userId),epoch=useRef(0),beginIntent=useRef(0);
  const profileRevision=useRef(0),refreshIntent=useRef(0);
  const session=useRef<SessionQueue|null>(null);
  const confirmed=useRef<MasteryAccountState>(emptyMasteryAccount());
  useLayoutEffect(()=>{
    owner.current=userId;epoch.current++;beginIntent.current++;
    session.current=null;confirmed.current=emptyMasteryAccount();profileRevision.current++;refreshIntent.current++;
  },[userId]);
  const current=useCallback((uid:string,generation:number)=>owner.current===uid&&epoch.current===generation,[]);
  const patch=useCallback((uid:string,generation:number,fields:Partial<View>)=>{
    if(!current(uid,generation))return;
    setSnapshot(previous=>{
      if(!current(uid,generation))return previous;
      if(previous.owner===uid&&Object.entries(fields).every(([key,value])=>Object.is(previous[key as keyof View],value)))return previous;
      return{...(previous.owner===uid?previous:emptyView(uid)),...fields,owner:uid};
    });
  },[current]);
  const publish=useCallback((queue:SessionQueue)=>{
    if(session.current!==queue||!current(queue.uid,queue.epoch))return;
    const pendingEvents=queue.events.length+(queue.batch?.length??0);
    patch(queue.uid,queue.epoch,{liveAccount:queue.preview,pendingEvents,syncStatus:queue.failed?"retrying":queue.flight?"syncing":pendingEvents?"pending":"saved"});
  },[current,patch]);
  const apply=useCallback((data:unknown,uid:string,generation:number,acknowledgedBatch=false)=>{
    if(!current(uid,generation)||!data||typeof data!=="object")return;
    const p=data as {account?:MasteryAccountState;active?:MasteryKey|null;quests?:MasteryAccountState['quests'];flair_key?:string|null;randomizer?:boolean;photons?:number;trial_failed?:boolean;trial_replay?:boolean};
    const fields:Partial<View>={};
    if(p.account)fields.account=p.account;
    else if(p.quests)fields.account={active:p.active??null,quests:p.quests};
    if(fields.account){
      profileRevision.current++;
      confirmed.current=fields.account;
      const queue=session.current;
      if(queue&&current(queue.uid,queue.epoch)){
        // A completed batch is already reflected in the server profile. Replay
        // only its still-unsent tail, never the acknowledged events twice.
        // A background profile refresh must not erase a pending local preview.
        if(acknowledgedBatch||(!queue.batch&&!queue.events.length))queue.preview=queue.trial?fields.account:queue.events.reduce((account,event)=>reduceMasteryQuest(account,queue.character,event),fields.account);
        fields.liveAccount=queue.preview;
      }else fields.liveAccount=fields.account;
    }
    if("flair_key"in p)fields.flair=p.flair_key??null;
    if(typeof p.randomizer==="boolean")fields.randomizer=p.randomizer;
    if(typeof p.photons==="number")fields.photons=p.photons;
    if(p.trial_failed===true)fields.trialFailed=true;
    if(typeof p.trial_replay==="boolean")fields.trialReplay=p.trial_replay;
    patch(uid,generation,fields);
  },[current,patch]);
  const refresh=useCallback(async()=>{
    const uid=owner.current,generation=epoch.current;if(!uid)return;
    const revision=profileRevision.current,intent=++refreshIntent.current;
    // Initial/focus reads can arrive after a newer receipt or mutation. Do not
    // let an older read undo an accepted server reset, completion or revoke.
    const fresh=()=>current(uid,generation)&&profileRevision.current===revision&&refreshIntent.current===intent;
    try{
      const result=await supabase.rpc("get_mastery_profile");
      if(!fresh())return;
      if(result.error){patch(uid,generation,{error:"Mastery progress could not load. Try again."});return;}
      apply(result.data,uid,generation);patch(uid,generation,{error:""});
    }catch{if(fresh())patch(uid,generation,{error:"Mastery progress could not load. Try again."});}
  },[apply,current,patch]);
  useEffect(()=>{if(userId)void refresh();},[userId,refresh]);
  const change=useCallback(async(name:string,args:Record<string,unknown>)=>{
    const uid=owner.current,generation=epoch.current;if(!uid)return false;
    patch(uid,generation,{busy:true,error:""});
    try{
      const {data,error:failure}=await supabase.rpc(name,args);
      if(!current(uid,generation))return false;
      if(failure){patch(uid,generation,{error:failure.message});return false;}
      apply(data,uid,generation);await refresh();return current(uid,generation);
    }catch{patch(uid,generation,{error:"Connection interrupted. Please try again."});return false;}
    finally{patch(uid,generation,{busy:false});}
  },[apply,current,patch,refresh]);
  const begin=useCallback(async(contextId:string,contextType:"endless"|"1v1",character:string,trial:MasteryKey|null=null)=>{
    const uid=owner.current,generation=epoch.current,intent=++beginIntent.current;
    const requestedReplay=trial!==null&&confirmed.current.quests[trial]?.mastered===true;
    session.current=null;if(!uid)return null;
    patch(uid,generation,{trialFailed:false,trialReplay:false,syncStatus:"starting",pendingEvents:0});
    try{
      const {data,error:failure}=await supabase.rpc("begin_mastery_session",{p_context_id:contextId,p_context_type:contextType,p_character_key:character,p_trial_key:trial});
      if(!current(uid,generation)||beginIntent.current!==intent)return null;
      if(failure){patch(uid,generation,{error:failure.message,syncStatus:"retrying"});return null;}
      const id=typeof data==="string"?data:data?.session_id;
      if(typeof id!=="string"||!id){patch(uid,generation,{error:"Mastery session could not start. Please retry.",syncStatus:"retrying"});return null;}
      const sequence=data?.last_seq===undefined?0:data.last_seq;
      const seconds=data?.last_at===undefined?0:data.last_at;
      if(typeof sequence!=="number"||!Number.isSafeInteger(sequence)||sequence<0||sequence>99_999_999||typeof seconds!=="number"||!Number.isFinite(seconds)||seconds<0||seconds>21_600){patch(uid,generation,{error:"Mastery session returned invalid progress. Please retry.",syncStatus:"retrying"});return null;}
      if(requestedReplay&&data?.trial_replay!==true){patch(uid,generation,{error:"Trial replay is not ready. Refresh and try again.",syncStatus:"retrying"});return null;}
      // A resumed context retains its committed sequence and active clock.
      // Resetting these would silently replay ignored events until the old
      // counters were reached, or cause a backwards-clock rejection.
      if(data?.profile)apply(data.profile,uid,generation);
      session.current={uid,epoch:generation,id,character,trial:trial!==null,preview:confirmed.current,events:[],batch:null,failed:false,sequence,seconds,flight:null,ending:false,endRecorded:false};
      patch(uid,generation,{trialReplay:trial!==null&&data?.trial_replay===true,error:"",syncStatus:"saved",liveAccount:confirmed.current});
      return id;
    }catch{if(beginIntent.current===intent)patch(uid,generation,{error:"Mastery session could not start. Please retry.",syncStatus:"retrying"});return null;}
  },[apply,current,patch]);
  const record=useCallback((event:MasteryQuestEvent)=>{
    const queue=session.current;if(!queue||queue.ending||!current(queue.uid,queue.epoch))return;
    if(event.type==="frame")queue.seconds+=Number.isFinite(event.seconds)?Math.max(0,Math.min(1,event.seconds)):0;
    queue.events.push({...event,seq:++queue.sequence,at:queue.seconds});
    if(!queue.trial)queue.preview=reduceMasteryQuest(queue.preview,queue.character,event);
  },[current]);
  const flushQueue=useCallback((queue:SessionQueue):Promise<boolean>=>{
    if(queue.flight)return queue.flight;
    const valid=()=>session.current===queue&&current(queue.uid,queue.epoch);
    const task=async()=>{
      while(valid()&&queue.events.length){
        // Splice inside the single-flight task; a failed A cannot be overtaken by B.
        const batch=queue.events.splice(0,100);
        queue.batch=batch;
        try{
          const {data,error:failure}=await supabase.rpc("credit_mastery_events",{p_session_id:queue.id,p_batch:batch});
          if(!valid())return false;
          if(failure)throw new Error(failure.message);
          queue.batch=null;queue.failed=false;
          apply(data,queue.uid,queue.epoch,true);
          setSnapshot(previous=>current(queue.uid,queue.epoch)&&previous.owner===queue.uid&&previous.error===SYNC_ERROR?{...previous,error:""}:previous);
        }catch{
          if(!valid())return false;
          queue.events=[...batch,...queue.events].sort((a,b)=>a.seq-b.seq);
          queue.batch=null;queue.failed=true;
          patch(queue.uid,queue.epoch,{error:SYNC_ERROR});publish(queue);
          return false;
        }
      }
      return valid();
    };
    const running=task().finally(()=>{if(queue.flight===running){queue.flight=null;publish(queue);}});
    queue.flight=running;publish(queue);return running;
  },[apply,current,patch,publish]);
  const flush=useCallback(async()=>{
    const queue=session.current;return queue?flushQueue(queue):true;
  },[flushQueue]);
  const end=useCallback(async()=>{
    beginIntent.current++;
    const queue=session.current;if(!queue)return true;
    queue.ending=true;
    if(!queue.endRecorded){queue.events.push({type:"run-end",seq:++queue.sequence,at:queue.seconds});queue.endRecorded=true;if(!queue.trial)queue.preview=reduceMasteryQuest(queue.preview,queue.character,{type:"run-end"});}
    if(!await flushQueue(queue)||session.current!==queue||queue.events.length)return false;
    session.current=null;patch(queue.uid,queue.epoch,{liveAccount:confirmed.current,pendingEvents:0,syncStatus:"idle"});return true;
  },[flushQueue,patch]);
  const finish=useCallback(async()=>{
    const queue=session.current;if(!queue||!current(queue.uid,queue.epoch))return false;
    queue.ending=true;
    if(!await flushQueue(queue)||session.current!==queue||queue.events.length)return false;
    try{
      const {data,error:failure}=await supabase.rpc("finish_mastery_trial",{p_session_id:queue.id});
      if(session.current!==queue||!current(queue.uid,queue.epoch))return false;
      if(failure){patch(queue.uid,queue.epoch,{error:failure.message});return false;}
      apply(data,queue.uid,queue.epoch);session.current=null;patch(queue.uid,queue.epoch,{liveAccount:confirmed.current,pendingEvents:0,syncStatus:"idle"});await refresh();return current(queue.uid,queue.epoch);
    }catch{patch(queue.uid,queue.epoch,{error:"Mastery could not be confirmed. Please retry."});return false;}
  },[apply,current,flushQueue,patch,refresh]);
  useEffect(()=>{
    if(!userId)return;let ticks=0;
    // The engine may record many events per frame. React sees at most four
    // local preview updates per second; network batches retain the 2s cadence.
    const timer=window.setInterval(()=>{const queue=session.current;if(queue)publish(queue);if(++ticks%8===0)void flush();},250);
    return()=>window.clearInterval(timer);
  },[userId,flush,publish]);
  const purchase=useCallback((key:MasteryKey)=>change("purchase_mastery_quest",{p_character_key:key}),[change]);
  const activate=useCallback((key:MasteryKey)=>change("activate_mastery_quest",{p_character_key:key}),[change]);
  const toggle=useCallback((key:MasteryKey,which:"mastery"|"flair",on:boolean)=>change("set_mastery_toggle",{p_character_key:key,p_which:which,p_enabled:on}),[change]);
  const equip=useCallback((key:string)=>change("set_player_flair",{p_flair_key:key}),[change]);
  const randomize=useCallback((on:boolean)=>change("set_endless_randomizer",{p_enabled:on}),[change]);
  // Input-based masking is synchronous and never reads or writes refs in render.
  const view=snapshot.owner===userId?snapshot:emptyView(userId);
  return {...view,refresh,begin,record,flush,end,finish,purchase,activate,toggle,equip,randomize};
}
