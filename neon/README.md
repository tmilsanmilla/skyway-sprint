# Skyway Sprint on Neon

## Mastery follow-up (Update 2.4)

After the installed Update 2.3 release, apply only
`update-2-3-mastery-management.sql` for this follow-up. Do not replay the full
bundle or any XP reset. It adds a private replay flag and updates five existing
functions; current account data and endpoint permissions remain unchanged.

Main admins can prepare `/grant mastery [Dash] username` or
`/revoke mastery [Dash] username` in the player editor. The player must own the
character first. The existing role check, in-game command protection and audit
record still apply. A revoke keeps purchased quests and their progress.

Completed trials may be replayed for practice. The server marks replay sessions
nonrewarding, and repeat completion cannot change mastery/flair switches or
award XP, currency or scores. The quest tracker shows a throttled local preview
and the last saved progress separately, while the saved profile alone controls
unlock and gameplay permissions.

Unlimited's mode criterion uses current Ranked and Photon Fury ownership,
including earlier purchases; level and collection requirements are unchanged.
Partial XP responses include the current ownership flags, and omitted flags no
longer remove an unlock from the same player's screen. No new purchases or
backfill/reset of real player data is needed.

## Update 2.3 coordinated release

Apply these sources together, in order, after auditing the current installed
functions. They are not a new database import and must not be combined with
historical account migrations or old progression resets.

1. `update-2-3-duel-access.sql`
2. `update-2-3-economy.sql`
3. `update-2-3-duel-modes.sql`
4. `update-2-3-gem-streak.sql`
5. `update-2-3-masteries.sql`
6. `update-2-3-health.sql`
7. `update-2-3-guard.sql`
8. `update-2-3-smoke.sql`
9. `update-2-3-admin.sql`

The separately approved `update-2-3-profile-access.sql` repairs native username
onboarding after those migrations. It changes no profile or managed Auth rows
during installation. The existing exact own-row SELECT policy is checked before
granting three named read columns; pre-existing table-level own-row SELECT is
retained, not newly granted or revoked. The setter uses the signed-in identity,
transaction locks and a server-clock 720-hour rename limit. First choices and
canonical no-ops do not consume a rename. Linked names remain Pixel-managed.
There is no direct profile write grant or anonymous setter access.

After SQL application, use the existing Data API's **Refresh schema cache**
control in Neon. Managed Data API routing did not pick up the new functions
from SQL notification alone during this release. Verify actual signed HTTP
calls after refreshing, not only that the functions exist in PostgreSQL.

The release resets only level/XP for version `20261017`, once. Existing mode
entitlements are retained before resetting XP. Accounts, native credentials,
roles, bans, balances, ownership and results must compare unchanged before
commit. A replay must not reset XP earned after the first application. The
release restores only exact, audited own-match endpoints to signed-in users;
private helpers, global maintenance functions and anonymous access stay closed.

Mastery quests have one active questline, ordered stages, owned-context sessions,
monotonic event receipts, time/rate limits and replay protection. Trials do not
award score, Gems, XP, Photons or leaderboard results. Gameplay remains
client-simulated: these checks do not establish server-authoritative collision
verification. Smoke holds use server time plus active-play heartbeats; Dash
healing consumes a short-lived, single-use eligible block receipt. Actual HP
and damage remain fractional; only ability conditions use half-heart rounding.

Use `node scripts/test-update-2-3-client.mjs`,
`node scripts/test-update-2-3-sql.mjs`, and
`node scripts/test-masteries-sql.mjs` for local regression checks. SQL fixtures
create dedicated temporary PostgreSQL clusters without real credentials or
production account rows. Never run their fixture setup against Neon. A real
signed-in Data API check and production browser check are separate release
requirements, not implied by local fixture success.

The existing character roster is intentionally retained. Unlimited's specified
collection requirements are not silently lowered to compensate for characters
that have not yet been designed. Pixel Pulse activation, auth-provider changes,
Saved SQL Editor copies and historical reset migrations are outside this release.
Snowflakes may be purchased on every non-Terminal map, even where they do not
spawn naturally. Terminal retains no attack coins and no obstacle shop.

## Pixel Pulse shared sign-in

### Production checkpoint — 2026-10-22

`pixel-pulse-03-link-security.sql` and the source-pinned
`pixel-pulse-04-runtime-security.sql` are installed on the existing production
branch. One atomic transaction verified all 76 pre-existing protected tables
and 9,730 rows unchanged. The 92 original player endpoints retain their ACLs
and definer/invoker boundary; managed Auth helpers were not replaced.
The central credential baseline was installed with its existing account rows
unchanged. New first links and the public Pixel button remain OFF pending the
required real live password-confirmation proof. The user declined an interactive
account test; local fixture results must not be presented as that proof.
No account, XP, inventory or score reset and no Saved SQL Editor copy was made.

`pixel-pulse-01-sessions.sql` and `pixel-pulse-02-link.sql` are the installed
baseline, not sufficient activation instructions. The installed
`pixel-pulse-03-link-security.sql` adds sealed, one-use first-link attempts and
short runtime leases without replacing managed Neon passwords. Every first
Link/Create confirms the current Pixel password on Pixel Pulse. Existing game
accounts also require a fresh native Skyway password sign-in, even when their
emails match. The server independently verifies that password with managed
Neon email/password sign-in in an isolated cookie context, then revokes only
its temporary check session. Recent Google/OAuth cookies are not password
proof, and this check cannot switch the browser account. A private one-use
database mark requires the sealed UUID and unchanged credential/session stamps
before a first link may continue. Already-bound Pixel sign-in remains automatic. The mapped game UUID, inventory,
scores, balances, bans and administrator roles are preserved. New Pixel users
receive the normal four starter characters, not the full catalog. Central
administrator roles are never imported. Linked usernames are canonical and
cannot be changed independently on Skyway.

The client uses public authorization-code OIDC with state, nonce and S256 PKCE.
Passwords stay on Pixel Pulse (or Skyway for one-time existing-account proof).
Private local cookies contain random tokens; only hashes are stored in Neon,
with a seven-day maximum and explicit sign-out revocation. A cookie alone is
not current database authority. A signed central credential-status response
limits each database token and stored lease to at most 30 seconds for the
mapped game UUID and fixed `authenticated` role. A changed credential version
retires old sessions before optional profile synchronization. An invalid Pixel
cookie never falls back to a native session.
Register Skyway's dedicated public verification key for this Neon branch only,
using the Skyway audience and the existing managed Data API configuration.
Pixel tokens include both the native Neon audience and Skyway audience.
The installed application-owned RPC/RLS guard rejects native runtime access for
linked accounts while preserving native credentials for ownership proof.
It never overwrites managed `auth.uid()` or `auth.jwt()`. New realtime tickets
also require current admission; already-established signaling/WebRTC transport
does not promise immediate disconnection on a central password change.

Required deployment settings: `PIXEL_PULSE_GAME_SIGNING_KEY` (private RSA JWK,
server secret), `PIXEL_PULSE_ENABLED=true`, and
`NEXT_PUBLIC_PIXEL_PULSE_ENABLED=true`. Do not enable the flags until the
registered callback, actual database migrations and both API token classes
pass. Production callback is
`https://skyway-sprint.vercel.app/api/pixel-pulse/callback`, client
`skyway-sprint`. Central Link/Create entry is `/connect/pixel-pulse`.
No Saved SQL Editor copies or account resets are needed.

Activation is blocked until the actual database and live protocol checks pass:

1. Export `runtime-guard-preflight.sql` from the exact current Skyway branch.
   Review its callable-function hashes, privileges and actual native issuer;
   generate the pinned runtime migration with `scripts/runtime-guard-generator.mjs`.
   Never substitute a stale local fixture export or replay historical resets.
2. Verify Pixel Pulse's actual managed schema, application-role permissions and
   native session timestamps with its narrow credential preflight. Apply only
   its additive private baseline and fresh-link migrations.
3. Apply SQL03 and the reviewed runtime guard, read them back, refresh the Data
   API schema, and verify protected account/game data is unchanged.
4. Test real signed Native/Pixel tokens against Data API, first Link/Create,
   wrong password/cancel/replay, returning-cookie sign-in, credential changes,
   cross-account isolation, sign-out and same-ID progress/admin preservation.
5. Publish only the tested source and deliberately enable Skyway's central
   runtime/link gates and both game flags. Other consumers/shared-edit gates
   remain unchanged. Verify the exact Ready commit and actual public flows.

Local-only checks: `node --test app/*.test.mjs`,
`node scripts/test-pixel-link-security.mjs`, and
`node scripts/test-pixel-runtime-guard.mjs`. The SQL suites create and clean
only unique owned fixture resources on local PostgreSQL; they are not proof
of production Managed Auth or Data API behavior.

`scripts/test-pixel-db.mjs` is rollback-only. It accepts a
`SKYWAY_TEST_DATABASE_URL` or uses the existing Neon CLI login; set
`NEON_CLI_PATH` when invoking the CLI through Node. Never commit credentials.

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

`character-selection-access.sql` restores the existing signed-in
`set_loadout(text,text)` and `leave_1v1()` endpoints after checking their
own-account, item-ownership and own-match guards. It does not grant direct table writes, anonymous access,
private helpers, or admin roles. Apply it directly to Neon, not merely as an
editor copy. `character-selection.test.sql` tests exact live equip/duel
functions with temporary identity fixtures, and always rolls back.
The client keeps saved Endless selections separate from server-confirmed
1v1 choices and saves a character plus its class in one atomic request.
The repair was applied directly to Neon on 2026-10-11 UTC (October 10 in
America/New_York). Leaving cancels only the caller's queue entry, or forfeits
their active match; it cannot end an unrelated player's match.

`photon-starter.sql` makes Magician the only included Photon Fury character.
The profile, equip and run-start endpoints honor explicit character unlocks
instead of treating the full rules catalog as owned. Stale, unowned selections
fall back to Magician. No accounts, balances, run receipts or unlock rows are
deleted, and public endpoint permissions are unchanged. The Photon HUD and
results show only earned Photons; raw reflection/point counts remain internal
for the unchanged reward calculation. Endless and 1v1 start at 1× base speed
and still add 0.25× each wave.
Applied directly to Neon on 2026-10-11 UTC. The rollback-only
`photon-starter.test.sql` checks locked-character rejection, explicit ownership,
stale selections and guest isolation. Photon profiles and inventory checksums
were unchanged after application.

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

## Update 2.3 coordinated release

The pending client must ship with these migrations, in this order:
`update-2-3-duel-access.sql`, `update-2-3-economy.sql`,
`update-2-3-duel-modes.sql`, `update-2-3-gem-streak.sql`,
`update-2-3-masteries.sql`, `update-2-3-health.sql`,
`update-2-3-guard.sql`, `update-2-3-smoke.sql`, and
`update-2-3-admin.sql`.

Generate the single guarded transaction with
`node scripts/build-update-2-3-release.mjs`. It fingerprints all existing game
tables and the actual managed Auth user/account tables before and after the
migration, failing the transaction if protected data changes. Only the four
XP/progression fields and obsolete XP award amounts are reset, once for registry
version `20261017`. Existing mode access, balances, inventory, accounts, native
credentials, roles, bans, reports and results are preserved. Reapplication must
preserve XP earned after that reset. Saved queries are not runtime state and
are not recreated by this release.

The own-match access repair is pinned to the October 19 installed definitions,
including the newer QOL attack prices/caps and Meadow coin receipts. It never
grants private helpers. The admin dispatcher clones the actual audited wrapper,
retaining its in-game command interception; no command or report clearing is
performed by installation. No coin setter is added.

Mastery trials remain client-simulated gameplay. Own-account receipts, playtime,
event ordering, action rates, ownership and replay checks bound progress but
are not authoritative server collision detection. Online Smoke holds additionally
use server charge time, recent verified active play and a shared per-wave bomb
budget. Dash healing consumes a fresh, single-use server block receipt. Actual
HP remains fractional; only ability conditions use half-heart bands. Remedy has
3 starting HP and 3.5 maximum HP.

`scripts/test-update-2-3-sql.mjs` imports the current read-only schema/function
export into disposable local PostgreSQL, tests the complete transaction and
reapplication, and verifies that deliberate synthetic wallet/account tampering
rolls back. `scripts/test-masteries-sql.mjs` and its `--gem-streak --actions`
variant test quests/trials and the guarded action RPCs. These local test scripts
never connect to Neon, use real account rows, send mail or commit fixtures.
Their fixture SQL is explicitly LOCAL-ONLY and must not be run in production.
