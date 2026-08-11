import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildDashboardDomain } from "../lib/domain/dashboard-engine.ts";
import {
  buildDependencySummary,
  buildProjectGraph,
  hydrateTaskDependencies,
  selectCurrentTask
} from "../lib/domain/dependency-engine.ts";
import { calculateProgress } from "../lib/domain/progress-engine.ts";
import { restoreLastGoodSnapshot } from "../lib/domain/snapshot-engine.ts";
import type {
  ChangeEvent,
  DashboardState,
  Goal,
  Milestone,
  Person,
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
