import "server-only";

import { neon } from "@neondatabase/serverless";

const databaseUrl = process.env.NEON_SERVER_DATABASE_URL?.trim();

export const neonServerSql = databaseUrl ? neon(databaseUrl) : null;
