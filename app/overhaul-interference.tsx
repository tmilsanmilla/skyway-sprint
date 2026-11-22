"use client";
import {useEffect,useState}from "react";
import type {OverhaulRuntime}from "./overhaul-runtime";
import {CONIC_NAMES,conicShapePath}from "./overhaul-challenges";
export function OverhaulInterference({runtime:r,onAnswer}:{runtime:OverhaulRuntime;onAnswer:(answer:number)=>void}){
 const [now,setNow]=useState(()=>performance.now()/1000);
 useEffect(()=>{const t=setInterval(()=>setNow(performance.now()/1000),50);return()=>clearInterval(t);},[]);
 const q=r.interference,[path]=useState(()=>conicShapePath(q?.shape||0,.65));
 useEffect(()=>{if(!q)return;const key=(e:KeyboardEvent)=>{e.preventDefault();e.stopImmediatePropagation();if(!e.repeat&&/^\d$/.test(e.key))onAnswer(Number(e.key));};window.addEventListener("keydown",key,true);return()=>window.removeEventListener("keydown",key,true);},[q,onAnswer]);
 if(!q)return null;
 return <div className="overhaul-interference" role="alertdialog" aria-label="Identify the shape to unlock controls"><h3>CHECK · IDENTIFY THE SHAPE</h3><svg viewBox="-20 -20 240 240"><path d={path}/></svg><p>The track continues. A wrong answer locks this question for one second.</p><div>{CONIC_NAMES.map((name,i)=><button key={name} disabled={now<q.retryAt} onClick={()=>onAnswer(i)}>{i} · {name}</button>)}</div></div>;
}
