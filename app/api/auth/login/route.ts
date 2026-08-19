import { NextResponse } from "next/server";
import { matchesSecret } from "@/lib/auth/session-codec";
import { setWebSession, webAccessCode } from "@/lib/auth/web-session";
import { getDashboardState } from "@/lib/data";

export const dynamic = "force-dynamic";

const attempts = new Map<string, { count: number; resetAt: number }>();
const attemptWindowMs = 5 * 60_000;
const maxAttempts = 8;

export async function POST(request: Request) {
  const clientKey = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip")?.trim()
    || "unknown";
  if (isRateLimited(clientKey)) {
    return NextResponse.json({ error: "Слишком много попыток. Подождите несколько минут." }, { status: 429 });
  }

  try {
    const body = await request.json() as { personName?: unknown; accessCode?: unknown };
    const personName = String(body.personName || "").trim();
    const accessCode = String(body.accessCode || "");
    if (personName.length < 2 || personName.length > 120 || accessCode.length < 8 || accessCode.length > 512) {
      registerFailure(clientKey);
      return NextResponse.json({ error: "Проверьте имя и код доступа." }, { status: 400 });
    }

    const expectedCode = webAccessCode();
    if (!expectedCode || !matchesSecret(accessCode, expectedCode)) {
      registerFailure(clientKey);
      return NextResponse.json({ error: "Имя или код доступа не приняты." }, { status: 401 });
    }

    const dashboard = await getDashboardState(personName);
    if (!dashboard.person || !dashboard.person.active) {
      registerFailure(clientKey);
      return NextResponse.json({ error: `Сотрудник «${personName}» не найден в активных профилях PEOPLE.` }, { status: 404 });
    }

    attempts.delete(clientKey);
    setWebSession(dashboard.person.name);
    return NextResponse.json({ ok: true, person: { id: dashboard.person.id, name: dashboard.person.name } }, {
      headers: { "Cache-Control": "no-store" }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось подключить рабочее пространство.";
    return NextResponse.json({ error: message }, { status: 503 });
  }
}

function isRateLimited(key: string): boolean {
  const current = attempts.get(key);
  if (!current) return false;
  if (current.resetAt <= Date.now()) {
    attempts.delete(key);
    return false;
  }
  return current.count >= maxAttempts;
}

function registerFailure(key: string): void {
  const current = attempts.get(key);
  if (!current || current.resetAt <= Date.now()) {
    attempts.set(key, { count: 1, resetAt: Date.now() + attemptWindowMs });
    return;
  }
  current.count += 1;
}
