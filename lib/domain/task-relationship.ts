import { samePerson } from "../person-assets.ts";
import type { Task } from "../types.ts";

export type TaskRelationshipFocus = {
  incoming: Task[];
  outgoing: Task[];
  ownTaskIds: Set<string>;
  highlightedTaskIds: Set<string>;
};

export function buildTaskRelationshipFocus(
  task: Task,
  tasks: Task[],
  personName: string
): TaskRelationshipFocus {
  const byId = new Map(tasks.map((item) => [item.id, item]));
  const incoming = task.dependsOn.map((id) => byId.get(id)).filter(isTask);
  const outgoingIds = new Set([
    ...task.unlocks,
    ...tasks.filter((item) => item.dependsOn.includes(task.id)).map((item) => item.id)
  ]);
  const outgoing = [...outgoingIds].map((id) => byId.get(id)).filter(isTask);
  const ownTaskIds = new Set(tasks.filter((item) => samePerson(item.owner, personName)).map((item) => item.id));
  const highlightedTaskIds = new Set([
    ...ownTaskIds,
    task.id,
    ...incoming.map((item) => item.id),
    ...outgoing.map((item) => item.id)
  ]);

  return { incoming, outgoing, ownTaskIds, highlightedTaskIds };
}

export function tasksInPersonalRelationshipView(tasks: Task[], personName: string): Set<string> {
  const ownTasks = tasks.filter((task) => samePerson(task.owner, personName));
  const visibleIds = new Set(ownTasks.map((task) => task.id));
  ownTasks.forEach((task) => {
    task.dependsOn.forEach((id) => visibleIds.add(id));
    task.unlocks.forEach((id) => visibleIds.add(id));
  });
  tasks.forEach((task) => {
    if (task.dependsOn.some((id) => visibleIds.has(id))) visibleIds.add(task.id);
  });
  return visibleIds;
}

function isTask(task: Task | undefined): task is Task {
  return Boolean(task);
}
