"use client";

import { createInternalNeonAuth } from "@neondatabase/auth";
import {
  SupabaseAuthAdapter,
  type SupabaseAuthAdapterInstance,
} from "@neondatabase/auth/vanilla/adapters";
import {
  NeonPostgrestClient,
  fetchWithToken,
} from "@neondatabase/postgrest-js";
import type { Session, SupabaseClient } from "@supabase/supabase-js";

const neonDataApiUrl = process.env.NEXT_PUBLIC_NEON_DATA_API_URL?.trim();
const neonAuthProxyUrl =
  typeof window === "undefined"
    ? "http://localhost/api/auth"
    : new URL("/api/auth", window.location.origin).toString();
const neonAuth = createInternalNeonAuth<SupabaseAuthAdapterInstance>(
  neonAuthProxyUrl,
  {
    adapter: SupabaseAuthAdapter(),
  },
);
const managedAuthClient = neonAuth.adapter;
export const isPixelPulseAvailable =
  process.env.NEXT_PUBLIC_PIXEL_PULSE_ENABLED === "true";
// Public returning sign-in is separate from the still-gated first connection.
// The server accepts only an existing immutable binding on this entry point.
export const isPixelPulseReturnAvailable = true;

const readPixelSession = async (): Promise<Session | null> => {
  const response = await fetch("/api/pixel-pulse/session", {
    cache: "no-store",
    credentials: "same-origin",
  });
  if (!response.ok)
    throw new Error("Pixel Pulse session check is temporarily unavailable.");
  return ((await response.json()) as { session: Session | null }).session;
};
const openPixelAuthorization = async (action: "start" | "return-start" | "confirm-start", intent: "sign-in" | "link" | "create", nativePassword?: string) => {
  const response = await fetch(`/api/pixel-pulse/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ intent, ...(nativePassword === undefined ? {} : { nativePassword }) }),
    cache: "no-store",
  });
  const result = (await response.json()) as { url?: string; error?: string };
  if (!response.ok || !result.url)
    throw new Error(result.error || "Pixel Pulse sign-in could not start.");
  const target = new URL(result.url);
  if (
    target.origin !== "https://pixel-pulse-websites.vercel.app" ||
    target.pathname !== "/api/sso/oauth2/authorize"
  )
    throw new Error("Pixel Pulse returned an invalid sign-in destination.");
  window.location.assign(target.href);
};
export const continueWithPixelPulse = async (intent: "sign-in" | "link" | "create" = "sign-in") =>
  openPixelAuthorization(isPixelPulseAvailable ? "start" : "return-start", intent);
export const confirmWithPixelPulse = async (intent: "link" | "create", nativePassword?: string) =>
  openPixelAuthorization("confirm-start", intent, nativePassword);
// This normal managed Skyway password sign-in keeps the discovered Pixel actor
// while proving the game UUID. It never reads or accepts a Pixel password.
export const signInForPixelLink = (credentials: { email: string; password: string }) =>
  managedAuthClient.signInWithPassword(credentials);
const clearPixelSession = async () => {
  const response = await fetch("/api/pixel-pulse/signout", {
    method: "POST",
    cache: "no-store",
  });
  if (!response.ok)
    throw new Error(
      "Could not finish signing out of Pixel Pulse on this game.",
    );
};
const authOverrides = {
  getSession: async () => {
    const session = await readPixelSession();
    return session
      ? { data: { session }, error: null }
      : managedAuthClient.getSession();
  },
  signOut: async (...args: Parameters<typeof managedAuthClient.signOut>) => {
    await clearPixelSession();
    return managedAuthClient.signOut(...args);
  },
  signInWithPassword: async (
    ...args: Parameters<typeof managedAuthClient.signInWithPassword>
  ) => {
    await clearPixelSession();
    return managedAuthClient.signInWithPassword(...args);
  },
  signUp: async (...args: Parameters<typeof managedAuthClient.signUp>) => {
    await clearPixelSession();
    return managedAuthClient.signUp(...args);
  },
  onAuthStateChange: (
    ...args: Parameters<typeof managedAuthClient.onAuthStateChange>
  ) => {
    let subscribed = true;
    let eventSequence = 0;
    let deliveredPixelUserId: string | null = null;
    const callback = args[0];
    const result = managedAuthClient.onAuthStateChange(
      async (event, session) => {
        const sequence = ++eventSequence;
        try {
          const pixel = await readPixelSession();
          if (subscribed && sequence === eventSequence) {
            // Native refreshes/duplicate notifications must not tear down an
            // active run owned by the same verified Pixel identity.
            const nextEvent = pixel
              ? event === "INITIAL_SESSION"
                ? "INITIAL_SESSION"
                : deliveredPixelUserId === pixel.user.id ? "TOKEN_REFRESHED" : "SIGNED_IN"
              : event;
            deliveredPixelUserId = pixel?.user.id ?? null;
            callback(nextEvent, pixel || session);
          }
        } catch {
          /* Keep the previous verified account during a transient network failure. */
        }
      },
    );
    const unsubscribe = result.data.subscription.unsubscribe.bind(
      result.data.subscription,
    );
    result.data.subscription.unsubscribe = () => {
      subscribed = false;
      unsubscribe();
    };
    return result;
  },
};
const skywayAuthClient = new Proxy(managedAuthClient, {
  get(target, property) {
    if (Object.hasOwn(authOverrides, property))
      return authOverrides[property as keyof typeof authOverrides];
    const value = Reflect.get(target, property);
    return typeof value === "function" ? value.bind(target) : value;
  },
});

type DataSession = {
  userId: string;
  accessToken: string;
  pixelPulse: boolean;
};

let dataSession: DataSession | null = null;
let pixelTokenRefresh: Promise<string | null> | null = null;
let nativeTokenRefresh: { session: DataSession; promise: Promise<string | null> } | null = null;
const jwtClaims = (token: string): { exp?: number; sub?: string } => {
  try {
    return JSON.parse(atob(token.split(".")[1].replaceAll("-", "+").replaceAll("_", "/")));
  } catch {
    return {};
  }
};
const dataToken = async () => {
  const current = dataSession;
  if (!current) return null;
  if (!current.pixelPulse) {
    if ((jwtClaims(current.accessToken).exp ?? 0) > Date.now() / 1000 + 30)
      return current.accessToken;
    if (nativeTokenRefresh?.session !== current) {
      const promise = (async () => {
        const { data, error } = await managedAuthClient.getBetterAuthInstance().token({
          fetchOptions: { headers: { "X-Force-Fetch": "true" } },
        });
        if (dataSession !== current) throw new Error("The signed-in account changed.");
        if (error || !data?.token || data.token.split(".").length !== 3 ||
          jwtClaims(data.token).sub !== current.userId ||
          (jwtClaims(data.token).exp ?? 0) <= Date.now() / 1000)
          throw new Error("Your session could not be refreshed. Please try again.");
        current.accessToken = data.token;
        return current.accessToken;
      })().finally(() => {
        if (nativeTokenRefresh?.session === current) nativeTokenRefresh = null;
      });
      nativeTokenRefresh = { session: current, promise };
    }
    return nativeTokenRefresh.promise;
  }
  let expires = 0;
  try {
    expires = JSON.parse(
      atob(
        current.accessToken
          .split(".")[1]
          .replaceAll("-", "+")
          .replaceAll("_", "/"),
      ),
    ).exp;
  } catch {
    /* Fetch a new, server-verified token. */
  }
  if (expires > Date.now() / 1000 + 5) return current.accessToken;
  if (!pixelTokenRefresh)
    pixelTokenRefresh = (async () => {
      const response = await fetch("/api/pixel-pulse/token", {
        method: "POST",
        cache: "no-store",
      });
      const result = (await response.json()) as {
        token?: string;
        user_id?: string;
      };
      if (
        !response.ok ||
        !result.token ||
        result.user_id !== current.userId ||
        dataSession !== current
      )
        throw new Error(
          "Pixel Pulse session expired or changed. Sign in again.",
        );
      current.accessToken = result.token;
      return result.token;
    })().finally(() => {
      pixelTokenRefresh = null;
    });
  return pixelTokenRefresh;
};

const neonDataClient = neonDataApiUrl
  ? new NeonPostgrestClient({
      dataApiUrl: neonDataApiUrl,
      options: {
        db: { schema: "public" },
        global: {
          fetch: fetchWithToken(dataToken),
        },
      },
    })
  : null;

type DataSurface = Pick<SupabaseClient, "from" | "rpc">;
export type SkywayClient = {
  auth: typeof managedAuthClient;
  channel: SupabaseClient["channel"];
  removeChannel: SupabaseClient["removeChannel"];
} & DataSurface;
export type SkywayRpcClient = Pick<SkywayClient, "rpc">;

const databaseClient = {
  from: (relation: string) => {
    if (!neonDataClient)
      throw new Error("NEXT_PUBLIC_NEON_DATA_API_URL is not configured.");
    return neonDataClient.from(relation);
  },
  rpc: (
    functionName: string,
    args?: Record<string, unknown>,
    options?: Record<string, unknown>,
  ) => {
    if (!neonDataClient)
      return Promise.resolve({
        data: null,
        error: { message: "The Neon game database is not configured." },
      });
    return neonDataClient.rpc(functionName, args, options);
  },
} as unknown as {
  from: (relation: string) => unknown;
  rpc: (
    functionName: string,
    args?: Record<string, unknown>,
    options?: Record<string, unknown>,
  ) => unknown;
};

type RealtimeMutationListener = (
  functionName: string,
  args: Record<string, unknown>,
) => void;
let realtimeMutationListener: RealtimeMutationListener | null = null;

const routedRpc = (
  functionName: string,
  args?: Record<string, unknown>,
  options?: Record<string, unknown>,
) => {
  const result = databaseClient.rpc(functionName, args, options);
  const isOneVOneMutation =
    functionName.includes("1v1") &&
    !functionName.startsWith("get_") &&
    typeof args?.p_match_id === "string";
  if (!isOneVOneMutation) return result;
  return Promise.resolve(result).then((response) => {
    const error =
      response && typeof response === "object" && "error" in response
        ? response.error
        : null;
    if (!error) realtimeMutationListener?.(functionName, args ?? {});
    return response;
  });
};

/**
 * Managed Neon Auth uses the compatibility adapter so the existing game UI can
 * keep its familiar auth method names. All data calls go to Neon Data API;
 * live 1v1 invalidation uses Cloudflare rather than a second database feed.
 */
export const supabase: SkywayClient = {
  auth: skywayAuthClient,
  channel: (() => {
    throw new Error("Supabase Realtime is not available after Neon cutover.");
  }) as SupabaseClient["channel"],
  removeChannel: (() =>
    Promise.resolve("ok")) as SupabaseClient["removeChannel"],
  from: databaseClient.from.bind(databaseClient) as SupabaseClient["from"],
  rpc: routedRpc as SupabaseClient["rpc"],
};

export const isNeonDataEnabled = Boolean(neonDataClient);

export const setDataSession = (
  session: Session | null,
  expectedUserId: string | null = session?.user.id ?? null,
) => {
  if (!session) {
    dataSession = null;
    return expectedUserId === null;
  }
  if (!expectedUserId || session.user.id !== expectedUserId) return false;
  dataSession = {
    userId: expectedUserId,
    accessToken: session.access_token,
    pixelPulse: session.user.app_metadata?.provider === "pixel-pulse",
  };
  return true;
};

export const getDataAccessToken = (expectedUserId?: string | null) => {
  if (expectedUserId !== undefined && dataSession?.userId !== expectedUserId)
    return null;
  return dataSession?.accessToken ?? null;
};

type SignOutDataRevocationOptions = {
  expectedUserId: string | null;
  notifyVersus: boolean;
  timeoutMs?: number;
};

/**
 * Revokes the shared browser Data API credential before returning. When a 1v1
 * leave is needed, only a private snapshot of the departing account's token is
 * kept for one bounded request; no later table/RPC call can reuse it.
 */
export const revokeDataSessionForSignOut = ({
  expectedUserId,
  notifyVersus,
  timeoutMs = 2_500,
}: SignOutDataRevocationOptions): Promise<boolean> => {
  const capturedSession =
    expectedUserId && dataSession?.userId === expectedUserId
      ? { ...dataSession }
      : null;
  dataSession = null;

  if (!notifyVersus || !capturedSession) return Promise.resolve(false);
  const boundedTimeoutMs = Math.max(500, Math.min(5_000, timeoutMs));

  return (async () => {
    const controller = new AbortController();
    const timer = globalThis.setTimeout(
      () => controller.abort(),
      boundedTimeoutMs,
    );
    try {
      if (neonDataApiUrl) {
        const capturedClient = new NeonPostgrestClient({
          dataApiUrl: neonDataApiUrl,
          options: {
            db: { schema: "public" },
            global: {
              fetch: fetchWithToken(async () => capturedSession.accessToken),
            },
          },
        });
        const { error } = await capturedClient
          .rpc("leave_1v1")
          .abortSignal(controller.signal);
        return !error;
      }

      return false;
    } catch {
      return false;
    } finally {
      globalThis.clearTimeout(timer);
    }
  })();
};

export const setRealtimeMutationListener = (
  listener: RealtimeMutationListener | null,
) => {
  realtimeMutationListener = listener;
};

export const ensureNeonCompatibleSession = async (session: Session | null) => {
  if (!session || !neonDataClient) return session;
  if (session.user.app_metadata?.provider === "pixel-pulse") {
    const fresh = await readPixelSession();
    if (!fresh || fresh.user.id !== session.user.id)
      throw new Error("Pixel Pulse session expired or changed. Sign in again.");
    return fresh;
  }
  // The Next.js session cache may contain an opaque Better Auth session token.
  // Data API needs the signed JWT from /token, never that cached session token.
  // The pinned Neon adapter routes /token through its get-session cache. With
  // a warm cache, token() otherwise returns { session, user }, not { token }.
  // Its supported force-fetch header bypasses that cache and is stripped by
  // the adapter before the request reaches our same-origin auth proxy.
  const { data, error } = await managedAuthClient
    .getBetterAuthInstance()
    .token({
      fetchOptions: { headers: { "X-Force-Fetch": "true" } },
    });
  const accessToken = data?.token;
  if (error || !accessToken || accessToken.split(".").length !== 3)
    throw new Error("Could not obtain a Neon database access token.");
  return { ...session, access_token: accessToken };
};

export const changeManagedPassword = async (
  currentPassword: string,
  newPassword: string,
) => {
  const auth = managedAuthClient.getBetterAuthInstance();
  const result = await auth.changePassword({
    currentPassword,
    newPassword,
    revokeOtherSessions: true,
  });
  return {
    error: result.error
      ? { message: result.error.message || "Password update failed." }
      : null,
  };
};

export const completeManagedPasswordReset = async (
  token: string,
  newPassword: string,
) => {
  const auth = managedAuthClient.getBetterAuthInstance();
  const result = await auth.resetPassword({ token, newPassword });
  return {
    error: result.error
      ? { message: result.error.message || "Password reset failed." }
      : null,
  };
};

type BridgeError = { message: string };

export const verifyCurrentNeonSession = async () => {
  if (!neonDataClient) return null;
  let message = "Game database is temporarily unavailable.";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch("/api/account/bootstrap", {
        method: "POST",
        cache: "no-store",
      });
      if (response.ok) return null;
      const payload = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      message = payload?.error || message;
      if (response.status >= 400 && response.status < 500) break;
    } catch {
      // A single retry covers short cold-start or network interruptions.
    }
  }
  return { message } satisfies BridgeError;
};

export const checkGuestDeviceAccess = async (deviceToken: string) => {
  try {
    const response = await fetch("/api/guest/access", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceToken }),
      cache: "no-store",
    });
    const payload = (await response.json().catch(() => null)) as {
      access?: {
        device_banned?: boolean;
        active_bans?: Array<{
          id: number;
          scope: string;
          expires_at: string | null;
          reason: string | null;
        }>;
      } | null;
      error?: string;
    } | null;
    if (!response.ok)
      return {
        data: null,
        error: { message: payload?.error || "Access check failed." },
      };
    return { data: payload?.access ?? null, error: null };
  } catch {
    return {
      data: null,
      error: { message: "Access check is temporarily unavailable." },
    };
  }
};
