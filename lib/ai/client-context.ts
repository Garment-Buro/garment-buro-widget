import type { TaskAssistantClientContext } from "@/lib/ai/types";
import type { DashboardState } from "@/lib/types";

export function buildTaskAssistantClientContext(
  state: DashboardState,
  taskId: string
): TaskAssistantClientContext {
  const task = state.tasks.find((item) => item.id === taskId);
  if (!task) throw new Error(`Задача ${taskId} отсутствует в текущих данных.`);
  if (!state.person) throw new Error("Сотрудник не найден в текущих данных.");

  const relatedIds = new Set([task.id, ...task.dependsOn, ...task.blockedBy, ...task.unlocks]);
  return {
    personName: state.person.name,
    task,
    taskContext: state.taskContexts.find((item) => item.taskId === task.id) || null,
    relatedTasks: state.tasks.filter((item) => item.id !== task.id && relatedIds.has(item.id)),
    goal: state.goals.find((item) => item.id === task.goalId) || state.goal,
    progress: state.progress,
    recentChanges: state.changeEvents
      .filter((item) => !item.affectedGoalId || item.affectedGoalId === task.goalId)
      .slice(-10),
    relatedIssues: state.issues.filter((item) => item.relatedTask === task.id),
    dataHealth: state.dataHealth,
    sources: state.sources,
    dashboardUpdatedAt: state.updatedAt
  };
}
