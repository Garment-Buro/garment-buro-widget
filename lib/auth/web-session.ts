import "server-only";

import { cookies } from "next/headers";
import { appBasePath } from "@/lib/base-path";
import { appsScriptConfig } from "@/lib/config";
import { createSessionToken, readSessionToken, type WebSession } from "@/lib/auth/session-codec";

export const webSessionCookie = "gb_widget_session";
const sessionLifetimeMs = 30 * 24 * 60 * 60 * 1_000;

export function getWebSession(): WebSession | null {
  const token = cookies().get(webSessionCookie)?.value || "";
  return readSessionToken(token, sessionSecret());
}

export function setWebSession(personName: string): void {
  const expiresAt = Date.now() + sessionLifetimeMs;
  cookies().set(webSessionCookie, createSessionToken(personName, sessionSecret(), expiresAt), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: appBasePath || "/",
    maxAge: Math.floor(sessionLifetimeMs / 1_000)
  });
}

export function clearWebSession(): void {
  cookies().set(webSessionCookie, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: appBasePath || "/",
    maxAge: 0
  });
}

export function webAccessCode(): string {
  return appsScriptConfig.accessToken.trim();
}

function sessionSecret(): string {
  const secret = process.env.WEB_SESSION_SECRET?.trim() || webAccessCode();
  if (!secret) throw new Error("WEB_SESSION_SECRET или APPS_SCRIPT_ACCESS_TOKEN не настроен.");
  return secret;
}
