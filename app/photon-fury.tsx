"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "./skyway-client";
import { audioEngine, type Soundtrack } from "./audio-engine";
import { Obstacle } from "./obstacle-sprite";
import { PHOTON_GUIDE } from "./photon-guide";
import {
  activatePhotonSaber, advancePhotonRun, createPhotonRun, getPhotonCharacter,
  healPhoton, isPhotonCharacterKey, movePhoton, photonBonusPoints,
  photonRunReward, photonTotalPoints, photonObstacleSpeed, photonControlsLocked, wireTwistPhoton, PHOTON_CATEGORIES,
  PHOTON_CHARACTERS, PHOTON_STARTERS, type PhotonCharacterKey, type PhotonRun,
} from "./photon-fury-rules";

type Props = {
  userId: string | null; level: number; gems: number; testMode: boolean;
  soundtrack: Soundtrack; onGems: (gems: number) => void;
};
const CHARACTER_KEYS = Object.keys(PHOTON_CHARACTERS) as PhotonCharacterKey[];
const MISSING_CHARACTER_SETUP = "Photon character database setup is missing. Apply Photon Fury MISC before starting this version.";
const rpcError = (message: string) => message.includes("schema cache") ? MISSING_CHARACTER_SETUP : message;

function PhotonAvatar({ character, guarding = false, lane }: { character: PhotonCharacterKey; guarding?: boolean; lane?: number }) {
  return <div className={`runner photon-runner photon-character-${character}`} style={lane === undefined ? undefined : { left: `${(lane + .5) * 25}%` }}>
    <div className="head"/><div className="body"/>
    <i className="arm a1"/><i className="arm a2"/><i className="leg g1"/><i className="leg g2"/><em/>
    <i className="photon-accessory"/>{guarding && <i className="photon-blade"/>}
  </div>;
}

export function PhotonFury({ userId, level, gems, testMode, soundtrack, onGems }: Props) {
  const [unlocked, setUnlocked] = useState(false);
  const [balance, setBalance] = useState(0);
  const [loading, setLoading] = useState(Boolean(userId));
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [inventory, setInventory] = useState(false);
  const [savePending, setSavePending] = useState(false);
  const [selected, setSelected] = useState<PhotonCharacterKey>("photon_magician");
  const [owned, setOwned] = useState<PhotonCharacterKey[]>([]);
  const [run, setRun] = useState<PhotonRun>(() => createPhotonRun());
  const runRef = useRef(run);
  const runId = useRef<string | null>(null);
  const runTestMode = useRef(false);
  const settled = useRef(false);
  const mounted = useRef(true);
  const gesture = useRef<{ x: number; y: number } | null>(null);
  const publish = useCallback((next: PhotonRun) => { runRef.current = next; setRun(next); }, []);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    let active = true;
    if (!userId) return;
    void supabase.rpc("get_photon_fury_profile").then(({ data, error }) => {
      if (!active) return;
      setLoading(false);
      if (error) setStatus(rpcError(error.message));
      else {
        const available = Boolean(data?.unlocked);
        setUnlocked(available);
        setBalance(Number(data?.photons) || 0);
        const keys: PhotonCharacterKey[] = Array.isArray(data?.character_keys)
          ? data.character_keys.filter(isPhotonCharacterKey) : [];
        setOwned(available ? Array.from(new Set<PhotonCharacterKey>([...PHOTON_STARTERS, ...keys])) : []);
        if (isPhotonCharacterKey(data?.selected_character_key)) setSelected(data.selected_character_key);
      }
    });
    return () => { active = false; };
  }, [userId]);

  const finish = useCallback(async () => {
    if (settled.current) return;
    settled.current = true;
    setRunning(false);
    audioEngine.pause();
    const current = runRef.current;
    if (runTestMode.current) { setStatus(`TEST RUN · ${photonRunReward(current)} PHOTONS · NOT SAVED`); return; }
    if (!runId.current) return;
    setBusy(true);
    const { data, error } = await supabase.rpc("finish_photon_character_run", {
      p_run_id: runId.current, p_active_seconds: current.elapsed, p_reflections: current.reflections, p_extra_points: current.extraPoints,
    });
    if (!mounted.current) return;
    setBusy(false);
    if (error) {
      settled.current = false; setSavePending(true);
      setStatus(`Could not save: ${rpcError(error.message)}. Press SAVE RUN to retry.`);
    } else {
      setSavePending(false); setBalance(Number(data?.photons) || 0);
      setStatus(`+${Number(data?.awarded) || 0} PHOTONS`);
    }
  }, []);
  useEffect(() => () => {
    if (runRef.current.elapsed > 0 && !settled.current) void finish();
  }, [finish]);
  useEffect(() => {
    if (!running || paused || inventory) return;
    let last = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const previous = runRef.current;
      const next = advancePhotonRun(previous, (now - last) / 1000);
      last = now;
      publish(next);
      if (next.reflections > previous.reflections) void audioEngine.playSfx("shield");
      else if (next.hp < previous.hp) void audioEngine.playSfx("hit");
      else if (next.lane !== previous.lane) void audioEngine.playSfx("move");
      if (next.needleUntil > previous.needleUntil) void audioEngine.playSfx("freeze");
      if (next.chaosCountdown > previous.chaosCountdown) audioEngine.pause();
      if (previous.chaosCountdown > 0 && next.chaosCountdown === 0) void audioEngine.resume();
      if (previous.stage === "chaos" && next.stage === "normal") void audioEngine.playSfx("heal");
      if (next.hp <= 0) { void finish(); return; }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [finish, inventory, paused, publish, running]);
  const move = useCallback((direction: number) => {
    if (!running || paused || inventory) return;
    const previous = runRef.current;
    const next = movePhoton(previous, direction, Math.random());
    publish(next);
    if (next.lane !== previous.lane) void audioEngine.playSfx(next.hp < previous.hp ? "hit" : "move");
    if (next.hp <= 0) void finish();
  }, [finish, inventory, paused, publish, running]);
  const saber = useCallback(() => {
    if (!running || paused || inventory) return;
    const next = activatePhotonSaber(runRef.current);
    if (next !== runRef.current) { publish(next); void audioEngine.playSfx("shield"); }
  }, [inventory, paused, publish, running]);
  const heal = useCallback(() => {
    if (!running || paused || inventory) return;
    const next = healPhoton(runRef.current);
    if (next !== runRef.current) { publish(next); void audioEngine.playSfx("heal"); }
  }, [inventory, paused, publish, running]);
  const togglePause = useCallback(() => {
    if (!running) return;
    setPaused(value => !value);
    if (paused && runRef.current.chaosCountdown === 0) void audioEngine.resume(); else audioEngine.pause();
  }, [paused, running]);
  const wire = useCallback(() => {
    if (!running || paused || inventory) return;
    const next = wireTwistPhoton(runRef.current);
    if (next !== runRef.current) { publish(next); void audioEngine.playSfx("shield"); }
  }, [inventory, paused, publish, running]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && event.target.closest("input,textarea,select,[contenteditable=true]")) return;
      if (event.target instanceof HTMLElement && event.target.closest("button") && ["Enter", " "].includes(event.key)) return;
      const lower = event.key.toLowerCase();
      if (["a", "d", "q", "e", "arrowleft", "arrowright", "escape"].includes(lower)) event.preventDefault();
      if (lower === "q" && !event.repeat) saber();
      if (lower === "e" && !event.repeat) {
        if (getPhotonCharacter(runRef.current.characterKey).wireTwist) wire(); else heal();
      }
      if (lower === "a" || event.key === "ArrowLeft") move(-1);
      if (lower === "d" || event.key === "ArrowRight") move(1);
      if (event.key === "Escape") togglePause();
    };
    const hidden = () => { if (document.hidden) { setPaused(true); audioEngine.pause(); } };
    window.addEventListener("keydown", key);
    document.addEventListener("visibilitychange", hidden);
    return () => { window.removeEventListener("keydown", key); document.removeEventListener("visibilitychange", hidden); };
  }, [heal, move, saber, togglePause, wire]);

  const start = async () => {
    if (busy || savePending || (!unlocked && !testMode) || (!testMode && !owned.includes(selected))) return;
    setBusy(true); setStatus("");
    let runCharacter = selected;
    if (!testMode) {
      const { data, error } = await supabase.rpc("begin_photon_character_run", { p_character_key: selected });
      if (error) { setStatus(rpcError(error.message)); setBusy(false); return; }
      if (!data?.run_id || !isPhotonCharacterKey(data?.character_key)) {
        setStatus("Could not verify this Photon character."); setBusy(false); return;
      }
      runId.current = data.run_id; runCharacter = data.character_key;
    } else runId.current = null;
    runTestMode.current = testMode;
    settled.current = false; setSavePending(false); publish(createPhotonRun(runCharacter));
    setPaused(false); setInventory(false); setRunning(true); setBusy(false);
    void audioEngine.start(soundtrack);
  };
  const unlock = async () => {
    if (busy || !userId || level < 15 || gems < 100) return;
    setBusy(true);
    const { data, error } = await supabase.rpc("unlock_photon_fury");
    setBusy(false);
    if (error) setStatus(rpcError(error.message));
    else {
      setUnlocked(true); setOwned(keys => Array.from(new Set<PhotonCharacterKey>([...PHOTON_STARTERS, ...keys])));
      onGems(Number(data?.total_gems) || 0); setStatus("PHOTON FURY UNLOCKED");
    }
  };
  const equip = async (key: PhotonCharacterKey) => {
    if (running || busy || savePending || (!testMode && !owned.includes(key))) return;
    if (testMode) { setSelected(key); return; }
    setBusy(true);
    const { error } = await supabase.rpc("equip_photon_character", { p_character_key: key });
    setBusy(false);
    if (error) setStatus(rpcError(error.message)); else { setSelected(key); setStatus(`${getPhotonCharacter(key).name.toUpperCase()} EQUIPPED`); }
  };
  const current = getPhotonCharacter(run.characterKey);
  const selectedDefinition = getPhotonCharacter(selected);
  const cooldown = Math.max(0, run.cooldownUntil - run.elapsed);
  const healCooldown = Math.max(0, run.healCooldownUntil - run.elapsed);
  const bonus = photonBonusPoints(run);
  const controlsLocked = photonControlsLocked(run);
  const saberDelay = Math.max(0,(run.saberStartsAt ?? 0)-run.elapsed);
  const wireCooldown = Math.max(0,run.wireCooldownUntil-run.elapsed);

  return <section className="photon-panel" id="main-game-panel" aria-label="Photon Fury">
    <header className="photon-heading">
      <div><small>LASERDROME · 4 LANES</small><h2>PHOTON FURY</h2></div>
      <strong>✦ {balance.toLocaleString()} PHOTONS</strong>
      <button onClick={() => { setInventory(value => !value); if (running && !inventory) audioEngine.pause(); else if (running && !paused && run.chaosCountdown === 0) void audioEngine.resume(); }}>INVENTORY</button>
    </header>
    {inventory ? <section className="photon-inventory">
      <h3>PHOTON FURY INVENTORY</h3><p>Photon Fury characters only. Select your character before starting a run.</p>
      {PHOTON_CATEGORIES.map(category => <details className="photon-category" key={category} open={category === "traditional"}>
        <summary>{category.toUpperCase()}</summary>
        <div className="photon-character-grid">{CHARACTER_KEYS.filter(key => getPhotonCharacter(key).category === category).map(key => {
          const character = getPhotonCharacter(key);
          const available = testMode || owned.includes(key);
          return <article className={`photon-character-card${selected === key ? " selected" : ""}`} key={key}>
            <div className="photon-portrait" aria-label={`${character.name} character`}><PhotonAvatar character={key}/></div>
            <div><h4>{character.name}</h4><p>{character.description}</p>
              <dl><div><dt>STARTING / MAX HP</dt><dd>{character.maxHp}</dd></div><div><dt>DURABILITY</dt><dd>{character.durability}</dd></div><div><dt>GUARD</dt><dd>{character.guardSeconds}s</dd></div><div><dt>COOLDOWN</dt><dd>{character.cooldownSeconds}s</dd></div></dl>
              <button disabled={!available || busy || running || savePending || selected === key} onClick={() => void equip(key)}>
                {selected === key && available ? "EQUIPPED" : available ? testMode && !owned.includes(key) ? "EQUIP · TEST MODE" : "EQUIP" : "LOCKED"}
              </button>
            </div>
          </article>;
        })}</div>
        {!CHARACTER_KEYS.some(key => getPhotonCharacter(key).category === category) && <p>More characters coming soon.</p>}
      </details>)}
      <p className="photon-inventory-note">Lightsabers reflect one hazard per swing. Cars use 1 durability. Missing costs 0.5 HP, except for Wizard.</p>
      <button onClick={() => { setInventory(false); if (running && !paused && run.chaosCountdown === 0) void audioEngine.resume(); }}>BACK {running ? "TO RUN" : "TO MENU"}</button>
    </section> : <>
      {!running ? <div className="photon-lobby">
        <h3>{run.elapsed > 0 ? "RUN COMPLETE" : "DODGE. BLOCK. EARN PHOTONS."}</h3>
        <div className="photon-equipped"><div className="photon-portrait"><PhotonAvatar character={selected}/></div><div><b>{selectedDefinition.name.toUpperCase()}</b><p>{selectedDefinition.description}</p><button onClick={() => setInventory(true)}>CHOOSE CHARACTER</button></div></div>
        <p>{PHOTON_GUIDE.introduction}</p>
        {run.elapsed > 0 && <div className="photon-results">
          <b>{run.reflections} REFLECTIONS</b><b>{photonTotalPoints(run)} POINTS</b>{bonus > 0 && <b>INCLUDES {bonus} MAGICIAN POINTS</b>}
          <b>{photonRunReward(run)} PHOTONS</b>
        </div>}
        {unlocked || testMode ? <button disabled={busy || savePending || (!testMode && !owned.includes(selected))} onClick={() => void start()}>{busy ? "SAVING…" : "START RUN"}</button> : <>
          <p>{!userId ? "SIGN IN TO UNLOCK" : level < 15 ? `UNLOCKS AT LEVEL 15 · YOUR LEVEL: ${level}` : "100 GEMS TO UNLOCK"}</p>
          <button disabled={loading || busy || !userId || level < 15 || gems < 100} onClick={() => void unlock()}>UNLOCK · 100 GEMS</button>
        </>}
        {savePending && <button disabled={busy} onClick={() => void finish()}>SAVE RUN</button>}
      </div> : <>
        <div className="photon-hud"><b>{photonTotalPoints(run)} POINTS</b><span>{current.name.toUpperCase()}</span><span>{photonObstacleSpeed(run).toFixed(2)}× SPEED</span></div>
        {current.invertedControls && <div className="photon-inverted-controls" role="status">CONTROLS REVERSED · LEFT MOVES RIGHT · RIGHT MOVES LEFT</div>}
        {run.characterKey === "photon_bear" && <div className="photon-stage-meter">{run.stage === "chaos" ? "CHAOS" : "NORMAL"} · {Math.max(0,run.stageEndsAt-run.elapsed).toFixed(1)}s{run.stage === "chaos" ? " · 3× POINTS / 2× DAMAGE" : " UNTIL CHAOS"}</div>}
        <div className="playfield photon-playfield">
          <div className="sky" aria-hidden="true"><i/><i/><i/></div>
          <div className="horizon" aria-hidden="true">{Array.from({length:9},(_,i)=><span key={i}/>)}</div>
        <div className={`road photon-arena${run.guardUntil > run.elapsed ? " guarding" : ""}${run.needleUntil > run.elapsed ? " needled" : ""}${run.stage === "chaos" ? " photon-chaos" : ""}`} onPointerDown={event => { gesture.current = { x: event.clientX, y: event.clientY }; }} onPointerUp={event => {
          const origin = gesture.current; gesture.current = null; if (!origin) return;
          const dx = event.clientX - origin.x; const dy = event.clientY - origin.y;
          if (Math.abs(dx) > 25 && Math.abs(dx) > Math.abs(dy)) move(Math.sign(dx));
          else if (Math.abs(dx) < 25 && Math.abs(dy) < 25) {
            const rect = event.currentTarget.getBoundingClientRect();
            const target = Math.min(3, Math.floor((event.clientX - rect.left) / rect.width * 4));
            move(Math.sign(target - runRef.current.lane));
          }
        }}>
          {[1, 2, 3].map(lane => <i key={lane} className="line lane-divider" style={{ left: `${lane * 25}%` }}/>) }
          {run.items.map(item => <div key={item.id} className={`item ${item.kind === "spike" ? "spikes" : item.kind} photon-obstacle`} style={{ left: `${(item.lane + .5) * 25}%`, top: `${item.y * 100}%` }} aria-label={item.kind}><Obstacle kind={item.kind}/></div>)}
          <PhotonAvatar character={run.characterKey} lane={run.lane} guarding={run.guardUntil > run.elapsed}/>
          {run.needleUntil > run.elapsed && <span className="photon-needle-status">NEEDLE {(run.needleUntil - run.elapsed).toFixed(1)}s</span>}
          {run.chaosCountdown > 0 && !paused && <div className="photon-chaos-countdown" role="status"><h3>CHAOS STARTS IN</h3><strong>{Math.ceil(run.chaosCountdown)}</strong><p>3× reflection points · 2× obstacle damage</p></div>}
          {run.stageNoticeUntil > run.elapsed && run.chaosCountdown === 0 && <div className={`photon-stage-announcement ${run.stage}`} role="status">{run.stage === "chaos" ? "CHAOS STAGE" : "NORMAL STAGE"}</div>}
          {paused && <div className="photon-pause"><h3>PAUSED</h3><button onClick={togglePause}>RESUME</button><button onClick={() => void finish()}>END RUN</button></div>}
        </div>
        </div>
        <footer className="photon-footer">
          <span className="health" aria-label={`${run.hp} of ${current.maxHp} hearts`}>{Array.from({ length: current.maxHp }, (_, index) => <span key={index} className={`heart-glyph ${run.hp - index >= 1 ? "" : run.hp - index > 0 ? "partial" : "lost"}`}>♥</span>)}</span>
          <div className="photon-turn-buttons" aria-label="Lane controls">
            <button aria-label="Left lane control" disabled={paused || controlsLocked || run.pendingTurn !== null} onClick={() => move(-1)}>←</button>
            <button aria-label="Right lane control" disabled={paused || controlsLocked || run.pendingTurn !== null} onClick={() => move(1)}>→</button>
          </div>
          <div className="photon-abilities">
            <button className="photon-weapon" onClick={saber} disabled={paused || controlsLocked || run.durability <= 0 || cooldown > 0 || run.guardUntil > run.elapsed || run.saberStartsAt !== null}>
              <b>LIGHTSABER · Q</b><strong>{run.durability <= 0 ? "BROKEN" : run.saberStartsAt !== null ? `${saberDelay.toFixed(2)}s · INPUT DELAY` : run.guardUntil > run.elapsed ? `${(run.guardUntil - run.elapsed + current.cooldownSeconds).toFixed(1)}s · GUARD` : `${cooldown.toFixed(1)}s`}</strong><small>{run.durability}/{current.durability} DURABILITY</small>
            </button>
            {current.healAmount > 0 && <button className="photon-heal" onClick={heal} disabled={paused || controlsLocked || run.durability <= 0 || healCooldown > 0 || run.hp >= current.maxHp}>
              <b>HEAL 0.5 HP · E</b><strong>{run.durability <= 0 ? "SABER BROKEN" : healCooldown > 0 ? `${healCooldown.toFixed(1)}s` : run.hp >= current.maxHp ? "FULL HP" : "READY"}</strong>
            </button>}
            {current.wireTwist && <button className="photon-wire" onClick={wire} disabled={paused || controlsLocked || wireCooldown > 0 || !run.items.some(item=>item.lane===run.lane)}>
              <b>WIRE TWIST · E</b><strong>{wireCooldown > 0 ? `${wireCooldown.toFixed(1)}s` : run.items.some(item=>item.lane===run.lane) ? "READY" : "EMPTY LANE"}</strong>
            </button>}
          </div>
          <small>A/D or ←/→ · Q GUARD{current.healAmount > 0 ? " · E HEAL" : current.wireTwist ? " · E WIRE TWIST" : ""}</small><button onClick={togglePause}>{paused ? "RESUME" : "PAUSE"}</button>
        </footer>
      </>}
    </>}
    {status && <p className="photon-status" role="status">{status}</p>}
    <details className="photon-guide" open={!running && !inventory}><summary>HOW TO PLAY</summary>
      <ol>{PHOTON_GUIDE.steps.map(step=><li key={step.title}><b>{step.title}.</b> {step.text}</li>)}</ol>
      <p>{PHOTON_GUIDE.needle}</p>
    </details>
  </section>;
}
