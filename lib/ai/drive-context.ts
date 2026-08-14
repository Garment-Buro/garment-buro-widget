import "server-only";

import { spreadsheetConfig } from "@/lib/config";
import { buildTaskAssistantClientContext } from "@/lib/ai/client-context";
import { parseCsv } from "@/lib/ai/csv";
import type { TaskAssistantMode } from "@/lib/ai/types";
import type { DashboardState } from "@/lib/types";

const masterPromptDocumentId =
  process.env.GOOGLE_MASTER_PROMPT_DOCUMENT_ID ||
  "1_EBiiqM_7c0FxpXbmfZpAg1-POaftWRm26EIvSflwJk";
const widgetBriefDocumentId =
  process.env.GOOGLE_WIDGET_BRIEF_DOCUMENT_ID ||
  "1PKxVgMn7NyL0Kn55WPsODdMK8Fu_IibHsnH5Nv3A0u8";

const sheetTabs = {
  playbooks: { title: "PLAYBOOKS", gid: "1008" },
  taskUpdates: { title: "TASK_UPDATES", gid: "1011" },
  events: { title: "EVENTS", gid: "1012" },
  routingActions: { title: "ROUTING_ACTIONS", gid: "1013" },
  sessionHandoffs: { title: "SESSION_HANDOFFS", gid: "1014" }
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
  const [masterPrompt, tabResults] = await Promise.all([
    fetchGoogleDocument(masterPromptDocumentId, "00_MASTER PROMPT — ЛИЧНЫЙ ПРОЕКТ"),
    Promise.all(tabEntries.map(async ([key, tab]) => [key, await fetchSheetRecords(tab.gid, tab.title)] as const))
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
      content: await fetchGoogleDocument(widgetBriefDocumentId, "WIDGET — VISION & IMPLEMENTATION BRIEF v1")
    });
  }

  const warnings = buildWarnings(dashboard);
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
    sources: [
      "00_MASTER PROMPT — ЛИЧНЫЙ ПРОЕКТ",
      "10_EXECUTION SYSTEM",
      ...referencedDocuments.map((item) => item.title)
    ],
    warnings
  };
}

async function fetchGoogleDocument(documentId: string, title: string): Promise<string> {
  const response = await fetch(
    `https://docs.google.com/document/d/${encodeURIComponent(documentId)}/export?format=txt`,
    { cache: "no-store", redirect: "follow", signal: AbortSignal.timeout(30_000) }
  );
  if (!response.ok) throw new Error(`Не удалось прочитать актуальный документ «${title}» (${response.status}).`);
  const text = (await response.text()).replace(/^\uFEFF/, "").trim();
  if (!text) throw new Error(`Документ «${title}» пуст или недоступен.`);
  return text;
}

async function fetchSheetRecords(gid: string, title: string): Promise<SheetRecord[]> {
  const response = await fetch(
    `https://docs.google.com/spreadsheets/d/${encodeURIComponent(spreadsheetConfig.executionId)}/export?format=csv&gid=${gid}`,
    { cache: "no-store", redirect: "follow", signal: AbortSignal.timeout(30_000) }
  );
  if (!response.ok) throw new Error(`Не удалось прочитать лист ${title} (${response.status}).`);
  return rowsToRecords(parseCsv(await response.text()));
}

function rowsToRecords(rows: string[][]): SheetRecord[] {
  const [rawHeaders = [], ...body] = rows;
  const headers = rawHeaders.map((header) => header.replace(/^\uFEFF/, "").trim());
  return body
    .filter((row) => row.some((cell) => cell.trim()))
    .map((row) => Object.fromEntries(headers.map((header, index) => [header, String(row[index] || "").trim()])));
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
