import { NextResponse } from "next/server";
import { answerTaskAssistant } from "@/lib/ai/task-assistant";
import type { TaskAssistantMode } from "@/lib/ai/types";

export const dynamic = "force-dynamic";

const modes = new Set<TaskAssistantMode>(["start", "blocker", "ask", "acceptance"]);

export async function POST(request: Request) {
  try {
    const body = await request.json() as { taskId?: string; mode?: TaskAssistantMode; message?: string };
    const taskId = String(body.taskId || "").trim();
    const mode = body.mode;
    const message = String(body.message || "").trim();
    if (!taskId || !mode || !modes.has(mode)) {
      return NextResponse.json({ error: "Укажите корректную задачу и режим запроса." }, { status: 400 });
    }
    if (message.length > 4_000) {
      return NextResponse.json({ error: "Запрос слишком длинный. Сократите его до 4000 символов." }, { status: 400 });
    }

    return NextResponse.json(await answerTaskAssistant({ taskId, mode, message }), {
      headers: { "Cache-Control": "no-store" }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось получить ответ GPT.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
