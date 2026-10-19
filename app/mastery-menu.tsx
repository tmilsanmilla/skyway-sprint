"use client";

import { MASTERIES, masteryDefinition, type MasteryAccountState, type MasteryKey } from "./mastery-rules";
import { cycleFlair, flairDescription, type InventoryFlair } from "./flair-rules";
import type { MasterySyncStatus } from "./use-masteries";

/** Display-only preview: completion/unlocks still come from the saved profile. */
export function trackedQuestProgress(key: MasteryKey, state: MasteryAccountState, liveState = state) {
  const definition = masteryDefinition(key)!, saved = state.quests[key];
  if (!saved || saved.complete) return null;
  const quest = Math.min(2, Math.max(0, saved.quest)), targets = definition.targets[quest];
  const local = liveState.quests[key];
  const waiting = !!local && (local.complete || local.quest > quest);
  const values = targets.map((target, i) => Math.min(target, Math.max(0, waiting ? target : local?.quest === quest ? local.progress[i] ?? 0 : saved.progress[i] ?? 0)));
  return { definition, quest, targets, values, waiting };
}
const amount = (value: number) => (Math.floor(value * 100) / 100).toLocaleString();
const syncLabel = (status: MasterySyncStatus) => status === "retrying" ? "Save interrupted · retrying" : status === "starting" ? "Connecting quest…" : status === "syncing" || status === "pending" ? "Saving progress…" : "Progress saved";
function QuestProgressBars({ progress }: { progress: NonNullable<ReturnType<typeof trackedQuestProgress>> }) {
  return <div className="mastery-progress-bars">{progress.targets.map((target, i) => <label key={i}><span>{progress.targets.length > 1 ? `Goal ${i + 1} · ` : ""}{amount(progress.values[i])} / {amount(target)}</span><progress aria-label={`${progress.definition.name} quest ${progress.quest + 1}, goal ${i + 1}`} max={target} value={progress.values[i]} /></label>)}</div>;
}
export function ActiveMasteryQuest({ state, liveState, character, syncStatus, onRetry }: { state: MasteryAccountState; liveState: MasteryAccountState; character: string; syncStatus: MasterySyncStatus; onRetry: () => void }) {
  const key = state.active ?? liveState.active;
  if (!key) return null;
  const progress = trackedQuestProgress(key, state, liveState);
  if (!progress) return null;
  const saved = trackedQuestProgress(key, state);
  return <details className="active-mastery-quest" aria-label="Active mastery quest">
    <summary><strong>{progress.definition.name} · Quest {progress.quest + 1}/3</strong><span>{progress.values.map((value, i) => `${amount(value)}/${amount(progress.targets[i])}`).join(" · ")}</span><small>{syncLabel(syncStatus)}</small><em>Details</em></summary>
    <div className="active-mastery-quest-body"><p>{progress.definition.quests[progress.quest]}</p><QuestProgressBars progress={progress} />
      {character !== key ? <p className="mastery-progress-note">Use {progress.definition.name} to advance this quest. This run uses another character.</p> : null}
      {progress.waiting ? <p className="mastery-progress-note">Goal reached locally. Waiting for the saved quest to confirm.</p> : null}
      {syncStatus === "pending" || syncStatus === "syncing" || syncStatus === "retrying" ? <p className="mastery-progress-note">Live progress is not saved yet. Last saved: {saved?.values.map((value, i) => `${amount(value)}/${amount(saved.targets[i])}`).join(" · ")}. Failed saves retry automatically.</p> : null}
      {syncStatus === "retrying" ? <button type="button" onClick={onRetry}>Retry save</button> : null}
      <small>Tap the heading to minimize. This panel never covers a lane.</small>
    </div>
  </details>;
}

interface MasteryShopProps { state: MasteryAccountState; liveState?: MasteryAccountState; syncStatus?: MasterySyncStatus; photons: number; ownedCharacters: readonly string[]; busy?: boolean; onPurchase: (key: MasteryKey) => void; onActivate: (key: MasteryKey) => void; }
export function MasteryShop({ state, liveState = state, syncStatus = "saved", photons, ownedCharacters, busy, onPurchase, onActivate }: MasteryShopProps) {
  const owned = new Set(ownedCharacters);
  return <section className="mastery-shop" aria-label="Mastery quest shop"><h3>Mastery quests</h3><p>Use photons to begin a character&apos;s three quests. Only one quest is active at a time. Complete the quests, then win its trial.</p>
    <div className="mastery-shop-grid">{MASTERIES.map((entry) => {
      const quest = state.quests[entry.key];
      const progress = trackedQuestProgress(entry.key, state, liveState);
      return <article className="mastery-shop-card" key={entry.key}><h4>{entry.name}</h4><ol>{entry.quests.map((label, i) => <li key={label} data-complete={!!quest && quest.quest > i}>{!!quest && quest.quest > i ? "✓ " : ""}{label}</li>)}</ol>
        {progress ? <div className="mastery-shop-progress"><strong>Quest {progress.quest + 1} of 3{state.active === entry.key ? " · Active" : ""}</strong><QuestProgressBars progress={progress} />{state.active === entry.key ? <small>{progress.waiting ? "Goal reached · awaiting confirmation" : syncLabel(syncStatus)}</small> : null}</div> : null}
        {!quest ? <button type="button" disabled={busy || !owned.has(entry.key) || photons < entry.price} onClick={() => onPurchase(entry.key)}>{!owned.has(entry.key) ? "Unlock character first" : `${entry.price} photons`}</button> : quest.mastered ? <p>Mastered ✓</p> : quest.complete ? <p>Trial ready in character selection</p> : <button type="button" disabled={busy || state.active === entry.key} onClick={() => onActivate(entry.key)}>{state.active === entry.key ? "Quest active" : "Make quest active"}</button>}
      </article>;
    })}</div>
  </section>;
}
interface CharacterMasteryProps { character: string; state: MasteryAccountState; busy?: boolean; onToggle: (key: MasteryKey, which: "mastery" | "flair", value: boolean) => void; onTrial: (key: MasteryKey) => void; }
export function CharacterMastery({ character, state, busy, onToggle, onTrial }: CharacterMasteryProps) {
  const definition = masteryDefinition(character);
  if (!definition) return null;
  const quest = state.quests[definition.key];
  if (!quest) return null;
  return <section className="character-mastery" aria-label={`${definition.name} mastery`}>
    {quest.mastered ? <><label><input type="checkbox" checked={quest.masteryEnabled} disabled={busy} onChange={(event) => onToggle(definition.key, "mastery", event.target.checked)} /> Mastery</label><p>{definition.ability}</p><label><input type="checkbox" checked={quest.flairRewriteEnabled} disabled={busy} onChange={(event) => onToggle(definition.key, "flair", event.target.checked)} /> Rewritten flair</label><p>Independent of mastery. Turn off to restore this flair&apos;s original score bonus.</p><button type="button" disabled={busy} onClick={() => onTrial(definition.key)}>Replay trial of {definition.name}</button><p>Practice replay only. No rewards; your mastery and flair settings stay unchanged.</p></> : quest.complete ? <button type="button" disabled={busy} onClick={() => onTrial(definition.key)}>Enter trial of {definition.name}</button> : <><strong>Quest {quest.quest + 1} of 3</strong><p>{definition.quests[quest.quest]}</p><div>{definition.targets[quest.quest].map((target, i) => <span key={i}>{Math.min(target, Math.floor((quest.progress[i] ?? 0) * 100) / 100)} / {target}{i + 1 < definition.targets[quest.quest].length ? " · " : ""}</span>)}</div></>}
  </section>;
}
interface FlairPickerProps { character: string; flairs: readonly InventoryFlair[]; selected: string | null; state: MasteryAccountState; busy?: boolean; onEquip: (key: string) => void; }
export function FlairPicker({ character, flairs, selected, state, busy, onEquip }: FlairPickerProps) {
  const flair = flairs.find((entry) => entry.key === selected) ?? flairs.find((entry) => entry.key === character) ?? flairs[0];
  if (!flair) return null;
  const mastery = masteryDefinition(flair.key);
  const rewritten = !!mastery && !!state.quests[mastery.key]?.mastered && !!state.quests[mastery.key]?.flairRewriteEnabled;
  const cycle = (direction: -1 | 1) => { const key = cycleFlair(flair.key, direction, flairs); if (key) onEquip(key); };
  return <section className="flair-picker" aria-label="Equipped flair"><h4>Flair</h4><div className="flair-cycle"><button type="button" disabled={busy || flairs.length < 2} aria-label="Previous flair" onClick={() => cycle(-1)}>◀</button><strong>{flair.name}</strong><button type="button" disabled={busy || flairs.length < 2} aria-label="Next flair" onClick={() => cycle(1)}>▶</button></div><p>{flairDescription(flair, character, rewritten)}</p><label>Choose flair<select value={flair.key} disabled={busy} onChange={(event) => onEquip(event.target.value)}>{flairs.map((entry) => <option key={entry.key} value={entry.key}>{entry.name} · {entry.characterName}</option>)}</select></label></section>;
}
