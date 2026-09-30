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

type DataSession = {
  userId: string;
  accessToken: string;
};

let dataSession: DataSession | null = null;

const neonDataClient = neonDataApiUrl
  ? new NeonPostgrestClient({
      dataApiUrl: neonDataApiUrl,
      options: {
        db: { schema: "public" },
        global: {
          fetch: fetchWithToken(async () => dataSession?.accessToken ?? null),
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
  auth: managedAuthClient,
  channel: (() => {
    throw new Error("Supabase Realtime is not available after Neon cutover.");
  }) as SupabaseClient["channel"],
  removeChannel: (() => Promise.resolve("ok")) as SupabaseClient["removeChannel"],
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
  };
  return true;
};

export const getDataAccessToken = (expectedUserId?: string | null) => {
  if (
    expectedUserId !== undefined &&
    dataSession?.userId !== expectedUserId
  )
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
  const accessToken = await neonAuth.getJWTToken();
  if (!accessToken) return session;
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
