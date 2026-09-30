import assert from "node:assert/strict";
import test from "node:test";

import { resolveRealtimeMode } from "./realtime-mode.ts";

const neonDataApiUrl = "https://example.neon.tech/neondb/rest/v1";

test("Neon data fails closed to Cloudflare when realtime mode is absent", () => {
  assert.equal(resolveRealtimeMode({ neonDataApiUrl }), "cloudflare");
});

test("Neon data never pairs with Supabase realtime for invalid or legacy modes", () => {
  for (const configuredMode of ["supabase", "shadow", "typo", "", "  "])
    assert.equal(
      resolveRealtimeMode({ configuredMode, neonDataApiUrl }),
      "cloudflare",
    );
});

test("legacy Supabase data keeps its existing realtime defaults", () => {
  assert.equal(resolveRealtimeMode({}), "supabase");
  assert.equal(resolveRealtimeMode({ configuredMode: "typo" }), "supabase");
  assert.equal(resolveRealtimeMode({ configuredMode: "shadow" }), "shadow");
  assert.equal(
    resolveRealtimeMode({ configuredMode: "cloudflare" }),
    "cloudflare",
  );
});
