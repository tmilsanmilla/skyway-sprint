"use client";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
type Kind =
  "gem" | "coin" | "car" | "log" | "snowflake" | "rock" | "barrel" | "spikes";
type Item = { id: number; lane: number; y: number; kind: Kind };
type GameMode = "normal" | "hardcore" | "impossible";
type PlayerReport = {
  id: number;
  user_id: string;
  report_type: string;
  message: string;
  status: string;
  created_at: string;
};
type AdminUser = {
  user_id: string;
  email: string;
  username: string | null;
  role: "main" | "co_admin";
};
type Leader = { rank: number; username: string; high_score: number };
type Unlock = {
  item_key: string;
  item_type: "class" | "player" | "obstacle" | "environment";
  rarity: string;
};
type PlayScope = "single" | "versus";
type VersusPhase =
  "idle" | "searching" | "ready" | "playing" | "intermission" | "finished";
const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
);
function Obstacle({ kind }: { kind: Kind }) {
  if (kind === "gem") return <span>♦</span>;
  if (kind === "coin") return <span>●</span>;

  if (kind === "barrel")
    return (
      <div className="barrel-shape">
        <i />
        <b />
        <em />
      </div>
    );
  if (kind === "car")
    return (
      <div className="car-shape">
        <i className="windshield" />
        <i className="light left" />
        <i className="light right" />
        <i className="wheel left" />
        <i className="wheel right" />
        <b />
      </div>
    );
  if (kind === "spikes")
    return (
      <div className="ground-spike-shape">
        <span>!</span>
        <i />
        <i />
        <i />
        <i />
      </div>
    );
  if (kind === "log")
    return (
      <div className="log-shape">
        <i />
        <b />
        <em />
      </div>
    );
  if (kind === "snowflake") return <span>❄</span>;
  return (
    <div className="rock-shape">
      <u />
      <i />
      <b />
      <em />
    </div>
  );
}
export default function Home() {
  const [lane, setLane] = useState(2),
    [items, setItems] = useState<Item[]>([]),
    [score, setScore] = useState(0),
    [gems, setGems] = useState(0),
    [highScore, setHighScore] = useState(0),
    [gemBump, setGemBump] = useState(false),
    [hearts, setHearts] = useState(3),
    [wave, setWave] = useState(1),
    [running, setRunning] = useState(false),
    [paused, setPaused] = useState(false),
    [wavePause, setWavePause] = useState(false),
    [waveMessage, setWaveMessage] = useState(""),
    [over, setOver] = useState(false),
    [flash, setFlash] = useState(""),
    [invincible, setInvincible] = useState(false),
    [slowed, setSlowed] = useState(false),
    [shopOpen, setShopOpen] = useState(false),
    [shopStatus, setShopStatus] = useState(""),
    [leaderboardOpen, setLeaderboardOpen] = useState(false),
    [leaders, setLeaders] = useState<Leader[]>([]);
  const id = useRef(0),
    last = useRef(0),
    userIdRef = useRef<string | null>(null),
    gemsRef = useRef(0),
    scoreRef = useRef(0),
    highScoreRef = useRef(0),
    invincibleUntilRef = useRef(0),
    slowUntilRef = useRef(0),
    turnLockedRef = useRef(false),
    slowedRef = useRef(false),
    versusMatchRef = useRef<string | null>(null),
    versusSearchingRef = useRef(false),
    realtimeRef = useRef<ReturnType<typeof supabase.channel> | null>(null),
    incomingAttacksRef = useRef<Kind[]>([]),
    versusFinishedRef = useRef(false),
    state = useRef({ lane, running, paused });
  state.current = { lane, running, paused };
  gemsRef.current = gems;
  scoreRef.current = score;
  highScoreRef.current = highScore;
  slowedRef.current = slowed;
  const [authReady, setAuthReady] = useState(false),
    [guest, setGuest] = useState(false),
    [userEmail, setUserEmail] = useState<string | null>(null),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState(""),
    [confirmPassword, setConfirmPassword] = useState(""),
    [authMode, setAuthMode] = useState<"signin" | "signup">("signin"),
    [authBusy, setAuthBusy] = useState(false),
    [authMessage, setAuthMessage] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false),
    [adminOpen, setAdminOpen] = useState(false),
    [isAdmin, setIsAdmin] = useState(false),
    [adminRole, setAdminRole] = useState<string | null>(null),
    [adminTab, setAdminTab] = useState<"reports" | "admins">("reports"),
    [admins, setAdmins] = useState<AdminUser[]>([]),
    [adminTarget, setAdminTarget] = useState(""),
    [adminStatus, setAdminStatus] = useState(""),
    [reports, setReports] = useState<PlayerReport[]>([]),
    [copyStatus, setCopyStatus] = useState(""),
    [reportType, setReportType] = useState("Bug"),
    [reportMessage, setReportMessage] = useState(""),
    [reportStatus, setReportStatus] = useState(""),
    [reportBusy, setReportBusy] = useState(false);
  const [username, setUsername] = useState(""),
    [usernameInput, setUsernameInput] = useState(""),
    [usernameRequired, setUsernameRequired] = useState(false),
    [usernameStatus, setUsernameStatus] = useState(""),
    [newPassword, setNewPassword] = useState(""),
    [passwordStatus, setPasswordStatus] = useState("");
  const [editUsername, setEditUsername] = useState(false),
    [editPassword, setEditPassword] = useState(false);
  const [mode, setMode] = useState<GameMode>("normal");
  const [playScope, setPlayScope] = useState<PlayScope>("single"),
    [versusOpen, setVersusOpen] = useState(false),
    [versusPhase, setVersusPhase] = useState<VersusPhase>("idle"),
    [versusOpponent, setVersusOpponent] = useState("WAITING…"),
    [versusPoints, setVersusPoints] = useState(0),
    [versusCountdown, setVersusCountdown] = useState(15),
    [versusOpponentHearts, setVersusOpponentHearts] = useState(3),
    [versusResult, setVersusResult] = useState("");
  const [playerClass, setPlayerClass] = useState("runner"),
    [unlocks, setUnlocks] = useState<Unlock[]>([]),
    [extractResults, setExtractResults] = useState<Unlock[]>([]);
  const baseHearts =
    playerClass === "tank" ? 5 : playerClass === "trickster" ? 2 : 3;
  const maxHearts =
    playerClass === "medic"
      ? mode === "normal"
        ? 5
        : mode === "hardcore"
          ? 4
          : 1
      : baseHearts;
  const announceWave = useCallback((number: number) => {
    setWaveMessage(`WAVE ${number}`);
    setWavePause(true);
    setTimeout(() => {
      setWaveMessage("");
      setWavePause(false);
    }, 1250);
  }, []);
  const reset = useCallback(() => {
    setLane(2);
    setItems([]);
    setScore(0);
    setHearts(maxHearts);
    setWave(1);
    setOver(false);
    setPaused(false);
    setInvincible(false);
    setSlowed(false);
    invincibleUntilRef.current = 0;
    slowUntilRef.current = 0;
    setRunning(true);
    last.current = 0;
    announceWave(1);
  }, [announceWave, maxHearts]);
  const backToMenu = () => {
    if (playScope === "versus") {
      if (versusMatchRef.current) void supabase.rpc("leave_1v1");
      closeVersusChannel();
      versusMatchRef.current = null;
      setVersusPhase("idle");
      setPlayScope("single");
    }
    setRunning(false);
    setPaused(false);
    setOver(false);
    setItems([]);
    setScore(0);
    setWave(1);
    setHearts(maxHearts);
    setInvincible(false);
    setSlowed(false);
    invincibleUntilRef.current = 0;
    slowUntilRef.current = 0;
  };
  const move = useCallback((d: number) => {
    if (!state.current.running || state.current.paused || turnLockedRef.current)
      return;
    if (slowedRef.current) {
      turnLockedRef.current = true;
      setTimeout(() => {
        setLane((v) => Math.max(0, Math.min(4, v + d)));
        turnLockedRef.current = false;
      }, 100);
      return;
    }
    setLane((v) => Math.max(0, Math.min(4, v + d)));
  }, []);
  const closeVersusChannel = () => {
    if (realtimeRef.current) {
      void supabase.removeChannel(realtimeRef.current);
      realtimeRef.current = null;
    }
  };
  const subscribeToMatch = (matchId: string) => {
    closeVersusChannel();
    const channel = supabase
      .channel(`skyway-1v1-${matchId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "multiplayer_attacks",
          filter: `match_id=eq.${matchId}`,
        },
        (payload) => {
          const attack = payload.new as {
            id: string;
            target_user_id: string;
            obstacle_type: Kind | "spike";
          };
          if (attack.target_user_id === userIdRef.current) {
            incomingAttacksRef.current.push(
              attack.obstacle_type === "spike"
                ? "spikes"
                : attack.obstacle_type,
            );
            void supabase.rpc("acknowledge_1v1_attacks", {
              p_match_id: matchId,
              p_attack_ids: [attack.id],
            });
          }
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "multiplayer_players",
          filter: `match_id=eq.${matchId}`,
        },
        (payload) => {
          const player = payload.new as {
            user_id: string;
            hearts: number;
            status: string;
          };
          if (player.user_id !== userIdRef.current) {
            setVersusOpponentHearts(Number(player.hearts));
            if (player.status === "eliminated") {
              setVersusResult("VICTORY");
              setVersusPhase("finished");
              setRunning(false);
              setOver(true);
            }
          }
        },
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "multiplayer_matches",
          filter: `id=eq.${matchId}`,
        },
        (payload) => {
          const match = payload.new as {
            status: string;
            winner_user_id: string | null;
          };
          if (match.status === "finished") {
            setVersusResult(
              match.winner_user_id === userIdRef.current ? "VICTORY" : "DEFEAT",
            );
            setVersusPhase("finished");
            setRunning(false);
            setOver(true);
          }
        },
      )
      .subscribe();
    realtimeRef.current = channel;
  };
  const beginVersusMatch = (matchId: string, opponent: string) => {
    versusMatchRef.current = matchId;
    versusFinishedRef.current = false;
    setVersusOpponent(opponent || "RIVAL");
    setVersusOpponentHearts(3);
    setVersusPoints(0);
    setVersusResult("");
    setVersusPhase("playing");
    setPlayScope("versus");
    setVersusOpen(false);
    incomingAttacksRef.current = [];
    subscribeToMatch(matchId);
    reset();
  };
  const findVersusMatch = async () => {
    if (guest) {
      setVersusResult("SIGN IN TO PLAY 1V1");
      return;
    }
    setVersusResult("");
    setVersusPhase("searching");
    versusSearchingRef.current = true;
    const poll = async () => {
      const { data, error } = await supabase.rpc("join_1v1_queue");
      if (error) {
        setVersusResult(error.message);
        setVersusPhase("idle");
        versusSearchingRef.current = false;
        return;
      }
      if (data?.match_id) {
        versusSearchingRef.current = false;
        beginVersusMatch(data.match_id, data.opponent_username);
        return;
      }
      if (versusSearchingRef.current) setTimeout(poll, 1800);
    };
    versusMatchRef.current = null;
    await poll();
  };
  const cancelVersus = async () => {
    versusSearchingRef.current = false;
    versusMatchRef.current = null;
    await supabase.rpc("leave_1v1");
    closeVersusChannel();
    setVersusPhase("idle");
    setVersusOpen(false);
  };
  const sendVersusAttack = async (kind: "barrel" | "log" | "car" | "rock") => {
    if (!versusMatchRef.current || versusPhase !== "intermission") return;
    const { data, error } = await supabase.rpc("send_1v1_attack", {
      p_match_id: versusMatchRef.current,
      p_obstacle_type: kind,
    });
    if (error) {
      setVersusResult(error.message);
      return;
    }
    if (typeof data?.remaining_points === "number")
      setVersusPoints(data.remaining_points);
  };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.matches('input, textarea, select, [contenteditable="true"]'))
        return;
      if (["ArrowLeft", "a", "A"].includes(e.key)) {
        e.preventDefault();
        move(-1);
      }
      if (["ArrowRight", "d", "D"].includes(e.key)) {
        e.preventDefault();
        move(1);
      }
      if (e.key === " " && state.current.running && playScope !== "versus") {
        e.preventDefault();
        setPaused((v) => !v);
      }
      if (e.key === "Enter" && !state.current.running) reset();
    };
    addEventListener("keydown", key);
    return () => removeEventListener("keydown", key);
  }, [move, reset, playScope]);
  useEffect(() => {
    if (!running || paused || wavePause) return;
    let raf = 0,
      prev = performance.now();
    const tick = (now: number) => {
      const dt = Math.min(32, now - prev);
      prev = now;
      if (now - last.current > Math.max(330, 980 - wave * 55)) {
        last.current = now;
        const r = Math.random(),
          danger = Math.min(0.82, 0.59 + wave * 0.025),
          gemThreshold =
            mode === "impossible" ? 0.86 : mode === "hardcore" ? 0.9 : 0.94;
        let kind: Kind;
        if (playScope === "versus" && r < 0.27) kind = "coin";
        else if (playScope === "versus" && r > 0.975) kind = "gem";
        else if (r < danger || playScope === "versus")
          kind = (["log", "snowflake", "rock", "barrel", "spikes"] as Kind[])[
            Math.floor(Math.random() * 5)
          ];
        else if (r > gemThreshold) kind = "gem";
        else
          kind = (["log", "snowflake", "rock", "barrel", "spikes"] as Kind[])[
            Math.floor(Math.random() * 5)
          ];
        setItems((v) => {
          const blocked = new Set(v.map((x) => x.lane));
          const lanes = [0, 1, 2, 3, 4].filter((l) => !blocked.has(l));
          if (!lanes.length) return v;
          const spawnLane = lanes[Math.floor(Math.random() * lanes.length)];
          return [...v, { id: id.current++, lane: spawnLane, y: -10, kind }];
        });
      }
      setItems((old) =>
        old.flatMap((item) => {
          const speedFactor =
            item.kind === "barrel"
              ? 1.75
              : item.kind === "car"
                ? 1.28
                : item.kind === "log"
                  ? 0.72
                  : item.kind === "rock"
                    ? 0.3
                    : 1;
          const n = {
            ...item,
            y: item.y + (0.04 + wave * 0.0052) * speedFactor * dt,
          };
          if (n.lane === state.current.lane && n.y > 65 && n.y < 91) {
            if (n.kind === "gem") {
              const total = gemsRef.current + 1;
              gemsRef.current = total;
              setGems(total);
              setGemBump(false);
              requestAnimationFrame(() => setGemBump(true));
              setTimeout(() => setGemBump(false), 500);
              if (userIdRef.current)
                void supabase
                  .rpc("increment_player_gems")
                  .then(({ data, error }) => {
                    if (error) {
                      console.error("Could not save gem:", error.message);
                      return;
                    }
                    if (typeof data === "number") {
                      gemsRef.current = data;
                      setGems(data);
                    }
                  });
            } else if (n.kind === "coin") {
              if (playScope === "versus" && versusMatchRef.current) {
                setVersusPoints((v) => v + 2);
                void supabase
                  .rpc("award_1v1_points", {
                    p_match_id: versusMatchRef.current,
                    p_source: "coin",
                    p_amount: 1,
                  })
                  .then(({ data, error }) => {
                    if (error) {
                      setVersusResult(error.message);
                      return;
                    }
                    if (typeof data?.obstacle_points === "number")
                      setVersusPoints(data.obstacle_points);
                  });
              }
            } else if (n.kind === "snowflake") {
              const until = Date.now() + 5000;
              slowUntilRef.current = until;
              setSlowed(true);
              setTimeout(() => {
                if (slowUntilRef.current <= Date.now()) setSlowed(false);
              }, 5050);
            } else if (invincibleUntilRef.current > Date.now()) {
              setFlash("shield");
              setTimeout(() => setFlash(""), 120);
              return [];
            } else {
              setHearts((v) => {
                const rawDamage =
                  mode === "impossible"
                    ? 1
                    : n.kind === "rock"
                      ? 2
                      : n.kind === "barrel"
                        ? 0.5
                        : 1;
                const damage =
                  mode !== "impossible" && playerClass === "trickster"
                    ? rawDamage * 2
                    : rawDamage;
                const h = v - damage;
                if (h <= 0) {
                  setRunning(false);
                  setOver(true);
                  if (guest) {
                    setGems(0);
                    gemsRef.current = 0;
                  } else {
                    const best = Math.max(
                      highScoreRef.current,
                      scoreRef.current,
                    );
                    highScoreRef.current = best;
                    setHighScore(best);
                    if (userIdRef.current)
                      void supabase
                        .rpc("save_player_high_score", { new_score: best })
                        .then(({ data, error }) => {
                          if (error) {
                            console.error(
                              "Could not save high score:",
                              error.message,
                            );
                            return;
                          }
                          if (typeof data === "number") {
                            highScoreRef.current = data;
                            setHighScore(data);
                          }
                        });
                  }
                }
                return Math.max(0, h);
              });
              const blockedLanes = new Set(
                old
                  .filter(
                    (x) =>
                      x.id !== n.id &&
                      x.kind !== "gem" &&
                      x.kind !== "coin" &&
                      x.kind !== "snowflake" &&
                      x.y > 50 &&
                      x.y < 96,
                  )
                  .map((x) => x.lane),
              );
              const safe = [0, 1, 2, 3, 4]
                .filter((l) => l !== n.lane && !blockedLanes.has(l))
                .sort(
                  (a, b) =>
                    Math.abs(a - state.current.lane) -
                    Math.abs(b - state.current.lane),
                );
              if (safe.length) setLane(safe[0]);
              setPaused(true);
              setFlash(
                n.kind === "barrel"
                  ? "life-half"
                  : n.kind === "rock"
                    ? "life-two"
                    : "life-lost",
              );
              setTimeout(() => {
                setFlash("");
                setPaused(false);
              }, 480);
              return [n];
            }
            return [];
          }
          return n.y < 108 ? [n] : [];
        }),
      );
      setScore(
        (v) =>
          v +
          Math.max(
            1,
            Math.round(
              (dt / 12) *
                (1 + wave * 0.01) *
                (mode === "impossible" ? 2 : mode === "hardcore" ? 1.5 : 1),
            ),
          ),
      );
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [
    running,
    paused,
    wavePause,
    wave,
    guest,
    mode,
    maxHearts,
    playerClass,
    playScope,
  ]);
  useEffect(() => {
    if (!running) return;
    const next = Math.floor(score / 2250) + 1;
    if (next !== wave) {
      setWave(next);
      if (mode === "normal" || playerClass === "medic")
        setHearts((v) =>
          Math.min(maxHearts, v + (playerClass === "tank" ? 0.5 : 1)),
        );
      if (playScope === "versus" && versusMatchRef.current) {
        setVersusPoints((v) => v + 3);
        setVersusCountdown(15);
        setVersusPhase("intermission");
        setPaused(true);
        void supabase
          .rpc("award_1v1_points", {
            p_match_id: versusMatchRef.current,
            p_source: "wave",
            p_amount: next - 1,
          })
          .then(({ data }) => {
            if (typeof data?.obstacle_points === "number")
              setVersusPoints(data.obstacle_points);
          });
      } else announceWave(next);
    }
  }, [
    score,
    running,
    wave,
    announceWave,
    mode,
    maxHearts,
    playerClass,
    playScope,
  ]);
  useEffect(() => {
    if (versusPhase !== "intermission") return;
    if (versusCountdown <= 0) {
      if (versusMatchRef.current)
        void supabase
          .rpc("update_1v1_state", {
            p_match_id: versusMatchRef.current,
            p_hearts: hearts,
            p_wave: wave,
            p_score: scoreRef.current,
            p_status: "playing",
          })
          .then(({ error }) => {
            if (error) {
              setVersusCountdown(1);
              return;
            }
            const attacks = incomingAttacksRef.current.splice(0);
            attacks.forEach((kind, index) =>
              setTimeout(
                () =>
                  setItems((v) => [
                    ...v,
                    {
                      id: id.current++,
                      lane: Math.floor(Math.random() * 5),
                      y: -10 - index * 8,
                      kind,
                    },
                  ]),
                index * 420,
              ),
            );
            setVersusPhase("playing");
            setPaused(false);
            announceWave(wave);
          });
      return;
    }
    const timer = setTimeout(() => setVersusCountdown((v) => v - 1), 1000);
    return () => clearTimeout(timer);
  }, [versusPhase, versusCountdown, announceWave, wave, hearts]);
  useEffect(() => {
    if (playScope !== "versus" || !versusMatchRef.current) return;
    void supabase.rpc("update_1v1_state", {
      p_match_id: versusMatchRef.current,
      p_hearts: hearts,
      p_wave: wave,
      p_score: scoreRef.current,
      p_status: over
        ? "eliminated"
        : versusPhase === "intermission"
          ? "intermission"
          : "playing",
    });
    if (over && !versusFinishedRef.current) {
      versusFinishedRef.current = true;
      void supabase.rpc("finish_1v1", { p_match_id: versusMatchRef.current });
    }
  }, [hearts, wave, over, playScope, versusPhase]);
  useEffect(() => {
    const applySession = async (
      session: Awaited<
        ReturnType<typeof supabase.auth.getSession>
      >["data"]["session"],
    ) => {
      const user = session?.user ?? null;
      userIdRef.current = user?.id ?? null;
      setUserEmail(user?.email ?? null);
      if (user) {
        const [
          { data: stats, error: statsError },
          { data: profile },
          { data: admin },
          { data: role },
        ] = await Promise.all([
          supabase
            .from("player_stats")
            .select("total_gems,high_score")
            .eq("user_id", user.id)
            .maybeSingle(),
          supabase
            .from("player_profiles")
            .select("username,username_changed_at")
            .eq("user_id", user.id)
            .maybeSingle(),
          supabase.rpc("is_admin"),
          supabase.rpc("get_admin_role"),
        ]);
        if (statsError)
          console.error("Could not load account stats:", statsError.message);
        if (stats) {
          gemsRef.current = stats.total_gems;
          highScoreRef.current = stats.high_score;
          setGems(stats.total_gems);
          setHighScore(stats.high_score);
        } else {
          const { error } = await supabase
            .from("player_stats")
            .insert({ user_id: user.id });
          if (error)
            console.error("Could not create account stats:", error.message);
        }
        if (profile) {
          setUsername(profile.username);
          setUsernameInput(profile.username);
          setUsernameRequired(false);
        } else setUsernameRequired(true);
        setIsAdmin(Boolean(admin));
        setAdminRole(role);
      } else {
        setUsername("");
        setUsernameRequired(false);
        setIsAdmin(false);
        setAdminRole(null);
      }
      setAuthReady(true);
    };
    supabase.auth
      .getSession()
      .then(({ data }) => void applySession(data.session));
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") {
        setSettingsOpen(true);
        setPasswordStatus("Verified. Enter your new password below.");
      }
      void applySession(session);
    });
    return () => data.subscription.unsubscribe();
  }, []);
  const submitAuth = async (e: FormEvent) => {
    e.preventDefault();
    setAuthBusy(true);
    setAuthMessage("");
    if (authMode === "signup") {
      if (password !== confirmPassword) {
        setAuthMessage("Passwords do not match.");
        setAuthBusy(false);
        return;
      }
      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { emailRedirectTo: window.location.origin },
      });
      setAuthMessage(
        error
          ? error.message
          : "Check your email to confirm your account, then return here to sign in.",
      );
    } else {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) setAuthMessage(error.message);
    }
    setAuthBusy(false);
  };
  const sendPasswordReset = async (
    targetEmail: string,
    setStatus: (message: string) => void,
  ) => {
    if (!targetEmail) {
      setStatus("Enter your email address first.");
      return;
    }
    setStatus("Sending recovery email…");
    const { error } = await supabase.auth.resetPasswordForEmail(targetEmail, {
      redirectTo: window.location.origin,
    });
    setStatus(
      error
        ? error.message
        : "Recovery email sent. Open its link to verify your account and choose a new password.",
    );
  };
  const signOut = async () => {
    versusSearchingRef.current = false;
    closeVersusChannel();
    if (versusMatchRef.current) void supabase.rpc("leave_1v1");
    versusMatchRef.current = null;
    setPlayScope("single");
    setVersusPhase("idle");
    setVersusOpen(false);
    setRunning(false);
    setPaused(false);
    setWavePause(false);
    setSlowed(false);
    slowUntilRef.current = 0;
    setItems([]);
    setOver(false);
    setScore(0);
    setSettingsOpen(false);
    setAdminOpen(false);
    setShopOpen(false);
    setLeaderboardOpen(false);
    setGuest(false);
    userIdRef.current = null;
    if (userEmail) {
      setUserEmail(null);
      await supabase.auth.signOut();
    }
  };
  const playGuest = () => {
    setGuest(true);
    setGems(0);
    setHighScore(0);
    gemsRef.current = 0;
    highScoreRef.current = 0;
  };
  const submitReport = async (e: FormEvent) => {
    e.preventDefault();
    if (!userIdRef.current) return;
    setReportBusy(true);
    setReportStatus("");
    const { error } = await supabase.from("player_reports").insert({
      user_id: userIdRef.current,
      report_type: reportType,
      message: reportMessage.trim(),
    });
    if (error) setReportStatus(error.message);
    else {
      setReportStatus(
        "Report sent. Thank you for helping improve Skyway Sprint!",
      );
      setReportMessage("");
    }
    setReportBusy(false);
  };
  const saveUsername = async (e: FormEvent) => {
    e.preventDefault();
    setUsernameStatus("");
    const { data, error } = await supabase.rpc("set_player_username", {
      new_username: usernameInput,
    });
    if (error) setUsernameStatus(error.message);
    else {
      setUsername(data.username);
      setUsernameInput(data.username);
      setUsernameRequired(false);
      setEditUsername(false);
      setUsernameStatus("Username saved. You can change it again in 30 days.");
    }
  };
  const changePassword = async (e: FormEvent) => {
    e.preventDefault();
    setPasswordStatus("");
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) setPasswordStatus(error.message);
    else {
      setNewPassword("");
      setEditPassword(false);
      setPasswordStatus("Password updated successfully.");
    }
  };
  const loadReports = async () => {
    const { data } = await supabase
      .from("player_reports")
      .select("*")
      .neq("status", "resolved")
      .order("created_at", { ascending: false });
    setReports((data ?? []) as PlayerReport[]);
    setAdminTab("reports");
    setPaused(true);
    setAdminOpen(true);
  };
  const loadAdmins = async () => {
    const { data, error } = await supabase.rpc("list_admins");
    if (error) setAdminStatus(error.message);
    else setAdmins((data ?? []) as AdminUser[]);
    setAdminTab("admins");
  };
  const manageAdmin = async (
    target: string,
    action: "add" | "promote" | "demote" | "remove",
  ) => {
    setAdminStatus("");
    const { error } = await supabase.rpc("manage_admin", {
      target,
      admin_action: action,
    });
    if (error) {
      setAdminStatus(error.message);
      return;
    }
    setAdminTarget("");
    setAdminStatus(
      action === "remove"
        ? "Co-admin removed."
        : action === "promote"
          ? "Admin promoted to main admin."
          : action === "demote"
            ? "Admin changed to co-admin."
            : "Co-admin added.",
    );
    await loadAdmins();
  };
  const resolveReport = async (id: number) => {
    const { error } = await supabase.rpc("resolve_player_report", {
      report_id: id,
    });
    if (error) {
      setCopyStatus(error.message);
      return;
    }
    setReports((v) => v.filter((r) => r.id !== id));
  };
  const copyOpenReports = async () => {
    const open = reports.filter((r) => r.status !== "resolved");
    if (open.length === 0) {
      setCopyStatus("No open reports to copy.");
      return;
    }
    const text = open
      .map(
        (r, index) =>
          `REPORT ${index + 1}\nType: ${r.report_type}\nDate: ${new Date(r.created_at).toLocaleString()}\nPlayer: ${r.user_id}\nStatus: ${r.status}\n\n${r.message}`,
      )
      .join("\n\n--------------------\n\n");
    await navigator.clipboard.writeText(text);
    setCopyStatus(
      `${open.length} open report${open.length === 1 ? "" : "s"} copied.`,
    );
    setTimeout(() => setCopyStatus(""), 2200);
  };
  const loadCollection = async () => {
    if (guest) return;
    const [{ data: owned }, { data: loadout }] = await Promise.all([
      supabase.from("player_unlocks").select("item_key,item_type,rarity"),
      supabase.from("player_loadouts").select("class_key").maybeSingle(),
    ]);
    setUnlocks((owned ?? []) as Unlock[]);
    if (loadout?.class_key) setPlayerClass(loadout.class_key);
  };
  const extract = async (count: 1 | 10) => {
    if (guest) {
      setShopStatus("Sign in to extract permanent items.");
      return;
    }
    setShopStatus("Extracting…");
    const { data, error } = await supabase.rpc("extract_items", {
      pull_count: count,
    });
    if (error) {
      setShopStatus(error.message);
      return;
    }
    setExtractResults((data?.results ?? []) as Unlock[]);
    gemsRef.current = data.gems;
    setGems(data.gems);
    setShopStatus(`${count} extraction${count === 1 ? "" : "s"} complete!`);
    await loadCollection();
  };
  const equipClass = async (item: string) => {
    const { error } = await supabase.rpc("set_loadout", {
      p_slot: "class",
      p_item: item,
    });
    if (error) {
      setShopStatus(error.message);
      return;
    }
    setPlayerClass(item);
    setShopStatus(`${item.toUpperCase()} equipped.`);
  };
  const equipCosmetic = async (item: Unlock) => {
    const { error } = await supabase.rpc("set_loadout", {
      p_slot: item.item_type,
      p_item: item.item_key,
    });
    setShopStatus(
      error
        ? error.message
        : `${item.item_key.replaceAll("_", " ").toUpperCase()} equipped.`,
    );
  };
  const activatePowerup = (kind: "score_boost" | "invincibility" | "heart") => {
    if (kind === "score_boost") {
      setScore((v) => v + 1000);
      setShopStatus("+1,000 score activated!");
    } else if (kind === "heart") {
      if (mode !== "normal") {
        setShopStatus("Glass hearts cannot be healed.");
        return;
      }
      setHearts((v) => Math.min(maxHearts, v + 1));
      setShopStatus("One heart restored!");
    } else {
      const until = Math.max(Date.now(), invincibleUntilRef.current) + 8000;
      invincibleUntilRef.current = until;
      setInvincible(true);
      setShopStatus("Invincible for 8 seconds!");
      setTimeout(
        () => {
          if (invincibleUntilRef.current <= Date.now()) setInvincible(false);
        },
        until - Date.now() + 50,
      );
    }
  };
  const buyPowerup = async (
    kind: "score_boost" | "invincibility" | "heart",
    cost: number,
  ) => {
    setShopStatus("");
    if (kind === "heart" && mode !== "normal") {
      setShopStatus("Glass hearts cannot be healed.");
      return;
    }
    if (gemsRef.current < cost) {
      setShopStatus("Not enough gems.");
      return;
    }
    if (guest) {
      const remaining = gemsRef.current - cost;
      gemsRef.current = remaining;
      setGems(remaining);
      activatePowerup(kind);
      setTimeout(() => {
        setShopOpen(false);
        setPaused(false);
      }, 500);
      return;
    }
    const { data, error } = await supabase.rpc("buy_powerup", {
      powerup: kind,
    });
    if (error) {
      setShopStatus(error.message);
      return;
    }
    if (typeof data === "number") {
      gemsRef.current = data;
      setGems(data);
    }
    activatePowerup(kind);
    setTimeout(() => {
      setShopOpen(false);
      setPaused(false);
    }, 500);
  };
  const loadLeaderboard = async () => {
    const { data } = await supabase.rpc("get_leaderboard");
    setLeaders((data ?? []) as Leader[]);
    setLeaderboardOpen(true);
  };
  if (!authReady)
    return (
      <main className="auth-shell">
        <div className="auth-card loading">Loading Skyway Sprint…</div>
      </main>
    );
  if (!userEmail && !guest)
    return (
      <main className="auth-shell">
        <section className="auth-card">
          <div className="auth-logo">S</div>
          <p>FIVE LANES. NO BRAKES.</p>
          <h1>{authMode === "signin" ? "WELCOME BACK" : "JOIN THE RUN"}</h1>
          <form onSubmit={submitAuth} autoComplete="on">
            <label>
              Email
              <input
                id="login-email"
                name="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="runner@example.com"
                required
                autoComplete="email"
              />
            </label>
            <label>
              Password
              <input
                id="login-password"
                name="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 6 characters"
                minLength={6}
                required
                autoComplete={
                  authMode === "signin" ? "current-password" : "new-password"
                }
              />
            </label>
            {authMode === "signup" && (
              <label>
                Confirm Password
                <input
                  id="confirm-password"
                  name="confirm-password"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Enter the same password again"
                  minLength={6}
                  required
                  autoComplete="new-password"
                />
              </label>
            )}
            {authMessage && (
              <div className="auth-message" role="status">
                {authMessage}
              </div>
            )}
            <button disabled={authBusy}>
              {authBusy
                ? "PLEASE WAIT…"
                : authMode === "signin"
                  ? "SIGN IN →"
                  : "CREATE ACCOUNT →"}
            </button>
          </form>
          {authMode === "signin" && (
            <button
              className="forgot-button"
              onClick={() => sendPasswordReset(email, setAuthMessage)}
            >
              FORGOT PASSWORD?
            </button>
          )}
          <button
            className="auth-switch"
            onClick={() => {
              setAuthMode((v) => (v === "signin" ? "signup" : "signin"));
              setAuthMessage("");
            }}
          >
            {authMode === "signin"
              ? "New runner? Create an account"
              : "Already registered? Sign in"}
          </button>
          <div className="guest-divider">
            <span>OR</span>
          </div>
          <button className="guest-button" onClick={playGuest}>
            PLAY AS GUEST
          </button>
          <small className="guest-note">
            Guest gems disappear after every run.
          </small>
        </section>
      </main>
    );
  return (
    <main className={`game-shell ${flash}`}>
      <div className="game-layout">
        <nav className="game-actions">
          <button
            className="action-leaderboard"
            disabled={playScope === "versus"}
            onClick={() => {
              void loadLeaderboard();
              setPaused(true);
            }}
          >
            <span className="trophy-icon">🏆</span>
            <b>LEADERBOARD</b>
          </button>
          <button
            className="action-versus"
            disabled={playScope === "versus"}
            onClick={() => setVersusOpen(true)}
          >
            <span>⚔</span>
            <b>1V1</b>
          </button>
          <button
            className="action-shop"
            disabled={playScope === "versus"}
            onClick={() => {
              setShopOpen(true);
              setPaused(true);
              setShopStatus("");
              void loadCollection();
            }}
          >
            <span className="cart-icon">
              <i />
              <i />
              <i />
            </span>
            <b>SHOP</b>
          </button>
          {!guest && playScope !== "versus" && (
            <button
              className="action-settings"
              onClick={() => {
                setSettingsOpen(true);
                setPaused(true);
              }}
            >
              <span>⚙</span>
              <b>SETTINGS</b>
            </button>
          )}
          {isAdmin && !guest && playScope !== "versus" && (
            <button className="action-admin" onClick={loadReports}>
              <span>★</span>
              <b>ADMIN</b>
            </button>
          )}
        </nav>
        <section className="game-card" aria-label="Skyway Sprint runner game">
          <header className="topbar">
            <div className="brand">
              <span>S</span>
              <div>
                <b>SKYWAY</b>
                <small>SPRINT</small>
              </div>
            </div>
            <div className="stats">
              <div>
                <small>SCORE</small>
                <strong>{score.toString().padStart(6, "0")}</strong>
              </div>
              <div className="high-score-inline">
                <small>HIGH SCORE</small>
                <strong>{guest ? "—" : highScore.toLocaleString()}</strong>
              </div>
              <div className={`gem-total ${gemBump ? "bump" : ""}`}>
                <small>{guest ? "RUN GEMS" : "ALL-TIME GEMS"}</small>
                <strong className="gold">● {gems}</strong>
                {gemBump && <em>+1</em>}
              </div>
              <div>
                <small>WAVE</small>
                <strong>{wave}</strong>
              </div>
            </div>
            <div className="account">
              <span>{guest ? "GUEST RUNNER" : username || userEmail}</span>
            </div>
          </header>
          <div className="playfield">
            {playScope === "versus" && (
              <div className="versus-hud">
                <div>
                  <small>YOU</small>
                  <b>{hearts} HP</b>
                </div>
                <strong>⚔</strong>
                <div>
                  <small>{versusOpponent}</small>
                  <b>{versusOpponentHearts} HP</b>
                </div>
                <em>OP {versusPoints}</em>
              </div>
            )}
            {waveMessage && (
              <div className="wave-announcement">
                <small>GET READY</small>
                <strong>{waveMessage}</strong>
              </div>
            )}
            <div className="sky">
              <i />
              <i />
              <i />
            </div>
            <div className="horizon">
              {[0, 1, 2, 3, 4].map((n) => (
                <span key={n} />
              ))}
            </div>
            <div className="road">
              {[0, 1, 2, 3].map((n) => (
                <i className={`line l${n}`} key={n} />
              ))}
              <div className="wave-chip">
                WAVE {wave}
                <small>SPEED ×{(1 + (wave - 1) * 0.12).toFixed(2)}</small>
              </div>
              {items.map((x) => (
                <div
                  key={x.id}
                  className={`item ${x.kind}`}
                  style={{ left: `${(x.lane + 0.5) * 20}%`, top: `${x.y}%` }}
                  aria-label={x.kind}
                >
                  <Obstacle kind={x.kind} />
                </div>
              ))}
              <div
                className={invincible ? "runner invincible" : "runner"}
                style={{ left: `${(lane + 0.5) * 20}%` }}
              >
                <div className="head" />
                <div className="body" />
                <i className="arm a1" />
                <i className="arm a2" />
                <i className="leg g1" />
                <i className="leg g2" />
                <em />
              </div>
            </div>
            {!running && (
              <div className="overlay">
                <p>{over ? "RUN OVER" : "FIVE LANES. NO BRAKES."}</p>
                <h1>
                  {over && playScope === "versus" && versusResult
                    ? versusResult
                    : over
                      ? `${score.toLocaleString()} POINTS`
                      : "DODGE. DASH. SURVIVE."}
                </h1>
                {!over && (
                  <div className="mode-select">
                    <button
                      className={mode === "normal" ? "selected" : ""}
                      onClick={() => setMode("normal")}
                    >
                      <b>NORMAL</b>
                      <small>3 hearts · healing enabled</small>
                    </button>
                    <button
                      className={mode === "hardcore" ? "selected" : ""}
                      onClick={() => setMode("hardcore")}
                    >
                      <b>HARDCORE</b>
                      <small>3 glass hearts · 1.5× score</small>
                    </button>
                    <button
                      className={mode === "impossible" ? "selected" : ""}
                      onClick={() => setMode("impossible")}
                    >
                      <b>IMPOSSIBLE</b>
                      <small>1 glass heart · 2× score</small>
                    </button>
                  </div>
                )}
                <button
                  onClick={
                    playScope === "versus"
                      ? () => {
                          backToMenu();
                          setVersusOpen(true);
                        }
                      : reset
                  }
                >
                  {playScope === "versus"
                    ? "FIND NEW RIVAL"
                    : over
                      ? "RUN AGAIN"
                      : "START RUN"}{" "}
                  <span>→</span>
                </button>
                {over && (
                  <button className="back-menu" onClick={backToMenu}>
                    BACK TO MENU
                  </button>
                )}
                <small>← → / A D &nbsp; TO SWITCH LANES</small>
              </div>
            )}
            {versusPhase === "intermission" && (
              <div className="overlay versus-intermission">
                <p>NEXT WAVE IN</p>
                <h1>{versusCountdown}</h1>
                <strong>OBSTACLE POINTS: {versusPoints}</strong>
                <div className="attack-grid">
                  <button
                    disabled={versusPoints < 2}
                    onClick={() => sendVersusAttack("barrel")}
                  >
                    BARREL <small>2 OP</small>
                  </button>
                  <button
                    disabled={versusPoints < 2}
                    onClick={() => sendVersusAttack("log")}
                  >
                    LOG <small>2 OP</small>
                  </button>
                  <button
                    disabled={versusPoints < 3}
                    onClick={() => sendVersusAttack("car")}
                  >
                    CAR <small>3 OP</small>
                  </button>
                  <button
                    disabled={versusPoints < 3}
                    onClick={() => sendVersusAttack("rock")}
                  >
                    ROCK <small>3 OP</small>
                  </button>
                </div>
                <small>
                  Purchased obstacles attack {versusOpponent} next wave.
                </small>
                {versusResult && (
                  <div className="versus-message">{versusResult}</div>
                )}
              </div>
            )}
            {paused && versusPhase !== "intermission" && (
              <div className="overlay compact">
                <h1>PAUSED</h1>
                <button onClick={() => setPaused(false)}>KEEP RUNNING</button>
              </div>
            )}
          </div>
          <footer>
            <button onClick={() => move(-1)} aria-label="Move left">
              ←
            </button>
            <p>
              <b>SWITCH LANES</b>
              <small>Use arrows, A / D, or tap</small>
            </p>
            <button onClick={() => move(1)} aria-label="Move right">
              →
            </button>
            <div
              className={`health ${mode !== "normal" ? "glass" : ""}`}
              aria-label={`${hearts} hearts`}
            >
              {Array.from({ length: Math.ceil(maxHearts) }, (_, n) => n).map(
                (n) => (
                  <span
                    key={n}
                    className={
                      hearts - n >= 1 ? "" : hearts - n > 0 ? "partial" : "lost"
                    }
                  >
                    ♥
                  </span>
                ),
              )}
            </div>
            <button
              className="pause"
              disabled={playScope === "versus"}
              onClick={() =>
                running && playScope !== "versus" && setPaused((v) => !v)
              }
              aria-label="Pause"
            >
              {playScope === "versus" ? "⚔" : paused ? "▶" : "Ⅱ"}
            </button>
          </footer>
        </section>
        {(settingsOpen || usernameRequired) && !guest && (
          <div className="report-backdrop" role="dialog" aria-modal="true">
            <section className="settings-modal">
              {!usernameRequired && (
                <button
                  className="report-close"
                  onClick={() => {
                    setSettingsOpen(false);
                    setPaused(false);
                  }}
                >
                  ×
                </button>
              )}
              <p>PLAYER SETTINGS</p>
              <h2>{usernameRequired ? "CHOOSE A USERNAME" : "SETTINGS"}</h2>
              {usernameRequired && (
                <div className="required-note">
                  A username is required before you can play.
                </div>
              )}
              {usernameRequired || editUsername ? (
                <form onSubmit={saveUsername}>
                  <label>
                    USERNAME
                    <input
                      value={usernameInput}
                      onChange={(e) => setUsernameInput(e.target.value)}
                      minLength={3}
                      maxLength={20}
                      pattern="[A-Za-z0-9_]+"
                      placeholder="3-20 letters, numbers, underscores"
                      required
                    />
                  </label>
                  {usernameStatus && (
                    <div className="report-status">{usernameStatus}</div>
                  )}
                  <button>SAVE USERNAME</button>
                  {!usernameRequired && (
                    <button
                      type="button"
                      className="settings-cancel"
                      onClick={() => setEditUsername(false)}
                    >
                      CANCEL
                    </button>
                  )}
                </form>
              ) : (
                <button
                  className="settings-action"
                  onClick={() => {
                    setEditUsername(true);
                    setUsernameStatus("");
                  }}
                >
                  CHANGE USERNAME
                </button>
              )}
              {!usernameRequired && (
                <>
                  {editPassword ? (
                    <form onSubmit={changePassword}>
                      <label>
                        NEW PASSWORD
                        <input
                          id="new-password"
                          name="new-password"
                          autoComplete="new-password"
                          type="password"
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          minLength={6}
                          required
                        />
                      </label>
                      {passwordStatus && (
                        <div className="report-status">{passwordStatus}</div>
                      )}
                      <button>SAVE NEW PASSWORD</button>
                      <button
                        type="button"
                        className="forgot-settings"
                        onClick={() =>
                          sendPasswordReset(userEmail || "", setPasswordStatus)
                        }
                      >
                        EMAIL ME A RECOVERY LINK
                      </button>
                      <button
                        type="button"
                        className="settings-cancel"
                        onClick={() => setEditPassword(false)}
                      >
                        CANCEL
                      </button>
                    </form>
                  ) : (
                    <button
                      className="settings-action"
                      onClick={() => {
                        setEditPassword(true);
                        setPasswordStatus("");
                      }}
                    >
                      CHANGE PASSWORD
                    </button>
                  )}
                  <div className="settings-report">
                    <h3>REPORT AN ISSUE</h3>
                    <form onSubmit={submitReport}>
                      <label>
                        TYPE
                        <select
                          value={reportType}
                          onChange={(e) => setReportType(e.target.value)}
                        >
                          <option>Bug</option>
                          <option>Gameplay problem</option>
                          <option>Account problem</option>
                          <option>Suggestion</option>
                          <option>Other</option>
                        </select>
                      </label>
                      <label>
                        DETAILS
                        <textarea
                          value={reportMessage}
                          onChange={(e) => setReportMessage(e.target.value)}
                          minLength={10}
                          maxLength={1500}
                          required
                        />
                      </label>
                      {reportStatus && (
                        <div className="report-status">{reportStatus}</div>
                      )}
                      <button disabled={reportBusy}>
                        {reportBusy ? "SENDING…" : "SEND REPORT"}
                      </button>
                    </form>
                  </div>
                </>
              )}
              {!usernameRequired && (
                <button className="signout-settings" onClick={signOut}>
                  SIGN OUT
                </button>
              )}
            </section>
          </div>
        )}
        {versusOpen && (
          <div className="report-backdrop">
            <section className="versus-modal">
              <button
                className="report-close"
                onClick={() => {
                  if (versusPhase === "searching") void cancelVersus();
                  else {
                    setVersusOpen(false);
                    if (playScope === "versus") setPaused(false);
                  }
                }}
              >
                ×
              </button>
              <p>MULTI-DEVICE REALTIME</p>
              <h2>SKYWAY 1V1</h2>
              {playScope === "versus" ? (
                <>
                  <div className="rival-card">
                    <span>
                      {username || "YOU"}
                      <b>{hearts} HP</b>
                    </span>
                    <strong>VS</strong>
                    <span>
                      {versusOpponent}
                      <b>{versusOpponentHearts} HP</b>
                    </span>
                  </div>
                  <button
                    className="versus-primary"
                    onClick={() => {
                      setVersusOpen(false);
                      setPaused(false);
                    }}
                  >
                    RETURN TO MATCH
                  </button>
                </>
              ) : versusPhase === "searching" ? (
                <>
                  <div className="matchmaking-spinner">⚔</div>
                  <h3>FINDING AN OPPONENT…</h3>
                  <button
                    className="versus-cancel"
                    onClick={() => void cancelVersus()}
                  >
                    CANCEL SEARCH
                  </button>
                </>
              ) : (
                <>
                  <p className="versus-rules">
                    Survive longer than your rival. Coins earn <b>2 OP</b> and
                    completed waves earn <b>3 OP</b>. Spend OP during each
                    15-second intermission to send obstacles to your opponent.
                  </p>
                  <div className="cost-row">
                    <span>LOG 2</span>
                    <span>BARREL 2</span>
                    <span>CAR 3</span>
                    <span>ROCK 3</span>
                  </div>
                  <button
                    className="versus-primary"
                    onClick={() => void findVersusMatch()}
                    disabled={guest}
                  >
                    FIND OPPONENT
                  </button>
                  {guest && <small>SIGN IN TO PLAY 1V1</small>}
                </>
              )}
              {versusResult && (
                <div className="versus-message">{versusResult}</div>
              )}
            </section>
          </div>
        )}
        {shopOpen && (
          <div className="report-backdrop">
            <section className="powerup-modal">
              <button
                className="report-close"
                onClick={() => {
                  setShopOpen(false);
                  setPaused(false);
                }}
              >
                ×
              </button>
              <p>GEM SHOP</p>
              <h2>EXTRACTION + LOADOUT</h2>
              <div className="extract-actions">
                <button onClick={() => extract(1)}>
                  <b>EXTRACT ×1</b>
                  <span>♦ 2</span>
                </button>
                <button onClick={() => extract(10)}>
                  <b>EXTRACT ×10</b>
                  <span>♦ 20</span>
                  <small>10th is rare or better</small>
                </button>
              </div>
              {extractResults.length > 0 && (
                <div className="extract-results">
                  {extractResults.map((item, index) => (
                    <span key={item.item_key + index} className={item.rarity}>
                      {item.rarity} · {item.item_key.replaceAll("_", " ")}
                    </span>
                  ))}
                </div>
              )}
              <h3>CLASSES</h3>
              <div className="class-grid">
                <button
                  className={playerClass === "runner" ? "equipped" : ""}
                  onClick={() => equipClass("runner")}
                >
                  <b>RUNNER</b>
                  <small>Standard balanced class</small>
                </button>
                {["medic", "tank", "trickster"].map((key) => {
                  const owned = unlocks.some(
                    (x) => x.item_type === "class" && x.item_key === key,
                  );
                  return (
                    <button
                      key={key}
                      disabled={!owned}
                      className={playerClass === key ? "equipped" : ""}
                      onClick={() => equipClass(key)}
                    >
                      <b>{key.toUpperCase()}</b>
                      <small>
                        {owned
                          ? key === "medic"
                            ? "Overheal beyond max HP"
                            : key === "tank"
                              ? "5 HP · heals ½"
                              : "2 HP · double damage · graze bonus"
                          : "LOCKED — extract to unlock"}
                      </small>
                    </button>
                  );
                })}
              </div>
              <h3>COSMETICS</h3>
              <div className="cosmetic-grid">
                {unlocks.filter((x) => x.item_type !== "class").length === 0 ? (
                  <small>No cosmetics unlocked yet.</small>
                ) : (
                  unlocks
                    .filter((x) => x.item_type !== "class")
                    .map((item) => (
                      <button
                        key={item.item_key}
                        onClick={() => equipCosmetic(item)}
                      >
                        <b>{item.item_key.replaceAll("_", " ")}</b>
                        <small>
                          {item.rarity} · {item.item_type}
                        </small>
                      </button>
                    ))
                )}
              </div>
              <h3>POWERUPS</h3>
              <div className="powerup-grid">
                <button onClick={() => buyPowerup("score_boost", 8)}>
                  <b>+1,000 SCORE</b>
                  <span>♦ 8</span>
                  <small>Instant score boost</small>
                </button>
                <button onClick={() => buyPowerup("invincibility", 13)}>
                  <b>INVINCIBILITY</b>
                  <span>♦ 13</span>
                  <small>No damage for 8 seconds</small>
                </button>
                <button onClick={() => buyPowerup("heart", 5)}>
                  <b>RESTORE HEART</b>
                  <span>♦ 5</span>
                  <small>Recover one lost heart</small>
                </button>
              </div>
              <strong className="shop-balance">BALANCE: ♦ {gems}</strong>
              {shopStatus && <div className="report-status">{shopStatus}</div>}
            </section>
          </div>
        )}
        {leaderboardOpen && (
          <div className="report-backdrop">
            <section className="leaderboard-modal">
              <button
                className="report-close"
                onClick={() => {
                  setLeaderboardOpen(false);
                  setPaused(false);
                }}
              >
                ×
              </button>
              <p>LEADERBOARD 1</p>
              <h2>TOP RUNNERS</h2>
              <div className="leader-list">
                {leaders.length === 0 ? (
                  <div className="empty-reports">No scores yet.</div>
                ) : (
                  leaders.map((entry) => (
                    <div
                      key={entry.username + entry.rank}
                      className={entry.username === username ? "me" : ""}
                    >
                      <b>#{entry.rank}</b>
                      <span>{entry.username}</span>
                      <strong>{entry.high_score.toLocaleString()}</strong>
                    </div>
                  ))
                )}
              </div>
            </section>
          </div>
        )}
        {adminOpen && isAdmin && (
          <div className="report-backdrop">
            <section className="admin-inbox">
              <button
                className="report-close"
                onClick={() => {
                  setAdminOpen(false);
                  setPaused(false);
                }}
              >
                ×
              </button>
              <p>ADMIN CONTROL</p>
              <h2>{adminTab === "reports" ? "REPORT INBOX" : "ADMIN TEAM"}</h2>
              <div className="admin-tabs">
                <button
                  className={adminTab === "reports" ? "active" : ""}
                  onClick={() => setAdminTab("reports")}
                >
                  REPORTS
                </button>
                <button
                  className={adminTab === "admins" ? "active" : ""}
                  onClick={loadAdmins}
                >
                  ADMINS
                </button>
              </div>
              {adminTab === "reports" ? (
                <>
                  <div className="admin-toolbar">
                    <button onClick={copyOpenReports}>
                      COPY ALL OPEN REPORTS
                    </button>
                    {copyStatus && <span>{copyStatus}</span>}
                  </div>
                  <h3 className="inbox-heading">
                    OPEN REPORTS <span>{reports.length}</span>
                  </h3>
                  <div className="report-list">
                    {reports.length === 0 ? (
                      <div className="empty-reports">No open reports.</div>
                    ) : (
                      reports.map((r) => (
                        <article key={r.id}>
                          <header>
                            <b>{r.report_type}</b>
                            <span>{r.status.toUpperCase()}</span>
                          </header>
                          <p>{r.message}</p>
                          <small>
                            {new Date(r.created_at).toLocaleString()} ·{" "}
                            {r.user_id.slice(0, 8)}
                          </small>
                          <button onClick={() => resolveReport(r.id)}>
                            RESOLVE & DELETE
                          </button>
                        </article>
                      ))
                    )}
                  </div>
                </>
              ) : (
                <div className="admin-team">
                  {adminRole === "main" && (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        void manageAdmin(adminTarget, "add");
                      }}
                    >
                      <label>
                        ADD BY EMAIL OR USERNAME
                        <input
                          value={adminTarget}
                          onChange={(e) => setAdminTarget(e.target.value)}
                          required
                          placeholder="player@email.com or username"
                        />
                      </label>
                      <button>ADD CO-ADMIN</button>
                    </form>
                  )}
                  {adminStatus && (
                    <div className="report-status">{adminStatus}</div>
                  )}
                  <div className="admin-list">
                    {admins.map((a) => (
                      <article key={a.user_id}>
                        <div>
                          <b>{a.username || "No username"}</b>
                          <small>{a.email}</small>
                        </div>
                        <span>
                          {a.role === "main" ? "MAIN ADMIN" : "CO-ADMIN"}
                        </span>
                        {adminRole === "main" && a.email !== userEmail && (
                          <div className="admin-actions">
                            {a.role === "co_admin" ? (
                              <>
                                <button
                                  onClick={() =>
                                    manageAdmin(a.email, "promote")
                                  }
                                >
                                  PROMOTE
                                </button>
                                <button
                                  onClick={() => manageAdmin(a.email, "remove")}
                                >
                                  KICK
                                </button>
                              </>
                            ) : (
                              <button
                                onClick={() => manageAdmin(a.email, "demote")}
                              >
                                MAKE CO-ADMIN
                              </button>
                            )}
                          </div>
                        )}
                      </article>
                    ))}
                  </div>
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
