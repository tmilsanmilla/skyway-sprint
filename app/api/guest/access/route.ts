import { createHmac } from "node:crypto";
import { NextResponse } from "next/server";
import { neonServerSql } from "@/lib/neon-server";
import {
  preAuthNetworkBucket,
  preAuthRateLimitSecret,
  trustedRequestNetworkIdentity,
} from "@/lib/pre-auth-network";
import { isSameOriginRequest } from "@/lib/neon-auth-request-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEVICE_TOKEN_PATTERN = /^[A-Za-z0-9._~+/=-]{24,128}$/;

type GuestAccessResult = {
  rate_limited?: boolean;
  access?: unknown;
};

const deviceRateLimitBucket = (secret: string, value: string) =>
  createHmac("sha256", secret)
    .update(`skyway-guest-access:device\0${value}`)
    .digest("hex");

export async function POST(request: Request) {
  if (!isSameOriginRequest(request))
    return NextResponse.json({ error: "Request origin rejected." }, { status: 403 });
  if (!neonServerSql)
    return NextResponse.json(
      { error: "Game database is not configured." },
      { status: 503 },
    );

  let deviceToken = "";
  try {
    const body = (await request.json()) as { deviceToken?: unknown };
    if (typeof body.deviceToken === "string") deviceToken = body.deviceToken;
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  if (!DEVICE_TOKEN_PATTERN.test(deviceToken))
    return NextResponse.json({ error: "Invalid device token." }, { status: 400 });

  const secret = preAuthRateLimitSecret();
  const networkIdentity = trustedRequestNetworkIdentity(request);
  if (!secret || !networkIdentity)
    return NextResponse.json(
      { error: "Access check is temporarily unavailable." },
      { status: 503 },
    );
  const networkBucket = preAuthNetworkBucket(secret, networkIdentity);
  const deviceBucket = deviceRateLimitBucket(secret, deviceToken);

  try {
    const rows = await neonServerSql`
      select app_private.check_guest_device(
        ${deviceToken}::text,
        ${networkBucket}::text,
        ${deviceBucket}::text
      ) as result
    `;
    const result = (rows[0]?.result ?? null) as GuestAccessResult | null;
    if (result?.rate_limited)
      return NextResponse.json(
        { error: "Too many access checks. Try again shortly." },
        { status: 429, headers: { "Retry-After": "60" } },
      );
    return NextResponse.json(
      { access: result?.access ?? null },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "Access check is temporarily unavailable." },
      { status: 503 },
    );
  }
}
