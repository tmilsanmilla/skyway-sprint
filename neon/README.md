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

After importing the game functions, apply `account-session-access.sql` and
`admin-session-access.sql`. They restore explicit authenticated startup/tool
permissions, preserve the existing admin role checks, and adapt the two admin
lookup readers to managed Neon Auth field names. Neither repair resets accounts
or grants anyone an admin role. The combined repair is saved in the Neon SQL
Editor as **Sign-in MISC**.

Apply `remove-inventory-flairs.sql` to retire Inventory flairs and their bonuses.
Character unlocks, character abilities, cosmetics, account data, and map weapons
are preserved. Former weapon selections are inert compatibility data, not active
equipment. Supabase is not altered.

Apply `update-17-progression.sql`, then `update-17-photon-points.sql` for the
new XP curve and points-only Photon rewards. The XP migration resets level and
XP once, erases old XP receipt amounts and recovery snapshots, and preserves gems, inventory,
scores, completed-run history, and already-purchased mode access. Rerunning it
does not reset newly-earned XP. Ranked has its own authenticated level-25,
100-gem purchase and does not depend on Photon Fury. Existing run receipts,
Test Mode exclusions, score validation, and account isolation remain in place.
The reward is zero below four points, otherwise `(points - 4)^2 + 1` Photons.
Both changes are saved visibly in **XP and Unlocks MISC** and **Photon Fury MISC**.

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
