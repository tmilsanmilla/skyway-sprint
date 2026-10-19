"use client";
import {useCallback,useEffect,useRef,useState} from "react";
import {Obstacle} from "./obstacle-sprite";
import {MasteryTrialOverlay} from "./mastery-trial";
import {createMasteryTrial,reduceMasteryTrial,guardTrialBlueCount,trialSpecialChance,trialPickupAllowed,trialHazardAllowed,salveWaveHeal,type MasteryKey,type MasteryTrialEvent,type MasteryQuestEvent} from "./mastery-rules";
import {audioEngine} from "./audio-engine";
import "./mastery-trial.css";

type Piece={id:number;lane:number;y:number;kind:"barrel"|"log"|"rock"|"spikes"|"snowflake"|"gem";special:boolean;resolved?:boolean};
const initialTrialState=(character:MasteryKey)=>({trial:reduceMasteryTrial(createMasteryTrial(character),{type:"accept"}).state,lane:2,hp:character==="tank_guard"?4:3,pieces:[] as Piece[],spawn:0,id:0,moves:0,shield:0,shieldSource:"" as "dash"|"stride-third"|"",dashReady:0,pressed:-100,clock:0,frameCarry:0,wave:1,freeze:0,pendingLane:null as number|null,moveAt:0,salveUses:0,bloomWave:0,remedyWave:0,blue:0,finished:false});
/** Form editing keeps keyboard shortcuts; focusing a game button must not disable movement. */
export const isTrialTextInput = (target: EventTarget | null) => target instanceof HTMLElement && !!target.closest("input,textarea,select,[contenteditable=true]");
/** Isolated non-rewarding runner. Uses the same lane, obstacle and shield
 * language as Endless; the server owns quest completion and the trophy grant. */
export function MasteryTrialGame({character,onEvent,onFinish,onExit,serverFailed=false}:{character:MasteryKey;onEvent:(event:MasteryQuestEvent)=>void;onFinish:()=>Promise<boolean>;onExit:()=>void;serverFailed?:boolean}){
 const [initial]=useState(()=>initialTrialState(character));
 const ref=useRef(initial);
 const [view,setView]=useState(()=>({...initial}));
 const [status,setStatus]=useState("");
 useEffect(()=>{if(serverFailed){ref.current.trial={...ref.current.trial,phase:"failed",failure:"The trial failed its server check. Try again."};}},[serverFailed]);
 const emit=useCallback((event:MasteryTrialEvent)=>{
  const s=ref.current,r=reduceMasteryTrial(s.trial,event);s.trial=r.state;
  s.hp=Math.max(r.healthFloor??0,s.hp-r.damage);
  if(event.type==="special-obstacle")onEvent({type:"trial-special",action:event.action});
  if(event.type==="gem")onEvent({type:"trial-gem",collected:event.collected});
  if(event.type==="vault")onEvent({type:"trial-vault",timed:event.timed,vaulted:event.vaulted});
  if(event.type==="wave-end")onEvent({type:"trial-wave",wave:event.wave});
  if(event.type==="died")onEvent({type:"trial-died"});
  if(event.type==="snowflake")onEvent({type:"snowflake"});
  if(s.hp<=0&&s.trial.phase==="playing"){s.trial=reduceMasteryTrial(s.trial,{type:"died"}).state;onEvent({type:"trial-died"});}
  if(r.spawnSnowflake){const free=Array.from({length:5},(_,i)=>i).filter(l=>!s.pieces.some(p=>p.lane===l&&p.y<105));if(free.length){s.pieces.push({id:++s.id,lane:free[Math.floor(Math.random()*free.length)],y:-4,kind:"snowflake",special:false});s.trial=reduceMasteryTrial(s.trial,{type:"snowflake-spawn"}).state;}}
  if(r.unlock&&!s.finished){s.finished=true;setStatus("Saving mastery…");void onFinish().then(ok=>setStatus(ok?"Mastery unlocked!":"Mastery could not be confirmed. Keep this screen open and retry."));}
 },[onEvent,onFinish]);
 const act=useCallback(()=>{
  const s=ref.current;if(s.trial.phase!=="playing")return;
  const t=s.clock;
  if(character==="runner_dash"&&t>=s.dashReady){s.shield=t+.35;s.shieldSource="dash";s.dashReady=t+5;void audioEngine.playSfx("shield");}
  else if(character==="runner_vault")s.pressed=t;
  else if(character==="trickster_smoke")emit({type:"dissipate"});
 },[character,emit]);
 const finishMove=useCallback((destination:number)=>{
  const s=ref.current;if(s.trial.phase!=="playing")return;
  s.pendingLane=null;s.lane=destination;s.moves++;
  if(character==="runner_stride"&&s.moves%3===0){s.shield=s.clock+.25;s.shieldSource="stride-third";}
  void audioEngine.playSfx("move");
 },[character]);
 const move=useCallback((d:number)=>{
  const s=ref.current;if(s.trial.phase!=="playing"||s.pendingLane!==null)return;
  const destination=Math.max(0,Math.min(4,s.lane+d));if(destination===s.lane)return;
  if(s.freeze>s.clock){s.pendingLane=destination;s.moveAt=s.clock+.25;}else finishMove(destination);
 },[finishMove]);
 useEffect(()=>{
  const key=(e:KeyboardEvent)=>{if(isTrialTextInput(e.target))return;if(["ArrowLeft","a","A"].includes(e.key)){e.preventDefault();if(!e.repeat)move(-1);}else if(["ArrowRight","d","D"].includes(e.key)){e.preventDefault();if(!e.repeat)move(1);}else if(e.key.toLowerCase()==="e"){e.preventDefault();if(!e.repeat)act();}};
  window.addEventListener("keydown",key);return()=>{window.removeEventListener("keydown",key);};
 },[act,move]);
 useEffect(()=>{
  let frame=0,last=0,stopped=false;
  const tick=(now:number)=>{
   if(stopped)return;
   const s=ref.current,dt=last?Math.min(.05,(now-last)/1000):0;last=now;
   if(document.hidden){frame=requestAnimationFrame(tick);return;}
   if(s.trial.phase==="playing"){
    s.clock+=dt;
    if(s.pendingLane!==null&&s.clock+1e-9>=s.moveAt)finishMove(s.pendingLane);
   }
   if(s.trial.phase==="playing"||s.trial.phase==="finale"){
    s.frameCarry+=dt;
    if(s.frameCarry>=.1){const seconds=s.frameCarry;s.frameCarry=0;onEvent({type:"frame",seconds,hp:s.hp});emit({type:"frame",seconds,hp:s.hp});}
   }
   if(s.trial.phase==="playing"){
    const waveLength=character==="medic_salve"?60:30;
    const wave=1+Math.floor(s.trial.seconds/waveLength);
    if(wave>s.wave){
     // Every designated blue must have actually arrived before advancing.
     if(character==="tank_guard"&&s.pieces.some(p=>p.special&&!p.resolved))emit({type:"special-obstacle",action:"miss"});
     if(character==="tank_guard"&&s.blue!==guardTrialBlueCount(s.wave))emit({type:"special-obstacle",action:"miss"});
     // Salve's battlefield death roll belongs to the server; the local reducer
     // advances optimistically and follows serverFailed rather than rolling twice.
     emit({type:"wave-end",wave:s.wave,roll:1});s.wave=wave;s.blue=0;
     const heal=character==="medic_salve"?salveWaveHeal(s.hp,s.salveUses,false):{heal:1,used:false};if(heal.used)s.salveUses++;
     s.hp=Math.min(character==="tank_guard"?4:character==="medic_remedy"?3.5:3,s.hp+heal.heal);
    }
    s.spawn+=dt;
    if(s.spawn>=.8){
     s.spawn=0;
     const kinds=character==="runner_vault"?["log","spikes"] as const:["barrel","log","rock","spikes","snowflake"] as const;
     // Prioritize the required snowflake before the 11-second deadline, so a
     // temporarily occupied lane cannot force overlapping emergency spawns.
     const needsBlue=character==="tank_guard"&&s.blue<guardTrialBlueCount(s.wave)&&s.trial.seconds%waveLength<20;
     const kind=needsBlue?(["barrel","log","rock","spikes"] as const)[Math.floor(Math.random()*4)]:character==="medic_remedy"&&s.trial.seconds-s.trial.lastSnowflakeSpawn>=8?"snowflake":character==="medic_bloom"&&s.id%7===0?"gem":kinds[Math.floor(Math.random()*kinds.length)];
     const available=Array.from({length:5},(_,i)=>i).filter(l=>!s.pieces.some(p=>p.lane===l&&p.y<105));
     if(available.length&&(kind!=="gem"||trialPickupAllowed(character,kind))&&trialHazardAllowed(character,kind)){
      // Blue requirements are damaging hazards, never gems or snowflakes.
      const special=kind!=="snowflake"&&kind!=="gem"&&(character==="tank_guard"?needsBlue:Math.random()<trialSpecialChance(character));
      if(special&&character==="tank_guard")s.blue++;
      s.pieces.push({id:++s.id,lane:available[Math.floor(Math.random()*available.length)],y:-5,kind,special});
      if(kind==="snowflake"&&character==="medic_remedy")emit({type:"snowflake-spawn"});
     }
    }
    const speed=22*(1+.25*(s.wave-1));
    s.pieces=s.pieces.filter(p=>{
     p.y+=dt*speed;
     if(!p.resolved&&p.lane===s.lane&&p.y>=83&&p.y<=94){
      p.resolved=true;
      if(p.kind==="gem"){emit({type:"gem",collected:true});if(s.bloomWave!==s.wave){s.hp=Math.min(3,s.hp+.5);s.bloomWave=s.wave;}}
      else if(p.kind==="snowflake"){if(character==="medic_remedy"){emit({type:"snowflake"});if(s.remedyWave!==s.wave){s.hp=Math.min(3.5,s.hp+1);s.remedyWave=s.wave;}}s.freeze=s.clock+3;}
      else if(character==="runner_vault"&&(p.kind==="log"||p.kind==="spikes")){emit({type:"vault",timed:s.clock-s.pressed<=.25+1e-9,vaulted:true});}
      else if(p.special){emit({type:"special-obstacle",action:character==="tank_guard"?"hit":s.shield>s.clock?s.shieldSource||"hit":"hit",baseDamage:p.kind==="rock"?2:p.kind==="barrel"?.5:1,hp:s.hp});}
      else if(s.shield<=s.clock){s.hp=Math.max(0,s.hp-(p.kind==="rock"?2:p.kind==="barrel"?.5:1)*(character==="tank_guard"?.65:1));s.shield=s.clock+.48;s.shieldSource="";void audioEngine.playSfx("hit");}
      if(s.hp<=0)emit({type:"died"});return false;
     }
     if(p.y>108){if(!p.resolved){if(p.kind==="gem")emit({type:"gem",collected:false});if(p.special)emit({type:"special-obstacle",action:"miss"});if(character==="runner_vault"&&(p.kind==="log"||p.kind==="spikes"))emit({type:"vault",timed:false,vaulted:false});}return false;}return true;
    });
   }
   setView({...s,pieces:[...s.pieces]});frame=requestAnimationFrame(tick);
  };
  frame=requestAnimationFrame(tick);return()=>{stopped=true;cancelAnimationFrame(frame);};
 },[character,emit,finishMove,onEvent]);
 const playing=view.trial.phase==="playing";
 const abilityLabel=character==="runner_dash"?"DASH":character==="runner_vault"?"TIME VAULT":character==="trickster_smoke"?"DISSIPATE":null;
 return <section className="mastery-trial-game" aria-label="Mastery trial">
  <header><strong>{view.hp.toFixed(2).replace(/0+$/,"").replace(/\.$/,"")} HP</strong><button type="button" onClick={onExit}>Return to inventory</button></header>
  <div className={`mastery-trial-track mastery-track-${character} mastery-trial-phase-${view.trial.phase}`} onPointerDown={e=>{
   if(e.pointerType!=="touch")return;
   const box=e.currentTarget.getBoundingClientRect(),target=Math.max(0,Math.min(4,Math.floor((e.clientX-box.left)/box.width*5)));
   move(Math.sign(target-ref.current.lane));
  }}>
   {[0,1,2,3,4].map(l=><div key={l} className="mastery-trial-lane" style={{left:`${l*20}%`}}/>)}
   {view.pieces.map(p=><div key={p.id} className={`mastery-trial-piece${p.special?character==="runner_dash"?" mastery-green":character==="runner_stride"?" mastery-red":" mastery-blue":""}`} style={{left:`${p.lane*20+10}%`,top:`${p.y}%`}}>{p.kind==="gem"?<span>◆</span>:<Obstacle kind={p.kind}/>}</div>)}
   <div className={`runner character-${character}${view.shield>view.clock?" invincible":""}`} style={{left:`${view.lane*20+10}%`,top:"86%"}}><div className="head"/><div className="body"/><div className="a1"/><div className="a2"/><div className="g1"/><div className="g2"/></div>
   {character==="runner_vault"?<span className={`mastery-vault-pole${view.trial.poleDamaged?" broken":""}`} style={{left:`${view.lane*20+12}%`}} aria-label={view.trial.poleDamaged?"Compromised vaulting pole":"Vaulting pole"}/>:null}
   <MasteryTrialOverlay state={view.trial}/>
  </div>
  <div className="mastery-trial-controls"><button type="button" disabled={!playing} onClick={()=>move(-1)} aria-label="Move left">◀</button>{abilityLabel?<button type="button" disabled={!playing||character==="runner_dash"&&view.clock<view.dashReady||character==="trickster_smoke"&&(view.trial.dissipators===0||view.trial.seconds<view.trial.smokeClearUntil)} onClick={act}>E · {abilityLabel}{character==="runner_dash"&&view.clock<view.dashReady?` · ${(view.dashReady-view.clock).toFixed(1)}s`:""}</button>:null}<button type="button" disabled={!playing} onClick={()=>move(1)} aria-label="Move right">▶</button></div>
  {status&&<p role="status">{status}</p>}
  {view.trial.phase==="complete"&&status.startsWith("Mastery could")&&<button type="button" onClick={()=>void onFinish().then(ok=>setStatus(ok?"Mastery unlocked!":status))}>Retry save</button>}
  <p>A / D or arrows to move{abilityLabel?` · E to ${abilityLabel.toLowerCase()}`:""}. No score, currency or XP is awarded.</p>
 </section>;
}
