"use client";
import {useCallback,useEffect,useLayoutEffect,useRef,useState,type PointerEvent} from "react";
import type {OverhaulChallengeKind,OverhaulItem} from "./overhaul-runtime";
import type {OverhaulCharacter} from "./overhaul-catalog";
import {STATE_OUTLINES} from "./state-outlines";
import {eraseDrawing,cartographyMultiAccuracy,conicShapePath,CONIC_NAMES,GAMBIT_HANDS,gambitHand,rerollGambit,throwBowlingBall,IMAGINATION_COLORS,wildcardCardDescription,type DrawingPoint,type EuchreCard} from "./overhaul-challenges";
import {SONG_CLIPS,SONG_LANGUAGES} from "./overhaul-song-library";
import {OverhaulSongPlayer} from "./overhaul-song-player";
import "./overhaul-challenge-panel.css";

type Props={blocked?:boolean;kind:OverhaulChallengeKind;data:Record<string,unknown>;choices:readonly OverhaulCharacter[];online:boolean;onResolve:(kind:OverhaulChallengeKind,value:unknown)=>void};
const KEY_PROMPTS=["A","S","D","F"];
const limit=(kind:OverhaulChallengeKind)=>kind==="tempo"?5.5:kind==="pulse"||kind==="hades-keys"||kind==="void"?20:kind==="drawing"?25:kind==="imagination"?15:kind==="bowling"?12:kind==="wildcard"?5:kind==="hades-targets"||kind==="math"||kind==="zenith-stop"?10:Infinity;

/** Mounted once per issued challenge. One monotonic clock and one keyboard
 * listener belong to this panel; unmount clears both. No account/network I/O. */
export function OverhaulChallengePanel({kind,data,choices,online,onResolve,blocked=false}:Props){
  const blockedRef=useRef(blocked);useLayoutEffect(()=>{blockedRef.current=blocked;},[blocked]);
  const [result,setResult]=useState<string|null>(null),[heard,setHeard]=useState(false);
  const heardAt=useRef<number|null>(null),resultTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
  const [elapsed,setElapsed]=useState(0),[answer,setAnswer]=useState(""),[correct,setCorrect]=useState(0),[wrong,setWrong]=useState(0);
  const [prompt,setPrompt]=useState(()=>KEY_PROMPTS[Math.floor(Math.random()*4)]);
  const [selected,setSelected]=useState<string[]>([]),[numbers,setNumbers]=useState<number[]>([]);
  const [dice,setDice]=useState<number[]>(()=>data.dice as number[]||[]),[rerolls,setRerolls]=useState(0);
  const [pins,setPins]=useState<boolean[]>(()=>Array(10).fill(true)),[ball,setBall]=useState(0),[pinfall,setPinfall]=useState(0),[aim,setAim]=useState(0);
  const [drawing,setDrawing]=useState<DrawingPoint[][]>([]),[eraser,setEraser]=useState(false);
  const [target,setTarget]=useState(()=>[10+Math.random()*75,15+Math.random()*65]);
  const [curve]=useState(()=>conicShapePath(Number(data.shape),0.4+Math.random()*0.5));
  const [state]=useState(()=>STATE_OUTLINES[Math.floor(Math.random()*STATE_OUTLINES.length)]);
  const [lane,setLane]=useState(3),[collected,setCollected]=useState<number[]>([]);
  const [damned]=useState(()=>Array.from({length:12},(_,id)=>({id,lane:Math.floor(Math.random()*8),at:0.3+id*1.4})));
  const started=useRef(0),settled=useRef(false),drawingNow=useRef(false),lastBall=useRef(0),root=useRef<HTMLDivElement>(null);
  const latest=useRef({answer,correct,wrong,prompt,selected,numbers,dice,pins,ball,pinfall,aim,drawing,lane,collected,elapsed});
  useLayoutEffect(()=>{latest.current={answer,correct,wrong,prompt,selected,numbers,dice,pins,ball,pinfall,aim,drawing,lane,collected,elapsed};});
  const callback=useRef(onResolve);useLayoutEffect(()=>{callback.current=onResolve;},[onResolve]);
  const finish=useCallback((value:unknown)=>{if(settled.current)return;settled.current=true;
    if(kind==="math"){setResult(typeof value==="string"&&value===data.answer?"CORRECT":"INCORRECT");resultTimer.current=setTimeout(()=>callback.current(kind,value),2000);}
    else callback.current(kind,value);
  },[kind,data.answer]);
  const rollBall=useCallback((value:number)=>{
    const s=latest.current;if(s.ball>=3||settled.current)return;
    const result=throwBowlingBall(s.pins,value);const next=s.pinfall+result.points;
    const nextPins=result.standing.some(Boolean)?result.standing:Array(10).fill(true);
    latest.current={...s,pins:nextPins,ball:s.ball+1,pinfall:next};
    setPins(nextPins);setBall(s.ball+1);setPinfall(next);lastBall.current=performance.now();
    if(s.ball+1===3)finish(next);
  },[finish]);
  const press=useCallback((key:string)=>{
    const s=latest.current;
    if(kind==="tempo"&&key==="E"){finish((performance.now()-started.current)/1000);return;}
    if(kind==="pulse"||kind==="hades-keys"){
      if(!KEY_PROMPTS.includes(key))return;
      const right=key===s.prompt,nextCorrect=s.correct+Number(right),nextWrong=s.wrong+Number(!right);
      const nextPrompt=KEY_PROMPTS[Math.floor(Math.random()*4)];latest.current={...s,correct:nextCorrect,wrong:nextWrong,prompt:nextPrompt};
      setCorrect(nextCorrect);setWrong(nextWrong);setPrompt(nextPrompt);
      if(nextWrong>=2||kind==="hades-keys"&&nextCorrect>=25)finish({correct:nextCorrect,wrong:nextWrong});
    }
    if(kind==="imagination"&&s.elapsed>=5&&/^[1-6]$/.test(key)){
      const sequence=data.colors as number[],next=[...s.numbers,Number(key)];latest.current={...s,numbers:next};setNumbers(next);
      if(sequence[next.length-1]!==Number(key)||next.length===sequence.length)finish(next);
    }
    if(kind==="conic"&&/^\d$/.test(key))finish(Number(key));
    if(kind==="void"){
      const direction=key==="A"||key==="ARROWLEFT"?-1:key==="D"||key==="ARROWRIGHT"?1:0;
      if(direction){const next=Math.max(0,Math.min(7,s.lane+direction));latest.current={...s,lane:next};setLane(next);}
    }
  },[kind,data,finish]);
  useEffect(()=>{
    started.current=performance.now();lastBall.current=started.current;
    const oldFocus=document.activeElement instanceof HTMLElement?document.activeElement:null;
    root.current?.focus();
    const key=(event:KeyboardEvent)=>{
      if(blockedRef.current)return;
      if(event.key==="Tab"){
        const controls=Array.from(root.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input,select,[tabindex="0"]')||[]);
        if(!controls.length){event.preventDefault();return;}
        const first=controls[0],last=controls.at(-1)!;
        if(event.shiftKey&&(document.activeElement===first||document.activeElement===root.current)){event.preventDefault();last.focus();}
        else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
        return;
      }
      event.stopPropagation();
      if(event.repeat)return;
      if(event.target instanceof HTMLInputElement||event.target instanceof HTMLButtonElement&&(event.key==="Enter"||event.key===" "))return;
      event.preventDefault();press(event.key.toUpperCase());
    };
    window.addEventListener("keydown",key,true);
    const timer=window.setInterval(()=>{
      const seconds=(performance.now()-started.current)/1000,s=latest.current;
      latest.current={...s,elapsed:seconds};setElapsed(seconds);
      if(kind==="bowling"&&(performance.now()-lastBall.current)>=4000)rollBall(Math.random()*2-1);
      if(kind==="void"){
        const next=damned.filter(item=>seconds>=item.at+2&&s.elapsed<item.at+2&&item.lane===s.lane&&!s.collected.includes(item.id)).map(item=>item.id);
        if(next.length){const ids=[...s.collected,...next];latest.current.collected=ids;setCollected(ids);}
      }
      if(kind==="language"&&heardAt.current!==null&&(performance.now()-heardAt.current)>=10000)finish("");
      if(seconds<limit(kind))return;
      const current=latest.current;
      if(kind==="tempo")finish(6);
      else if(kind==="pulse"||kind==="hades-keys")finish({correct:current.correct,wrong:current.wrong});
      else if(kind==="hades-targets")finish(current.correct);
      else if(kind==="math")finish("");
      else if(kind==="imagination")finish(current.numbers);
      else if(kind==="void")finish(current.collected.length);
      else if(kind==="drawing")finish(cartographyMultiAccuracy(current.drawing,state.paths));
      else if(kind==="wildcard")finish(-1);
      else if(kind==="zenith-stop")finish(null);
    },50);
    return()=>{if(resultTimer.current)clearTimeout(resultTimer.current);window.clearInterval(timer);window.removeEventListener("keydown",key,true);if(oldFocus?.isConnected)oldFocus.focus();};
  },[kind,press,rollBall,finish,damned,state]);
  useEffect(()=>{let cancelled=false;if(kind==="wildcard"&&data.automatic)queueMicrotask(()=>{if(!cancelled)finish(0);});return()=>{cancelled=true;};},[kind,data.automatic,finish]);
  const point=(event:PointerEvent<SVGSVGElement>):DrawingPoint=>{const rect=event.currentTarget.getBoundingClientRect();return [(event.clientX-rect.left)/rect.width*100,(event.clientY-rect.top)/rect.height*100];};
  const draw=(event:PointerEvent<SVGSVGElement>)=>{
    if(!drawingNow.current)return;const p=point(event);
    setDrawing(old=>eraser?eraseDrawing(old,p):[...old.slice(0,-1),[...(old.at(-1)||[]),p]]);
  };
  const choose=(key:string)=>setSelected(old=>old.includes(key)?old.filter(k=>k!==key):[...old,key].slice(-(kind==="echo-passives"?2:1)));
  const remaining=Math.max(0,limit(kind)-elapsed);
  const memory=data.colors as number[]||[];
  return <div className="overhaul-backdrop"><div className={`overhaul-challenge overhaul-${kind}`} role="dialog" aria-modal="true" aria-labelledby="overhaul-challenge-title" tabIndex={-1} ref={root}>
    <header><h2 id="overhaul-challenge-title">{kind.replaceAll("-"," ").toUpperCase()}</h2>{kind!=="tempo"&&Number.isFinite(remaining)?<output aria-label="Time remaining">{remaining.toFixed(1)}s</output>:null}</header>
    {kind==="tempo"?<><p className="challenge-go">GO!</p><p>Count four seconds, then press E.</p><button onClick={()=>press("E")}>E · STOP</button></>:null}
    {kind==="pulse"||kind==="hades-keys"?<><p>Correct {correct} · Wrong {wrong}/2</p><strong className="challenge-prompt">{prompt}</strong><div className="challenge-keys">{KEY_PROMPTS.map(key=><button key={key} onClick={()=>press(key)}>{key}</button>)}</div></>:null}
    {kind==="gambit"?<><p>Select dice to reroll. {3-rerolls} rerolls left.</p><div className="challenge-dice">{dice.map((die,i)=><button key={i} aria-pressed={numbers.includes(i)} onClick={()=>setNumbers(old=>old.includes(i)?old.filter(n=>n!==i):[...old,i])}>{die}</button>)}</div><p>{GAMBIT_HANDS[gambitHand(dice)]}</p><button disabled={rerolls>=3||!numbers.length} onClick={()=>{setDice(rerollGambit(dice,numbers,rerolls,Math.random));setRerolls(n=>n+1);setNumbers([]);}}>REROLL SELECTED</button><button onClick={()=>finish(dice)}>KEEP ROLL</button></>:null}
    {kind==="imagination"?<><div className="memory-colors">{(elapsed<5?memory.slice(-2):numbers).map((color,i)=><span key={i} style={{background:IMAGINATION_COLORS[color-1]}}>{color}</span>)}</div><p>{elapsed<5?"Remember these two new colors.":`Repeat the full sequence · ${numbers.length}/${memory.length}`}</p><div className="challenge-keys">{IMAGINATION_COLORS.map((color,i)=><button style={{borderColor:color}} key={color} disabled={elapsed<5} onClick={()=>press(String(i+1))}>{i+1} · {color}</button>)}</div></>:null}
    {kind==="math"&&result?<p className="challenge-prompt" role="status">{result}</p>:null}
    {kind==="language"?<>{!heard?<OverhaulSongPlayer clip={SONG_CLIPS[Number(data.clip)||0]} onComplete={()=>{heardAt.current=performance.now();setHeard(true);}}/>:<><p>Which language did you hear? · 10 seconds</p><div className="challenge-keys">{SONG_LANGUAGES.map(language=><button key={language} onClick={()=>finish(language)}>{language}</button>)}</div></>}</>:null}
    {kind==="math"&&!result?<form onSubmit={event=>{event.preventDefault();finish(answer);}}><p className="challenge-prompt">{String(data.a)} + {String(data.b)}</p><label>Answer<input autoFocus inputMode="numeric" pattern="[0-9]*" value={answer} onChange={event=>setAnswer(event.target.value.replace(/[^0-9]/g,"").slice(0,3))}/></label><button type="submit">ANSWER</button></form>:null}
    {kind==="bowling"?<><p>Ball {Math.min(3,ball+1)}/3 · {pinfall} points</p><div className="bowling-lane" onPointerMove={event=>{const r=event.currentTarget.getBoundingClientRect();setAim(Math.max(-1,Math.min(1,(event.clientX-r.left)/r.width*2-1)));}} onClick={()=>rollBall(aim)}>{pins.map((standing,i)=><span key={i} style={{opacity:standing?1:0.12,left:`${35+(i%4)*10}%`,top:`${8+Math.floor(i/4)*12}%`}}>♟</span>)}<b style={{left:`${50+aim*40}%`}}>●</b></div><label>Aim<input type="range" min={-1} max={1} step={0.01} value={aim} onChange={event=>setAim(Number(event.target.value))}/></label><button onClick={()=>rollBall(aim)}>ROLL</button></>:null}
    {kind==="drawing"?<><p>Draw {state.name}. Size does not affect accuracy.</p><div className="cartography"><svg viewBox="0 0 100 100" aria-label={`${state.name} reference outline`}>{state.paths.map((path,i)=><polyline key={i} points={path.map(p=>p.join(",")).join(" ")}/>)}</svg><svg viewBox="0 0 100 100" role="img" aria-label="Drawing area" onPointerDown={event=>{event.currentTarget.setPointerCapture(event.pointerId);drawingNow.current=true;if(!eraser)setDrawing(old=>[...old,[point(event)]]);else draw(event);}} onPointerMove={draw} onPointerUp={()=>drawingNow.current=false} onPointerCancel={()=>drawingNow.current=false}>{drawing.map((path,i)=><polyline key={i} points={path.map(p=>p.join(",")).join(" ")}/>)}</svg></div><button aria-pressed={!eraser} onClick={()=>setEraser(false)}>PEN</button><button aria-pressed={eraser} onClick={()=>setEraser(true)}>ERASER</button><button onClick={()=>setDrawing([])}>CLEAR</button><button onClick={()=>finish(cartographyMultiAccuracy(drawing,state.paths))}>SUBMIT</button></>:null}
    {kind==="conic"?<><svg className="conic-shape" viewBox="-20 -20 240 240" aria-label="Identify the curve"><path d={curve}/></svg><div className="challenge-keys">{CONIC_NAMES.map((shape,i)=><button key={shape} onClick={()=>press(String(i))}>{i} · {shape}</button>)}</div></>:null}
    {kind==="hades-targets"?<><p>Hit the white target 15 times · {correct}/15</p><div className="hades-target-area"><button aria-label="Hit Hades target" style={{left:`${target[0]}%`,top:`${target[1]}%`}} onClick={()=>{const next=latest.current.correct+1;latest.current.correct=next;setCorrect(next);setTarget([5+Math.random()*85,5+Math.random()*85]);if(next>=15)finish(next);}}/></div></>:null}
    {kind==="void"?<><p>Collect damned · {collected.length}/12</p><div className="void-track">{damned.filter(item=>!collected.includes(item.id)&&elapsed>=item.at&&elapsed<item.at+2.3).map(item=><span key={item.id} style={{left:`${(item.lane+0.5)*12.5}%`,top:`${Math.min(95,(elapsed-item.at)/2*90)}%`}}>◆</span>)}<b style={{left:`${(lane+0.5)*12.5}%`}}>●</b></div><div className="void-lanes">{Array.from({length:8},(_,i)=><button key={i} aria-label={`Lane ${i+1}`} aria-pressed={lane===i} onClick={()=>{latest.current.lane=i;setLane(i);}}>{i+1}</button>)}</div></>:null}
    {kind==="wildcard"?<><p>Choose a card before the timer ends.</p><div className="challenge-cards">{(data.cards as EuchreCard[]||[]).map((card,i)=><button key={card} onClick={()=>finish(i)}><strong>{card}</strong><span>{wildcardCardDescription(card,online)}</span></button>)}</div></>:null}
    {["muse","pacer","echo-passives"].includes(kind)?<><p>{kind==="echo-passives"?"Choose two passives.":"Choose your next character."}</p><div className="challenge-character-grid">{choices.map(c=><button key={c.key} aria-pressed={selected.includes(c.key)} onClick={()=>choose(c.key)}><strong>{c.name}</strong><small>{c.classKey} · {c.rarity}</small><span>{c.description}</span></button>)}</div><button disabled={selected.length!==(kind==="echo-passives"?2:1)} onClick={()=>finish(kind==="echo-passives"?selected:selected[0])}>CONTINUE</button></>:null}
    {kind==="mimic"?<><button onClick={()=>finish(1)}>+18% score in non-edge lanes</button><button onClick={()=>finish(2)}>−5% obstacle speed · +35% XP</button></>:null}
    {kind==="adaptation"?<><p>Sacrifice one full adaptation. It will retain 20% damage reduction.</p>{(data.choices as string[]||[]).map(choice=><button key={choice} onClick={()=>finish(choice)}>{choice}</button>)}</>:null}
    {kind==="lantern"?<><p>Select hazards to stop for two active seconds after resuming.</p><div className="challenge-keys">{(data.items as OverhaulItem[]||[]).map(item=><button key={item.id} aria-pressed={numbers.includes(item.id)} onClick={()=>setNumbers(old=>old.includes(item.id)?old.filter(id=>id!==item.id):[...old,item.id])}>{item.kind} · lane {item.lane+1}</button>)}</div><button onClick={()=>finish(numbers)}>RESUME</button></>:null}
    {kind==="zenith-stop"?<p className="zenith-clock">TIME STOP · +15,000 SCORE</p>:null}
  </div></div>;
}
