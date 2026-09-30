import { NextResponse } from "next/server";
import {
  isSameOriginRequest,
  verifyNeonRequest,
} from "@/lib/neon-auth-request-server";
import { consumePreAuthNetworkQuota } from "@/lib/pre-auth-rate-limit-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isSameOriginRequest(request))
    return NextResponse.json({ error: "Request origin rejected." }, { status: 403 });
  const preAuthQuota = await consumePreAuthNetworkQuota(request);
  if (preAuthQuota === "rate_limited")
    return NextResponse.json(
      { error: "Too many sign-in checks. Try again shortly." },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  if (preAuthQuota !== "allowed")
    return NextResponse.json(
      { error: "Sign-in check is temporarily unavailable." },
      { status: 503 },
    );

  const verified = await verifyNeonRequest();
  const user = verified?.user;
  if (!user?.id || !user.email)
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  return NextResponse.json({ ok: true, userId: user.id });
}
