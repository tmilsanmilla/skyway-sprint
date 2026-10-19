/** Typed command grammar only. SQL endpoints independently enforce every rule. */
export const ADMIN_BALANCE_LIMIT = 1_000_000_000;
export const ADMIN_SCORE_LIMIT = 1_000_000_000_000;
export const ADMIN_BAN_MINUTES_LIMIT = 52_596_000; // Existing 100-year safety ceiling.
export const PROTECTED_STARTER_CHARACTERS = new Set([
  "runner_ace", "medic_patch", "tank_bulwark", "trickster_rogue",
]);
export const PROTECTED_PHOTON_CHARACTERS = new Set([
  "photon_magician", "photon_wizard", "photon_bluff", "photon_bell",
]);
export const ADMIN_SKIN_TIERS = ["intermediate", "pro", "ascendant", "divine", "immortal"] as const;
export type AdminCommand = {
  action: "grant" | "revoke" | "set" | "check" | "ban" | "unban" | "rpta" | "rptb" | "rptc" | "photon_grant" | "photon_revoke";
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
  "/grant cosmetic [", "/grant character [", "/revoke cosmetic [", "/revoke character [",
  "/set gems 100", "/set photons 100", "/set stardust 100", "/set high score 25000",
  "/check gems", "/check photons", "/check stardust", "/rpta", "/rptb", "/rptc",
  "/upfch", "/lpfch", "/upfski", "/lpfski", "/upfth", "/lpfth", "/ban username/email 1440", "/unban username/email",
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
  let match = command.match(/^\/(grant|revoke)\s+(character|cosmetic)\s+\[([^\[\]]+)\](?:\s+(.+))?$/i);
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
    (command.action === "set" && ["photons", "stardust"].includes(command.statKey ?? ""));
}
