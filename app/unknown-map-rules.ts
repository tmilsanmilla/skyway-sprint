import { MAP_IDS, type MapId } from "./arena-map-rules.ts";
import type { DuelMode } from "./update-19-rules.ts";

export const UNKNOWN_MAP_GUIDE = {
  key: "unknown",
  name: "Unknown Map",
  description: "A ranked-only mystery arena. Three map cards are revealed; the fourth stays unknown until the map reveal.",
  rules: [
    "Unknown Map can be banned like any other map card.",
    "If it survives the bans and is selected, both players see the same arena during the 4-second reveal.",
    "The revealed arena keeps its normal lanes, hazards, character restrictions and scoring. Choose your character after the reveal, unless the arena forces Ace.",
  ],
} as const;

/** The server already draws and stores four maps in random order. Cover the
 * same stored slot for both players; never roll a client-local map or submit an
 * unsupported "unknown" ID. This is a presentation reveal, not a secret wire
 * protocol: the existing match payload retains its real candidate IDs. */
export function unknownMapCandidate(mode: DuelMode, candidates: readonly string[]): MapId | null {
  if (mode !== "ranked" || candidates.length !== 4 || new Set(candidates).size !== 4 ||
      !candidates.every(key => (MAP_IDS as readonly string[]).includes(key))) return null;
  return candidates[0] as MapId;
}

export function isUnknownMapReveal(mode: DuelMode, candidates: readonly string[], selectedMap: string) {
  const candidate = unknownMapCandidate(mode, candidates);
  return candidate !== null && candidate === selectedMap;
}
