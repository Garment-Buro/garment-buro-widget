import "server-only";

import { createSign } from "crypto";
import { readFile } from "fs/promises";

type ServiceAccountCredentials = {
  client_email?: string;
  private_key?: string;
};

type CachedToken = {
  token: string;
  expiresAt: number;
};

const tokenCache = new Map<string, CachedToken>();

export async function getGoogleAccessToken(scopes: string[]): Promise<string> {
  const normalizedScopes = [...new Set(scopes)].sort();
  const cacheKey = normalizedScopes.join(" ");
  const cached = tokenCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;

  const credentials = await getServiceAccountCredentials();
  if (!credentials.client_email || !credentials.private_key) {
    throw new Error("Google service-account credentials are not configured");
  }

  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64Url(JSON.stringify({
    iss: credentials.client_email,
    scope: cacheKey,
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now
  }));
  const unsigned = `${header}.${claim}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(credentials.private_key, "base64url");
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${signature}`
    }),
    cache: "no-store"
  });

  if (!response.ok) {
    throw new Error(`Google token request failed: ${response.status} ${response.statusText}`);
  }
  const payload = (await response.json()) as { access_token?: string; expires_in?: number };
  if (!payload.access_token) throw new Error("Google token response contains no access_token");
  tokenCache.set(cacheKey, {
    token: payload.access_token,
    expiresAt: Date.now() + (payload.expires_in || 3600) * 1000
  });
  return payload.access_token;
}

export async function googleApiFetch(
  url: string,
  scopes: string[],
  init: RequestInit = {}
): Promise<Response> {
  const token = await getGoogleAccessToken(scopes);
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  return fetch(url, { ...init, headers, cache: "no-store" });
}

async function getServiceAccountCredentials(): Promise<ServiceAccountCredentials> {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    const file = await readFile(process.env.GOOGLE_APPLICATION_CREDENTIALS, "utf8");
    return JSON.parse(file) as ServiceAccountCredentials;
  }

  return {
    client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n")
  };
}

function base64Url(value: string): string {
  return Buffer.from(value).toString("base64url");
}
