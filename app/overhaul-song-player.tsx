"use client";
import {useEffect,useLayoutEffect,useRef,useState} from "react";
import type {MusicClip} from "./overhaul-song-library";

type Player={setVolume:(volume:number)=>void;getCurrentTime:()=>number;getPlayerState:()=>number;cueVideoById:(v:{videoId:string;startSeconds:number;endSeconds:number})=>void;playVideo:()=>void;pauseVideo:()=>void;destroy:()=>void};
type PlayerEvent={target:Player;data?:number};
type Youtube={Player:new(element:HTMLElement,options:{host:string;width:string;height:string;playerVars:Record<string,string|number>;events:{onReady:(e:PlayerEvent)=>void;onError:()=>void;onStateChange:(e:PlayerEvent)=>void;onAutoplayBlocked:()=>void}})=>Player};
declare global {interface Window {YT?:Youtube;onYouTubeIframeAPIReady?:()=>void}}
let api:Promise<Youtube>|null=null;
function youtube(){
 if(window.YT?.Player)return Promise.resolve(window.YT);
 if(api)return api;
 api=new Promise<Youtube>((resolve,reject)=>{
  const old=window.onYouTubeIframeAPIReady;
  window.onYouTubeIframeAPIReady=()=>{old?.();if(window.YT?.Player)resolve(window.YT);else reject(Error("Music player unavailable"));};
  const script=document.createElement("script");script.src="https://www.youtube.com/iframe_api";script.async=true;
  script.onerror=()=>{api=null;reject(Error("Music player unavailable"));};document.head.append(script);
 });return api;
}

/** The visible official player owns playback. Buffering, a blocked autoplay,
 * background suspension or a failed embed cannot consume the guessing time. */
export function OverhaulSongPlayer({clip,onComplete,volume=.45}:{clip:MusicClip;onComplete:()=>void;volume?:number}){
 const host=useRef<HTMLDivElement>(null),player=useRef<Player|null>(null),done=useRef(false),callback=useRef(onComplete);
 const [status,setStatus]=useState("Press PLAY to hear the clip."),[failed,setFailed]=useState(false),[retry,setRetry]=useState(0),[remaining,setRemaining]=useState(clip.seconds);
 useLayoutEffect(()=>{callback.current=onComplete;},[onComplete]);
 useEffect(()=>{
  let cancelled=false,interval=0,last=0,heard=0;done.current=false;const reset=window.setTimeout(()=>{if(!cancelled){setRemaining(clip.seconds);setFailed(false);}},0);
  const mount=document.createElement("div");host.current?.replaceChildren(mount);
  void youtube().then(YT=>{if(cancelled)return;
   const p=new YT.Player(mount,{host:"https://www.youtube-nocookie.com",width:"100%",height:"220",playerVars:{origin:window.location.origin,playsinline:1,controls:1,rel:0},events:{
    onReady:({target})=>{if(cancelled)return;target.setVolume(Math.round(Math.max(0,Math.min(1,volume))*100));target.cueVideoById({videoId:clip.videoId,startSeconds:clip.start,endSeconds:clip.start+clip.seconds});setStatus("Press PLAY to hear the clip.");},
    onError:()=>{if(!cancelled){setFailed(true);setStatus("This official player could not play the clip. Retry without a penalty.");}},
    onAutoplayBlocked:()=>{if(!cancelled)setStatus("Press PLAY in the player to continue.");},
    onStateChange:({data})=>{if(cancelled)return;last=performance.now();setStatus(data===1?"Listen to the language.":"Playback paused. Guessing time has not started.");}
   }});player.current=p;
   interval=window.setInterval(()=>{if(cancelled||done.current)return;const now=performance.now(),dt=Math.min(.5,Math.max(0,(now-last)/1000));last=now;
    if(p.getPlayerState()!==1||document.hidden)return;
    const time=p.getCurrentTime();if(time>=clip.start-.5&&time<=clip.start+clip.seconds+.75)heard+=dt;
    setRemaining(Math.max(0,clip.seconds-heard));
    if(heard>=clip.seconds-1&&time>=clip.start+clip.seconds-1){done.current=true;p.pauseVideo();callback.current();}
    else if(time>=clip.start+clip.seconds-.25&&heard<clip.seconds-1){p.cueVideoById({videoId:clip.videoId,startSeconds:clip.start,endSeconds:clip.start+clip.seconds});setStatus("Play the full clip before guessing.");}
   },100);
  }).catch(()=>{if(!cancelled){setFailed(true);setStatus("Music player unavailable. Retry without a penalty.");}});
  return()=>{cancelled=true;window.clearTimeout(reset);window.clearInterval(interval);player.current?.destroy();player.current=null;};
 },[clip,retry,volume]);
 return <section className="overhaul-song"><div ref={host}/><p role="status">{status} · {Math.ceil(remaining)}s</p>{failed?<button onClick={()=>setRetry(n=>n+1)}>RETRY PLAYER</button>:<button onClick={()=>player.current?.playVideo()}>PLAY</button>}</section>;
}
