import { dashboardConfig } from "@/lib/config";
import { addDays, dateKey, isPastDeadline, nowInMoscow } from "@/lib/date";
import { buildDashboardDomain } from "@/lib/domain/dashboard-engine";
import { hydrateTaskDependencies } from "@/lib/domain/dependency-engine";
import type {
  ChangeEvent,
  DashboardState,
  Goal,
  Issue,
  Milestone,
  NowMove,
  Person,
  ProgressGate,
  RawSheetBundle,
  SourceStatus,
  Task,
  TaskContext
} from "@/lib/types";

const inactiveStatuses = new Set(["DONE", "CANCELLED"]);

export function normalizeDashboard(
  raw: RawSheetBundle,
  options: {
    dataMode?: DashboardState["dataMode"];
    goalId?: string;
    personName?: string;
    updatedAt?: string;
    usingSnapshot?: boolean;
  } = {}
): DashboardState {
  const goals = asRows(raw.goals).map<Goal>((row) => ({
    id: row.GOAL_ID,
    title: row.GOAL,
    why: row.WHY,
    successMetric: row.SUCCESS_METRIC,
    targetDate: row.TARGET_DATE,
    owner: row.OWNER,
    status: row.STATUS,
    priority: row.PRIORITY,
    notes: row.NOTES,
    lastUpdated: row.LAST_UPDATED,
    baselineTargetDate: row.BASELINE_TARGET_DATE || row.TARGET_DATE,
    currentForecastDate: row.CURRENT_FORECAST_DATE || row.BASELINE_TARGET_DATE || row.TARGET_DATE,
    baselineScopePoints: asNumber(row.BASELINE_SCOPE_POINTS),
    currentScopePoints: asNumber(row.CURRENT_SCOPE_POINTS),
    scopeVersion: row.SCOPE_VERSION,
    verifiedPoints: asNumber(row.VERIFIED_POINTS),
    readyPercent: asNumber(row.READY_PERCENT),
    forecastDeltaDays: asNumber(row.FORECAST_DELTA_DAYS)
  }));

  const milestones = asRows(raw.milestones).map<Milestone>((row) => ({
    id: row.MILESTONE_ID || row.ID,
    goalId: row.GOAL_ID,
    title: row.MILESTONE || row.TITLE,
    expectedResult: row.EXPECTED_RESULT,
    acceptanceCriteria: row.ACCEPTANCE_CRITERIA,
    owner: row.OWNER,
    status: row.STATUS,
    priority: row.PRIORITY,
    dependsOn: splitIds(row.DEPENDS_ON),
    deadline: row.TARGET_DATE || row.DEADLINE,
    lastUpdated: row.LAST_UPDATED
  }));

  const progressGates = asRows(raw.progressGates).map<ProgressGate>((row) => ({
    id: row.GATE_ID,
    goalId: row.GOAL_ID,
    milestoneId: row.MILESTONE_ID,
    title: row.GATE,
    baselinePoints: asNumber(row.BASELINE_POINTS),
    currentPoints: asNumber(row.CURRENT_POINTS),
    status: row.STATUS || "OPEN",
    dependsOnGate: splitIds(row.DEPENDS_ON_GATE),
    evidenceRef: row.EVIDENCE_REF,
    closedByTask: row.CLOSED_BY_TASK,
    blockedBy: splitIds(row.BLOCKED_BY),
    active: isYes(row.ACTIVE),
    lastChangeId: row.LAST_CHANGE_ID,
    verifiedAt: row.VERIFIED_AT,
    notes: row.NOTES
  }));

  const baseTasks = asRows(raw.tasks).map<Task>((row) => {
    const status = row.STATUS || "BACKLOG";
    const deadline = row.DEADLINE;
    return {
      id: row.TASK_ID,
      owner: row.OWNER,
      direction: row.DIRECTION,
      goalId: row.GOAL_ID,
      milestoneId: row.MILESTONE_ID,
      title: row.TASK,
      whyNow: row.WHY_NOW,
      expectedResult: row.EXPECTED_RESULT,
      acceptanceCriteria: row.ACCEPTANCE_CRITERIA,
      priority: row.PRIORITY,
      status,
      dependsOn: splitIds(row.DEPENDS_ON),
      deadline,
      source: row.SOURCE,
      fixationId: row.FIXATION_ID,
      result: row.RESULT,
      lastUpdated: row.LAST_UPDATED,
      delegableTo: row.DELEGABLE_TO,
      decisionLevel: row.DECISION_LEVEL,
      workMode: row.WORK_MODE,
      launchGate: row.LAUNCH_GATE || "NO",
      waitingFor: row.WAITING_FOR,
      nextCheckDate: row.NEXT_CHECK_DATE,
      projectFocus: isYes(row.PROJECT_FOCUS),
      contextId: row.CONTEXT_ID,
      handoffTo: row.HANDOFF_TO,
      blockedBy: [],
      unlocks: [],
      isOverdue: Boolean(deadline && !inactiveStatuses.has(status) && isPastDeadline(deadline)),
      launchCritical: false
    };
  });
  const tasks = hydrateTaskDependencies(baseTasks, progressGates);

  const taskContexts = asRows(raw.taskContexts).map<TaskContext>((row) => ({
    id: row.CONTEXT_ID,
    taskId: row.TASK_ID,
    canonicalRefs: splitIds(row.CANONICAL_REFS),
    doNotReopen: row.DO_NOT_REOPEN,
    currentWorkingState: row.CURRENT_WORKING_STATE,
    openQuestions: row.OPEN_QUESTIONS,
    handoffResult: row.HANDOFF_RESULT,
    handoffTo: row.HANDOFF_TO,
    updatedBy: row.UPDATED_BY,
    lastUpdated: row.LAST_UPDATED
  }));

  const changeEvents = asRows(raw.changeEvents).map<ChangeEvent>((row) => ({
    id: row.CHANGE_ID,
    dateTime: row.DATE_TIME,
    source: row.SOURCE,
    description: row.DESCRIPTION,
    impactType: row.IMPACT_TYPE,
    affectedGoalId: row.AFFECTED_GOAL_ID,
    affectedMilestoneId: row.AFFECTED_MILESTONE_ID,
    affectedGateId: row.AFFECTED_GATE_ID,
    scopeDeltaPoints: asNumber(row.SCOPE_DELTA_POINTS),
    forecastDateBefore: row.FORECAST_DATE_BEFORE,
    forecastDateAfter: row.FORECAST_DATE_AFTER,
    decisionStatus: row.DECISION_STATUS,
    approvedBy: row.APPROVED_BY,
    scopeVersionBefore: row.SCOPE_VERSION_BEFORE,
    scopeVersionAfter: row.SCOPE_VERSION_AFTER,
    notes: row.NOTES,
    forecastDeltaDays: asNumber(row.FORECAST_DELTA_DAYS)
  }));

  const people = asRows(raw.people).map<Person>((row) => ({
    id: row.PERSON_ID,
    name: row.NAME,
    role: row.ROLE,
    primaryDirection: row.PRIMARY_DIRECTION,
    responsibilities: row.RESPONSIBILITIES,
    currentFocus: row.CURRENT_FOCUS,
    notes: row.NOTES,
    active: isYes(row.ACTIVE)
  }));

  const issues = asRows(raw.issues).map<Issue>((row) => ({
    id: row.ISSUE_ID,
    title: row.TITLE,
    status: row.STATUS,
    severity: row.SEVERITY,
    owner: row.OWNER,
    type: row.TYPE,
    relatedTask: row.RELATED_TASK,
    currentFact: row.CURRENT_FACT,
    openQuestion: row.OPEN_QUESTION,
    blocksLaunch: row.BLOCKS_LAUNCH,
    nextAction: row.NEXT_ACTION,
    updatedAt: row.UPDATED_AT
  }));

  const now = asRows(raw.now).map<NowMove>((row) => ({
    id: row.TASK_ID,
    owner: row.OWNER,
    move: row["ТЕКУЩИЙ ХОД"],
    status: row.STATUS,
    deadline: row.DEADLINE,
    waitingFor: row.WAITING_FOR,
    nextCheckDate: row.NEXT_CHECK,
    launchGate: row.LAUNCH_GATE || "NO",
    whyNow: row["ПОЧЕМУ СЕЙЧАС"],
    unlocksText: row["ЧТО ОТКРОЕТ"],
    softLanguage: row["МЯГКАЯ ФОРМУЛИРОВКА"]
  }));

  const updatedAt = options.updatedAt || new Date().toISOString();
  const domain = buildDashboardDomain({
    goals,
    milestones,
    tasks,
    gates: progressGates,
    events: changeEvents,
    people,
    sources: raw.sources,
    goalId: options.goalId || dashboardConfig.launchGoalId,
    personName: options.personName || dashboardConfig.personName,
    updatedAt,
    usingSnapshot: options.usingSnapshot
  });

  const activeTasks = tasks.filter((task) => !inactiveStatuses.has(task.status));
  const taskMap = new Map(tasks.map((task) => [task.id, task]));
  const todayKey = dateKey(nowInMoscow().toISOString());
  const tomorrowKey = dateKey(addDays(nowInMoscow(), 1).toISOString());
  const sevenDaysKey = dateKey(addDays(nowInMoscow(), 7).toISOString());
  const datedTasks = activeTasks
    .filter((task) => dateKey(task.deadline))
    .sort((a, b) => String(dateKey(a.deadline)).localeCompare(String(dateKey(b.deadline))));
  const upcomingDeadlines = {
    overdue: datedTasks.filter((task) => task.isOverdue),
    today: datedTasks.filter((task) => dateKey(task.deadline) === todayKey && !task.isOverdue),
    tomorrow: datedTasks.filter((task) => dateKey(task.deadline) === tomorrowKey),
    next7Days: datedTasks.filter((task) => {
      const key = dateKey(task.deadline);
      return Boolean(key && todayKey && sevenDaysKey && key > tomorrowKey! && key <= sevenDaysKey);
    }),
    later: datedTasks.filter((task) => {
      const key = dateKey(task.deadline);
      return Boolean(key && sevenDaysKey && key > sevenDaysKey);
    })
  };

  const activePeople = people.filter((person) => person.active);
  const activePeopleWithNoTasks = activePeople.filter(
    (person) => !activeTasks.some((task) => task.owner === person.name)
  );
  const legacyDataHealth = {
    activeTasksWithoutDeadline: activeTasks.filter((task) => !task.deadline),
    tasksWithoutOwner: activeTasks.filter((task) => !task.owner),
    brokenDependsOn: tasks.flatMap((task) =>
      task.dependsOn.filter((dependencyId) => !taskMap.has(dependencyId)).map((missingTaskId) => ({ taskId: task.id, missingTaskId }))
    ),
    activePeopleWithNoTasks,
    staleSources: raw.sources.filter((source) => source.status !== "LIVE"),
    missingMilestones: activeTasks.filter(
      (task) => task.milestoneId && !milestones.some((item) => item.id === task.milestoneId)
    )
  };
  const team = activePeople.map((person) => {
    const ownedTasks = activeTasks.filter((task) => task.owner === person.name);
    const nearest = ownedTasks
      .filter((task) => task.deadline)
      .sort((a, b) => String(dateKey(a.deadline)).localeCompare(String(dateKey(b.deadline))))[0];
    const nextCheck = ownedTasks
      .filter((task) => task.nextCheckDate)
      .sort((a, b) => String(dateKey(a.nextCheckDate)).localeCompare(String(dateKey(b.nextCheckDate))))[0];
    return {
      person,
      currentFocus: ownedTasks.find((task) => task.projectFocus)?.title || person.currentFocus,
      nearestDeadline: nearest?.deadline || "",
      launchGateCount: progressGates.filter((gate) => gate.active && ownedTasks.some((task) => task.id === gate.closedByTask)).length,
      waitingExternal: ownedTasks.filter((task) => task.status === "WAITING_EXTERNAL"),
      readyCount: ownedTasks.filter((task) => task.status === "READY").length,
      inProgressCount: ownedTasks.filter((task) => task.status === "IN_PROGRESS").length,
      nextCheckDate: nextCheck?.nextCheckDate || "",
      scopeUnknown: activePeopleWithNoTasks.some((item) => item.id === person.id)
    };
  });
  const dependencyGraph = tasks.reduce<Record<string, { blockedBy: string[]; unlocks: string[] }>>((graph, task) => {
    graph[task.id] = { blockedBy: task.blockedBy, unlocks: task.unlocks };
    return graph;
  }, {});

  return {
    dataMode: options.dataMode || (dashboardConfig.dataSource === "google" ? "google" : "mock"),
    person: domain.person,
    currentTask: domain.currentTask,
    goal: domain.goal,
    progress: domain.progress,
    dependencies: domain.dependencies,
    waiting: domain.waiting,
    recentChange: domain.recentChange,
    dataHealth: domain.dataHealth,
    updatedAt,
    goals: domain.goal ? goals.map((goal) => goal.id === domain.goal!.id ? domain.goal! : goal) : goals,
    milestones,
    tasks,
    taskContexts,
    progressGates,
    changeEvents,
    people,
    issues,
    reviews: [],
    audits: [],
    creatorPipeline: [],
    now,
    sources: raw.sources,
    derived: {
      goal002: domain.goal,
      projectFocus: [...tasks.filter((task) => task.projectFocus), ...now.filter((move) => move.id === "DATA-GAP")],
      launchGates: tasks.filter((task) => task.launchGate === "YES"),
      overdueTasks: tasks.filter((task) => task.isOverdue),
      waitingExternal: tasks.filter((task) => task.status === "WAITING_EXTERNAL"),
      upcomingDeadlines,
      dataHealth: legacyDataHealth,
      team,
      openIssues: issues.filter((issue) => !issue.status.startsWith("CLOSED")),
      dependencyGraph,
      projectGraph: domain.projectGraph,
      creatorStats: { total: 0, withContact: 0, targetMin: 0, targetMax: 0, largest: [] }
    }
  };
}

export function makeSourceStatus(name: SourceStatus["name"], ok: boolean, error?: string): SourceStatus {
  const now = new Date().toISOString();
  return {
    name,
    status: ok ? "LIVE" : "SOURCE_ERROR",
    lastFetchedAt: now,
    lastSuccessfulFetchAt: ok ? now : null,
    error
  };
}

function asRows(rows: string[][]): Array<Record<string, string>> {
  const [headers = [], ...body] = rows;
  return body
    .filter((row) => row.some((cell) => String(cell || "").trim()))
    .map((row) => headers.reduce<Record<string, string>>((record, header, index) => {
      record[String(header || "").trim()] = String(row[index] || "").trim();
      return record;
    }, {}));
}

function splitIds(value = ""): string[] {
  return value
    .split(/[,;]/)
    .flatMap((item) => item.split(String.fromCharCode(10)))
    .map((item) => item.trim())
    .filter(Boolean);
}

function asNumber(value = ""): number {
  const normalized = value.replace(/\s/g, "").replace("%", "").replace(",", ".");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isYes(value = ""): boolean {
  return ["YES", "TRUE", "1"].includes(value.trim().toUpperCase());
}
