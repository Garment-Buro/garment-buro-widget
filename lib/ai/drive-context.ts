import "server-only";

import { spreadsheetConfig } from "@/lib/config";
import { buildTaskAssistantClientContext } from "@/lib/ai/client-context";
import {
  buildRelevantDriveContext,
  readGoogleDocumentText,
  readGoogleSheetRecords
} from "@/lib/google/drive-context";
import type { TaskAssistantMode } from "@/lib/ai/types";
import type { DashboardState } from "@/lib/types";

const masterPromptDocumentId =
  process.env.GOOGLE_MASTER_PROMPT_DOCUMENT_ID ||
  "1_EBiiqM_7c0FxpXbmfZpAg1-POaftWRm26EIvSflwJk";
const widgetBriefDocumentId =
  process.env.GOOGLE_WIDGET_BRIEF_DOCUMENT_ID ||
  "1PKxVgMn7NyL0Kn55WPsODdMK8Fu_IibHsnH5Nv3A0u8";

const sheetTabs = {
  playbooks: "PLAYBOOKS",
  taskUpdates: "TASK_UPDATES",
  events: "EVENTS",
  routingActions: "ROUTING_ACTIONS",
  sessionHandoffs: "SESSION_HANDOFFS"
} as const;

type SheetRecord = Record<string, string>;

export interface AssistantDriveContext {
  masterPrompt: string;
  userInput: string;
  sources: string[];
  warnings: string[];
}

export async function buildAssistantDriveContext(
  dashboard: DashboardState,
  taskId: string,
  mode: TaskAssistantMode,
  message = ""
): Promise<AssistantDriveContext> {
  const base = buildTaskAssistantClientContext(dashboard, taskId);
  assertTaskIsRelevant(dashboard, taskId);

  const tabEntries = Object.entries(sheetTabs) as Array<
    [keyof typeof sheetTabs, (typeof sheetTabs)[keyof typeof sheetTabs]]
  >;
  const [masterPrompt, tabResults, driveKnowledge] = await Promise.all([
    readGoogleDocumentText(masterPromptDocumentId, "00_MASTER PROMPT — ЛИЧНЫЙ ПРОЕКТ"),
    Promise.all(tabEntries.map(async ([key, title]) => [key, await readGoogleSheetRecords(
      spreadsheetConfig.executionId,
      title
    )] as const)),
    buildRelevantDriveContext(base, message)
  ]);
  const tabs = Object.fromEntries(tabResults) as Record<keyof typeof sheetTabs, SheetRecord[]>;
  const relevantTaskIds = new Set([base.task.id, ...base.relatedTasks.map((task) => task.id)]);
  const canonicalRefs = base.taskContext?.canonicalRefs.join("; ") || "";
  const referencedPlaybookIds = new Set(canonicalRefs.match(/PB-\d+/g) || ["PB-002"]);
  const playbooks = tabs.playbooks.filter((row) =>
    referencedPlaybookIds.has(row.PLAYBOOK_ID) || row.PLAYBOOK_ID === "PB-002"
  );
  const taskUpdates = tabs.taskUpdates
    .filter((row) => relevantTaskIds.has(row.TASK_ID) || row.AUTHOR === base.personName)
    .slice(-30);
  const routingActions = tabs.routingActions
    .filter((row) => relevantTaskIds.has(row.TASK_ID) || row.ACTOR === base.personName)
    .slice(-30);
  const events = tabs.events
    .filter((row) => containsName(row.PARTICIPANTS, base.personName) || containsAny(row.RELATED_TASKS, relevantTaskIds))
    .slice(-20);
  const sessionHandoffs = tabs.sessionHandoffs
    .filter((row) => row.AUTHOR === base.personName || row.AUTHOR === base.personName.toUpperCase())
    .slice(-10);
  const referencedDocuments: Array<{ title: string; content: string }> = [];

  if (/WIDGET brief|WIDGET — VISION/i.test(canonicalRefs)) {
    referencedDocuments.push({
      title: "WIDGET — VISION & IMPLEMENTATION BRIEF v1",
      content: await readGoogleDocumentText(widgetBriefDocumentId, "WIDGET — VISION & IMPLEMENTATION BRIEF v1")
    });
  }

  const warnings = [...buildWarnings(dashboard), ...driveKnowledge.warnings];
  const operationalContext = {
    author: base.personName,
    mode,
    request: message.trim() || defaultRequest(mode),
    dashboardUpdatedAt: base.dashboardUpdatedAt,
    task: base.task,
    taskContext: base.taskContext,
    relatedTasks: base.relatedTasks,
    goal: base.goal,
    progress: base.progress,
    recentChanges: base.recentChanges,
    relatedIssues: base.relatedIssues,
    playbooks,
    latestTaskUpdates: taskUpdates,
    routingActions,
    events,
    latestSessionHandoffs: sessionHandoffs,
    referencedDocuments,
    driveKnowledge,
    dataHealth: base.dataHealth,
    sources: base.sources
  };

  return {
    masterPrompt,
    userInput: [
      `AUTHOR = ${base.personName}.`,
      "Ниже находится текущий согласованный контекст из Google Sheets и связанных документов Google Drive.",
      "Не используй память предыдущих чатов. Не утверждай, что данные записаны или изменены: этот запрос только для чтения и помощи.",
      "Если данных недостаточно или источник неактуален, скажи это прямо и задай только один действительно необходимый вопрос.",
      JSON.stringify(operationalContext, null, 2)
    ].join("\n\n"),
    sources: [...new Set([
      "00_MASTER PROMPT — ЛИЧНЫЙ ПРОЕКТ",
      "10_EXECUTION SYSTEM",
      ...referencedDocuments.map((item) => item.title),
      ...driveKnowledge.files.map((item) => item.title)
    ])],
    warnings
  };
}

function assertTaskIsRelevant(dashboard: DashboardState, taskId: string) {
  const person = dashboard.person;
  const task = dashboard.tasks.find((item) => item.id === taskId);
  if (!person || !task) throw new Error("Не удалось определить сотрудника или задачу.");
  const ownTasks = dashboard.tasks.filter((item) => item.owner === person.name);
  const allowedIds = new Set(ownTasks.flatMap((item) => [item.id, ...item.dependsOn, ...item.blockedBy, ...item.unlocks]));
  if (!allowedIds.has(taskId)) throw new Error(`Задача ${taskId} не входит в рабочий контур ${person.name}.`);
}

function buildWarnings(dashboard: DashboardState): string[] {
  const warnings: string[] = [];
  if (dashboard.dataHealth.usingSnapshot) warnings.push("Используется последний сохранённый снимок, а не live-данные.");
  if (dashboard.sources.some((source) => source.status !== "LIVE")) warnings.push("Один или несколько источников Google имеют ошибку или устарели.");
  if (dashboard.dataHealth.codes.includes("DATA_GAP")) warnings.push("В текущих данных есть DATA_GAP.");
  return warnings;
}

function defaultRequest(mode: TaskAssistantMode): string {
  if (mode === "start") return "Дай понятный вектор старта и один ближайший конкретный шаг.";
  if (mode === "blocker") return "Помоги снять описанный блокер и продолжить работу.";
  if (mode === "acceptance") return "Проверь готовность результата по acceptance criteria и назови недостающее.";
  return "Ответь на вопрос по текущей задаче, опираясь только на актуальный контекст.";
}

function containsName(value: string, name: string) {
  return value.toLocaleLowerCase("ru-RU").includes(name.toLocaleLowerCase("ru-RU"));
}

function containsAny(value: string, ids: Set<string>) {
  return Array.from(ids).some((id) => value.includes(id));
}
