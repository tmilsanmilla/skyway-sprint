import { SKYWAY_ORIGIN } from "./pixel-pulse-rules.ts";

// Verify the existing GAME password with its existing authority, never a copied hash.
// The ephemeral verification session is not returned to Pixel or the browser.
export async function verifyNativePixelLinkPassword(
  baseUrl: string,
  email: string,
  password: string,
  request: typeof fetch = fetch,
) {
  const base = new URL(baseUrl);
  if (base.protocol !== "https:" || password.length < 1 || password.length > 1024)
    throw new Error("Existing account proof failed.");
  const response = await request(`${base.href.replace(/\/$/, "")}/sign-in/email`, {
    method: "POST",
    headers: { Origin: SKYWAY_ORIGIN, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
    cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000),
  });
  const cookie = response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  try {
    if (!response.ok) throw new Error("Existing account proof failed.");
    const result = await response.json();
    if (
      typeof result.user?.id !== "string" ||
      !/^[0-9a-f-]{36}$/i.test(result.user.id) ||
      String(result.user.email || "").trim().toLowerCase() !== email
    ) throw new Error("Existing account proof failed.");
    return result.user.id as string;
  } finally {
    if (cookie) {
      const cleared = await request(`${base.href.replace(/\/$/, "")}/sign-out`, {
        method: "POST", headers: { Origin: SKYWAY_ORIGIN, Cookie: cookie, "Content-Type": "application/json" },
        body: "{}", cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000),
      });
      if (!cleared.ok) throw new Error("Existing account proof could not complete. Try again.");
    }
  }
}
