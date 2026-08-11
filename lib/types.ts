export type TaskStatus =
  | "BACKLOG"
  | "READY"
  | "IN_PROGRESS"
  | "WAITING_EXTERNAL"
  | "BLOCKED"
  | "REVIEW"
  | "DONE"
  | "CANCELLED"
  | "NEEDS_SCOPE"
  | string;

export type GateStatus = "OPEN" | "BLOCKED" | "DATA_GAP" | "READY_TO_VERIFY" | "VERIFIED_DONE" | string;
export type LaunchGate = "YES" | "NO" | "IF_CAPACITY" | string;
export type SourceName = "execution" | "control";
export type DataHealthCode =
  | "STALE_DATA"
  | "PARTIAL_SOURCE_ERROR"
  | "DATA_GAP"
  | "INVALID_DEPENDENCY"
  | "MISSING_OWNER"
  | "MISSING_DEADLINE"
  | "UNKNOWN_GATE_REFERENCE";

export interface Goal {
  id: string;
  title: string;
  why: string;
  successMetric: string;
  targetDate: string;
  owner: string;
  status: string;
  priority: string;
  notes: string;
  lastUpdated: string;
  baselineTargetDate: string;
  currentForecastDate: string;
  baselineScopePoints: number;
  currentScopePoints: number;
  scopeVersion: string;
  verifiedPoints: number;
  readyPercent: number;
  forecastDeltaDays: number;
}

export interface Milestone {
  id: string;
  goalId: string;
  title: string;
  expectedResult: string;
  acceptanceCriteria: string;
  owner: string;
  status: string;
  priority: string;
  dependsOn: string[];
  deadline: string;
  lastUpdated: string;
}

export interface Task {
  id: string;
  owner: string;
  direction: string;
  goalId: string;
  milestoneId: string;
  title: string;
  whyNow: string;
  expectedResult: string;
  acceptanceCriteria: string;
  priority: string;
  status: TaskStatus;
  dependsOn: string[];
  deadline: string;
  source: string;
  fixationId: string;
  result: string;
  lastUpdated: string;
  delegableTo: string;
  decisionLevel: string;
  workMode: string;
  launchGate: LaunchGate;
  waitingFor: string;
  nextCheckDate: string;
  projectFocus: boolean;
  contextId: string;
  handoffTo: string;
  blockedBy: string[];
  unlocks: string[];
  isOverdue: boolean;
  launchCritical: boolean;
}

export interface TaskContext {
  id: string;
  taskId: string;
  canonicalRefs: string[];
  doNotReopen: string;
  currentWorkingState: string;
  openQuestions: string;
  handoffResult: string;
  handoffTo: string;
  updatedBy: string;
  lastUpdated: string;
}

export interface ProgressGate {
  id: string;
  goalId: string;
  milestoneId: string;
  title: string;
  baselinePoints: number;
  currentPoints: number;
  status: GateStatus;
  dependsOnGate: string[];
  evidenceRef: string;
  closedByTask: string;
  blockedBy: string[];
  active: boolean;
  lastChangeId: string;
  verifiedAt: string;
  notes: string;
}

export interface ChangeEvent {
  id: string;
  dateTime: string;
  source: string;
  description: string;
  impactType: string;
  affectedGoalId: string;
  affectedMilestoneId: string;
  affectedGateId: string;
  scopeDeltaPoints: number;
  forecastDateBefore: string;
  forecastDateAfter: string;
  decisionStatus: string;
  approvedBy: string;
  scopeVersionBefore: string;
  scopeVersionAfter: string;
  notes: string;
  forecastDeltaDays: number;
}

export interface Person {
  id: string;
  name: string;
  role: string;
  primaryDirection: string;
  responsibilities: string;
  currentFocus: string;
  notes: string;
  active: boolean;
}

export interface Issue {
  id: string;
  title: string;
  status: string;
  severity: string;
  owner: string;
  type: string;
  relatedTask: string;
  currentFact: string;
  openQuestion: string;
  blocksLaunch: string;
  nextAction: string;
  updatedAt: string;
}

export interface Review {
  id: string;
  title: string;
  status: string;
}

export interface Audit {
  id: string;
  title: string;
  status: string;
}

export interface CreatorCandidate {
  profile: string;
  name: string;
  link: string;
  description: string;
  contact: string;
  followers: number;
  activity: string;
  reach: string;
  hasMerch: string;
  canMakeMerch: string;
  merchIdea: string;
}

export interface NowMove {
  id: string;
  owner: string;
  move: string;
  status: TaskStatus;
  deadline: string;
  waitingFor: string;
  nextCheckDate: string;
  launchGate: LaunchGate;
  whyNow: string;
  unlocksText: string;
  softLanguage: string;
}

export interface SourceStatus {
  name: SourceName;
  status: "LIVE" | "STALE" | "SOURCE_ERROR";
  lastFetchedAt: string;
  lastSuccessfulFetchAt: string | null;
  error?: string;
}

export interface TeamSummary {
  person: Person;
  currentFocus: string;
  nearestDeadline: string;
  launchGateCount: number;
  waitingExternal: Task[];
  readyCount: number;
  inProgressCount: number;
  nextCheckDate: string;
  scopeUnknown: boolean;
}

export interface LegacyDataHealth {
  activeTasksWithoutDeadline: Task[];
  tasksWithoutOwner: Task[];
  brokenDependsOn: Array<{ taskId: string; missingTaskId: string }>;
  activePeopleWithNoTasks: Person[];
  staleSources: SourceStatus[];
  missingMilestones: Task[];
}

export interface ProgressSummary {
  verifiedPoints: number;
  currentScopePoints: number;
  readyPercent: number;
  taskPotentialPoints: number;
  taskPotentialPercent: number;
  afterTaskPercent: number;
  scopeDeltaPoints: number;
  forecastDeltaDays: number;
  potentialKind: "CLOSES_GATE" | "OPENS_GATE" | "OPENS_TASK" | "NONE";
  potentialLabel: string;
}

export interface DependencySummary {
  blockedBy: Task[];
  unlocks: Task[];
  relatedGates: ProgressGate[];
  unlocksGates: ProgressGate[];
}

export interface WaitingSummary {
  task: Task;
  waitingFor: string;
  nextCheckDate: string;
}

export interface DashboardDataHealth {
  codes: DataHealthCode[];
  details: string[];
  staleMinutes: number | null;
  usingSnapshot: boolean;
}

export interface ProjectGraphNode {
  id: string;
  type: "GOAL" | "MILESTONE" | "GATE" | "TASK" | "PERSON";
  label: string;
  status: string;
}

export interface ProjectGraphEdge {
  from: string;
  to: string;
  type: "CONTAINS" | "DEPENDS_ON" | "CLOSED_BY" | "OWNED_BY" | "HANDOFF";
}

export interface ProjectGraph {
  nodes: ProjectGraphNode[];
  edges: ProjectGraphEdge[];
}

export interface DashboardState {
  dataMode: "mock" | "google";
  person: Person | null;
  currentTask: Task | null;
  goal: Goal | null;
  progress: ProgressSummary;
  dependencies: DependencySummary;
  waiting: WaitingSummary | null;
  recentChange: ChangeEvent | null;
  dataHealth: DashboardDataHealth;
  updatedAt: string;
  goals: Goal[];
  milestones: Milestone[];
  tasks: Task[];
  taskContexts: TaskContext[];
  progressGates: ProgressGate[];
  changeEvents: ChangeEvent[];
  people: Person[];
  issues: Issue[];
  reviews: Review[];
  audits: Audit[];
  creatorPipeline: CreatorCandidate[];
  now: NowMove[];
  sources: SourceStatus[];
  derived: {
    goal002: Goal | null;
    projectFocus: Array<Task | NowMove>;
    launchGates: Task[];
    overdueTasks: Task[];
    waitingExternal: Task[];
    upcomingDeadlines: {
      overdue: Task[];
      today: Task[];
      tomorrow: Task[];
      next7Days: Task[];
      later: Task[];
    };
    dataHealth: LegacyDataHealth;
    team: TeamSummary[];
    openIssues: Issue[];
    dependencyGraph: Record<string, { blockedBy: string[]; unlocks: string[] }>;
    projectGraph: ProjectGraph;
    creatorStats: {
      total: number;
      withContact: number;
      targetMin: number;
      targetMax: number;
      largest: CreatorCandidate[];
    };
  };
}

export interface RawSheetBundle {
  goals: string[][];
  milestones: string[][];
  tasks: string[][];
  taskContexts: string[][];
  progressGates: string[][];
  changeEvents: string[][];
  people: string[][];
  issues: string[][];
  now: string[][];
  sources: SourceStatus[];
}
