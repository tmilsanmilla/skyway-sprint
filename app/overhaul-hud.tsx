"use client";
import {useEffect,useState}from "react";
import type {VisibleRival}from "./overhaul-network";
import type {OverhaulRuntime} from "./overhaul-runtime";
import {CONIC_NAMES} from "./overhaul-challenges";
import {overhaulCharacter} from "./overhaul-catalog";
import "./overhaul-hud.css";
const ACTIVE_NAMES=new Set(["Zenith","Hyperlink","Sprint","Recruit","Scout","Elixir","Bishop","Mender","Tonic","Sage","Sprout","Balm","Weaver","Jester","Carat","Gasser","Vial","Flicker","Mirage","Handflipper","Hex","Um","Lantern","Warrior","Hammer","Surveyor","Conic","Rogue","Streaker"]);
export function OverhaulHud({runtime:r,paused,onKey,onHook,rival}: {rival?:VisibleRival|null;runtime:OverhaulRuntime;paused:boolean;onKey:(key:string)=>void;onHook:(lane:number)=>void}){
  const m=r.modifiers(),c=r.counters,name=r.name;
  const [expanded,setExpanded]=useState(false);
  useEffect(()=>{if(name!=="Mirage"||!r.online)return;const key=(e:KeyboardEvent)=>{if(e.target instanceof HTMLInputElement||e.target instanceof HTMLTextAreaElement)return;if(e.key==="+"||e.key==="="){setExpanded(true);e.preventDefault();}if(e.key==="-"){setExpanded(false);e.preventDefault();}};window.addEventListener("keydown",key);return()=>window.removeEventListener("keydown",key);},[name,r.online]);
  const timed=(key:string)=>Math.max(0,(r.timers[key]||0)-r.elapsed).toFixed(1);
  return <aside className="overhaul-hud" aria-label={`${name} ability status`}><details><summary><strong>ABILITY</strong><span>{name}</span></summary><p className="overhaul-rates">Score ×{m.score.toFixed(2)} · Speed ×{m.speed.toFixed(2)}</p><p>{overhaulCharacter(r.key)?.description}</p>
    {name==="Tonic"?<><p>{c.ingredients||0} ingredient points · {c.brewingPotion?`Brewing ${c.brewingPotion} HP · ${timed("brewing")}s`:c.potion?`${c.potion} HP potion ready`:"No potion stored"}</p><div>{[1,2,3,4].map((amount,i)=><button key={amount} disabled={paused||!!c.potion||!!c.brewingPotion||(c.ingredients||0)<[12,20,25,30][i]} onClick={()=>onKey(String(amount))}>{amount} · BREW {amount} HP · {[12,20,25,30][i]} IP</button>)}</div></>:null}
    {name==="Sage"?<p>{c.stoneBrewing?`Stone brewing · ${timed("stoneBrewing")}s`:c.stone?"Stone ready · E to drink":(r.cooldowns.stone||0)>r.elapsed?`Stone cooldown · ${((r.cooldowns.stone||0)-r.elapsed).toFixed(1)}s`:"E to brew · herbs are hidden"}</p>:null}
    {name==="Hyperlink"?<><p>{c.links||0} LINKS</p><button disabled={paused||(c.links||0)<15||!r.online} onClick={()=>onKey("2")}>2 · OPPONENT CONVERSION · 15</button><button disabled={paused||(c.links||0)<20} onClick={()=>onKey("3")}>3 · OWN CONVERSION · 20</button></>:null}
    {name==="General"?<p>{["barrel","log","spikes","rock"].map(kind=>`${kind}: ${c["adapt:"+kind]||0}${c["sacrifice:"+kind]?" (sacrificed)":""}`).join(" · ")}</p>:null}
    {name==="Velocity"?<p>{Math.floor(c.velocity||0)}% VELOCITY {c.velocity>=100?"🌈":c.velocity>=50?"· UPBEAT MIX":""}</p>:null}
    {name==="Frontline"?<p>{c.closeDodges||0} POINTS · +{((c.closeDodges||0)*.2).toFixed(1)}% SCORE</p>:null}
    {r.networkPaused?<p role="status">RIVAL CHALLENGE · SHARED CLOCK PAUSED</p>:null}
    {r.duck&&!r.duck.done?<button onClick={()=>onKey(r.duck!.key)}>DUCK · {r.duck.key.toUpperCase()}</button>:null}
    {name==="Rogue"?<p>{c.grazes||0}/12 GRAZES · E at 2 / 5 / 11</p>:null}
    {name==="Prodigy"?<p>PERMANENT SCORE ×{(c.mathScore||1).toFixed(4)}</p>:null}
    {name==="Conic"?<p>{CONIC_NAMES[c.shape]}{c.shape===2?` · FOCUS ${["barrel","log","spikes","rock","car"][c.focusIndex]}`:""}</p>:null}
    {name==="Carat"?<p>{c.carbon||0} CARBON · {timed("pterodactyl")}s PTERODACTYL</p>:null}
    {name==="Hex"?<><p>{c.damnation||0} DAMNATION · {c.souls||0} SOULS {c.god?"· GOD":""}</p><button disabled={paused} onClick={()=>onKey("r")}>R · VOID CHAKRAM</button></>:null}
    {name==="Echo"?<p>{["Dreamer I · reach wave 5","Uplift · heal 5 HP at wave ends","Hope · take 10 damage","Dreamer II · reach wave 15","Understanding · collect 20 physical gems","Idea · collect 25 melons","The Knowing · 0.5 HP to full","THE KNOWING"][c.echoQuest||0]} · {c.shards||0} MIRROR SHARDS</p>:null}
    {name==="Fortune"?<p>GEM OVERRIDE {Math.min(15,Math.round((c.gemStreak||0)/3*10)/10).toFixed(1)}% · MELON OVERRIDE {Math.min(10,c.flawlessStreak||0)}%</p>:null}
    {name==="Spring"?<p>{c.energy||0} ENERGY{r.online?` · ${Math.max(0,20-(c.energy||0)*.1).toFixed(1)}% NAUSEA`:""}</p>:null}
    {name==="Mender"?<p>{c.potions||0} HEAL POTIONS</p>:null}
    {name==="Streaker"?<p>{c.flawlessTotal||0} FLAWLESS WAVES · E bonus {r.online?9:14} × flawless³</p>:null}
    {name==="Relay"&&!c.revived?<p>{c.relayBonus||0}/10 REVIVAL BONUS</p>:null}
    {name==="Eclipse"&&(c.eclipse||r.wave===20)?<p>{r.wave===20?"SOLAR":["","AZURE","AMBER","VERDANT","VIOLET"][c.eclipse]} ECLIPSE · {m.invincible?"INVINCIBLE":"NORMAL"}</p>:null}
    {name==="Wildcard"?<p>{r.cards.length} CARDS LEFT · {r.heldCards.join(" · ")||"No cards drawn"}</p>:null}
    {name==="Beacon"?<p>{c.beaconLit?`BEACON LIT · ${c.beaconWaves||0}/3 WAVES · NO HEALING`:c.beaconRescued?"RESCUED · HEALING RESTORED":"BEACON UNLIT"}</p>:null}
    {ACTIVE_NAMES.has(name)?<button disabled={paused} onClick={()=>onKey("e")}>E · {name==="Tonic"?"DRINK":name==="Sage"?c.stone?"DRINK STONE":"BREW STONE":overhaulCharacter(r.key)?.ability}</button>:null}
    {name==="Sprint"?<button disabled={paused} onClick={()=>onKey("w")}>W · JUMP TWO LANES LEFT</button>:null}
    {name==="Handflipper"&&r.online?<button disabled={paused} onClick={()=>onKey("r")}>R · CONFUSE</button>:null}
    {Object.entries(r.cooldowns).filter(([,end])=>end>r.elapsed).map(([key,end])=><small key={key}>{key.replaceAll("-"," ")} · {(end-r.elapsed).toFixed(1)}s</small>)}
    {c.hookArmed?<div className="hook-lanes" role="group" aria-label="Rescue Hook target">{Array.from({length:r.laneCount},(_,lane)=><button key={lane} disabled={paused||lane===r.lane} onClick={()=>onHook(lane)}>LANE {lane+1}</button>)}</div>:null}
  </details>{name==="Mirage"&&r.online?<section className="mirage-board" aria-label="Rival board"><button onClick={()=>setExpanded(v=>!v)}>{expanded?"− SHRINK":"+ RIVAL BOARD"}</button>{expanded?<><p>Rival lane {rival? rival.lane+1:"…"}</p><ol>{Array.from({length:r.laneCount},(_,lane)=><li key={lane}>Lane {lane+1}: {rival?.items.filter(item=>item.lane===lane&&item.y<105).sort((a,b)=>b.y-a.y).map(item=>item.kind).join(" · ")||"Clear"}</li>)}</ol></>:null}</section>:null}</aside>;
}
