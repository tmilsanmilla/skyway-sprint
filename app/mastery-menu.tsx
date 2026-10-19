"use client";

import { MASTERIES, masteryDefinition, type MasteryAccountState, type MasteryKey } from "./mastery-rules";
import { cycleFlair, flairDescription, type InventoryFlair } from "./flair-rules";

interface MasteryShopProps { state: MasteryAccountState; photons: number; ownedCharacters: readonly string[]; busy?: boolean; onPurchase: (key: MasteryKey) => void; onActivate: (key: MasteryKey) => void; }
export function MasteryShop({ state, photons, ownedCharacters, busy, onPurchase, onActivate }: MasteryShopProps) {
  const owned = new Set(ownedCharacters);
  return <section className="mastery-shop" aria-label="Mastery quest shop"><h3>Mastery quests</h3><p>Use photons to begin a character&apos;s three quests. Only one quest is active at a time. Complete the quests, then win its trial.</p>
    <div className="mastery-shop-grid">{MASTERIES.map((entry) => {
      const quest = state.quests[entry.key];
      return <article className="mastery-shop-card" key={entry.key}><h4>{entry.name}</h4><ol>{entry.quests.map((label, i) => <li key={label} data-complete={!!quest && quest.quest > i}>{!!quest && quest.quest > i ? "✓ " : ""}{label}</li>)}</ol>
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
    {quest.mastered ? <><label><input type="checkbox" checked={quest.masteryEnabled} disabled={busy} onChange={(event) => onToggle(definition.key, "mastery", event.target.checked)} /> Mastery</label><p>{definition.ability}</p><label><input type="checkbox" checked={quest.flairRewriteEnabled} disabled={busy} onChange={(event) => onToggle(definition.key, "flair", event.target.checked)} /> Rewritten flair</label><p>Independent of mastery. Turn off to restore this flair&apos;s original score bonus.</p></> : quest.complete ? <button type="button" disabled={busy} onClick={() => onTrial(definition.key)}>Enter trial of {definition.name}</button> : <><strong>Quest {quest.quest + 1} of 3</strong><p>{definition.quests[quest.quest]}</p><div>{definition.targets[quest.quest].map((target, i) => <span key={i}>{Math.min(target, Math.floor((quest.progress[i] ?? 0) * 100) / 100)} / {target}{i + 1 < definition.targets[quest.quest].length ? " · " : ""}</span>)}</div></>}
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
