import {AccountAvatar} from "./account-avatar";
import {AVATAR_FONTS,type AccountPreferences,type PreferencesView} from "./account-preferences";

export function AccountPreferencesPanel({name,state,onChange,onRetry,onRecover,hasRecovery}:{
 name:string;state:PreferencesView;onChange:(value:Partial<AccountPreferences>)=>void;
 onRetry:()=>void;onRecover:()=>void;hasRecovery:boolean;
}){
 return <section className="account-preferences-panel" aria-labelledby="account-appearance-title">
  <h3 id="account-appearance-title">ACCOUNT AVATAR</h3>
  <div className="account-appearance-controls">
   <AccountAvatar name={name} color={state.value.avatarColor} font={state.value.avatarFont}/>
   <label>Circle color<input type="color" value={state.value.avatarColor} disabled={!state.loaded} onInput={e=>onChange({avatarColor:e.currentTarget.value})}/></label>
   <label>Letter font<select value={state.value.avatarFont} disabled={!state.loaded} onChange={e=>{
    const font=AVATAR_FONTS.find(f=>f===e.target.value);if(font)onChange({avatarFont:font});
   }}>{AVATAR_FONTS.map(font=><option key={font} value={font}>{font==="pixel"?"Pixel (default)":font==="sans"?"Sans serif":font==="serif"?"Serif":"Monospace"}</option>)}</select></label>
  </div>
  <p className="account-preferences-status" role={state.status==="error"?"alert":"status"} data-tone={state.status==="error"?"error":"status"}>
   {state.status==="error"?state.error:state.status==="loading"?"Loading account settings…":state.status==="saving"?"Saving to your account…":state.status==="unsaved"?"Changes are not saved yet…":state.value.revision===0?"Using account defaults. Changes save to your account.":"Avatar and audio settings saved to your account."}
  </p>
  {state.status==="error"&&<button type="button" className="settings-action" onClick={onRetry}>RETRY ACCOUNT SETTINGS</button>}
  {hasRecovery&&<button type="button" className="settings-action" disabled={!state.loaded} onClick={onRecover}>RECOVER OLD DEVICE AUDIO SETTINGS</button>}
 </section>;
}
