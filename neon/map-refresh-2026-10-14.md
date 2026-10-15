# Map Refresh · 2026-10-14

This release updates the existing `odd-unit-44587143` project,
`br-holy-math-axs9gjmb` branch, `neondb` database. It does not reinstall Neon,
replace authentication, enable Pixel Pulse, or recreate Saved editor queries.

## Apply in this order

1. `qol-maps.sql`
2. `qol-armory.sql`
3. `qol-map-settlement.sql`
4. `qol-terminal-facing.sql`
5. `qol-ruins-pumpkins.sql`
6. `map-refresh-leaderboards.sql`
7. `qol-photon-01-catalog.sql`
8. `qol-photon-02-profile.sql`
9. `qol-photon-03-runs.sql`
10. `qol-photon-04-box.sql`
11. `qol-extraction.sql`
12. `qol-progression.sql`

For an atomic application, remove only each file's outer `begin;` / `commit;`
and wrap the ordered contents in one transaction. Do not run historical reset
scripts. Check installed definitions first: map patches deliberately reject
unexpected sender definitions instead of guessing how to replace them.

## Destructive change requiring confirmation

The progression migration performs one XP-only reset, fenced by version
`20261014`: all accounts restart at level 0 / 0 XP; historical XP amounts and
XP-breakdown metadata are erased. Only the obsolete XP-only recovery table is
removed if it exists. Receipt IDs remain to prevent replayed rewards. Rerunning
this migration does not erase XP earned after this version was installed.

Accounts, passwords, native identity rows, Gems, inventory, scores, reports,
bans, paid mode unlocks, and non-XP historical results must remain unchanged.
Capture protected-row counts/fingerprints before and after applying it. Do not
publish the matching client until the applied database state is verified.

## Resolved document conflicts

- The final XP rule wins: floor `(R / 1100)^2.2`; cumulative XP is
  `50L² + 350L`, with 400 XP for the first level. Existing physical-Gem
  verified-wave XP remains; 1v1 does not earn XP.
- Casual requires level 5 with no Gem fee. New Ranked unlocks require level 25
  and 100 Gems. New Photon unlocks cost 225 Gems at level 15. Prior paid mode
  entitlements are retained after the reset.
- The explicit Ruins rule disallows Healers, despite the later generic map list.
- Armory formulas take priority over the contradictory example: Snowflake is
  11 + 2p, or 12 + 2p on Skyway. Limits count paid purchases, not free copies.
- Terminal's ordinary Melons gain 50%; attack-coin replacement Melons also gain
  40%, multiplying to 2.1×. Round the final score once.
- Photon Part C retains the prior directly requested 65% themes / 15% Gems /
  20% skin correction, so probabilities sum to 100%. Part-B duplicate skins
  return 10 Gems; Part-C skins/themes and duplicate characters return 5 Gems.
- Unknown remains unavailable: its supplied definition stops mid-sentence.

## Verification boundaries

The test harnesses use a disposable Unix-socket-only local PostgreSQL cluster
and schema/function metadata captured read-only from the installed database.
No real account rows, credentials, remote database URLs or production fixtures
are used by those harnesses. They test migration upgrades/reruns, ownership,
role permissions, reward receipts, wallet changes, map rules and replay guards.

Local browser QA uses actual React components and styles with a synthetic
in-memory adapter outside the release tree. It is not proof of live account
sign-in, production Data API access or a real two-device duel.

Pumpkin collection outcomes are bounded participant receipts; this update does
not claim server-authoritative physics or a complete anti-cheat system.

The verified production baseline is `c38cb36441034eed3fd1fec45b3e6206343121f6`.
The release retains that exact authentication implementation rather than
activating the never-live account-management work already present on GitHub.
Pending authentication source remains preserved in the original local checkout.
The isolated candidate is a normal fast-forward descendant of GitHub's
`d6a5f3ff8276735a368ba96686a22fe697794628`, with game changes applied and the
never-live authentication batch omitted from its final tree. Verify that all
`lib`, `app/api`, `app/connect` and authentication SQL files match production.
