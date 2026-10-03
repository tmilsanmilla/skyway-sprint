"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "./skyway-client";
import { audioEngine, type Soundtrack } from "./audio-engine";
import { activatePhotonSaber, advancePhotonRun, createPhotonRun, movePhoton, photonReward, photonScore, photonSpeed, type PhotonRun } from "./photon-fury-rules";

type Props = { userId: string | null; level: number; gems: number; testMode: boolean; soundtrack: Soundtrack; onGems: (gems: number) => void };
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
  const [run, setRun] = useState<PhotonRun>(createPhotonRun);
  const runRef = useRef(run);
  const runId = useRef<string | null>(null);
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
      if (error) setStatus(error.message);
      else { setUnlocked(Boolean(data?.unlocked)); setBalance(Number(data?.photons) || 0); }
    });
    return () => { active = false; };
  }, [userId]);
  const finish = useCallback(async () => {
    if (settled.current) return;
    settled.current = true;
    setRunning(false);
    audioEngine.pause();
    const current = runRef.current;
    const reward = photonReward(current.photons, photonScore(current.elapsed));
    if (testMode) { setStatus(`TEST RUN · ${reward} PHOTONS · NOT SAVED`); return; }
    if (!runId.current) return;
    setBusy(true);
    const { data, error } = await supabase.rpc("finish_photon_fury_run", { p_run_id: runId.current, p_active_seconds: current.elapsed, p_reflections: current.photons });
    if (!mounted.current) return;
    setBusy(false);
    if (error) { settled.current = false; setSavePending(true); setStatus(`Could not save: ${error.message}. Press SAVE RUN to retry.`); }
    else { setSavePending(false); setBalance(Number(data?.photons) || 0); setStatus(`+${Number(data?.awarded) || 0} PHOTONS`); }
  }, [testMode]);
  useEffect(() => () => {
    // Leaving the tab ends this run. Use its receipt to save any earned Photons.
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
      if (next.photons > previous.photons) void audioEngine.playSfx("shield");
      else if (next.hp < previous.hp) void audioEngine.playSfx("hit");
      if (next.needleUntil > previous.needleUntil) void audioEngine.playSfx("freeze");
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
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && event.target.closest("input,textarea,select,[contenteditable=true]")) return;
      if (event.target instanceof HTMLElement && event.target.closest("button") && ["Enter"," "].includes(event.key)) return;
      if (["a", "d", "ArrowLeft", "ArrowRight", "q", "Escape"].includes(event.key)) event.preventDefault();
      if (event.key.toLowerCase() === "q" && !event.repeat) saber();
      if (event.key.toLowerCase() === "a" || event.key === "ArrowLeft") move(-1);
      if (event.key.toLowerCase() === "d" || event.key === "ArrowRight") move(1);
      if (event.key === "Escape" && running) setPaused(value => !value);
    };
    const hidden = () => { if (document.hidden) setPaused(true); };
    window.addEventListener("keydown", key);
    document.addEventListener("visibilitychange", hidden);
    return () => { window.removeEventListener("keydown", key); document.removeEventListener("visibilitychange", hidden); };
  }, [move, running, saber]);
  const start = async () => {
    if (busy || (!unlocked && !testMode)) return;
    setBusy(true); setStatus("");
    if (!testMode) {
      const { data, error } = await supabase.rpc("begin_photon_fury_run");
      if (error) { setStatus(error.message); setBusy(false); return; }
      runId.current = data?.run_id ?? null;
      if (!runId.current) { setStatus("Could not start the run."); setBusy(false); return; }
    } else runId.current = null;
    settled.current = false; setSavePending(false); publish(createPhotonRun()); setPaused(false); setInventory(false); setRunning(true); setBusy(false);
    void audioEngine.start(soundtrack);
  };
  const unlock = async () => {
    if (busy || !userId || level < 15 || gems < 100) return;
    setBusy(true);
    const { data, error } = await supabase.rpc("unlock_photon_fury");
    setBusy(false);
    if (error) setStatus(error.message);
    else { setUnlocked(true); onGems(Number(data?.total_gems) || 0); setStatus("PHOTON FURY UNLOCKED"); }
  };
  const cooldown = Math.max(0, run.cooldownUntil - run.elapsed);
  return <section className="photon-panel" id="main-game-panel" aria-label="Photon Fury">
    <header className="photon-heading"><div><small>LASERDROME · 4 LANES</small><h2>PHOTON FURY</h2></div><strong>✦ {balance.toLocaleString()} PHOTONS</strong><button onClick={() => setInventory(value => !value)}>INVENTORY</button></header>
    {inventory ? <section className="photon-inventory"><h3>PHOTON FURY INVENTORY</h3><article><span className="photon-saber-icon">╱</span><div><h4>LIGHTSABER</h4><p>Q guards for 0.4s and reflects one obstacle for a Photon. Cooldown: 0.6s after the swing ends. Missing costs 0.5 HP. Seven durability; a blocked Car uses one.</p><b>{unlocked || testMode ? "EQUIPPED" : "UNLOCK PHOTON FURY TO USE"}</b></div></article><button onClick={() => setInventory(false)}>BACK {running ? "TO RUN" : "TO MENU"}</button></section> : <>
      {!running ? <div className="photon-lobby"><h3>{run.elapsed > 0 ? "RUN COMPLETE" : "REFLECT. SURVIVE. COLLECT."}</h3><p>Four hearts. No healing. Reflect hazards with Q to earn Photons while the Laserdrome gets faster.</p><p>Needles stack four seconds of risk: each lane change has a 35% chance of costing half a heart.</p>{run.elapsed > 0 && <div className="photon-results"><b>{run.photons} REFLECTIONS</b><b>SCORE {Math.floor(photonScore(run.elapsed))}</b><b>{photonReward(run.photons, photonScore(run.elapsed))} PHOTONS</b></div>}{unlocked || testMode ? <button disabled={busy || savePending} onClick={() => void start()}>{busy ? "SAVING…" : "START RUN"}</button> : <><p>{!userId ? "SIGN IN TO UNLOCK" : level < 15 ? `UNLOCKS AT LEVEL 15 · YOUR LEVEL: ${level}` : "100 GEMS TO UNLOCK"}</p><button disabled={loading || busy || !userId || level < 15 || gems < 100} onClick={() => void unlock()}>UNLOCK · 100 GEMS</button></>}{savePending && <button disabled={busy} onClick={() => void finish()}>SAVE RUN</button>}</div> : <>
        <div className="photon-hud"><b>✦ {run.photons}</b><span>SCORE {photonScore(run.elapsed).toFixed(2)}</span><span>{photonSpeed(run.elapsed).toFixed(2)}× SPEED</span></div>
        <div className={`photon-arena${run.guardUntil > run.elapsed ? " guarding" : ""}${run.needleUntil > run.elapsed ? " needled" : ""}`} onPointerDown={event => { gesture.current = { x: event.clientX, y: event.clientY }; }} onPointerUp={event => { const origin = gesture.current; gesture.current = null; if (!origin) return; const dx = event.clientX - origin.x; const dy = event.clientY - origin.y; if (Math.abs(dx) > 25 && Math.abs(dx) > Math.abs(dy)) move(Math.sign(dx)); else if (Math.abs(dx) < 25 && Math.abs(dy) < 25) { const rect = event.currentTarget.getBoundingClientRect(); const target = Math.min(3, Math.floor((event.clientX - rect.left) / rect.width * 4)); move(Math.sign(target - runRef.current.lane)); } }}>
          {[0, 1, 2, 3].map(lane => <div key={lane} className="photon-lane" style={{ left: `${lane * 25}%` }} />)}
          {run.items.map(item => <div key={item.id} className={`photon-obstacle photon-${item.kind}`} style={{ left: `${(item.lane + .5) * 25}%`, top: `${item.y * 100}%` }} aria-label={item.kind}><i/><i/><i/></div>)}
          <div className="photon-runner" style={{ left: `${(run.lane + .5) * 25}%` }}><i className="photon-head"/><i className="photon-body"/><i className="photon-feet"/>{run.guardUntil > run.elapsed && <i className="photon-blade"/>}</div>
          {run.needleUntil > run.elapsed && <span className="photon-needle-status">NEEDLE {(run.needleUntil - run.elapsed).toFixed(1)}s</span>}
          <button className="photon-weapon" onPointerDown={event => event.stopPropagation()} onPointerUp={event => event.stopPropagation()} onClick={saber} disabled={paused || run.durability <= 0 || cooldown > 0 || run.guardUntil > run.elapsed}><b>LIGHTSABER · Q</b><strong>{run.durability <= 0 ? "BROKEN" : run.guardUntil > run.elapsed ? `${(run.guardUntil-run.elapsed+.6).toFixed(1)}s · GUARD` : `${cooldown.toFixed(1)}s`}</strong><small>{run.durability}/7 DURABILITY</small></button>
          {paused && <div className="photon-pause"><h3>PAUSED</h3><button onClick={() => { setPaused(false); void audioEngine.resume(); }}>RESUME</button><button onClick={() => void finish()}>END RUN</button></div>}
        </div>
        <footer className="photon-footer"><span aria-label={`${run.hp} of 4 hearts`}>{[0, 1, 2, 3].map(index => <span key={index} className={`photon-heart ${run.hp - index >= 1 ? "" : run.hp - index > 0 ? "half" : "empty"}`}>♥</span>)}</span><small>A/D or ←/→ · Q GUARD</small><button onClick={() => { setPaused(value => !value); if (!paused) audioEngine.pause(); else void audioEngine.resume(); }}> {paused ? "RESUME" : "PAUSE"}</button></footer>
      </>}
    </>}
    {status && <p className="photon-status" role="status">{status}</p>}
    <details className="photon-guide"><summary>HOW TO PLAY</summary><p>Reflect a single hazard per swing. Cars consume Lightsaber durability; Rocks deal 2 HP, Cars/Logs/Spikes 1 HP, and Barrels 0.5 HP if they hit you. Needles can be reflected too. Longer active runs increase your Photon payout; pauses and menus stop the clock.</p></details>
  </section>;
}
