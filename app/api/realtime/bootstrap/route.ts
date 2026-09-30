import { NextResponse } from "next/server";
import { neonServerSql } from "@/lib/neon-server";
import {
  createRealtimeTicket,
  createTurnUsageTag,
} from "@/lib/realtime-ticket";
import {
  isSameOriginRequest,
  verifyNeonRequest,
} from "@/lib/neon-auth-request-server";
import { TURN_CREDENTIAL_TTL_SECONDS } from "@/lib/realtime-refresh";
import { consumePreAuthNetworkQuota } from "@/lib/pre-auth-rate-limit-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CLIENT_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const ACTIVE_MATCH_STATUSES = new Set(["countdown", "playing", "intermission"]);

type RealtimeAuthorization = {
  allowed?: boolean;
  reason?: "not_found" | "inactive" | "rate_limited";
  slot?: number;
  status?: string;
};

export async function POST(request: Request) {
  if (!isSameOriginRequest(request))
    return NextResponse.json({ error: "Request origin rejected." }, { status: 403 });
  if (!neonServerSql)
    return NextResponse.json({ error: "Realtime is not configured." }, { status: 503 });

  const preAuthQuota = await consumePreAuthNetworkQuota(request);
  if (preAuthQuota === "rate_limited")
    return NextResponse.json(
      { error: "Too many sign-in checks. Try again shortly." },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  if (preAuthQuota !== "allowed")
    return NextResponse.json(
      { error: "Realtime authorization is temporarily unavailable." },
      { status: 503 },
    );

  const verified = await verifyNeonRequest();
  if (!verified)
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  let matchId = "";
  let clientInstanceId = "";
  try {
    const body = (await request.json()) as Record<string, unknown>;
    if (typeof body.matchId === "string") matchId = body.matchId;
    if (typeof body.clientInstanceId === "string")
      clientInstanceId = body.clientInstanceId;
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  if (!UUID_PATTERN.test(matchId) || !CLIENT_ID_PATTERN.test(clientInstanceId))
    return NextResponse.json({ error: "Invalid match request." }, { status: 400 });

  let authorization: RealtimeAuthorization | null = null;
  try {
    const [row] = await neonServerSql`
      select app_private.authorize_realtime_ticket(
        ${verified.user.id}::uuid,
        ${matchId}::uuid
      ) as authorization
    `;
    authorization = (row?.authorization ?? null) as RealtimeAuthorization | null;
  } catch {
    return NextResponse.json(
      { error: "Realtime authorization is temporarily unavailable." },
      { status: 503 },
    );
  }
  if (authorization?.reason === "rate_limited")
    return NextResponse.json(
      { error: "Too many connection attempts. Try again shortly." },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  if (authorization?.reason === "inactive")
    return NextResponse.json(
      { error: "This 1v1 is no longer active." },
      { status: 409 },
    );
  const slot = authorization?.slot;
  if (
    authorization?.allowed !== true ||
    (slot !== 1 && slot !== 2) ||
    !authorization.status ||
    !ACTIVE_MATCH_STATUSES.has(authorization.status)
  )
    return NextResponse.json({ error: "Match not found." }, { status: 404 });

  const origin = request.headers.get("origin") || new URL(request.url).origin;
  const signed = createRealtimeTicket({
    userId: verified.user.id,
    matchId,
    slot,
    origin,
    clientInstanceId,
  });
  const signalingUrl = process.env.NEXT_PUBLIC_1V1_SIGNALING_URL?.trim();
  const turnKeyId = process.env.CLOUDFLARE_TURN_KEY_ID?.trim();
  const turnApiToken = process.env.CLOUDFLARE_TURN_API_TOKEN?.trim();
  if (!signed || !signalingUrl)
    return NextResponse.json({ error: "Realtime is not configured." }, { status: 503 });

  const turnIssuedAt = Math.floor(Date.now() / 1_000);
  let iceServers: RTCIceServer[] = [
    { urls: ["stun:stun.cloudflare.com:3478"] },
  ];

  // Cloudflare STUN is free and unlimited. TURN remains an optional relay for
  // restrictive networks, and is used automatically whenever credentials are
  // configured without making the rest of 1v1 depend on a paid service.
  if (turnKeyId && turnApiToken) {
    const turnUsageTag = createTurnUsageTag(verified.user.id);
    if (!turnUsageTag)
      return NextResponse.json(
        { error: "Realtime is not configured." },
        { status: 503 },
      );
  const turnResponse = await fetch(
    `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(turnKeyId)}/credentials/generate-ice-servers`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${turnApiToken}`,
        "Content-Type": "application/json",
      },
      // Short-lived and pseudonymously tagged so unusual relay usage can be
      // traced to an account without sending an email or raw account UUID.
      body: JSON.stringify({
        ttl: TURN_CREDENTIAL_TTL_SECONDS,
        customIdentifier: turnUsageTag,
      }),
      cache: "no-store",
    },
  );
    if (!turnResponse.ok)
      return NextResponse.json(
        { error: "Realtime relay is unavailable." },
        { status: 503 },
      );
    const turn = (await turnResponse.json()) as { iceServers?: RTCIceServer[] };
    if (!Array.isArray(turn.iceServers) || turn.iceServers.length === 0)
      return NextResponse.json(
        { error: "Realtime relay is unavailable." },
        { status: 503 },
      );
    iceServers = turn.iceServers;
  }

  return NextResponse.json(
    {
      signalingUrl,
      ticket: signed.ticket,
      ticketExpiresAt: signed.expiresAt,
      sessionExpiresAt: signed.sessionExpiresAt,
      iceServers,
      iceServersExpiresAt:
        turnIssuedAt + TURN_CREDENTIAL_TTL_SECONDS,
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
