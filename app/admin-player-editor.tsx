"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { SkywayRpcClient } from "./skyway-client";
import { BASE_ADMIN_COMMANDS, PROTECTED_STARTER_CHARACTERS, ADMIN_SKIN_TIERS, parseAdminCommand, isV23AdminCommand, resolveAdminMastery, adminMasterySuggestions } from "./admin-command-rules";
import { PHOTON_CHARACTERS } from "./photon-fury-rules";
import { PHOTON_THEMES } from "./photon-collection-rules";
import { MASTERIES } from "./mastery-rules";

type PlayerSummary = {
  user_id: string;
  username: string | null;
  email: string;
  created_at: string;
  last_sign_in_at: string | null;
  account_banned: boolean;
  leaderboard_banned: boolean;
};

type CatalogItem = {
  item_key: string;
  display_name: string;
  command_kind: string;
  item_type: string;
  rarity: string;
  character_class: string | null;
  owned?: boolean;
};

type CommandSuggestions = {
  commands?: string[];
  item_kinds?: string[];
  stats?: string[];
  ban_scopes?: string[];
  duration_units?: string[];
  selected_user_id?: string | null;
  items?: CatalogItem[];
  players?: Array<Pick<PlayerSummary, "user_id" | "username" | "email">>;
};

type PlayerDetail = {
  account?: Record<string, unknown>;
  profile?: Record<string, unknown> | null;
  stats?: Record<string, unknown> | null;
  loadout?: Record<string, unknown> | null;
  unlocks?: Array<Record<string, unknown>>;
  masteries?: Array<Record<string, unknown>>;
  devices?: Array<Record<string, unknown>>;
  bans?: Array<Record<string, unknown>>;
  reports?: Array<Record<string, unknown>>;
  multiplayer?: Record<string, unknown> | null;
  record?: {
    bans?: Array<Record<string, unknown>>;
    commands?: Array<Record<string, unknown>>;
  };
};

type CommandContext = {
  action?: "grant" | "revoke";
  kind?: string;
  stage: "command" | "item" | "target";
  fragment: string;
};
type CommandFeedback = {
  tone: "error" | "success";
  message: string;
};

const BASE_COMMANDS = BASE_ADMIN_COMMANDS;
const PLAYER_LOOKUP_IDLE_MS = 5 * 60 * 1000;
const PLAYER_INVENTORY_GROUPS = [
  {
    key: "obstacle",
    label: "OBSTACLES",
    description: "Owned hazard appearances.",
  },
  {
    key: "environment",
    label: "ENVIRONMENTS",
    description: "Owned maps and track appearances.",
  },
  {
    key: "player",
    label: "PLAYER LOOKS",
    description: "Cosmetics usable across owned characters.",
  },
  {
    key: "runner",
    label: "RUNNER",
    description: "Movement or score.",
  },
  {
    key: "medic",
    label: "HEALER",
    description: "Special healing or HP.",
  },
  {
    key: "tank",
    label: "TANK",
    description: "Less damage or more health, but not healing.",
  },
  {
    key: "trickster",
    label: "TRICKSTER",
    description: "Special actions trigger invincibility or other rewards.",
  },
  {
    key: "misc",
    label: "MISC",
    description: "Everything else.",
  },
  {
    key: "other",
    label: "OTHER",
    description: "Older or unclassified owned items.",
  },
] as const;
type PlayerInventoryGroupKey = (typeof PLAYER_INVENTORY_GROUPS)[number]["key"];
const CHARACTER_CLASS_KEYS = new Set([
  "runner",
  "medic",
  "tank",
  "trickster",
  "misc",
]);
const RARITY_SORT_ORDER: Record<string, number> = {
  common: 0,
  uncommon: 1,
  rare: 2,
  epic: 3,
  legendary: 4,
  mythic: 5,
};

const getPlayerInventoryGroup = (
  item: Record<string, unknown>,
): PlayerInventoryGroupKey => {
  const itemType = String(item.item_type ?? "").toLowerCase();
  if (itemType === "obstacle") return "obstacle";
  if (itemType === "environment") return "environment";
  if (itemType === "player") return "player";
  if (itemType === "character") {
    const catalogClass = String(item.character_class ?? "").toLowerCase();
    if (CHARACTER_CLASS_KEYS.has(catalogClass))
      return catalogClass as PlayerInventoryGroupKey;
    if (String(item.item_key ?? "").toLowerCase() === "runner_scout")
      return "misc";
    const keyPrefix = String(item.item_key ?? "").toLowerCase().split("_")[0];
    if (CHARACTER_CLASS_KEYS.has(keyPrefix))
      return keyPrefix as PlayerInventoryGroupKey;
  }
  if (itemType === "class") {
    const legacyClass = String(item.item_key ?? "").toLowerCase();
    if (CHARACTER_CLASS_KEYS.has(legacyClass))
      return legacyClass as PlayerInventoryGroupKey;
  }
  return "other";
};

const humanize = (value: unknown) =>
  String(value ?? "—")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const parseJsonValue = (value: unknown): unknown => {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
};

const unwrapRpcRecord = (
  value: unknown,
  expectedKeys: string[],
  rpcKey: string,
): Record<string, unknown> | null => {
  let current = parseJsonValue(value);
  for (let depth = 0; depth < 5; depth += 1) {
    if (Array.isArray(current)) {
      if (current.length !== 1) return null;
      current = parseJsonValue(current[0]);
      continue;
    }
    if (!isRecord(current)) return null;
    const record = current;
    if (expectedKeys.some((key) => key in record)) return record;
    const wrappedKey = [rpcKey, "result", "data", "payload"].find(
      (key) => key in record,
    );
    if (!wrappedKey) return null;
    current = parseJsonValue(record[wrappedKey]);
  }
  return null;
};

const asRecord = (value: unknown): Record<string, unknown> | null => {
  const parsed = parseJsonValue(value);
  return isRecord(parsed) ? parsed : null;
};

const asRecordArray = (value: unknown): Array<Record<string, unknown>> | null => {
  const parsed = parseJsonValue(value);
  if (!Array.isArray(parsed)) return null;
  const rows = parsed.filter(isRecord);
  return rows.length === parsed.length ? rows : null;
};

const normalizePlayerDetail = (value: unknown): PlayerDetail => {
  const raw = unwrapRpcRecord(
    value,
    ["account", "profile", "unlocks", "devices"],
    "admin_get_player",
  );
  if (!raw)
    throw new Error(
      "Player details returned in an unsupported format. Update the Admin 03 database setup.",
    );

  const account = asRecord(raw.account ?? raw.account_info ?? raw.user);
  const profile = asRecord(raw.profile ?? raw.player_profile) ?? {};
  const unlocks = asRecordArray(raw.unlocks ?? raw.inventory ?? raw.items);
  const devices = asRecordArray(raw.devices ?? raw.linked_devices);
  if (!account || !unlocks || !devices)
    throw new Error(
      "Player details are incomplete. Update the Admin 03 database setup and try again.",
    );

  return {
    account,
    profile,
    stats: asRecord(raw.stats),
    loadout: asRecord(raw.loadout),
    unlocks,
    masteries: asRecordArray(raw.masteries) ?? [],
    devices,
    bans: asRecordArray(raw.bans) ?? [],
    reports: asRecordArray(raw.reports) ?? [],
    multiplayer: asRecord(raw.multiplayer),
  };
};

/** Admin lookup is read-only here; action buttons only prepare an audited command. */
export function AdminMasteryInventory({
  masteries, ownedCharacters, isMainAdmin, busy, onCommand,
}: {
  masteries: Array<Record<string, unknown>>;
  ownedCharacters: string[];
  isMainAdmin: boolean;
  busy: boolean;
  onCommand: (command: string) => void;
}) {
  const owned = new Set(ownedCharacters);
  const unlocked = masteries.filter((row) => row.mastered === true).length;
  return <details className="player-inventory-group group-masteries">
    <summary>
      <span>M</span>
      <span><strong>MASTERIES</strong><small>Quest progress and unlocked character masteries.</small></span>
      <em>{unlocked}/{MASTERIES.length}</em>
    </summary>
    <div className="player-inventory-list">
      {MASTERIES.map((definition) => {
        const row = masteries.find((entry) => entry.character_key === definition.key);
        const hasCharacter = owned.has(definition.key);
        const quest = Math.min(3, Math.max(0, Number(row?.quest) || 0));
        const progress = Array.isArray(row?.progress) ? row.progress : [];
        const mastered = row?.mastered === true;
        return <article key={definition.key}>
          <header><strong>{definition.name}</strong><span>{mastered ? "MASTERED" : row?.complete === true ? "TRIAL READY" : row ? `QUEST ${quest + 1}/3` : "NOT STARTED"}</span></header>
          {row && !row.complete && quest < 3 && <p>{definition.quests[quest]} · {definition.targets[quest].map((target, index) => `${Math.min(target, Math.max(0, Number(progress[index]) || 0))}/${target}`).join(" · ")}</p>}
          {mastered && <p>Mastery {row?.masteryEnabled === true ? "ON" : "OFF"} · Flair rewrite {row?.flairRewriteEnabled === true ? "ON" : "OFF"}</p>}
          {!hasCharacter && <p>Unlock this character before granting its mastery.</p>}
          {isMainAdmin && <div>
            <button type="button" aria-label={`Prepare grant ${definition.name} mastery command`} disabled={busy || !hasCharacter || mastered} onClick={() => onCommand(`/grant mastery [${definition.name}]`)}>GRANT MASTERY</button>
            <button type="button" aria-label={`Prepare revoke ${definition.name} mastery command`} disabled={busy || !mastered} onClick={() => onCommand(`/revoke mastery [${definition.name}]`)}>REVOKE MASTERY</button>
          </div>}
        </article>;
      })}
    </div>
  </details>;
}

const normalizePlayerRecord = (
  value: unknown,
): NonNullable<PlayerDetail["record"]> => {
  const raw = unwrapRpcRecord(
    value,
    ["bans", "commands"],
    "admin_get_player_record",
  );
  const bans = raw ? asRecordArray(raw.bans) : null;
  const commands = raw ? asRecordArray(raw.commands) : null;
  if (!raw || !bans || !commands)
    throw new Error(
      "Moderation history returned in an unsupported format. Update the Admin 03 database setup.",
    );
  return { bans, commands };
};

const formatDate = (value: unknown) => {
  if (!value) return "—";
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
};

const normalize = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const getCommandContext = (raw: string): CommandContext => {
  const actionMatch = raw.match(/^\/(grant|revoke)\b/i);
  if (!actionMatch) return { stage: "command", fragment: raw.trim() };
  const action = actionMatch[1].toLowerCase() as "grant" | "revoke";
  const kind = raw.match(/^\/(?:grant|revoke)\s+(\w+)/i)?.[1]?.toLowerCase();
  const target = raw.match(/\]\s+(?:(?:from|to)\s*)?(.*)$/i);
  if (target)
    return { action, kind, stage: "target", fragment: target[1].trim() };
  const openItem = raw.match(/\[([^\]]*)$/);
  if (openItem)
    return { action, kind, stage: "item", fragment: openItem[1].trim() };
  const closedItem = raw.match(/\[([^\]]+)\]\s*$/);
  return {
    action,
    kind,
    stage: "item",
    fragment: closedItem?.[1]?.trim() ?? "",
  };
};

const getPlayerSuggestionFragment = (raw: string) => {
  const target = raw.match(/^\/(?:unban|rpta|rptb)(?:\s+(.*))?$/i)
    ?? raw.match(/^\/check\s+(?:gems|photons|stardust)(?:\s+(.*))?$/i)
    ?? raw.match(/^\/set\s+(?:high[_ ]score|gems|photons|stardust)\s+\d+(?:\s+(.*))?$/i);
  return target ? target[1]?.replace(/^(?:from|to)\s+/i, "").replace(/^\[|\]$/g, "").trim() ?? "" : null;
};


const formatActor = (
  row: Record<string, unknown>,
  prefix: "actor" | "created_by" | "revoked_by",
) => {
  const username = String(row[`${prefix}_username`] ?? "").trim();
  const email = String(row[`${prefix}_email`] ?? "").trim();
  const userId = String(row[`${prefix}_user_id`] ?? "").trim();
  const role = String(row[`${prefix}_role`] ?? "").trim();
  const identity = username
    ? `${username}${email ? ` (${email})` : ""}`
    : email || userId || "Unknown admin";
  return role ? `${identity} · ${humanize(role)}` : identity;
};

export function AdminPlayerEditor({
  supabase,
  isMainAdmin,
  isActive,
}: {
  supabase: SkywayRpcClient;
  isMainAdmin: boolean;
  isActive: boolean;
}) {
  const [search, setSearch] = useState("");
  const [searching, setSearching] = useState(false);
  const [players, setPlayers] = useState<PlayerSummary[]>([]);
  const [selected, setSelected] = useState<PlayerSummary | null>(null);
  const [detail, setDetail] = useState<PlayerDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [recordError, setRecordError] = useState("");
  const [command, setCommand] = useState("");
  const [banNote, setBanNote] = useState("");
  const [commandBusy, setCommandBusy] = useState(false);
  const [commandFeedback, setCommandFeedback] =
    useState<CommandFeedback | null>(null);
  const [status, setStatus] = useState("");
  const [catalog, setCatalog] = useState<CommandSuggestions>({});
  const [selectedDeviceId, setSelectedDeviceId] = useState("");
  const commandInputRef = useRef<HTMLInputElement | null>(null);
  const detailRequestRef = useRef(0);
  const searchRequestRef = useRef(0);
  const lookupGenerationRef = useRef(0);
  const inactiveSinceRef = useRef<number | null>(null);
  const inactivityTimerRef = useRef<number | null>(null);

  useLayoutEffect(() => () => {
    // The parent keys this editor by the signed-in user's immutable ID. Retire
    // pending work synchronously when that account's editor leaves the tree,
    // before an old lookup can dispatch a command through a newer session.
    ++lookupGenerationRef.current;
    ++searchRequestRef.current;
    ++detailRequestRef.current;
    if (inactivityTimerRef.current !== null)
      window.clearTimeout(inactivityTimerRef.current);
    inactivityTimerRef.current = null;
    inactiveSinceRef.current = null;
  }, []);

  const clearLookup = useCallback(() => {
    ++searchRequestRef.current;
    ++detailRequestRef.current;
    ++lookupGenerationRef.current;
    if (inactivityTimerRef.current !== null)
      window.clearTimeout(inactivityTimerRef.current);
    inactivityTimerRef.current = null;
    inactiveSinceRef.current = null;
    setSearch("");
    setSearching(false);
    setPlayers([]);
    setSelected(null);
    setDetail(null);
    setLoadingDetail(false);
    setDetailError("");
    setRecordError("");
    setCommand("");
    setBanNote("");
    setCommandBusy(false);
    setCommandFeedback(null);
    setCatalog({});
    setSelectedDeviceId("");
    setStatus("Player lookup cleared after 5 minutes away.");
  }, []);

  const hasLookupState = Boolean(
    search ||
      players.length ||
      selected ||
      detail ||
      command ||
      commandFeedback ||
      selectedDeviceId,
  );

  useEffect(() => {
    const cancelTimer = () => {
      if (inactivityTimerRef.current !== null)
        window.clearTimeout(inactivityTimerRef.current);
      inactivityTimerRef.current = null;
    };
    cancelTimer();

    if (isActive) {
      const inactiveSince = inactiveSinceRef.current;
      inactiveSinceRef.current = null;
      if (
        inactiveSince !== null &&
        Date.now() - inactiveSince >= PLAYER_LOOKUP_IDLE_MS &&
        hasLookupState
      )
        clearLookup();
      return;
    }

    if (!hasLookupState) {
      inactiveSinceRef.current = null;
      return;
    }

    inactiveSinceRef.current ??= Date.now();
    const remaining =
      PLAYER_LOOKUP_IDLE_MS - (Date.now() - inactiveSinceRef.current);
    if (remaining <= 0) {
      clearLookup();
      return;
    }
    inactivityTimerRef.current = window.setTimeout(clearLookup, remaining);
    return cancelTimer;
  }, [clearLookup, hasLookupState, isActive]);

  const runSearch = async (event?: FormEvent) => {
    event?.preventDefault();
    // Keep an in-flight command bound to the selected target shown at submit.
    if (commandBusy) return;
    const requestId = ++searchRequestRef.current;
    ++detailRequestRef.current;
    setSearching(true);
    setStatus("");
    setPlayers([]);
    setSelected(null);
    setDetail(null);
    setDetailError("");
    setRecordError("");
    setSelectedDeviceId("");
    setCommand("");
    setBanNote("");
    setCommandFeedback(null);
    setLoadingDetail(false);
    const { data, error } = await supabase.rpc("admin_player_search", {
      p_query: search.trim(),
      p_limit: 20,
    });
    if (requestId !== searchRequestRef.current) return;
    setSearching(false);
    if (error) {
      setStatus(error.message);
      return;
    }
    const found = (data ?? []) as PlayerSummary[];
    setPlayers(found);
    if (found.length === 0) setStatus("No players found.");
    else if (found.length === 1) void choosePlayer(found[0]);
  };

  const choosePlayer = async (player: PlayerSummary) => {
    const requestId = ++detailRequestRef.current;
    setSelected(player);
    setDetail(null);
    setDetailError("");
    setRecordError("");
    setSelectedDeviceId("");
    setCommand("");
    setBanNote("");
    setCommandFeedback(null);
    setLoadingDetail(true);
    setStatus("");
    const [playerResult, recordResult] = await Promise.all([
      supabase.rpc("admin_get_player", { p_user_id: player.user_id }),
      supabase.rpc("admin_get_player_record", { p_user_id: player.user_id }),
    ]);
    if (requestId !== detailRequestRef.current) return;
    setLoadingDetail(false);
    if (playerResult.error) {
      setDetailError(playerResult.error.message || "Could not load that player.");
      return;
    }
    let playerDetail: PlayerDetail;
    try {
      playerDetail = normalizePlayerDetail(playerResult.data);
    } catch (error) {
      setDetailError(
        error instanceof Error ? error.message : "Could not read that player.",
      );
      return;
    }
    let moderationRecord: NonNullable<PlayerDetail["record"]> = {
      bans: [],
      commands: [],
    };
    if (recordResult.error) {
      setRecordError(recordResult.error.message);
    } else {
      try {
        moderationRecord = normalizePlayerRecord(recordResult.data);
      } catch (error) {
        setRecordError(
          error instanceof Error
            ? error.message
            : "Could not read moderation history.",
        );
      }
    }
    const nextDetail = {
      ...playerDetail,
      record: moderationRecord,
      bans: moderationRecord.bans ?? [],
    };
    setDetail(nextDetail);
    const linkedDevices = nextDetail.devices ?? [];
    setSelectedDeviceId(
      linkedDevices.length === 1 ? String(linkedDevices[0].device_id ?? "") : "",
    );
  };

  useEffect(() => {
    let current = true;
    const timer = window.setTimeout(async () => {
      const context = getCommandContext(command);
      const playerFragment = getPlayerSuggestionFragment(command);
      const { data } = await supabase.rpc("admin_command_suggestions", {
        p_fragment: playerFragment ?? context.fragment,
        p_kind: context.stage === "item" ? context.kind ?? null : null,
        p_selected_user_id: selected?.user_id ?? null,
        p_limit: 12,
      });
      if (current) setCatalog((data ?? {}) as CommandSuggestions);
    }, 180);
    return () => {
      current = false;
      window.clearTimeout(timer);
    };
  }, [command, selected?.user_id, supabase]);

  const suggestionLines = useMemo(() => {
    const input = command.toLowerCase();
    const photonOp = input.match(/^\/(upfch|lpfch|upfski|lpfski|upfth|lpfth)\b/)?.[1];
    if (photonOp) {
      const typedAccount = !selected ? command.match(/^\/\w+\s+(\[[^\]]+\]|\S+)(?:\s+|$)/)?.[1] : undefined;
      const account = selected ? "" : ` ${typedAccount || "[username/email]"}`;
      const prefix = `/${photonOp}${account}`;
      const choices = photonOp.endsWith("th")
        ? PHOTON_THEMES.map((theme) => `${prefix} [${theme.name}]`)
        : Object.entries(PHOTON_CHARACTERS)
            .filter(([key]) => photonOp.endsWith("ski") || !["photon_magician", "photon_wizard", "photon_bluff", "photon_bell"].includes(key))
            .flatMap(([, character]) => photonOp.endsWith("ski")
              ? ADMIN_SKIN_TIERS.map((tier) => `${prefix} [${character.name}] ${tier}`)
              : [`${prefix} [${character.name}]`]);
      let remainder = input.slice(photonOp.length + 1).trim();
      if (typedAccount) remainder = remainder.slice(typedAccount.length).trim();
      const fragments = remainder.replace(/\[|\]/g, "").trim().split(/\s+/).filter(Boolean);
      return choices.filter((choice) => fragments.every((fragment) => choice.toLowerCase().includes(fragment))).slice(0, 8);
    }
    if (input.startsWith("/check"))
      return ["gems", "photons", "stardust"].map((stat) => `/check ${stat}${selected ? "" : " username/email"}`);
    if (input.startsWith("/rpt"))
      return [`/rpta${selected ? "" : " username/email"}`, `/rptb${selected ? "" : " username/email"}`, "/rptc"].filter((line) => line.startsWith(input.split(" ")[0]));
    if (!input)
      return selected
        ? [
            ...BASE_COMMANDS.slice(0, -1),
            `/unban ${selected.username || selected.email}`,
          ]
        : [
            "/grant cosmetic [",
            "/grant character [",
            "/grant mastery [",
            "/revoke cosmetic [",
            "/revoke character [",
            "/revoke mastery [",
            "/set gems 100 username/email",
            "/set high score 25000 username/email",
            "/set photons 100 username/email",
            "/set stardust 100 username/email",
            "/check gems username/email",
            "/rptb username/email",
            "/ban username/email 1440",
            "/unban username/email",
          ];
    if (input.startsWith("/grant") || input.startsWith("/revoke")) {
      const context = getCommandContext(command);
      const action = context.action ?? "grant";
      if (context.stage === "target") {
        const base = command.replace(/\]\s+.*$/, "]");
        return (catalog.players ?? []).slice(0, 8).map((player) => {
          const target = player.username || player.email;
          return `${base}${action === "revoke" ? " from " : " "}${target}`;
        });
      }
      if (context.kind === "mastery")
        return adminMasterySuggestions(action, context.fragment, Boolean(selected));
      if (context.kind !== "character" && context.kind !== "cosmetic")
        return [
          `/${action} cosmetic [`,
          `/${action} character [`,
          `/${action} mastery [`,
        ];
      const ownedKeys = new Set(
        (detail?.unlocks ?? []).map((item) => String(item.item_key)),
      );
      return (catalog.items ?? [])
        .filter(
          (item) =>
            !PROTECTED_STARTER_CHARACTERS.has(item.item_key) &&
              (action === "grant" || !selected || ownedKeys.has(item.item_key)),
        )
        .slice(0, 8)
        .map(
          (item) =>
            `/${action} ${item.command_kind} [${item.display_name}]${
              selected ? "" : action === "revoke" ? " from " : " "
            }`,
        );
    }
    if (input.startsWith("/set")) {
      const targetMatch = command.match(
        /^(\/set\s+(?:high[_ ]score|gems|photons|stardust)\s+\d+\s+)(.+)$/i,
      );
      if (targetMatch && (catalog.players?.length ?? 0) > 0)
        return catalog.players!.slice(0, 8).map(
          (player) => `${targetMatch[1]}${player.username || player.email}`,
        );
      return [
        `/set gems 100${selected ? "" : " username/email"}`,
        `/set photons 100${selected ? "" : " username/email"}`,
        `/set stardust 100${selected ? "" : " username/email"}`,
        `/set high score 25000${selected ? "" : " username/email"}`,
      ];
    }
    if (input.startsWith("/ban")) {
      const targetFragment = getPlayerSuggestionFragment(command);
      if (targetFragment && (catalog.players?.length ?? 0) > 0)
        return catalog.players!.slice(0, 4).flatMap((player) => {
          const target = player.username || player.email;
          return [
            `/ban [${target}] 1440`,
            `/ban [${target}] 0`,
          ];
        });
      return [
        `/ban [${selected?.username || selected?.email || "username/email"}] 1440`,
        `/ban [${selected?.username || selected?.email || "username/email"}] 0`,
      ];
    }
    if (input.startsWith("/unban")) {
      if ((catalog.players?.length ?? 0) > 0)
        return catalog.players!.slice(0, 8).map(
          (player) => `/unban ${player.username || player.email}`,
        );
      return [
        `/unban ${selected?.username || selected?.email || "username/email"}`,
      ];
    }
    return BASE_COMMANDS
      .filter(
        (suggestion) =>
          suggestion.toLowerCase().startsWith(input),
      )
      .map((suggestion) =>
        suggestion.toLowerCase().startsWith("/unban")
          ? `/unban ${selected?.username || selected?.email || "username/email"}`
          : suggestion,
      )
      .slice(0, 8);
  }, [catalog, command, detail, selected]);

  const resolveTarget = async (targetText?: string) => {
    if (!targetText) {
      if (!selected)
        throw new Error(
          "Enter an exact username or email when no player is selected.",
        );
      return selected;
    }
    const cleanTarget = targetText.replace(/^(?:from|to)\s+/i, "").trim();
    const { data, error } = await supabase.rpc("admin_player_search", {
      p_query: cleanTarget,
      p_limit: 20,
    });
    if (error) throw new Error(error.message);
    const matches = (data ?? []) as PlayerSummary[];
    const exact = matches.find(
      (player) =>
        player.email.toLowerCase() === cleanTarget.toLowerCase() ||
        player.username?.toLowerCase() === cleanTarget.toLowerCase(),
    );
    if (exact) return exact;
    throw new Error(
      matches.length
        ? "Enter the player's complete username or email. Partial matches are not accepted."
        : "Player not found.",
    );
  };

  const executeCommand = async (event: FormEvent) => {
    event.preventDefault();
    if (!isMainAdmin) return;
    const lookupGeneration = lookupGenerationRef.current;
    setCommandBusy(true);
    setCommandFeedback(null);
    setStatus("");
    try {
      const parsed = parseAdminCommand(command, Boolean(selected));
      if (parsed.action === "rptc") {
        const { data, error } = await supabase.rpc("admin_player_command_v23", {
          p_action: "rptc", p_target_user_id: null, p_command_text: command,
        });
        if (lookupGeneration !== lookupGenerationRef.current) return;
        if (error) throw new Error(error.message);
        const result = data as { ok?: boolean; cleared_count?: number; error?: string } | null;
        if (!result?.ok) throw new Error(result?.error || "Command was rejected.");
        setCommand("");
        setCommandFeedback({ tone: "success", message: `Cleared ${result.cleared_count ?? 0} active reports.` });
        return;
      }
      if (!selected && !parsed.targetText?.trim())
        throw new Error(
          "Enter an exact username or email in the command when no player is selected.",
        );
      const target = await resolveTarget(parsed.targetText);
      if (lookupGeneration !== lookupGenerationRef.current) return;
      let commandDeviceId: string | null = null;
      if (parsed.banScopes?.includes("device")) {
        const targetIsSelected = target.user_id === selected?.user_id;
        const targetDevices = targetIsSelected ? (detail?.devices ?? []) : [];
        if (!targetIsSelected)
          throw new Error(
            "Select that player first, then choose the device to ban.",
          );
        if (!targetDevices.length)
          throw new Error("That player has no linked browser device to ban.");
        commandDeviceId =
          selectedDeviceId ||
          (targetDevices.length === 1
            ? String(targetDevices[0].device_id ?? "")
            : "");
        if (!commandDeviceId)
          throw new Error("Choose one linked device before running this ban.");
      }
      let item: CatalogItem | undefined;
      const mastery = parsed.itemKind === "mastery" && parsed.itemName ? resolveAdminMastery(parsed.itemName) : undefined;
      if (parsed.itemName && !isV23AdminCommand(parsed)) {
        const { data, error } = await supabase.rpc("admin_command_suggestions", {
          p_fragment: parsed.itemName,
          p_kind: parsed.itemKind ?? null,
          p_selected_user_id: target.user_id,
          p_limit: 50,
        });
        if (lookupGeneration !== lookupGenerationRef.current) return;
        if (error) throw new Error(error.message);
        const items = ((data as CommandSuggestions | null)?.items ?? []);
        item = items.find(
          (candidate) =>
            normalize(candidate.display_name) === normalize(parsed.itemName!) ||
            normalize(candidate.item_key) === normalize(parsed.itemName!),
        );
        if (!item) throw new Error("Choose an exact item from the suggestions.");
        if (PROTECTED_STARTER_CHARACTERS.has(item.item_key))
          throw new Error("The four starter characters cannot be granted or revoked.");
      }
      const commandResult =
        isV23AdminCommand(parsed)
          ? await supabase.rpc("admin_player_command_v23", {
              p_action: parsed.action,
              p_target_user_id: target.user_id,
              p_item_kind: parsed.itemKind ?? null,
              p_item_key: mastery?.key ?? parsed.itemName ?? null,
              p_stat_key: parsed.characterName ?? parsed.statKey ?? null,
              p_value: parsed.value ?? null,
              p_command_text: command,
            })
          : parsed.action === "unban"
          ? await supabase.rpc("admin_unban_player", {
              p_target_user_id: target.user_id,
              p_reason: "Issued from Admin Player Editor",
              p_command_text: command,
            })
          : await supabase.rpc("admin_execute_player_command", {
              p_action: parsed.action,
              p_target_user_id: target.user_id,
              p_item_kind: parsed.itemKind ?? null,
              p_item_key: item?.item_key ?? null,
              p_stat_key: parsed.statKey ?? null,
              p_value: parsed.value ?? null,
              p_ban_scopes: parsed.banScopes ?? null,
              p_device_id: commandDeviceId,
              p_duration_seconds: parsed.durationSeconds ?? null,
              p_permanent: parsed.permanent ?? false,
              p_ban_id: null,
              p_reason:
                parsed.action === "ban" && banNote.trim()
                  ? banNote.trim()
                  : "Issued from Admin Player Editor",
              p_command_text: command,
            });
      if (lookupGeneration !== lookupGenerationRef.current) return;
      const { data, error } = commandResult;
      if (error) throw new Error(error.message);
      const result = data as {
        ok?: boolean;
        error?: string;
        revoked_count?: number;
        value?: number | null;
        noop?: boolean;
        message?: string;
      } | null;
      if (!result?.ok) throw new Error(result?.error || "Command was rejected.");
      const completedMessage =
        parsed.action === "check"
          ? `${parsed.statKey?.toUpperCase()}: ${result.value === null ? "NULL (Photon Fury is locked)" : result.value ?? 0} · ${target.username || target.email}`
          : result.noop
            ? result.message || "No changes were needed."
          : parsed.action === "unban"
          ? `UNBAN completed for ${target.username || target.email}. ${result.revoked_count ?? 0} active ban${result.revoked_count === 1 ? "" : "s"} removed.`
          : `${parsed.action.toUpperCase()} completed for ${target.username || target.email}.`;
      setCommand("");
      setBanNote("");
      await choosePlayer(target);
      if (lookupGeneration !== lookupGenerationRef.current) return;
      setCommandFeedback({ tone: "success", message: completedMessage });
    } catch (error) {
      if (lookupGeneration !== lookupGenerationRef.current) return;
      setCommandFeedback({
        tone: "error",
        message: error instanceof Error ? error.message : "Command failed.",
      });
    } finally {
      if (lookupGeneration === lookupGenerationRef.current)
        setCommandBusy(false);
    }
  };

  const account = detail?.account ?? {};
  const displayName =
    String(detail?.profile?.username ?? selected?.username ?? "NO USERNAME");
  const devices = detail?.devices ?? [];
  const inventory = useMemo(() => detail?.unlocks ?? [], [detail?.unlocks]);
  const inventoryGroups = useMemo(() => {
    const grouped = new Map<
      PlayerInventoryGroupKey,
      Array<Record<string, unknown>>
    >(PLAYER_INVENTORY_GROUPS.map((group) => [group.key, []]));
    inventory.forEach((item) =>
      grouped.get(getPlayerInventoryGroup(item))!.push(item),
    );
    return PLAYER_INVENTORY_GROUPS.map((group) => ({
      ...group,
      items: grouped.get(group.key)!.sort((left, right) => {
        const typeDifference =
          (String(left.item_type) === "class" ? 0 : 1) -
          (String(right.item_type) === "class" ? 0 : 1);
        if (typeDifference) return typeDifference;
        const rarityDifference =
          (RARITY_SORT_ORDER[String(left.rarity).toLowerCase()] ?? 99) -
          (RARITY_SORT_ORDER[String(right.rarity).toLowerCase()] ?? 99);
        if (rarityDifference) return rarityDifference;
        return String(left.display_name ?? left.item_key).localeCompare(
          String(right.display_name ?? right.item_key),
        );
      }),
    })).filter((group) => group.key !== "other" || group.items.length > 0);
  }, [inventory]);
  const moderationBans = detail?.record?.bans ?? [];
  const moderationCommands = detail?.record?.commands ?? [];
  const recordEntries = [
    ...moderationBans.map((row, index) => ({
      kind: "ban" as const,
      row,
      key: `ban-${String(row.id ?? index)}`,
      createdAt: String(row.created_at ?? ""),
    })),
    ...moderationCommands.map((row, index) => ({
      kind: "command" as const,
      row,
      key: `command-${String(row.id ?? index)}`,
      createdAt: String(row.created_at ?? ""),
    })),
  ].sort((left, right) => {
    const rightTime = new Date(right.createdAt).getTime();
    const leftTime = new Date(left.createdAt).getTime();
    return (Number.isNaN(rightTime) ? 0 : rightTime) -
      (Number.isNaN(leftTime) ? 0 : leftTime);
  });

  return (
    <div className="player-editor">
      <form className="player-search" onSubmit={runSearch}>
        <label htmlFor="admin-player-search">SEARCH USERNAME OR EMAIL</label>
        <div>
          <input
            id="admin-player-search"
            disabled={commandBusy}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Username or email"
          />
          <button disabled={searching || commandBusy}>{searching ? "SEARCHING…" : "SEARCH"}</button>
        </div>
      </form>

      {players.length > 0 && (
        <div className="player-search-results">
          {players.map((player) => (
            <button
              key={player.user_id}
              disabled={commandBusy}
              className={selected?.user_id === player.user_id ? "selected" : ""}
              onClick={() => void choosePlayer(player)}
            >
              <b>{player.username || "NO USERNAME"}</b>
              <small>{player.email}</small>
              <span>
                {player.account_banned ? "ACCOUNT BANNED" : "ACTIVE"}
                {player.leaderboard_banned ? " · SCORE BANNED" : ""}
              </span>
            </button>
          ))}
        </div>
      )}

      {status && <div className="player-editor-status" role="status">{status}</div>}

      {isMainAdmin && (
        <section className="command-console">
          <header>
            <div>
              <small>MAIN ADMIN ONLY</small>
              <h3>PLAYER COMMANDS</h3>
            </div>
            <span>
              {selected
                ? `DEFAULT TARGET: ${selected.username || selected.email}`
                : "NO DEFAULT · TYPE AN EXACT USERNAME OR EMAIL"}
            </span>
          </header>
          <div className="command-suggestions" aria-label="Command suggestions">
            {suggestionLines.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => {
                  setCommand(suggestion);
                  setCommandFeedback(null);
                }}
              >
                {suggestion}
              </button>
            ))}
          </div>
          <form onSubmit={executeCommand}>
            <span aria-hidden="true">&gt;</span>
            <input
              ref={commandInputRef}
              aria-describedby={
                commandFeedback
                  ? "admin-player-command-help admin-player-command-feedback"
                  : "admin-player-command-help"
              }
              aria-label="Admin player command"
              value={command}
              onChange={(event) => {
                setCommand(event.target.value);
                setCommandFeedback(null);
              }}
              placeholder={
                selected
                  ? "/grant cosmetic [Dark Caves]"
                  : "/grant cosmetic [Dark Caves] username/email"
              }
              spellCheck={false}
              autoComplete="off"
            />
            <button disabled={commandBusy || !command.trim()}>
              {commandBusy ? "RUNNING…" : "RUN"}
            </button>
          </form>
          {/^\/ban\b/i.test(command.trim()) && (
            <label className="command-ban-note">
              BAN NOTE <span>OPTIONAL · SHOWN TO THE PLAYER</span>
              <textarea
                value={banNote}
                onChange={(event) => setBanNote(event.target.value)}
                maxLength={500}
                placeholder="Why is this player being banned?"
              />
              <small>{banNote.length}/500</small>
            </label>
          )}
          {commandFeedback && (
            <div
              id="admin-player-command-feedback"
              className={`command-feedback ${commandFeedback.tone}`}
              role={commandFeedback.tone === "error" ? "alert" : "status"}
            >
              {commandFeedback.message}
            </div>
          )}
          <p id="admin-player-command-help">
            Use brackets around exact item names. Without a selected player,
            include an exact username or email. Set examples: /set photons 100 username,
            /set stardust 100 username. Use /check gems username to read a balance.
            Ban example: /ban username 1440 (one day), or /ban username 0 (permanent).
            Use /unban username/email
            to remove all of that player&apos;s active bans. Commands are validated
            actions, never SQL. Coin and attack-coin balances are gameplay-only
            and cannot be changed by admin commands.
            Photon example: /upfski [username] [Burner] immortal. /upfch and /lpfch
            grant or revoke a Photon character; /upfth and /lpfth change a theme.
            /rpta allows reports; /rptb blocks reports; /rptc clears all active reports.
            Locked Photon accounts are never changed. Starter characters are protected.
            Mastery example: /grant mastery [Dash] username. The player must own
            the character first. /revoke mastery [Dash] username removes its mastery
            benefits but keeps quest progress. Inventory buttons prepare a command;
            press RUN to apply it.
          </p>
        </section>
      )}

      {selected && (
        loadingDetail ? (
          <div className="player-editor-empty">Loading player information…</div>
        ) : detailError ? (
          <div className="player-editor-error" role="alert">
            <strong>PLAYER DATA COULD NOT LOAD</strong>
            <span>{detailError}</span>
          </div>
        ) : !detail ? (
          <div className="player-editor-error" role="alert">
            <strong>PLAYER DATA COULD NOT LOAD</strong>
            <span>No player details were returned. Try the lookup again.</span>
          </div>
        ) : (
          <div className="player-detail-sections">
            <section className="player-detail-section account-info-section">
              <header className="player-detail-title">
                <span>01</span>
                <div>
                  <small>PLAYER LOOKUP</small>
                  <h3>ACCOUNT INFO</h3>
                </div>
              </header>
              <div className="account-info-grid">
                <div>
                  <small>USERNAME</small>
                  <strong>{displayName}</strong>
                </div>
                <div>
                  <small>EMAIL</small>
                  <strong>{String(account.email ?? selected.email)}</strong>
                </div>
                <div>
                  <small>ACCOUNT CREATED</small>
                  <strong>{formatDate(account.created_at)}</strong>
                </div>
                <div>
                  <small>ADMIN ROLE</small>
                  <strong>{humanize(account.admin_role ?? "player")}</strong>
                </div>
              </div>

              <div className="player-detail-subsection">
                <h4>DEVICES <span>{devices.length}</span></h4>
                {devices.length === 0 ? (
                  <div className="player-editor-empty">No registered devices.</div>
                ) : (
                  <div className="account-record-list">
                    {devices.map((device, index) => (
                      <article key={String(device.device_id ?? index)}>
                        <header>
                          <strong>{String(device.label ?? "Web browser")}</strong>
                          <span className={device.device_banned ? "bad" : "good"}>
                            {device.device_banned ? "BANNED" : "ACTIVE"}
                          </span>
                        </header>
                        <p>{String(device.token_hint ?? "No device hint")}</p>
                        <small>
                          First seen {formatDate(device.first_seen_at)} · Last seen{" "}
                          {formatDate(device.last_seen_at)}
                        </small>
                      </article>
                    ))}
                  </div>
                )}
              </div>

            </section>

            <section className="player-detail-section inventory-info-section">
              <header className="player-detail-title">
                <span>02</span>
                <div>
                  <small>OWNED ITEMS</small>
                  <h3>INVENTORY <em>{inventory.length}</em></h3>
                </div>
              </header>
              <AdminMasteryInventory
                masteries={detail.masteries ?? []}
                ownedCharacters={inventory.filter((item) => item.item_type === "character").map((item) => String(item.item_key))}
                isMainAdmin={isMainAdmin}
                busy={commandBusy}
                onCommand={(preparedCommand) => {
                  setCommand(preparedCommand);
                  setCommandFeedback(null);
                  commandInputRef.current?.focus();
                  commandInputRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
                }}
              />
              {inventory.length === 0 ? (
                <div className="player-editor-empty">Inventory is empty.</div>
              ) : (
                <div className="player-inventory-groups">
                  {inventoryGroups.map((group, groupIndex) => (
                    <details
                      className={`player-inventory-group group-${group.key}`}
                      key={group.key}
                    >
                      <summary>
                        <span>{String(groupIndex + 1).padStart(2, "0")}</span>
                        <span>
                          <strong>{group.label}</strong>
                          <small>{group.description}</small>
                        </span>
                        <em>{group.items.length}</em>
                      </summary>
                      {group.items.length === 0 ? (
                        <div className="player-editor-empty">
                          No owned items in this category.
                        </div>
                      ) : (
                        <div className="player-inventory-list">
                          {group.items.map((item, index) => (
                            <article key={String(item.item_key ?? index)}>
                              <header>
                                <strong>
                                  {String(
                                    item.display_name ?? humanize(item.item_key),
                                  )}
                                </strong>
                                <span>{humanize(item.rarity)}</span>
                              </header>
                              <p>
                                {String(item.item_type) === "class"
                                  ? "Legacy Class Unlock"
                                  : humanize(item.item_type)}
                                {item.character_class
                                  ? ` · ${humanize(item.character_class)}`
                                  : ""}
                              </p>
                              <small>
                                Unlocked {formatDate(item.unlocked_at)}
                              </small>
                            </article>
                          ))}
                        </div>
                      )}
                    </details>
                  ))}
                </div>
              )}
            </section>

            <details className="player-detail-section player-record-section">
              <summary className="player-detail-title">
                <span>03</span>
                <div>
                  <small>MODERATION HISTORY</small>
                  <h3>RECORD <em>{recordEntries.length}</em></h3>
                </div>
              </summary>
              {recordError ? (
                <div className="player-editor-error compact" role="alert">
                  <strong>RECORD COULD NOT LOAD</strong>
                  <span>{recordError}</span>
                </div>
              ) : recordEntries.length === 0 ? (
                <div className="player-editor-empty">No bans or commands on record.</div>
              ) : (
                <div className="player-record-list">
                  {recordEntries.map((entry) => {
                    const row = entry.row;
                    if (entry.kind === "ban") {
                      const statusLabel = row.active
                        ? "ACTIVE"
                        : row.revoked_at
                          ? "REVOKED"
                          : "EXPIRED";
                      return (
                        <article className="ban-entry" key={entry.key}>
                          <header>
                            <strong>BAN · {humanize(row.scope)}</strong>
                            <span className={row.active ? "bad" : "muted"}>
                              {statusLabel}
                            </span>
                          </header>
                          <p>{String(row.reason ?? "No reason provided.")}</p>
                          <div className="record-actor">
                            <b>ISSUED BY</b>
                            <span>{formatActor(row, "created_by")}</span>
                          </div>
                          <small>
                            {formatDate(row.created_at)} · Expires{" "}
                            {row.expires_at ? formatDate(row.expires_at) : "INFINITE"}
                          </small>
                          {Boolean(row.revoked_at) && (
                            <div className="record-revoked">
                              Revoked by {formatActor(row, "revoked_by")} on{" "}
                              {formatDate(row.revoked_at)}
                              {row.revoked_reason
                                ? ` · ${String(row.revoked_reason)}`
                                : ""}
                            </div>
                          )}
                        </article>
                      );
                    }
                    return (
                      <article className="command-entry" key={entry.key}>
                        <header>
                          <strong>COMMAND · {humanize(row.action)}</strong>
                          <span className={row.succeeded ? "good" : "bad"}>
                            {row.succeeded ? "SUCCESS" : "FAILED"}
                          </span>
                        </header>
                        <code>{String(row.command_text ?? `/${row.action ?? "command"}`)}</code>
                        <div className="record-actor">
                          <b>USED BY</b>
                          <span>{formatActor(row, "actor")}</span>
                        </div>
                        <small>{formatDate(row.created_at)}</small>
                        {Boolean(row.error_message) && (
                          <div className="record-error">{String(row.error_message)}</div>
                        )}
                      </article>
                    );
                  })}
                </div>
              )}
            </details>
          </div>
        )
      )}
    </div>
  );
}
