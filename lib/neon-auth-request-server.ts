import "server-only";

import { neonAuth } from "@/lib/neon-auth-server";
import { getPixelSession } from "@/lib/pixel-pulse-server";

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
  const { data, error } = await neonAuth.getSession();
  if (error || !data?.user?.id || !data.user.email) return null;
  return { user: data.user, session: data.session };
};
