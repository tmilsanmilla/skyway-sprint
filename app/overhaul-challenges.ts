export type ChallengeRandom = () => number;
const unit = (random: ChallengeRandom) => {
  const value = random();
  if (!Number.isFinite(value) || value < 0 || value >= 1) throw new Error("Invalid challenge random value");
  return value;
};
export const challengeInteger = (random: ChallengeRandom, count: number) => Math.floor(unit(random) * count);
export const shuffled = <T>(items: readonly T[], random: ChallengeRandom) => {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = challengeInteger(random, i + 1);
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
};

export const GAMBIT_HANDS = ["None", "Pair", "Two Pair", "Triplet", "Full House", "Straight", "Four of a Kind / Three Pair", "Straighter", "Fuller House", "Two Triplet", "Five of a Kind", "Six of a Kind"] as const;
export function gambitHand(dice: readonly number[]) {
  if (dice.length !== 6 || dice.some(value => !Number.isInteger(value) || value < 1 || value > 8)) throw new Error("Roll six eight-sided dice");
  const counts = new Map<number, number>();
  dice.forEach(value => counts.set(value, (counts.get(value) || 0) + 1));
  const groups = [...counts.values()].sort((a, b) => b - a), values = [...counts.keys()].sort((a, b) => a - b);
  let run = 1, straight = 1;
  for (let i = 1; i < values.length; i += 1) {
    run = values[i] === values[i - 1] + 1 ? run + 1 : 1;
    straight = Math.max(straight, run);
  }
  if (groups[0] === 6) return 11;
  if (groups[0] === 5) return 10;
  if (groups[0] === 3 && groups[1] === 3) return 9;
  if (groups[0] === 4 && groups[1] === 2) return 8;
  if (straight === 6) return 7;
  if (groups[0] === 4 || groups.filter(value => value === 2).length === 3) return 6;
  if (straight >= 5) return 5;
  if (groups[0] === 3 && groups[1] === 2) return 4;
  if (groups[0] === 3) return 3;
  if (groups.filter(value => value === 2).length === 2) return 2;
  return groups[0] === 2 ? 1 : 0;
}
export function gambitRevival(dice: readonly number[]) {
  const hand = gambitHand(dice), sum = dice.reduce((a, b) => a + b, 0);
  const z = [0, 0, -45, -30, -15, -5, 5, 15, 30, 40, 55, 75][hand];
  return { hand, name: GAMBIT_HANDS[hand], hp: hand < 2 ? 0 : hand >= 11 ? 2 : hand >= 10 ? 1.5 : hand >= 8 ? 1 : 0.5,
    percent: hand < 2 ? 0 : z + sum, lowMelonScore: hand === 2, logDamage: hand >= 10 ? 0.5 : null };
}
export function rerollGambit(dice: readonly number[], selected: readonly number[], rerolls: number, random: ChallengeRandom) {
  gambitHand(dice);
  if (!Number.isInteger(rerolls) || rerolls < 0 || rerolls >= 3) throw new Error("All three rerolls are used");
  const indexes = new Set(selected);
  if (!indexes.size || [...indexes].some(value => !Number.isInteger(value) || value < 0 || value >= 6)) throw new Error("Select the dice to reroll");
  return dice.map((value, index) => indexes.has(index) ? 1 + challengeInteger(random, 8) : value);
}
export const initialGambitRoll = (random: ChallengeRandom) => Array.from({ length: 6 }, () => 1 + challengeInteger(random, 8));

export const EUCHRE_RANKS = ["9", "10", "J", "Q", "K", "A"] as const;
export const EUCHRE_SUITS = ["H", "D", "C", "S"] as const;
export type EuchreCard = `${(typeof EUCHRE_RANKS)[number]}${(typeof EUCHRE_SUITS)[number]}`;
export const freshEuchreDeck = (random: ChallengeRandom) => shuffled(EUCHRE_SUITS.flatMap(suit => EUCHRE_RANKS.map(rank => `${rank}${suit}` as EuchreCard)), random);
export const wildcardChoiceCount = (remaining: number) => remaining >= 11 ? 3 : remaining >= 5 ? 2 : remaining > 0 ? 1 : 0;
export const wildcardCardDescription = (card: EuchreCard, online: boolean) => {
  const rank = card.slice(0, -1), suit = card.slice(-1);
  if (rank === "9") return suit === "S" ? "After 15 seconds, heal 0.5 HP and collect all current pickups once." : online ? "+9% opponent melon-to-spike override, up to 27%." : "Keep this card; its opponent override has no Endless target.";
  if (rank === "10") return "+10 stardust per gem, up to +40.";
  if (rank === "J") return suit === "S" ? "Snowflake freeze lasts 1.5 seconds." : `Send ${suit === "C" ? "a rock and snowflake" : suit === "D" ? "a car and spike" : "a barrel and log"} once${online ? "" : "; no opponent in Endless"}.`;
  if (rank === "Q") return online ? "+2% opponent turn confusion, up to 8%." : "Gem XP becomes 20 / 35 / 60 / 100 with one / two / three / four Queens.";
  if (rank === "K") return online ? "+0.04 seconds opponent input delay, up to 0.16." : "+3% score, up to +12%.";
  if (suit === "H" || suit === "D") return "Discard this Ace and draw the next two cards; another red Ace chains its two draws.";
  if (suit === "C") return online ? "Send one random legal obstacle and deal 0.5 HP once." : "Move 15% slower while holding it.";
  return online ? "After a random 10–25 seconds, teleport the opponent into a different lane once." : "After a random 10–25 seconds, collect all gems and melons once.";
};
export function takeWildcard(deck: readonly EuchreCard[], choice: number, random: ChallengeRandom) {
  const count = wildcardChoiceCount(deck.length);
  if (!count || !Number.isInteger(choice) || choice < 0 || choice >= count) throw new Error("Choose one of the shown cards");
  const selected = deck[choice], rest = [...deck]; rest.splice(choice, 1);
  // The rejected visible cards really go back into the deck; their old top
  // positions do not leak into the next choice. The selected card is removed.
  const next = shuffled(rest, random), drawn: EuchreCard[] = [], discarded: EuchreCard[] = [];
  const pending: EuchreCard[] = [selected];
  while (pending.length) {
    const card = pending.shift()!;
    if (card === "AH" || card === "AD") {
      discarded.push(card);
      pending.push(...next.splice(0, 2));
    } else drawn.push(card);
  }
  return { deck: next, drawn, discarded };
}

export const MATH_NUMBERS = Array.from({ length: 77 }, (_, i) => i + 21).filter(value => value % 5 !== 0);
export function createProdigyQuestion(random: ChallengeRandom) {
  const first = challengeInteger(random, MATH_NUMBERS.length), second = challengeInteger(random, MATH_NUMBERS.length - 1);
  const a = MATH_NUMBERS[first], b = MATH_NUMBERS[second >= first ? second + 1 : second];
  return { a, b, answer: String(a + b) };
}
export const isNumericAnswer = (value: string) => /^\d{1,3}$/.test(value);
export const IMAGINATION_COLORS = ["red", "orange", "yellow", "green", "blue", "purple"] as const;
export const appendImaginationColors = (prior: readonly number[], random: ChallengeRandom) => [...prior, 1 + challengeInteger(random, 6), 1 + challengeInteger(random, 6)];
export const matchImaginationInput = (sequence: readonly number[], input: readonly number[]) =>
  input.every((value, index) => value >= 1 && value <= 6 && sequence[index] === value) ? input.length === sequence.length ? "complete" : "continue" : "wrong";

export type DrawingPoint = readonly [number, number];
function normalizeDrawing(points: readonly DrawingPoint[]) {
  if (points.length < 3 || points.some(point => point.some(value => !Number.isFinite(value)))) return [];
  const xs = points.map(point => point[0]), ys = points.map(point => point[1]);
  const x = (Math.min(...xs) + Math.max(...xs)) / 2, y = (Math.min(...ys) + Math.max(...ys)) / 2;
  const size = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  if (size < 0.001) return [];
  return points.map(point => [(point[0] - x) / size, (point[1] - y) / size] as DrawingPoint);
}
function resampleDrawing(points: readonly DrawingPoint[], count = 96) {
  const path = [...points, points[0]], distances = [0];
  for (let i = 1; i < path.length; i += 1) distances.push(distances[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]));
  if (distances.at(-1)! < 0.001) return [];
  let segment = 1;
  return Array.from({ length: count }, (_, index) => {
    const at = distances.at(-1)! * index / count;
    while (segment < path.length - 1 && distances[segment] < at) segment += 1;
    const fraction = (at - distances[segment - 1]) / Math.max(1e-9, distances[segment] - distances[segment - 1]);
    return [path[segment - 1][0] + (path[segment][0] - path[segment - 1][0]) * fraction,
      path[segment - 1][1] + (path[segment][1] - path[segment - 1][1]) * fraction] as DrawingPoint;
  });
}
export function cartographyAccuracy(drawing: readonly DrawingPoint[], target: readonly DrawingPoint[]) {
  const a = normalizeDrawing(drawing), b = normalizeDrawing(target);
  if (!a.length || !b.length) return 0;
  const left = resampleDrawing(a), right = resampleDrawing(b);
  const nearest = (p: DrawingPoint, points: readonly DrawingPoint[]) => points.reduce((min, q) => Math.min(min, Math.hypot(p[0] - q[0], p[1] - q[1])), 2);
  const error = (left.reduce((sum, point) => sum + nearest(point, right), 0) + right.reduce((sum, point) => sum + nearest(point, left), 0)) / (left.length + right.length);
  return Math.max(0, Math.min(1, 1 - error * 5));
}
/** Score disconnected islands/strokes without inventing lines between them.
 * Translation and one uniform scale are removed for the entire drawing. */
export function cartographyMultiAccuracy(drawing: readonly (readonly DrawingPoint[])[], target: readonly (readonly DrawingPoint[])[]) {
  const cloud = (paths: readonly (readonly DrawingPoint[])[]) => {
    const all=paths.flatMap(path=>path.length>=2 ? [...path] : []);
    const normalized=normalizeDrawing(all); if(!normalized.length)return [];
    let offset=0;
    return paths.flatMap(path=>{
      if(path.length<2)return [];
      const points=normalized.slice(offset,offset+path.length);offset+=path.length;
      return resampleDrawing(points,Math.max(12,Math.min(96,points.length)));
    });
  };
  const a=cloud(drawing),b=cloud(target);if(!a.length||!b.length)return 0;
  const error=(from:readonly DrawingPoint[],to:readonly DrawingPoint[])=>from.reduce((sum,p)=>sum+to.reduce((best,q)=>Math.min(best,Math.hypot(p[0]-q[0],p[1]-q[1])),2),0)/from.length;
  return Math.max(0,Math.min(1,1-2.5*(error(a,b)+error(b,a))));
}

export const CONIC_NAMES = ["Ellipse", "Circle", "Parabola", "Hyperbola", "Spiral", "Infinity", "Flat tire", "Lemon", "Potato", "Chip"] as const;
export const nextConicShape = (prior: number, random: ChallengeRandom) => {
  const n = challengeInteger(random, prior >= 0 ? 9 : 10);
  return prior >= 0 && n >= prior ? n + 1 : n;
};
const pathFromPoints = (points: readonly DrawingPoint[]) => points.map((point, i) => `${i ? "L" : "M"}${(100 + point[0] * 65).toFixed(2)},${(100 - point[1] * 65).toFixed(2)}`).join(" ");
/** Grid-free SVG contours; computed at challenge creation, never per frame. */
export function conicShapePath(shape: number, eccentricity = 0.65) {
  const t = Array.from({ length: 180 }, (_, i) => i / 179 * Math.PI * 2);
  if (shape === 0) return pathFromPoints(t.map(angle => [Math.cos(angle), Math.sin(angle) * Math.sqrt(1 - eccentricity ** 2)]));
  if (shape === 1) return pathFromPoints(t.map(angle => [Math.cos(angle), Math.sin(angle)]));
  if (shape === 2) return pathFromPoints(Array.from({ length: 100 }, (_, i) => { const x = -1.25 + i / 99 * 2.5; return [x, x * x - 0.8]; }));
  if (shape === 3) return [-1, 1].map(sign => pathFromPoints(Array.from({ length: 100 }, (_, i) => { const x = -1.2 + i / 99 * 2.4; return [x, sign * Math.sqrt(1 + x * x) * 0.65]; }))).join(" ");
  if (shape === 4) return pathFromPoints(Array.from({ length: 240 }, (_, i) => { const angle = i / 239 * Math.PI * 5; const r = i / 239 * 1.2; return [r * Math.cos(angle), r * Math.sin(angle)]; }));
  if (shape === 5) return pathFromPoints(t.map(angle => [Math.sqrt(2) * Math.cos(angle) / (1 + Math.sin(angle) ** 2), Math.sqrt(2) * Math.cos(angle) * Math.sin(angle) / (1 + Math.sin(angle) ** 2)]));
  const implicit = (x: number, y: number) => {
    const r2 = x * x + y * y;
    if (shape === 6) return (r2 - y / 2) ** 2 - r2;
    if (shape === 7) return Math.hypot(x - 1, y) + Math.hypot(x + 1, y) + Math.hypot(x, y - 1) + Math.hypot(x, y + 1) + 11 / 3 * Math.sqrt(r2) - 7;
    if (shape === 8) return x ** 6 + 3 * x ** 4 * y * y + 17 * x + 4 * x * x * y ** 4 - 6 * x * x * y * y + 3 * x * x + y ** 6 - 3 * y ** 4 + 3 * y - x * x * y ** 3;
    return Math.abs(y) < 1 ? x * x + Math.cos((y + Math.sqrt(3)) ** 2) - 1 / Math.PI : 20;
  };
  let path = "";
  const count = 90, step = 3.6 / count;
  for (let row = 0; row < count; row += 1) for (let col = 0; col < count; col += 1) {
    const x = -1.8 + col * step, y = -1.8 + row * step;
    const corners: DrawingPoint[] = [[x, y], [x + step, y], [x + step, y + step], [x, y + step]];
    const values = corners.map(point => implicit(...point)), crosses: DrawingPoint[] = [];
    for (let i = 0; i < 4; i += 1) {
      const j = (i + 1) % 4;
      if ((values[i] < 0) !== (values[j] < 0)) {
        const ratio = Math.abs(values[i]) / (Math.abs(values[i]) + Math.abs(values[j]));
        crosses.push([corners[i][0] + (corners[j][0] - corners[i][0]) * ratio, corners[i][1] + (corners[j][1] - corners[i][1]) * ratio]);
      }
    }
    for (let i = 0; i + 1 < crosses.length; i += 2) path += pathFromPoints(crosses.slice(i, i + 2)) + " ";
  }
  return path;
}

const BOWLING_PINS: readonly DrawingPoint[] = [[0, 0], [-0.18, 0.2], [0.18, 0.2], [-0.36, 0.4], [0, 0.4], [0.36, 0.4], [-0.54, 0.6], [-0.18, 0.6], [0.18, 0.6], [0.54, 0.6]];
export function throwBowlingBall(standing: readonly boolean[], aim: number) {
  if (standing.length !== 10 || !Number.isFinite(aim)) throw new Error("Invalid bowling frame");
  const x = Math.max(-1, Math.min(1, aim)), fallen = new Set<number>();
  for (let i = 0; i < BOWLING_PINS.length; i += 1) {
    if (!standing[i]) continue;
    const [pinX, pinY] = BOWLING_PINS[i], ballX = x * (1 + pinY * 0.1);
    if (Math.abs(pinX - ballX) <= 0.17) fallen.add(i);
    for (const prior of [...fallen]) {
      const [px, py] = BOWLING_PINS[prior];
      if (pinY > py && pinY - py <= 0.21 && Math.abs(pinX - px) <= 0.19 && Math.sign(pinX - px) === Math.sign(px - ballX)) fallen.add(i);
    }
  }
  return { fallen: [...fallen], standing: standing.map((value, i) => value && !fallen.has(i)), points: fallen.size };
}

/** Erasing splits a stroke; it must never draw a new bridge across the gap. */
export function eraseDrawing(strokes:readonly (readonly DrawingPoint[])[],point:DrawingPoint,radius=3):DrawingPoint[][]{
 const out:DrawingPoint[][]=[];
 for(const stroke of strokes){let part:DrawingPoint[]=[];for(const vertex of stroke){if(Math.hypot(vertex[0]-point[0],vertex[1]-point[1])<=radius){if(part.length>1)out.push(part);part=[];}else part.push(vertex);}if(part.length>1)out.push(part);}
 return out;
}
