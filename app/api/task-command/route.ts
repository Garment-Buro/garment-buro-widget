import { NextResponse } from "next/server";
import { buildTaskAssistantClientContext } from "@/lib/ai/client-context";
import { getDashboardState } from "@/lib/data";
import { buildRelevantDriveContext } from "@/lib/google/drive-context";
import { callAppsScriptGateway } from "@/lib/services/apps-script-gateway";
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
    const body = await request.json() as Record<string, unknown>;
    const taskId = String(body.taskId || "").trim();
    const commandId = String(body.commandId || "").trim();
    const intent = String(body.intent || "") as TaskCommandIntent;
    const rawDetails = body.details as Record<string, unknown> | undefined;
    const note = String(rawDetails?.note || "").trim();

    if (!/^[A-Za-z0-9_-]{1,120}$/.test(taskId) || !/^[A-Za-z0-9_-]{1,120}$/.test(commandId) || !intents.has(intent)) {
      return NextResponse.json({ error: "Некорректная команда задачи." }, { status: 400 });
    }
    if (["reject", "stuck", "waiting", "fact", "done", "session_close"].includes(intent) && !note) {
      return NextResponse.json({ error: "Добавьте короткий комментарий для GPT." }, { status: 400 });
    }
    if (note.length > 4_000) {
      return NextResponse.json({ error: "Комментарий слишком длинный. Максимум 4000 символов." }, { status: 400 });
    }
    const sessionId = String(rawDetails?.sessionId || "").trim();
    if (["session_start", "session_close"].includes(intent) && !/^[A-Za-z0-9_-]{1,160}$/.test(sessionId)) {
      return NextResponse.json({ error: "Для рабочей сессии нужен корректный SESSION_ID." }, { status: 400 });
    }

    const dashboard = await getDashboardState();
    const person = dashboard.person;
    const task = dashboard.tasks.find((item) => item.id === taskId);
    if (!person || !task) {
      return NextResponse.json({ error: "Сотрудник или задача не найдены в актуальном dashboard." }, { status: 409 });
    }

    const details = {
      note,
      nextCheckDate: optionalDate(rawDetails?.nextCheckDate),
      acceptanceCriteria: task.acceptanceCriteria || task.expectedResult,
      sessionId: sessionId || undefined,
      sessionStartedAt: optionalIsoDate(rawDetails?.sessionStartedAt),
      sessionDurationSeconds: boundedInteger(rawDetails?.sessionDurationSeconds, 0, 604_800),
      pomodoroCompleted: boundedInteger(rawDetails?.pomodoroCompleted, 0, 1_000)
    };
    const clientContext = buildTaskAssistantClientContext(dashboard, taskId);
    const driveKnowledge = await buildRelevantDriveContext(clientContext, note).catch((error) => ({
      rootFolderId: "",
      files: [],
      warnings: [error instanceof Error ? error.message : String(error)]
    }));
    const gatewayRequest = {
      commandId,
      taskId,
      intent,
      details,
      author: person.name,
      personId: person.id,
      context: { ...clientContext, driveKnowledge }
    };
    const payload = await callAppsScriptGateway<{ commandResult?: TaskActionSaveResult }>("taskCommand", gatewayRequest);
    const result = payload.commandResult;
    if (!result || result.commandId !== commandId) {
      throw new Error("Apps Script не вернул подтверждение этой команды.");
    }
    if (result.syncStatus !== "SYNCED") {
      throw new Error(`Команда не подтверждена: ${result.syncStatus}. Повторите запрос для восстановления.`);
    }
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось отправить команду GPT.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}

function optionalDate(value: unknown) {
  const text = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : undefined;
}

function optionalIsoDate(value: unknown) {
  const text = String(value || "").trim();
  return text && Number.isFinite(Date.parse(text)) ? text : undefined;
}

function boundedInteger(value: unknown, minimum: number, maximum: number) {
  const number = Number(value);
  if (!Number.isFinite(number)) return undefined;
  return Math.min(maximum, Math.max(minimum, Math.round(number)));
}
