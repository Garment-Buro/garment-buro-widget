import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildTaskAssistantClientContext } from "../lib/ai/client-context.ts";
import { parseCsv } from "../lib/ai/csv.ts";
import { buildDashboardDomain } from "../lib/domain/dashboard-engine.ts";
import {
  buildDependencySummary,
  buildProjectGraph,
  hydrateTaskDependencies,
  selectCurrentTask
} from "../lib/domain/dependency-engine.ts";
import { calculateProgress } from "../lib/domain/progress-engine.ts";
import { restoreLastGoodSnapshot } from "../lib/domain/snapshot-engine.ts";
import { buildTaskRelationshipFocus, tasksInPersonalRelationshipView } from "../lib/domain/task-relationship.ts";
import { buildPersonalTaskQueue } from "../lib/domain/task-queue.ts";
import { activePushNotifications } from "../lib/domain/notification-engine.ts";
import { personAsset } from "../lib/person-assets.ts";
import type {
  ChangeEvent,
  DashboardState,
  Goal,
  Milestone,
  Person,
  ProjectNotification,
  ProgressGate,
  Task
} from "../lib/types.ts";

const vera = person({ id: "P-VERA", name: "Вера" });
const nikita = person({ id: "P-NIKITA", name: "Никита" });
const goal002 = goal();
const milestone = milestoneFactory();
const task008 = task({ id: "TASK-008", owner: "Вера", status: "IN_PROGRESS", projectFocus: true, deadline: "12.08.2026", handoffTo: "Вера → TASK-009" });
const task009 = task({ id: "TASK-009", owner: "Вера", status: "READY", dependsOn: ["TASK-008"], deadline: "14.08.2026" });
const verifiedGate = gate({ id: "G-VERIFIED", currentPoints: 10, baselinePoints: 10, status: "VERIFIED_DONE" });
const task008Gate = gate({ id: "G-LEGAL-02", currentPoints: 4, baselinePoints: 4, closedByTask: "TASK-008" });

test("1. Vera deterministically gets TASK-008 as current focus", () => {
  const tasks = hydrateTaskDependencies([task009, task008], [task008Gate]);
  assert.equal(selectCurrentTask(vera, tasks, [task008Gate])?.id, "TASK-008");
});

test("2. TASK-008 is connected to its progress gate", () => {
  const [current, next] = hydrateTaskDependencies([task008, task009], [task008Gate]);
  const dependencies = buildDependencySummary(current, [current, next], [task008Gate]);
  assert.deepEqual(dependencies.relatedGates.map((item) => item.id), ["G-LEGAL-02"]);
  assert.deepEqual(dependencies.unlocks.map((item) => item.id), ["TASK-009"]);
});

test("3. launch readiness is derived from gate values, not a stored percentage", () => {
  const staleGoalSummary = goal({ readyPercent: 63, verifiedPoints: 63 });
  const result = progress(staleGoalSummary, [verifiedGate, gate({ id: "G-OPEN", currentPoints: 90 })]);
  assert.equal(result.progress.readyPercent, 10);
  assert.equal(result.goal?.readyPercent, 10);
});

test("4. VERIFIED_DONE increases solid progress", () => {
  const open = gate({ id: "G-2", currentPoints: 20 });
  assert.equal(progress(goal002, [verifiedGate, open]).progress.readyPercent, 33.3);
  assert.equal(progress(goal002, [verifiedGate, { ...open, status: "VERIFIED_DONE" }]).progress.readyPercent, 100);
});

test("5. IN_PROGRESS task status does not earn progress", () => {
  const result = progress(goal002, [verifiedGate, task008Gate], task008);
  assert.equal(result.progress.verifiedPoints, 10);
  assert.equal(result.progress.readyPercent, 71.4);
  assert.equal(result.progress.taskPotentialPoints, 4);
});

test("6. changing CURRENT_POINTS automatically changes the denominator", () => {
  const before = progress(goal002, [verifiedGate, gate({ id: "G-2", currentPoints: 10 })]);
  const after = progress(goal002, [verifiedGate, gate({ id: "G-2", currentPoints: 30 })]);
  assert.equal(before.progress.readyPercent, 50);
  assert.equal(after.progress.readyPercent, 25);
});

test("7. a new ACTIVE gate automatically recalculates readiness", () => {
  const before = progress(goal002, [verifiedGate]);
  const after = progress(goal002, [verifiedGate, gate({ id: "G-NEW", currentPoints: 10, active: true })]);
  assert.equal(before.progress.readyPercent, 100);
  assert.equal(after.progress.readyPercent, 50);
});

test("8. baseline remains immutable when forecast changes", () => {
  const result = progress(goal002, [verifiedGate], null, [change({
    forecastDateBefore: "29.08.2026",
    forecastDateAfter: "31.08.2026",
    forecastDeltaDays: 2
  })]);
  assert.equal(result.goal?.baselineTargetDate, "29.08.2026");
  assert.equal(result.goal?.currentForecastDate, "31.08.2026");
});

test("9. APPLIED change event exposes scope, version and date deltas", () => {
  const result = progress(goal002, [verifiedGate], null, [change({
    scopeDeltaPoints: 10,
    scopeVersionBefore: "v1",
    scopeVersionAfter: "v2",
    forecastDateBefore: "29.08.2026",
    forecastDateAfter: "31.08.2026",
    forecastDeltaDays: 2
  })]);
  assert.equal(result.progress.scopeDeltaPoints, 10);
  assert.equal(result.progress.forecastDeltaDays, 2);
  assert.equal(result.goal?.scopeVersion, "v2");
  assert.equal(result.recentChange?.forecastDateBefore, "29.08.2026");
});

test("10. WAITING_EXTERNAL does not hide actionable work", () => {
  const waiting = task({ id: "TASK-WAIT", owner: "Вера", status: "WAITING_EXTERNAL", projectFocus: true });
  const actionable = task({ id: "TASK-ACTION", owner: "Вера", status: "READY" });
  assert.equal(selectCurrentTask(vera, [waiting, actionable], [])?.id, "TASK-ACTION");
});

test("11. active Nikita without factual task scope is a DATA_GAP", () => {
  const domain = buildDashboardDomain({
    goals: [goal002],
    milestones: [milestone],
    tasks: [task008],
    gates: [verifiedGate],
    events: [],
    people: [vera, nikita],
    sources: [source("execution"), source("control")],
    goalId: goal002.id,
    personName: "Никита",
    updatedAt: new Date().toISOString()
  });
  assert.equal(domain.currentTask, null);
  assert.ok(domain.dataHealth.codes.includes("DATA_GAP"));
  assert.ok(domain.dataHealth.details.includes("Никита: SCOPE UNKNOWN"));
});

test("12. Google outage keeps the last valid normalized snapshot", () => {
  const snapshot = {
    dataMode: "google",
    currentTask: task008,
    updatedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
    dataHealth: { codes: [], details: [], staleMinutes: null, usingSnapshot: false },
    sources: [source("execution"), source("control")]
  } as unknown as DashboardState;
  const fallback = restoreLastGoodSnapshot(snapshot, [
    source("execution", "SOURCE_ERROR", "offline"),
    source("control")
  ]);
  assert.equal(fallback.currentTask?.id, "TASK-008");
  assert.equal(fallback.dataHealth.usingSnapshot, true);
  assert.ok(fallback.dataHealth.codes.includes("STALE_DATA"));
  assert.ok(fallback.dataHealth.codes.includes("PARTIAL_SOURCE_ERROR"));
  assert.ok((fallback.dataHealth.staleMinutes || 0) >= 5);
});

test("13. full graph contains only factual nodes and dependency edges", () => {
  const tasks = hydrateTaskDependencies([task008, task009], [task008Gate]);
  const graph = buildProjectGraph(goal002, [milestone], [task008Gate], tasks, [vera]);
  assert.ok(graph.nodes.some((node) => node.id === "TASK-008"));
  assert.ok(graph.nodes.some((node) => node.id === "G-LEGAL-02"));
  assert.ok(!graph.nodes.some((node) => node.id === "TASK-999"));
  assert.ok(graph.edges.some((edge) => edge.from === "TASK-008" && edge.to === "TASK-009" && edge.type === "DEPENDS_ON"));
});

test("14. Google Sheets v1 source contains no write operations", async () => {
  const sourceCode = await readFile(new URL("../lib/data/google-sheets.ts", import.meta.url), "utf8");
  assert.match(sourceCode, /spreadsheets\.readonly/);
  assert.doesNotMatch(sourceCode, /values\.append|values\.update|batchUpdate|spreadsheets\.create/);
});

test("15. GPT context uses the configured dashboard person and only related tasks", () => {
  const target = task({ id: "TASK-031", owner: "Никита", dependsOn: ["TASK-026"], unlocks: ["TASK-099"] });
  const dependency = task({ id: "TASK-026", owner: "Костя" });
  const unrelated = task({ id: "TASK-777", owner: "Вера" });
  const state = {
    person: nikita,
    tasks: [target, dependency, unrelated],
    taskContexts: [{
      id: "CTX-031", taskId: target.id, canonicalRefs: ["PB-002"], doNotReopen: "",
      currentWorkingState: "", openQuestions: "", handoffResult: "", handoffTo: "",
      updatedBy: "Костя", lastUpdated: "13.08.2026"
    }],
    goals: [goal002],
    goal: goal002,
    progress: progress(goal002, [verifiedGate]).progress,
    changeEvents: [], issues: [], sources: [source("execution"), source("control")],
    dataHealth: { codes: [], details: [], staleMinutes: null, usingSnapshot: false },
    updatedAt: "2026-08-14T12:00:00.000Z"
  } as unknown as DashboardState;

  const context = buildTaskAssistantClientContext(state, target.id);
  assert.equal(context.personName, "Никита");
  assert.deepEqual(context.relatedTasks.map((item) => item.id), ["TASK-026"]);
  assert.equal(context.taskContext?.id, "CTX-031");
});

test("16. Drive CSV parser preserves commas, quotes and embedded newlines", () => {
  assert.deepEqual(parseCsv('A,B\r\n1,"строка, с запятой"\r\n2,"две\nстроки"\r\n'), [
    ["A", "B"],
    ["1", "строка, с запятой"],
    ["2", "две\nстроки"]
  ]);
});

test("17. browser code never reads OPENAI_API_KEY", async () => {
  const clientCode = await readFile(new URL("../lib/services/task-action-service.ts", import.meta.url), "utf8");
  const dashboardCode = await readFile(new URL("../components/dashboard-client.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(clientCode, /OPENAI_API_KEY/);
  assert.doesNotMatch(dashboardCode, /OPENAI_API_KEY/);
});

test("17a. task actions use the GPT write command instead of a local mock", async () => {
  const serviceCode = await readFile(new URL("../lib/services/task-action-service.ts", import.meta.url), "utf8");
  const dashboardCode = await readFile(new URL("../components/dashboard-client.tsx", import.meta.url), "utf8");
  const routeCode = await readFile(new URL("../app/api/task-command/route.ts", import.meta.url), "utf8");
  const gatewayCode = await readFile(new URL("../apps-script/task-commands.gs", import.meta.url), "utf8");
  assert.match(serviceCode, /task-command/);
  assert.doesNotMatch(serviceCode, /saveTaskActionMock|mock-/);
  assert.doesNotMatch(dashboardCode, /localTaskSignals|saveTaskActionMock/);
  assert.match(dashboardCode, /Отправить в GPT/);
  assert.match(dashboardCode, /label="Новый факт"/);
  assert.match(routeCode, /"fact"/);
  assert.match(gatewayCode, /request\.intent === "fact"/);
  assert.match(gatewayCode, /plan\.updateType = "NEW_FACT"/);
  assert.match(gatewayCode, /plan\.targetStatus = "UNCHANGED"/);
});

test("17b. Apps Script recovers partial writes before marking a session SYNCED", async () => {
  const entrypointCode = await readFile(new URL("../apps-script/Code.gs", import.meta.url), "utf8");
  const gatewayCode = await readFile(new URL("../apps-script/task-commands.gs", import.meta.url), "utf8");
  const driveContextCode = await readFile(new URL("../apps-script/drive-context.gs", import.meta.url), "utf8");
  const manifestCode = await readFile(new URL("../apps-script/appsscript.json", import.meta.url), "utf8");
  const recoveryStart = gatewayCode.indexOf("function recoverCommandWrite_");
  const recoveryEnd = gatewayCode.indexOf("function askGptForTaskPlan_", recoveryStart);
  const recoveryCode = gatewayCode.slice(recoveryStart, recoveryEnd);

  assert.match(gatewayCode, /WIDGET_PLAN:/);
  assert.match(gatewayCode, /updateIdForCommand_/);
  assert.doesNotMatch(gatewayCode, /"ACTION_ID"/);
  assert.ok(recoveryCode.indexOf("verifyCommandWrite_") < recoveryCode.indexOf('"SYNCED"'));
  assert.match(gatewayCode, /requestedSession\.SYNC_STATUS === "SYNCED"/);
  assert.match(entrypointCode, /action === "taskCommand"/);
  assert.match(entrypointCode, /handleNotificationAckRequest_/);
  assert.match(entrypointCode, /capabilities: gatewayCapabilities_/);
  assert.doesNotMatch(entrypointCode, /gb_[a-f0-9]{32,}|sk-(?:proj-)?[A-Za-z0-9_-]{20,}/);
  assert.match(gatewayCode, /buildDriveTaskContext_/);
  assert.match(gatewayCode, /exportGoogleWorkspaceText_\(masterPromptId\)/);
  assert.match(driveContextCode, /DRIVE_ROOT_FOLDER_ID/);
  assert.match(driveContextCode, /\/drive\/v3\/files\//);
  assert.match(driveContextCode, /ScriptApp\.getOAuthToken\(\)/);
  assert.doesNotMatch(`${entrypointCode}\n${gatewayCode}\n${driveContextCode}`, /DocumentApp|SlidesApp/);
  assert.match(manifestCode, /auth\/drive\.readonly/);
  assert.doesNotMatch(manifestCode, /auth\/(?:documents|presentations)/);
  assert.doesNotThrow(() => new Function(`${entrypointCode}\n${driveContextCode}\n${gatewayCode}`));
});

test("17c. widget backend rebuilds trusted context and accepts only verified gateway writes", async () => {
  const routeCode = await readFile(new URL("../app/api/task-command/route.ts", import.meta.url), "utf8");
  const gatewayClientCode = await readFile(new URL("../lib/services/apps-script-gateway.ts", import.meta.url), "utf8");
  const desktopCode = await readFile(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");

  assert.match(routeCode, /getDashboardState/);
  assert.match(routeCode, /buildTaskAssistantClientContext/);
  assert.match(routeCode, /result\.syncStatus !== "SYNCED"/);
  assert.match(gatewayClientCode, /APPS_SCRIPT_ACCESS_TOKEN|appsScriptConfig\.accessToken/);
  assert.doesNotMatch(desktopCode, /NOTIFICATIONS_SHEET_GID/);
  assert.match(desktopCode, /syncStatus/);
  assert.match(desktopCode, /ack_notification/);
});

test("17d. private Drive context uses server credentials and task-scoped retrieval", async () => {
  const authCode = await readFile(new URL("../lib/google/service-account.ts", import.meta.url), "utf8");
  const driveCode = await readFile(new URL("../lib/google/drive-context.ts", import.meta.url), "utf8");
  const assistantContextCode = await readFile(new URL("../lib/ai/drive-context.ts", import.meta.url), "utf8");
  const ignoreCode = await readFile(new URL("../.gitignore", import.meta.url), "utf8");

  assert.match(authCode, /GOOGLE_APPLICATION_CREDENTIALS/);
  assert.match(authCode, /oauth:grant-type:jwt-bearer/);
  assert.match(driveCode, /drive\.readonly/);
  assert.match(driveCode, /buildRelevantDriveContext/);
  assert.match(driveCode, /\/download\?mimeType=/);
  assert.match(driveCode, /import\("jszip"\)/);
  assert.match(driveCode, /00_ПРАВИЛА РАБОТЫ С БАЗОЙ/);
  assert.match(driveCode, /00_СОСТОЯНИЕ ПРОЕКТА/);
  assert.match(assistantContextCode, /driveKnowledge/);
  assert.doesNotMatch(assistantContextCode, /docs\.google\.com\/document\/d\/.*export/);
  assert.match(ignoreCode, /crucial-context-\*\.json/);
});

test("18. dashboard person selection is case-insensitive and never falls back to another employee", () => {
  const upperNikita = person({ id: "P-NIKITA", name: "НИКИТА" });
  const known = buildDashboardDomain({
    goals: [goal002], milestones: [milestone], tasks: [task({ owner: "НИКИТА" })], gates: [], events: [],
    people: [vera, upperNikita], sources: [source("execution"), source("control")], goalId: goal002.id,
    personName: "Никита", updatedAt: new Date().toISOString()
  });
  const unknown = buildDashboardDomain({
    goals: [goal002], milestones: [milestone], tasks: [task008], gates: [], events: [],
    people: [vera, upperNikita], sources: [source("execution"), source("control")], goalId: goal002.id,
    personName: "Неизвестный", updatedAt: new Date().toISOString()
  });
  assert.equal(known.person?.id, "P-NIKITA");
  assert.equal(unknown.person, null);
});

test("19. personal current task can come from another goal than the MVP progress goal", () => {
  const review = task({ id: "TASK-027", owner: "Никита", goalId: "GOAL-002", status: "REVIEW", handoffTo: "Костя" });
  const widget = task({ id: "TASK-031", owner: "Никита", goalId: "GOAL-001", status: "READY" });
  const domain = buildDashboardDomain({
    goals: [goal002], milestones: [milestone], tasks: [review, widget], gates: [], events: [],
    people: [nikita], sources: [source("execution"), source("control")], goalId: goal002.id,
    personName: "Никита", updatedAt: new Date().toISOString()
  });
  assert.equal(domain.currentTask?.id, "TASK-031");
  assert.equal(domain.goal?.id, "GOAL-002");
});

test("20. a review handed to another person does not outrank active personal work", () => {
  const review = task({ id: "TASK-027", owner: "Никита", status: "REVIEW", deadline: "11.08.2026", handoffTo: "Костя" });
  const widget = task({ id: "TASK-031", owner: "Никита", status: "READY", deadline: "" });
  assert.equal(buildPersonalTaskQueue([review, widget], "Никита", {})[0]?.id, "TASK-031");
});

test("21. person assets resolve regardless of spreadsheet letter case", () => {
  assert.equal(personAsset(" НИКИТА ", "full"), "/assets/people/nikita-full.png");
  assert.equal(personAsset("вера", "avatar"), "/assets/people/vera-avatar.png");
  assert.equal(personAsset("Костя", "full"), undefined);
});

test("22. personal tree focus includes own tasks and their direct dependencies", () => {
  const dependency = task({ id: "TASK-026", owner: "Костя" });
  const own = task({ id: "TASK-031", owner: "НИКИТА", dependsOn: ["TASK-026"] });
  const downstream = task({ id: "TASK-032", owner: "Вера", dependsOn: ["TASK-031"] });
  const unrelated = task({ id: "TASK-777", owner: "Вера" });
  const tasks = hydrateTaskDependencies([dependency, own, downstream, unrelated], []);
  const focus = buildTaskRelationshipFocus(tasks[1], tasks, "Никита");
  const visible = tasksInPersonalRelationshipView(tasks, "Никита");
  assert.deepEqual(focus.incoming.map((item) => item.id), ["TASK-026"]);
  assert.deepEqual(focus.outgoing.map((item) => item.id), ["TASK-032"]);
  assert.ok(visible.has("TASK-026"));
  assert.ok(visible.has("TASK-031"));
  assert.ok(visible.has("TASK-032"));
  assert.ok(!visible.has("TASK-777"));
});

test("23. push notifications are delivered only to their factual recipient", () => {
  const notification = {
    id: "NTF-1", recipientId: "P-KOSTYA", createdById: "P-NIKITA", kind: "DEPENDENCY",
    title: "Action required", message: "Message", taskId: "TASK-027", actionId: "", gateId: "",
    priority: "P0", status: "OPEN", push: true, createdAt: "", dueAt: "", readAt: "", ackAt: "",
    resolvedAt: "", autoResolveRef: "", sourceRef: "", lastUpdated: "", version: "1"
  } satisfies ProjectNotification;
  assert.deepEqual(activePushNotifications([notification], "P-NIKITA"), []);
  assert.deepEqual(activePushNotifications([notification], "p-kostya").map((item) => item.id), ["NTF-1"]);
  assert.deepEqual(activePushNotifications([{ ...notification, status: "RESOLVED" }], "P-KOSTYA"), []);
  assert.deepEqual(activePushNotifications([{ ...notification, ackAt: "14.08.2026 12:00" }], "P-KOSTYA"), []);
});

function progress(goalValue: Goal, gates: ProgressGate[], currentTask: Task | null = null, events: ChangeEvent[] = []) {
  const dependencies = buildDependencySummary(currentTask, currentTask ? [currentTask, task009] : [], gates);
  return calculateProgress(goalValue, gates, currentTask, dependencies, events);
}

function goal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: "GOAL-002", title: "Commercial MVP", why: "", successMetric: "", targetDate: "29.08.2026",
    owner: "Вера", status: "ACTIVE", priority: "P0", notes: "", lastUpdated: "10.08.2026",
    baselineTargetDate: "29.08.2026", currentForecastDate: "29.08.2026", baselineScopePoints: 100,
    currentScopePoints: 100, scopeVersion: "v1", verifiedPoints: 10, readyPercent: 10, forecastDeltaDays: 0,
    ...overrides
  };
}

function milestoneFactory(overrides: Partial<Milestone> = {}): Milestone {
  return {
    id: "MS-LAUNCH", goalId: "GOAL-002", title: "Launch", expectedResult: "", acceptanceCriteria: "",
    owner: "Вера", status: "ACTIVE", priority: "P0", dependsOn: [], deadline: "29.08.2026",
    lastUpdated: "10.08.2026", ...overrides
  };
}

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "TASK-X", owner: "Вера", direction: "LEGAL", goalId: "GOAL-002", milestoneId: "MS-LAUNCH",
    title: "Task", whyNow: "", expectedResult: "Result", acceptanceCriteria: "", priority: "P0", status: "READY",
    dependsOn: [], deadline: "15.08.2026", source: "", fixationId: "", result: "", lastUpdated: "10.08.2026",
    delegableTo: "", decisionLevel: "", workMode: "", launchGate: "YES", waitingFor: "", nextCheckDate: "",
    projectFocus: false, contextId: "", handoffTo: "", blockedBy: [], unlocks: [], isOverdue: false, launchCritical: false,
    ...overrides
  };
}

function gate(overrides: Partial<ProgressGate> = {}): ProgressGate {
  return {
    id: "GATE-X", goalId: "GOAL-002", milestoneId: "MS-LAUNCH", title: "Gate", baselinePoints: 10,
    currentPoints: 10, status: "OPEN", dependsOnGate: [], evidenceRef: "", closedByTask: "", blockedBy: [],
    active: true, lastChangeId: "", verifiedAt: "", notes: "", ...overrides
  };
}

function person(overrides: Partial<Person> = {}): Person {
  return {
    id: "P-X", name: "Person", role: "Role", primaryDirection: "", responsibilities: "", currentFocus: "",
    notes: "", active: true, ...overrides
  };
}

function change(overrides: Partial<ChangeEvent> = {}): ChangeEvent {
  return {
    id: "CHG-1", dateTime: "10.08.2026 12:00", source: "Execution", description: "Change",
    impactType: "GOAL_CHANGE", affectedGoalId: "GOAL-002", affectedMilestoneId: "", affectedGateId: "",
    scopeDeltaPoints: 0, forecastDateBefore: "", forecastDateAfter: "", decisionStatus: "APPLIED", approvedBy: "Костя",
    scopeVersionBefore: "v1", scopeVersionAfter: "v1", notes: "", forecastDeltaDays: 0, ...overrides
  };
}

function source(name: "execution" | "control", status: "LIVE" | "SOURCE_ERROR" = "LIVE", error?: string) {
  return {
    name,
    status,
    lastFetchedAt: new Date().toISOString(),
    lastSuccessfulFetchAt: status === "LIVE" ? new Date().toISOString() : null,
    error
  } as const;
}
