import "server-only";

import { neonAuth } from "@/lib/neon-auth-server";

export const isSameOriginRequest = (request: Request) => {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
};

export const verifyNeonRequest = async () => {
  const { data, error } = await neonAuth.getSession();
  if (error || !data?.user?.id || !data.user.email) return null;
  return { user: data.user, session: data.session };
};
