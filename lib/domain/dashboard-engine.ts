import { buildDependencySummary, buildProjectGraph, selectCurrentTask } from "./dependency-engine.ts";
import { calculateProgress } from "./progress-engine.ts";
import { normalizePersonName } from "../person-assets.ts";
import type {
  ChangeEvent,
  DashboardDataHealth,
  DataHealthCode,
  Goal,
  Milestone,
  Person,
  ProgressGate,
  SourceStatus,
  Task
} from "../types.ts";

export function buildDashboardDomain({
  goals,
  milestones,
  tasks,
  gates,
  events,
  people,
  sources,
  goalId,
  personName,
  updatedAt,
  usingSnapshot = false
}: {
  goals: Goal[];
  milestones: Milestone[];
  tasks: Task[];
  gates: ProgressGate[];
  events: ChangeEvent[];
  people: Person[];
  sources: SourceStatus[];
  goalId: string;
  personName: string;
  updatedAt: string;
  usingSnapshot?: boolean;
}) {
  const requestedPerson = normalizePersonName(personName);
  const exactPerson = people.find((item) => (
    normalizePersonName(item.name) === requestedPerson
    || normalizePersonName(item.id) === requestedPerson
  ));
  const firstNameMatches = people.filter((item) => normalizePersonName(item.name).split(/\s+/)[0] === requestedPerson);
  const person = exactPerson || (firstNameMatches.length === 1 ? firstNameMatches[0] : null);
  const selectedGoal = goals.find((item) => item.id === goalId) || null;
  const goalTasks = selectedGoal ? tasks.filter((task) => task.goalId === selectedGoal.id) : tasks;
  const goalGates = selectedGoal ? gates.filter((gate) => gate.goalId === selectedGoal.id) : gates;
  const currentTask = person ? selectCurrentTask(person, tasks, gates) : null;
  const dependencies = buildDependencySummary(currentTask, tasks, gates);
  const progressResult = calculateProgress(selectedGoal, goalGates, currentTask, dependencies, events);
  const waitingTask = currentTask?.status === "WAITING_EXTERNAL"
    ? currentTask
    : person
      ? tasks.find((task) => task.owner === person.name && task.status === "WAITING_EXTERNAL") || null
      : null;
  const projectGraph = buildProjectGraph(progressResult.goal, milestones, goalGates, goalTasks, people);
  const dataHealth = calculateDataHealth({
    person,
    tasks,
    gates: goalGates,
    people,
    milestones,
    sources,
    updatedAt,
    usingSnapshot
  });

  return {
    person,
    currentTask,
    goal: progressResult.goal,
    progress: progressResult.progress,
    dependencies,
    waiting: waitingTask ? {
      task: waitingTask,
      waitingFor: waitingTask.waitingFor,
      nextCheckDate: waitingTask.nextCheckDate
    } : null,
    recentChange: progressResult.recentChange,
    dataHealth,
    projectGraph
  };
}

function calculateDataHealth({
  person,
  tasks,
  gates,
  people,
  milestones,
  sources,
  updatedAt,
  usingSnapshot
}: {
  person: Person | null;
  tasks: Task[];
  gates: ProgressGate[];
  people: Person[];
  milestones: Milestone[];
  sources: SourceStatus[];
  updatedAt: string;
  usingSnapshot: boolean;
}): DashboardDataHealth {
  const codes = new Set<DataHealthCode>();
  const details: string[] = [];
  const taskIds = new Set(tasks.map((task) => task.id));
  const gateIds = new Set(gates.map((gate) => gate.id));
  const milestoneIds = new Set(milestones.map((item) => item.id));
  const personNames = new Set(people.map((item) => item.name));
  const sourceErrors = sources.filter((source) => source.status !== "LIVE");

  if (usingSnapshot || sourceErrors.length) {
    codes.add("STALE_DATA");
    sourceErrors.forEach((source) => details.push(`${source.name}: ${source.error || source.status}`));
  }
  if (sourceErrors.length && sourceErrors.length < sources.length) codes.add("PARTIAL_SOURCE_ERROR");

  const invalidDependencies = tasks.flatMap((task) => task.dependsOn.filter((id) => !taskIds.has(id)).map((id) => `${task.id} → ${id}`));
  if (invalidDependencies.length) {
    codes.add("INVALID_DEPENDENCY");
    details.push(`Неизвестные task dependencies: ${invalidDependencies.join(", ")}`);
  }

  const missingOwners = tasks.filter((task) => task.status !== "DONE" && (!task.owner || !personNames.has(task.owner)));
  if (missingOwners.length) {
    codes.add("MISSING_OWNER");
    details.push(`Нет owner: ${missingOwners.map((task) => task.id).join(", ")}`);
  }

  const missingDeadlines = tasks.filter(
    (task) => !["DONE", "CANCELLED", "BACKLOG"].includes(task.status) && !task.deadline
  );
  if (missingDeadlines.length) {
    codes.add("MISSING_DEADLINE");
    details.push(`Нет deadline: ${missingDeadlines.map((task) => task.id).join(", ")}`);
  }

  const unknownGateReferences = gates.flatMap((gate) => [
    ...gate.dependsOnGate.filter((id) => !gateIds.has(id)).map((id) => `${gate.id} → ${id}`),
    ...(gate.closedByTask && !taskIds.has(gate.closedByTask) ? [`${gate.id} → ${gate.closedByTask}`] : []),
    ...(gate.milestoneId && !milestoneIds.has(gate.milestoneId) ? [`${gate.id} → ${gate.milestoneId}`] : [])
  ]);
  if (unknownGateReferences.length) {
    codes.add("UNKNOWN_GATE_REFERENCE");
    details.push(`Неизвестные gate references: ${unknownGateReferences.join(", ")}`);
  }

  if (person && person.active && !tasks.some((task) => task.owner === person.name && !["DONE", "CANCELLED", "BACKLOG"].includes(task.status))) {
    codes.add("DATA_GAP");
    details.push(`${person.name}: SCOPE UNKNOWN`);
  }
  if (gates.some((gate) => gate.status === "DATA_GAP")) codes.add("DATA_GAP");

  const updatedMs = Date.parse(updatedAt);
  const staleMinutes = usingSnapshot && Number.isFinite(updatedMs)
    ? Math.max(0, Math.floor((Date.now() - updatedMs) / 60_000))
    : null;

  return { codes: [...codes], details, staleMinutes, usingSnapshot };
}
