"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
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

const BASE_COMMANDS = [
  "/grant cosmetic [",
  "/grant character [",
  "/revoke cosmetic [",
  "/revoke character [",
  "/set gems 100",
  "/set high score 25000",
  "/set coins 10",
  "/bann [account + device + score] for 7 days",
  "/unban [",
];
const PROTECTED_STARTER_CHARACTERS = new Set([
  "runner_ace",
  "medic_patch",
  "tank_bulwark",
  "trickster_rogue",
]);

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
  const target = raw.match(/\]\s+(?:(?:from|to)\s+)?(.+)$/i);
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
  return openBan[1]
    .replace(/\b(account|device|score|leaderboard)\b/gi, "")
    .replaceAll("+", " ")
    .trim();
};

const parseDuration = (raw: string) => {
  if (normalize(raw) === "permanently")
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
    const scopes = Array.from(
      inside.matchAll(/\b(account|device|score|leaderboard)\b/gi),
      (result) =>
        result[1].toLowerCase() === "score"
          ? "leaderboard"
          : result[1].toLowerCase(),
    );
    if (!scopes.length)
      throw new Error("Choose account, device, score, or a combination with +.");
    const targetText = inside
      .replace(/\b(account|device|score|leaderboard)\b/gi, "")
      .replaceAll("+", " ")
      .trim();
    const duration = parseDuration(match[2]);
    return {
      action: "bann",
      targetText: targetText || undefined,
      banScopes: Array.from(new Set(scopes)),
      durationSeconds: duration.seconds,
      permanent: duration.permanent,
    };
  }

  match = command.match(/^\/unban\s+\[?(\d+)\]?$/i);
  if (match) return { action: "unban", banId: Number(match[1]) };

  throw new Error(
    "Unknown command. Pick one of the suggestions above the command box.",
  );
};

const FieldGrid = ({ value }: { value?: Record<string, unknown> | null }) => {
  if (!value || Object.keys(value).length === 0)
    return <div className="player-editor-empty">No data.</div>;
  return (
    <dl className="player-editor-fields">
      {Object.entries(value).map(([key, field]) => (
        <div key={key}>
          <dt>{humanize(key)}</dt>
          <dd>
            {key.endsWith("_at") || key === "created_at" || key === "last_sign_in_at"
              ? formatDate(field)
              : typeof field === "object" && field !== null
                ? JSON.stringify(field)
                : String(field ?? "—")}
          </dd>
        </div>
      ))}
    </dl>
  );
};

const RecordList = ({
  rows,
  empty,
}: {
  rows?: Array<Record<string, unknown>>;
  empty: string;
}) => {
  if (!rows?.length) return <div className="player-editor-empty">{empty}</div>;
  return (
    <div className="player-editor-records">
      {rows.map((row, index) => (
        <article key={String(row.id ?? row.item_key ?? row.device_id ?? index)}>
          {Object.entries(row).map(([key, value]) => (
            <span key={key}>
              <b>{humanize(key)}</b>
              {key.endsWith("_at") || key === "expires_at"
                ? formatDate(value)
                : typeof value === "object" && value !== null
                  ? JSON.stringify(value)
                  : String(value ?? "—")}
            </span>
          ))}
        </article>
      ))}
    </div>
  );
};

export function AdminPlayerEditor({
  supabase,
  isMainAdmin,
}: {
  supabase: SupabaseClient;
  isMainAdmin: boolean;
}) {
  const [search, setSearch] = useState("");
  const [searching, setSearching] = useState(false);
  const [players, setPlayers] = useState<PlayerSummary[]>([]);
  const [selected, setSelected] = useState<PlayerSummary | null>(null);
  const [detail, setDetail] = useState<PlayerDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [command, setCommand] = useState("");
  const [commandBusy, setCommandBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [catalog, setCatalog] = useState<CommandSuggestions>({});
  const [selectedDeviceId, setSelectedDeviceId] = useState("");
  const detailRequestRef = useRef(0);
  const searchRequestRef = useRef(0);

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
    setLoadingDetail(true);
    setStatus("");
    const { data, error } = await supabase.rpc("admin_get_player", {
      p_user_id: player.user_id,
    });
    if (requestId !== detailRequestRef.current) return;
    setLoadingDetail(false);
    if (error) {
      setStatus(error.message);
      return;
    }
    const nextDetail = (data ?? {}) as PlayerDetail;
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
    if (!input) return BASE_COMMANDS;
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
            (ownedKeys.has(item.item_key) &&
              !PROTECTED_STARTER_CHARACTERS.has(item.item_key)),
        )
        .slice(0, 8)
        .map(
          (item) =>
            `/${action} ${item.command_kind} [${item.display_name}]`,
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
        "/set gems 100",
        "/set high score 25000",
        "/set coins 10",
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
        "/bann [account] for 24 hours",
        "/bann [device + score] for 7 days",
        "/bann [account + device + score] for permanently",
        "/bann [account + score] for 1 year + 10 days + 10 minutes",
      ];
    }
    if (input.startsWith("/unban"))
      return (detail?.bans ?? [])
        .filter((ban) => Boolean(ban.active ?? true))
        .map((ban) => `/unban [${String(ban.id)}]`)
        .slice(0, 8);
    return (catalog.commands ?? BASE_COMMANDS).slice(0, 8);
  }, [catalog, command, detail]);

  const resolveTarget = async (targetText?: string) => {
    if (!targetText) {
      if (!selected) throw new Error("Select a player first or add their username/email.");
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
    if (matches.length === 1) return matches[0];
    throw new Error(
      matches.length ? "That player name is ambiguous." : "Player not found.",
    );
  };

  const executeCommand = async (event: FormEvent) => {
    event.preventDefault();
    if (!isMainAdmin) return;
    setCommandBusy(true);
    setStatus("");
    try {
      const parsed = parseCommand(command);
      const target = await resolveTarget(parsed.targetText);
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
      if (error) throw new Error(error.message);
      const result = data as { ok?: boolean; error?: string } | null;
      if (!result?.ok) throw new Error(result?.error || "Command was rejected.");
      setStatus(`${parsed.action.toUpperCase()} completed for ${target.username || target.email}.`);
      setCommand("");
      await choosePlayer(target);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Command failed.");
    } finally {
      setCommandBusy(false);
    }
  };

  const account = detail?.account ?? {};
  const displayName =
    String(detail?.profile?.username ?? selected?.username ?? "NO USERNAME");

  return (
    <div className="player-editor">
      <form className="player-search" onSubmit={runSearch}>
        <label htmlFor="admin-player-search">SEARCH USERNAME OR EMAIL</label>
        <div>
          <input
            id="admin-player-search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="tedmils or player@email.com"
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

      {selected && (
        <>
          <header className="player-editor-selected">
            <div>
              <small>SELECTED PLAYER</small>
              <h3>{displayName}</h3>
              <span>{String(account.email ?? selected.email)}</span>
            </div>
            <code>{selected.user_id}</code>
          </header>

          {isMainAdmin && (
            <section className="command-console">
              <header>
                <div>
                  <small>MAIN ADMIN ONLY</small>
                  <h3>PLAYER COMMANDS</h3>
                </div>
                <span>SELECTED PLAYER IS THE DEFAULT TARGET</span>
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
                    onClick={() => setCommand(suggestion)}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
              <form onSubmit={executeCommand}>
                <span aria-hidden="true">&gt;</span>
                <input
                  aria-describedby="admin-player-command-help"
                  aria-label="Admin player command"
                  value={command}
                  onChange={(event) => setCommand(event.target.value)}
                  placeholder="/grant cosmetic [Dark Caves]"
                  spellCheck={false}
                  autoComplete="off"
                />
                <button disabled={commandBusy || !command.trim()}>
                  {commandBusy ? "RUNNING…" : "RUN"}
                </button>
              </form>
              <p id="admin-player-command-help">
                Use brackets around exact item names. Ban durations must go from
                largest to smallest. Commands are validated actions, never SQL.
              </p>
            </section>
          )}

          {loadingDetail ? (
            <div className="player-editor-empty">Loading every player record…</div>
          ) : (
            <div className="player-editor-sections">
              <details open>
                <summary>ACCOUNT + PROFILE</summary>
                <FieldGrid value={{ ...account, ...(detail?.profile ?? {}) }} />
              </details>
              <details open>
                <summary>STATS + LOADOUT</summary>
                <FieldGrid value={{ ...(detail?.stats ?? {}), ...(detail?.loadout ?? {}) }} />
              </details>
              <details>
                <summary>UNLOCKS ({detail?.unlocks?.length ?? 0})</summary>
                <RecordList rows={detail?.unlocks} empty="No unlocked items." />
              </details>
              <details>
                <summary>DEVICES ({detail?.devices?.length ?? 0})</summary>
                <RecordList rows={detail?.devices} empty="No registered devices." />
              </details>
              <details open>
                <summary>BAN HISTORY ({detail?.bans?.length ?? 0})</summary>
                <RecordList rows={detail?.bans} empty="No ban records." />
              </details>
              <details>
                <summary>REPORTS ({detail?.reports?.length ?? 0})</summary>
                <RecordList rows={detail?.reports} empty="No reports." />
              </details>
              <details>
                <summary>MULTIPLAYER</summary>
                <FieldGrid value={detail?.multiplayer} />
              </details>
              <details>
                <summary>SHOP RECEIPTS ({detail?.extractions?.length ?? 0})</summary>
                <RecordList rows={detail?.extractions} empty="No recorded box receipts." />
              </details>
            </div>
          )}
        </>
      )}
    </div>
  );
}
