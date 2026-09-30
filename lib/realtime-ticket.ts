import "server-only";

import { createHmac, randomUUID } from "node:crypto";
import {
  REALTIME_CONNECT_TICKET_TTL_SECONDS,
  REALTIME_SESSION_TTL_SECONDS,
} from "@/lib/realtime-session";

type RealtimeTicketInput = {
  userId: string;
  matchId: string;
  slot: 1 | 2;
  origin: string;
  clientInstanceId: string;
};

const encode = (value: string) => Buffer.from(value).toString("base64url");

export const createRealtimeTicket = (input: RealtimeTicketInput) => {
  const secret = process.env.REALTIME_TICKET_SECRET?.trim();
  if (!secret || secret.length < 32) return null;
  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + REALTIME_CONNECT_TICKET_TTL_SECONDS;
  const sessionExpiresAt = issuedAt + REALTIME_SESSION_TTL_SECONDS;
  const body = encode(
    JSON.stringify({
      v: 1,
      sub: input.userId,
      matchId: input.matchId,
      slot: input.slot,
      origin: input.origin,
      clientInstanceId: input.clientInstanceId,
      jti: randomUUID().replaceAll("-", ""),
      iat: issuedAt,
      exp: expiresAt,
      sessionExp: sessionExpiresAt,
    }),
  );
  const signature = createHmac("sha256", secret)
    .update(body)
    .digest("base64url");
  return {
    ticket: `${body}.${signature}`,
    expiresAt,
    sessionExpiresAt,
  };
};

export const createTurnUsageTag = (userId: string) => {
  const secret = process.env.REALTIME_TICKET_SECRET?.trim();
  if (!secret || secret.length < 32) return null;
  const digest = createHmac("sha256", secret)
    .update(`skyway-turn-user\0${userId}`)
    .digest("hex")
    .slice(0, 32);
  return `skyway-${digest}`;
};
