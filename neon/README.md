# Skyway Sprint on Neon

Skyway Sprint uses managed Neon Auth (Neon's managed Better Auth), Neon Data
API for browser database calls, and Cloudflare for live 1v1 signaling. Supabase
is retained only as a rollback copy and is not used by the migrated runtime.

## Safe migration order

1. Enable managed Neon Auth and Neon Data API on an isolated Neon branch.
2. Apply the generated private migration snapshot in this order:
   `01-schema.sql`, `02-data.sql`, `03-finalize.sql`, then
   `04-post-migration.sql`.
3. Apply `bootstrap.sql` and `post-data-api.sql`.
4. Create `skyway_server_runtime` with a generated password by applying
   `create-server-runtime-role.sql` as `neondb_owner`.
5. Configure and test a Vercel preview before changing production.
6. Freeze writes briefly, repeat the data import/checksum audit, then switch
   the production environment and deploy the matching application revision.

The generated snapshot is intentionally ignored by Git because it contains
private account and gameplay data. It excludes the obsolete
`extraction_transactions` pull-history rows, and the migrated shop functions
do not recreate them.

## Runtime settings

- `NEON_AUTH_BASE_URL`: managed Neon Auth endpoint.
- `NEON_AUTH_COOKIE_SECRET`: a unique, randomly generated server secret.
- `NEXT_PUBLIC_NEON_DATA_API_URL`: Neon Data API endpoint.
- `NEON_SERVER_DATABASE_URL`: connection string for the restricted
  `skyway_server_runtime` role, never `neondb_owner`.
- `NEXT_PUBLIC_REALTIME_MODE=cloudflare`.
- Existing Cloudflare signaling/TURN and rate-limit secrets remain required.

Imported accounts keep their UUID, email, username, stats, inventory, admin
role, reports, bans, progression, and multiplayer history. Supabase password
hashes are not compatible with managed Neon Auth, so migrated players use
Forgot Password once to set a Neon Auth password. New accounts are provisioned
with starter stats, inventory, and loadout by triggers on `neon_auth.user`.
