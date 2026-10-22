import "server-only";

import { neonAuth } from "@/lib/neon-auth-server";
import { getPixelSession } from "@/lib/pixel-pulse-server";
import { neonServerSql } from "@/lib/neon-server";

export const isSameOriginRequest = (request: Request) => {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
};

export const verifyNeonRequest = async () => {
  const pixel = await getPixelSession();
  if (pixel)
    return {
      user: { id: pixel.user_id, email: pixel.email },
      session: { expiresAt: new Date(pixel.expires_at) },
    };
  const { data, error } = await neonAuth.getSession({ query: { disableCookieCache: "true" } });
  if (error || !data?.user?.id || !data.user.email) return null;
  if (!neonServerSql) return null;
  const [admission] = await neonServerSql`select app_private.pixel_native_admission(${data.user.id}::uuid) as allowed`;
  if (admission?.allowed !== true) return null;
  return { user: data.user, session: data.session };
};
