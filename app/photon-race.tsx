"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import {supabase} from "./skyway-client";
import {PhotonAvatar} from "./photon-avatar";
import {Obstacle} from "./obstacle-sprite";
import {PHOTON_RACE,photonRaceEligibility,photonRaceVisible,parsePhotonRace,type PhotonRaceSnapshot} from "./photon-race-rules";
import "./photon-race.css";
type Props={userId:string;level:number;owned:readonly string[];photons:number;stardust:number;onStardust?:(amount:number)=>void;onBalance:(balance:number)=>void;onExit:()=>void;onUnlock:()=>void};
export function PhotonRace({userId,level,owned,photons,stardust,onStardust,onBalance,onExit,onUnlock}:Props){
  const [race,setRace]=useState<PhotonRaceSnapshot|null>(null),[unlocked,setUnlocked]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(""),[clock,setClock]=useState(0),[online,setOnline]=useState(true);
  const epoch=useRef(0),flight=useRef(false),readFlight=useRef(false),moveFlight=useRef(false),pendingMove=useRef<-1|0|1>(0),serverVersion=useRef(0),mounted=useRef(true),current=useRef<PhotonRaceSnapshot|null>(null),offset=useRef(0),owner=useRef(userId),balanceCallback=useRef(onBalance);
  useEffect(()=>{balanceCallback.current=onBalance;},[onBalance]);
  const apply=useCallback((raw:unknown)=>{const value=parsePhotonRace(raw);const version=Date.parse(value.serverNow);if(version<serverVersion.current)return;serverVersion.current=version;current.current=value;offset.current=Date.parse(value.serverNow)-Date.now();setRace(value);setUnlocked(value.unlocked);balanceCallback.current(value.photons);setOnline(true);setError("");},[]);
  useEffect(()=>{mounted.current=true;owner.current=userId;serverVersion.current=0;const generation=++epoch.current;let stopped=false;
    void supabase.rpc("get_photon_race_profile").then(({data,error})=>{if(stopped||generation!==epoch.current)return;if(error){setError(error.message);return;}setUnlocked(data?.unlocked===true);if(data?.race)apply(data.race);});
    return()=>{stopped=true;mounted.current=false;epoch.current++;current.current=null;};
  },[userId,apply]);
  const action=useCallback(async(name:string,args:Record<string,unknown>={})=>{
    if(flight.current)return;flight.current=true;const generation=epoch.current,uid=owner.current;setBusy(true);
    try{const {data,error}=await supabase.rpc(name,args);if(!mounted.current||epoch.current!==generation||owner.current!==uid)return;if(error)throw Error(error.message);if(name==="unlock_photon_race"){const balance=Number(data?.photons);if(!Number.isSafeInteger(balance)||balance<0)throw Error("Unlock result could not be confirmed. Refresh the race profile.");setUnlocked(true);onUnlock();balanceCallback.current(balance);if(typeof data.stardust==="number")onStardust?.(data.stardust);}else apply(data);}
    catch(error){if(mounted.current&&epoch.current===generation){setError(error instanceof Error?error.message:"Race connection interrupted");setOnline(false);}}
    finally{flight.current=false;if(mounted.current&&epoch.current===generation)setBusy(false);}
  },[apply,onUnlock,onStardust]);
  useEffect(()=>{
    if(!race||!["waiting","playing"].includes(race.status))return;
    const id=race.id,generation=epoch.current;let stopped=false;
    const refresh=async()=>{if(stopped||readFlight.current)return;readFlight.current=true;try{const {data,error}=await supabase.rpc("get_photon_race_state",{p_match_id:id});if(stopped||generation!==epoch.current||current.current?.id!==id)return;if(error)throw Error(error.message);apply(data);}catch(error){if(!stopped&&generation===epoch.current){setOnline(false);setError(error instanceof Error?error.message:"Race connection interrupted");}}finally{readFlight.current=false;}};
    const timer=window.setInterval(()=>void refresh(),250);return()=>{stopped=true;window.clearInterval(timer);};
  },[race?.id,race?.status,apply]);
  useEffect(()=>{if(race?.status!=="playing")return;let frame=0;const tick=()=>{setClock(Date.now()+offset.current);frame=requestAnimationFrame(tick);};frame=requestAnimationFrame(tick);return()=>cancelAnimationFrame(frame);},[race?.status]);
  const move=useCallback((direction:-1|1)=>{
    const state=current.current;if(!state||state.status!=="playing"||!online||Date.now()+offset.current<Date.parse(state.startsAt||""))return;
    pendingMove.current=direction;if(moveFlight.current)return;moveFlight.current=true;
    const generation=epoch.current,uid=owner.current,match=state.id;
    const send=async()=>{try{while(pendingMove.current&&mounted.current&&generation===epoch.current&&owner.current===uid&&current.current?.id===match&&current.current.status==="playing"){
      const direction=pendingMove.current;pendingMove.current=0;
      const {data,error}=await supabase.rpc("step_photon_race",{p_match_id:match,p_command_id:crypto.randomUUID(),p_direction:direction});
      if(!mounted.current||generation!==epoch.current||owner.current!==uid||current.current?.id!==match)return;
      if(error)throw Error(error.message);apply(data);
    }}catch(error){pendingMove.current=0;if(mounted.current&&generation===epoch.current){setOnline(false);setError(error instanceof Error?error.message:"Move could not be confirmed. Reconnecting without replaying it.");}}
    finally{moveFlight.current=false;}};void send();
  },[apply,online]);
  useEffect(()=>{const key=(event:KeyboardEvent)=>{if(event.repeat||event.target instanceof HTMLInputElement)return;const direction=["a","arrowleft"].includes(event.key.toLowerCase())?-1:["d","arrowright"].includes(event.key.toLowerCase())?1:0;if(direction){event.preventDefault();move(direction);}};window.addEventListener("keydown",key);return()=>window.removeEventListener("keydown",key);},[move]);
  const eligibility=photonRaceEligibility(level,owned,photons,stardust),ready=eligibility.level&&eligibility.characters&&eligibility.photons&&eligibility.stardust;
  const elapsed=race?.startsAt?Math.max(0,(clock-Date.parse(race.startsAt))/1000):0;
  const stopped=race?.status==="finished"||race?.status==="cancelled";
  const frozenTime=race?.finishedAt&&race.startsAt?(Date.parse(race.finishedAt)-Date.parse(race.startsAt))/1000:elapsed;
  const items=race?.startsAt?photonRaceVisible(race.id,race.slot,stopped?frozenTime:elapsed):[];
  return <section className="photon-race" aria-label="Photon Race"><header><h2>PHOTON RACE · 1V1</h2><p>First to 0 HP wins. Hazards cost 1 HP; needles heal 1. No weapons, abilities or ELO. Speed stays at 3×.</p></header>
    {error?<p className="race-error" role="alert">{error}</p>:null}
    {!race?<><p>Level {Math.min(50,level)}/50 · Photon characters {eligibility.owned}/{eligibility.total}</p>{!unlocked?<button disabled={busy||!ready} onClick={()=>void action("unlock_photon_race")}>UNLOCK · 1,000 PHOTONS + 1,000 STARDUST</button>:<button disabled={busy} onClick={()=>void action("join_photon_race")}>FIND RACE</button>}<button disabled={busy} onClick={onExit}>BACK</button></>:null}
    {race?.status==="waiting"?<><p role="status">Waiting for another racer…</p><button disabled={busy} onClick={()=>void action("leave_photon_race",{p_match_id:race.id})}>CANCEL SEARCH</button></>:null}
    {race&&race.status!=="waiting"?<><div className="race-health"><strong>YOU · {race.selfHp} HP</strong><strong>RIVAL · {race.rivalHp} HP</strong></div><div className="race-track">{items.map(item=><div key={item.id} className={`item ${item.kind==="spike"?"spikes":item.kind}`} style={{left:`${(item.lane+.5)*25}%`,top:`${item.y*100}%`}}><Obstacle kind={item.kind}/></div>)}<PhotonAvatar character="photon_magician" lane={race.lane}/>{race.startsAt&&clock<Date.parse(race.startsAt)?<div className="race-countdown">{Math.ceil((Date.parse(race.startsAt)-clock)/1000)}</div>:null}{!online?<div className="race-connection" role="status">RECONNECTING · YOUR RACE CONTINUES ON THE SERVER</div>:null}{stopped?<div className="race-result"><h3>{race.status==="cancelled"?"RACE CANCELLED":race.winner===null?"DRAW":race.winner?"VICTORY":"DEFEAT"}</h3><p>You: {race.selfHp} HP · Rival: {race.rivalHp} HP</p><button onClick={()=>{current.current=null;setRace(null);}}>CONTINUE</button></div>:null}</div>{!stopped?<><div className="race-controls"><button disabled={!online} onClick={()=>move(-1)} aria-label="Move left">←</button><span>{PHOTON_RACE.hp} starting HP · A / D</span><button disabled={!online} onClick={()=>move(1)} aria-label="Move right">→</button></div><button disabled={busy} onClick={()=>void action("leave_photon_race",{p_match_id:race.id})}>FORFEIT</button></>:null}</>:null}
  </section>;
}
