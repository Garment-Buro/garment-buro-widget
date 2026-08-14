import type {
  ChangeEvent,
  DashboardDataHealth,
  Goal,
  Issue,
  ProgressSummary,
  SourceStatus,
  Task,
  TaskContext
} from "@/lib/types";

export type TaskAssistantMode = "start" | "blocker" | "ask" | "acceptance";

export interface TaskAssistantClientContext {
  personName: string;
  task: Task;
  taskContext: TaskContext | null;
  relatedTasks: Task[];
  goal: Goal | null;
  progress: ProgressSummary;
  recentChanges: ChangeEvent[];
  relatedIssues: Issue[];
  dataHealth: DashboardDataHealth;
  sources: SourceStatus[];
  dashboardUpdatedAt: string;
}

export interface TaskAssistantRequest {
  taskId: string;
  mode: TaskAssistantMode;
  message?: string;
  context?: TaskAssistantClientContext;
}

export interface TaskAssistantResponse {
  answer: string;
  model: string;
  reconciledAt: string;
  sources: string[];
  warnings: string[];
}
