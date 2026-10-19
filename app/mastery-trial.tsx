"use client";

import { masteryDefinition, masteryTrialDuration, masteryTrialSmoke, type MasteryKey, type MasteryTrialState } from "./mastery-rules";

export function MasteryTrialDisclaimer({ character, onAccept, onCancel, busy = false, replay = false }: { character: MasteryKey; onAccept: () => void; onCancel: () => void; busy?: boolean; replay?: boolean }) {
  const definition = masteryDefinition(character)!;
  return <section className="mastery-trial-disclaimer" role="dialog" aria-modal="true" aria-labelledby="trial-title"><h2 id="trial-title">{replay ? "Replay trial" : "Trial"} of {definition.name}</h2><p>{definition.disclaimer}</p><p>Trial runs do not save scores, award currency or XP, or affect 1v1 rankings.</p>{replay ? <p><strong>Practice replay · no rewards.</strong> This character is already mastered. Your mastery completion and switch settings will not change.</p> : null}<div><button type="button" disabled={busy} onClick={onAccept}>{replay ? "Start replay" : "Start trial"}</button><button type="button" disabled={busy} onClick={onCancel}>Back to character</button></div></section>;
}
export function MasteryTrialOverlay({ state, replay = false }: { state: MasteryTrialState; replay?: boolean }) {
  const definition = masteryDefinition(state.key)!;
  if (state.phase === "disclaimer") return null;
  const duration = masteryTrialDuration(state.key);
  return <div className="mastery-trial-overlay" aria-live="polite">
    {state.key === "trickster_smoke" && state.phase === "playing" ? <div className="mastery-smoke-layers" aria-hidden="true">{masteryTrialSmoke(state).map((band) => <div key={band.kind} style={{ position: "absolute", top: `${band.from * 100}%`, height: `${(band.to - band.from) * 100}%`, width: "100%", background: band.kind === "heavy" ? "#292d32" : band.kind === "grey" ? "rgba(95,104,111,.82)" : "rgba(153,164,174,.32)", pointerEvents: "none" }} />)}</div> : null}
    <div className="mastery-trial-hud"><strong>Trial of {definition.name}</strong>{duration ? <span>{Math.ceil(Math.max(0, duration - state.seconds))}s</span> : null}{state.key === "medic_bloom" || state.key === "medic_remedy" ? <span>Wave {Math.min(5,state.wave)}/5</span> : state.key === "tank_guard" ? <span>Wave {Math.min(4,state.wave)}/4 · Hit every blue obstacle</span> : null}{state.key === "medic_remedy" ? <label>Heat <meter min={0} max={10} value={state.heat} /> {state.heat}/10</label> : null}{state.key === "medic_salve" ? <span>Treated {state.treated}/4 · {Math.ceil(Math.max(0, 60 - state.treatmentSeconds))}s</span> : null}{state.key === "runner_vault" ? <span>Vaults {state.vaults}/20{state.poleDamaged ? " · Pole compromised" : ""}</span> : null}{state.key === "trickster_smoke" ? <span>Dissipators {state.dissipators}/2</span> : null}</div>
    {state.phase === "finale" || state.phase === "complete" ? <div className={`mastery-trial-finale mastery-finale-${state.key}`}><span aria-hidden="true" className="mastery-trophy">🏆</span><strong>{state.phase === "complete" ? replay ? `${definition.name} replay complete!` : `${definition.name} mastered!` : definition.finale}</strong>{replay ? <small>Practice replay · no rewards</small> : null}</div> : null}
    {state.phase === "failed" ? <div role="alert" className="mastery-trial-failed"><strong>Trial ended</strong><p>{state.failure}</p></div> : null}
  </div>;
}
