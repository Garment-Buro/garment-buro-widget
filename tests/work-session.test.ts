import assert from "node:assert/strict";
import test from "node:test";
import {
  completePomodoro,
  createWorkSession,
  formatTimer,
  pauseWorkSession,
  pomodoroRemainingMs,
  resumeWorkSession,
  startPomodoro,
  workSessionElapsedMs
} from "../lib/domain/work-session.ts";

test("work session keeps elapsed time across pause and resume", () => {
  const started = createWorkSession("P-NIKITA", "TASK-031", "SESSION-1", 1_000);
  const paused = pauseWorkSession(started, 61_000);
  const resumed = resumeWorkSession(paused, 121_000);

  assert.equal(workSessionElapsedMs(paused, 100_000), 60_000);
  assert.equal(workSessionElapsedMs(resumed, 151_000), 90_000);
});

test("work session counts time when its timestamp is the Unix epoch", () => {
  const session = createWorkSession("P-NIKITA", "TASK-031", "SESSION-1", 0);
  assert.equal(workSessionElapsedMs(session, 30_000), 30_000);
});

test("pomodoro is derived from timestamps and survives a delayed render", () => {
  const session = startPomodoro(createWorkSession("P-NIKITA", "TASK-031", "SESSION-1", 0), 25, 10_000);
  assert.equal(pomodoroRemainingMs(session.pomodoro, 70_000), 24 * 60_000);
});

test("completed pomodoro increments the session counter", () => {
  const session = startPomodoro(createWorkSession("P-NIKITA", "TASK-031", "SESSION-1", 0), 1, 1_000);
  const completed = completePomodoro(session);
  assert.equal(completed.pomodoro?.completedCount, 1);
  assert.equal(completed.pomodoro?.status, "completed");
});

test("timer formatting supports session and pomodoro durations", () => {
  assert.equal(formatTimer(25 * 60_000 + 7_000), "25:07");
  assert.equal(formatTimer(3_661_000), "01:01:01");
});
