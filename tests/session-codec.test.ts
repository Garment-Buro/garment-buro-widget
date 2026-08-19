import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createSessionToken, matchesSecret, readSessionToken } from "../lib/auth/session-codec.ts";

const secret = "test-secret-that-is-not-used-outside-tests";
const expiresAt = Date.parse("2030-01-01T00:00:00.000Z");
const now = Date.parse("2029-12-01T00:00:00.000Z");

test("signed web session preserves the canonical employee name", () => {
  const token = createSessionToken("Никита", secret, expiresAt);
  assert.deepEqual(readSessionToken(token, secret, now), { personName: "Никита", expiresAt });
});

test("web session rejects tampering, a wrong secret and expiry", () => {
  const token = createSessionToken("Вера", secret, expiresAt);
  const [payload, signature] = token.split(".");
  const tamperedPayload = Buffer.from(JSON.stringify({ personName: "Костя", exp: expiresAt })).toString("base64url");

  assert.equal(readSessionToken(`${tamperedPayload}.${signature}`, secret, now), null);
  assert.equal(readSessionToken(token, "another-secret", now), null);
  assert.equal(readSessionToken(token, secret, expiresAt), null);
  assert.equal(readSessionToken(`${payload}.${signature}.extra`, secret, now), null);
});

test("workspace access code comparison is exact", () => {
  assert.equal(matchesSecret("shared-code", "shared-code"), true);
  assert.equal(matchesSecret("shared-code", "Shared-code"), false);
  assert.equal(matchesSecret("short", "longer"), false);
});

test("web data and write routes bind requests to the signed employee session", async () => {
  const routePaths = [
    "../app/api/dashboard/route.ts",
    "../app/api/task-command/route.ts",
    "../app/api/notification-ack/route.ts",
    "../app/api/assistant/route.ts"
  ];
  const routes = await Promise.all(routePaths.map((routePath) => readFile(new URL(routePath, import.meta.url), "utf8")));

  routes.forEach((route) => assert.match(route, /getWebSession\(\)/));
  routes.slice(0, 3).forEach((route) => assert.match(route, /getDashboardState\(session\.personName\)/));
  assert.match(routes[3], /answerTaskAssistant\([^;]+session\.personName\)/s);
});
