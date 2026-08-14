import { parseDate } from "../date.ts";
import type { Task } from "../types.ts";

export type LocalTaskSignal = "stuck" | "waiting" | "fact" | "done";

const inactiveStatuses = new Set(["DONE", "CANCELLED", "BACKLOG"]);
const priorityRank: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };

export function buildPersonalTaskQueue(
  tasks: Task[],
  personName: string,
  signals: Record<string, LocalTaskSignal>
): Task[] {
  const taskMap = new Map(tasks.map((task) => [task.id, task]));
  const isComplete = (task: Task | undefined) => Boolean(
    task && (inactiveStatuses.has(task.status) || signals[task.id] === "done")
  );

  return tasks
    .filter((task) => task.owner.trim().toLowerCase() === personName.trim().toLowerCase())
    .filter((task) => !inactiveStatuses.has(task.status) && signals[task.id] !== "done")
    .filter((task) => task.blockedBy.every((dependencyId) => isComplete(taskMap.get(dependencyId))))
    .sort((a, b) => compareQueueTasks(a, b, signals, personName));
}

export function isTaskPausedForPerson(
  task: Task,
  signals: Record<string, LocalTaskSignal>,
  personName: string
): boolean {
  const handedOffForReview = task.status === "REVIEW"
    && Boolean(task.handoffTo.trim())
    && !task.handoffTo.toLocaleLowerCase("ru").includes(personName.trim().toLocaleLowerCase("ru"));
  return task.status === "WAITING_EXTERNAL"
    || handedOffForReview
    || signals[task.id] === "waiting"
    || signals[task.id] === "stuck";
}

function compareQueueTasks(a: Task, b: Task, signals: Record<string, LocalTaskSignal>, personName: string) {
  const pausedDifference = pausedRank(a, signals, personName) - pausedRank(b, signals, personName);
  if (pausedDifference) return pausedDifference;

  const deadlineDifference = deadlineRank(a.deadline) - deadlineRank(b.deadline);
  if (deadlineDifference) return deadlineDifference;

  const priorityDifference = (priorityRank[a.priority] ?? 4) - (priorityRank[b.priority] ?? 4);
  if (priorityDifference) return priorityDifference;

  if (a.projectFocus !== b.projectFocus) return a.projectFocus ? -1 : 1;

  const statusRank: Record<string, number> = { IN_PROGRESS: 0, READY: 1, REVIEW: 2, WAITING_EXTERNAL: 3 };
  const statusDifference = (statusRank[a.status] ?? 4) - (statusRank[b.status] ?? 4);
  if (statusDifference) return statusDifference;

  if (a.launchCritical !== b.launchCritical) return a.launchCritical ? -1 : 1;
  return a.id.localeCompare(b.id);
}

function pausedRank(task: Task, signals: Record<string, LocalTaskSignal>, personName: string) {
  return isTaskPausedForPerson(task, signals, personName) ? 1 : 0;
}

function deadlineRank(value: string) {
  return parseDate(value)?.getTime() ?? Number.MAX_SAFE_INTEGER;
}
