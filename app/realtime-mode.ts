export type RealtimeMode = "supabase" | "shadow" | "cloudflare";

type RealtimeModeOptions = {
  configuredMode?: string;
  neonDataApiUrl?: string;
};

/**
 * Neon is the authoritative game database after cutover, so pairing it with
 * Supabase change feeds can deliver stale events from the rollback database.
 * In that configuration every unset, invalid, legacy, or shadow mode fails
 * closed to Cloudflare plus the authoritative Neon polling fallback.
 */
export const resolveRealtimeMode = ({
  configuredMode,
  neonDataApiUrl,
}: RealtimeModeOptions): RealtimeMode => {
  const usesNeonData = Boolean(neonDataApiUrl?.trim());
  if (usesNeonData) return "cloudflare";

  const requestedMode = configuredMode?.trim();
  if (requestedMode === "cloudflare" || requestedMode === "shadow")
    return requestedMode;
  return "supabase";
};
