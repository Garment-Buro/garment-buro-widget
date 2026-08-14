import assert from "node:assert/strict";
import test from "node:test";
import { buildPersonalTaskQueue } from "../lib/domain/task-queue.ts";
import type { Task } from "../lib/types.ts";

const task = (overrides: Partial<Task>): Task => ({
  id: "TASK-001",
  owner: "Вера",
  direction: "PRODUCT",
  goalId: "GOAL-001",
  milestoneId: "",
  title: "Задача",
  whyNow: "",
  expectedResult: "",
  acceptanceCriteria: "",
  priority: "P0",
  status: "READY",
  dependsOn: [],
  deadline: "13.08.2026",
  source: "",
  fixationId: "",
  result: "",
  lastUpdated: "",
  delegableTo: "",
  decisionLevel: "",
  workMode: "",
  launchGate: "YES",
  waitingFor: "",
  nextCheckDate: "",
  projectFocus: false,
  contextId: "",
  handoffTo: "",
  blockedBy: [],
  unlocks: [],
  isOverdue: false,
  launchCritical: false,
  ...overrides
});

test("queue contains only open and currently available employee tasks", () => {
  const tasks = [
    task({ id: "TASK-001" }),
    task({ id: "TASK-002", blockedBy: ["TASK-001"] }),
    task({ id: "TASK-003", owner: "Никита" }),
    task({ id: "TASK-004", status: "BACKLOG" })
  ];

  assert.deepEqual(buildPersonalTaskQueue(tasks, "Вера", {}).map((item) => item.id), ["TASK-001"]);
});

test("done signal removes a task and opens its dependent task", () => {
  const tasks = [
    task({ id: "TASK-001" }),
    task({ id: "TASK-002", blockedBy: ["TASK-001"] })
  ];

  assert.deepEqual(buildPersonalTaskQueue(tasks, "Вера", { "TASK-001": "done" }).map((item) => item.id), ["TASK-002"]);
});

test("waiting and blocked tasks remain in queue but move behind actionable tasks", () => {
  const tasks = [
    task({ id: "TASK-001", deadline: "12.08.2026" }),
    task({ id: "TASK-002", deadline: "14.08.2026" }),
    task({ id: "TASK-003", deadline: "11.08.2026", status: "BLOCKED" })
  ];

  assert.deepEqual(buildPersonalTaskQueue(tasks, "Вера", { "TASK-001": "waiting" }).map((item) => item.id), ["TASK-002", "TASK-003", "TASK-001"]);
});

test("new fact keeps the task active without lowering it as a pause", () => {
  const tasks = [
    task({ id: "TASK-001", deadline: "12.08.2026" }),
    task({ id: "TASK-002", deadline: "14.08.2026" })
  ];

  assert.deepEqual(buildPersonalTaskQueue(tasks, "Вера", { "TASK-001": "fact" }).map((item) => item.id), ["TASK-001", "TASK-002"]);
});
