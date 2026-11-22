"use client";
import { useState } from "react";
import "./admin-command-documentation.css";

export const ADMIN_COMMAND_DOCUMENTATION = [
  ["/grant character [name] [username]", "Unlock an exact character. Included starters cannot be changed."],
  ["/revoke character [name] [username]", "Revoke that character without deleting the account or its progress."],
  ["/grant cosmetic [name] [username]", "Unlock an exact catalog cosmetic."],
  ["/revoke cosmetic [name] [username]", "Revoke an exact cosmetic and restore its default if equipped."],
  ["/grant mastery [character] [username]", "Grant mastery for an owned supported character."],
  ["/revoke mastery [character] [username]", "Revoke mastery while retaining the purchased questline and progress; the trial must be passed again."],
  ["/resetmastery [username] [character]", "Revoke mastery, remove its questline purchase and reset quest progress. The character remains owned."],
  ["/set gems [amount] [username]", "Set account gems to a non-negative whole number, up to 1,000,000,000."],
  ["/set photons [amount] [username]", "Set photons for a player who owns Photon Fury; a locked mode is unchanged."],
  ["/set stardust [amount] [username]", "Set account stardust to a non-negative whole number, up to 1,000,000,000."],
  ["/set high score [amount] [username]", "Set high score to a non-negative whole number, up to 1,000,000,000,000."],
  ["/check gems [username]", "Read the account gem balance."],
  ["/check photons [username]", "Read photons; returns NULL when Photon Fury is locked."],
  ["/check stardust [username]", "Read the account stardust balance."],
  ["/rpta [username]", "Allow that account to submit problem reports."],
  ["/rptb [username]", "Block that account from submitting problem reports."],
  ["/rptc", "Clear all currently active problem reports."],
  ["/ban [username/email] [minutes]", "Ban the account for whole minutes. Zero means permanent; an optional ban note is shown to the player."],
  ["/unban [username/email]", "Remove that account’s active bans."],
  ["/upfch [username] [character]", "Unlock an exact Photon Fury character; included starters cannot be changed."],
  ["/lpfch [username] [character]", "Revoke a Photon Fury character and safely repair its equipped selection."],
  ["/upfski [username] [character] [tier]", "Unlock a Photon skin: intermediate, pro, ascendant, divine or immortal."],
  ["/lpfski [username] [character] [tier]", "Revoke that exact Photon skin and restore its default if equipped."],
  ["/upfth [username] [theme]", "Unlock an exact Photon theme."],
  ["/lpfth [username] [theme]", "Revoke a Photon theme and restore the default if equipped."],
  ["/upfw [username] [weapon]", "Unlock an exact Photon Fury weapon. Lightsaber is always included and cannot be granted."],
  ["/rpfw [username] [weapon]", "Revoke a Photon Fury weapon, except Lightsaber; an equipped revoked weapon returns to Lightsaber."],
  ["/rejapp", "Reject all pending appeals using each appeal’s existing review rules."],
  ["/accapp", "Accept all pending appeals. Only the original bans captured by each appeal can be revoked."],
  ["/numapp", "Read the number of pending appeals."],
  ["/ownsr [username]", "Return 1 if the account owns Ranked, otherwise 0."],
  ["/elo [username]", "Return NULL without Ranked or during games 0–4; append P for games 5–20; show the rating alone from game 21 onward."],
  ["/numrg [username]", "Read lifetime Ranked games, or NULL when Ranked has not been unlocked."],
] as const;

export function AdminCommandDocumentation() {
  const [query, setQuery] = useState("");
  const matches = ADMIN_COMMAND_DOCUMENTATION.filter(row => row.join(" ").toLowerCase().includes(query.toLowerCase().trim()));
  return <section className="admin-command-documentation">
    <h3>COMMAND REFERENCE</h3>
    <p>Commands are available to main admins. Use brackets around names with spaces. A selected player may replace the username argument where supported. Commands are recorded in the player’s moderation history.</p>
    <label>Find a command<input aria-label="Search command documentation" type="search" value={query} onChange={event => setQuery(event.target.value)} /></label>
    <dl>{matches.map(([syntax, description]) => <div key={syntax}><dt><code>{syntax}</code></dt><dd>{description}</dd></div>)}</dl>
    {matches.length === 0 && <p>No matching commands.</p>}
  </section>;
}
