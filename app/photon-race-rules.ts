import {PHOTON_RULES,PHOTON_CHARACTERS,PHOTON_STARTERS,type PhotonCharacterKey} from "./photon-fury-rules.ts";
export const PHOTON_RACE={hp:40,level:50,price:1000,stardustPrice:1000,speed:PHOTON_RULES.baseTravelSpeed*3,spawnInterval:0.65/Math.sqrt(3),hitY:0.73,lanes:4} as const;
export const RACE_KINDS=["rock","needle","car","log","spike","barrel"] as const;
export type RaceKind=(typeof RACE_KINDS)[number];
const SPEED:Record<RaceKind,number>={rock:.35,needle:1,car:1.25,log:.72,spike:1,barrel:1.5};
/** FNV-1a over the ASCII server match ID/slot/index. Mirrored by the private
 * SQL course function: clients animate a course, never report arbitrary HP. */
export function photonRaceHash(text:string){let h=2166136261;for(let i=0;i<text.length;i++)h=Math.imul(h^text.charCodeAt(i),16777619)>>>0;return h;}
export function photonRaceItem(match:string,slot:number,index:number){
  if(!/^[0-9a-f-]{36}$/i.test(match)||![1,2].includes(slot)||!Number.isSafeInteger(index)||index<0)throw Error("Invalid race course");
  const hash=photonRaceHash(`${match}:${slot}:${index}`),roll=hash%100;
  const kind:RaceKind=roll<10?"rock":roll<20?"needle":roll<38?"car":roll<48?"log":roll<74?"spike":"barrel";
  const speed=PHOTON_RACE.speed*SPEED[kind],at=index*PHOTON_RACE.spawnInterval;
  return {id:index,kind,lane:Math.floor(hash/100)%4,at,speed,contactAt:at+(PHOTON_RACE.hitY+.12)/speed};
}
export function photonRaceVisible(match:string,slot:number,seconds:number){
  if(!Number.isFinite(seconds)||seconds<0)return [];
  const maxTravel=1.3/(PHOTON_RACE.speed*.35),first=Math.max(0,Math.floor((seconds-maxTravel)/PHOTON_RACE.spawnInterval));
  return Array.from({length:Math.ceil(maxTravel/PHOTON_RACE.spawnInterval)+2},(_,i)=>photonRaceItem(match,slot,first+i)).map(item=>({...item,y:-.12+(seconds-item.at)*item.speed})).filter(item=>item.at<=seconds&&item.y<1.15);
}
export function photonRaceEligibility(level:number,owned:readonly string[],photons:number,stardust:number=0){
  const keys=Object.keys(PHOTON_CHARACTERS) as PhotonCharacterKey[],set=new Set([...owned,...PHOTON_STARTERS]);
  return {level:level>=50,characters:keys.every(key=>set.has(key)),photons:photons>=1000,stardust:stardust>=1000,owned:keys.filter(key=>set.has(key)).length,total:keys.length};
}
export function photonRaceContact(hp:number,kind:RaceKind){return kind==="needle"?Math.min(40,hp+1):Math.max(0,hp-1);}
export type PhotonRaceSnapshot={id:string;status:"waiting"|"playing"|"finished"|"cancelled";slot:1|2;startsAt:string|null;serverNow:string;selfHp:number;rivalHp:number;lane:number;winner:boolean|null;finishedAt:string|null;unlocked:boolean;photons:number};
export function parsePhotonRace(value:unknown):PhotonRaceSnapshot{
  if(!value||typeof value!=="object")throw Error("Race returned no state");
  const v=value as Record<string,unknown>,hp=(value:unknown)=>typeof value==="number"&&Number.isInteger(value)&&value>=0&&value<=40;
  if(typeof v.id!=="string"||!/^[-0-9a-f]{36}$/i.test(v.id)||!["waiting","playing","finished","cancelled"].includes(String(v.status))||![1,2].includes(Number(v.slot))||!hp(v.selfHp)||!hp(v.rivalHp)||!Number.isInteger(v.lane)||Number(v.lane)<0||Number(v.lane)>3||typeof v.serverNow!=="string"||!Number.isFinite(Date.parse(v.serverNow))||!(v.startsAt===null||typeof v.startsAt==="string"&&Number.isFinite(Date.parse(v.startsAt)))||!(v.finishedAt===null||typeof v.finishedAt==="string"&&Number.isFinite(Date.parse(v.finishedAt)))||!(v.winner===true||v.winner===false||v.winner===null)||typeof v.unlocked!=="boolean"||typeof v.photons!=="number"||!Number.isSafeInteger(v.photons)||v.photons<0)throw Error("Race returned invalid state");
  return v as PhotonRaceSnapshot;
}
