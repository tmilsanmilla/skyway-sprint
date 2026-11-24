import { NextResponse } from "next/server";
import { pixelPublicKeys, pixelDatabaseKeys } from "@/lib/pixel-pulse-server";
export const runtime="nodejs";
export const dynamic="force-dynamic";
type Context={params:Promise<{action:string}>};
async function route(request:Request,context:Context){
 const {action}=await context.params;
 const json=(value:unknown,status=200)=>NextResponse.json(value,{status,headers:{"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});
 try{
  // Retain verification keys for the established native Data API configuration.
  // This does not enable a Pixel login, token, link or account creation route.
  if(request.method==="GET"&&["jwks","database-keys"].includes(action))return NextResponse.json(action==="jwks"?await pixelPublicKeys():await pixelDatabaseKeys(),{headers:{"Cache-Control":"public, max-age=60"}});
  if(action==="status")return json({enabled:false,returningEnabled:false});
  if(action==="session")return json({session:null});
  if(action==="signout"&&request.method==="POST")return json({ok:true});
  return json({error:"Pixel Pulse sign-in has been removed. Use your existing Skyway account."},410);
 }catch{return json({error:"Verification keys are temporarily unavailable."},503);}
}
export const GET=route;
export const POST=route;
