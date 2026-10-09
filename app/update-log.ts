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
    id: "2026-10-09-simpler-levels",
    publishedAt: "2026-10-09T16:00:18-04:00",
    title: "SIMPLER LEVELS",
    changes: [
      "Your level now shows a broad progress bar without XP numbers or a run-end XP popup. Endless still earns progress as before.",
      "Everyone restarts at level 0. Gems, characters, cosmetics, scores, and paid mode unlocks are kept.",
    ],
  },
  {
    id: "2026-10-08-update-19",
    publishedAt: "2026-10-08T19:59:07-04:00",
    title: "UPDATE 19: DAILY DUELS",
    changes: [
      "Game Modes unlocks at level 5 and rotates daily between RNG and Hardcore Duel. RNG assigns temporary characters; Hardcore Duel is Ace-only with one heart and no healing.",
      "Ban one of four random maps in 10 seconds, see the map reveal, then choose your character by class in 15 seconds. Both ready starts the match early.",
      "Finishing second gives +5% score and +500. Ties go to the second finisher. Ranked rating changes now use your games from the last 28 days.",
      "Melons give more score at higher waves. Music plays 30% faster, with new weapon, impact, vortex, wind and highway sounds.",
      "Removed bot practice and admin Test Mode. Accounts, inventory and past results are kept.",
    ],
  },
  {
    id: "2026-10-08-update-18",
    publishedAt: "2026-10-08T19:19:13-04:00",
    title: "UPDATE 18: EXTRACTION SHOP",
    changes: [
      "Normal Boxes cost 11 Gems for 10 pulls. Rare Boxes unlock at level 10 for 19 Gems; Legendary Boxes unlock at level 20 for 27 Gems.",
      "Each box shows its pull mix and odds. Only Legendary pulls can give Mythics. Duplicates no longer refund Gems.",
      "Direct unlocks are limited to Common, Uncommon, and Rare items, with separate prices for characters and cosmetics.",
      "Hardcore uses Ace with a 2× mode score bonus, or 2.2× including Ace.",
    ],
  },
  {
    id: "2026-10-08-update-17",
    publishedAt: "2026-10-08T19:03:01-04:00",
    title: "UPDATE 17: LEVELS AND PHOTONS",
    changes: [
      "Everyone begins at level 0 with 0 XP. Endless score earns XP; the first level needs 200 XP, then each next level needs 100 more.",
      "Photon Fury unlocks at level 15 for 100 Gems. Ranked unlocks independently at level 25 for 100 Gems.",
      "Impossible is removed. Hardcore uses Ace only.",
      "Photon Fury uses points, not score. Earn at least 4 points for a reward; 7 points earns 10 Photons.",
    ],
  },
  {
    id: "2026-10-06-remove-inventory-flairs",
    publishedAt: "2026-10-06T21:56:58-04:00",
    title: "SIMPLER CHARACTER LOADOUTS",
    changes: [
      "Removed Inventory flairs, their equipment menu, and their extra gameplay bonuses.",
      "Characters keep their abilities and looks. Map weapons and the Photon Lightsaber are unchanged.",
    ],
  },
  {
    id: "2026-10-06-new-progression-and-photons",
    publishedAt: "2026-10-06T20:34:54-04:00",
    title: "A FRESH LEVEL JOURNEY",
    changes: [
      "Everyone starts again at level 0. Endless score earns XP, with 200 XP for the first level and 100 more needed for each next level.",
      "Photon Fury unlocks at level 15 for 100 Gems. Ranked unlocks separately at level 25 for 100 Gems.",
      "Removed Impossible. Hardcore now always uses Ace, with one heart and no healing.",
      "Photon Fury now rewards points only: at least 3 points are needed, and 5 points earn 19 Photons. Removed its score counter.",
    ],
  },
  {
    id: "2026-10-04-photon-look-and-guide",
    publishedAt: "2026-10-04T17:51:41-04:00",
    title: "A MORE FAMILIAR PHOTON FURY",
    changes: [
      "Photon Fury now uses Skyway's familiar pixel characters, obstacles, scenery, and menus, with a small laser accent.",
      "Lightsaber and character ability buttons sit below the course without covering lanes.",
      "Simplified How to Play to explain movement, blocking with the Lightsaber, and earning Photons.",
    ],
  },
  {
    id: "2026-10-04-sign-in-access",
    publishedAt: "2026-10-04T17:26:36-04:00",
    title: "SIGN-IN ACCESS FIX",
    changes: [
      "Fixed a cached-session error that could leave signed-in players stuck on Could Not Verify.",
      "Try Again now rebuilds your sign-in connection instead of repeating the failed access check.",
      "Restored admin tools without changing anyone's admin role, and fixed player lookup after the Neon move.",
    ],
  },
  {
    id: "2026-10-03-photon-strategic",
    publishedAt: "2026-10-03T19:15:52-04:00",
    title: "PHOTON FURY: STRATEGIC",
    changes: [
      "Added Bluff: 5 HP and softer spikes, with a delayed, shorter Lightsaber guard.",
      "Added Magnet: collect Warpstones for 3 points and a random teleport—but touching one while guarding ends your run.",
      "Added Bear: alternate normal play with announced Chaos stages that bring faster hazards, double damage, triple reflection points, and a half-heart heal afterward.",
      "Added Wrench: turn a hazard in your lane into a barrel with E, and use a longer Lightsaber guard with a chance to earn a bonus point.",
    ],
  },
  {
    id: "2026-10-03-photon-rush",
    publishedAt: "2026-10-03T18:42:49-04:00",
    title: "PHOTON FURY: RUSH",
    changes: [
      "Added Wizard: wrap between the outside lanes with no cooldown, and missed Lightsaber swings cost no HP.",
      "Added Burner: 30% faster obstacles and double reflection points, with a shorter guard, a 2-second Lightsaber cooldown, and a 0.05-second delay on each turn.",
      "Photon Fury now shows reflection points separately from your saved Photons.",
    ],
  },
  {
    id: "2026-10-03-photon-characters",
    publishedAt: "2026-10-03T18:40:04-04:00",
    title: "PHOTON FURY CHARACTERS",
    changes: [
      "Unlocking Photon Fury includes Magician, Tick, Trumpet, and Saxophone in its separate inventory.",
      "Magician earns a bonus point every 40 active seconds. Tick has a longer guard, while Trumpet starts with 5 HP and 12 Lightsaber durability.",
      "Saxophone can heal half a heart with E every 25 seconds while its Lightsaber is intact.",
      "The standard Lightsaber cooldown is now 1.5 seconds. Each character shows its own guard time, cooldown, health, and durability.",
    ],
  },
  {
    id: "2026-10-03-photon-fury",
    publishedAt: "2026-10-03T15:56:00-04:00",
    title: "PHOTON FURY + MATCH SETUP",
    changes: [
      "Photon Fury brings a four-lane Laserdrome, a one-block Lightsaber, stacking Needles, and permanent Photons. Unlock it at level 15 for 100 Gems.",
      "Pick an owned, map-legal character during the ten seconds before each 1v1 or practice match.",
      "Weapon cooldowns show tenths of a second. Katana swings block one hazard; turn delays add and score bonuses multiply.",
      "Ranked ratings reset to a fresh 1500 baseline and prior access is locked. Added an RNG tab for the upcoming mode.",
    ],
  },
  {
    id: "2026-10-03-meadow-terminal",
    publishedAt: "2026-10-03T14:51:00-04:00",
    title: "MEADOW + TERMINAL",
    changes: [
      "Added Meadow: six lanes, a risky score-bonus lane, and Vortex pulls. Frozen turns take 0.4 seconds here.",
      "Added Terminal: rivals share a metro course as Ace with 4 HP, a limited-durability Sword, and one edge wrap per wave.",
      "Q activates map weapons. Grove now has five lanes.",
      "Fixed sign-in refresh and password-reset screens.",
    ],
  },
  {
    id: "2026-09-29-account-recovery",
    publishedAt: "2026-09-29T22:23:00-04:00",
    title: "EASIER ACCOUNT RECOVERY",
    changes: [
      "Forgot Password now completes through the new account system and clearly reports delivery problems.",
      "Added Continue with Google as a free recovery option when an email is delayed or missing. Using the same email keeps existing stats and inventory.",
    ],
  },
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
