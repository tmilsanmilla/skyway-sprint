import "server-only";

import { createNeonAuth } from "@neondatabase/auth/next/server";

const requireServerSetting = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for managed Neon Auth.`);
  return value;
};

export const neonAuth = createNeonAuth({
  baseUrl: requireServerSetting("NEON_AUTH_BASE_URL"),
  cookies: {
    secret: requireServerSetting("NEON_AUTH_COOKIE_SECRET"),
    sessionDataTtl: 300,
    sameSite: "strict",
  },
});
