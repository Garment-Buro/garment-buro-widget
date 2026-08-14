import "server-only";

import { buildAssistantDriveContext } from "@/lib/ai/drive-context";
import type { TaskAssistantRequest, TaskAssistantResponse } from "@/lib/ai/types";
import { getDashboardState } from "@/lib/data";

const openAiModel = process.env.OPENAI_MODEL || "gpt-5.6-terra";

export async function answerTaskAssistant(
  request: Omit<TaskAssistantRequest, "context">
): Promise<TaskAssistantResponse> {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) throw new Error("OPENAI_API_KEY не настроен на сервере.");

  const dashboard = await getDashboardState();
  const context = await buildAssistantDriveContext(
    dashboard,
    request.taskId,
    request.mode,
    request.message
  );
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: openAiModel,
      instructions: [
        context.masterPrompt,
        "RUNTIME CONTRACT ВИДЖЕТА:",
        "Ты работаешь в режиме read-only. Не создавай факты, не меняй сроки/OWNER/PRIORITY и не говори, что что-либо записано в Google Sheets.",
        "Отвечай по-русски, коротко и прикладно. Сначала дай вывод, затем ближайший шаг. Для D2/Course явно укажи, что требуется решение Кости."
      ].join("\n\n"),
      input: context.userInput,
      max_output_tokens: 900,
      store: false
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(60_000)
  });

  const payload = await response.json() as OpenAiResponsePayload;
  if (!response.ok) {
    throw new Error(payload.error?.message || `OpenAI API вернул ошибку ${response.status}.`);
  }
  const answer = readOutputText(payload);
  if (!answer) throw new Error("OpenAI API не вернул текст ответа.");

  return {
    answer,
    model: payload.model || openAiModel,
    reconciledAt: new Date().toISOString(),
    sources: context.sources,
    warnings: context.warnings
  };
}

interface OpenAiResponsePayload {
  model?: string;
  output_text?: string;
  output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
  error?: { message?: string };
}

function readOutputText(payload: OpenAiResponsePayload) {
  if (payload.output_text?.trim()) return payload.output_text.trim();
  return payload.output
    ?.flatMap((item) => item.content || [])
    .filter((item) => item.type === "output_text" && item.text)
    .map((item) => item.text)
    .join("\n")
    .trim();
}
