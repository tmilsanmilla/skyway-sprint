/// <reference types="@cloudflare/workers-types" />

import { DurableObject } from "cloudflare:workers";
import { isRealtimeTicketTimeWindowValid } from "../../../lib/realtime-session";
import {
  createWorkerSignalQuotaState,
  guardWorkerSignalKind,
  parseWorkerClientMessage,
  type WorkerSignalQuotaState,
} from "./protocol";

interface Env {
  MATCH_ROOMS: DurableObjectNamespace<MatchRoom>;
  REALTIME_TICKET_SECRET?: string;
  ALLOWED_ORIGINS: string;
  ENVIRONMENT: string;
}

type Slot = 1 | 2;

type TicketPayload = {
  v: 1;
  sub: string;
  matchId: string;
  slot: Slot;
  origin: string;
  clientInstanceId: string;
  jti: string;
  iat: number;
  exp: number;
  sessionExp: number;
};

type SocketAttachment = {
  userId: string;
  slot: Slot;
  connectionId: string;
  graceful: boolean;
  rateWindowStartedAt: number;
  rateCount: number;
  sessionExpiresAt: number;
  sessionExpired: boolean;
  signalQuota: WorkerSignalQuotaState;
};

const MATCH_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const RECONNECT_WINDOW_MS = 30_000;
const RATE_WINDOW_MS = 10_000;
const RATE_LIMIT = 120;

const encoder = new TextEncoder();

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });

const decodeBase64Url = (value: string) => {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const decoded = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
};

const isAllowedOrigin = (origin: string, allowedOrigins: string) =>
  allowedOrigins
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .includes(origin);

const isTicketPayload = (value: unknown): value is TicketPayload => {
  if (!value || typeof value !== "object") return false;
  const payload = value as Partial<TicketPayload>;
  return (
    payload.v === 1 &&
    typeof payload.sub === "string" &&
    MATCH_ID_PATTERN.test(payload.matchId ?? "") &&
    (payload.slot === 1 || payload.slot === 2) &&
    typeof payload.origin === "string" &&
    ID_PATTERN.test(payload.clientInstanceId ?? "") &&
    ID_PATTERN.test(payload.jti ?? "") &&
    Number.isInteger(payload.iat) &&
    Number.isInteger(payload.exp) &&
    Number.isInteger(payload.sessionExp)
  );
};

const verifyTicket = async (ticket: string, secret: string) => {
  const [encodedPayload, encodedSignature, extra] = ticket.split(".");
  if (!encodedPayload || !encodedSignature || extra) return null;
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      decodeBase64Url(encodedSignature),
      encoder.encode(encodedPayload),
    );
    if (!valid) return null;
    const payload = JSON.parse(
      new TextDecoder().decode(decodeBase64Url(encodedPayload)),
    ) as unknown;
    if (!isTicketPayload(payload)) return null;
    if (
      !isRealtimeTicketTimeWindowValid({
        issuedAt: payload.iat,
        connectExpiresAt: payload.exp,
        sessionExpiresAt: payload.sessionExp,
      })
    )
      return null;
    return payload;
  } catch {
    return null;
  }
};

const sendJson = (socket: WebSocket, body: unknown) => {
  try {
    socket.send(JSON.stringify(body));
  } catch {
    // The peer may have closed between enumeration and send.
  }
};

export class MatchRoom extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.storage.sql.exec(`
      create table if not exists used_tickets (
        jti text primary key,
        expires_at integer not null
      );
      create table if not exists participants (
        slot integer primary key check (slot in (1, 2)),
        user_id text not null,
        disconnected_until integer
      );
    `);
  }

  private attachment(socket: WebSocket) {
    return socket.deserializeAttachment() as SocketAttachment | null;
  }

  private socketsForSlot(slot: Slot, except?: WebSocket) {
    return this.ctx
      .getWebSockets()
      .filter(
        (socket) => socket !== except && this.attachment(socket)?.slot === slot,
      );
  }

  private notifyOther(slot: Slot, body: unknown, except?: WebSocket) {
    const otherSlot: Slot = slot === 1 ? 2 : 1;
    for (const socket of this.socketsForSlot(otherSlot, except))
      sendJson(socket, body);
  }

  private socketSessionExpiryMs(socket: WebSocket) {
    const attachment = this.attachment(socket);
    if (!attachment || !Number.isInteger(attachment.sessionExpiresAt)) return 0;
    return attachment.sessionExpiresAt * 1_000;
  }

  private closeExpiredSocket(
    socket: WebSocket,
    attachment: SocketAttachment,
    now = Date.now(),
  ) {
    // Once marked expired, every already-queued message is handled as expired
    // too; none may fall through while the close handshake is still pending.
    if (attachment.sessionExpired) return true;
    if (this.socketSessionExpiryMs(socket) > now) return false;
    attachment.sessionExpired = true;
    socket.serializeAttachment(attachment);
    socket.close(4009, "Realtime session expired");
    return true;
  }

  private async scheduleNextAlarm(now = Date.now()) {
    const deadlines: number[] = [];
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = this.attachment(socket);
      const expiry = this.socketSessionExpiryMs(socket);
      if (
        attachment &&
        !attachment.graceful &&
        !attachment.sessionExpired &&
        expiry > now
      )
        deadlines.push(expiry);
    }
    const reconnectDeadlines = [...this.ctx.storage.sql.exec(
      `select disconnected_until as deadline from participants
       where disconnected_until is not null and disconnected_until > ?`,
      now,
    )] as Array<{ deadline: number }>;
    for (const row of reconnectDeadlines) deadlines.push(row.deadline);

    if (deadlines.length === 0) {
      await this.ctx.storage.deleteAlarm();
      return;
    }
    await this.ctx.storage.setAlarm(Math.min(...deadlines));
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket")
      return json({ error: "WebSocket upgrade required." }, 426);

    const userId = request.headers.get("x-skyway-user-id") ?? "";
    const ticketId = request.headers.get("x-skyway-ticket-id") ?? "";
    const slot = Number(request.headers.get("x-skyway-slot"));
    const expiresAt = Number(request.headers.get("x-skyway-ticket-exp"));
    const sessionExpiresAt = Number(
      request.headers.get("x-skyway-session-exp"),
    );
    if (
      !MATCH_ID_PATTERN.test(userId) ||
      !ID_PATTERN.test(ticketId) ||
      (slot !== 1 && slot !== 2) ||
      !Number.isInteger(expiresAt) ||
      !Number.isInteger(sessionExpiresAt)
    )
      return json({ error: "Invalid connection ticket." }, 401);

    const nowSeconds = Math.floor(Date.now() / 1000);
    if (
      expiresAt <= nowSeconds ||
      sessionExpiresAt <= nowSeconds ||
      sessionExpiresAt < expiresAt
    )
      return json({ error: "Connection ticket expired." }, 401);
    this.ctx.storage.sql.exec(
      "delete from used_tickets where expires_at < ?",
      nowSeconds,
    );
    const used = [...this.ctx.storage.sql.exec(
      "select 1 from used_tickets where jti = ? limit 1",
      ticketId,
    )];
    if (used.length > 0)
      return json({ error: "Connection ticket already used." }, 409);

    const participant = [...this.ctx.storage.sql.exec(
      "select user_id from participants where slot = ? limit 1",
      slot,
    )] as Array<{ user_id: string }>;
    if (participant[0] && participant[0].user_id !== userId)
      return json({ error: "Match participant mismatch." }, 403);

    this.ctx.storage.sql.exec(
      "insert into used_tickets (jti, expires_at) values (?, ?)",
      ticketId,
      expiresAt,
    );
    this.ctx.storage.sql.exec(
      `insert into participants (slot, user_id, disconnected_until)
       values (?, ?, null)
       on conflict (slot) do update
       set user_id = excluded.user_id, disconnected_until = null`,
      slot,
      userId,
    );

    for (const socket of this.socketsForSlot(slot))
      socket.close(4001, "Replaced by a newer connection");

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const attachment: SocketAttachment = {
      userId,
      slot: slot as Slot,
      connectionId: crypto.randomUUID(),
      graceful: false,
      rateWindowStartedAt: Date.now(),
      rateCount: 0,
      sessionExpiresAt,
      sessionExpired: false,
      signalQuota: createWorkerSignalQuotaState(),
    };
    server.serializeAttachment(attachment);
    this.ctx.acceptWebSocket(server);

    const peerPresent = this.socketsForSlot(slot === 1 ? 2 : 1).length > 0;
    sendJson(server, {
      v: 1,
      type: "welcome",
      connectionId: attachment.connectionId,
      selfSlot: slot,
      initiator: slot === 1,
      peerPresent,
      serverTimeMs: Date.now(),
      reconnectWindowMs: RECONNECT_WINDOW_MS,
      sessionExpiresAt,
    });
    this.notifyOther(slot as Slot, {
      v: 1,
      type: "peer-status",
      state: "joined",
      peerSlot: slot,
    });

    await this.scheduleNextAlarm();

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(socket: WebSocket, raw: string | ArrayBuffer) {
    const attachment = this.attachment(socket);
    if (!attachment) {
      socket.close(4002, "Missing connection state");
      return;
    }
    const now = Date.now();
    if (this.closeExpiredSocket(socket, attachment, now)) {
      await this.scheduleNextAlarm(now);
      return;
    }
    if (now - attachment.rateWindowStartedAt >= RATE_WINDOW_MS) {
      attachment.rateWindowStartedAt = now;
      attachment.rateCount = 0;
    }
    attachment.rateCount += 1;
    socket.serializeAttachment(attachment);
    if (attachment.rateCount > RATE_LIMIT) {
      socket.close(4008, "Message rate exceeded");
      return;
    }
    if (typeof raw !== "string") {
      socket.close(4003, "Text messages only");
      return;
    }
    const parsed = parseWorkerClientMessage(raw, attachment.slot);
    if (!parsed) {
      sendJson(socket, {
        v: 1,
        type: "error",
        code: "INVALID_MESSAGE",
        message: "Invalid signaling message.",
        retryable: false,
      });
      return;
    }
    const quota = guardWorkerSignalKind(
      attachment.signalQuota ?? createWorkerSignalQuotaState(),
      parsed.quotaKind,
      now,
    );
    attachment.signalQuota = quota.state;
    socket.serializeAttachment(attachment);
    if (!quota.accepted) {
      socket.close(4008, "Signaling message quota exceeded");
      return;
    }
    const message = parsed.message;

    if (message.type === "ping") {
      sendJson(socket, {
        v: 1,
        type: "pong",
        seq: message.seq,
        serverTimeMs: now,
      });
      return;
    }
    if (message.type === "leave") {
      attachment.graceful = true;
      socket.serializeAttachment(attachment);
      this.ctx.storage.sql.exec(
        "delete from participants where slot = ? and user_id = ?",
        attachment.slot,
        attachment.userId,
      );
      this.notifyOther(attachment.slot, {
        v: 1,
        type: "peer-status",
        state: "left",
        peerSlot: attachment.slot,
      });
      socket.close(1000, "Player left");
      await this.scheduleNextAlarm(now);
      return;
    }

    this.notifyOther(attachment.slot, {
      ...message,
      fromSlot: attachment.slot,
    });
  }

  async webSocketClose(
    socket: WebSocket,
    code: number,
    reason: string,
    wasClean: boolean,
  ) {
    const attachment = this.attachment(socket);
    if (!attachment) return;
    if (this.socketsForSlot(attachment.slot, socket).length > 0) {
      await this.scheduleNextAlarm();
      return;
    }
    if (attachment.graceful) {
      await this.scheduleNextAlarm();
      return;
    }

    const deadline = Date.now() + RECONNECT_WINDOW_MS;
    this.ctx.storage.sql.exec(
      `update participants set disconnected_until = ?
       where slot = ? and user_id = ?`,
      deadline,
      attachment.slot,
      attachment.userId,
    );
    await this.scheduleNextAlarm();
    this.notifyOther(attachment.slot, {
      v: 1,
      type: "peer-status",
      state: "reconnecting",
      peerSlot: attachment.slot,
      reconnectDeadlineMs: deadline,
    });
    void code;
    void reason;
    void wasClean;
  }

  async alarm() {
    const now = Date.now();
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = this.attachment(socket);
      if (!attachment) {
        socket.close(4002, "Missing connection state");
        continue;
      }
      this.closeExpiredSocket(socket, attachment, now);
    }
    const expired = [...this.ctx.storage.sql.exec(
      `select slot, user_id from participants
       where disconnected_until is not null and disconnected_until <= ?`,
      now,
    )] as Array<{ slot: Slot; user_id: string }>;
    for (const participant of expired) {
      if (this.socketsForSlot(participant.slot).length > 0) continue;
      this.ctx.storage.sql.exec(
        "delete from participants where slot = ? and user_id = ?",
        participant.slot,
        participant.user_id,
      );
      this.notifyOther(participant.slot, {
        v: 1,
        type: "peer-status",
        state: "left",
        peerSlot: participant.slot,
      });
    }
    await this.scheduleNextAlarm(now);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health")
      return json({ ok: true, service: "skyway-sprint-realtime", env: env.ENVIRONMENT });
    const match = /^\/v1\/matches\/([^/]+)\/connect$/.exec(url.pathname);
    if (!match) return json({ error: "Not found." }, 404);
    if (request.method !== "GET") return json({ error: "Method not allowed." }, 405);
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket")
      return json({ error: "WebSocket upgrade required." }, 426);
    if (!env.REALTIME_TICKET_SECRET || env.REALTIME_TICKET_SECRET.length < 32)
      return json({ error: "Realtime is not configured." }, 503);

    const origin = request.headers.get("origin") ?? "";
    if (!origin || !isAllowedOrigin(origin, env.ALLOWED_ORIGINS))
      return json({ error: "Origin rejected." }, 403);
    const ticket = url.searchParams.get("ticket") ?? "";
    const payload = await verifyTicket(ticket, env.REALTIME_TICKET_SECRET);
    if (
      !payload ||
      payload.matchId !== match[1] ||
      payload.origin !== origin
    )
      return json({ error: "Invalid or expired connection ticket." }, 401);

    const roomId = env.MATCH_ROOMS.idFromName(payload.matchId);
    const room = env.MATCH_ROOMS.get(roomId);
    const headers = new Headers({
      Upgrade: "websocket",
      "x-skyway-user-id": payload.sub,
      "x-skyway-ticket-id": payload.jti,
      "x-skyway-slot": String(payload.slot),
      "x-skyway-ticket-exp": String(payload.exp),
      "x-skyway-session-exp": String(payload.sessionExp),
    });
    return room.fetch(new Request("https://room.internal/connect", { headers }));
  },
} satisfies ExportedHandler<Env>;
