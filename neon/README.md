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

## Current level display and reset

`progression.sql` is the current canonical **XP and Unlocks MISC** query,
superseding the historical Update 17 progression migration. It keeps the same
XP curve and award formula, resets all players to level 0 / 0 XP once for
version `20261009`, and prevents runs started before that reset from restoring
old XP. Reapplying it does not erase progress earned after the reset.
Accounts, balances, inventory, scores, completed-run receipt IDs, and paid mode
unlocks are preserved. Only the level and a progress bar in broad fifths are
shown to players; exact XP remains server-side progression data.

Applied through the Neon SQL Editor on 2026-10-09 at 20:00 UTC. The transaction
verified that all 8 player rows were reset and protected player data was
unchanged. `VACUUM (ANALYZE) public.player_stats;` completed separately after
commit. This makes dead-tuple space reusable; it does not promise an immediate
decrease in Neon's account-level storage display. `progression.test.sql` is a
rollback-only test for fresh awards, the old-run fence, replay prevention, and
access controls; never commit its fixture changes.

The current query also explicitly grants authenticated players the seven
guarded run-lifecycle RPCs (start, Endless/1v1 heartbeat, Gem claim, streak
reset, and both completion endpoints). These imported functions had no
authenticated execution permission, which blocked signed-in run starts.
Anonymous execution, direct run/stat writes, private reward helpers, and
admin access are not granted. `run-access.test.sql` checks these live ACLs
and exact function bodies with session-local identity fixtures, including
cross-account rejection and duplicate reward prevention. It always rolls
back, and does not replace production authentication.

## Update 18 coordinated shop release

`update-18-extraction-shop.sql` must ship with the matching Update 18 client.
It replaces the two existing shop RPCs, keeps inventory and balances intact,
and changes only Skyway extraction/direct-unlock rules, not Photon Fury.
Normal/Rare/Legendary boxes cost 11/19/27 Gems and require levels 0/10/20.
Category and rarity are independent rolls, with no rarity fallback, duplicate
reroll, unique guarantee, or duplicate refund. Direct purchases allow only
Common/Uncommon/Rare characters and cosmetics, using their separate prices.
No pull-history ledger is created.

The migration is saved visibly as **Extraction Shop MISC**.
Do not activate it ahead of the client: old `regular`/`ten` box requests fail
closed rather than charging new prices under the old menu. At release, apply
the migration and deploy the matching client together. Test it safely by
removing its final `commit;`, appending `update-18-extraction-shop.test.sql`,
and ending the whole transaction with `rollback;`. The test restores all
temporary fixture balances and unlocks and checks Photon data is unchanged.

## Update 19 duels and daily modes

The coordinated release applies these rerunnable migrations in this order:

1. `update-19-retire-test-mode.sql` — **Admin 05 Test Mode**, now retired.
2. `update-19-rotating-modes.sql` — **Game Modes MISC**, daily RNG/Hardcore Duel.
3. `update-19-match-setup.sql` — **Match Setup MISC**, secret 10-second bans,
   4-second map reveal, and a 15-second owned-character picker.
4. `update-19-ranked.sql` — **Multi-device 03 Ranked**, rolling 28-day K,
   final-score bonuses, and the existing mean-1500 ranked normalization.

Each visible saved query is below Neon's 9,000-character history/save limit.
The release preserves accounts, inventory, Gems, lifetime results, and old
Test Mode reward exclusions. No new Test Mode or practice runs can start.
`update-19.test.sql` is a rollback-only fixture suite, not a saved production
migration. It checks setup timing, secret bans, ownership, assigned RNG
characters, Hardcore HP/healing, final scores, permissions, rolling K, and
rating normalization. Never commit its fixture changes.

Updates 18 and 19 were applied together on 2026-10-08 at 23:59 UTC.
The committed transaction verified unchanged player stats, balances, inventory,
profiles, and ranked-result history. All five named saved entries were reopened
and compared with their complete migration sources before application.

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
