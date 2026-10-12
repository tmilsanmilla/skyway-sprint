import type { PixelProfile, PixelManagementOperation, verifyPixelManagementTicket } from "./pixel-pulse-rules.ts";

export type PixelAccountReply = {
  state: "linked" | "link_required" | "create_available" | "verification_required" | "conflict";
  localAccountId?: string;
  profileVersion?: number;
  credentialVersion?: number;
};
export type PixelAccountDependencies = {
  enabled: boolean;
  quota: (request: Request) => Promise<"allowed" | "rate_limited" | "unavailable">;
  verify: (token: string, operation: PixelManagementOperation) => ReturnType<typeof verifyPixelManagementTicket>;
  status: (profile: PixelProfile) => Promise<PixelAccountReply>;
  takeTicket: (jti: string, expiresAt: number) => Promise<boolean>;
  retire: (profile: PixelProfile) => Promise<PixelAccountReply | null>;
  sync: (profile: PixelProfile) => Promise<PixelAccountReply>;
  nativeProof: (email: string, password: string) => Promise<string>;
  bind: (profile: PixelProfile, operation: "link" | "create", nativeUser: string | null) => Promise<PixelAccountReply>;
};
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" } });
async function limitedBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("Invalid request.");
  let text = "", bytes = 0;
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 4096) { await reader.cancel(); throw new Error("Invalid request."); }
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode()) as { operation?: unknown; existingPassword?: unknown };
  } finally { reader.releaseLock(); }
}
// Dependencies are injected for rollback-only fixture tests; production uses only
// the fixed central JWKS, managed native password authority and private Neon RPCs.
export async function handlePixelAccount(request: Request, deps: PixelAccountDependencies) {
  if (request.method !== "POST") return json({ error: "Method not allowed." }, 405);
  if (!deps.enabled) return json({ state: "unavailable" }, 503);
  const token = /^Bearer ([A-Za-z0-9_.-]{1,8192})$/.exec(request.headers.get("authorization") || "")?.[1];
  if (!token || !request.headers.get("content-type")?.startsWith("application/json")) return json({ error: "Invalid account ticket." }, 401);
  const quota = await deps.quota(request);
  if (quota !== "allowed") return json({ state: "unavailable" }, quota === "rate_limited" ? 429 : 503);
  let body: Awaited<ReturnType<typeof limitedBody>>;
  let ticket: Awaited<ReturnType<PixelAccountDependencies["verify"]>>;
  try {
    body = await limitedBody(request);
    if (!body || !["status", "sync", "link", "create"].includes(String(body.operation))) return json({ error: "Invalid operation." }, 400);
    ticket = await deps.verify(token, body.operation as PixelManagementOperation);
  } catch { return json({ error: "Invalid account ticket." }, 401); }
  const p = ticket.profile;
  try {
    if (body.operation === "status") return json(await deps.status(p));
    if (!await deps.takeTicket(ticket.jti, ticket.expiresAt)) return json({ error: "This account ticket expired or was already used." }, 409);
    if (body.operation === "sync") {
      const security = await deps.retire(p);
      if (!security) return json({ state: p.emailVerified ? "conflict" : "verification_required", synced: false }, p.emailVerified ? 409 : 403);
      try { return json({ ...await deps.sync(p), synced: true }); }
      catch (error) {
        const message = error instanceof Error && /^(This Pixel Pulse|This shared username|Your shared email|Choose a different shared|Verify your new email|Link the existing administrator)/.test(error.message)
          ? error.message : "The profile update is pending. Old Pixel sessions have been expired.";
        return json({ ...security, synced: false, securityApplied: true, error: message }, 409);
      }
    }
    if (!p.emailVerified) return json({ state: "verification_required" }, 403);
    let nativeUser: string | null = null;
    if (body.operation === "link") {
      if (typeof body.existingPassword !== "string" || !body.existingPassword || body.existingPassword.length > 1024) return json({ error: "Enter your existing Skyway password." }, 400);
      try { nativeUser = await deps.nativeProof(p.email, body.existingPassword); }
      catch { return json({ error: "Could not verify the existing Skyway account." }, 401); }
    } else if (body.existingPassword !== undefined) return json({ error: "A new linked account does not need a game password." }, 400);
    const result = await deps.bind(p, body.operation === "link" ? "link" : "create", nativeUser);
    return json({ ...result, message: "Linking successful" });
  } catch (error) {
    const message = error instanceof Error && /^(This Pixel Pulse|This Skyway|This shared username|Your shared email|Choose a different shared|Verify your new email|Link the existing administrator|No existing account|This account must)/.test(error.message)
      ? error.message : "Account update could not complete. No accounts were merged.";
    return json({ state: "conflict", error: message }, 409);
  }
}
