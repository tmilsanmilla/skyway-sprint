"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { supabase } from "./skyway-client";
import { audioEngine, type Soundtrack } from "./audio-engine";
import { Obstacle } from "./obstacle-sprite";
import { PHOTON_GUIDE } from "./photon-guide";
import { PhotonCollection, type PhotonRewardView } from "./photon-collection";
import { PhotonAvatar } from "./photon-avatar";
import { DEFAULT_PHOTON_THEME, PHOTON_THEMES } from "./photon-collection-rules";
import {
  activatePhotonSaber,
  advancePhotonRun,
  createPhotonRun,
  getPhotonCharacter,
  isPhotonCharacterKey,
  movePhoton,
  getOwnedPhotonCharacters,
  resolveOwnedPhotonCharacter,
  photonRunReward,
  photonTotalPoints,
  photonObstacleSpeed,
  photonControlsLocked,
  PHOTON_CATEGORIES,
  activatePhotonAbility,
  dashPhoton,
  selectPhotonTimeStopLane,
  armPhotonLaser,
  erasePhotonHazard,
  PHOTON_CHARACTERS,
  PHOTON_WEAPONS,
  PHOTON_RULES,
  isPhotonWeaponKey,
  isPhotonWeaponCompatible,
  type PhotonWeaponKey,
  type PhotonCharacterKey,
  type PhotonRun,
} from "./photon-fury-rules";

type Props = {
  userId: string | null;
  level: number;
  gems: number;
  testMode: boolean;
  soundtrack: Soundtrack;
  onGems: (gems: number) => void;
  onStardust?: (stardust: number) => void;
};
const CHARACTER_KEYS = Object.keys(PHOTON_CHARACTERS) as PhotonCharacterKey[];
const MISSING_CHARACTER_SETUP =
  "Photon character database setup is missing. Apply Photon Fury MISC before starting this version.";
const rpcError = (message: string) =>
  message.includes("schema cache") ? MISSING_CHARACTER_SETUP : message;

export function PhotonFury({
  userId,
  level,
  gems,
  testMode,
  soundtrack,
  onGems,
  onStardust,
}: Props) {
  const [unlocked, setUnlocked] = useState(false);
  const [balance, setBalance] = useState(0);
  const [loading, setLoading] = useState(Boolean(userId));
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [running, setRunning] = useState(false);
  const [paused, setPaused] = useState(false);
  const [inventory, setInventory] = useState(false);
  const [savePending, setSavePending] = useState(false);
  const [selected, setSelected] =
    useState<PhotonCharacterKey>("photon_magician");
  const [owned, setOwned] = useState<PhotonCharacterKey[]>([]);
  const [weapon, setWeapon] = useState<PhotonWeaponKey>("lightsaber");
  const [ownedWeapons, setOwnedWeapons] = useState<PhotonWeaponKey[]>([]);
  const [skins, setSkins] = useState<string[]>([]);
  const [skinChoices, setSkinChoices] = useState<Record<string, string>>({});
  const [themes, setThemes] = useState<string[]>([]);
  const [theme, setTheme] = useState("default");
  const [boxResults, setBoxResults] = useState<PhotonRewardView[]>([]);
  const [boxNonce, setBoxNonce] = useState<string | null>(null);
  const [damage, setDamage] = useState(0);
  const damageTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [run, setRun] = useState<PhotonRun>(() => createPhotonRun());
  const runRef = useRef(run);
  const runId = useRef<string | null>(null);
  const runTestMode = useRef(false);
  const settled = useRef(false);
  const mounted = useRef(true);
  const gesture = useRef<{ x: number; y: number } | null>(null);
  const publish = useCallback((next: PhotonRun) => {
    const lost = runRef.current.hp - next.hp;
    if (lost > 0) {
      setDamage(lost);
      if (damageTimer.current) clearTimeout(damageTimer.current);
      damageTimer.current = setTimeout(() => setDamage(0), 800);
    }
    if (next.weaponShockAt > runRef.current.weaponShockAt)
      void audioEngine.playSfx("joltShock");
    runRef.current = next;
    setRun(next);
  }, []);
  const applyProfile = useCallback((data: Record<string, unknown>) => {
    const available = Boolean(data?.unlocked),
      keys = getOwnedPhotonCharacters(available, data?.character_keys);
    setUnlocked(available);
    setBalance(Number(data?.photons) || 0);
    setOwned(keys);
    setSelected(
      resolveOwnedPhotonCharacter(data?.selected_character_key, keys),
    );
    setWeapon(
      isPhotonWeaponKey(data?.selected_weapon_key)
        ? data.selected_weapon_key
        : "lightsaber",
    );
    setOwnedWeapons(
      Array.isArray(data?.weapon_keys)
        ? data.weapon_keys.filter(isPhotonWeaponKey)
        : [],
    );
    setSkins(
      Array.isArray(data?.skin_keys)
        ? data.skin_keys.filter((k): k is string => typeof k === "string")
        : [],
    );
    setThemes(
      Array.isArray(data?.theme_keys)
        ? data.theme_keys.filter((k): k is string => typeof k === "string")
        : [],
    );
    setTheme(
      typeof data?.selected_theme_key === "string"
        ? data.selected_theme_key
        : "default",
    );
    setBoxNonce(typeof data?.box_nonce === "string" ? data.box_nonce : null);
    setSkinChoices(
      data?.skin_choices && typeof data.skin_choices === "object"
        ? (data.skin_choices as Record<string, string>)
        : {},
    );
  }, []);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (damageTimer.current) clearTimeout(damageTimer.current);
    };
  }, []);
  useEffect(() => {
    let active = true;
    if (!userId) return;
    void supabase.rpc("get_photon_fury_profile").then(({ data, error }) => {
      if (!active) return;
      setLoading(false);
      if (error) setStatus(rpcError(error.message));
      else {
        applyProfile(data);
      }
    });
    return () => {
      active = false;
    };
  }, [userId, applyProfile]);

  const finish = useCallback(async () => {
    if (settled.current) return;
    settled.current = true;
    setRunning(false);
    audioEngine.pause();
    const current = runRef.current;
    if (runTestMode.current) {
      setStatus(`TEST RUN · ${photonRunReward(current)} PHOTONS · NOT SAVED`);
      return;
    }
    if (!runId.current) return;
    setBusy(true);
    const { data, error } = await supabase.rpc("finish_photon_character_run", {
      p_run_id: runId.current,
      p_active_seconds: current.elapsed,
      p_reflections: current.reflections,
      p_extra_points:
        current.extraPoints +
        Math.max(
          0,
          photonTotalPoints(current) -
            current.extraPoints -
            current.reflections *
              getPhotonCharacter(current.characterKey).pointMultiplier -
            Math.floor(
              current.elapsed /
                (getPhotonCharacter(current.characterKey).bonusPointSeconds ||
                  Infinity),
            ),
        ),
    });
    if (!mounted.current) return;
    setBusy(false);
    if (error) {
      settled.current = false;
      setSavePending(true);
      setStatus(
        `Could not save: ${rpcError(error.message)}. Press SAVE RUN to retry.`,
      );
    } else {
      setSavePending(false);
      setBalance(Number(data?.photons) || 0);
      setStatus(`+${Number(data?.awarded) || 0} PHOTONS`);
    }
  }, []);
  useEffect(
    () => () => {
      if (runRef.current.elapsed > 0 && !settled.current) void finish();
    },
    [finish],
  );
  useEffect(() => {
    if (!running || paused || inventory || run.timeStop) return;
    let last = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const previous = runRef.current;
      const next = advancePhotonRun(previous, (now - last) / 1000);
      last = now;
      publish(next);
      if (next.reflections > previous.reflections)
        void audioEngine.playSfx("shield");
      else if (next.hp < previous.hp) void audioEngine.playSfx("hit");
      else if (next.lane !== previous.lane) void audioEngine.playSfx("move");
      if (next.needleUntil > previous.needleUntil)
        void audioEngine.playSfx("freeze");
      if (next.chaosCountdown > previous.chaosCountdown) audioEngine.pause();
      if (previous.chaosCountdown > 0 && next.chaosCountdown === 0)
        void audioEngine.resume();
      if (previous.stage === "chaos" && next.stage === "normal")
        void audioEngine.playSfx("heal");
      if (next.hp <= 0) {
        void finish();
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [finish, inventory, paused, publish, running, run.timeStop]);
  const move = useCallback(
    (direction: number) => {
      if (!running || paused || inventory) return;
      const previous = runRef.current;
      const next = movePhoton(previous, direction, Math.random);
      publish(next);
      if (next.lane !== previous.lane)
        void audioEngine.playSfx(next.hp < previous.hp ? "hit" : "move");
      if (next.hp <= 0) void finish();
    },
    [finish, inventory, paused, publish, running],
  );
  const saber = useCallback(() => {
    if (!running || paused || inventory) return;
    const next = activatePhotonSaber(runRef.current);
    if (next !== runRef.current) {
      publish(next);
      void audioEngine.playSfx("lightsaber");
    }
  }, [inventory, paused, publish, running]);
  const ability = useCallback(() => {
    if (!running || paused || inventory) return;
    const next = activatePhotonAbility(runRef.current);
    if (next !== runRef.current) {
      publish(next);
      void audioEngine.playSfx("shield");
      if (next.timeStop) audioEngine.pause();
    }
    if (next.hp <= 0) void finish();
  }, [finish, inventory, paused, publish, running]);
  const togglePause = useCallback(() => {
    if (!running) return;
    setPaused((value) => !value);
    if (paused && runRef.current.chaosCountdown === 0)
      void audioEngine.resume();
    else audioEngine.pause();
  }, [paused, running]);
  const timeLane = useCallback(
    (lane: number) => {
      const next = selectPhotonTimeStopLane(runRef.current, lane);
      if (next !== runRef.current) {
        publish(next);
        if (!paused && !inventory) void audioEngine.resume();
      }
      if (next.hp <= 0) void finish();
    },
    [finish, inventory, paused, publish],
  );
  const dashLeft = useCallback(() => {
    if (!running || paused || inventory) return;
    const next = dashPhoton(runRef.current, -1);
    publish(next);
    if (next.hp <= 0) void finish();
  }, [finish, inventory, paused, publish, running]);
  const laser = useCallback(() => {
    if (running && !paused && !inventory)
      publish(armPhotonLaser(runRef.current));
  }, [inventory, paused, publish, running]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (
        event.target instanceof HTMLElement &&
        event.target.closest("input,textarea,select,[contenteditable=true]")
      )
        return;
      if (
        event.target instanceof HTMLElement &&
        event.target.closest("button") &&
        ["Enter", " "].includes(event.key)
      )
        return;
      const lower = event.key.toLowerCase();
      if (runRef.current.timeStop) {
        const lane = ["z", "x", "c", "v"].indexOf(lower);
        if (lane >= 0) {
          event.preventDefault();
          timeLane(lane);
        }
        return;
      }
      if (
        [
          "a",
          "d",
          "q",
          "e",
          "w",
          "f",
          "arrowleft",
          "arrowright",
          "escape",
        ].includes(lower)
      )
        event.preventDefault();
      if (lower === "q" && !event.repeat) saber();
      if (lower === "e" && !event.repeat) ability();
      if (lower === "w" && !event.repeat) dashLeft();
      if (lower === "f" && !event.repeat) laser();
      if (lower === "a" || event.key === "ArrowLeft") move(-1);
      if (lower === "d" || event.key === "ArrowRight") move(1);
      if (event.key === "Escape") togglePause();
    };
    const hidden = () => {
      if (document.hidden) {
        setPaused(true);
        audioEngine.pause();
      }
    };
    window.addEventListener("keydown", key);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("keydown", key);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [ability, dashLeft, laser, move, saber, timeLane, togglePause]);

  const start = async () => {
    if (
      busy ||
      savePending ||
      (!unlocked && !testMode) ||
      (!testMode && !owned.includes(selected)) ||
      !isPhotonWeaponCompatible(weapon, selected)
    )
      return;
    setBusy(true);
    setStatus("");
    let runCharacter = selected;
    let runWeapon = weapon;
    if (!testMode) {
      const { data, error } = await supabase.rpc("begin_photon_character_run", {
        p_character_key: selected,
      });
      if (!mounted.current) return;
      if (error) {
        setStatus(rpcError(error.message));
        setBusy(false);
        return;
      }
      if (!data?.run_id || !isPhotonCharacterKey(data?.character_key) || data.rules_version !== PHOTON_RULES.version) {
        setStatus("Photon Fury needs its matching database update before a run can start.");
        setBusy(false);
        return;
      }
      runId.current = data.run_id;
      runCharacter = data.character_key;
      if (!isPhotonWeaponKey(data.weapon_key)) {
        setStatus("Could not verify this Photon weapon.");
        setBusy(false);
        return;
      }
      runWeapon = data.weapon_key;
    } else runId.current = null;
    runTestMode.current = testMode;
    settled.current = false;
    setSavePending(false);
    publish(createPhotonRun(runCharacter, runWeapon));
    setPaused(false);
    setInventory(false);
    setRunning(true);
    setBusy(false);
    void audioEngine.start(soundtrack);
  };
  const unlock = async () => {
    if (busy || !userId || level < PHOTON_RULES.unlockLevel || gems < PHOTON_RULES.price) return;
    setBusy(true);
    const { data, error } = await supabase.rpc("unlock_photon_fury");
    if (!mounted.current) return;
    setBusy(false);
    if (error) setStatus(rpcError(error.message));
    else {
      setUnlocked(true);
      setOwned((keys) => getOwnedPhotonCharacters(true, keys));
      onGems(Number(data?.total_gems) || 0);
      setStatus("PHOTON FURY UNLOCKED");
      const { data: profile } = await supabase.rpc("get_photon_fury_profile");
      if (mounted.current && profile) applyProfile(profile);
    }
  };
  const equip = async (key: PhotonCharacterKey) => {
    if (running || busy || savePending || (!testMode && !owned.includes(key)))
      return;
    if (testMode) {
      setSelected(key);
      return;
    }
    setBusy(true);
    const { data, error } = await supabase.rpc("equip_photon_character", {
      p_character_key: key,
    });
    if (!mounted.current) return;
    setBusy(false);
    if (error) setStatus(rpcError(error.message));
    else {
      applyProfile(data);
      setStatus(`${getPhotonCharacter(key).name.toUpperCase()} EQUIPPED`);
    }
  };
  const equipItem = async (key: string) => {
    if (busy || running || savePending) return;
    setBusy(true);
    const { data, error } = await supabase.rpc("equip_photon_character", {
      p_character_key: key,
    });
    if (!mounted.current) return;
    setBusy(false);
    if (error) setStatus(rpcError(error.message));
    else {
      applyProfile(data);
      setStatus("LOADOUT SAVED");
    }
  };
  const openBox = async () => {
    if (busy || running || savePending || balance < 200 || !boxNonce) return;
    setBusy(true);
    setBoxResults([]);
    const { data, error } = await supabase.rpc("extract_items", {
      pull_count: 1,
      box_type: `photon:${boxNonce}`,
    });
    if (!mounted.current) return;
    setBusy(false);
    if (error) setStatus(error.message);
    else {
      applyProfile(data.profile);
      onGems(Number(data.gems));
      if (Number.isFinite(Number(data.stardust))) onStardust?.(Number(data.stardust));
      setBoxResults(data.results ?? []);
      setStatus("MYSTERY BOX OPENED");
    }
  };
  const buyWeapon = async (key: PhotonWeaponKey) => {
    if (busy || running || savePending || level < 40) return;
    setBusy(true);
    const { data, error } = await supabase.rpc("purchase_catalog_item", {
      p_item_key: `photon_weapon_${key}`,
    });
    if (!mounted.current) return;
    setBusy(false);
    if (error) setStatus(error.message);
    else {
      applyProfile(data.profile);
      onGems(Number(data.gems));
      setStatus("WEAPON UNLOCKED");
    }
  };
  const current = getPhotonCharacter(run.characterKey);
  const selectedDefinition = getPhotonCharacter(selected);
  const cooldown = Math.max(0, run.cooldownUntil - run.elapsed);
  const controlsLocked = photonControlsLocked(run);
  const saberDelay = Math.max(0, (run.saberStartsAt ?? 0) - run.elapsed);
  const abilityCooldown = Math.max(
    0,
    (current.ability === "heal"
      ? run.healCooldownUntil
      : run.abilityCooldownUntil) - run.elapsed,
  );
  const chosenTheme =
    PHOTON_THEMES.find((t) => t.key === theme) ?? DEFAULT_PHOTON_THEME;
  const themeStyle = {
    "--photon-floor": chosenTheme.floor,
    "--photon-glow": chosenTheme.glow,
    "--photon-accent": chosenTheme.accent,
  } as CSSProperties;

  return (
    <section
      className={`photon-panel photon-futuristic theme-${theme}`}
      style={themeStyle}
      id="main-game-panel"
      aria-label="Photon Fury"
    >
      <header className="photon-heading">
        <div>
          <small>LASERDROME · 4 LANES</small>
          <h2>PHOTON FURY</h2>
        </div>
        <strong>✦ {balance.toLocaleString()} PHOTONS</strong>
        <button
          onClick={() => {
            setInventory((value) => !value);
            if (running && !inventory) audioEngine.pause();
            else if (running && !paused && run.chaosCountdown === 0)
              void audioEngine.resume();
          }}
        >
          INVENTORY
        </button>
      </header>
      {inventory ? (
        <section className="photon-inventory">
          <h3>PHOTON FURY INVENTORY</h3>
          <p>
            Photon Fury characters only. Select your character before starting a
            run.
          </p>
          {PHOTON_CATEGORIES.map((category) => (
            <details
              className="photon-category"
              key={category}
              open={category === "traditional"}
            >
              <summary>{category.toUpperCase()}</summary>
              <div className="photon-character-grid">
                {CHARACTER_KEYS.filter(
                  (key) => getPhotonCharacter(key).category === category,
                ).map((key) => {
                  const character = getPhotonCharacter(key);
                  const available = testMode || owned.includes(key);
                  return (
                    <article
                      className={`photon-character-card${selected === key ? " selected" : ""}`}
                      key={key}
                    >
                      <div
                        className="photon-portrait"
                        aria-label={`${character.name} character`}
                      >
                        <PhotonAvatar character={key} skin={skinChoices[key]} />
                      </div>
                      <div>
                        <h4>{character.name}</h4>
                        <p>{character.description}</p>
                        <dl>
                          <div>
                            <dt>STARTING / MAX HP</dt>
                            <dd>{character.maxHp}</dd>
                          </div>
                          <div>
                            <dt>DURABILITY</dt>
                            <dd>{character.durability}</dd>
                          </div>
                          <div>
                            <dt>GUARD</dt>
                            <dd>{character.guardSeconds}s</dd>
                          </div>
                          <div>
                            <dt>COOLDOWN</dt>
                            <dd>{character.cooldownSeconds}s</dd>
                          </div>
                        </dl>
                        <button
                          disabled={
                            !available ||
                            busy ||
                            running ||
                            savePending ||
                            selected === key
                          }
                          onClick={() => void equip(key)}
                        >
                          {selected === key && available
                            ? "EQUIPPED"
                            : available
                              ? testMode && !owned.includes(key)
                                ? "EQUIP · TEST MODE"
                                : "EQUIP"
                              : "LOCKED"}
                        </button>
                      </div>
                    </article>
                  );
                })}
              </div>
              {!CHARACTER_KEYS.some(
                (key) => getPhotonCharacter(key).category === category,
              ) && <p>More characters coming soon.</p>}
            </details>
          ))}
          <PhotonCollection
            character={selected}
            characters={testMode ? CHARACTER_KEYS : owned}
            weapon={weapon}
            skins={skins}
            skinChoices={skinChoices}
            themes={themes}
            theme={theme}
            weapons={ownedWeapons}
            level={level}
            gems={gems}
            photons={balance}
            busy={busy}
            running={running}
            results={boxResults}
            onEquip={(key) => void equipItem(`weapon:${key}`)}
            onBuyWeapon={(key) => void buyWeapon(key)}
            onOpen={() => void openBox()}
            onSkin={(key) => void equipItem(`skin:${key}`)}
            onTheme={(key) => void equipItem(`theme:${key}`)}
          />
          <p className="photon-inventory-note">
            One reflection per swing. Unblocked needles and missed swings use
            durability; cars do not. Guard time shortens as the run speeds up.
          </p>
          <button
            onClick={() => {
              setInventory(false);
              if (running && !paused && run.chaosCountdown === 0)
                void audioEngine.resume();
            }}
          >
            BACK {running ? "TO RUN" : "TO MENU"}
          </button>
        </section>
      ) : (
        <>
          {!running ? (
            <div className="photon-lobby">
              <h3>
                {run.elapsed > 0
                  ? "RUN COMPLETE"
                  : "DODGE. BLOCK. EARN PHOTONS."}
              </h3>
              <div className="photon-equipped">
                <div className="photon-portrait">
                  <PhotonAvatar
                    character={selected}
                    skin={skinChoices[selected]}
                  />
                </div>
                <div>
                  <b>{selectedDefinition.name.toUpperCase()}</b>
                  <p>{selectedDefinition.description}</p>
                  <p>
                    {PHOTON_WEAPONS[weapon].name} ·{" "}
                    {PHOTON_WEAPONS[weapon].description}
                  </p>
                  <button onClick={() => setInventory(true)}>
                    CHARACTERS · BOXES · WEAPONS
                  </button>
                </div>
              </div>
              <p>{PHOTON_GUIDE.introduction}</p>
              {run.elapsed > 0 && (
                <div className="photon-results">
                  <b>{photonRunReward(run)} PHOTONS</b>
                </div>
              )}
              {unlocked || testMode ? (
                <button
                  disabled={
                    busy ||
                    savePending ||
                    (!testMode && !owned.includes(selected))
                  }
                  onClick={() => void start()}
                >
                  {busy ? "SAVING…" : "START RUN"}
                </button>
              ) : (
                <>
                  <p>
                    {!userId
                      ? "SIGN IN TO UNLOCK"
                      : level < PHOTON_RULES.unlockLevel
                        ? `UNLOCKS AT LEVEL ${PHOTON_RULES.unlockLevel} · YOUR LEVEL: ${level}`
                        : `${PHOTON_RULES.price} GEMS TO UNLOCK`}
                  </p>
                  <button
                    disabled={
                      loading || busy || !userId || level < PHOTON_RULES.unlockLevel || gems < PHOTON_RULES.price
                    }
                    onClick={() => void unlock()}
                  >
                    UNLOCK · {PHOTON_RULES.price} GEMS
                  </button>
                </>
              )}
              {savePending && (
                <button disabled={busy} onClick={() => void finish()}>
                  SAVE RUN
                </button>
              )}
            </div>
          ) : (
            <>
              <div className="photon-hud">
                <b>{photonTotalPoints(run)} POINTS</b>
                <span>{current.name.toUpperCase()}</span>
                <span>{photonObstacleSpeed(run).toFixed(2)}× SPEED</span>
              </div>
              {current.invertedControls && (
                <div className="photon-inverted-controls" role="status">
                  CONTROLS REVERSED · LEFT MOVES RIGHT · RIGHT MOVES LEFT
                </div>
              )}
              {run.characterKey === "photon_bear" && (
                <div className="photon-stage-meter">
                  {run.stage === "chaos" ? "CHAOS" : "NORMAL"} ·{" "}
                  {Math.max(0, run.stageEndsAt - run.elapsed).toFixed(1)}s
                  {run.stage === "chaos"
                    ? " · 3× POINTS / 2× DAMAGE"
                    : " UNTIL CHAOS"}
                </div>
              )}
              <div className="playfield photon-playfield" data-paused={paused || run.timeStop || run.chaosCountdown > 0}>
                <div className="photon-space" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </div>
                <div
                  className={`road photon-arena${run.guardUntil > run.elapsed ? " guarding" : ""}${run.needleUntil > run.elapsed ? " needled" : ""}${run.stage === "chaos" ? " photon-chaos" : ""}`}
                  onPointerDown={(event) => {
                    gesture.current = { x: event.clientX, y: event.clientY };
                  }}
                  onPointerUp={(event) => {
                    const origin = gesture.current;
                    gesture.current = null;
                    if (!origin) return;
                    const dx = event.clientX - origin.x;
                    const dy = event.clientY - origin.y;
                    if (Math.abs(dx) > 25 && Math.abs(dx) > Math.abs(dy))
                      move(Math.sign(dx));
                    else if (Math.abs(dx) < 25 && Math.abs(dy) < 25) {
                      const rect = event.currentTarget.getBoundingClientRect();
                      const target = Math.min(
                        3,
                        Math.floor(
                          ((event.clientX - rect.left) / rect.width) * 4,
                        ),
                      );
                      move(Math.sign(target - runRef.current.lane));
                    }
                  }}
                >
                  {[1, 2, 3].map((lane) => (
                    <i
                      key={lane}
                      className="line lane-divider"
                      style={{ left: `${lane * 25}%` }}
                    />
                  ))}
                  {run.items.map((item) => (
                    <div
                      key={item.id}
                      className={`item ${item.kind === "spike" ? "spikes" : item.kind} photon-obstacle${run.laserTargeting ? " laser-target" : ""}`}
                      style={{
                        left: `${(item.lane + 0.5) * 25}%`,
                        top: `${item.y * 100}%`,
                      }}
                      aria-label={item.kind}
                      onPointerDown={(event) => {
                        if (run.laserTargeting) {
                          event.stopPropagation();
                          publish(erasePhotonHazard(runRef.current, item.id));
                        }
                      }}
                    >
                      <Obstacle kind={item.kind} />
                    </div>
                  ))}
                  <PhotonAvatar
                    character={run.characterKey}
                    lane={run.lane}
                    skin={skinChoices[run.characterKey]}
                    guarding={run.guardUntil > run.elapsed}
                  />
                  {damage > 0 && (
                    <div
                      className="photon-damage-hearts"
                      style={{ left: `${(run.lane + 0.5) * 25}%` }}
                      role="status"
                      aria-label={`${damage} hearts lost`}
                    >
                      {Array.from({ length: Math.ceil(damage) }, (_, i) => (
                        <span
                          key={i}
                          className={damage - i < 1 ? "partial" : ""}
                        >
                          ♥
                        </span>
                      ))}
                    </div>
                  )}
                  {run.timeStop && (
                    <div
                      className="photon-time-stop"
                      role="dialog"
                      aria-label="Halt lane choice"
                    >
                      <h3>HALT</h3>
                      <p>Choose another lane. Z / X / C / V</p>
                      {[0, 1, 2, 3].map((lane) => (
                        <button
                          key={lane}
                          disabled={lane === run.lane}
                          onClick={() => timeLane(lane)}
                        >
                          {["Z", "X", "C", "V"][lane]} · LANE {lane + 1}
                        </button>
                      ))}
                    </div>
                  )}
                  {run.needleUntil > run.elapsed && (
                    <span className="photon-needle-status">
                      NEEDLE {(run.needleUntil - run.elapsed).toFixed(1)}s
                    </span>
                  )}
                  {run.chaosCountdown > 0 && !paused && (
                    <div className="photon-chaos-countdown" role="status">
                      <h3>{run.nextStage.toUpperCase()} STARTS IN</h3>
                      <strong>{Math.ceil(run.chaosCountdown)}</strong>
                    </div>
                  )}
                  {run.stageNoticeUntil > run.elapsed &&
                    run.chaosCountdown === 0 && (
                      <div
                        className={`photon-stage-announcement ${run.stage}`}
                        role="status"
                      >
                        {run.stage === "chaos" ? "CHAOS STAGE" : "NORMAL STAGE"}
                      </div>
                    )}
                  {paused && (
                    <div className="photon-pause">
                      <h3>PAUSED</h3>
                      <button onClick={togglePause}>RESUME</button>
                      <button onClick={() => void finish()}>END RUN</button>
                    </div>
                  )}
                </div>
              </div>
              <footer className="photon-footer">
                <span
                  className="health"
                  aria-label={`${run.hp} of ${current.maxHp} hearts`}
                >
                  {Array.from({ length: current.maxHp }, (_, index) => (
                    <span
                      key={index}
                      className={`heart-glyph ${run.hp - index >= 1 ? "" : run.hp - index > 0 ? "partial" : "lost"}`}
                    >
                      ♥
                    </span>
                  ))}
                </span>
                <div className="photon-turn-buttons" aria-label="Lane controls">
                  <button
                    aria-label="Left lane control"
                    disabled={
                      paused || controlsLocked || run.pendingTurn !== null
                    }
                    onClick={() => move(-1)}
                  >
                    ←
                  </button>
                  <button
                    aria-label="Right lane control"
                    disabled={
                      paused || controlsLocked || run.pendingTurn !== null
                    }
                    onClick={() => move(1)}
                  >
                    →
                  </button>
                </div>
                <div className="photon-abilities">
                  <button
                    className="photon-weapon"
                    onClick={saber}
                    disabled={
                      paused ||
                      controlsLocked ||
                      run.durability <= 0 ||
                      cooldown > 0 ||
                      run.guardUntil > run.elapsed ||
                      run.saberStartsAt !== null
                    }
                  >
                    <b>
                      {PHOTON_WEAPONS[run.weaponKey].name.toUpperCase()} · Q
                    </b>
                    <strong>
                      {run.durability <= 0
                        ? "BROKEN"
                        : run.saberStartsAt !== null
                          ? `${saberDelay.toFixed(1)}s · INPUT DELAY`
                          : run.guardUntil > run.elapsed
                            ? `${(run.guardUntil - run.elapsed + current.cooldownSeconds).toFixed(1)}s · GUARD`
                            : `${cooldown.toFixed(1)}s`}
                    </strong>
                    <small>
                      {run.durability}/{current.durability} DURABILITY
                    </small>
                  </button>
                  {current.ability !== "none" && (
                    <button
                      onClick={ability}
                      disabled={paused || controlsLocked || abilityCooldown > 0}
                    >
                      <b>
                        {current.ability === "time-stop" ? "HALT" : current.ability === "chime" ? "RESONANT CHIME" : current.ability === "bomb" ? "REACTOR BOMB" : current.ability.replaceAll("-", " ").toUpperCase()} · E
                      </b>
                      <strong>
                        {abilityCooldown > 0
                          ? `${abilityCooldown.toFixed(1)}s`
                          : "READY"}
                      </strong>
                    </button>
                  )}
                  {current.ability === "dash" && (
                    <button
                      onClick={dashLeft}
                      disabled={paused || controlsLocked}
                    >
                      DASH LEFT · W
                    </button>
                  )}
                  {run.weaponKey === "concentrated_laser" && (
                    <button
                      onClick={laser}
                      disabled={
                        paused ||
                        controlsLocked ||
                        run.durability <= 0 ||
                        run.elapsed < run.laserCooldownUntil
                      }
                    >
                      PRECISION ERASE · F{" "}
                      {Math.max(
                        0,
                        run.laserCooldownUntil - run.elapsed,
                      ).toFixed(1)}
                      s
                    </button>
                  )}
                </div>
                <small>
                  A/D or ←/→ · Q WEAPON
                  {current.ability !== "none" ? " · E ABILITY" : ""}
                </small>
                <button onClick={togglePause}>
                  {paused ? "RESUME" : "PAUSE"}
                </button>
              </footer>
            </>
          )}
        </>
      )}
      {status && (
        <p className="photon-status" role="status">
          {status}
        </p>
      )}
      <details className="photon-guide" open={!running && !inventory}>
        <summary>HOW TO PLAY</summary>
        <ol>
          {PHOTON_GUIDE.steps.map((step) => (
            <li key={step.title}>
              <b>{step.title}.</b> {step.text}
            </li>
          ))}
        </ol>
        <p>{PHOTON_GUIDE.needle}</p>
      </details>
    </section>
  );
}
