import { NextResponse } from "next/server";
import { appsScriptConfig } from "@/lib/config";
import type { TaskActionSaveResult, TaskCommandIntent } from "@/lib/services/task-action-service";

export const dynamic = "force-dynamic";

const intents = new Set<TaskCommandIntent>([
  "accept",
  "reject",
  "stuck",
  "waiting",
  "fact",
  "done",
  "session_start",
  "session_close"
]);

export async function POST(request: Request) {
  try {
    if (!appsScriptConfig.webAppUrl || !appsScriptConfig.accessToken) {
      throw new Error("Apps Script write-gateway не настроен.");
    }
    const body = await request.json() as Record<string, unknown>;
    const taskId = String(body.taskId || "").trim();
    const commandId = String(body.commandId || "").trim();
    const intent = String(body.intent || "") as TaskCommandIntent;
    const details = body.details as { note?: unknown } | undefined;
    const note = String(details?.note || "").trim();

    if (!taskId || !commandId || !intents.has(intent)) {
      return NextResponse.json({ error: "Некорректная команда задачи." }, { status: 400 });
    }
    if (["reject", "stuck", "waiting", "fact", "done", "session_close"].includes(intent) && !note) {
      return NextResponse.json({ error: "Добавьте короткий комментарий для GPT." }, { status: 400 });
    }
    if (note.length > 4_000) {
      return NextResponse.json({ error: "Комментарий слишком длинный. Максимум 4000 символов." }, { status: 400 });
    }

    const response = await fetch(appsScriptConfig.webAppUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: appsScriptConfig.accessToken, action: "taskCommand", request: body }),
      cache: "no-store",
      redirect: "follow",
      signal: AbortSignal.timeout(90_000)
    });
    if (!response.ok) throw new Error(`Apps Script вернул ${response.status}.`);
    const payload = await response.json() as { ok?: boolean; error?: string; commandResult?: TaskActionSaveResult };
    if (!payload.ok || !payload.commandResult) {
      throw new Error(payload.error || "Развёрнутый Apps Script пока не поддерживает запись taskCommand.");
    }
    return NextResponse.json(payload.commandResult, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось отправить команду GPT.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
