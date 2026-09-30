import "server-only";

import { createClient, type User } from "@supabase/supabase-js";

export const isSameOriginRequest = (request: Request) => {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
};

export const verifySupabaseRequest = async (
  request: Request,
): Promise<{ user: User; accessToken: string } | null> => {
  const authorization = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  if (!match) return null;

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    },
  );
  const { data, error } = await supabase.auth.getUser(match[1]);
  if (error || !data.user) return null;
  return { user: data.user, accessToken: match[1] };
};
