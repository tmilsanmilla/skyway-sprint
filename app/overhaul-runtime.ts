import { overhaulCharacter, OVERHAUL_CHARACTERS } from "./overhaul-catalog.ts";
import { overhaulDamage, overhaulModifiers, type OverhaulContext, type OverhaulCounters, type OverhaulTimers, type OverhaulHazard } from "./overhaul-passives.ts";
import { challengeInteger, freshEuchreDeck, shuffled, appendImaginationColors, initialGambitRoll, wildcardChoiceCount, gambitRevival, takeWildcard, createProdigyQuestion, type ChallengeRandom, type EuchreCard } from "./overhaul-challenges.ts";
import {getGemStreakMultiplier} from "./gem-streak-rules.ts";
import { SONG_CLIPS } from "./overhaul-song-library.ts";
import { tempoResult } from "./overhaul-passives.ts";

export type OverhaulEffect =
  | { type: "score" | "gems" | "stardust" | "coins" | "heal" | "damage"; amount: number; reason?: string }
  | { type: "health"; hp: number; maxHp?: number }
  | { type: "move"; lane: number }
  | { type: "network-items"; action:string; values:Record<string,unknown> }
  | { type: "clear"; ids?: number[]; lanes?: number[]; kinds?: string[]; count?: number }
  | { type: "reposition-items" }
  | { type: "collect"; kinds: string[] }
  | { type: "transform"; ids?: number[]; from?: string[]; to: string; excludeLane?: number }
  | { type: "stop-items"; ids: number[]; seconds: number }
  | { type: "opponent"; action: string; values?: Record<string, number | string> }
  | { type: "notice"; text: string }
  | { type: "gem-streak-reset" }
  | { type: "music"; track: "energetic" | "normal" | "phoenix" }
  | { type: "finish"; reason: string }
  | { type: "challenge"; kind: OverhaulChallengeKind; data?: Record<string, unknown>; restored?:boolean }
  | { type: "form"; key: string; hp: number; maxHp: number; noHealing?: boolean };
export type OverhaulChallengeKind = "tempo" | "pulse" | "gambit" | "imagination" | "bowling" | "math" | "language" | "conic" | "drawing" | "void" | "hades-keys" | "hades-targets" | "oracle" | "echo-passives" | "pacer" | "muse" | "mimic" | "lantern" | "adaptation" | "cartographer-map" | "wildcard" | "zenith-stop";
export type OverhaulItemKind="pumpkin"|"gem"|"coin"|"melon"|"mushroom"|"car"|"log"|"snowflake"|"current"|"rock"|"barrel"|"spikes"|"vortex";
export interface OverhaulItem {
  id: number; kind: OverhaulItemKind; lane: number; y: number; disabled?: boolean;
  special?: "hologram" | "disguise-hologram" | "disguise-hazard" | "pressurized" | "ash-log" | "ash-barrel" | "streak-ender" | "bagel";
  stoppedUntil?: number; accelerated?: boolean;
}
type Options = { key: string; owned: readonly string[]; online: boolean; laneCount: number; map?: string; opponentKey?: string; legalKeys?: readonly string[]; random?: ChallengeRandom;initialWave?:number };
const HAZARDS = new Set(["barrel", "log", "spikes", "rock", "car", "snowflake", "vortex", "current", "pumpkin"]);
const BASIC_HAZARDS = ["barrel", "log", "spikes", "rock", "car"];

/** One instance belongs to one original run, never an account or module singleton.
 * The host owns HP/network/account persistence. Effects are drained once after
 * each event; no event performs I/O, starts timers or changes account balances. */
export class OverhaulRuntime {
  readonly random: ChallengeRandom;
  readonly owned: ReadonlySet<string>;
  readonly online: boolean;
  readonly originalKey: string;
  readonly opponentName: string;
  readonly opponentKey: string;
  readonly map: string;
  private behaviorRootKey: string;
  readonly songOrder: number[];
  secondLane = 1;
  key: string;
  wave = 1;
  elapsed = 0;
  waveElapsed = 0;
  lane = 1;
  laneCount: number;
  hp = 3;
  maxHp = 3;
  lastMoveAt = 0;
  counters: OverhaulCounters = {};
  timers: OverhaulTimers = {};
  cooldowns: Record<string, number> = {};
  history: Array<{ at: number; lane: number }> = [];
  cards: EuchreCard[] = [];
  heldCards: EuchreCard[] = [];
  memory: number[] = [];
  eclipseOrder: number[] = [];
  usedClasses: string[] = [];
  borrowed: string[] = [];
  seededKind: string | null = null;
  selectedHazards: number[] = [];
  lastAsh: string | null = null;
  phase: OverhaulChallengeKind | null = null;
  challengeId = 0;
  challengeData: Record<string, unknown> = {};
  private phaseQueue: Array<{kind: OverhaulChallengeKind; data?: Record<string, unknown>}> = [];
  private effects: OverhaulEffect[] = [];
  private grazed = new Set<number>();
  private ghostContacts = new Set<number>();
  private deliveries = new Set<string>();
  interference: {id:string;shape:number;retryAt:number}|null=null;
  duck: {id:string;key:"b"|"p";until:number;done:boolean}|null=null;
  networkPaused=false;
  cloakPopup:string|null=null;
  receive(id:string,action:string,values:Record<string,unknown>,seconds:number){
    if(this.closed||this.deliveries.has(id))return false;this.deliveries.add(id);
    const duration=Math.max(0,Math.min(300,seconds));
    if(action==="conic-check")this.interference={id,shape:Math.max(0,Math.min(9,Number(values.shape)||0)),retryAt:0};
    else if(action==="pterodactyl"||action==="infinity")this.duck={id,key:action==="infinity"?"p":"b",until:this.elapsed+duration,done:false};
    else if(action==="language")this.openChallenge("language",{clip:Number(values.clip),opponent:true});
    else if(action==="cloak")this.cloakPopup=id;
    else if(action==="vial")this.timers.vial=this.elapsed+duration;
    else if(action==="mirage"){const lane=Number(values.lane);if(Number.isInteger(lane)&&lane>=0&&lane<this.laneCount)this.emit({type:"move",lane});}
    else if(action==="handflipper"||action==="wildcard-confuse"){this.counters.confuse=Number(values.percent)||10;this.timers.confuse=this.elapsed+duration;}
    else if(action==="wildcard-delay"){this.counters.networkDelay=Math.min(.16,Math.max(0,Number(values.seconds)||0));}
    else if(action==="coin-override"||action==="wildcard-melon")this.counters[action]=Math.max(0,Math.min(27,Number(values.percent)||0));
    else if(action==="spiral")this.timers.networkSpiral=this.elapsed+duration;
    else if(action==="chip")this.timers.networkChip=this.elapsed+duration;
    else if(action==="flicker"||action==="potato"||action==="streaker"||action==="echo-reflective")this.timers[action]=this.elapsed+duration;
    else if(action==="echo-health"){this.counters.echoPreviousMax=this.maxHp;this.maxHp=10;this.hp=10;this.timers.echoHealth=this.elapsed+duration;this.emit({type:"health",hp:10,maxHp:10});}
    else if(action==="echo-damage")this.emit({type:"damage",amount:Math.min(7,Math.max(0,Number(values.amount)||0)),reason:"MIRROR REFLECTION"});
    else if(action==="stun")this.timers.networkLock=this.elapsed+duration;
    else if(action==="score")this.emit({type:"score",amount:Number(values.amount)||0});
    else if(action==="hyperlink"||action==="quantum-gravity"||action==="spawn"||action==="flat-tire"||action==="wildcard-jack"||action==="wildcard-club"||action==="echo-final-row")this.emit({type:"network-items",action,values});
    return true;
  }
  answerInterference(answer:number,now:number){
    const q=this.interference;if(!q||now<q.retryAt)return false;
    this.emit({type:"opponent",action:"conic-answer",values:{event:q.id,answer}});
    if(answer===q.shape){this.interference=null;return true;}q.retryAt=now+1;return false;
  }
  private closed = false;

  constructor(options: Options) {
    this.originalKey = this.key = this.behaviorRootKey = options.key;
    this.songOrder = shuffled(SONG_CLIPS.map((_,i)=>i),options.random||Math.random);
    this.owned = new Set(options.owned); this.online = options.online;
    this.opponentName = overhaulCharacter(options.opponentKey || "")?.name || "";
    this.opponentKey = options.opponentKey || "";
    this.map=options.map||"classic";
    this.laneCount = Math.max(2, options.laneCount); this.lane = Math.floor(this.laneCount / 2);
    this.random = options.random || Math.random;
    const definition = overhaulCharacter(this.key);
    this.hp = definition?.startingHp ?? 3; this.maxHp = definition?.maxHp ?? 3;
    this.counters = { ownsSprint: Number(this.owned.has("runner_sprint")), ownsCourier: Number(this.owned.has("runner_courier")), beaconLit: 0, mathScore: 1, tempoSpeed: 1, tempoScore: 1, prism: 0, shape: -1 };
    if (this.name === "Snake") {
      const legal = OVERHAUL_CHARACTERS.filter(c => c.name !== "Snake" && (!options.legalKeys || options.legalKeys.includes(c.key)));
      if (legal.length) this.setForm(legal[challengeInteger(this.random, legal.length)].key);
    }
    if (this.name === "Mimic" && this.online) {
      if (this.owned.has(this.opponentKey)) this.setForm(this.opponentKey);
      else this.counters.copyUnavailable=1;
    }
    this.behaviorRootKey=this.key;
    if (["Muse", "Mimic"].includes(this.name) && !(this.name==="Mimic"&&this.online)) this.openChallenge(this.name.toLowerCase() as "muse" | "mimic");
    if(this.name==="Wildcard")this.cards=freshEuchreDeck(this.random);
    if(this.name==="Eclipse")this.eclipseOrder=shuffled([1,2,3,4],this.random);
    if ((this.originalName === "Polyglot" && ["Polyglot","Prodigy"].includes(this.opponentName)) || this.originalName === "Prodigy" && this.opponentName === "Polyglot") this.setForm("trickster_rogue",1,1);
    this.beginWave(options.initialWave||1);
  }
  get name() { return overhaulCharacter(this.key)?.name || "Ace"; }
  get behaviorRootName() { return overhaulCharacter(this.behaviorRootKey)?.name || this.name; }
  hasPassive(name:string){return this.name===name||this.borrowed.some(key=>overhaulCharacter(key)?.name===name);}
  get ghostLane(){const at=this.elapsed-3;return [...this.history].reverse().find(entry=>entry.at<=at)?.lane??Math.floor(this.laneCount/2);}
  get split(){return this.name==="Conic"&&this.counters.shape===3;}
  moveSecond(direction:-1|1){if(!this.split||this.closed||this.phase||this.active("moveLock"))return false;this.secondLane=Math.max(0,Math.min(this.laneCount-1,this.secondLane+direction));return true;}
  get originalName() { return overhaulCharacter(this.originalKey)?.name || "Ace"; }
  get context(): OverhaulContext {
    return { name: this.name, wave: this.wave, hp: this.hp, maxHp: this.maxHp, lane: this.lane, laneCount: this.laneCount, online: this.online,
      elapsed: this.elapsed, waveElapsed: this.waveElapsed, sinceLaneChange: this.elapsed - this.lastMoveAt,
      counters: this.counters, timers: this.timers, opponentName: this.opponentName,
      form: this.name === "Conic" ? ["spikes","log","rock","car"][this.counters.focusIndex || 0] : this.counters.passedBaton ? this.key : undefined };
  }
  modifiers() {
    const modifiers = overhaulModifiers(this.context);
    if (this.behaviorRootName === "Muse") modifiers.score *= this.name === "Muse" ? 1 : 0.95;
    if (this.counters.secondLife) {
      modifiers.speed *= this.behaviorRootName === "Weaver" ? 2 : this.behaviorRootName === "Challenger" ? 1.5 : 1;
      modifiers.canHeal = false;
    }
    for (const key of this.borrowed) {
      const name = overhaulCharacter(key)?.name; if (!name) continue;
      const passive = overhaulModifiers({ ...this.context, name });
      modifiers.score *= passive.score; modifiers.speed *= passive.speed;
      modifiers.damage *= passive.damage; modifiers.pickupSpeed *= passive.pickupSpeed;
      modifiers.hazardSpeed *= passive.hazardSpeed; modifiers.xp*=passive.xp;
      modifiers.waveHeal=Math.max(modifiers.waveHeal,passive.waveHeal);
      modifiers.invincible ||= passive.invincible;modifiers.canHeal &&= passive.canHeal;
      modifiers.snowflakeSeconds=Math.min(modifiers.snowflakeSeconds,passive.snowflakeSeconds);
    }
    if(this.name==="Zenith"){
      if(this.wave>=5){modifiers.speed*=1.06;modifiers.score*=1.06;}
      if(this.wave>=7)modifiers.snowflakeSeconds=0;
      if(this.wave>=11){const reactor=overhaulModifiers({...this.context,name:"Reactor"});modifiers.speed*=reactor.speed;modifiers.score*=reactor.score;}
    }
    if(this.active("zenithDash"))modifiers.speed*=1.5;
    if(this.active("networkChip"))modifiers.damage*=.3;
    modifiers.inputDelay+=this.counters.networkDelay||0;
    return modifiers;
  }
  drain(): OverhaulEffect[] { const effects = this.effects; this.effects = []; return effects; }
  emit(effect: OverhaulEffect) { if (!this.closed) this.effects.push(effect); }
  close() { this.closed = true; this.effects = []; this.phase = null; this.phaseQueue=[]; }
  count(key: string, amount = 1) { this.counters[key] = (this.counters[key] || 0) + amount; return this.counters[key]; }
  active(key: string) { return (this.timers[key] || 0) > this.elapsed; }
  ready(key: string, seconds: number) {
    if ((this.cooldowns[key] || 0) > this.elapsed) return false;
    this.cooldowns[key] = this.elapsed + seconds; return true;
  }
  openChallenge(kind: OverhaulChallengeKind, data?: Record<string, unknown>) {
    if (this.closed) return false;
    if (this.phase) { this.phaseQueue.push({kind, data}); return true; }
    this.phase = kind;
    this.challengeId += 1;
    this.challengeData = data || (kind === "math" ? createProdigyQuestion(this.random) : {});
    this.emit({ type: "challenge", kind, data: this.challengeData }); return true;
  }
  setForm(key: string, hp?: number, maxHp?: number, noHealing = false) {
    const form = overhaulCharacter(key); if (!form) return false;
    const changed=this.key!==key;this.key = key; this.hp = hp ?? form.startingHp; this.maxHp = maxHp ?? form.maxHp;
    if(changed){if(form.name==="Wildcard")this.cards=freshEuchreDeck(this.random);if(form.name==="Eclipse")this.eclipseOrder=shuffled([1,2,3,4],this.random);}
    this.emit({ type: "form", key, hp: this.hp, maxHp: this.maxHp, noHealing }); return true;
  }
  synchronize(hp: number, maxHp: number, lane: number, laneCount = this.laneCount) {
    if (Number.isFinite(hp)) this.hp = Math.max(0, hp);
    if (maxHp > 0) this.maxHp = maxHp;
    this.lane = Math.max(0, Math.min(laneCount - 1, lane)); this.laneCount = laneCount;
  }
  tick(seconds: number) {
    if (this.closed || this.phase || this.networkPaused || !Number.isFinite(seconds) || seconds <= 0) return;
    const before = this.elapsed; this.elapsed += seconds; this.waveElapsed += seconds;
    if(this.duck&&!this.duck.done&&this.elapsed>=this.duck.until){this.duck.done=true;this.emit({type:"finish",reason:"PTERODACTYL · DUCK MISSED"});}
    if(this.active("networkSpiral")){const steps=Math.floor(this.elapsed/.2)-Math.floor(before/.2);for(let i=0;i<steps;i++)if(this.random()<.05){this.lane=this.lane===0?1:this.lane===this.laneCount-1?this.lane-1:this.lane+(this.random()<.5?-1:1);this.emit({type:"move",lane:this.lane});}}

    if (this.counters.brewingPotion && !this.active("brewing")) { this.counters.potion = this.counters.brewingPotion; this.counters.brewingPotion = 0; }
    if (this.counters.stoneBrewing && !this.active("stoneBrewing")) { this.counters.stone = 1; this.counters.stoneBrewing = 0; }
    if (this.name === "Echo" && this.counters.echoQuest===6 && this.hp <= 0.5) this.counters.knowingLow = 1;
    this.checkEchoQuest();
    if(this.counters.echoPreviousMax&&this.elapsed>=(this.timers.echoHealth||0)){this.maxHp=this.counters.echoPreviousMax;this.counters.echoPreviousMax=0;this.emit({type:"health",hp:Math.min(this.hp,this.maxHp),maxHp:this.maxHp});}
    if (this.counters.reflectiveEnd && this.elapsed >= this.counters.reflectiveEnd) {
      this.counters.reflectiveEnd = 0; this.emit({type:"opponent", action:"echo-final-row"}); this.emit({type:"finish", reason:"THE MIRROR FADED"});
    }
    for (const [clock, action] of [["nineSpadesAt", "collect-all"], ["aceSpadesAt", this.online ? "mirage" : "collect-fruit"]] as const) {
      if (this.counters[clock] > 0 && this.elapsed >= this.counters[clock]) {
        this.counters[clock] = 0;
        if (action === "mirage") this.emit({type:"opponent", action});
        else { this.emit({type:"collect",kinds:clock === "nineSpadesAt" ? ["gem","melon","coin"] : ["gem","melon"]}); if (clock === "nineSpadesAt") this.emit({type:"heal",amount:0.5}); }
      }
    }
    if (this.active("bagel")) {
      const steps = Math.floor(this.elapsed / 0.3) - Math.floor(before / 0.3);
      for (let i=0;i<steps;i++) if (this.random()<0.15) {
        const direction = this.lane === 0 ? 1 : this.lane === this.laneCount - 1 ? -1 : this.random()<0.5 ? -1 : 1;
        this.lane += direction; this.emit({type:"move", lane:this.lane});
      }
    }
    if (this.name === "Velocity") {
      const old = this.counters.velocity || 0; this.counters.velocity = Math.min(100, old + seconds);
      if (old < 50 && this.counters.velocity >= 50) this.emit({ type: "music", track: "energetic" });
    }
    if (this.name === "Spring") {this.count("energy",Math.floor(this.elapsed)-Math.floor(before));if(this.online)this.counters.energy=Math.min(200,this.counters.energy);}
    if (this.name === "Rhythm" && this.elapsed - this.lastMoveAt > 1.2) this.counters.rhythm = 0;
    if (this.name === "Pacer" && this.elapsed >= 10 && !this.counters.passedBaton) this.openChallenge("pacer");
    if (this.name === "Atlas" && this.elapsed - this.lastMoveAt >= Math.max(1, 10 - (this.counters.damagingHits || 0))) {
      this.lastMoveAt = this.elapsed; this.emit({ type: "damage", amount: 2, reason: "SKY CRUSH" });
    }
    if (this.name === "Carat" && this.active("pterodactyl")) this.counters.flight = 1; else if (this.name === "Carat") this.counters.flight = 0;
    if (this.name === "Cloak" && this.online && this.waveElapsed >= this.counters.cloakAt && !this.counters.cloakSent) {
      this.counters.cloakSent = 1; this.emit({ type: "opponent", action: "cloak", values: { wave: this.wave } });
    }
    if (this.name === "Pterodactyl" && this.online && this.waveElapsed >= this.counters.pteroAt && !this.counters.pteroSent) {
      this.counters.pteroSent = 1; this.emit({ type: "opponent", action: "pterodactyl", values: { wave: this.wave, warning: 3 } });
    }
    if (this.name === "Conic" && this.counters.shape === 7 && this.waveElapsed >= this.counters.lemonAt && !this.counters.lemonDone) {
      this.counters.lemonDone = 1; this.timers.lemon = this.elapsed + 5;
    }
  }
  beginWave(wave: number) {
    if(this.wave>0&&wave>this.wave){this.counters.citadelFlawless=this.counters.waveHits?0:(this.counters.citadelFlawless||0)+1;}
    this.counters.citadelBlocks=Math.max(1,Math.min(3,this.counters.citadelFlawless||0));
    const totals=BASIC_HAZARDS.map((kind,i)=>({i,value:this.counters["sentinelDamage:"+kind]||0})),highest=Math.max(0,...totals.map(t=>t.value));
    const tied=totals.filter(t=>t.value===highest);this.counters.sentinelAnalyzed=highest>0?tied[challengeInteger(this.random,tied.length)].i+1:0;this.counters.sentinelBlocked=0;
    this.wave = Math.max(1, Math.floor(wave)); this.waveElapsed = 0;
    this.counters.waveHits = this.counters.waveHazardHits = this.counters.waveSnowflakes = this.counters.waveMelons = this.counters.waveHooks = this.counters.waveCoins = this.counters.waveBloom = 0;
    this.seededKind = null; this.counters.pteroSent = this.counters.cloakSent = this.counters.lemonDone = this.counters.bishopVortex = 0;
    this.grazed.clear();
    this.counters.cloakAt = 5 + this.random() * 30; this.counters.pteroAt = 5 + this.random() * 27;
    this.counters.lemonAt = 5 + this.random() * 25;
    if (this.name === "Jester") {
      const roll = this.random(); this.counters.jesterKind = roll < 0.4 ? 1 : roll < 0.8 ? 2 : 3;
      if (this.counters.jesterKind === 2) { const index = challengeInteger(this.random, 45); this.counters.jesterPercent = index < 10 ? index - 10 : index - 9; }
      if (this.online && this.counters.jesterKind !== 1) this.emit({ type: "opponent", action: "give-score", values: { amount: this.counters.jesterKind === 2 ? 500 : 1000 } });
    }
    if (this.name === "Prism") this.counters.prism = (wave - 1) % 3;
    if (this.name === "Eclipse") {
      this.counters.eclipse = wave <= 16 && wave % 4 === 0 ? this.eclipseOrder[wave / 4 - 1] : 0;
      if (this.counters.eclipse === 1) this.emit({ type: "health", hp: 1 });
    }
    if (this.name === "Conic") {
      const previous = this.counters.shape, value = challengeInteger(this.random, previous >= 0 ? 9 : 10);
      this.counters.shape = previous >= 0 && value >= previous ? value + 1 : value;
      this.counters.focusIndex = challengeInteger(this.random, 4);
      if(this.counters.shape===3)this.secondLane=this.lane;
      if (this.counters.shape === 8) { this.count("potatoWaves"); if (this.online) this.emit({type:"opponent", action:"potato"}); }
      if (this.counters.shape === 5 && this.online) this.emit({type:"opponent", action:"infinity", values:{at:5+this.random()*29, warning:1}});
      if (this.counters.shape === 9) { this.counters.chipEver=1; if (this.online) this.emit({type:"opponent", action:"chip", values:{at:5+this.random()*25,seconds:5}}); }
    }
    if (this.name === "Zenith" && wave === 15 && !this.counters.zenithTimeStop) {
      this.counters.zenithTimeStop=1; this.emit({type:"score",amount:15000}); this.openChallenge("zenith-stop",{seconds:10});
    }
  }
  move(lane: number) {
    if (this.closed || this.phase || lane === this.lane || lane < 0 || lane >= this.laneCount) return false;
    if (this.cloakPopup || this.interference || this.name === "Balm" || this.active("moveLock") || this.active("networkLock")) return false;
    const previousLane = this.lane, gap = this.elapsed - this.lastMoveAt;
    this.lane = lane; this.lastMoveAt = this.elapsed;
    this.count("moves"); this.count("drift");
    const entry = { at: this.elapsed, lane };
    if (this.history.at(-1)?.at === this.elapsed) this.history[this.history.length - 1] = entry; else this.history.push(entry);
    while (this.history.length > 1 && this.history[1].at < this.elapsed - 3) this.history.shift();
    if ((this.hasPassive("Stride")||this.name==="Zenith"&&this.wave>=13) && this.counters.moves % 4 === 0) this.shield(0.05, 0.3, true);
    if (this.hasPassive("Switch") && this.counters.moves >= 100) this.shield(0.1, 0.4 / (1 + (this.wave - 1) * 0.2));
    if (this.name === "Rhythm") this.counters.rhythm = gap >= 0.8 && gap <= 1.2 ? (this.counters.rhythm || 0) + 1 : 0;
    if (this.name === "Kitty" && this.random() < 0.03) this.emit({ type: "damage", amount: 0.5, reason: "KITTY TURN" });
    if (this.name === "Engineer") this.emit({ type: "score", amount: 25 });
    return previousLane !== lane;
  }
  requestMove(direction: -1 | 1, input: "keyboard" | "touch" = "keyboard") {
    if(this.active("confuse")&&this.random()<(this.counters.confuse||0)/100)direction=direction===1?-1:1;
    if(this.name==="Eclipse"&&this.counters.eclipse===4)direction=direction===1?-1:1;
    if (this.name === "Figment" && input === "touch") direction = direction === 1 ? -1 : 1;
    let lane = this.lane + direction;
    const wraps = this.hasPassive("Orbit") || this.hasPassive("Nurse") || this.name === "Zenith" && this.wave >= 9;
    if (lane < 0 || lane >= this.laneCount) {
      if (!wraps || !this.ready("wrap", this.hasPassive("Orbit") ? 6 : 9)) return null;
      lane = lane < 0 ? this.laneCount - 1 : 0;
      if (this.hasPassive("Nurse") && this.random() < 0.25) this.emit({ type: "damage", amount: 0.5, reason: "NURSE WRAP" });
    }
    return this.move(lane) ? lane : null;
  }
  shield(delay: number, duration: number, lock = false) {
    this.timers.phaseWindup = this.elapsed + delay;
    this.timers.phaseInvincible = this.elapsed + delay + duration;
    if (lock) this.timers.moveLock = this.elapsed + delay + duration;
  }
  nearDodge(item: OverhaulItem) {
    if (this.grazed.has(item.id)) return;
    this.grazed.add(item.id);
    if (this.hasPassive("Frontline") && HAZARDS.has(item.kind) && item.y >= 50 && item.y < 65) this.count("closeDodges");
    if (this.hasPassive("Rogue") && !this.active("grazeCooldown")) { this.counters.grazes = Math.min(12, (this.counters.grazes || 0) + 1); this.timers.grazeCooldown=this.elapsed+5; }
  }
  chooseHook(lane: number) {
    if (!this.counters.hookArmed || !Number.isInteger(lane) || lane < 0 || lane >= this.laneCount || lane === this.lane) return false;
    this.counters.hookArmed = 0; this.count("waveHooks");
    this.lane = lane; this.lastMoveAt = this.elapsed;
    this.emit({ type: "move", lane }); return true;
  }
  activate(key: string, items: readonly OverhaulItem[] = []) {
    const e=key.toLowerCase();
    if(this.closed||this.interference)return false;
    if(this.cloakPopup&&e==="l"){this.emit({type:"opponent",action:"ack",values:{event:this.cloakPopup}});this.cloakPopup=null;return true;}
    if(this.cloakPopup||this.active("networkLock"))return false;
    if(this.duck&&!this.duck.done&&e===this.duck.key&&this.elapsed<this.duck.until){this.duck.done=true;this.emit({type:"opponent",action:"duck",values:{event:this.duck.id,key:e}});return true;}
    if(this.phase)return false;
    const name=this.name;
    if (name === "Sprint" && ["w", "e"].includes(e)) {
      const lane = this.lane + (e === "w" ? -2 : 2);
      if (lane < 0 || lane >= this.laneCount || !this.ready("sprint", 10)) return false;
      this.lane = lane; this.lastMoveAt = this.elapsed; this.count("moves"); this.emit({ type: "move", lane }); return true;
    }
    if (name === "Tonic" && ["1", "2", "3", "4"].includes(e)) {
      if (this.counters.potion || this.active("brewing") || this.counters.brewingPotion) return false;
      const amount = Number(e), price = [0, 12, 20, 25, 30][amount];
      if ((this.counters.ingredients || 0) < price) return false;
      this.count("ingredients", -price); this.counters.brewingPotion = amount;
      this.timers.brewing = this.elapsed + 15; return true;
    }
    if (name === "Streaker" && e === "e") {
      if (this.wave % 2 || this.counters.burstWave === this.wave) return false;
      this.counters.burstWave = this.wave; this.emit({ type: "score", amount: (this.online ? 9 : 14) * (this.counters.flawlessTotal || 0) ** 3 });
      this.timers.streakTrail = this.elapsed + 2;
      if (this.online) this.emit({ type: "opponent", action: "streaker", values: { wave: this.wave } });
      return true;
    }
    if (name === "Hex" && e === "r") {
      const target = items.filter(item => item.lane === this.lane && HAZARDS.has(item.kind)).sort((a, b) => b.y - a.y)[0];
      if (!target || !this.ready("chakram", 35)) return false;
      this.emit({ type: "clear", ids: [target.id] }); return true;
    }
    if (name === "Handflipper" && e === "r" && this.online && this.ready("handflip-confuse", 25)) {
      this.emit({ type: "opponent", action: "handflipper" }); return true;
    }
    if (name === "Hyperlink" && ["1", "2", "3", "e"].includes(e)) {
      const choice = e === "e" ? 1 : Number(e), cost = [0, 10, 15, 20][choice];
      if ((this.counters.links || 0) < cost || choice === 2 && !this.online) return false;
      if (choice === 3 && !items.some(item => HAZARDS.has(item.kind))) return false;
      this.count("links", -cost);
      if (choice === 1) this.timers.hyperFlight = this.elapsed + 5;
      if (choice === 2) this.emit({ type: "opponent", action: "hyperlink" });
      if (choice === 3) {
        const pool = items.filter(item => HAZARDS.has(item.kind)); const roll = this.random();
        this.emit({ type: "transform", ids: [pool[challengeInteger(this.random, pool.length)].id], to: roll < 0.4 ? "melon" : roll < 0.75 ? "coin" : "gem" });
      }
      return true;
    }
    if(e==="e"&&this.name==="Zenith"&&this.wave>=5){if(!this.ready("dash",5))return false;this.timers.zenithDash=this.elapsed+1;this.shield(0,.35);return true;}
    if (e !== "e") return false;
    switch (name) {
      case "Rogue": {
        const grazes=this.counters.grazes||0;
        if(grazes>=11){this.count("grazes",-11);this.shield(0,5,true);}
        else if(grazes>=5){this.count("grazes",-5);this.emit({type:"clear",kinds:[...HAZARDS]});}
        else if(grazes>=2){this.count("grazes",-2);this.shield(0,0.45);}
        else return false;
        return true;
      }
      case "Recruit": if (!this.ready("spear", 45)) return false; this.timers.spear = this.elapsed + 10; return true;
      case "Scout": if (!this.ready("scout", 30)) return false; this.counters.scoutSnowflake = 1; return true;
      case "Bishop": if(["volcano","meadow","skyway"].includes(this.map)||this.counters.bishopUsed)return false;this.counters.bishopUsed=1;this.emit({type:"heal",amount:this.maxHp});return true;
      case "Elixir": if (this.counters.elixirUsed) return false; this.counters.elixirUsed = 1; this.emit({ type: "heal", amount: this.maxHp }); return true;
      case "Mender": if (!this.counters.potions) return false; this.count("potions", -1); this.emit({ type: "heal", amount: 1 }); this.emit({ type: "score", amount: -500 }); return true;
      case "Reserve": if (!this.counters.reserve || this.hp >= this.maxHp) return false; this.counters.reserve = 0; this.emit({ type: "heal", amount: 0.5 }); return true;
      case "Tonic": {
        if (this.counters.brewingPotion && !this.active("brewing")) { this.counters.potion = this.counters.brewingPotion; this.counters.brewingPotion = 0; }
        if (!this.counters.potion) return false;
        this.emit({ type: "heal", amount: this.counters.potion }); this.counters.potion = 0; return true;
      }
      case "Sage": {
        if (this.counters.stoneBrewing && !this.active("stoneBrewing")) { this.counters.stone = 1; this.counters.stoneBrewing = 0; }
        if (this.counters.stone) {
          this.counters.stone = 0; this.emit({ type: "heal", amount: 0.5 }); this.timers.luck = this.elapsed + 15;
          this.cooldowns.stone = this.elapsed + 25; return true;
        }
        if (this.active("stoneBrewing") || (this.cooldowns.stone || 0) > this.elapsed) return false;
        if ((this.counters.herbs || 0) < 15) { this.emit({ type: "finish", reason: "NOT ENOUGH HERBS" }); return true; }
        this.counters.herbs = 0; this.counters.stoneBrewing = 1; this.timers.stoneBrewing = this.elapsed + 20; return true;
      }
      case "Sprout": {
        if (this.counters.seedWave === this.wave) return false;
        const target = items.filter(item => HAZARDS.has(item.kind) && item.y < 92).sort((a, b) => b.y - a.y)[0];
        if (!target) return false;
        this.counters.seedWave = this.wave; this.seededKind = target.kind;
        this.emit({ type: "notice", text: target.kind === "barrel" ? "BARRELS CANNOT BE SEEDED · USE SPENT" : `SEEDED ${target.kind.toUpperCase()} UNTIL WAVE END` }); return true;
      }
      case "Balm": case "Weaver": {
        const limit = name === "Balm" ? 2 : 1;
        if (name === "Weaver" && !this.counters.ownsCourier || (this.counters.waveHooks || 0) >= limit) return false;
        this.counters.hookArmed = 1; this.emit({ type: "notice", text: "CHOOSE A LANE FOR RESCUE HOOK" }); return true;
      }
      case "Jester": if (this.counters.jesterKind !== 3 || this.counters.waveHooks) return false; this.counters.hookArmed = 1; return true;
      case "Carat": {
        if (this.counters.pressurizedWave !== this.wave) { this.counters.pressurizedWave = this.wave; this.count("carbon", 5); }
        if ((this.counters.carbon || 0) < 2) return false;
        this.count("carbon", -2); this.timers.pterodactyl = Math.max(this.elapsed, this.timers.pterodactyl || 0) + 15; return true;
      }
      case "Gasser": this.counters.gas = this.counters.gas ? 0 : 1; return true;
      case "Vial": {
        if (this.online && this.opponentName === "Vial" || this.elapsed < (this.online ? 10 : 20) || !this.ready("vial", 80)) return false;
        if(!this.online)this.timers.vial = this.elapsed + 15; else this.emit({ type: "opponent", action: "vial" }); return true;
      }
      case "Flicker": {
        if(this.counters.flickerWave===this.wave)return false;this.counters.flickerWave=this.wave;
        const ids=Array.from({length:this.laneCount},(_,lane)=>lane===this.lane?null:items.filter(item=>item.lane===lane&&HAZARDS.has(item.kind)).sort((a,b)=>b.y-a.y)[0]?.id).filter((id):id is number=>id!=null);
        this.emit({type:"transform",ids,to:"random-pickup"});if(this.online)this.emit({type:"opponent",action:"flicker"});return true;
      }
      case "Mirage": {
        if (!this.ready("mirage", this.online ? 20 : 10)) return false;
        if (this.online) this.emit({ type: "opponent", action: "mirage" });
        else { const draw = challengeInteger(this.random, this.laneCount - 1); this.emit({ type: "move", lane: draw >= this.lane ? draw + 1 : draw }); }
        return true;
      }
      case "Handflipper": if (!this.ready("handflip", 15)) return false; this.emit({ type: "reposition-items" }); return true;
      case "Hex": {
        if (this.counters.god) {
          if (this.counters.retreatWave === this.wave) return false;
          this.counters.retreatWave = this.wave; this.timers.retreat = this.elapsed + 3; this.timers.godShield = this.elapsed + 13; return true;
        }
        if ((this.counters.damnation || 0) < 70 || this.counters.souls > 0) return false;
        this.count("damnation", -25); this.counters.souls = 2; return true;
      }
      case "Um": {
        if ((this.counters.ashes || 0) < 20) { this.emit({ type: "finish", reason: "THE URN IS NOT FULL" }); return true; }
        this.counters.ashes = 0;this.count("dispersals"); const hazards=items.filter(item=>HAZARDS.has(item.kind)); if(hazards.length)this.emit({ type: "clear", ids:[hazards[challengeInteger(this.random,hazards.length)].id] });
        this.emit({ type: "score", amount: 5000 }); this.emit({ type: "gems", amount: 1 }); return true;
      }
      case "Lantern": return this.openChallenge("lantern", { items: items.filter(item => HAZARDS.has(item.kind)) });
      case "Warrior": {
        if (!this.ready("cleave", 6)) return false;
        const target = items.filter(item => HAZARDS.has(item.kind) && item.lane === this.lane).sort((a, b) => b.y - a.y)[0];
        if (target) this.emit({ type: "clear", ids: [target.id] }); return true;
      }
      case "Hammer": {
        if (!this.ready("hammer", 15)) return false;
        const edge = this.lane === 0 || this.lane === this.laneCount - 1;
        const lanes = [this.lane - 1, this.lane + 1, ...(edge ? [this.lane] : [])].filter(lane => lane >= 0 && lane < this.laneCount);
        const ids = lanes.flatMap(lane => { const target = items.filter(item => HAZARDS.has(item.kind) && item.lane === lane).sort((a, b) => b.y - a.y)[0]; return target ? [target.id] : []; });
        this.emit({ type: "clear", ids }); return true;
      }
      case "Surveyor": if (!this.ready("survey", 20)) return false; this.counters.surveyLane = this.lane; this.timers.survey = Number.POSITIVE_INFINITY; return true;
      case "Conic": {
        if (this.online) this.emit({ type: "opponent", action: "conic-check" });
        if (this.counters.shape === 0 && this.ready("directrix", 10)) {
          if (this.lane === Math.floor(this.laneCount / 2) && this.laneCount % 2) this.shield(0, 2);
          else this.emit({ type: "move", lane: this.laneCount - 1 - this.lane });
        }
        if (this.counters.shape === 4 && this.ready("spiral", 40) && this.online) this.emit({ type: "opponent", action: "spiral" });
        if (this.counters.shape === 6 && this.waveElapsed >= 5 && this.ready("flat-tire", 15) && this.online) this.emit({ type: "opponent", action: "flat-tire" });
        return true;
      }
    }
    return false;
  }
  hit(source: OverhaulHazard, baseDamage: number, safeLanes: readonly number[] = []) {
    if (this.closed) return { damage: 0, ignored: true, melon: false };
    if (this.hasPassive("Phantom") && this.wave % 15 === 0) return { damage: 0, ignored: true, melon: true };
    if (this.hasPassive("Phantom") && this.wave % 5 === 0 && source !== "snowflake") {
      this.emit({ type: "heal", amount: 1 }); return { damage: 0, ignored: true, melon: false };
    }
    if(this.active("vial")){this.emit({type:"heal",amount:source==="snowflake"?1:baseDamage});return {damage:0,ignored:true,melon:false};}
    if(this.name==="Bishop"&&source==="vortex"&&["volcano","meadow"].includes(this.map)&&!this.counters.bishopVortex){this.counters.bishopVortex=1;this.emit({type:"heal",amount:1});return {damage:0,ignored:true,melon:false};}
    if(this.name==="Beacon"&&source==="vortex"&&!this.counters.beaconLit){this.emit({type:"heal",amount:.5});return {damage:0,ignored:true,melon:false};}
    const roll = this.random(), m = overhaulModifiers(this.context);
    const ignored = m.invincible || this.seededKind === source && source !== "barrel"
      || this.hasPassive("Mercy") && BASIC_HAZARDS.includes(source) && (this.counters.waveHazardHits || 0) < (this.wave <= 3 ? 2 : 1)
      || (this.hasPassive("Glacier")||this.name==="Zenith"&&this.wave>=7) && source === "snowflake"
      || this.hasPassive("Gauze") && (source==="vortex"||source==="snowflake"&&!this.counters.waveSnowflakes)
      || this.hasPassive("Ironclad") && source==="vortex";
    if (this.name === "Cloak" && roll < 0.05 && safeLanes.length) {
      this.emit({ type: "move", lane: safeLanes[challengeInteger(this.random, safeLanes.length)] });
      return { damage: 0, ignored: true, melon: false };
    }
    if (this.name === "Seraph" && (this.counters.seraphTeleports || 0) < 20 && safeLanes.length && roll < 1 - (this.counters.seraphTeleports || 0) * 0.05) {
      this.count("seraphTeleports"); this.emit({type:"move",lane:safeLanes[challengeInteger(this.random,safeLanes.length)]});
      return {damage:0,ignored:true,melon:false};
    }
    if (this.hasPassive("Scout") && source === "snowflake" && this.counters.scoutSnowflake) {
      this.counters.scoutSnowflake=0; this.emit({type:"heal",amount:0.5}); return {damage:0,ignored:true,melon:false};
    }
    if(this.name==="Vault"&&["spikes","log"].includes(source)&&this.counters.vaultWave!==this.wave){
      this.counters.vaultWave=this.wave;this.timers.vaultBoost=this.elapsed+1;return {damage:0,ignored:true,melon:false};
    }
    if (this.name === "Phoenix" && this.counters.flight && ["log","spikes"].includes(source)) {
      this.emit({type:"score",amount:100}); return {damage:0,ignored:true,melon:false};
    }
    let damage = ignored ? 0 : overhaulDamage(this.context, source, baseDamage, roll);
    if(this.name==="Echo"&&this.borrowed.some(key=>overhaulCharacter(key)?.name==="Citadel")&&BASIC_HAZARDS.includes(source)&&this.counters.citadelBlocks>0){this.count("citadelBlocks",-1);damage=0;}
    if(this.name==="Echo"&&this.borrowed.some(key=>overhaulCharacter(key)?.name==="Sentinel")&&BASIC_HAZARDS.includes(source)){
      const analyzed=this.counters.sentinelAnalyzed;
      if(analyzed===BASIC_HAZARDS.indexOf(source)+1){if(!this.counters.sentinelBlocked){damage=0;this.counters.sentinelBlocked=1;}else damage*=.5;}
      this.count("sentinelDamage:"+source,baseDamage);
    }
    if(this.name==="Echo"&&this.active("reflective")){if(damage>0)this.emit({type:"opponent",action:"echo-hit",values:{amount:Math.min(7,damage)}});return {damage:0,ignored:true,melon:false};}
    for(const key of this.borrowed){const n=overhaulCharacter(key)?.name;if(n&&baseDamage>0)damage*=overhaulDamage({...this.context,name:n},source,baseDamage,roll)/baseDamage;}
    if (this.name === "Hex" && this.counters.souls > 0) { this.count("souls", -1); damage = 0; }
    if(BASIC_HAZARDS.includes(source))this.count("waveHazardHits");
    if(damage>0)this.count("damagingHits");
    if(this.name==="Beacon"&&damage>0&&this.hp-damage>0&&this.hp-damage<=1&&!this.counters.beaconRescued&&!this.counters.beaconLit){this.counters.beaconLit=1;this.counters.beaconWaves=0;}
    if (!ignored) { this.count("hits"); this.count("waveHits"); this.count("damageTaken",damage); this.counters.flawlessStreak = this.counters.coinStreak = this.counters.gemStreak = this.counters.melonStreak = 0; }
    if (source === "snowflake") this.count("waveSnowflakes");
    if (this.name === "Drift") this.counters.drift = 0;
    if (this.name === "Velocity") this.counters.velocity = 0;
    if (this.name === "Spring") this.counters.energy = Math.floor((this.counters.energy || 0) * 0.85);
    if (this.hasPassive("Vault") && this.counters.waveHazardHits === 1) this.shield(0, 0.8);
    if (this.name === "Figment") this.shield(0.05, 0.15);
    if (this.hasPassive("Plow") && this.hp > damage) this.emit({ type: "clear", count: 1 });
    if (this.hasPassive("Plow") && source === "snowflake" && this.online && this.opponentName !== "Plow") this.emit({ type: "opponent", action: "spawn", values: { kind: "snowflake", amount: 1 } });
    if (damage > 0 && this.hasPassive("General") && ["barrel", "log", "spikes", "rock"].includes(source)) {
      const hits = this.count("adapt:" + source); if (hits >= 10) this.counters.firstAdaptation = 1;
      const complete = BASIC_HAZARDS.filter(kind => kind !== "car" && (this.counters["adapt:" + kind] || 0) >= 40 && !this.counters["sacrifice:" + kind]);
      if (complete.length >= 3 && !this.counters.sacrificed) this.openChallenge("adaptation", { choices: complete });
    }
    return { damage, ignored, melon: false };
  }
  decorate(item: OverhaulItem): OverhaulItem {
    const n = this.name, hazard = BASIC_HAZARDS.includes(item.kind), pickup = ["gem", "melon", "coin"].includes(item.kind), roll = this.random();
    if(item.kind==="melon"&&roll<(this.counters["wildcard-melon"]||0)/100)return {...item,kind:"spikes"};
    if(item.kind==="coin"&&roll<(this.counters["coin-override"]||0)/100)return {...item,kind:BASIC_HAZARDS[challengeInteger(this.random,BASIC_HAZARDS.length)] as OverhaulItemKind};
    if (n === "Sage" && hazard && this.active("luck"))return {...item,special:roll<.1?"hologram":undefined};
    if (n === "Sage" && hazard) return { ...item, special: roll < 0.09 ? "hologram" : roll < 0.1 ? "disguise-hologram" : roll < 0.19 ? "disguise-hazard" : undefined };
    if (n === "Polisher" && hazard && roll < 0.05) return { ...item, special: "pressurized" };
    if (n === "Juggernaut" && (pickup && roll < Math.min(0.27, (5 + 2 * (this.counters.bonusMaxHp || 0)) / 100) || hazard && roll < 0.05)) return { ...item, special: "streak-ender" };
    if (n === "Fortune" && hazard) {
      const gem = Math.min(0.15, Math.round((this.counters.gemStreak || 0) / 3 * 10) / 1000), melon = Math.min(0.1, (this.counters.flawlessStreak || 0) / 100);
      if (roll < gem) return { ...item, kind: "gem" };
      if (roll < gem + melon) return { ...item, kind: "melon" };
    }
    if (n === "Conic" && this.counters.shape === 4 && hazard && roll < 0.1) return { ...item, special: "bagel" };
    if(n==="Eclipse"&&this.counters.eclipse===3&&hazard&&roll<0.2)return {...item,kind:"melon"};
    return item;
  }
  specialContact(item: OverhaulItem) {
    if (item.special === "hologram" || item.special === "disguise-hologram") {
      this.count("herbs"); this.emit({ type: "heal", amount: 0.5 }); return true;
    }
    if (item.special === "streak-ender") {
      this.counters.bonusMaxHp = -1;
      this.emit({ type: "health", hp: Math.min(this.hp, 2), maxHp: 2 });
      this.emit({ type: "score", amount: -1000 }); this.emit({ type: "notice", text: "STREAK ENDED · MAX HP 2" }); return true;
    }
    if (item.special === "bagel") { this.timers.bagel = Math.max(this.elapsed, this.timers.bagel || 0) + 5; return true; }
    if (item.special === "ash-log" || item.special === "ash-barrel") {
      if (this.lastAsh === item.special) { this.emit({ type: "finish", reason: "ASH TYPES MUST ALTERNATE" }); return true; }
      this.lastAsh = item.special; this.count("ashes");this.count("totalAshes");
      this.emit({ type: "score", amount: Math.floor(370 + 70 * this.wave ** 1.7) }); return true;
    }
    return false;
  }
  pickup(kind: "gem" | "melon" | "coin", gemStreak = 1) {
    const name = this.name;
    const result = { gemCount: Math.max(1,getGemStreakMultiplier(gemStreak)), scoreMultiplier: 1, coinMultiplier: 1, scoreOverride: null as number | null, handled: false };
    if(kind==="gem"&&this.active("vial")){this.emit({type:"damage",amount:2,reason:"VIAL GEM COST"});result.handled=true;return result;}
    if (kind === "gem" && name === "Tempo" && this.counters.harmfulGems) {
      this.emit({ type: "damage", amount: 0.5, reason: "TEMPO PENALTY" }); result.handled = true; return result;
    }
    if (kind === "gem") {
      this.count("physicalGems"); this.counters.gemStreak = gemStreak;
      if (this.hasPassive("Burglar") && !this.online || this.hasPassive("Prospector")) result.gemCount = 2 * Math.max(1, gemStreak) - 1;
      if (name === "Tonic") this.count("ingredients", 4);
      if(name==="Spark")this.count("spark");
      if(name==="Vial")this.emit({type:"damage",amount:this.active("vial")?2:1,reason:"VIAL GEM COST"});
      if (this.hasPassive("Carat")) this.count("carbon");
      if (this.hasPassive("Engineer")) this.emit({ type: "stardust", amount: this.wave * result.gemCount });
      if (this.hasPassive("Warrior")) this.emit({ type: "score", amount: this.wave ** 3 * result.gemCount ** 2 });
      if (this.hasPassive("Bloom") && !this.counters.waveBloom) { this.counters.waveBloom = 1; this.emit({ type: "heal", amount: 0.5 }); }
      if (this.hasPassive("Prospector") && this.online && this.opponentName !== "Prospector" && this.random() < 0.15) this.emit({ type: "opponent", action: "quantum-gravity" });
      if (name === "Hyperlink") this.count("links");
      if (name === "Wildcard") this.emit({ type: "stardust", amount: (this.counters.tens || 0) * 10 });
    } else if (kind === "melon") {
      this.count("melons"); this.count("waveMelons"); this.count("melonStreak");
      if (name === "Tonic") this.count("ingredients", 3);
      if (name === "Sage") this.count("herbs", this.counters.melonStreak);
      if (this.hasPassive("Melonhead")) result.scoreMultiplier *= this.counters.melonStreak;
      if (name === "Pacer") this.emit({ type: "heal", amount: 0.5 });
      if (this.hasPassive("Brace") && this.counters.waveMelons >= 3) this.emit({ type: "finish", reason: "BRACES BROKE · THIRD MELON" });
      if (name === "Muncher" && this.waveElapsed >= 17.5 && this.waveElapsed < 22.5) result.scoreMultiplier *= 3.5;
      if (name === "Challenger" && this.online) result.scoreMultiplier *= 0.5;
      if (name === "Conic" && this.counters.shape === 3) result.scoreMultiplier *= 0.85;
      if(name==="Eclipse"&&this.counters.eclipse===3)this.emit({type:"heal",amount:0.25});
      if (name === "Gambit" && this.counters.diceHand === 2 && this.counters.revived) result.scoreOverride = 50;
      if (this.hasPassive("Juggernaut")) {
        this.counters.bonusMaxHp = Math.min(11, (this.counters.bonusMaxHp || 0) + 0.5);
        this.emit({ type: "health", hp: this.hp, maxHp: 3 + this.counters.bonusMaxHp });
      }
      if (this.hasPassive("Courier")) this.timers.courier = this.elapsed + 4;
    } else {
      this.count("coinStreak"); this.count("waveCoins");
      if (name === "Challenger") result.coinMultiplier *= 2;
      if (this.hasPassive("Fortune") && this.online) this.emit({ type: "opponent", action: "coin-override", values: { percent: Math.min(20, this.counters.coinStreak) } });
    }
    if(this.hasPassive("Courier"))this.timers.courier=this.elapsed+4;
    if (name === "Surveyor" && this.lane === this.counters.surveyLane && this.active("survey")) {
      this.count("surveys"); this.emit({ type: "score", amount: 150 });
    }
    return result;
  }
  miss(kind: string) {
    if (kind === "gem") this.counters.gemStreak = 0;
    if (kind === "melon") this.counters.melonStreak = 0;
    if (kind === "coin") this.counters.coinStreak = 0;
  }
  paradoxContact(id:number,kind:string){if(this.name!=="Paradox"||this.ghostContacts.has(id))return false;this.ghostContacts.add(id);if(HAZARDS.has(kind)){if(this.random()<.45)this.emit({type:"heal",amount:.5});}else if(kind==="gem"||kind==="melon"){if(this.random()<.4)this.emit({type:"damage",amount:.5,reason:"PARADOX PICKUP"});this.counters.gemStreak=0;this.emit({type:"gem-streak-reset"});}return true;}
  currentPush() {if(this.name==="Bishop"&&this.map==="skyway"&&this.random()<.7)this.emit({type:"heal",amount:.5});}
  healed(amount: number, waveEnd = false) {
    if (amount <= 0) return;
    this.count("healed", amount); if (waveEnd) this.count("waveEndHealing", amount);
    if (this.counters.knowingLow && this.hp + amount >= this.maxHp) this.counters.knowingRecovered = 1;
  }
  waveEnd() {
    const healing = this.modifiers().canHeal ? this.modifiers().waveHeal : 0;
    const flawless = !this.counters.waveHits;
    if (flawless) { this.count("flawlessTotal"); this.count("flawlessStreak"); } else this.counters.flawlessStreak = 0;
    if (this.name === "Mender" && flawless) this.count("potions");
    if(this.name==="Reserve"&&this.hp>=this.maxHp)this.counters.reserve=1;
    if (this.name === "Relay" && flawless) {
      if (this.counters.revived){this.count("flawlessAfterRevive");this.emit({ type: "gems", amount: 1 });}
      else this.counters.relayBonus = Math.min(10, (this.counters.relayBonus || 0) + 1);
    }
    if (this.name === "Salve" && this.hp <= 1 && (this.counters.salveUses || 0) < 2) this.count("salveUses");
    if (this.name === "Beacon" && this.counters.beaconLit && this.count("beaconWaves") >= 3) {
      this.counters.beaconLit = 0; this.counters.beaconRescued=1; this.emit({ type: "health", hp: 4, maxHp: this.maxHp });
    }
    if (this.name === "Pickpocket" && this.online && this.opponentName !== "Pickpocket") this.emit({ type: "opponent", action: "pickpocket" });
    if (this.name === "Burglar" && this.online && this.opponentName !== "Burglar") this.emit({ type: "opponent", action: "burglar" });
    if (this.name === "Hyperlink") {
      const hits = this.counters.waveHits || 0;
      this.count("links", hits === 0 ? 10 : hits === 1 ? 8 : hits === 2 ? 7 : hits === 3 ? 6 : hits === 4 ? 5 : hits === 5 ? 4 : hits <= 7 ? 3 : hits <= 9 ? 2 : 1);
    }
    if (this.name === "Hex") this.openChallenge("void", { seconds: 20, lanes: 8, damned: 12 });
    else if (this.name === "Tempo") this.openChallenge("tempo");
    else if (this.name === "Imagination") { this.memory = appendImaginationColors(this.memory, this.random); this.openChallenge("imagination", { colors: this.memory }); }
    else if (this.name === "Bowler") this.openChallenge("bowling");
    else if (this.name === "Prodigy") this.openChallenge("math");
    else if (this.name === "Polyglot"){const clip=this.songOrder[(this.wave-1)%this.songOrder.length];this.openChallenge("language",{clip});if(this.online)this.emit({type:"opponent",action:"language",values:{clip,wave:this.wave}});}
    else if (this.name === "Conic" && !this.online) this.openChallenge("conic", { shape: this.counters.shape });
    else if (this.name === "Cartographer" && (!this.online || this.opponentName === "Cartographer") && this.wave % 2 === 0) this.openChallenge("drawing");
    else if (this.name === "Wildcard") {
      if (!this.cards.length) this.emit({ type: "finish", reason: "THE DECK IS EMPTY" });
      else this.openChallenge("wildcard", { cards: this.cards.slice(0, wildcardChoiceCount(this.cards.length)), automatic: this.cards.length <= 4 });
    }
    if (this.name === "Echo") this.checkEchoQuest();
    return { flawless, healing };
  }
  death(source: string) {
    if (this.closed) return false;
    if (this.behaviorRootName === "Muse") {
      if ((this.counters.museLives || 0) < 4) { this.count("museLives"); return this.openChallenge("muse"); }
      return false;
    }
    const name = this.name;
    if (this.hasPassive("Lifeline") && !this.counters.revived) {
      this.counters.revived = 1; this.counters.lifelineSource = BASIC_HAZARDS.indexOf(source) + 1;
      this.emit({ type: "health", hp: this.maxHp }); return true;
    }
    if (name === "Phoenix" && !this.counters.flight) {
      this.counters.flight = 1; this.emit({ type: "health", hp: 0.5 }); this.emit({ type: "music", track: "phoenix" }); return true;
    }
    if (this.hasPassive("Pulse") && !this.counters.revived) { this.counters.revived = 1; return this.openChallenge("pulse"); }
    if (name === "Gambit" && !this.counters.revived) { this.counters.revived = 1; return this.openChallenge("gambit", { dice: initialGambitRoll(this.random) }); }
    if (name === "Relay" && !this.counters.revived) {
      const hp = Math.floor((this.counters.relayBonus || 0) / 2) * 0.5;
      if (hp <= 0) return false; this.counters.revived = 1; this.emit({ type: "health", hp, maxHp: Math.max(this.maxHp, hp) }); return true;
    }
    if (["Weaver", "Challenger"].includes(name) && !this.counters.secondLife && this.owned.has(name === "Weaver" ? "runner_courier" : "runner_sprint") && !this.online) {
      this.counters.secondLife = 1; const hp = name === "Weaver" ? 0.5 : 1;
      return this.setForm(name === "Weaver" ? "runner_courier" : "runner_sprint", hp, hp, true);
    }
    if (name === "Hex" && this.counters.god && this.maxHp > 1) { this.emit({ type: "health", hp: this.maxHp - 1, maxHp: this.maxHp - 1 }); return true; }
    if (name === "Echo" && this.counters.knowing && this.counters.shards > 0) {
      this.count("shards", -1); const hp = 1 + this.counters.shards;
      this.emit({ type: "health", hp, maxHp: hp });
      if (this.counters.shards === 0 && this.online && this.opponentName !== "Echo") {
        this.timers.reflective = this.elapsed + 10; this.counters.reflectiveEnd=this.elapsed+10;
        this.emit({type:"opponent",action:"echo-reflective"});
      }
      return true;
    }
    return false;
  }
  choiceCharacters(kind=this.phase) {
    if (kind === "muse") {
      const rarity = ["legendary","epic","rare","uncommon","common"][this.counters.museLives || 0];
      return OVERHAUL_CHARACTERS.filter(c=>c.classKey!=="chaotic" && c.rarity===rarity && !this.usedClasses.includes(c.classKey));
    }
    if (kind === "pacer") return OVERHAUL_CHARACTERS.filter(c=>!["runner","medic"].includes(c.classKey) && c.rarity!=="mythic");
    if (kind === "echo-passives") {
      const category=["runner","medic","tank","trickster","misc"][Math.min(4, (this.counters.echoQuest || 1)-1)];
      return OVERHAUL_CHARACTERS.filter(c=>c.classKey===category && c.rarity!=="mythic" && !this.borrowed.includes(c.key));
    }
    return [];
  }
  checkEchoQuest() {
    if (this.name!=="Echo" || this.phase || this.counters.knowing) return;
    const step=this.counters.echoQuest || 0;
    const goals=[this.wave>=5, (this.counters.waveEndHealing || 0)-(this.counters.echoHealBase || 0)>=5,
      (this.counters.damageTaken || 0)-(this.counters.echoDamageBase || 0)>=10,this.wave>=15,
      (this.counters.physicalGems || 0)-(this.counters.echoGemBase || 0)>=20,
      (this.counters.melons || 0)-(this.counters.echoMelonBase || 0)>=25,
      this.counters.knowingRecovered>0];
    if (!goals[step]) return;
    this.counters.echoQuest=step+1;
    if (step<6) this.count("shards");
    this.counters.echoHealBase=this.counters.waveEndHealing || 0;
    this.counters.echoDamageBase=this.counters.damageTaken || 0;
    this.counters.echoGemBase=this.counters.physicalGems || 0;
    this.counters.echoMelonBase=this.counters.melons || 0;
    if (step<4) this.openChallenge("echo-passives",{count:2});
    if (step===6) { this.counters.knowing=1; this.emit({type:"health",hp:7,maxHp:7}); }
  }
  /** A challenge settles once, against this run's offered choices. The host
   * binds multiplayer and account receipts to the original run separately. */
  resolveChallenge(kind: OverhaulChallengeKind, value: unknown, issuedId: number) {
    if (this.closed || this.phase !== kind || issuedId!==this.challengeId) return false;
    const number=typeof value==="number" && Number.isFinite(value) ? value : -1;
    const values=Array.isArray(value) ? value : [];
    let next: OverhaulChallengeKind | null=null;
    if (["muse","pacer","echo-passives"].includes(kind)) {
      const keys=kind==="echo-passives" ? values : [value];
      const legal=new Set(this.choiceCharacters(kind).map(c=>c.key));
      if (keys.length!==(kind==="echo-passives"?2:1) || new Set(keys).size!==keys.length || keys.some(key=>typeof key!=="string" || !legal.has(key))) return false;
      if (kind==="echo-passives") this.borrowed.push(...keys as string[]);
      else {
        const chosen=overhaulCharacter(keys[0] as string)!;
        if (kind==="muse") this.usedClasses.push(chosen.classKey); else this.counters.passedBaton=1;
        this.setForm(chosen.key,kind==="pacer"?0.5:undefined,kind==="pacer"?0.5:undefined);
      }
    } else if (kind==="mimic") {
      if (number!==1 && number!==2) return false; this.counters.mimicChoice=number;
    } else if (kind==="tempo") {
      const result=tempoResult(number); this.counters.tempoSpeed=result.speed; this.counters.tempoScore=result.score;
      this.counters.harmfulGems=Number(result.harmfulGems); if(result.resetStreak)this.emit({type:"gem-streak-reset"});
    } else if (kind==="pulse") {
      const result=value as {correct?:number;wrong?:number};
      if (!result || !Number.isInteger(result.correct) || !Number.isInteger(result.wrong)) return false;
      const correct=Math.max(0,Math.min(200,result.correct!));
      const hp=result.wrong!>=2 || correct<=10?0:correct<=15?0.5:correct<=20?1:correct<=30?1.5:correct<=40?2:correct<=54?2.5:3;
      this.emit(hp?{type:"health",hp}:{type:"finish",reason:"PULSE REVIVAL FAILED"});
    } else if (kind==="gambit") {
      if(values.length!==6 || values.some(v=>!Number.isInteger(v)||v<1||v>8))return false;
      const result=gambitRevival(values as number[]); this.counters.diceHand=result.hand; this.counters.diceScore=result.percent;
      this.emit(result.hp?{type:"health",hp:result.hp,maxHp:2}:{type:"finish",reason:"NO GAMBIT REVIVAL"});
    } else if (kind==="imagination") {
      if (values.length!==this.memory.length || values.some((v,i)=>v!==this.memory[i])) this.emit({type:"finish",reason:"MEMORY SEQUENCE INCORRECT"});
    } else if (kind==="bowling") {
      if(!Number.isInteger(number)||number<0||number>30)return false; this.count("pins",number);
    } else if (kind==="math") {
      const correct=typeof value==="string" && value===this.challengeData.answer;
      this.counters.mathScore=(this.counters.mathScore||1)*(correct?1.08:0.95);
      this.emit({type:"notice",text:correct?"CORRECT · MULTIPLIER ×1.08":"INCORRECT · MULTIPLIER ×0.95"});
    } else if(kind==="language"){
      const clip=SONG_CLIPS[Number(this.challengeData.clip)];if(!clip)return false;
      if(value===clip.language)this.emit({type:"score",amount:this.challengeData.opponent?3000:5000});else this.emit({type:"damage",amount:this.challengeData.opponent?1:.5,reason:"LANGUAGE INCORRECT"});
    } else if (kind==="conic") {
      if (number===this.challengeData.shape)this.emit({type:"score",amount:3500});
    } else if (kind==="drawing") {
      if (number<0||number>1)return false; this.counters.drawingBonus=number*0.3;
    } else if (kind==="lantern") {
      const offered=new Set((this.challengeData.items as OverhaulItem[] || []).map(item=>item.id));
      if(values.some(id=>typeof id!=="number"||!offered.has(id)))return false;
      this.emit({type:"stop-items",ids:[...new Set(values as number[])],seconds:2});
    } else if (kind==="adaptation") {
      if(!(this.challengeData.choices as string[] || []).includes(value as string))return false;
      this.counters["sacrifice:"+value]=1; this.counters.sacrificed=1;
    } else if (kind==="void") {
      if(!Number.isInteger(number)||number<0||number>12)return false; this.count("damnation",number);
      if(this.counters.damnation>=100&&!this.counters.god&&!this.counters.hadesAttempted){this.counters.hadesAttempted=1;next="hades-keys";}
    } else if (kind==="hades-keys") {
      const result=value as {correct?:number;wrong?:number};
      if(!result||!Number.isInteger(result.correct)||!Number.isInteger(result.wrong))return false;
      if(result.correct!>=25&&result.wrong!<2)next="hades-targets";
      else this.emit({type:"notice",text:"HADES REMAINS UNDEFEATED"});
    } else if (kind==="hades-targets") {
      if(!Number.isInteger(number)||number<0||number>100)return false;
      if(number>=15){this.counters.god=1;this.emit({type:"health",hp:3,maxHp:3});}
    } else if (kind==="wildcard") {
      if(number===-1){this.emit({type:"finish",reason:"NO CARD CHOSEN"});this.phase=null;return true;}
      if(number<0||!Number.isInteger(number)||number>=wildcardChoiceCount(this.cards.length))return false;
      const result=takeWildcard(this.cards,number,this.random); this.cards=result.deck;
      for(const card of result.drawn)this.holdCard(card);
    } else if(kind!=="zenith-stop") return false;
    this.phase=null; this.challengeData={};
    const queued=next ? {kind:next} : this.phaseQueue.shift();
    if(queued)this.openChallenge(queued.kind,queued.data);
    return true;
  }
  private holdCard(card:EuchreCard) {
    this.heldCards.push(card); const rank=card.slice(0,-1),suit=card.slice(-1);
    if(rank==="9") {if(suit==="S")this.counters.nineSpadesAt=this.elapsed+15;else {this.count("nines");if(this.online)this.emit({type:"opponent",action:"wildcard-melon",values:{percent:this.counters.nines*9}});}}
    if(rank==="10")this.count("tens");
    if(rank==="J") {
      if(suit==="S")this.counters.jackSpades=1;
      else if(this.online)this.emit({type:"opponent",action:"wildcard-jack",values:{suit}});
    }
    if(rank==="Q") {this.count("queens");if(this.online)this.emit({type:"opponent",action:"wildcard-confuse",values:{percent:this.counters.queens*2}});}
    if(rank==="K") {this.count("kings");if(this.online)this.emit({type:"opponent",action:"wildcard-delay",values:{seconds:this.counters.kings*0.04}});}
    if(rank==="A" && suit==="C") {this.counters.aceClubs=1;if(this.online)this.emit({type:"opponent",action:"wildcard-club"});}
    if(rank==="A" && suit==="S")this.counters.aceSpadesAt=this.elapsed+10+this.random()*15;
  }
  checkpoint(){
    return {version:1,originalKey:this.originalKey,behaviorRootKey:this.behaviorRootKey,key:this.key,maxHp:this.maxHp===Infinity?"Infinity":this.maxHp,
      wave:this.wave,elapsed:this.elapsed,waveElapsed:this.waveElapsed,lane:this.lane,secondLane:this.secondLane,lastMoveAt:this.lastMoveAt,
      counters:{...this.counters},timers:Object.fromEntries(Object.entries(this.timers).map(([k,v])=>[k,Number.isFinite(v)?v:this.elapsed+21600])),cooldowns:{...this.cooldowns},history:this.history.slice(-200),cards:[...this.cards],heldCards:[...this.heldCards],memory:[...this.memory],eclipseOrder:[...this.eclipseOrder],usedClasses:[...this.usedClasses],borrowed:[...this.borrowed],seededKind:this.seededKind,lastAsh:this.lastAsh,
      phase:this.phase,challengeId:this.challengeId,challengeData:this.challengeData,deliveries:[...this.deliveries].slice(-200),items:[]};
  }
  restoreCheckpoint(raw:unknown){
    if(!raw||typeof raw!=="object"||Array.isArray(raw))return false;const data=raw as Record<string,unknown>;
    if(data.version!==1||data.originalKey!==this.originalKey||typeof data.key!=="string"||!overhaulCharacter(data.key))return false;
    const number=(key:string,min=0,max=21600)=>typeof data[key]==="number"&&Number.isFinite(data[key])&&Number(data[key])>=min&&Number(data[key])<=max;
    if(!number("wave",1,100000)||!number("elapsed")||!number("waveElapsed",0,40.5)||!number("lane",0,this.laneCount-1)||!number("challengeId",0,100000))return false;
    const records=["counters","timers","cooldowns"];
    for(const key of records){const v=data[key];if(!v||typeof v!=="object"||Array.isArray(v)||Object.keys(v).length>300||Object.values(v).some(n=>typeof n!=="number"||!Number.isFinite(n)||Math.abs(n)>1e12))return false;}
    const strings=(key:string,max:number)=>Array.isArray(data[key])&&(data[key]as unknown[]).length<=max&&(data[key]as unknown[]).every(v=>typeof v==="string"&&v.length<100);
    if(!strings("cards",24)||!strings("heldCards",24)||!strings("borrowed",10)||!strings("usedClasses",5)||!strings("deliveries",200))return false;
    if(!Array.isArray(data.memory)||data.memory.length>10000||data.memory.some(n=>!Number.isInteger(n)||n<1||n>6))return false;
    const phases=["tempo","pulse","gambit","imagination","bowling","math","language","conic","drawing","void","hades-keys","hades-targets","oracle","echo-passives","pacer","muse","mimic","lantern","adaptation","cartographer-map","wildcard","zenith-stop"];
    if(data.phase!==null&&(typeof data.phase!=="string"||!phases.includes(data.phase)))return false;
    if(!data.challengeData||typeof data.challengeData!=="object"||Array.isArray(data.challengeData))return false;
    this.effects=[];this.key=data.key;this.behaviorRootKey=typeof data.behaviorRootKey==="string"&&overhaulCharacter(data.behaviorRootKey)?data.behaviorRootKey:this.key;
    this.wave=Number(data.wave);this.elapsed=Number(data.elapsed);this.waveElapsed=Number(data.waveElapsed);this.lane=Number(data.lane);this.secondLane=number("secondLane",0,this.laneCount-1)?Number(data.secondLane):this.lane;this.lastMoveAt=number("lastMoveAt")?Number(data.lastMoveAt):0;
    this.counters={...data.counters as OverhaulCounters};this.timers={...data.timers as OverhaulTimers};this.cooldowns={...data.cooldowns as Record<string,number>};
    this.cards=data.cards as EuchreCard[];this.heldCards=data.heldCards as EuchreCard[];this.borrowed=(data.borrowed as string[]).filter(key=>overhaulCharacter(key));this.usedClasses=data.usedClasses as string[];this.memory=data.memory as number[];
    this.deliveries=new Set(data.deliveries as string[]);this.history=Array.isArray(data.history)?data.history.filter((v):v is {at:number;lane:number}=>!!v&&typeof v==="object"&&Number.isFinite(v.at)&&Number.isInteger(v.lane)&&v.lane>=0&&v.lane<this.laneCount).slice(-200):[];
    this.eclipseOrder=Array.isArray(data.eclipseOrder)?data.eclipseOrder.filter((v):v is number=>Number.isInteger(v)&&v>=1&&v<=4):[];
    this.seededKind=typeof data.seededKind==="string"?data.seededKind:null;this.lastAsh=typeof data.lastAsh==="string"?data.lastAsh:null;
    this.phase=data.phase as OverhaulChallengeKind|null;this.challengeId=Number(data.challengeId);this.challengeData=data.challengeData as Record<string,unknown>;
    const cap=data.maxHp==="Infinity"?Infinity:Number(data.maxHp);if(cap>=.5)this.maxHp=cap;
    if(this.phase)this.emit({type:"challenge",kind:this.phase,data:this.challengeData,restored:true});return true;
  }
  endRewards() {
    const modifiers = this.modifiers();
    return { xpMultiplier: modifiers.xp * (1 + (this.name === "Oracle" ? (this.counters.prophecies || 0) / 100 : 0))
      * (1 + (this.name === "Conic" ? (this.counters.potatoWaves || 0) * 0.09 : 0)),
      bonusXp: this.name === "Switch" && this.counters.moves > 57 ? Math.floor((this.counters.moves - 55) / 3) : 0,
      gems: this.name === "Glide" ? Math.floor(this.elapsed / 70) : 0,
      stardust: this.name === "Conic" && this.counters.chipEver ? Math.floor(this.elapsed / 4) : 0 };
  }
}
