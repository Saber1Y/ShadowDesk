import assert from "node:assert/strict";
import test from "node:test";
import { randomBytes } from "node:crypto";
import {
  MAX_COOKIE_CHUNKS,
  SessionCookieError,
  chunkCookieName,
  openPayload,
  sealPayload,
} from "../lib/session-cookie.ts";

process.env.SHADOWDESK_SESSION_SECRET = "test-secret-that-is-long-enough-0123456789";

const readFrom = (chunks: string[]) => (index: number) => chunks[index];

test("seals and opens a session payload round trip", () => {
  const session = {
    id: "7f9c2d3a-1b4e-4c6f-9d2a-8e5f0b1c7a11",
    accessToken: randomBytes(1500).toString("hex"),
    refreshToken: randomBytes(800).toString("hex"),
    accessTokenExpiresAt: Date.now() + 3_600_000,
    createdAt: Date.now(),
    expiresAt: Date.now() + 604_800_000,
    user: { sub: "party-1", name: "Dealer One" },
  };
  const chunks = sealPayload("canton-session", session);
  assert.ok(chunks.length <= MAX_COOKIE_CHUNKS);
  for (const chunk of chunks) assert.ok(chunk.length <= 3000, "each chunk must fit a cookie");
  assert.deepEqual(openPayload("canton-session", readFrom(chunks)), session);
});

test("splits oversized payloads across numbered chunks", () => {
  const payload = { note: randomBytes(9000).toString("base64url") };
  const chunks = sealPayload("canton-session", payload);
  assert.ok(chunks.length > 1, "expected a multi-chunk payload");
  assert.ok(chunks.length <= MAX_COOKIE_CHUNKS);
  assert.deepEqual(openPayload("canton-session", readFrom(chunks)), payload);
  assert.equal(chunkCookieName("shadowdesk_canton_session", 0), "shadowdesk_canton_session");
  assert.equal(chunkCookieName("shadowdesk_canton_session", 1), "shadowdesk_canton_session_1");
});

test("rejects tampered and truncated payloads", () => {
  const chunks = sealPayload("canton-session", { sub: "party-1" });
  const raw = Buffer.from(chunks[0].slice(3), "base64url");
  raw[raw.length - 5] ^= 0xff;
  const tampered = [`v1.${raw.toString("base64url")}`];
  assert.equal(openPayload("canton-session", readFrom(tampered)), undefined);

  const dropped = (index: number) => (index === 1 ? undefined : chunks[index]);
  if (chunks.length === 1) {
    // Simulate a browser that lost the body of the first chunk.
    assert.equal(openPayload("canton-session", () => undefined), undefined);
  } else {
    assert.equal(openPayload("canton-session", dropped), undefined);
  }
});

test("binds payloads to their purpose so an authz cookie cannot replay as a session", () => {
  const chunks = sealPayload("canton-authz", { state: "abc", codeVerifier: "def" });
  assert.equal(openPayload("canton-session", readFrom(chunks)), undefined);
  const sessionChunks = sealPayload("canton-session", { sub: "party-1" });
  assert.equal(openPayload("canton-authz", readFrom(sessionChunks)), undefined);
});

test("treats a legacy plain cookie value as absent", () => {
  assert.equal(
    openPayload("canton-session", () => "7f9c2d3a-1b4e-4c6f-9d2a-8e5f0b1c7a11"),
    undefined,
  );
});

test("fails loudly when the session secret is not configured", () => {
  const chunks = sealPayload("canton-session", { sub: "party-1" });
  const previous = process.env.SHADOWDESK_SESSION_SECRET;
  try {
    delete process.env.SHADOWDESK_SESSION_SECRET;
    assert.throws(() => sealPayload("canton-session", { sub: "party-1" }), SessionCookieError);
    assert.throws(() => openPayload("canton-session", readFrom(chunks)), SessionCookieError);
  } finally {
    process.env.SHADOWDESK_SESSION_SECRET = previous;
  }
});
