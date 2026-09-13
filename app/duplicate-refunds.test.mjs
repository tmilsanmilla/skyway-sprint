import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const EXPECTED_REFUNDS = {
  common: 1,
  uncommon: 1,
  rare: 1,
  epic: 2,
  legendary: 2,
  mythic: 2,
};

function readRefunds(source) {
  const block = source.match(
    /const DUPLICATE_REFUNDS:[\s\S]*?=\s*\{([\s\S]*?)\n\};/,
  );
  assert.ok(block, "the client duplicate refund table must exist");
  return Object.fromEntries(
    [...block[1].matchAll(/(common|uncommon|rare|epic|legendary|mythic):\s*(\d+)/g)].map(
      ([, rarity, amount]) => [rarity, Number(amount)],
    ),
  );
}

test("duplicate refunds stay at one-third or rounded one-half of a pull", async () => {
  const page = await readFile(new URL("./page.tsx", import.meta.url), "utf8");
  assert.deepEqual(readRefunds(page), EXPECTED_REFUNDS);

  const mergedSql = await readFile(
    new URL("../supabase/player_stats.sql", import.meta.url),
    "utf8",
  );
  for (const [rarity, amount] of Object.entries(EXPECTED_REFUNDS)) {
    assert.match(
      mergedSql,
      new RegExp(`when '${rarity}' then ${amount}`),
      `${rarity} must refund ${amount} gem(s) on the server`,
    );
  }
  assert.doesNotMatch(mergedSql, /when 'mythic' then 3/);
});
