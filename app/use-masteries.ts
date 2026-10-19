"use client";
import {useCallback, useEffect, useLayoutEffect, useRef, useState} from "react";
import {supabase} from "./skyway-client";
import {emptyMasteryAccount, type MasteryAccountState, type MasteryKey, type MasteryQuestEvent} from "./mastery-rules";

type ReceiptEvent = MasteryQuestEvent & {seq:number;at:number};
type SessionQueue = {uid:string;epoch:number;id:string;events:ReceiptEvent[];sequence:number;seconds:number;flight:Promise<boolean>|null;ending:boolean;endRecorded:boolean};
type View = {owner:string|null;account:MasteryAccountState;flair:string|null;randomizer:boolean;photons:number;busy:boolean;error:string;trialFailed:boolean};
const emptyView = (owner:string|null=null):View => ({owner,account:emptyMasteryAccount(),flair:null,randomizer:false,photons:0,busy:false,error:"",trialFailed:false});

/** Own-account receipts are the authority. Failed batches retain their original
 * sequence and active timestamps; only one batch may be in flight. */
export function useMasteries(userId: string | null) {
  const [snapshot,setSnapshot]=useState<View>(emptyView);
  const owner=useRef(userId),epoch=useRef(0),beginIntent=useRef(0);
  const session=useRef<SessionQueue|null>(null);
  useLayoutEffect(()=>{
    owner.current=userId;epoch.current++;beginIntent.current++;
    session.current=null;
  },[userId]);
  const current=useCallback((uid:string,generation:number)=>owner.current===uid&&epoch.current===generation,[]);
  const patch=useCallback((uid:string,generation:number,fields:Partial<View>)=>{
    if(!current(uid,generation))return;
    setSnapshot(previous=>current(uid,generation)?{...(previous.owner===uid?previous:emptyView(uid)),...fields,owner:uid}:previous);
  },[current]);
  const apply=useCallback((data:unknown,uid:string,generation:number)=>{
    if(!current(uid,generation)||!data||typeof data!=="object")return;
    const p=data as {account?:MasteryAccountState;active?:MasteryKey|null;quests?:MasteryAccountState['quests'];flair_key?:string|null;randomizer?:boolean;photons?:number;trial_failed?:boolean};
    const fields:Partial<View>={};
    if(p.account)fields.account=p.account;
    else if(p.quests)fields.account={active:p.active??null,quests:p.quests};
    if("flair_key"in p)fields.flair=p.flair_key??null;
    if(typeof p.randomizer==="boolean")fields.randomizer=p.randomizer;
    if(typeof p.photons==="number")fields.photons=p.photons;
    if(p.trial_failed===true)fields.trialFailed=true;
    patch(uid,generation,fields);
  },[current,patch]);
  const refresh=useCallback(async()=>{
    const uid=owner.current,generation=epoch.current;if(!uid)return;
    try{
      const result=await supabase.rpc("get_mastery_profile");
      if(!current(uid,generation))return;
      if(result.error){patch(uid,generation,{error:"Mastery progress could not load. Try again."});return;}
      apply(result.data,uid,generation);patch(uid,generation,{error:""});
    }catch{patch(uid,generation,{error:"Mastery progress could not load. Try again."});}
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
    session.current=null;if(!uid)return null;
    patch(uid,generation,{trialFailed:false});
    try{
      const {data,error:failure}=await supabase.rpc("begin_mastery_session",{p_context_id:contextId,p_context_type:contextType,p_character_key:character,p_trial_key:trial});
      if(!current(uid,generation)||beginIntent.current!==intent)return null;
      if(failure){patch(uid,generation,{error:failure.message});return null;}
      const id=typeof data==="string"?data:data?.session_id;
      if(typeof id!=="string"||!id){patch(uid,generation,{error:"Mastery session could not start. Please retry."});return null;}
      const sequence=data?.last_seq===undefined?0:data.last_seq;
      const seconds=data?.last_at===undefined?0:data.last_at;
      if(typeof sequence!=="number"||!Number.isSafeInteger(sequence)||sequence<0||sequence>99_999_999||typeof seconds!=="number"||!Number.isFinite(seconds)||seconds<0||seconds>21_600){patch(uid,generation,{error:"Mastery session returned invalid progress. Please retry."});return null;}
      // A resumed context retains its committed sequence and active clock.
      // Resetting these would silently replay ignored events until the old
      // counters were reached, or cause a backwards-clock rejection.
      session.current={uid,epoch:generation,id,events:[],sequence,seconds,flight:null,ending:false,endRecorded:false};
      return id;
    }catch{if(beginIntent.current===intent)patch(uid,generation,{error:"Mastery session could not start. Please retry."});return null;}
  },[current,patch]);
  const record=useCallback((event:MasteryQuestEvent)=>{
    const queue=session.current;if(!queue||queue.ending||!current(queue.uid,queue.epoch))return;
    if(event.type==="frame")queue.seconds+=Number.isFinite(event.seconds)?Math.max(0,Math.min(1,event.seconds)):0;
    queue.events.push({...event,seq:++queue.sequence,at:queue.seconds});
  },[current]);
  const flushQueue=useCallback((queue:SessionQueue):Promise<boolean>=>{
    if(queue.flight)return queue.flight;
    const valid=()=>session.current===queue&&current(queue.uid,queue.epoch);
    const task=async()=>{
      while(valid()&&queue.events.length){
        // Splice inside the single-flight task; a failed A cannot be overtaken by B.
        const batch=queue.events.splice(0,100);
        try{
          const {data,error:failure}=await supabase.rpc("credit_mastery_events",{p_session_id:queue.id,p_batch:batch});
          if(!valid())return false;
          if(failure)throw new Error(failure.message);
          apply(data,queue.uid,queue.epoch);
        }catch{
          if(!valid())return false;
          queue.events=[...batch,...queue.events].sort((a,b)=>a.seq-b.seq);
          patch(queue.uid,queue.epoch,{error:"Quest progress could not sync. It will retry."});
          return false;
        }
      }
      return valid();
    };
    const running=task().finally(()=>{if(queue.flight===running)queue.flight=null;});
    queue.flight=running;return running;
  },[apply,current,patch]);
  const flush=useCallback(async()=>{
    const queue=session.current;return queue?flushQueue(queue):true;
  },[flushQueue]);
  const end=useCallback(async()=>{
    beginIntent.current++;
    const queue=session.current;if(!queue)return true;
    queue.ending=true;
    if(!queue.endRecorded){queue.events.push({type:"run-end",seq:++queue.sequence,at:queue.seconds});queue.endRecorded=true;}
    if(!await flushQueue(queue)||session.current!==queue||queue.events.length)return false;
    session.current=null;return true;
  },[flushQueue]);
  const finish=useCallback(async()=>{
    const queue=session.current;if(!queue||!current(queue.uid,queue.epoch))return false;
    queue.ending=true;
    if(!await flushQueue(queue)||session.current!==queue||queue.events.length)return false;
    try{
      const {data,error:failure}=await supabase.rpc("finish_mastery_trial",{p_session_id:queue.id});
      if(session.current!==queue||!current(queue.uid,queue.epoch))return false;
      if(failure){patch(queue.uid,queue.epoch,{error:failure.message});return false;}
      apply(data,queue.uid,queue.epoch);session.current=null;await refresh();return current(queue.uid,queue.epoch);
    }catch{patch(queue.uid,queue.epoch,{error:"Mastery could not be confirmed. Please retry."});return false;}
  },[apply,current,flushQueue,patch,refresh]);
  useEffect(()=>{if(!userId)return;const timer=window.setInterval(()=>void flush(),2000);return()=>window.clearInterval(timer);},[userId,flush]);
  const purchase=useCallback((key:MasteryKey)=>change("purchase_mastery_quest",{p_character_key:key}),[change]);
  const activate=useCallback((key:MasteryKey)=>change("activate_mastery_quest",{p_character_key:key}),[change]);
  const toggle=useCallback((key:MasteryKey,which:"mastery"|"flair",on:boolean)=>change("set_mastery_toggle",{p_character_key:key,p_which:which,p_enabled:on}),[change]);
  const equip=useCallback((key:string)=>change("set_player_flair",{p_flair_key:key}),[change]);
  const randomize=useCallback((on:boolean)=>change("set_endless_randomizer",{p_enabled:on}),[change]);
  // Input-based masking is synchronous and never reads or writes refs in render.
  const view=snapshot.owner===userId?snapshot:emptyView(userId);
  return {...view,refresh,begin,record,flush,end,finish,purchase,activate,toggle,equip,randomize};
}
