import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import WebSocket from "ws";

const secret = "local-test-ticket-secret-0123456789abcdef";
const matchId = "8f1f3083-30f2-4085-a5a7-4edc0bfd7046";
const origin = "http://localhost:3000";

const encode = (value) => Buffer.from(value).toString("base64url");
const ticket = (slot, sub, sessionTtlSeconds = 15 * 60) => {
  const now = Math.floor(Date.now() / 1000);
  const connectTtlSeconds = Math.min(60, sessionTtlSeconds);
  const body = encode(
    JSON.stringify({
      v: 1,
      sub,
      matchId,
      slot,
      origin,
      clientInstanceId: `client_instance_${slot}`,
      jti: `ticket_${slot}_${Date.now()}`,
      iat: now,
      exp: now + connectTtlSeconds,
      sessionExp: now + sessionTtlSeconds,
    }),
  );
  const signature = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${signature}`;
};

const connect = (slot, sub, sessionTtlSeconds = 15 * 60) =>
  new Promise((resolve, reject) => {
    const socket = new WebSocket(
      `ws://localhost:8787/v1/matches/${matchId}/connect?ticket=${encodeURIComponent(ticket(slot, sub, sessionTtlSeconds))}`,
      { origin },
    );
    const messages = [];
    socket.on("message", (raw) => {
      const message = JSON.parse(String(raw));
      messages.push(message);
      if (message.type === "welcome") resolve({ socket, messages });
    });
    socket.on("error", reject);
  });

const playerOne = await connect(1, "2643716b-0dca-4c11-9223-c4ca50ad5932");
const playerTwo = await connect(2, "64cc241e-e96f-4b57-9294-c41d94bd1130");

const relayed = new Promise((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error("relay timeout")), 2_000);
  playerTwo.socket.on("message", (raw) => {
    const message = JSON.parse(String(raw));
    if (message.type !== "signal") return;
    clearTimeout(timeout);
    resolve(message);
  });
});

playerOne.socket.send(
  JSON.stringify({
    v: 1,
    type: "signal",
    kind: "offer",
    negotiationId: "negotiation_1",
    sdp: "v=0\r\n",
  }),
);

const message = await relayed;
assert.equal(message.kind, "offer");
assert.equal(message.fromSlot, 1);
assert.equal(playerOne.messages[0].initiator, true);
assert.equal(playerTwo.messages[0].initiator, false);

playerOne.socket.send(JSON.stringify({ v: 1, type: "leave", reason: "home" }));
playerTwo.socket.send(JSON.stringify({ v: 1, type: "leave", reason: "home" }));
await new Promise((resolve) => setTimeout(resolve, 50));

const expiring = await connect(
  1,
  "2643716b-0dca-4c11-9223-c4ca50ad5932",
  2,
);
assert.ok(
  expiring.messages[0].sessionExpiresAt * 1_000 <= Date.now() + 2_000,
);
const sessionClose = new Promise((resolve, reject) => {
  const expiryProbe = setTimeout(() => {
    if (expiring.socket.readyState === WebSocket.CLOSING) {
      clearTimeout(timeout);
      expiring.socket.terminate();
      resolve({ state: "closing" });
      return;
    }
    expiring.socket.send(
      JSON.stringify({ v: 1, type: "ping", seq: 1 }),
    );
  }, 2_500);
  const timeout = setTimeout(
    () => reject(new Error("session expiry timeout")),
    7_000,
  );
  expiring.socket.on("close", (code) => {
    clearTimeout(expiryProbe);
    clearTimeout(timeout);
    resolve({ state: "closed", code });
  });
});
const sessionResult = await sessionClose;
if (sessionResult.state === "closed") assert.equal(sessionResult.code, 4009);

console.log("Cloudflare signaling smoke test passed.");
