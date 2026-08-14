import { buildTaskAssistantClientContext } from "@/lib/ai/client-context";
import type {
  TaskAssistantMode,
  TaskAssistantRequest,
  TaskAssistantResponse
} from "@/lib/ai/types";
import type { DashboardState } from "@/lib/types";

export type TaskActionIntent = "stuck" | "waiting" | "fact" | "done";

export type TaskActionDetails = {
  note: string;
  nextCheckDate?: string;
  blockerOutcome?: "helped" | "blocked";
  acceptanceCriteria?: string;
};

export type TaskActionSubmission = {
  taskId: string;
  intent: TaskActionIntent;
  details: TaskActionDetails;
  preview: string;
};

export type TaskActionSaveResult = {
  id: string;
  savedAt: string;
};

const wait = (delay: number) => new Promise((resolve) => window.setTimeout(resolve, delay));

export async function requestTaskActionHelp(
  taskId: string,
  blocker: string,
  state: DashboardState
): Promise<string> {
  const response = await requestTaskAssistant({
    taskId,
    mode: "blocker",
    message: blocker
  }, state);
  return response.answer;
}

export async function requestTaskAssistant(
  request: { taskId: string; mode: TaskAssistantMode; message?: string },
  state: DashboardState
): Promise<TaskAssistantResponse> {
  const payload: TaskAssistantRequest = {
    ...request,
    context: buildTaskAssistantClientContext(state, request.taskId)
  };

  if (isTauriRuntime()) {
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<TaskAssistantResponse>("ask_task_assistant", { request: payload });
  }

  const response = await fetch("/api/assistant", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store"
  });
  const body = await response.json() as TaskAssistantResponse & { error?: string };
  if (!response.ok) throw new Error(body.error || "Не удалось получить ответ GPT.");
  return body;
}

export async function saveTaskActionMock(submission: TaskActionSubmission): Promise<TaskActionSaveResult> {
  await wait(520);
  return {
    id: `mock-${submission.taskId}-${Date.now()}`,
    savedAt: new Date().toISOString()
  };
}

function isTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
