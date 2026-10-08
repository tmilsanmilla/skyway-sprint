"use client";
import { useState } from "react";
import type { DuelMode, RotatingMode } from "./update-19-rules";

export type SetupView = {
  phase: "ban" | "announce" | "character";
  deadline: number;
  candidates: string[];
  ownBan: string | null;
  revealedBans: string[];
  confirmed: boolean;
  rarity: string | null;
};
type Arena = { key: string; name: string; description: string; rules: readonly string[] };
type Pick = { key: string; name: string; classKey: string; rarity: string; description: string };
const className = (key: string) => key === "medic" ? "HEALER" : key.toUpperCase();
export const duelName = (mode: DuelMode) => ({ casual: "CASUAL 1V1", ranked: "RANKED 1V1", rng: "RNG", hardcore_duel: "HARDCORE DUEL" })[mode];

export function MatchSetupPanel({ setup, now, map, arenas, characters, selfName, rivalName, selfCharacter, rivalCharacter, selected, busy, status, onBan, onPick, onLeave }: {
  setup: SetupView; now: number; map: Arena; arenas: readonly Arena[]; characters: readonly Pick[];
  selfName: string; rivalName: string; selfCharacter: string; rivalCharacter: string;
  selected: string; busy: boolean; status: string; onBan: (key: string) => void; onPick: (key: string) => void; onLeave: () => void;
}) {
  const [tab, setTab] = useState("runner");
  const remaining = Math.max(0, Math.ceil((setup.deadline - now) / 1000));
  const classes = [...new Set(characters.map(c => c.classKey))];
  const activeTab = classes.includes(tab) ? tab : classes[0];
  return <section className={`match-setup-panel setup-${setup.phase}`} aria-label="Match setup">
    <header><small>MATCH FOUND</small><h2>{setup.phase === "ban" ? "BAN ONE MAP" : setup.phase === "announce" ? map.name.toUpperCase() : "CHOOSE YOUR CHARACTER"}</h2><strong aria-live="off">{remaining}s</strong></header>
    {setup.phase === "ban" ? <>
      <p>Four random maps. Ban one you don’t want. Your rival’s choice stays hidden until the timer ends.</p>
      <div className="map-ban-grid">{arenas.filter(a => setup.candidates.includes(a.key)).map(a => <button key={a.key} disabled={busy || !!setup.ownBan || remaining === 0} aria-pressed={setup.ownBan === a.key} className={setup.ownBan === a.key ? "selected" : ""} onClick={() => onBan(a.key)}><b>{a.name}</b><span>{a.description}</span><em>{setup.ownBan === a.key ? "YOUR BAN" : "BAN MAP"}</em></button>)}</div>
      {setup.ownBan && <p role="status">Ban locked in. Waiting for your rival…</p>}
    </> : setup.phase === "announce" ? <>
      <div className="selected-arena-mark" aria-hidden="true">⚔</div><p>{map.description}</p>
      <ul>{map.rules.map(rule => <li key={rule}>{rule}</li>)}</ul>
      <div className="assigned-characters"><span>{selfName}<b>{selfCharacter}</b></span><strong>VS</strong><span>{rivalName}<b>{rivalCharacter}</b></span></div>
      {setup.rarity && <p>{setup.rarity.toUpperCase()} · Assigned characters are temporary for this match.</p>}
    </> : <>
      <p>{setup.confirmed ? "Character ready. Waiting for your rival…" : "Pick an owned character for this map. Both ready? The match starts immediately."}</p>
      <nav className="character-class-tabs" aria-label="Character classes">{classes.map(key => <button key={key} className={key === activeTab ? "selected" : ""} onClick={() => setTab(key)}>{className(key)}</button>)}</nav>
      <div className="match-character-grid">{characters.filter(c => c.classKey === activeTab).map(c => <button key={c.key} className={selected === c.key ? "selected" : ""} disabled={busy || setup.confirmed || remaining === 0} onClick={() => onPick(c.key)}><b>{c.name}</b><small>{c.rarity.toUpperCase()}</small><span>{c.description}</span><em>{selected === c.key && setup.confirmed ? "READY" : "SELECT & READY"}</em></button>)}</div>
    </>}
    {status && <p role="status">{status}</p>}<button className="setup-leave" onClick={onLeave} disabled={busy}>LEAVE MATCH</button>
  </section>;
}

type Leader = { rank: number; username: string; rating: number; wins: number; losses: number; is_self: boolean };
export function DuelHub({ special, mode, activeMode, nextRotation, level, guest, rankedUnlocked, rankedPurchased, gems, busy, searching, unlocking, status, arenas, attacks, leaders, leadersError, leadersLoading, onMode, onFind, onCancel, onUnlock, onRefresh, onUpdates }: {
  special: boolean; mode: DuelMode; activeMode: RotatingMode; nextRotation: number; level: number; guest: boolean;
  rankedUnlocked: boolean; rankedPurchased: boolean; gems: number; busy: boolean; searching: boolean; unlocking: boolean; status: string;
  arenas: readonly Arena[]; attacks: readonly { kind: string; label: string; icon: string; cost: number; description: string }[]; leaders: readonly Leader[]; leadersError: string; leadersLoading: boolean;
  onMode: (mode: DuelMode) => void; onFind: () => void; onCancel: () => void; onUnlock: () => void; onRefresh: () => void; onUpdates: () => void;
}) {
  const locked = special && (guest || level < 5);
  return <div className="versus-hub"><header className="versus-hub-heading"><div><p>{special ? "DAILY ROTATION · LEVEL 5" : "MULTI-DEVICE REALTIME"}</p><h2 id="versus-hub-title">{special ? "GAME MODES" : duelName(mode)}</h2></div><strong>{special ? "CASUAL · NO ELO" : mode === "ranked" ? "ELO ON THE LINE" : "NO ELO · JUST PLAY"}</strong><button onClick={onUpdates}>▤ UPDATE LOG</button></header>
    <div className="versus-hub-scroll">
      <section className="versus-hub-panel"><h3>{special ? "TODAY’S MODE" : "MATCHMAKING"}</h3>
        <div className="versus-mode-picker">{(special ? ["rng", "hardcore_duel"] : ["casual", "ranked"]).map(key => {
          const k = key as DuelMode; const unavailable = special ? k !== activeMode || locked : k === "ranked" && !rankedUnlocked;
          return <button key={k} className={mode === k ? "selected" : ""} disabled={busy || searching || unavailable} aria-pressed={mode === k} onClick={() => onMode(k)}><b>{duelName(k)}</b><small>{special ? k === activeMode ? locked ? "REACH LEVEL 5" : "ACTIVE TODAY" : "NEXT ROTATION" : k === "ranked" ? rankedUnlocked ? "COMPETITIVE · ELO" : "LEVEL 25 + 100 GEMS" : "OPEN TO EVERY LEVEL"}</small></button>;
        })}</div>
        {special && <><p>Changes daily at {new Date(nextRotation).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", timeZoneName: "short" })}.</p><p>{activeMode === "rng" ? "A random map and two different character classes. Both characters have the same rarity, even if you don’t own them. No inventory unlock is granted." : "Ace only. One heart, no healing, and hazards move 10% faster. Final scores are doubled after the second-finisher bonus."}</p>{locked && <p className="required-note">Reach level 5 to unlock all rotating modes.</p>}</>}
        {!special && !guest && !rankedPurchased && <div className="ranked-unlock-panel"><p>Ranked unlocks separately at level 25 for 100 Gems.</p><button disabled={busy || unlocking || level < 25 || gems < 100} onClick={onUnlock}>{unlocking ? "UNLOCKING…" : "UNLOCK RANKED · 100 GEMS"}</button></div>}
        {searching ? <div className="versus-searching" role="status"><b>FINDING AN OPPONENT…</b><p>Keep this screen open while we pair your account.</p><button disabled={busy} onClick={onCancel}>CANCEL SEARCH</button></div> : <button className="versus-primary" disabled={busy || guest || locked} onClick={onFind}>{busy ? "PLEASE WAIT…" : `FIND ${duelName(mode)} OPPONENT`}</button>}
        {guest && <p>Sign in to play online.</p>}{status && <p className="versus-message" role="status">{status}</p>}
      </section>
      <section className="versus-hub-panel"><h3>HOW IT WORKS</h3><ol className="versus-rule-list"><li>{special && activeMode === "rng" ? "Your map and character are assigned at random." : "Ban one of four random maps in 10 seconds. We randomly pick from the maps that remain."}</li><li>{special ? "See the map and your assigned character for 4 seconds, then start playing." : "See the chosen map for 4 seconds. Then you have 15 seconds to pick a map-legal character, unless the map forces Ace. Both ready? Start immediately."}</li><li>Survive, collect coins, and send hazards during each 10-second intermission.</li><li>The second runner to finish gets +5% score and +500. Highest final score wins; tied scores go to the second finisher.</li><li>Only Ranked changes Elo. RNG and Hardcore Duel are casual matches.</li></ol></section>
      <section className="versus-hub-panel"><h3>ATTACK COIN ARMORY</h3><div className="versus-attack-catalog">{attacks.map(a => <article key={a.kind}><span aria-hidden="true">{a.icon}</span><div><b>{a.label}</b><small>{a.description}</small></div><strong>◉ {a.cost}</strong></article>)}</div></section>
      {mode === "ranked" && <section className="versus-hub-panel"><h3>RANKED LEADERBOARD</h3><button disabled={leadersLoading} onClick={onRefresh}>REFRESH</button>{leadersError ? <p role="status">{leadersError}</p> : <ol className="versus-leader-list">{leaders.map(p => <li key={p.rank} className={p.is_self ? "me" : ""}><b>#{p.rank}</b><span><strong>{p.username}</strong><small>{p.wins}W–{p.losses}L</small></span><strong>{Math.round(p.rating)} ELO</strong></li>)}</ol>}{!leaders.length && !leadersError && <p>{leadersLoading ? "Loading…" : "No ranked matches yet."}</p>}</section>}
      <details className="versus-hub-panel arena-guide-list"><summary>ARENA MAP GUIDE</summary><div className="gameplay-guide-grid">{arenas.map(a => <article key={a.key} className="gameplay-guide-item"><b>{a.name}</b><p>{a.description}</p><ul>{a.rules.map(r => <li key={r}>{r}</li>)}</ul></article>)}</div></details>
    </div>
  </div>;
}
