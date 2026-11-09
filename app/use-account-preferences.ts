"use client";
import {useEffect,useRef,useState} from "react";
import {supabase} from "./skyway-client";
import {AccountPreferencesController,DEFAULT_ACCOUNT_PREFERENCES,parseAccountPreferences,type AccountPreferences,type PreferencesView} from "./account-preferences";

export function useAccountPreferences(owner: string|null) {
  const controller=useRef<AccountPreferencesController|null>(null);
  const [state,setState]=useState<PreferencesView>({value:{...DEFAULT_ACCOUNT_PREFERENCES},loaded:false,status:"loading",error:""});
  const [loadedOwner,setLoadedOwner]=useState<string|null>(null);
  useEffect(()=>{
    if(!owner){controller.current=null;return;}
    let active=true;
    const next=new AccountPreferencesController(owner,{
      async load(id){
        const {data,error}=await supabase.rpc("get_player_account_preferences",{p_expected_user:id});
        if(error)throw new Error("Account settings unavailable.");
        return parseAccountPreferences(data);
      },
      async save(id,revision,value){
        const {data,error}=await supabase.rpc("set_player_account_preferences",{
          p_expected_user:id,p_expected_revision:revision,p_avatar_color:value.avatarColor,
          p_avatar_font:value.avatarFont,p_soundtrack:value.soundtrack,
          p_music_volume:value.musicVolume,p_sfx_volume:value.sfxVolume,
        });
        if(error)throw new Error("Account save unconfirmed.");
        return parseAccountPreferences(data);
      },
    },()=>active,view=>{setLoadedOwner(owner);setState(view);});
    controller.current=next;void next.load();
    return()=>{active=false;next.close();};
  },[owner]);
  const visible=owner&&loadedOwner===owner?state:{value:{...DEFAULT_ACCOUNT_PREFERENCES},loaded:false,status:"loading" as const,error:""};
  return {...visible,update:(patch:Partial<AccountPreferences>)=>controller.current?.patch(patch),retry:()=>void controller.current?.flush()};
}
