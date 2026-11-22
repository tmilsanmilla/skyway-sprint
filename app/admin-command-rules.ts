/** Typed command grammar only. SQL endpoints independently enforce every rule. */
import { MASTERIES } from "./mastery-rules.ts";
export const ADMIN_BALANCE_LIMIT = 1_000_000_000;
export const ADMIN_SCORE_LIMIT = 1_000_000_000_000;
export const ADMIN_BAN_MINUTES_LIMIT = 52_596_000; // Existing 100-year safety ceiling.
export const PROTECTED_STARTER_CHARACTERS = new Set([
  "runner_ace", "medic_patch", "tank_bulwark", "trickster_rogue", "chaotic_particle",
]);
export const PROTECTED_PHOTON_CHARACTERS = new Set([
  "photon_magician", "photon_wizard", "photon_bluff", "photon_bell",
]);
export const ADMIN_SKIN_TIERS = ["intermediate", "pro", "ascendant", "divine", "immortal"] as const;
export type AdminCommand = {
  action: "grant" | "revoke" | "set" | "check" | "ban" | "unban" | "rpta" | "rptb" | "rptc" | "photon_grant" | "photon_revoke" | "appeal_accept_all" | "appeal_reject_all" | "appeal_count" | "ranked_owned" | "ranked_elo" | "ranked_games" | "mastery_reset";
  targetText?: string;
  itemKind?: string;
  itemName?: string;
  characterName?: string;
  statKey?: string;
  value?: number;
  banScopes?: string[];
  durationSeconds?: number;
  permanent?: boolean;
};

export const BASE_ADMIN_COMMANDS = [
  "/grant cosmetic [", "/grant character [", "/grant mastery [", "/revoke cosmetic [", "/revoke character [", "/revoke mastery [",
  "/set gems 100", "/set photons 100", "/set stardust 100", "/set high score 25000",
  "/check gems", "/check photons", "/check stardust", "/rpta", "/rptb", "/rptc",
  "/upfch", "/lpfch", "/upfski", "/lpfski", "/upfth", "/lpfth", "/ban username/email 1440", "/unban username/email",
  "/rejapp", "/accapp", "/numapp", "/ownsr", "/elo", "/numrg", "/upfw", "/rpfw", "/resetmastery",
];

function wholeNumber(raw: string, limit: number, label: string) {
  if (!/^\d+$/.test(raw)) throw new Error(`${label} must be a non-negative whole number.`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value > limit) throw new Error(`${label} exceeds the safety limit (${limit}).`);
  return value;
}

function target(raw?: string) {
  if (!raw?.trim()) return undefined;
  const cleaned = raw.replace(/^(?:from|to)\s+/i, "").trim();
  if (cleaned.startsWith("[") && cleaned.endsWith("]")) return cleaned.slice(1, -1).trim();
  if (/[\[\]]/.test(cleaned)) throw new Error("Close the brackets around the exact account or item name.");
  return cleaned;
}

function argumentsFor(raw: string): string[] {
  const tokens = Array.from(raw.matchAll(/\[([^\[\]]+)\]|([^\s\[\]]+)/g));
  if (tokens.map((m) => m[0]).join(" ").replace(/\s+/g, " ") !== raw.trim().replace(/\s+/g, " "))
    throw new Error("Use [brackets] around names containing spaces; do not nest brackets.");
  return tokens.map((m) => (m[1] ?? m[2]).trim());
}

export function parseAdminCommand(raw: string, hasSelectedPlayer = false): AdminCommand {
  const command = raw.trim();
  if (!command || command.length > 1000) throw new Error("Enter a command of at most 1000 characters.");
  if (/^\/bann\b/i.test(command)) throw new Error("Use /ban username/email minutes. Use 0 minutes for a permanent ban.");
  if (/^\/(?:set|check|grant|revoke)\b.*\b(?:coins?|obstacle[_ ]*points?|versus[_ ]*points?|melons?)\b/i.test(command))
    throw new Error("Coin balances are gameplay-only and cannot be changed by admin commands.");
  const global = command.match(/^\/(rejapp|accapp|numapp)$/i);
  if (global) return { action: ({ rejapp: "appeal_reject_all", accapp: "appeal_accept_all", numapp: "appeal_count" } as const)[global[1].toLowerCase() as "rejapp" | "accapp" | "numapp"] };
  const ranked = command.match(/^\/(ownsr|elo|numrg)(?:\s+(.+))?$/i);
  if (ranked) {
    const args = ranked[2] ? argumentsFor(ranked[2]) : [];
    if (args.length !== 1 && !(args.length === 0 && hasSelectedPlayer))
      throw new Error(`Use /${ranked[1].toLowerCase()} [exact username].`);
    return { action: ({ ownsr: "ranked_owned", elo: "ranked_elo", numrg: "ranked_games" } as const)[ranked[1].toLowerCase() as "ownsr" | "elo" | "numrg"], targetText: args[0] };
  }
  const newItem = command.match(/^\/(upfw|rpfw|resetmastery)\s+(.+)$/i);
  if (newItem) {
    const op = newItem[1].toLowerCase(), args = argumentsFor(newItem[2]);
    const targetText = args.length === 2 ? args.shift() : undefined;
    if (args.length !== 1 || (!targetText && !hasSelectedPlayer))
      throw new Error(`Use /${op} [exact username] [${op === "resetmastery" ? "mastery character" : "weapon"}].`);
    if (op !== "resetmastery" && args[0].toLowerCase().replace(/[ _-]/g, "") === "lightsaber")
      throw new Error("Lightsaber is included and cannot be granted or revoked.");
    return { action: op === "resetmastery" ? "mastery_reset" : op === "upfw" ? "photon_grant" : "photon_revoke", itemKind: op === "resetmastery" ? "mastery" : "photon_weapon", itemName: args[0], targetText };
  }
  let match = command.match(/^\/(grant|revoke)\s+(character|cosmetic|mastery)\s+\[([^\[\]]+)\](?:\s+(.+))?$/i);
  if (match) return { action: match[1].toLowerCase() as "grant" | "revoke", itemKind: match[2].toLowerCase(), itemName: match[3].trim(), targetText: target(match[4]) };
  match = command.match(/^\/set\s+(high[_ ]score|gems|photons|stardust)\s+(\S+)(?:\s+(.+))?$/i);
  if (match) {
    const statKey = match[1].toLowerCase().replace(" ", "_");
    return { action: "set", statKey, value: wholeNumber(match[2], statKey === "high_score" ? ADMIN_SCORE_LIMIT : ADMIN_BALANCE_LIMIT, "Balance"), targetText: target(match[3]) };
  }
  match = command.match(/^\/check\s+(gems|photons|stardust)(?:\s+(.+))?$/i);
  if (match) return { action: "check", statKey: match[1].toLowerCase(), targetText: target(match[2]) };
  match = command.match(/^\/(rpta|rptb)(?:\s+(.+))?$/i);
  if (match) return { action: match[1].toLowerCase() as "rpta" | "rptb", targetText: target(match[2]) };
  if (/^\/rptc$/i.test(command)) return { action: "rptc" };
  match = command.match(/^\/ban\s+(?:(.+)\s+)?(\d+)$/i);
  if (match) {
    const minutes = wholeNumber(match[2], ADMIN_BAN_MINUTES_LIMIT, "Ban minutes");
    return { action: "ban", targetText: target(match[1]), banScopes: ["account"], durationSeconds: minutes ? minutes * 60 : undefined, permanent: minutes === 0 };
  }
  match = command.match(/^\/unban\s+(.+)$/i);
  if (match) return { action: "unban", targetText: target(match[1]) };
  match = command.match(/^\/(upfch|lpfch|upfski|lpfski|upfth|lpfth)\s+(.+)$/i);
  if (match) {
    const op = match[1].toLowerCase();
    const args = argumentsFor(match[2]);
    const itemCount = op.endsWith("ski") ? 2 : 1;
    let targetText: string | undefined;
    if (args.length === itemCount + 1) targetText = args.shift();
    else if (args.length !== itemCount || !hasSelectedPlayer)
      throw new Error(`Use /${op} [username/email] ${op.endsWith("ski") ? "[character] [skin tier]" : "[exact item name]"}.`);
    if (op.endsWith("ski") && !ADMIN_SKIN_TIERS.includes(args[1].toLowerCase() as (typeof ADMIN_SKIN_TIERS)[number]))
      throw new Error(`Skin tier must be ${ADMIN_SKIN_TIERS.join(", ")}.`);
    return {
      action: op.startsWith("u") ? "photon_grant" : "photon_revoke", targetText,
      itemKind: op.endsWith("ch") ? "photon_character" : op.endsWith("ski") ? "photon_skin" : "photon_theme",
      itemName: op.endsWith("ski") ? args[1].toLowerCase() : args[0],
      characterName: op.endsWith("ski") ? args[0] : undefined,
    };
  }
  throw new Error("Unknown command. Choose a suggestion. Ban example: /ban username/email 1440.");
}

export function isV23AdminCommand(command: AdminCommand) {
  return ["check", "rpta", "rptb", "rptc", "photon_grant", "photon_revoke"].includes(command.action) ||
    (["grant", "revoke"].includes(command.action) && command.itemKind === "mastery") ||
    (command.action === "set" && ["photons", "stardust"].includes(command.statKey ?? ""));
}

export function isOverhaulAdminCommand(command: AdminCommand) {
  return command.action.startsWith("appeal_") || command.action.startsWith("ranked_") ||
    command.action === "mastery_reset" || command.itemKind === "photon_weapon";
}

export const formatRankedAdminValue = (owned: boolean, games: number, rating: number | null) =>
  !owned || games < 5 || rating === null ? null : `${Math.round(rating)}${games <= 20 ? "P" : ""}`;

/** Resolve only an exact supported mastery, never a partial character match. */
export function resolveAdminMastery(raw: string) {
  const name = raw.trim().toLowerCase();
  const definition = MASTERIES.find((entry) => entry.name.toLowerCase() === name || entry.key === name);
  if (!definition) throw new Error("Choose an exact mastery from the suggestions.");
  return definition;
}

export function adminMasterySuggestions(action: "grant" | "revoke", fragment: string, selectedPlayer: boolean) {
  const query = fragment.trim().toLowerCase();
  return MASTERIES.filter((entry) => entry.name.toLowerCase().includes(query) || entry.key.includes(query))
    .map((entry) => `/${action} mastery [${entry.name}]${selectedPlayer ? "" : action === "revoke" ? " from " : " "}`);
}
