export type VisibleRival={lane:number;items:Array<{id:number;kind:string;lane:number;y:number}>};
export function readCheckpointItems(raw:unknown,laneCount:number){
 if(!Array.isArray(raw)||raw.length>100)return [];
 const kinds=['pumpkin','gem','coin','melon','mushroom','car','log','snowflake','current','rock','barrel','spikes','vortex'];
 return raw.filter((v):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v)).filter(v=>Number.isSafeInteger(v.id)&&Number(v.id)>=0&&kinds.includes(String(v.kind))&&Number.isInteger(v.lane)&&Number(v.lane)>=0&&Number(v.lane)<laneCount&&typeof v.y==='number'&&Number.isFinite(v.y)&&v.y>=-2000&&v.y<=130);
}
export type OverhaulDelivery={id:string;action:string;values:Record<string,unknown>;dueAt:number;expiresAt:number};
export type CartographyView={selfLocked:boolean;both:boolean;canChoose:boolean;deadline:number;pickedMap:string|null;resolved:boolean};
export type OverhaulClock={wave:number;startedAt:number;serverAt:number;receivedAt:number;paused:boolean};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==="object"&&!Array.isArray(v);
export function readOverhaulNetwork(raw:unknown,receivedAt=Date.now()){
 if(!object(raw)||!object(raw.six_class))return null;const s=raw.six_class;
 const start=Date.parse(String(s.wave_started_at)),server=Date.parse(String(s.server_now));
 if(!Number.isInteger(s.wave)||Number(s.wave)<1||!Number.isFinite(start)||!Number.isFinite(server))throw Error("Invalid shared wave clock");
 const deliveries:OverhaulDelivery[]=[];
 if(!Array.isArray(s.events)||s.events.length>200)throw Error("Invalid character deliveries");
 for(const event of s.events){
  if(!object(event)||typeof event.id!=="string"||!UUID.test(event.id)||typeof event.action!=="string"||!object(event.values))throw Error("Invalid character delivery");
  const due=Date.parse(String(event.due_at)),end=Date.parse(String(event.expires_at));
  if(!Number.isFinite(due)||!Number.isFinite(end)||end<due||end-due>300000)throw Error("Invalid character delivery bounds");
  deliveries.push({id:event.id,action:event.action,values:event.values,dueAt:due,expiresAt:end});
 }
 const cartography:CartographyView|null=object(s.cartography)?{selfLocked:s.cartography.self_locked===true,both:s.cartography.both===true,canChoose:s.cartography.can_choose===true,deadline:Date.parse(String(s.cartography.deadline)),pickedMap:typeof s.cartography.picked_map==="string"?s.cartography.picked_map:null,resolved:s.cartography.resolved===true}:null;
 const rival:VisibleRival|null=object(s.rival)&&Number.isInteger(s.rival.lane)?{lane:Number(s.rival.lane),items:readCheckpointItems(s.rival.items,16).map(v=>({id:Number(v.id),kind:String(v.kind),lane:Number(v.lane),y:Number(v.y)}))}:null;
 return {rival,cartography,clock:{wave:Number(s.wave),startedAt:start,serverAt:server,receivedAt,paused:s.paused===true} as OverhaulClock,deliveries,checkpoint:object(s.checkpoint)?s.checkpoint:null};
}
export function sharedWaveElapsed(clock:OverhaulClock,now=Date.now()){
 return Math.max(0,Math.min(40,(clock.serverAt+(clock.paused?0:Math.max(0,now-clock.receivedAt))-clock.startedAt)/1000));
}
