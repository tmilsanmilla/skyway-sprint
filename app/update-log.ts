export interface UpdateLogEntry {
  readonly id: string;
  readonly publishedAt: string;
  readonly title: string;
  readonly changes: readonly string[];
}

/**
 * Player-facing release history, newest first.
 *
 * Add one entry whenever a player-visible update ships. Keep the wording about
 * what players will notice rather than database, deployment, or code details.
 */
export const UPDATE_LOG: readonly UpdateLogEntry[] = [
  {
    id: "2026-09-25-character-copy",
    publishedAt: "2026-09-25T20:21:57-04:00",
    title: "CLEARER CHARACTER GUIDE",
    changes: [
      "Character abilities now show their exact rules immediately in short, readable points.",
      "Scribe is now Epic. Its description clearly explains the hazard choice and next-wave spawn cap.",
      "Added this Update Log and simplified repetitive Gem and 1v1 wording.",
    ],
  },
  {
    id: "2026-09-21-account-upgrade",
    publishedAt: "2026-09-21T15:42:49-04:00",
    title: "ACCOUNT SYSTEM UPGRADE",
    changes: [
      "Prepared a safer account system while keeping player IDs, stats, inventory, reports, and match history intact.",
      "Existing players can use Forgot Password once when the new sign-in system goes live.",
    ],
  },
  {
    id: "2026-09-12-shop-refunds",
    publishedAt: "2026-09-12T21:16:35-04:00",
    title: "FAIRER DUPLICATE REFUNDS",
    changes: [
      "Duplicate pulls now refund the correct share of their box price, with whole Gems rounded up.",
    ],
  },
  {
    id: "2026-09-10-advanced-kits",
    publishedAt: "2026-09-10T21:47:44-04:00",
    title: "CHARACTERS, MAP VOTES + 1V1",
    changes: [
      "Fixed advanced character abilities, added clearer live ability panels, and improved mobile Gem streak controls.",
      "Players now vote for two 1v1 maps. Rival attacks trickle through the next wave instead of arriving all at once.",
      "Admin Test Mode can safely preview every character without ranked results or permanent rewards.",
    ],
  },
  {
    id: "2026-09-08-balance-pass",
    publishedAt: "2026-09-08T23:36:54-04:00",
    title: "GAMEPLAY + CHARACTER FIXES",
    changes: [
      "Balanced character abilities and repaired reported Medic, Trickster, practice-bot, pickup, and obstacle problems.",
      "Attack Coins now sync during the 1v1 intermission, and overlapping hazards are blocked more reliably.",
      "XP, Gem streaks, health displays, and arena labels now use the intended values.",
    ],
  },
  {
    id: "2026-09-07-arenas",
    publishedAt: "2026-09-07T23:14:43-04:00",
    title: "ARENA MAPS + COMPLETE KITS",
    changes: [
      "Added multiple 1v1 Arena maps with their own lane counts and rules.",
      "Completed Runner and Healer abilities, added map guides, and made default looks equipable again.",
      "Endless gained Melons while Attack Coins stayed exclusive to 1v1.",
    ],
  },
  {
    id: "2026-09-05-ranked-progression",
    publishedAt: "2026-09-05T20:17:41-04:00",
    title: "LEVELS + RANKED PROGRESSION",
    changes: [
      "Added account levels, XP, Ranked 1v1 progression, and stronger character ownership checks.",
      "Admin player tools and account security were expanded.",
    ],
  },
  {
    id: "2026-09-04-roster-rework",
    publishedAt: "2026-09-04T13:35:42-04:00",
    title: "ROSTER ROLES + WEAPONS",
    changes: [
      "Reorganized characters into Runner, Healer, Tank, Trickster, and Misc based on what their abilities do.",
      "Character weapons gained real gameplay bonuses instead of being visual-only items.",
    ],
  },
  {
    id: "2026-09-03-more-characters",
    publishedAt: "2026-09-03T20:11:51-04:00",
    title: "BIGGER ROSTER + SAFER WAVES",
    changes: [
      "Expanded and rebalanced the character roster with new extractable kits and unique pixel looks.",
      "Improved box results, reports, sound effects, and obstacle generation so waves keep an escape route.",
    ],
  },
  {
    id: "2026-09-02-inventory",
    publishedAt: "2026-09-02T20:12:01-04:00",
    title: "INVENTORY, PRACTICE + BOXES",
    changes: [
      "Added an expandable Inventory, bot practice, batch box opening, and a reveal animation.",
      "Every character received a unique look, clearer rules, and balance changes.",
      "1v1 intermissions were shortened to 10 seconds and separated from Endless difficulty settings.",
    ],
  },
  {
    id: "2026-09-01-multiplayer",
    publishedAt: "2026-09-01T23:47:04-04:00",
    title: "1V1, CLASSES + PIXEL STYLE",
    changes: [
      "Added realtime 1v1, character classes, collectible cosmetics, rarity boxes, and character abilities.",
      "Added Hardcore and Impossible, smarter hit feedback, new obstacle behavior, and telegraphed spikes.",
      "Added soundtracks, pause audio controls, an Inventory, leaderboards, and admin roles.",
    ],
  },
  {
    id: "2026-08-31-launch",
    publishedAt: "2026-08-31T22:24:29-04:00",
    title: "SKYWAY SPRINT LAUNCH",
    changes: [
      "Launched the five-lane runner with waves, obstacles, Gems, Guest play, accounts, high scores, and player reports.",
      "Added usernames, password recovery, account settings, and saved player progress.",
    ],
  },
] as const;

export const validateUpdateLog = (
  entries: readonly UpdateLogEntry[] = UPDATE_LOG,
): readonly string[] => {
  const errors: string[] = [];
  const ids = new Set<string>();
  let previousTime = Number.POSITIVE_INFINITY;

  entries.forEach((entry, index) => {
    const timestamp = Date.parse(entry.publishedAt);
    if (!entry.id.trim() || ids.has(entry.id))
      errors.push(`Entry ${index + 1} has a missing or duplicate id.`);
    ids.add(entry.id);
    if (!Number.isFinite(timestamp))
      errors.push(`${entry.id || `Entry ${index + 1}`} has an invalid date.`);
    if (timestamp > previousTime)
      errors.push(`${entry.id} is out of newest-first order.`);
    previousTime = timestamp;
    if (!entry.title.trim() || entry.changes.length === 0)
      errors.push(`${entry.id} is missing player-facing copy.`);
    if (entry.changes.some((change) => !change.trim()))
      errors.push(`${entry.id} contains an empty change.`);
  });

  return errors;
};
