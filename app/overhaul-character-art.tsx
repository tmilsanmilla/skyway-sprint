import {memo} from "react";
import {OVERHAUL_CHARACTERS} from "./overhaul-catalog";
const PALETTES=[['#3f718f','#a8dce8'],['#7a4f99','#e1c3f1'],['#a66735','#ffdb7e'],['#328165','#adf1b7'],['#a14562','#ffc2c8'],['#4f5b8c','#bfc7f7'],['#736c4e','#ebe2ac'],['#4c7375','#a0e7e2']];
const DEFINITIONS=new Map(OVERHAUL_CHARACTERS.map(c=>[c.key,{...c,palette:PALETTES[[...c.name].reduce((n,x)=>n+x.charCodeAt(0),0)%PALETTES.length]}]));
/** Code-native pixel art shares the live character identity, rather than
 * loading a separate bitmap or recomputing its geometry on each game frame. */
export const OverhaulCharacterArt=memo(function OverhaulCharacterArt({character,flight=false}:{character:string;flight?:boolean}){
 const c=DEFINITIONS.get(character);if(!c||c.legacyRuntime)return null;
 const [dark,light]=c.palette;
 if(c.name==="Arch")return <svg className="overhaul-character-art" viewBox="0 0 40 56" aria-hidden="true"><path d="M3 54V34C3 7 10 2 20 2S37 7 37 34V54H30V34C30 17 26 11 20 11S10 17 10 34V54Z" fill="#bec5cc" stroke="#444" strokeWidth="2"/><path d="M7 52V33C7 15 12 7 20 6" stroke="white" fill="none" strokeWidth="2"/></svg>;
 if(c.name==="Um")return <svg className="overhaul-character-art" viewBox="0 0 40 56" aria-hidden="true"><path d="M12 3H28V9L24 17L34 25L31 48L26 54H14L9 48L6 25L16 17L12 9Z" fill="#97774f" stroke="#382a18" strokeWidth="2"/><path d="M10 29H30M11 35H29M12 45H28" stroke="#d4b47f" strokeWidth="3"/><path d="M13 7H27" stroke="#3e3225" strokeWidth="3"/></svg>;
 if(c.name==="Brace")return <svg className="overhaul-character-art" viewBox="0 0 40 56" aria-hidden="true"><rect x="2" y="12" width="36" height="32" rx="8" fill="#f6eded" stroke="#832d48" strokeWidth="3"/>{[4,12,20,28].map(x=><rect key={x} x={x} y="18" width="7" height="20" rx="2" fill="white" stroke="#baa6a6"/>)}<path d="M3 28H37" stroke="#777" strokeWidth="2"/>{[5,13,21,29].map(x=><rect key={x} x={x} y="24" width="5" height="8" fill="#949aaa" stroke="#48546c"/>)}</svg>;
 return <svg className={`overhaul-character-art art-${c.classKey}`} viewBox="0 0 40 56" aria-hidden="true" shapeRendering="crispEdges">
  {flight?<path d="M16 22L0 8L3 29L15 36M24 22L40 8L37 29L25 36" fill="#ffa34e" stroke="#873b13" strokeWidth="2"/>:null}
  <path d="M8 26H32V45H27V55H21V45H18V55H12V45H8Z" fill={dark} stroke="#17202b" strokeWidth="2"/>
  <path d="M10 25H5V39H10M30 25H35V39H30" fill={light} stroke="#17202b" strokeWidth="2"/>
  <rect x="9" y="4" width="22" height="21" rx={c.classKey==="chaotic"?8:2} fill={light} stroke="#17202b" strokeWidth="2"/>
  <path d="M14 13V17M25 13V17" stroke="#151b27" strokeWidth="3"/>
  {c.classKey==="medic"?<path d="M17 27H23V32H28V38H23V43H17V38H12V32H17Z" fill="#f4eded"/>:c.classKey==="tank"?<path d="M12 28H28V37L20 44L12 37Z" fill={light}/>:c.classKey==="runner"?<path d="M21 27L13 36H20L17 44L28 32H21Z" fill={light}/>:c.classKey==="trickster"?<path d="M11 29L20 42L29 29L20 33Z" fill={light}/>:c.classKey==="misc"?<><circle cx="20" cy="35" r="7" fill={light}/><path d="M20 27V43M12 35H28" stroke={dark} strokeWidth="2"/></>:<path d="M20 27L30 35L20 44L10 35Z" fill={light}/>}
  {c.name==="Knight"?<><path d="M7 8L12 1H28L33 8V22H7Z" fill="#939aaf" stroke="#303b51" strokeWidth="2"/><path d="M11 12H29M15 13V19M20 13V19M25 13V19" stroke="#303b51" strokeWidth="2"/></>:null}
  {c.name==="Spring"?<path d="M12 47L27 49L13 51L27 53L13 55" fill="none" stroke="#b5ccd5" strokeWidth="2"/>:null}
  {['Cloak','Phantom','Hex','Eclipse'].includes(c.name)?<path d="M7 8L3 43L12 48V23H28V48L37 43L33 8L28 0H12Z" fill={dark} opacity=".7"/>:null}
  {c.name==="Cartographer"?<path d="M26 25L37 22L39 40L27 43Z" fill="#f9e0a1" stroke="#544229" strokeWidth="1.5"/>:null}
  {c.name==="Bowler"?<circle cx="34" cy="34" r="6" fill="#252b4c" stroke="#a0afd4"/>:null}
  {['Warrior','Hammer','Surveyor','Tonic','Sage'].includes(c.name)?<path d="M34 19V50M29 23H39" stroke={c.name==="Warrior"?'#d4ebff':'#d5b366'} strokeWidth="4"/>:null}
 </svg>;
});
