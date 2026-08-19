import { buildTaskAssistantClientContext } from "@/lib/ai/client-context";
import type { TaskAssistantMode, TaskAssistantRequest, TaskAssistantResponse } from "@/lib/ai/types";
import type { DashboardState } from "@/lib/types";
import { appPath } from "../base-path.ts";

export type TaskActionIntent = "reject" | "stuck" | "waiting" | "fact" | "done" | "session_close";
export type TaskCommandIntent = "accept" | "session_start" | TaskActionIntent;

export type TaskActionDetails = {
  note: string;
  nextCheckDate?: string;
  acceptanceCriteria?: string;
  sessionId?: string;
  sessionStartedAt?: string;
  sessionDurationSeconds?: number;
  pomodoroCompleted?: number;
};

export type TaskActionSubmission = {
  commandId: string;
  taskId: string;
  intent: TaskCommandIntent;
  details: TaskActionDetails;
  preview: string;
};

export type TaskActionSaveResult = {
  commandId: string;
  assistantMessage: string;
  syncStatus: "SYNCED" | "PENDING_CAPTURE" | "PARTIAL_SYNC" | "SOURCE_GAP" | "WRITE_ERROR";
  taskStatus?: string;
  sessionId?: string;
  updatedAt: string;
  timings?: TaskCommandTimings;
};

export type TaskCommandTimings = {
  totalMs?: number;
  lockWaitMs?: number;
  sheetsReadMs?: number;
  masterPromptMs?: number;
  taskContextMs?: number;
  driveContextMs?: number;
  openAiMs?: number;
  sheetsWriteMs?: number;
  verificationMs?: number;
  clientRequestMs?: number;
  dashboardRefreshMs?: number;
};

export type TaskCommandProgress = {
  stage: "connecting" | "context" | "gpt" | "verification";
  label: string;
};

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

  const response = await fetch(appPath("/api/assistant"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store"
  });
  const body = await response.json() as TaskAssistantResponse & { error?: string };
  if (!response.ok) throw new Error(body.error || "Не удалось получить ответ GPT.");
  return body;
}

export async function submitTaskCommand(
  submission: TaskActionSubmission,
  state: DashboardState,
  accessToken?: string,
  onProgress?: (progress: TaskCommandProgress) => void
): Promise<TaskActionSaveResult> {
  const request = {
    ...submission,
    author: state.person?.name || "",
    personId: state.person?.id || "",
    context: buildTaskAssistantClientContext(state, submission.taskId)
  };

  const startedAt = performance.now();
  const progressTimers = scheduleCommandProgress(onProgress);
  try {
    let result: TaskActionSaveResult;
    if (isTauriRuntime()) {
      if (!accessToken) throw new Error("Код доступа к рабочему пространству не найден.");
      const { invoke } = await import("@tauri-apps/api/core");
      result = await invoke<TaskActionSaveResult>("submit_task_command", { token: accessToken, request });
    } else {
      const response = await fetch(appPath("/api/task-command"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
        cache: "no-store"
      });
      const body = await response.json() as TaskActionSaveResult & { error?: string };
      if (!response.ok) throw new Error(body.error || "GPT не смог зафиксировать изменение в Google Sheets.");
      result = body;
    }
    onProgress?.({ stage: "verification", label: "Запись подтверждена в Google Sheets" });
    return {
      ...result,
      timings: {
        ...result.timings,
        clientRequestMs: Math.round(performance.now() - startedAt)
      }
    };
  } finally {
    progressTimers.forEach((timer) => window.clearTimeout(timer));
  }
}

export function createCommandId(prefix = "CMD") {
  const suffix = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${suffix}`;
}

function isTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function scheduleCommandProgress(onProgress?: (progress: TaskCommandProgress) => void) {
  if (!onProgress || typeof window === "undefined") return [];
  onProgress({ stage: "connecting", label: "Подключаемся к рабочему пространству" });
  return [
    window.setTimeout(() => onProgress({ stage: "context", label: "Читаем контекст задачи и Google Drive" }), 1_200),
    window.setTimeout(() => onProgress({ stage: "gpt", label: "GPT анализирует материалы и готовит решение" }), 5_000),
    window.setTimeout(() => onProgress({ stage: "verification", label: "Ждём запись и проверку Google Sheets" }), 20_000)
  ];
}
