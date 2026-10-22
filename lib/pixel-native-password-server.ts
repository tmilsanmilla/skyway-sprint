import "server-only";
import { createAuthServer, resolveNeonAuthLogging } from "@neondatabase/auth/server";

// The normal Next.js SDK applies upstream cookies before returning the verified
// UUID. Use the same supported managed authority with an isolated cookie sink
// so this password check cannot switch the browser into another native account.
export async function verifyPixelNativePassword(
  expected: { userId: string; email: string }, password: string, origin: string,
) {
  if (!password || password.length > 128 || !expected.userId || !expected.email)
    throw new Error("Enter your current Skyway password again.");
  const baseUrl = process.env.NEON_AUTH_BASE_URL?.trim();
  const cookieSecret = process.env.NEON_AUTH_COOKIE_SECRET?.trim();
  if (!baseUrl || !cookieSecret) throw new Error("Skyway password verification is temporarily unavailable.");
  const parsedOrigin = new URL(origin);
  if (parsedOrigin.origin !== origin) throw new Error("Invalid Skyway origin.");
  const isolatedCookies = new Map<string, string>();
  const verifier = createAuthServer({
    baseUrl, cookieSecret, sameSite: "strict", sessionDataTtl: 300,
    log: resolveNeonAuthLogging({ logLevel: "silent" }),
    context: () => ({
      getCookies: () => [...isolatedCookies].map(([name, value]) => `${name}=${value}`).join("; "),
      setCookie: (name, value, options) => {
        if (!value || (options.maxAge !== undefined && options.maxAge <= 0)) isolatedCookies.delete(name);
        else isolatedCookies.set(name, value);
      },
      getHeader: () => null, getOrigin: () => origin, getFramework: () => "nextjs",
    }),
  });
  try {
    const { data, error } = await verifier.signIn.email({ email: expected.email, password, rememberMe: false });
    if (error || data?.user?.id !== expected.userId ||
        typeof data.user.email !== "string" || data.user.email.trim().toLowerCase() !== expected.email.trim().toLowerCase())
      throw new Error("Your current Skyway password could not be verified. Try again.");
  } finally {
    try {
      // No incoming browser cookie is ever in this jar. Revoke only the
      // temporary password-check session, whether the returned UUID matched or not.
      if (isolatedCookies.size) {
        const { error } = await verifier.signOut();
        if (error) throw new Error("Skyway password verification could not finish. Try again.");
      }
    } finally { isolatedCookies.clear(); }
  }
  return { userId: expected.userId };
}
