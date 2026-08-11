import type {
  DependencySummary,
  Goal,
  Milestone,
  Person,
  ProgressGate,
  ProjectGraph,
  ProjectGraphEdge,
  ProjectGraphNode,
  Task
} from "../types.ts";

const inactiveStatuses = new Set(["DONE", "CANCELLED", "BACKLOG"]);
const actionableStatuses = new Set(["IN_PROGRESS", "READY"]);

export function hydrateTaskDependencies(tasks: Task[], gates: ProgressGate[]): Task[] {
  const taskMap = new Map(tasks.map((task) => [task.id, task]));
  const unlocks = new Map<string, string[]>();

  tasks.forEach((task) => {
    task.dependsOn.forEach((dependencyId) => {
      if (!taskMap.has(dependencyId)) return;
      unlocks.set(dependencyId, [...(unlocks.get(dependencyId) || []), task.id]);
    });
  });

  return tasks.map((task) => ({
    ...task,
    blockedBy: task.dependsOn.filter((dependencyId) => {
      const dependency = taskMap.get(dependencyId);
      return Boolean(dependency && dependency.status !== "DONE");
    }),
    unlocks: unlocks.get(task.id) || [],
    launchCritical: gates.some((gate) => gate.active && gate.closedByTask === task.id)
  }));
}

export function selectCurrentTask(person: Person, tasks: Task[], gates: ProgressGate[]): Task | null {
  const owned = tasks.filter(
    (task) => ownerMatches(task.owner, person) && !inactiveStatuses.has(task.status)
  );
  const actionable = owned.filter((task) => actionableStatuses.has(task.status));
  const candidates = actionable.length
    ? actionable
    : owned.filter((task) => task.status === "WAITING_EXTERNAL").length
      ? owned.filter((task) => task.status === "WAITING_EXTERNAL")
      : owned;

  return [...candidates].sort((a, b) => compareTasks(a, b, tasks, gates))[0] || null;
}

export function buildDependencySummary(
  currentTask: Task | null,
  tasks: Task[],
  gates: ProgressGate[]
): DependencySummary {
  if (!currentTask) {
    return { blockedBy: [], unlocks: [], relatedGates: [], unlocksGates: [] };
  }

  const taskMap = new Map(tasks.map((task) => [task.id, task]));
  const relatedGates = gates.filter((gate) => gate.active && gate.closedByTask === currentTask.id);
  const relatedGateIds = new Set(relatedGates.map((gate) => gate.id));
  const unlocksGates = gates.filter(
    (gate) => gate.active && (
      gate.blockedBy.includes(currentTask.id) ||
      gate.dependsOnGate.some((gateId) => relatedGateIds.has(gateId))
    )
  );

  return {
    blockedBy: currentTask.blockedBy.map((id) => taskMap.get(id)).filter(isTask),
    unlocks: currentTask.unlocks.map((id) => taskMap.get(id)).filter(isTask),
    relatedGates,
    unlocksGates
  };
}

export function buildProjectGraph(
  goal: Goal | null,
  milestones: Milestone[],
  gates: ProgressGate[],
  tasks: Task[],
  people: Person[]
): ProjectGraph {
  const nodes: ProjectGraphNode[] = [];
  const edges: ProjectGraphEdge[] = [];
  const nodeIds = new Set<string>();

  const addNode = (node: ProjectGraphNode) => {
    if (nodeIds.has(node.id)) return;
    nodeIds.add(node.id);
    nodes.push(node);
  };
  const addEdge = (edge: ProjectGraphEdge) => {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) return;
    if (edges.some((item) => item.from === edge.from && item.to === edge.to && item.type === edge.type)) return;
    edges.push(edge);
  };

  if (goal) addNode({ id: goal.id, type: "GOAL", label: goal.title, status: goal.status });
  milestones.forEach((item) => addNode({ id: item.id, type: "MILESTONE", label: item.title, status: item.status }));
  gates.forEach((gate) => addNode({ id: gate.id, type: "GATE", label: gate.title, status: gate.status }));
  tasks.forEach((task) => addNode({ id: task.id, type: "TASK", label: task.title, status: task.status }));
  people.forEach((person) => addNode({ id: person.id, type: "PERSON", label: person.name, status: person.active ? "ACTIVE" : "INACTIVE" }));

  milestones.forEach((item) => addEdge({ from: item.goalId, to: item.id, type: "CONTAINS" }));
  gates.forEach((gate) => {
    addEdge({ from: gate.milestoneId, to: gate.id, type: "CONTAINS" });
    gate.dependsOnGate.forEach((dependencyId) => addEdge({ from: dependencyId, to: gate.id, type: "DEPENDS_ON" }));
    if (gate.closedByTask) addEdge({ from: gate.id, to: gate.closedByTask, type: "CLOSED_BY" });
  });
  tasks.forEach((task) => {
    if (!gates.some((gate) => gate.closedByTask === task.id)) {
      addEdge({ from: task.milestoneId, to: task.id, type: "CONTAINS" });
    }
    task.dependsOn.forEach((dependencyId) => addEdge({ from: dependencyId, to: task.id, type: "DEPENDS_ON" }));
    const owner = people.find((person) => ownerMatches(task.owner, person));
    if (owner) addEdge({ from: task.id, to: owner.id, type: "OWNED_BY" });
    const handoffTaskId = task.handoffTo.match(/TASK-\d+/)?.[0];
    if (handoffTaskId) addEdge({ from: task.id, to: handoffTaskId, type: "HANDOFF" });
  });

  return { nodes, edges };
}

function compareTasks(a: Task, b: Task, allTasks: Task[], gates: ProgressGate[]): number {
  if (a.projectFocus !== b.projectFocus) return a.projectFocus ? -1 : 1;

  const statusRank: Record<string, number> = { IN_PROGRESS: 0, READY: 1, REVIEW: 2, WAITING_EXTERNAL: 3 };
  const statusDifference = (statusRank[a.status] ?? 4) - (statusRank[b.status] ?? 4);
  if (statusDifference) return statusDifference;

  const impactDifference = taskImpactScore(b, allTasks, gates) - taskImpactScore(a, allTasks, gates);
  if (impactDifference) return impactDifference;

  const aLaunch = a.launchGate === "YES" || a.launchCritical;
  const bLaunch = b.launchGate === "YES" || b.launchCritical;
  if (aLaunch !== bLaunch) return aLaunch ? -1 : 1;

  const priorityRank: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3 };
  const priorityDifference = (priorityRank[a.priority] ?? 4) - (priorityRank[b.priority] ?? 4);
  if (priorityDifference) return priorityDifference;

  const deadlineDifference = sortableDate(a.deadline).localeCompare(sortableDate(b.deadline));
  return deadlineDifference || a.id.localeCompare(b.id);
}

function taskImpactScore(task: Task, tasks: Task[], gates: ProgressGate[]): number {
  const reverse = new Map<string, string[]>();
  tasks.forEach((item) => item.dependsOn.forEach((id) => reverse.set(id, [...(reverse.get(id) || []), item.id])));
  const queue = [...(reverse.get(task.id) || [])];
  const visited = new Set<string>();
  while (queue.length) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    queue.push(...(reverse.get(id) || []));
  }

  const activeTaskImpact = [...visited].filter((id) => {
    const downstream = tasks.find((item) => item.id === id);
    return downstream && !inactiveStatuses.has(downstream.status);
  }).length;
  const gateImpact = gates.filter(
    (gate) => gate.active && (gate.closedByTask === task.id || gate.blockedBy.includes(task.id))
  ).length;
  return activeTaskImpact + gateImpact;
}

function sortableDate(value: string): string {
  const match = value.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (!match) return "9999-12-31";
  return `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
}

function ownerMatches(owner: string, person: Person): boolean {
  return owner.trim().toLowerCase() === person.name.trim().toLowerCase() || owner === person.id;
}

function isTask(task: Task | undefined): task is Task {
  return Boolean(task);
}
