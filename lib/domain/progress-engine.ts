import type {
  ChangeEvent,
  DependencySummary,
  Goal,
  ProgressGate,
  ProgressSummary,
  Task
} from "../types.ts";

const appliedDecisionStatuses = new Set(["APPROVED", "APPLIED"]);

export function calculateProgress(
  goal: Goal | null,
  gates: ProgressGate[],
  currentTask: Task | null,
  dependencies: DependencySummary,
  events: ChangeEvent[]
): { goal: Goal | null; progress: ProgressSummary; recentChange: ChangeEvent | null } {
  const activeGates = gates.filter((gate) => gate.active && (!goal || gate.goalId === goal.id));
  const currentScopePoints = activeGates.reduce((sum, gate) => sum + gate.currentPoints, 0);
  const verifiedPoints = activeGates
    .filter((gate) => gate.status === "VERIFIED_DONE")
    .reduce((sum, gate) => sum + gate.currentPoints, 0);
  const potentialGates = currentTask
    ? activeGates.filter((gate) => gate.closedByTask === currentTask.id && gate.status !== "VERIFIED_DONE")
    : [];
  const taskPotentialPoints = potentialGates.reduce((sum, gate) => sum + gate.currentPoints, 0);
  const readyPercent = percent(verifiedPoints, currentScopePoints);
  const taskPotentialPercent = percent(taskPotentialPoints, currentScopePoints);
  const afterTaskPercent = percent(verifiedPoints + taskPotentialPoints, currentScopePoints);
  const relevantEvents = events.filter(
    (event) => (!goal || event.affectedGoalId === goal.id) && appliedDecisionStatuses.has(event.decisionStatus)
  );
  const recentChange = relevantEvents.at(-1) || null;
  const latestScopeChange = [...relevantEvents].reverse().find((event) => event.scopeDeltaPoints !== 0);
  const latestForecastChange = [...relevantEvents].reverse().find(
    (event) => event.forecastDateBefore && event.forecastDateAfter && event.forecastDateBefore !== event.forecastDateAfter
  );

  let potentialKind: ProgressSummary["potentialKind"] = "NONE";
  let potentialLabel = "";
  if (taskPotentialPoints > 0) {
    potentialKind = "CLOSES_GATE";
    potentialLabel = `+${formatNumber(taskPotentialPercent)}% после проверки результата`;
  } else if (dependencies.unlocksGates.length) {
    const points = dependencies.unlocksGates.reduce((sum, gate) => sum + gate.currentPoints, 0);
    potentialKind = "OPENS_GATE";
    potentialLabel = `Открывает gate на ${formatNumber(points)} points`;
  } else if (dependencies.unlocks.length) {
    potentialKind = "OPENS_TASK";
    potentialLabel = `Открывает ${dependencies.unlocks.map((task) => task.id).join(" → ")}`;
  }

  const currentForecastDate = latestForecastChange?.forecastDateAfter || goal?.currentForecastDate || goal?.baselineTargetDate || "";
  const normalizedGoal = goal ? {
    ...goal,
    currentForecastDate,
    currentScopePoints,
    verifiedPoints,
    readyPercent,
    scopeVersion: recentChange?.scopeVersionAfter || goal.scopeVersion,
    forecastDeltaDays: latestForecastChange?.forecastDeltaDays || goal.forecastDeltaDays
  } : null;

  return {
    goal: normalizedGoal,
    recentChange,
    progress: {
      verifiedPoints,
      currentScopePoints,
      readyPercent,
      taskPotentialPoints,
      taskPotentialPercent,
      afterTaskPercent,
      scopeDeltaPoints: latestScopeChange?.scopeDeltaPoints || 0,
      forecastDeltaDays: latestForecastChange?.forecastDeltaDays || normalizedGoal?.forecastDeltaDays || 0,
      potentialKind,
      potentialLabel
    }
  };
}

function percent(points: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, round((points / total) * 100));
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
