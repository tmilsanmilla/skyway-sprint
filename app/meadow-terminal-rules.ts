export const VORTEX_SPEED_FACTOR = (0.72 + 1) / 2;
export const TERMINAL_SWORD_DURABILITY = 4;
export const TERMINAL_SWORD_COOLDOWN_MS = 3000;

export const mapScoreBonus = (map: string, lane: number, bonusLane: number, spikeLanes: readonly number[]) =>
  (map === "meadow" && lane === bonusLane) || (map === "terminal" && spikeLanes.includes(lane)) ? 1.4 : 1;

export const mapContactDamage = (map: string, kind: string, damage: number, lane: number, bonusLane: number) =>
  map === "meadow" && lane === bonusLane ? damage * 2 : map === "terminal" && kind === "spikes" ? 2 : damage;

export const vortexBlocksTurn = (direction: number, blockedDirection: number, until: number, now: number) =>
  until > now && Math.sign(direction) === blockedDirection;

export type SwordState = { durability: number; cooldownUntil: number };
export const resolveTerminalSword = (self: SwordState, rival: SwordState, selfLane: number, rivalLane: number, now: number) => {
  if (self.durability <= 0 || self.cooldownUntil > now)
    return { used: false, hit: false, selfDamage: 0, rivalDamage: 0, self, rival };
  const hit = selfLane === rivalLane;
  return {
    used: true, hit, selfDamage: hit ? 0 : 0.5, rivalDamage: hit ? 1 : 0,
    self: { durability: self.durability - (hit ? 0 : 1), cooldownUntil: now + TERMINAL_SWORD_COOLDOWN_MS },
    rival: hit ? { ...rival, cooldownUntil: Math.max(rival.cooldownUntil, now + TERMINAL_SWORD_COOLDOWN_MS) } : rival,
  };
};

// A persisted match/wave clock and seed put both players on the same course.
// Each lane reserves its entire travel time before another object can spawn.
export type CourseItem = { id: number; lane: number; kind: "log" | "spikes" | "barrel" | "rock" | "snowflake" | "current" | "gem" | "coin"; at: number; speed: number };
export const createTerminalCourse = (seed: string, wave: number): readonly CourseItem[] => {
  let state = 2166136261;
  for (const char of `${seed}:${wave}`) state = Math.imul(state ^ char.charCodeAt(0), 16777619) >>> 0;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const waveSpeed = 2 + Math.max(0, wave - 1) * 0.25;
  const freeAt = [0, 0, 0, 0, 0];
  const course: CourseItem[] = [];
  let lastHazard: CourseItem["kind"] | null = null;
  let hazardStreak = 0;
  const kinds: CourseItem["kind"][] = ["log", "spikes", "spikes", "rock", "snowflake", "barrel", "coin", "coin", "gem"];
  // Cover low-frame-rate waves too, so the course never runs out early.
  for (let at = 0, slot = 0; at < 90000; at += Math.max(220, 850 - wave * 35), slot++) {
    const available = freeAt.flatMap((time, lane) => time <= at ? [lane] : []);
    // Keep at least one lane free; successive hazards still use all five lanes.
    if (available.length < 2) continue;
    const lane = available[Math.floor(random() * available.length)];
    let kind = kinds[Math.floor(random() * kinds.length)];
    if (kind !== "coin" && kind !== "gem") {
      if (kind === lastHazard && hazardStreak >= 4) kind = kind === "log" ? "spikes" : "log";
      hazardStreak = kind === lastHazard ? hazardStreak+1 : 1;
      lastHazard = kind;
    }
    const factor = kind === "log" ? .72 : kind === "rock" ? .3 : kind === "barrel" ? 1.75 : 1;
    const speed = .0452 * waveSpeed * factor;
    course.push({ id: -(wave * 100000 + slot + 1), lane, kind, at, speed });
    freeAt[lane] = at + 120 / speed;
  }
  return course;
};

export const visibleTerminalCourse = (course: readonly CourseItem[], elapsed: number, consumed: ReadonlySet<number>) =>
  course.flatMap((item) => {
    const y = -12 + (elapsed - item.at) * item.speed;
    return elapsed >= item.at && y < 108 && !consumed.has(item.id) ? [{ ...item, y, sharedCourse: true as const }] : [];
  });

export const combineTerminalCourse = (natural: readonly CourseItem[], attacks: readonly CourseItem[]): readonly CourseItem[] => {
  const freeAt = [0,0,0,0,0];
  return [...natural,...attacks].sort((a,b)=>a.at-b.at || a.id-b.id).map(item=>{
    let at=Math.max(item.at,freeAt[item.lane]);
    // Do not close all five lanes at once, even with many bought hazards.
    const others=freeAt.filter((_,lane)=>lane!==item.lane);
    if(others.every(time=>time>at)) at=Math.min(...others);
    freeAt[item.lane]=at+120/item.speed;
    return {...item,at};
  });
};
