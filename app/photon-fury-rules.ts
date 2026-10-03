/** Laserdrome is deliberately separate from the ordinary 1v1 map catalog. */
export const PHOTON_RULES = {
  lanes: 4, unlockLevel: 15, price: 100, startingHp: 4,
  durability: 7, guardSeconds: 0.4, cooldownSeconds: 0.6,
  needleSeconds: 4, needleDamageChance: 0.35, waveSeconds: 27,
} as const;
export const PHOTON_WEIGHTS = { rock: 10, needle: 10, car: 15, log: 15, spike: 25, barrel: 25 } as const;
export type PhotonHazard = keyof typeof PHOTON_WEIGHTS;
export type PhotonItem = { id: number; kind: PhotonHazard; lane: number; y: number };
export type PhotonRun = {
  elapsed: number; hp: number; lane: number; photons: number; durability: number;
  guardUntil: number; cooldownUntil: number; needleUntil: number;
  lastHitAt: number; nextSpawnAt: number; nextId: number; items: PhotonItem[];
};
export const createPhotonRun = (): PhotonRun => ({
  elapsed: 0, hp: 4, lane: 1, photons: 0, durability: 7,
  guardUntil: 0, cooldownUntil: 0, needleUntil: 0,
  lastHitAt: -10, nextSpawnAt: 0.6, nextId: 1, items: [],
});
export const multiplyBonuses = (...multipliers: number[]) => multipliers.reduce((a, b) => a * b, 1);
export const addTurnDelays = (...seconds: number[]) => seconds.reduce((a, b) => a + b, 0);
export const photonSpeed = (elapsed: number) => 1.004 ** Math.max(0, elapsed);
export const photonScore = (elapsed: number) => Math.max(0, elapsed) / PHOTON_RULES.waveSeconds * 0.1;
export const photonReward = (points: number, score: number) => Math.max(0, Math.floor(Math.max(0, points) * (1 + Math.max(0, score)) ** 2));
export const pickPhotonHazard = (random: number): PhotonHazard => {
  let remaining = Math.max(0, Math.min(0.999999, random)) * 100;
  for (const [kind, weight] of Object.entries(PHOTON_WEIGHTS)) {
    remaining -= weight;
    if (remaining < 0) return kind as PhotonHazard;
  }
  return "barrel";
};
export const activatePhotonSaber = (run: PhotonRun): PhotonRun => {
  if (run.hp <= 0 || run.durability <= 0 || run.guardUntil > 0 || run.elapsed < run.cooldownUntil) return run;
  return { ...run, guardUntil: run.elapsed + PHOTON_RULES.guardSeconds };
};
export const movePhoton = (run: PhotonRun, direction: number, random: number): PhotonRun => {
  const lane = Math.max(0, Math.min(3, run.lane + Math.sign(direction)));
  if (lane === run.lane || run.hp <= 0) return run;
  return { ...run, lane, hp: Math.max(0, run.hp - (run.needleUntil > run.elapsed && random < .35 ? .5 : 0)) };
};
const DAMAGE: Record<PhotonHazard, number> = { rock: 2, needle: 0, car: 1, log: 1, spike: 1, barrel: .5 };
const SPEED: Record<PhotonHazard, number> = { rock: .35, needle: 1, car: 1.25, log: .72, spike: 1, barrel: 1.5 };
/** dt is ACTIVE time only. Pauses and open menus must never advance this clock. */
export const advancePhotonRun = (previous: PhotonRun, dt: number, random: () => number = Math.random): PhotonRun => {
  if (previous.hp <= 0 || dt <= 0) return previous;
  const run = { ...previous, items: previous.items.map(item => ({ ...item })), elapsed: previous.elapsed + Math.min(dt, .05) };
  const travel = Math.min(dt, .05) * .24 * photonSpeed(run.elapsed);
  // Spawn at most three occupied lanes. Nothing can overtake another object in a lane.
  if (run.elapsed >= run.nextSpawnAt) {
    const free = [0, 1, 2, 3].filter(lane => !run.items.some(item => item.lane === lane));
    if (free.length > 1) run.items.push({ id: run.nextId++, kind: pickPhotonHazard(random()), lane: free[Math.floor(random() * free.length)], y: -.12 });
    run.nextSpawnAt = run.elapsed + .65 / Math.sqrt(photonSpeed(run.elapsed));
  }
  const remaining: PhotonItem[] = [];
  for (const item of run.items) {
    item.y += travel * SPEED[item.kind];
    if (item.lane === run.lane && item.y >= .73 && item.y <= .88) {
      if (run.guardUntil > run.elapsed) {
        run.photons += 1;
        run.durability -= item.kind === "car" ? 1 : 0;
        run.guardUntil = 0;
        run.cooldownUntil = run.elapsed + .6;
        continue; // Exactly one block per swing; the next item cannot be reflected.
      }
      if (item.kind === "needle") {
        run.needleUntil = Math.max(run.elapsed, run.needleUntil) + 4;
        continue;
      }
      if (run.elapsed - run.lastHitAt >= .8) {
        run.hp = Math.max(0, run.hp - DAMAGE[item.kind]);
        run.lastHitAt = run.elapsed;
        continue;
      }
    }
    if (item.y <= 1.15) remaining.push(item);
  }
  run.items = remaining;
  if (run.guardUntil > 0 && run.elapsed >= run.guardUntil) {
    run.cooldownUntil = run.guardUntil + .6;
    run.guardUntil = 0;
    run.hp = Math.max(0, run.hp - .5);
  }
  return run;
};
