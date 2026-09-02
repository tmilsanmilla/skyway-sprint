"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { SupabaseClient } from "@supabase/supabase-js";

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
  devices?: Array<Record<string, unknown>>;
  bans?: Array<Record<string, unknown>>;
  reports?: Array<Record<string, unknown>>;
  multiplayer?: Record<string, unknown> | null;
  extractions?: Array<Record<string, unknown>>;
  record?: {
    bans?: Array<Record<string, unknown>>;
    commands?: Array<Record<string, unknown>>;
  };
};

type ParsedCommand = {
  action: "grant" | "revoke" | "set" | "bann" | "unban";
  targetText?: string;
  itemKind?: string;
  itemName?: string;
  statKey?: string;
  value?: number;
  banScopes?: string[];
  durationSeconds?: number;
  permanent?: boolean;
  banId?: number;
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

const BASE_COMMANDS = [
  "/grant cosmetic [",
  "/grant character [",
  "/revoke cosmetic [",
  "/revoke character [",
  "/set gems 100",
  "/set high score 25000",
  "/set coins 10",
  "/bann [account + device + score] for INFINITE",
  "/unban [",
];
const PLAYER_LOOKUP_IDLE_MS = 5 * 60 * 1000;
const PROTECTED_STARTER_CHARACTERS = new Set([
  "runner_ace",
  "medic_patch",
  "tank_bulwark",
  "trickster_rogue",
]);
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
    description: "Owned Runner characters and legacy unlocks.",
  },
  {
    key: "medic",
    label: "HEALER",
    description: "Owned Healer characters and legacy unlocks.",
  },
  {
    key: "tank",
    label: "TANK",
    description: "Owned Tank characters and legacy unlocks.",
  },
  {
    key: "trickster",
    label: "TRICKSTER",
    description: "Owned Trickster characters and legacy unlocks.",
  },
  {
    key: "other",
    label: "OTHER",
    description: "Older or unclassified owned items.",
  },
] as const;
type PlayerInventoryGroupKey = (typeof PLAYER_INVENTORY_GROUPS)[number]["key"];
const CHARACTER_CLASS_KEYS = new Set(["runner", "medic", "tank", "trickster"]);
const RARITY_SORT_ORDER: Record<string, number> = {
  mythic: 0,
  legendary: 1,
  epic: 2,
  rare: 3,
  uncommon: 4,
  common: 5,
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
  const setTarget = raw.match(
    /^\/set\s+(?:high[_ ]score|gems|coins)\s+\d+\s+(.+)$/i,
  );
  if (setTarget)
    return setTarget[1].replace(/^(?:from|to)\s+/i, "").trim();

  const openBan = raw.match(/^\/bann?\s+\[([^\]]*)$/i);
  if (!openBan) return null;
  const inside = openBan[1].trim();
  const firstScope = Array.from(
    inside.matchAll(
      /(?:^|[+\s])\s*(account|device|score|leaderboard)(?=\s*(?:\+|$))/gi,
    ),
  )[0];
  return (firstScope ? inside.slice(0, firstScope.index) : inside)
    .replace(/\s*\+\s*$/, "")
    .trim();
};

const parseDuration = (raw: string) => {
  if (
    ["permanently", "permanent", "infinite", "infinity", "infnite"].includes(
      normalize(raw),
    )
  )
    return { permanent: true, seconds: undefined };
  const units: Record<string, { order: number; seconds: number }> = {
    year: { order: 0, seconds: 31_536_000 },
    years: { order: 0, seconds: 31_536_000 },
    day: { order: 1, seconds: 86_400 },
    days: { order: 1, seconds: 86_400 },
    hour: { order: 2, seconds: 3_600 },
    hours: { order: 2, seconds: 3_600 },
    minute: { order: 3, seconds: 60 },
    minutes: { order: 3, seconds: 60 },
  };
  const pieces = raw.split(/\s*\+\s*/).map((piece) => piece.trim());
  if (!pieces.length) throw new Error("Add a duration after FOR.");
  let lastOrder = -1;
  let total = 0;
  const used = new Set<number>();
  for (const piece of pieces) {
    const match = piece.match(/^(\d+)\s+(years?|days?|hours?|minutes?)$/i);
    if (!match) throw new Error(`Invalid duration part: ${piece}`);
    const amount = Number(match[1]);
    const unit = units[match[2].toLowerCase()];
    if (!amount || amount > 1000)
      throw new Error("Duration values must be between 1 and 1000.");
    if (unit.order <= lastOrder || used.has(unit.order))
      throw new Error("Write durations from largest to smallest: years, days, hours, minutes.");
    lastOrder = unit.order;
    used.add(unit.order);
    total += amount * unit.seconds;
  }
  if (total > 3_155_760_000)
    throw new Error("Timed bans cannot be longer than 100 years.");
  return { permanent: false, seconds: total };
};

const parseCommand = (raw: string): ParsedCommand => {
  const command = raw.trim();
  let match = command.match(
    /^\/(grant|revoke)\s+(\w+)\s+\[([^\]]+)\](?:\s+(.+))?$/i,
  );
  if (match)
    return {
      action: match[1].toLowerCase() as "grant" | "revoke",
      itemKind: match[2].toLowerCase(),
      itemName: match[3].trim(),
      targetText: match[4]?.trim(),
    };

  match = command.match(
    /^\/set\s+(high[_ ]score|gems|coins)\s+(\d+)(?:\s+(.+))?$/i,
  );
  if (match)
    return {
      action: "set",
      statKey: normalize(match[1]).replace(" ", "_"),
      value: Number(match[2]),
      targetText: match[3]?.trim(),
    };

  match = command.match(/^\/bann?\s+\[([^\]]+)\]\s+for\s+(.+)$/i);
  if (match) {
    const inside = match[1].trim();
    const scopeMatches = Array.from(
      inside.matchAll(
        /(?:^|[+\s])\s*(account|device|score|leaderboard)(?=\s*(?:\+|$))/gi,
      ),
    );
    const scopes = scopeMatches.map((scopeMatch) =>
      scopeMatch[1].toLowerCase() === "score"
        ? "leaderboard"
        : scopeMatch[1].toLowerCase(),
    );
    if (!scopes.length)
      throw new Error("Choose account, device, score, or a combination with +.");
    const firstScope = scopeMatches[0].index ?? 0;
    const targetText =
      firstScope <= 0
        ? ""
        : inside.slice(0, firstScope).replace(/\s*\+\s*$/, "").trim();
    const duration = parseDuration(match[2]);
    return {
      action: "bann",
      targetText: targetText || undefined,
      banScopes: Array.from(new Set(scopes)),
      durationSeconds: duration.seconds,
      permanent: duration.permanent,
    };
  }

  match = command.match(/^\/unban\s+\[?(\d+)\]?(?:\s+(.+))?$/i);
  if (match)
    return {
      action: "unban",
      banId: Number(match[1]),
      targetText: match[2]?.trim(),
    };

  throw new Error(
    "Unknown command. Pick one of the suggestions above the command box.",
  );
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
  supabase: SupabaseClient;
  isMainAdmin: boolean;
  isActive: boolean;
}) {
  const [search, setSearch] = useState("");
  const [searching, setSearching] = useState(false);
  const [players, setPlayers] = useState<PlayerSummary[]>([]);
  const [selected, setSelected] = useState<PlayerSummary | null>(null);
  const [detail, setDetail] = useState<PlayerDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [command, setCommand] = useState("");
  const [commandBusy, setCommandBusy] = useState(false);
  const [commandFeedback, setCommandFeedback] =
    useState<CommandFeedback | null>(null);
  const [status, setStatus] = useState("");
  const [catalog, setCatalog] = useState<CommandSuggestions>({});
  const [selectedDeviceId, setSelectedDeviceId] = useState("");
  const detailRequestRef = useRef(0);
  const searchRequestRef = useRef(0);
  const lookupGenerationRef = useRef(0);
  const inactiveSinceRef = useRef<number | null>(null);
  const inactivityTimerRef = useRef<number | null>(null);

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
    setCommand("");
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
    const requestId = ++searchRequestRef.current;
    ++detailRequestRef.current;
    setSearching(true);
    setStatus("");
    setPlayers([]);
    setSelected(null);
    setDetail(null);
    setSelectedDeviceId("");
    setCommand("");
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
    setSelectedDeviceId("");
    setCommand("");
    setCommandFeedback(null);
    setLoadingDetail(true);
    setStatus("");
    const [playerResult, recordResult] = await Promise.all([
      supabase.rpc("admin_get_player", { p_user_id: player.user_id }),
      supabase.rpc("admin_get_player_record", { p_user_id: player.user_id }),
    ]);
    if (requestId !== detailRequestRef.current) return;
    setLoadingDetail(false);
    if (playerResult.error || recordResult.error) {
      setStatus(
        playerResult.error?.message ||
          recordResult.error?.message ||
          "Could not load that player.",
      );
      return;
    }
    const moderationRecord = (recordResult.data ?? {}) as NonNullable<
      PlayerDetail["record"]
    >;
    const nextDetail = {
      ...((playerResult.data ?? {}) as PlayerDetail),
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
    if (!input)
      return selected
        ? BASE_COMMANDS
        : [
            "/grant cosmetic [",
            "/grant character [",
            "/revoke cosmetic [",
            "/revoke character [",
            "/set gems 100 username/email",
            "/set high score 25000 username/email",
            "/set coins 10 username/email",
            "/bann [username/email account + device + score] for INFINITE",
            "/unban [ban id] username/email",
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
      if (context.kind !== "character" && context.kind !== "cosmetic")
        return [
          `/${action} cosmetic [`,
          `/${action} character [`,
        ];
      const ownedKeys = new Set(
        (detail?.unlocks ?? []).map((item) => String(item.item_key)),
      );
      return (catalog.items ?? [])
        .filter(
          (item) =>
            action === "grant" ||
            (!PROTECTED_STARTER_CHARACTERS.has(item.item_key) &&
              (!selected || ownedKeys.has(item.item_key))),
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
        /^(\/set\s+(?:high[_ ]score|gems|coins)\s+\d+\s+)(.+)$/i,
      );
      if (targetMatch && (catalog.players?.length ?? 0) > 0)
        return catalog.players!.slice(0, 8).map(
          (player) => `${targetMatch[1]}${player.username || player.email}`,
        );
      return [
        `/set gems 100${selected ? "" : " username/email"}`,
        `/set high score 25000${selected ? "" : " username/email"}`,
        `/set coins 10${selected ? "" : " username/email"}`,
      ];
    }
    if (input.startsWith("/ban")) {
      const targetFragment = getPlayerSuggestionFragment(command);
      if (targetFragment && (catalog.players?.length ?? 0) > 0)
        return catalog.players!.slice(0, 4).flatMap((player) => {
          const target = player.username || player.email;
          return [
            `/bann [${target} account] for 24 hours`,
            `/bann [${target} account + device + score] for 7 days`,
          ];
        });
      return [
        `/bann [${selected ? "" : "username/email "}account] for 24 hours`,
        `/bann [${selected ? "" : "username/email "}device + score] for 7 days`,
        `/bann [${selected ? "" : "username/email "}account + device + score] for INFINITE`,
        `/bann [${selected ? "" : "username/email "}account + score] for 1 year + 10 days + 10 minutes`,
      ];
    }
    if (input.startsWith("/unban")) {
      if (!selected) return ["/unban [ban id] username/email"];
      return (detail?.bans ?? [])
        .filter((ban) => Boolean(ban.active ?? true))
        .map((ban) => `/unban [${String(ban.id)}]`)
        .slice(0, 8);
    }
    return (catalog.commands ?? BASE_COMMANDS).slice(0, 8);
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
      const parsed = parseCommand(command);
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
      if (parsed.itemName) {
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
      }
      const { data, error } = await supabase.rpc(
        "admin_execute_player_command",
        {
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
          p_ban_id: parsed.banId ?? null,
          p_reason: "Issued from Admin Player Editor",
          p_command_text: command,
        },
      );
      if (lookupGeneration !== lookupGenerationRef.current) return;
      if (error) throw new Error(error.message);
      const result = data as { ok?: boolean; error?: string } | null;
      if (!result?.ok) throw new Error(result?.error || "Command was rejected.");
      const completedMessage = `${parsed.action.toUpperCase()} completed for ${target.username || target.email}.`;
      setCommand("");
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
  const receipts = detail?.extractions ?? [];
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
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Username or email"
          />
          <button disabled={searching}>{searching ? "SEARCHING…" : "SEARCH"}</button>
        </div>
      </form>

      {players.length > 0 && (
        <div className="player-search-results">
          {players.map((player) => (
            <button
              key={player.user_id}
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
          {(detail?.devices?.length ?? 0) > 0 && (
            <label className="command-device">
              DEVICE TARGET
              <select
                value={selectedDeviceId}
                onChange={(event) => setSelectedDeviceId(event.target.value)}
              >
                {detail!.devices!.length > 1 && (
                  <option value="">CHOOSE A LINKED DEVICE</option>
                )}
                {detail!.devices!.map((device) => (
                  <option
                    key={String(device.device_id)}
                    value={String(device.device_id)}
                  >
                    {String(device.label ?? "Web browser")} · {String(
                      device.token_hint ?? device.device_id,
                    )}
                  </option>
                ))}
              </select>
            </label>
          )}
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
            include an exact username or email. Ban durations must go from largest
            to smallest; use INFINITE for a permanent ban. Commands are validated
            actions, never SQL.
          </p>
        </section>
      )}

      {selected && (
        loadingDetail ? (
          <div className="player-editor-empty">Loading player information…</div>
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

              <div className="player-detail-subsection">
                <h4>RECEIPTS <span>{receipts.length}</span></h4>
                {receipts.length === 0 ? (
                  <div className="player-editor-empty">No recorded shop receipts.</div>
                ) : (
                  <div className="account-record-list receipt-list">
                    {receipts.map((receipt, index) => (
                      <article key={String(receipt.id ?? index)}>
                        <header>
                          <strong>{humanize(receipt.item_key ?? "Unknown item")}</strong>
                          <span>{String(receipt.gem_cost ?? 0)} GEMS</span>
                        </header>
                        <p>
                          {humanize(receipt.box_type ?? "box")} ·{" "}
                          {humanize(receipt.rarity ?? "unknown rarity")} ·{" "}
                          {receipt.was_new ? "NEW ITEM" : "DUPLICATE"}
                        </p>
                        <small>{formatDate(receipt.created_at)}</small>
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

            <section className="player-detail-section player-record-section">
              <header className="player-detail-title">
                <span>03</span>
                <div>
                  <small>MODERATION HISTORY</small>
                  <h3>RECORD <em>{recordEntries.length}</em></h3>
                </div>
              </header>
              {recordEntries.length === 0 ? (
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
            </section>
          </div>
        )
      )}
    </div>
  );
}
