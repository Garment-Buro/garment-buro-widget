import { createHmac, timingSafeEqual } from "node:crypto";

export type WebSession = {
  personName: string;
  expiresAt: number;
};

type SessionPayload = {
  personName: string;
  exp: number;
};

export function createSessionToken(personName: string, secret: string, expiresAt: number): string {
  const payload = Buffer.from(JSON.stringify({ personName, exp: expiresAt } satisfies SessionPayload)).toString("base64url");
  return `${payload}.${sign(payload, secret)}`;
}

export function readSessionToken(token: string, secret: string, now = Date.now()): WebSession | null {
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra || !secret) return null;

  const expected = sign(payload, secret);
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) return null;

  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<SessionPayload>;
    const personName = String(parsed.personName || "").trim();
    const expiresAt = Number(parsed.exp);
    if (!personName || personName.length > 120 || !Number.isFinite(expiresAt) || expiresAt <= now) return null;
    return { personName, expiresAt };
  } catch {
    return null;
  }
}

export function matchesSecret(candidate: string, expected: string): boolean {
  const candidateBuffer = Buffer.from(candidate);
  const expectedBuffer = Buffer.from(expected);
  return candidateBuffer.length === expectedBuffer.length && timingSafeEqual(candidateBuffer, expectedBuffer);
}

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}
