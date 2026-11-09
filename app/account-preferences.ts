export const AVATAR_FONTS = ["pixel", "sans", "serif", "mono"] as const;
export type AvatarFont = (typeof AVATAR_FONTS)[number];
export type AccountPreferences = {
  avatarColor: string;
  avatarFont: AvatarFont;
  soundtrack: "energetic" | "jazz" | "calm";
  musicVolume: number;
  sfxVolume: number;
};
export type SavedPreferences = AccountPreferences & { revision: number };
export const DEFAULT_ACCOUNT_PREFERENCES: SavedPreferences = {
  avatarColor: "#6b7280", avatarFont: "pixel", soundtrack: "energetic",
  musicVolume: 0.45, sfxVolume: 0.7, revision: 0,
};
const fields = ["avatarColor", "avatarFont", "soundtrack", "musicVolume", "sfxVolume"] as const;
export function parseAccountPreferences(value: unknown): SavedPreferences {
  if (!value || typeof value !== "object") throw new Error("Account settings could not be read.");
  const p = value as SavedPreferences;
  if (!/^#[a-f0-9]{6}$/i.test(p.avatarColor) || !AVATAR_FONTS.includes(p.avatarFont) ||
      !["energetic", "jazz", "calm"].includes(p.soundtrack) ||
      !Number.isFinite(p.musicVolume) || p.musicVolume < 0 || p.musicVolume > 1 ||
      !Number.isFinite(p.sfxVolume) || p.sfxVolume < 0 || p.sfxVolume > 1 ||
      !Number.isSafeInteger(p.revision) || p.revision < 0) throw new Error("Account settings could not be read.");
  return {...Object.fromEntries([...fields, "revision"].map(k => [k, p[k as keyof SavedPreferences]])),avatarColor:p.avatarColor.toLowerCase()} as SavedPreferences;
}
export function accountInitial(name: string): string {
  return Array.from(name.trim())[0]?.toLocaleUpperCase() || "?";
}
export function avatarInk(color: string): "#000000" | "#ffffff" {
  if (!/^#[a-f0-9]{6}$/i.test(color)) return "#ffffff";
  const rgb = [1,3,5].map(i => parseInt(color.slice(i,i+2),16)/255)
    .map(v => v <= 0.04045 ? v/12.92 : ((v+0.055)/1.055)**2.4);
  const luminance=rgb[0]*0.2126+rgb[1]*0.7152+rgb[2]*0.0722;
  return (luminance+0.05)/0.05 >= 1.05/(luminance+0.05) ? "#000000" : "#ffffff";
}

export type PreferencesApi = {
  load(owner: string): Promise<SavedPreferences>;
  save(owner: string, revision: number, value: AccountPreferences): Promise<SavedPreferences>;
};
export type PreferencesView = {
  value: SavedPreferences; loaded: boolean; status: "loading" | "saved" | "unsaved" | "saving" | "error";
  error: string;
};
// An instance belongs to exactly one authenticated ID. Device storage is never
// an authority or fallback, and the server independently checks this owner ID.
export class AccountPreferencesController {
  private server = { ...DEFAULT_ACCOUNT_PREFERENCES };
  private pending: Partial<AccountPreferences> = {};
  private running = false;
  private active = true;
  private loaded = false;
  private reconcileRequired = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private status: PreferencesView["status"] = "loading";
  private error = "";
  constructor(private owner: string, private api: PreferencesApi,
    private current: () => boolean, private notify: (view: PreferencesView) => void) {}
  view(): PreferencesView { return { value: {...this.server,...this.pending}, loaded:this.loaded,status:this.status,error:this.error }; }
  private live() { return this.active && this.current(); }
  private emit() { if(this.live())this.notify(this.view()); }
  async load() {
    if(!this.live())return;
    this.status="loading";this.emit();
    try {
      const result=parseAccountPreferences(await this.api.load(this.owner));
      if(!this.live())return;
      this.server=result;this.loaded=true;this.reconcileRequired=false;
      for(const key of fields)if(this.pending[key]===result[key])delete this.pending[key];
      this.status=Object.keys(this.pending).length?"unsaved":"saved";this.error="";this.emit();
    }catch { if(this.live()){this.status="error";this.error="Account settings could not be loaded. Your saved settings were not replaced.";this.emit();} }
  }
  patch(changes: Partial<AccountPreferences>) {
    if(!this.live())return;
    if(!this.loaded){this.status="error";this.error="Load account settings before changing them.";this.emit();return;}
    const validated=parseAccountPreferences({...this.server,...this.pending,...changes});
    for(const key of fields)if(Object.hasOwn(changes,key))Object.assign(this.pending,{[key]:validated[key]});
    this.status="unsaved";this.error="";this.emit();
    clearTimeout(this.timer);this.timer=setTimeout(()=>void this.flush(),200);
  }
  async flush() {
    clearTimeout(this.timer);
    if(!this.live()||this.running)return;
    if(!this.loaded||this.status==="error"||this.reconcileRequired)await this.load();
    if(!this.live()||!this.loaded||this.status==="error")return;
    this.running=true;
    try {
      while(this.live()&&Object.keys(this.pending).length){
        const submitted={...this.pending};
        const next={...this.server,...submitted};
        this.status="saving";this.emit();
        const saved=parseAccountPreferences(await this.api.save(this.owner,this.server.revision,next));
        if(!this.live())return;
        if(saved.revision!==this.server.revision+1 || fields.some(k=>saved[k]!==next[k]))throw new Error("Save was not confirmed.");
        this.server=saved;
        for(const key of fields)if(Object.hasOwn(submitted,key)&&this.pending[key]===submitted[key])delete this.pending[key];
      }
      this.status="saved";this.error="";this.emit();
    }catch {
      if(this.live()){this.reconcileRequired=true;this.status="error";this.error="Settings are not confirmed saved to your account. Retry to check the saved copy; your changes are still in this tab.";this.emit();}
    }finally{this.running=false;}
  }
  close(){this.active=false;clearTimeout(this.timer);}
}
