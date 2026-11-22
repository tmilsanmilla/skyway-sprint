"use client";
import {useState} from "react";
import {MASTERIES,type MasteryAccountState,type MasteryKey} from "./mastery-rules";
import type {MasterySyncStatus} from "./use-masteries";
import "./quest-hub.css";
const TABS=["COMPLETED","IN PROGRESS","NEED TO BE UNLOCKED","TRIALS"] as const;
type Props={state:MasteryAccountState;owned:readonly string[];photons:number;busy:boolean;syncStatus:MasterySyncStatus;error:string;onPurchase:(key:MasteryKey)=>void;onTrial:(key:MasteryKey)=>void;onToggle:(key:MasteryKey,on:boolean)=>void;onRetry:()=>void};
export function QuestHub({state,owned,photons,busy,syncStatus,error,onPurchase,onTrial,onToggle,onRetry}:Props){
  const [tab,setTab]=useState<(typeof TABS)[number]>("IN PROGRESS");
  const rows=MASTERIES.filter(entry=>{const quest=state.quests[entry.key];return tab==="COMPLETED"?quest?.mastered:tab==="IN PROGRESS"?quest&&!quest.complete:tab==="TRIALS"?quest?.complete:!quest;});
  return <section className="quest-hub" aria-label="Character quests"><h2>QUESTS</h2><p>Equip a character with a purchased quest line to progress automatically. Your account saves progress after play.</p>
    <nav aria-label="Quest sections">{TABS.map(value=><button key={value} aria-pressed={tab===value} onClick={()=>setTab(value)}>{value}</button>)}</nav>
    {error?<p role="alert" className="quest-error">{error}<button disabled={busy} onClick={onRetry}>RETRY SAVE</button></p>:null}
    {syncStatus==="retrying"?<p role="status">Progress is waiting to save. Keep this page open.</p>:syncStatus==="pending"||syncStatus==="syncing"?<p role="status">Saving account progress…</p>:null}
    {!rows.length?<p>No quests in this section yet.</p>:null}
    <div className="quest-cards">{rows.map(entry=>{const quest=state.quests[entry.key],targets=entry.targets[Math.min(2,quest?.quest??0)];return <article key={entry.key}><h3>{entry.name}</h3>
      {tab==="COMPLETED"?<><p>{entry.ability}</p><label><input type="checkbox" checked={quest?.masteryEnabled??false} disabled={busy} onChange={event=>onToggle(entry.key,event.target.checked)}/>Enable mastery, including its original character effects</label></>:null}
      {tab==="IN PROGRESS"&&quest?<><p>Quest {quest.quest+1} of 3</p><p>{entry.quests[quest.quest]}</p>{targets.map((target,i)=><label className="quest-progress" key={i}><span>{Math.min(target,Math.floor((quest.progress[i]||0)*100)/100)} / {target}</span><progress aria-label={`${entry.name} quest ${quest.quest+1} goal ${i+1}`} max={target} value={Math.min(target,quest.progress[i]||0)}/></label>)}</>:null}
      {tab==="NEED TO BE UNLOCKED"?<><ol>{entry.quests.map(text=><li key={text}>{text}</li>)}</ol><button disabled={busy||!owned.includes(entry.key)||photons<entry.price} onClick={()=>onPurchase(entry.key)}>{!owned.includes(entry.key)?"UNLOCK CHARACTER FIRST":`UNLOCK QUESTS · ${entry.price} PHOTONS`}</button></>:null}
      {tab==="TRIALS"?<><p>{entry.disclaimer}</p><button disabled={busy} onClick={()=>onTrial(entry.key)}>{quest?.mastered?"REPLAY TRIAL":"START TRIAL"}</button>{quest?.mastered?<small>Practice replay. No rewards.</small>:null}</>:null}
    </article>;})}</div></section>;
}
