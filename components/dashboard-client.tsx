"use client";

import {
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  BarChart3,
  Ban,
  Bell,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Clock3,
  Cloud,
  FilePlus2,
  FileText,
  Filter,
  Flag,
  Focus,
  Grid2X2,
  GitBranch,
  History,
  Layers3,
  Link2,
  ListChecks,
  LockKeyhole,
  Maximize2,
  Minus,
  Pause,
  Pin,
  PinOff,
  Play,
  RefreshCw,
  Search,
  Settings,
  Shirt,
  Sparkles,
  Square,
  Star,
  Target,
  Timer,
  Truck,
  UserRound,
  UsersRound,
  WalletCards,
  X,
  ZoomIn,
  ZoomOut,
  type LucideIcon
} from "lucide-react";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { formatDate } from "@/lib/date";
import { buildDependencySummary } from "@/lib/domain/dependency-engine";
import { calculateProgress } from "@/lib/domain/progress-engine";
import { buildTaskRelationshipFocus, tasksInPersonalRelationshipView } from "@/lib/domain/task-relationship";
import { activePushNotifications } from "@/lib/domain/notification-engine";
import { buildPersonalTaskQueue, isTaskPausedForPerson } from "@/lib/domain/task-queue";
import { formatTimer } from "@/lib/domain/work-session";
import { personAsset, samePerson } from "@/lib/person-assets";
import { rewardTierForPercent } from "@/lib/reward-tier";
import {
  createCommandId,
  submitTaskCommand,
  type TaskActionIntent,
  type TaskActionSaveResult,
  type TaskActionSubmission,
  type TaskCommandProgress
} from "@/lib/services/task-action-service";
import { useWorkSession } from "@/lib/use-work-session";
import type { DashboardState, DependencySummary, Person, ProgressGate, Task } from "@/lib/types";

export type { TaskActionSubmission } from "@/lib/services/task-action-service";

const refreshMs = 60_000;
const completedStatuses = new Set(["DONE", "CANCELLED"]);
type WorkspaceView = "personal" | "tree";
type TreeViewMode = "all" | "personal";
type MobileRouteMode = "mine" | "team" | "all";
type IconComponent = LucideIcon;
type TaskActionConfirmation = "idle" | "saving" | "success" | "error";
type TaskTimeEstimate = "up-to-2h" | "3-4h" | "5-7h" | "1d" | "2d-plus" | "custom";

type TaskActionDraft = {
  note: string;
  nextCheckDate: string;
};

const emptyTaskActionDraft = (): TaskActionDraft => ({
  note: "",
  nextCheckDate: ""
});

type LaneDefinition = {
  id: string;
  title: string;
  subtitle: string;
  icon: IconComponent;
  matches: (task: Task) => boolean;
};

const laneDefinitions: LaneDefinition[] = [
  {
    id: "legal",
    title: "Юр. база",
    subtitle: "Фундамент и легальность",
    icon: Layers3,
    matches: (task) => /ЮРИДИЧЕСК|ВЫПЛАТ/.test(task.direction)
  },
  {
    id: "payments",
    title: "Платежи",
    subtitle: "Деньги и расчёты",
    icon: WalletCards,
    matches: (task) => /ПЛАТЕЖ/.test(task.direction)
  },
  {
    id: "production",
    title: "Production flow",
    subtitle: "Производственный контур",
    icon: Shirt,
    matches: (task) => /ЛЕКАЛА|ПРОИЗВОДСТВО|ЛОГИСТИКА/.test(task.direction)
  },
  {
    id: "product",
    title: "Product flow",
    subtitle: "Конструктор и клиентский путь",
    icon: UsersRound,
    matches: (task) => /КОНСТРУКТОР|КОНТЕНТ|ПРОДУКТ/.test(task.direction)
  },
  {
    id: "growth",
    title: "Creator outreach",
    subtitle: "Рост и партнёрства",
    icon: Star,
    matches: (task) => /БИЗНЕС|ДИЗАЙН/.test(task.direction)
  }
];

export function DashboardClient({
  initialState,
  loadState,
  onExit,
  onConfirmTaskAction,
  accessToken,
  isAlwaysOnTop,
  onToggleAlwaysOnTop
}: {
  initialState: DashboardState;
  loadState?: () => Promise<DashboardState>;
  onExit?: () => void;
  onConfirmTaskAction?: (submission: TaskActionSubmission, onProgress?: (progress: TaskCommandProgress) => void) => Promise<TaskActionSaveResult | undefined>;
  accessToken?: string;
  isAlwaysOnTop?: boolean;
  onToggleAlwaysOnTop?: () => void;
}) {
  const [state, setState] = useState(initialState);
  const [view, setView] = useState<WorkspaceView>("personal");
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [focusedTaskId, setFocusedTaskId] = useState("");
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [treeSearch, setTreeSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [showFilters, setShowFilters] = useState(false);
  const [treeScale, setTreeScale] = useState(1);
  const [treeViewMode, setTreeViewMode] = useState<TreeViewMode>("all");

  const refresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      if (loadState) {
        setState(await loadState());
        return;
      }
      const response = await fetch("/api/dashboard", { cache: "no-store" });
      if (response.ok) setState((await response.json()) as DashboardState);
    } catch {
      // Preserve the current screen while the endpoint is temporarily unavailable.
    } finally {
      setIsRefreshing(false);
    }
  }, [loadState]);

  useEffect(() => {
    const timer = window.setInterval(refresh, refreshMs);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const person = state.person;
  const effectiveTasks = state.tasks;
  const taskQueue = useMemo(
    () => person ? buildPersonalTaskQueue(effectiveTasks, person.name, {}) : [],
    [effectiveTasks, person]
  );
  const currentTask = taskQueue.find((task) => task.id === focusedTaskId) || taskQueue[0] || state.currentTask;
  const ownedTasks = effectiveTasks.filter((task) => task.owner === person?.name && !completedStatuses.has(task.status));
  const downstream = currentTask ? collectDownstream(currentTask, effectiveTasks) : [];
  const focusedDependencies = currentTask
    ? buildDependencySummary(currentTask, effectiveTasks, state.progressGates)
    : state.dependencies;
  const focusedProgress = calculateProgress(
    state.goal,
    state.progressGates,
    currentTask,
    focusedDependencies,
    state.changeEvents
  ).progress;
  const directUnlocks = focusedDependencies.unlocks;
  const fallbackTask = ownedTasks.find(
    (task) => task.id !== currentTask?.id && !task.blockedBy.length && ["IN_PROGRESS", "READY"].includes(task.status)
  );
  const waitingTask = state.waiting?.task || ownedTasks.find((task) => task.status === "WAITING_EXTERNAL");
  const projectProgress = state.progress.readyPercent;
  const sprint = projectProgress < 34 ? 1 : projectProgress < 76 ? 2 : 3;
  const sourceTone = state.dataMode === "mock"
    ? "DEMO"
    : state.dataHealth.usingSnapshot
      ? `CACHE ${state.dataHealth.staleMinutes ?? 0} MIN`
    : state.sources.some((source) => source.status === "SOURCE_ERROR")
    ? "SOURCE ERROR"
    : state.sources.some((source) => source.status === "STALE")
      ? "STALE"
      : "LIVE";

  useEffect(() => {
    if (!taskQueue.length) return;
    if (!taskQueue.some((task) => task.id === focusedTaskId)) setFocusedTaskId(taskQueue[0].id);
  }, [focusedTaskId, taskQueue]);

  const confirmTaskAction = useCallback(async (submission: TaskActionSubmission, onProgress?: (progress: TaskCommandProgress) => void) => {
    let result: TaskActionSaveResult | undefined;
    if (onConfirmTaskAction) result = await onConfirmTaskAction(submission, onProgress);
    else result = await submitTaskCommand(submission, state, accessToken, onProgress);
    const refreshStartedAt = performance.now();
    void refresh().then(() => {
      const dashboardRefreshMs = Math.round(performance.now() - refreshStartedAt);
      if (result?.timings) result.timings.dashboardRefreshMs = dashboardRefreshMs;
      console.info("[dashboard refresh timing]", { dashboardRefreshMs });
    });
    return result;
  }, [accessToken, onConfirmTaskAction, refresh, state]);

  if (!person) {
    return (
      <main className="empty-state">
        <AlertTriangle size={28} />
        <h1>Сотрудник не найден</h1>
        <p>Проверьте имя в листе PEOPLE.</p>
      </main>
    );
  }

  if (!currentTask) {
    return (
      <main className="empty-state account-empty-state">
        <PersonArtwork person={person} variant="avatar" />
        <h1>{person.name}</h1>
        <p>Профиль активен. Задачи пока не назначены.</p>
      </main>
    );
  }

  return (
    <>
      {view === "personal" ? (
        <PersonalWorkspace
          state={state}
          person={person}
          currentTask={currentTask}
          taskQueue={taskQueue}
          dependencies={focusedDependencies}
          focusedProgress={focusedProgress}
          downstream={downstream}
          directUnlocks={directUnlocks}
          fallbackTask={fallbackTask}
          waitingTask={waitingTask}
          projectProgress={projectProgress}
          sprint={sprint}
          sourceTone={sourceTone}
          isRefreshing={isRefreshing}
          onRefresh={refresh}
          onOpenTree={() => setView("tree")}
          onOpenTask={setSelectedTask}
          onFocusTask={setFocusedTaskId}
          onExit={onExit || (() => window.location.assign("/widget"))}
          onConfirmTaskAction={confirmTaskAction}
          isAlwaysOnTop={isAlwaysOnTop}
          onToggleAlwaysOnTop={onToggleAlwaysOnTop}
        />
      ) : (
        <TaskTree
          state={state}
          person={person}
          currentTask={currentTask}
          projectProgress={projectProgress}
          search={treeSearch}
          statusFilter={statusFilter}
          showFilters={showFilters}
          scale={treeScale}
          viewMode={treeViewMode}
          onSearch={setTreeSearch}
          onFilter={setStatusFilter}
          onToggleFilters={() => setShowFilters((value) => !value)}
          onScale={setTreeScale}
          onViewMode={setTreeViewMode}
          onBack={() => setView("personal")}
          onCollapse={onExit || (() => window.location.assign("/widget"))}
          onOpenTask={setSelectedTask}
          isAlwaysOnTop={isAlwaysOnTop}
          onToggleAlwaysOnTop={onToggleAlwaysOnTop}
        />
      )}
      {selectedTask ? (
        <TaskDrawer
          task={selectedTask}
          allTasks={state.tasks}
          state={state}
          onConfirmTaskAction={confirmTaskAction}
          onClose={() => setSelectedTask(null)}
        />
      ) : null}
    </>
  );
}

function PersonalWorkspace({
  state,
  person,
  currentTask,
  taskQueue,
  dependencies,
  focusedProgress,
  directUnlocks,
  fallbackTask,
  waitingTask,
  projectProgress,
  sprint,
  sourceTone,
  isRefreshing,
  onRefresh,
  onOpenTree,
  onOpenTask,
  onFocusTask,
  onExit,
  onConfirmTaskAction,
  isAlwaysOnTop,
  onToggleAlwaysOnTop
}: {
  state: DashboardState;
  person: Person;
  currentTask: Task;
  taskQueue: Task[];
  dependencies: DependencySummary;
  focusedProgress: DashboardState["progress"];
  downstream: Task[];
  directUnlocks: Task[];
  fallbackTask?: Task;
  waitingTask?: Task;
  projectProgress: number;
  sprint: number;
  sourceTone: string;
  isRefreshing: boolean;
  onRefresh: () => void;
  onOpenTree: () => void;
  onOpenTask: (task: Task) => void;
  onFocusTask: (taskId: string) => void;
  onExit: () => void;
  onConfirmTaskAction: (submission: TaskActionSubmission, onProgress?: (progress: TaskCommandProgress) => void) => Promise<TaskActionSaveResult | undefined>;
  isAlwaysOnTop?: boolean;
  onToggleAlwaysOnTop?: () => void;
}) {
  const [taskAction, setTaskAction] = useState<TaskActionIntent | null>(null);
  const [taskActionDraft, setTaskActionDraft] = useState<TaskActionDraft>(emptyTaskActionDraft);
  const [confirmation, setConfirmation] = useState<TaskActionConfirmation>("idle");
  const [commandFeedback, setCommandFeedback] = useState("");
  const [commandProgress, setCommandProgress] = useState<TaskCommandProgress | null>(null);
  const [commandElapsedSeconds, setCommandElapsedSeconds] = useState(0);
  const [pomodoroMinutes, setPomodoroMinutes] = useState(25);
  const [mobileDockPanel, setMobileDockPanel] = useState<"calls" | "pushes" | "blockers" | null>(null);
  const [timeEstimate, setTimeEstimate] = useState("");
  const [showCustomEstimate, setShowCustomEstimate] = useState(false);
  const [customEstimate, setCustomEstimate] = useState("");
  const workSession = useWorkSession(person.id);
  const activeSession = workSession.session?.taskId === currentTask.id ? workSession.session : null;
  const goal = state.goal;
  const waitingOwners = unique(directUnlocks.map((task) => task.owner).filter((owner) => owner && owner !== person.name));
  const handoffLabel = currentTask.deadline ? `Срок ${shortDate(currentTask.deadline)}` : "Срок не задан";
  const taskImpact = focusedProgress.taskPotentialPercent;
  const afterTaskProgress = focusedProgress.afterTaskPercent;
  const trackerTier = rewardTierForPercent(taskImpact);
  const relatedIssue = state.issues.find((issue) => issue.relatedTask === currentTask.id);
  const currentIndex = Math.max(0, taskQueue.findIndex((task) => task.id === currentTask.id));
  const previousTask = currentIndex > 0 ? taskQueue[currentIndex - 1] : undefined;
  const nextTask = currentIndex < taskQueue.length - 1 ? taskQueue[currentIndex + 1] : undefined;
  const incoming = dependencies.blockedBy.slice(0, 2);
  const outgoingTasks = directUnlocks.slice(0, 2);
  const outgoingGates = dependencies.unlocksGates.slice(0, Math.max(0, 2 - outgoingTasks.length));
  const eventTask = waitingTask || currentTask;
  const eventDate = eventTask.nextCheckDate || eventTask.deadline;
  const pushNotifications = activePushNotifications(state.notifications || [], person.id);
  const waitingAndBlockedTasks = state.tasks.filter((task) => (
    samePerson(task.owner, person.name)
    && !completedStatuses.has(task.status)
    && (task.status === "WAITING_EXTERNAL" || task.status === "BLOCKED" || Boolean(task.waitingFor))
  ));
  const actionPreview = buildTaskActionPreview(taskAction, taskActionDraft, currentTask);
  const canAcceptTask = ["BACKLOG", "READY"].includes(currentTask.status);
  const canStartSession = currentTask.status === "IN_PROGRESS" && !activeSession;
  const suggestedTimeEstimate = suggestTaskTimeEstimate(currentTask);
  const actionNote = confirmation === "saving"
    ? `${commandProgress?.label || "Отправляем команду в GPT"} · ${commandElapsedSeconds} сек.`
    : confirmation === "success"
      ? commandFeedback || "GPT зафиксировала изменение. Dashboard обновляется в фоне."
      : confirmation === "error"
        ? commandFeedback || "GPT не смогла зафиксировать изменение. Повторите попытку."
      : actionPreview
        ? "Комментарий будет отправлен в GPT вместе с контекстом задачи."
        : taskAction
          ? "Добавьте короткий контекст для GPT."
          : "Все изменения задачи фиксирует GPT в Google Sheets.";

  useEffect(() => {
    if (confirmation !== "success") return;
    const timer = window.setTimeout(() => setConfirmation("idle"), 8_000);
    return () => window.clearTimeout(timer);
  }, [confirmation]);

  useEffect(() => {
    if (confirmation !== "saving") return;
    const startedAt = Date.now();
    setCommandElapsedSeconds(0);
    const timer = window.setInterval(() => {
      setCommandElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [confirmation]);

  useEffect(() => {
    setTaskAction(null);
    setTaskActionDraft(emptyTaskActionDraft());
    setCommandFeedback("");
    setCommandProgress(null);
    setConfirmation("idle");
  }, [currentTask.id]);

  useEffect(() => {
    const storageKey = taskEstimateStorageKey(person.id, currentTask.id);
    setTimeEstimate(window.localStorage.getItem(storageKey) || "");
    setShowCustomEstimate(false);
    setCustomEstimate("");
  }, [currentTask.id, person.id]);

  useEffect(() => {
    const handleEstimateUpdate = (event: Event) => {
      const detail = (event as CustomEvent<{ taskId: string; value: string }>).detail;
      if (detail?.taskId === currentTask.id) setTimeEstimate(detail.value);
    };
    window.addEventListener("garment-buro:task-estimate-updated", handleEstimateUpdate);
    return () => window.removeEventListener("garment-buro:task-estimate-updated", handleEstimateUpdate);
  }, [currentTask.id]);

  function selectTaskAction(intent: TaskActionIntent) {
    if (confirmation === "saving") return;
    if (intent !== taskAction) {
      setTaskActionDraft(emptyTaskActionDraft());
    }
    setTaskAction(intent);
    setCommandFeedback("");
    setConfirmation("idle");
  }

  function closeTaskAction() {
    if (confirmation === "saving") return;
    setTaskAction(null);
    setTaskActionDraft(emptyTaskActionDraft());
  }

  async function sendCommand(submission: TaskActionSubmission) {
    setConfirmation("saving");
    setCommandFeedback("");
    setCommandProgress({ stage: "connecting", label: "Подключаемся к рабочему пространству" });
    try {
      const result = await onConfirmTaskAction(submission, setCommandProgress);
      if (result?.timings) console.info("[task-command timings]", result.timings);
      setCommandFeedback(commandSuccessMessage(result));
      setConfirmation("success");
      return result;
    } catch (error) {
      setCommandFeedback(readErrorMessage(error, "Не удалось отправить команду GPT."));
      setConfirmation("error");
      throw error;
    }
  }

  async function acceptTask() {
    if (confirmation === "saving") return;
    await sendCommand({
      commandId: createCommandId("ACCEPT"),
      taskId: currentTask.id,
      intent: "accept",
      details: { note: `Я оценил задачу в ${timeEstimate} и принял ${currentTask.id} «${currentTask.title}» в работу.` },
      preview: `Принять ${currentTask.id} и изменить статус на IN_PROGRESS.`
    }).catch(() => undefined);
  }

  async function startWorkingSession() {
    if (confirmation === "saving" || activeSession) return;
    const sessionId = createCommandId("SESSION");
    const result = await sendCommand({
      commandId: createCommandId("SESSION-START"),
      taskId: currentTask.id,
      intent: "session_start",
      details: {
        note: `Я оценил задачу в ${timeEstimate} и начал рабочую сессию по ${currentTask.id} «${currentTask.title}».`,
        sessionId,
        sessionStartedAt: new Date().toISOString()
      },
      preview: `Начать рабочую сессию ${sessionId} по ${currentTask.id}.`
    }).catch(() => undefined);
    if (result) workSession.start(currentTask.id, result.sessionId || sessionId);
  }

  function confirmTimeEstimate(value: string) {
    const normalizedValue = value.trim();
    if (!normalizedValue) return;
    window.localStorage.setItem(taskEstimateStorageKey(person.id, currentTask.id), normalizedValue);
    setTimeEstimate(normalizedValue);
    setShowCustomEstimate(false);
  }

  async function confirmTaskAction() {
    if (!taskAction || !actionPreview || confirmation === "saving") return;
    const submission: TaskActionSubmission = {
      commandId: createCommandId(taskAction.toUpperCase()),
      taskId: currentTask.id,
      intent: taskAction,
      details: {
        note: taskActionDraft.note.trim(),
        nextCheckDate: taskActionDraft.nextCheckDate || undefined,
        acceptanceCriteria: taskAction === "done" ? currentTask.acceptanceCriteria || currentTask.expectedResult : undefined,
        sessionId: taskAction === "session_close" ? activeSession?.id : undefined,
        sessionStartedAt: taskAction === "session_close" && activeSession
          ? new Date(activeSession.startedAt).toISOString()
          : undefined,
        sessionDurationSeconds: taskAction === "session_close"
          ? Math.round(workSession.elapsedMs / 1000)
          : undefined,
        pomodoroCompleted: taskAction === "session_close"
          ? activeSession?.pomodoro?.completedCount || 0
          : undefined
      },
      preview: actionPreview
    };
    const result = await sendCommand(submission).catch(() => undefined);
    if (result) {
      setTaskAction(null);
      setTaskActionDraft(emptyTaskActionDraft());
      if (taskAction === "session_close") workSession.close();
    }
  }

  return (
    <main className="personal-page">
      <header className="mobile-identity">
        <PersonArtwork person={person} variant="avatar" />
        <div className="mobile-identity-copy">
          <strong>{person.name}</strong>
          <span><i /> онлайн</span>
        </div>
        <div className="mobile-identity-actions">
          <span className={`live-state ${sourceTone !== "LIVE" ? "is-warning" : ""}`}><i /> {sourceTone}</span>
          <button className="icon-button" onClick={onRefresh} disabled={isRefreshing} aria-label="Обновить данные" title="Обновить данные">
            <RefreshCw size={22} className={isRefreshing ? "spin" : ""} />
          </button>
        </div>
      </header>

      <aside className="identity-panel">
        <div className="identity-name-block">
          <p className="identity-name">{person.name}</p>
          <span className="identity-rule" aria-hidden><i /></span>
          <p className="identity-role">{person.role}</p>
        </div>
        <PersonArtwork person={person} variant="full" />
        <div className="identity-stats">
          <MetaRow icon={Clock3} label={handoffLabel} />
          <MetaRow icon={Focus} label="Project Focus" note={currentTask.direction || currentTask.title} />
          <MetaRow icon={Layers3} label={`Спринт ${sprint} / 3`} note={`${formatPercent(projectProgress)}% · +${formatPercent(taskImpact)}%`} accent />
        </div>
        <button className="identity-exit" type="button" onClick={onExit}><Minus size={19} /><span>Свернуть виджет</span></button>
      </aside>

      <section className="workspace-main">
        <header className="turn-header" id="mobile-focus">
          <div>
            <p className="screen-kicker">Личное рабочее пространство</p>
            <h1>Сейчас ваш ход</h1>
          </div>
          <div className="live-controls">
            <span className={`live-state ${sourceTone !== "LIVE" ? "is-warning" : ""}`}><i /> {sourceTone}</span>
            {onToggleAlwaysOnTop ? (
              <button
                className={`icon-button ${isAlwaysOnTop ? "is-active" : ""}`.trim()}
                onClick={onToggleAlwaysOnTop}
                aria-label={isAlwaysOnTop ? "Открепить окно" : "Закрепить поверх всех окон"}
                title={isAlwaysOnTop ? "Открепить окно" : "Закрепить поверх всех окон"}
                aria-pressed={isAlwaysOnTop}
              >
                {isAlwaysOnTop ? <PinOff size={17} /> : <Pin size={17} />}
              </button>
            ) : null}
            <button className="icon-button" onClick={onRefresh} disabled={isRefreshing} aria-label="Обновить данные" title="Обновить данные">
              <RefreshCw size={17} className={isRefreshing ? "spin" : ""} />
            </button>
          </div>
        </header>

        <section className="workspace-status-bar" aria-label="Статус текущей задачи">
          <div className="handoff-grid">
            <HandoffItem icon={AlertTriangle} label={currentTask.launchCritical ? "Критический ход" : statusLabel(currentTask.status)} />
            <HandoffItem icon={UsersRound} label={waitingOwners.length ? `Ждут ${waitingOwners.length} человека` : "Никто не ждёт"} />
            <HandoffItem icon={Link2} label={`Открывает ${directUnlocks.length} ${taskWord(directUnlocks.length)}`} />
            <HandoffItem icon={Clock3} label={handoffLabel} />
          </div>
        </section>

        <section className="task-stage" aria-label="Текущая задача">
          <button className="task-nav-button is-previous" type="button" onClick={() => previousTask && onFocusTask(previousTask.id)} disabled={!previousTask} aria-label="Предыдущая задача" title={previousTask ? `${previousTask.id}: ${previousTask.title}` : "Это первая задача в очереди"}>
            <ChevronLeft size={22} />
          </button>

          <article
            className="work-task-card"
            role="button"
            tabIndex={0}
            aria-label={`Открыть подробности задачи ${currentTask.id}`}
            onClick={(event) => {
              if ((event.target as HTMLElement).closest("button, input, select, textarea")) return;
              onOpenTask(currentTask);
            }}
            onKeyDown={(event) => {
              if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return;
              event.preventDefault();
              onOpenTask(currentTask);
            }}
          >
            <div className="work-task-copy">
              <span className="task-id-chip">{currentTask.id}</span>
              <h2 title={currentTask.title}>{displayTaskTitle(currentTask.title)}</h2>
              <p className="work-task-summary">{compactTaskDescription(currentTask.whyNow || currentTask.expectedResult)}</p>
            </div>

            <aside className={activeSession ? "task-action-panel has-session" : "task-action-panel"}>
              {!activeSession ? (
                <button
                  className="primary-task-action"
                  type="button"
                  disabled={confirmation === "saving" || !timeEstimate || (!canAcceptTask && !canStartSession)}
                  onClick={() => { void (canAcceptTask ? acceptTask() : startWorkingSession()); }}
                >
                  <Play size={22} />
                  <span>{canAcceptTask || currentTask.status === "IN_PROGRESS" ? "Взять задачу" : statusLabel(currentTask.status)}</span>
                </button>
              ) : null}

              {activeSession ? (
                <section className="work-session-card" aria-label="Активная рабочая сессия">
                  <header>
                    <div>
                      <span><Timer size={16} />Рабочая сессия</span>
                      <small>{activeSession.status === "active" ? "Сейчас в работе" : "Сессия на паузе"}</small>
                    </div>
                    <strong>{formatTimer(workSession.elapsedMs)}</strong>
                  </header>
                  <div className="work-session-actions">
                    <button type="button" onClick={activeSession.status === "active" ? workSession.pause : workSession.resume}>
                      {activeSession.status === "active" ? <Pause size={14} /> : <Play size={14} />}
                      {activeSession.status === "active" ? "Пауза" : "Продолжить"}
                    </button>
                    <button type="button" onClick={() => selectTaskAction("session_close")}><Square size={13} />Закрыть</button>
                  </div>
                  <div className="pomodoro-control">
                    <header>
                      <span><Timer size={14} />Pomodoro</span>
                      <small>{activeSession.pomodoro?.completedCount || 0} завершено</small>
                    </header>
                    <div className="pomodoro-presets" aria-label="Длительность Pomodoro">
                      {[15, 25, 50].map((minutes) => (
                        <button
                          className={pomodoroMinutes === minutes ? "is-selected" : ""}
                          type="button"
                          key={minutes}
                          onClick={() => setPomodoroMinutes(minutes)}
                        >
                          {minutes} мин
                        </button>
                      ))}
                    </div>
                    {activeSession.pomodoro && activeSession.pomodoro.status !== "completed" ? (
                      <div className="pomodoro-active-row">
                        <strong>{formatTimer(workSession.pomodoroRemainingMs)}</strong>
                        <button type="button" onClick={activeSession.pomodoro.status === "running" ? workSession.pausePomodoro : workSession.resumePomodoro}>
                          {activeSession.pomodoro.status === "running" ? <Pause size={13} /> : <Play size={13} />}
                          {activeSession.pomodoro.status === "running" ? "Пауза" : "Продолжить"}
                        </button>
                        <button type="button" onClick={() => workSession.startPomodoro(pomodoroMinutes)}>Заново</button>
                      </div>
                    ) : (
                      <button className="pomodoro-start" type="button" onClick={() => workSession.startPomodoro(pomodoroMinutes)}>
                        <Play size={13} />Запустить на {pomodoroMinutes} мин
                      </button>
                    )}
                  </div>
                </section>
              ) : null}

              <div className="task-action-grid">
                {canAcceptTask ? (
                  <TaskActionButton icon={Ban} label="Отклонить" active={taskAction === "reject"} disabled={confirmation === "saving"} onClick={() => selectTaskAction("reject")} />
                ) : (
                  <TaskActionButton icon={FilePlus2} label="Новый факт" active={taskAction === "fact"} disabled={confirmation === "saving"} onClick={() => selectTaskAction("fact")} />
                )}
                <TaskActionButton icon={CircleHelp} label="Застрял" active={taskAction === "stuck"} disabled={confirmation === "saving"} onClick={() => selectTaskAction("stuck")} />
                <TaskActionButton icon={Clock3} label="Жду" active={taskAction === "waiting"} disabled={confirmation === "saving"} onClick={() => selectTaskAction("waiting")} />
                <TaskActionButton icon={Check} label="Готово" active={taskAction === "done"} disabled={confirmation === "saving"} success onClick={() => selectTaskAction("done")} />
              </div>
              {taskAction ? (
                <TaskActionPopover
                  intent={taskAction}
                  draft={taskActionDraft}
                  acceptanceCriteria={currentTask.acceptanceCriteria || currentTask.expectedResult}
                  preview={actionPreview}
                  onDraftChange={setTaskActionDraft}
                  onClose={closeTaskAction}
                  onSubmit={() => { void confirmTaskAction(); }}
                  confirmation={confirmation}
                  feedback={commandFeedback}
                  progressLabel={actionNote}
                />
              ) : null}
              {!taskAction && (!activeSession || confirmation !== "idle") ? (
                <div className={`assistant-note ${confirmation === "success" ? "is-success" : ""} ${confirmation === "error" ? "is-error" : ""}`} aria-live="polite">
                  {confirmation === "success" ? <Check size={19} /> : confirmation === "error" ? <AlertTriangle size={19} /> : <Sparkles size={19} />}
                  <p>{actionNote}</p>
                </div>
              ) : null}
            </aside>

            <TimeEstimateSelector
              suggested={suggestedTimeEstimate}
              confirmed={timeEstimate}
              showCustom={showCustomEstimate}
              customValue={customEstimate}
              onSelect={(estimate) => {
                if (estimate === "custom") {
                  setShowCustomEstimate(true);
                  return;
                }
                confirmTimeEstimate(taskTimeEstimateLabel(estimate));
              }}
              onCustomChange={setCustomEstimate}
              onConfirmCustom={() => confirmTimeEstimate(customEstimate)}
            />
          </article>

          <button className="task-nav-button is-next" type="button" onClick={() => nextTask && onFocusTask(nextTask.id)} disabled={!nextTask} aria-label="Следующая задача" title={nextTask ? `${nextTask.id}: ${nextTask.title}` : "Это последняя доступная задача"}>
            <ChevronRight size={22} />
          </button>
        </section>

        <div className="task-position" aria-label="Положение задачи в очереди">
          {taskQueue.map((task, index) => {
            const paused = isTaskPausedForPerson(task, {}, person.name);
            return (
              <button
                key={task.id}
                className={`${task.id === currentTask.id ? "is-current" : ""} ${paused ? "is-paused" : ""}`.trim()}
                type="button"
                onClick={() => onFocusTask(task.id)}
                aria-label={`${task.id}: ${task.title}`}
                title={`${index + 1} из ${taskQueue.length}: ${task.id} · ${paused ? "на паузе" : "доступна"}`}
              >
                <i /><span>{task.id === currentTask.id ? "Текущая" : paused ? "На паузе" : "Доступна"}</span>
              </button>
            );
          })}
        </div>

        <button className="route-map" type="button" onClick={onOpenTree} aria-label="Открыть полное дерево задач">
          <div className="route-map-head">
            <strong>Миникарта пути до цели</strong><span title="Показаны только фактические связи задачи"><CircleHelp size={14} /></span><small>Открыть всё дерево <ArrowRight size={14} /></small>
          </div>
          <div className="route-flow">
            <RouteColumn label="Зависит от" side="incoming">
              {incoming.length ? incoming.map((task) => <RouteNode key={task.id} id={task.id} title={task.title} done={completedStatuses.has(task.status)} />) : <RouteNode id="—" title="Нет входящих зависимостей" muted />}
            </RouteColumn>
            <div className="route-current"><small>Текущий ход</small><RouteNode id={currentTask.id} title={currentTask.title} current /></div>
            <RouteColumn label="Откроет" side="outgoing">
              {outgoingTasks.map((task) => <RouteNode key={task.id} id={task.id} title={task.title} />)}
              {outgoingGates.map((gate) => <RouteNode key={gate.id} id={gate.id} title={gate.title} />)}
              {!outgoingTasks.length && !outgoingGates.length ? <RouteNode id="—" title="Следующий этап не зафиксирован" muted /> : null}
            </RouteColumn>
            <div className="route-goal"><small>Ведёт к цели</small><div><Flag size={22} /><span><small>{goal?.id || "GOAL"}</small><strong>{goal?.title || "MVP"}</strong><em>Готовность к запуску</em></span></div></div>
          </div>
        </button>
      </section>

      <aside className="workspace-rail">
        <section className={`workspace-progress-card sprint-tracker tracker-tier-${trackerTier}`}>
          <p className="sprint-tracker-title">Прогресс проекта</p>
          <ProgressGauge value={projectProgress} projectedValue={afterTaskProgress} contribution={taskImpact} />
          <p className="mobile-progress-after">После задачи: <b>{formatPercent(afterTaskProgress)}%</b></p>
          <p className="progress-explainer">* Потенциальный вклад после фиксации результата. Данные из Google Drive.</p>
        </section>

        <section className="workspace-side-card event-card" id="mobile-history">
          <div className="side-card-icon"><CalendarDays size={23} /></div>
          <div><h3>Ближайшее событие</h3><p>{eventTask.id} · контрольная проверка</p><span>{formatDate(eventDate)}</span><button type="button" onClick={() => onOpenTask(eventTask)}>Открыть задачу</button></div>
        </section>

        <section className="workspace-side-card blocked-card">
          <div className="side-card-icon"><Clock3 size={23} /></div>
          <div>
            <h3>Если упрёшься</h3>
            <p>{waitingTask?.waitingFor ? `Ждём: ${waitingTask.waitingFor}` : relatedIssue?.openQuestion || "Зафиксируй блокер и следующий проверяемый шаг."}</p>
            <span>Следующая проверка: {shortDate(waitingTask?.nextCheckDate || currentTask.nextCheckDate || currentTask.deadline)}</span>
            <button type="button" onClick={() => fallbackTask ? onOpenTask(fallbackTask) : setTaskAction("stuck")}>{fallbackTask ? `Открыть ${fallbackTask.id}` : "Зафиксировать блокер"}</button>
          </div>
        </section>

        <MobileRouteWindow
          state={state}
          person={person}
          currentTask={currentTask}
          taskQueue={taskQueue}
          progress={focusedProgress}
          onOpenTask={onOpenTask}
        />
      </aside>

      <footer className="workspace-footer" id="workspace-data-footer">
        <span><Cloud size={16} />Последняя фиксация: {updatedTime(state.updatedAt)}</span><i /><span>Данные из Google Drive</span>
        <button type="button" onClick={onRefresh} disabled={isRefreshing}><RefreshCw size={15} className={isRefreshing ? "spin" : ""} />Обновить</button>
        <small>{sourceTone === "LIVE" ? "Данные актуальны" : sourceTone}</small>
      </footer>

      {mobileDockPanel ? (
        <MobileStatusPanel
          mode={mobileDockPanel}
          eventTask={eventTask}
          eventDate={eventDate}
          notifications={pushNotifications}
          waitingTasks={waitingAndBlockedTasks}
          allTasks={state.tasks}
          onClose={() => setMobileDockPanel(null)}
          onOpenTask={(task) => { setMobileDockPanel(null); onOpenTask(task); }}
        />
      ) : null}

      <nav className="mobile-status-dock" aria-label="События проекта">
        <div
          className={`mobile-dock-progress tracker-tier-${trackerTier} ${taskImpact <= 0 ? "is-zero" : ""}`.trim()}
          style={{
            "--mobile-dock-progress": `${projectProgress}%`,
            "--mobile-dock-projected": `${afterTaskProgress}%`
          } as CSSProperties}
          aria-label={`Прогресс ${formatPercent(projectProgress)}%, после задачи ${formatPercent(afterTaskProgress)}%`}
        >
          <span>{formatPercent(projectProgress)}%</span>
          <div><i /><b /></div>
          <strong>+{formatPercent(taskImpact)}%</strong>
        </div>
        <button className={mobileDockPanel === "calls" ? "is-active" : ""} type="button" onClick={() => setMobileDockPanel((value) => value === "calls" ? null : "calls")}>
          <CalendarDays size={22} /><span>Созвоны</span>{eventDate ? <b>1</b> : null}
        </button>
        <button className={mobileDockPanel === "pushes" ? "is-active" : ""} type="button" onClick={() => setMobileDockPanel((value) => value === "pushes" ? null : "pushes")}>
          <Bell size={22} /><span>Пуши</span>{pushNotifications.length ? <b>{pushNotifications.length}</b> : null}
        </button>
        <button className={mobileDockPanel === "blockers" ? "is-active" : ""} type="button" onClick={() => setMobileDockPanel((value) => value === "blockers" ? null : "blockers")}>
          <AlertTriangle size={22} /><span>Ожидания</span>{waitingAndBlockedTasks.length ? <b>{waitingAndBlockedTasks.length}</b> : null}
        </button>
      </nav>
    </main>
  );
}

function MobileStatusPanel({
  mode,
  eventTask,
  eventDate,
  notifications,
  waitingTasks,
  allTasks,
  onClose,
  onOpenTask
}: {
  mode: "calls" | "pushes" | "blockers";
  eventTask: Task;
  eventDate: string;
  notifications: DashboardState["notifications"];
  waitingTasks: Task[];
  allTasks: Task[];
  onClose: () => void;
  onOpenTask: (task: Task) => void;
}) {
  const title = mode === "calls" ? "Созвоны и события" : mode === "pushes" ? "Пуши" : "Ожидания и блокеры";
  const Icon = mode === "calls" ? CalendarDays : mode === "pushes" ? Bell : AlertTriangle;

  return (
    <aside className="mobile-status-panel" aria-label={title}>
      <header>
        <span><Icon size={20} /></span>
        <strong>{title}</strong>
        <button type="button" onClick={onClose} aria-label="Закрыть"><X size={18} /></button>
      </header>

      <div className="mobile-status-panel-list">
        {mode === "calls" ? (
          <button type="button" onClick={() => onOpenTask(eventTask)}>
            <span><small>Ближайшее событие</small><strong>{eventTask.id} · контрольная проверка</strong></span>
            <time>{eventDate ? formatDate(eventDate) : "Дата уточняется"}</time>
            <ChevronRight size={18} />
          </button>
        ) : null}

        {mode === "pushes" && notifications.length === 0 ? <p className="mobile-status-empty">Новых уведомлений нет.</p> : null}
        {mode === "pushes" ? notifications.map((notification) => {
          const linkedTask = allTasks.find((task) => task.id === notification.taskId);
          const content = (
            <>
              <span><small>{notification.priority || "Уведомление"}</small><strong>{notification.title || notification.message}</strong></span>
              {notification.dueAt ? <time>{formatDate(notification.dueAt)}</time> : null}
              {linkedTask ? <ChevronRight size={18} /> : null}
            </>
          );
          return linkedTask
            ? <button type="button" key={notification.id} onClick={() => onOpenTask(linkedTask)}>{content}</button>
            : <div className="mobile-status-row" key={notification.id}>{content}</div>;
        }) : null}

        {mode === "blockers" && waitingTasks.length === 0 ? <p className="mobile-status-empty">Активных ожиданий и блокеров нет.</p> : null}
        {mode === "blockers" ? waitingTasks.map((task) => (
          <button type="button" key={task.id} onClick={() => onOpenTask(task)}>
            <span><small>{task.status === "BLOCKED" ? "Блокер" : "Ожидание"}</small><strong>{task.waitingFor || task.title}</strong></span>
            <time>{task.nextCheckDate ? `Проверка ${shortDate(task.nextCheckDate)}` : task.id}</time>
            <ChevronRight size={18} />
          </button>
        )) : null}
      </div>
    </aside>
  );
}

function MobileRouteWindow({
  state,
  person,
  currentTask,
  taskQueue,
  progress,
  onOpenTask
}: {
  state: DashboardState;
  person: Person;
  currentTask: Task;
  taskQueue: Task[];
  progress: DashboardState["progress"];
  onOpenTask: (task: Task) => void;
}) {
  const [mode, setMode] = useState<MobileRouteMode>("mine");
  const [hideDone, setHideDone] = useState(false);
  const relationshipIds = useMemo(
    () => tasksInPersonalRelationshipView(state.tasks, person.name),
    [person.name, state.tasks]
  );
  const routeTasks = useMemo(() => {
    let candidates: Task[];
    if (mode === "mine") {
      candidates = taskQueue;
    } else if (mode === "team") {
      candidates = state.tasks.filter((task) => relationshipIds.has(task.id));
    } else {
      candidates = state.tasks;
    }
    const uniqueTasks = Array.from(new Map(candidates.map((task) => [task.id, task])).values());
    return hideDone
      ? uniqueTasks.filter((task) => task.id === currentTask.id || !completedStatuses.has(task.status))
      : uniqueTasks;
  }, [currentTask, hideDone, mode, relationshipIds, state.tasks, taskQueue]);
  const routeGroups = mode === "mine"
    ? routeTasks.map((task, index) => ({ depth: index, tasks: [task] }))
    : buildMobileRouteGroups(routeTasks, state.tasks, currentTask.id);
  const taskContributions = useMemo(() => new Map(routeTasks.map((task) => {
    const dependencies = buildDependencySummary(task, state.tasks, state.progressGates);
    const taskProgress = calculateProgress(state.goal, state.progressGates, task, dependencies, state.changeEvents).progress;
    return [task.id, taskProgress.taskPotentialPercent];
  })), [routeTasks, state.changeEvents, state.goal, state.progressGates, state.tasks]);
  const currentGroupIndex = routeGroups.findIndex((group) => group.tasks.some((task) => task.id === currentTask.id));
  const hasBranch = routeGroups.some((group) => group.tasks.length > 1);
  const trackerTier = rewardTierForPercent(progress.taskPotentialPercent);
  const routeProgressStyle = {
    "--mobile-route-progress": `${state.progress.readyPercent}%`,
    "--mobile-route-projected": `${progress.afterTaskPercent}%`
  } as CSSProperties;
  const entryLabel = mode === "mine"
    ? `Личная очередь · ${routeTasks.length} ${taskWord(routeTasks.length)}`
    : mode === "team"
      ? "Команда · связанные задачи"
      : "Проект · все направления";

  return (
    <section className="mobile-route-window" id="mobile-route-window">
      <header className="mobile-route-header">
        <div><small>{person.name} · задачи по приоритету</small><strong>Мой маршрут</strong></div>
        <button
          type="button"
          className={hideDone ? "is-active" : ""}
          onClick={() => setHideDone((value) => !value)}
          aria-label={hideDone ? "Показать завершённые задачи" : "Скрыть завершённые задачи"}
          title={hideDone ? "Показать завершённые" : "Скрыть завершённые"}
          aria-pressed={hideDone}
        >
          <Filter size={19} />
        </button>
      </header>

      <div className="mobile-route-tabs" role="tablist" aria-label="Состав маршрута">
        <button type="button" role="tab" aria-selected={mode === "mine"} className={mode === "mine" ? "is-active" : ""} onClick={() => setMode("mine")}>Мой</button>
        <button type="button" role="tab" aria-selected={mode === "team"} className={mode === "team" ? "is-active" : ""} onClick={() => setMode("team")}>Команда</button>
        <button type="button" role="tab" aria-selected={mode === "all"} className={mode === "all" ? "is-active" : ""} onClick={() => setMode("all")}>Всё дерево</button>
      </div>

      <div className="mobile-route-scroll">
        <div className="mobile-route-entry"><UsersRound size={20} /><strong>{entryLabel}</strong></div>

        {routeGroups.map((group, groupIndex) => {
          const isAfterCurrent = currentGroupIndex >= 0 && groupIndex > currentGroupIndex;
          return (
            <div className="mobile-route-stage" key={group.depth}>
              <div className="mobile-route-connector" aria-hidden><ArrowDown size={23} /></div>
              {group.tasks.length > 1 ? (
                <section className={`mobile-route-branch ${isAfterCurrent ? "is-handoff" : ""}`.trim()}>
                  <header>
                    <span>{isAfterCurrent ? "Handoff" : `Этап ${groupIndex + 1}`}</span>
                    <strong>{isAfterCurrent ? `Открывает ${group.tasks.length} ${taskWord(group.tasks.length)}` : `${group.tasks.length} параллельные задачи`}</strong>
                  </header>
                  <div>
                    {group.tasks.map((task) => (
                      <MobileRouteTaskCard key={task.id} task={task} allTasks={state.tasks} contribution={taskContributions.get(task.id) || 0} current={task.id === currentTask.id} onOpen={() => onOpenTask(task)} />
                    ))}
                  </div>
                </section>
              ) : (
                <MobileRouteTaskCard task={group.tasks[0]} allTasks={state.tasks} contribution={taskContributions.get(group.tasks[0].id) || 0} current={group.tasks[0].id === currentTask.id} onOpen={() => onOpenTask(group.tasks[0])} />
              )}
            </div>
          );
        })}

        {hasBranch ? (
          <>
            <div className="mobile-route-connector" aria-hidden><ArrowDown size={23} /></div>
            <div className="mobile-route-join"><UsersRound size={20} /><strong>Все ветки сходятся в следующий этап</strong></div>
          </>
        ) : null}

        <div className="mobile-route-connector" aria-hidden><ArrowDown size={23} /></div>
        <section className={`mobile-route-goal tracker-tier-${trackerTier}`} style={routeProgressStyle}>
          <header><span>{state.goal?.id || "GOAL"}</span><strong>{state.goal?.title || "Commercial MVP"}</strong></header>
          <p>{formatPercent(state.progress.readyPercent)}% → {formatPercent(progress.afterTaskPercent)}%</p>
          <div className="mobile-route-goal-track"><i /><b /></div>
          <strong className="mobile-route-contribution">+{formatPercent(progress.taskPotentialPercent)}% ваш вклад</strong>
        </section>
      </div>
    </section>
  );
}

function MobileRouteTaskCard({
  task,
  allTasks,
  contribution,
  current,
  onOpen
}: {
  task: Task;
  allTasks: Task[];
  contribution: number;
  current: boolean;
  onOpen: () => void;
}) {
  const status = effectiveStatus(task, allTasks);
  const contributionTier = rewardTierForPercent(contribution);
  return (
    <button
      className={`mobile-route-task task-node-${status.toLowerCase()} ${current ? "is-current" : ""}`.trim()}
      type="button"
      onClick={onOpen}
      aria-current={current ? "step" : undefined}
    >
      <span className="mobile-route-task-id">{task.id}</span>
      <strong>{task.title}</strong>
      <span className="mobile-route-task-owner"><OwnerMark owner={task.owner} />{task.owner || "Не назначен"}</span>
      <span className="mobile-route-task-footer">
        <StatusPill status={status} />
        <small><Clock3 size={13} />{task.deadline ? `Срок ${shortDate(task.deadline)}` : "Без срока"}</small>
        <b className={`mobile-route-task-contribution tracker-tier-${contributionTier} ${contribution <= 0 ? "is-zero" : ""}`.trim()}>+{formatPercent(contribution)}%</b>
      </span>
    </button>
  );
}

function TaskTree({
  state,
  person,
  currentTask,
  projectProgress,
  search,
  statusFilter,
  showFilters,
  scale,
  viewMode,
  onSearch,
  onFilter,
  onToggleFilters,
  onScale,
  onViewMode,
  onBack,
  onCollapse,
  onOpenTask,
  isAlwaysOnTop,
  onToggleAlwaysOnTop
}: {
  state: DashboardState;
  person: Person;
  currentTask: Task;
  projectProgress: number;
  search: string;
  statusFilter: string;
  showFilters: boolean;
  scale: number;
  viewMode: TreeViewMode;
  onSearch: (value: string) => void;
  onFilter: (value: string) => void;
  onToggleFilters: () => void;
  onScale: (value: number) => void;
  onViewMode: (value: TreeViewMode) => void;
  onBack: () => void;
  onCollapse: () => void;
  onOpenTask: (task: Task) => void;
  isAlwaysOnTop?: boolean;
  onToggleAlwaysOnTop?: () => void;
}) {
  const [hoveredOwnTaskId, setHoveredOwnTaskId] = useState("");
  const mobileTreeCanvasRef = useRef<HTMLDivElement>(null);
  const mobileCurrentNodeRef = useRef<HTMLButtonElement>(null);
  const goal = state.goal;
  const lanes = useMemo(() => buildLanes(state.tasks), [state.tasks]);
  const personalViewIds = useMemo(
    () => tasksInPersonalRelationshipView(state.tasks, person.name),
    [person.name, state.tasks]
  );
  const hoveredTask = state.tasks.find((task) => task.id === hoveredOwnTaskId);
  const relationship = hoveredTask
    ? buildTaskRelationshipFocus(hoveredTask, state.tasks, person.name)
    : null;
  const normalizedSearch = search.trim().toLowerCase();
  const visibleLanes = lanes.map((lane) => ({
    ...lane,
    tasks: lane.tasks.filter((task) => {
      const effective = effectiveStatus(task, state.tasks);
      if (statusFilter !== "ALL" && effective !== statusFilter) return false;
      if (viewMode === "personal" && !personalViewIds.has(task.id)) return false;
      return !normalizedSearch || `${task.id} ${task.title} ${task.owner}`.toLowerCase().includes(normalizedSearch);
    })
  }));
  const chain = [currentTask, ...collectDownstream(currentTask, state.tasks).slice(0, 3)];
  const mobileTasks = visibleLanes.flatMap((lane) => lane.tasks);
  const mobileColumns = buildMobileTreeColumns(mobileTasks, state.tasks);
  const mobileProgress = calculateProgress(
    goal,
    state.progressGates,
    currentTask,
    buildDependencySummary(currentTask, state.tasks, state.progressGates),
    state.changeEvents
  ).progress;
  const mobileProgressTier = rewardTierForPercent(mobileProgress.taskPotentialPercent);
  const mobileProgressStyle = {
    "--mobile-tree-progress": `${projectProgress}%`,
    "--mobile-tree-projected": `${mobileProgress.afterTaskPercent}%`
  } as CSSProperties;

  const focusMobileCurrentTask = useCallback((behavior: ScrollBehavior = "smooth") => {
    if (!window.matchMedia("(max-width: 820px)").matches) return;
    const canvas = mobileTreeCanvasRef.current;
    const node = mobileCurrentNodeRef.current;
    if (!canvas || !node) return;
    const canvasRect = canvas.getBoundingClientRect();
    const nodeRect = node.getBoundingClientRect();
    canvas.scrollTo({
      left: canvas.scrollLeft + nodeRect.left - canvasRect.left - (canvas.clientWidth - nodeRect.width) / 2,
      top: canvas.scrollTop + nodeRect.top - canvasRect.top - (canvas.clientHeight - nodeRect.height) / 2,
      behavior
    });
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => focusMobileCurrentTask("auto"));
    return () => window.cancelAnimationFrame(frame);
  }, [currentTask.id, focusMobileCurrentTask, search, showFilters, statusFilter, viewMode]);

  return (
    <main className="tree-page">
      <section className="mobile-tree-screen">
        <header className="mobile-tree-header">
          <button className="mobile-tree-icon-button" type="button" onClick={onBack} aria-label="Вернуться к фокусу">
            <ArrowLeft size={21} />
          </button>
          <div className="mobile-tree-heading">
            <span>{goal?.id || "PROJECT"}</span>
            <strong>Древо задач</strong>
          </div>
          <button className="mobile-tree-icon-button" type="button" onClick={() => focusMobileCurrentTask()} aria-label="Показать текущую задачу">
            <Focus size={21} />
          </button>
        </header>

        <div className="mobile-tree-controls">
          <div className="mobile-tree-modes" aria-label="Режим дерева">
            <button type="button" className={viewMode === "personal" ? "is-active" : ""} onClick={() => onViewMode("personal")}>Мои связи</button>
            <button type="button" className={viewMode === "all" ? "is-active" : ""} onClick={() => onViewMode("all")}>Всё дерево</button>
          </div>
          <button className={`mobile-tree-filter-button ${showFilters ? "is-active" : ""}`.trim()} type="button" onClick={onToggleFilters} aria-label="Фильтры" aria-expanded={showFilters}>
            <Filter size={17} />
          </button>
        </div>

        {showFilters ? (
          <div className="mobile-tree-filter-panel">
            <label>
              <Search size={16} />
              <input value={search} onChange={(event) => onSearch(event.target.value)} placeholder="Поиск по задачам" />
            </label>
            <div>
              {["ALL", "DONE", "IN_PROGRESS", "READY", "WAITING_EXTERNAL", "LOCKED"].map((status) => (
                <button key={status} type="button" className={statusFilter === status ? "is-active" : ""} onClick={() => onFilter(status)}>
                  {status === "ALL" ? "Все" : statusLabel(status)}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        <div className="mobile-tree-canvas" ref={mobileTreeCanvasRef} aria-label="Горизонтальная карта задач">
          <div className="mobile-tree-board">
            {mobileColumns.map((column, columnIndex) => (
              <div className="mobile-tree-column-wrap" key={column.depth}>
                <section className="mobile-tree-column">
                  <header>
                    <span>{columnIndex + 1}</span>
                    <div><strong>{mobileTreeColumnLabel(column.depth, column.tasks, currentTask)}</strong><small>Задач: {column.tasks.length}</small></div>
                  </header>
                  <div className="mobile-tree-task-list">
                    {column.tasks.map((task) => {
                      const status = effectiveStatus(task, state.tasks);
                      const isCurrent = task.id === currentTask.id;
                      return (
                        <button
                          ref={isCurrent ? mobileCurrentNodeRef : undefined}
                          className={`mobile-tree-node task-node-${status.toLowerCase()} ${isCurrent ? "is-current" : ""}`.trim()}
                          type="button"
                          key={task.id}
                          onClick={() => onOpenTask(task)}
                          aria-current={isCurrent ? "step" : undefined}
                        >
                          <span className="mobile-tree-node-meta"><b>{task.id}</b><StatusPill status={status} /></span>
                          <strong>{task.title}</strong>
                          <span className="mobile-tree-node-direction">{task.direction || "Общее направление"}</span>
                          <span className="mobile-tree-node-owner"><OwnerMark owner={task.owner} />{task.owner || "Не назначен"}</span>
                        </button>
                      );
                    })}
                  </div>
                </section>
                <div className="mobile-tree-flow-arrow" aria-hidden><ArrowRight size={22} /></div>
              </div>
            ))}

            <section className="mobile-tree-column mobile-tree-goal-column">
              <header><span><Flag size={14} /></span><div><strong>Цель проекта</strong><small>Финальная точка</small></div></header>
              <div className="mobile-tree-goal-node">
                <Flag size={25} />
                <span><small>{goal?.id || "GOAL"}</small><strong>{goal?.title || "Commercial MVP"}</strong><em>{formatPercent(projectProgress)}% готовности</em></span>
              </div>
            </section>
          </div>
        </div>

        <footer className={`mobile-tree-progress tracker-tier-${mobileProgressTier}`} style={mobileProgressStyle}>
          <div><span>Готовность</span><strong>{formatPercent(projectProgress)}%</strong></div>
          <div className="mobile-tree-progress-track"><i /><b /></div>
          <div className="mobile-tree-progress-contribution"><span>После текущей</span><strong>+{formatPercent(mobileProgress.taskPotentialPercent)}%</strong></div>
        </footer>
      </section>

      <aside className="tree-sidebar">
        <button className="tree-brand" onClick={onBack} aria-label="Вернуться в рабочее пространство">
          <span>GARMENT</span><span>BURO</span><small>Project control</small>
        </button>
        <PersonArtwork person={person} variant="avatar" />
        <div className="tree-person">
          <strong>{person.name}</strong>
          <span>{person.role.split("/")[0]}</span>
          <small><i /> Онлайн</small>
        </div>
        <nav className="tree-nav" aria-label="Разделы проекта">
          <NavItem icon={Grid2X2} label="Древо задач" active />
          <NavItem icon={CalendarDays} label="План" />
          <NavItem icon={ListChecks} label="Задачи" />
          <NavItem icon={UsersRound} label="Команда" />
          <NavItem icon={AlertTriangle} label="Риски" />
          <NavItem icon={FileText} label="Документы" />
          <NavItem icon={BarChart3} label="Аналитика" />
          <NavItem icon={Settings} label="Настройки" />
        </nav>
        <button className="collapse-button" onClick={onCollapse}><Minus size={16} /> Свернуть виджет</button>
      </aside>

      <section className="tree-workspace">
        <header className="tree-header">
          <div>
            <button className="mobile-back" onClick={onBack}><ArrowLeft size={18} /> Назад</button>
            <h1>Полное древо задач</h1>
            <p>Полная карта задач и зависимостей проекта Commercial MVP</p>
          </div>
          <div className="tree-toolbar">
            {onToggleAlwaysOnTop ? (
              <button
                className={`toolbar-button ${isAlwaysOnTop ? "is-active" : ""}`.trim()}
                onClick={onToggleAlwaysOnTop}
                aria-label={isAlwaysOnTop ? "Открепить окно" : "Закрепить поверх всех окон"}
                title={isAlwaysOnTop ? "Открепить окно" : "Закрепить поверх всех окон"}
                aria-pressed={isAlwaysOnTop}
              >
                {isAlwaysOnTop ? <PinOff size={16} /> : <Pin size={16} />}
              </button>
            ) : null}
            <button
              className={`toolbar-button ${viewMode === "personal" ? "is-active" : ""}`.trim()}
              onClick={() => onViewMode(viewMode === "all" ? "personal" : "all")}
              aria-label={viewMode === "all" ? "Показать мои задачи и связи" : "Показать все задачи"}
            >
              <span>{viewMode === "all" ? "Мои связи" : "Все задачи"}</span><Grid2X2 size={16} />
            </button>
            <button className={`toolbar-button ${showFilters ? "is-active" : ""}`} onClick={onToggleFilters} aria-expanded={showFilters}>
              <Filter size={16} /><span>Фильтры</span>
            </button>
            <label className="tree-search">
              <Search size={18} />
              <input value={search} onChange={(event) => onSearch(event.target.value)} placeholder="Поиск по задачам..." />
            </label>
          </div>
        </header>

        {showFilters ? (
          <div className="tree-filters" aria-label="Фильтр статусов">
            {["ALL", "DONE", "IN_PROGRESS", "READY", "WAITING_EXTERNAL", "LOCKED"].map((status) => (
              <button key={status} className={statusFilter === status ? "is-active" : ""} onClick={() => onFilter(status)}>
                {status === "ALL" ? "Все" : statusLabel(status)}
              </button>
            ))}
          </div>
        ) : null}

        <section className="tree-viewport" aria-label="Карта задач">
          <div className={`tree-relationship-guide ${relationship ? "is-active" : ""}`} aria-live="polite">
            {relationship && hoveredTask ? (
              <>
                <div><span>Своя задача</span><strong>{hoveredTask.id}</strong></div>
                <div><span>Зависит от</span><strong>{relationship.incoming.length ? relationship.incoming.map(taskRelationLabel).join(" · ") : "нет входящих зависимостей"}</strong></div>
                <div><span>От неё зависят</span><strong>{relationship.outgoing.length ? relationship.outgoing.map(taskRelationLabel).join(" · ") : "нет следующих задач"}</strong></div>
              </>
            ) : (
              <p>Наведите на свою задачу: она станет серой, а связанные задачи останутся подсвечены.</p>
            )}
          </div>
          <div className="zoom-controls">
            <button onClick={() => toggleFullscreen()} aria-label="На весь экран" title="На весь экран"><Maximize2 size={17} /></button>
            <button onClick={() => onScale(Math.min(1.15, Number((scale + 0.1).toFixed(2))))} aria-label="Увеличить" title="Увеличить"><ZoomIn size={18} /></button>
            <button onClick={() => onScale(Math.max(0.75, Number((scale - 0.1).toFixed(2))))} aria-label="Уменьшить" title="Уменьшить"><ZoomOut size={18} /></button>
          </div>

          <div className="tree-stage-shell">
            <div className="tree-stage" style={{ "--tree-scale": scale } as CSSProperties}>
              <div className="goal-node">
                <span>Goal</span>
                <div className="goal-copy"><strong>{goal?.id || "Цель не задана"}</strong><p>{goal?.title || "Нет данных"}</p></div>
                <div className="goal-progress"><i style={{ width: `${projectProgress}%` }} /></div>
                <b>{projectProgress}%</b>
              </div>
              <div className="root-trunk" aria-hidden />

              <div className="lane-grid">
                {visibleLanes.map((lane, laneIndex) => {
                  const Icon = lane.icon;
                  const laneProgress = calculateLaneProgress(lane.tasks, state.progressGates);
                  return (
                    <section className="task-lane" key={lane.id}>
                      <header className="lane-head">
                        <div className="lane-icon"><Icon size={22} /></div>
                        <span className="lane-number">{laneIndex + 1}</span>
                        <div className="lane-title"><strong>{lane.title}</strong><span>{lane.subtitle}</span></div>
                        <div className="lane-progress"><i style={{ width: `${laneProgress}%` }} /></div>
                        <b>{laneProgress}%</b>
                      </header>
                      <div className="lane-connector" aria-hidden />
                      <div className="lane-tasks">
                        {lane.tasks.map((task, index) => (
                          <div className="tree-node-wrap" key={task.id}>
                            {index ? <span className="vertical-edge" aria-hidden /> : null}
                            <TaskNode
                              task={task}
                              allTasks={state.tasks}
                              personName={person.name}
                              relationship={relationship}
                              isHovered={task.id === hoveredOwnTaskId}
                              onHover={(taskId) => setHoveredOwnTaskId(taskId)}
                              onOpen={() => onOpenTask(task)}
                            />
                          </div>
                        ))}
                        {!lane.tasks.length ? <div className="lane-empty">Нет задач по фильтру</div> : null}
                      </div>
                    </section>
                  );
                })}
              </div>

              <div className="join-lines" aria-hidden />
              <div className="join-node">
                <UsersRound size={24} />
                <div><strong>Все launch gates закрыты → Commercial MVP</strong><span>{goal?.id || "—"}</span></div>
                <StatusPill status={projectProgress >= 100 ? "DONE" : "READY"} />
              </div>
            </div>
          </div>
        </section>

        <section className="current-fragment">
          <div className="fragment-title"><strong>Текущий фрагмент</strong><span>Ваш активный путь</span></div>
          <div className="fragment-chain">
            {chain.map((task, index) => (
              <div className="fragment-item-wrap" key={task.id}>
                {index ? <ArrowRight size={20} className="fragment-arrow" /> : null}
                <button className={task.id === currentTask.id ? "fragment-task is-current" : "fragment-task"} onClick={() => onOpenTask(task)}>
                  <span>{task.id}</span><strong>{task.title}</strong><small>{task.owner} · {statusLabel(effectiveStatus(task, state.tasks))}</small>
                </button>
              </div>
            ))}
            <ArrowRight size={20} className="fragment-arrow" />
            <div className="fragment-goal"><UsersRound size={22} /><strong>Следующий этап</strong><span>{goal?.id || "—"}</span></div>
          </div>
        </section>
      </section>
    </main>
  );
}

function PersonArtwork({ person, variant }: { person: Person; variant: "full" | "avatar" }) {
  const asset = personAsset(person.name, variant);
  const personClass = samePerson(person.name, "Костя") ? " person-artwork-kostya" : "";
  return (
    <div className={`person-artwork person-artwork-${variant}${personClass}`} aria-label={`Аватар: ${person.name}`}>
      {asset ? (
        <div className="person-asset-frame">
          <Image className="person-asset-image" src={asset} alt={person.name} fill sizes={variant === "full" ? "240px" : "92px"} priority />
        </div>
      ) : (
        <div className="avatar-placeholder"><UserRound size={variant === "full" ? 94 : 42} strokeWidth={1.15} /><span>{person.name.slice(0, 1)}</span></div>
      )}
    </div>
  );
}

function MetaRow({
  icon: Icon,
  label,
  note,
  accent
}: {
  icon: IconComponent;
  label: string;
  note?: string;
  accent?: boolean;
}) {
  return (
    <div className={accent ? "meta-row is-accent" : "meta-row"}>
      <Icon size={22} strokeWidth={1.5} />
      <span><strong>{label}</strong>{note ? <small>{note}</small> : null}</span>
    </div>
  );
}

function HandoffItem({ icon: Icon, label, accent }: { icon: IconComponent; label: string; accent?: boolean }) {
  return <div className={accent ? "handoff-item is-accent" : "handoff-item"}><Icon size={22} /><span>{label}</span></div>;
}

function TaskActionPopover({
  intent,
  draft,
  acceptanceCriteria,
  preview,
  onDraftChange,
  onClose,
  onSubmit,
  confirmation,
  feedback,
  progressLabel
}: {
  intent: TaskActionIntent;
  draft: TaskActionDraft;
  acceptanceCriteria: string;
  preview: string;
  onDraftChange: (draft: TaskActionDraft) => void;
  onClose: () => void;
  onSubmit: () => void;
  confirmation: TaskActionConfirmation;
  feedback: string;
  progressLabel: string;
}) {
  const updateDraft = (patch: Partial<TaskActionDraft>) => onDraftChange({ ...draft, ...patch });

  return (
    <section className={`task-action-popover action-${intent}`} aria-label={`Действие: ${taskActionLabel(intent)}`}>
      <header>
        <div><small>Быстрое действие</small><strong>{taskActionLabel(intent)}</strong></div>
        <button type="button" onClick={onClose} aria-label="Закрыть" title="Закрыть"><X size={16} /></button>
      </header>

      {intent === "reject" ? (
        <div className="action-popover-body">
          <label>Почему вы отклоняете задачу?</label>
          <textarea autoFocus rows={3} value={draft.note} onChange={(event) => updateDraft({ note: event.target.value })} placeholder="Коротко объясните причину для GPT" />
        </div>
      ) : null}

      {intent === "stuck" ? (
        <div className="action-popover-body">
          <label>Что мешает продолжить?</label>
          <textarea autoFocus rows={3} value={draft.note} onChange={(event) => updateDraft({ note: event.target.value })} placeholder="Опишите конкретный внутренний блокер" />
        </div>
      ) : null}

      {intent === "waiting" ? (
        <div className="action-popover-body">
          <label>Кого или что ждём?</label>
          <textarea autoFocus rows={2} value={draft.note} onChange={(event) => updateDraft({ note: event.target.value })} placeholder="Например: ответ от СДЭК" />
          <label className="popover-optional-label">Следующая проверка <span>необязательно</span></label>
          <input type="date" value={draft.nextCheckDate} onChange={(event) => updateDraft({ nextCheckDate: event.target.value })} />
        </div>
      ) : null}

      {intent === "fact" ? (
        <div className="action-popover-body">
          <label>Что изменилось?</label>
          <textarea autoFocus rows={3} value={draft.note} onChange={(event) => updateDraft({ note: event.target.value })} placeholder="Один новый значимый факт" />
        </div>
      ) : null}

      {intent === "done" ? (
        <div className="action-popover-body">
          <label>Критерий готовности</label>
          <p className="popover-criteria"><Check size={15} />{acceptanceCriteria || "Результат задачи готов к передаче."}</p>
          <label>Что сделано и где результат?</label>
          <textarea autoFocus rows={3} value={draft.note} onChange={(event) => updateDraft({ note: event.target.value })} placeholder="Опишите результат и evidence для GPT" />
        </div>
      ) : null}

      {intent === "session_close" ? (
        <div className="action-popover-body">
          <label>На чём закончили рабочую сессию?</label>
          <textarea autoFocus rows={4} value={draft.note} onChange={(event) => updateDraft({ note: event.target.value })} placeholder="Что сделано, что осталось и какой следующий шаг" />
        </div>
      ) : null}

      <div className={`task-action-preview ${preview ? "is-ready" : ""}`} aria-live="polite">
        <small>Будет зафиксировано</small>
        <p>{preview || previewHint(intent)}</p>
      </div>
      <footer className="task-action-popover-footer">
        {confirmation === "saving" ? <p className="task-command-progress"><RefreshCw className="spin" size={14} />{progressLabel}</p> : null}
        {confirmation === "error" && feedback ? <p className="is-error"><AlertTriangle size={14} />{feedback}</p> : null}
        <button
          className={`confirm-task-action is-${confirmation}`}
          type="button"
          disabled={!preview || confirmation !== "idle"}
          onClick={onSubmit}
        >
          {confirmation === "saving" ? <RefreshCw className="spin" size={17} /> : null}
          <span title="Отправить в GPT">
            {confirmation === "saving"
              ? "Фиксируем"
              : confirmation === "success"
                ? "Зафиксировано"
              : intent === "session_close"
                ? "Отправить и закрыть сессию"
                : "Зафиксировать"}
          </span>
        </button>
      </footer>
    </section>
  );
}

function TaskActionButton({
  icon: Icon,
  label,
  active,
  disabled,
  success,
  onClick
}: {
  icon: IconComponent;
  label: string;
  active?: boolean;
  disabled?: boolean;
  success?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`${active ? "is-active" : ""} ${success ? "is-success" : ""}`.trim()}
      type="button"
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon size={18} />
      <span>{label}</span>
    </button>
  );
}

function TimeEstimateSelector({
  suggested,
  confirmed,
  showCustom,
  customValue,
  onSelect,
  onCustomChange,
  onConfirmCustom
}: {
  suggested: Exclude<TaskTimeEstimate, "custom">;
  confirmed: string;
  showCustom: boolean;
  customValue: string;
  onSelect: (estimate: TaskTimeEstimate) => void;
  onCustomChange: (value: string) => void;
  onConfirmCustom: () => void;
}) {
  const options: Array<{ value: TaskTimeEstimate; label: string; icon: IconComponent }> = [
    { value: "up-to-2h", label: "До 2 ч", icon: Timer },
    { value: "3-4h", label: "3–4 ч", icon: Clock3 },
    { value: "5-7h", label: "5–7 ч", icon: Focus },
    { value: "1d", label: "1 день", icon: CalendarDays },
    { value: "2d-plus", label: "2+ дня", icon: CalendarDays },
    { value: "custom", label: "Свой вариант", icon: Settings }
  ];

  return (
    <section className="task-time-estimator" aria-label="Оценка времени" onClick={(event) => event.stopPropagation()}>
      <header className="task-time-estimator-header">
        <Clock3 size={16} />
        <strong>Оценка времени</strong>
        <small>Система предполагает: {taskTimeEstimateLabel(suggested)}</small>
      </header>
      <div className="task-time-options">
        {options.map(({ value, label, icon: Icon }) => {
          const selected = value !== "custom" && confirmed === taskTimeEstimateLabel(value);
          return (
            <button
              className={`${value === suggested ? "is-suggested" : ""} ${selected ? "is-selected" : ""} ${value === "custom" && showCustom ? "is-selected" : ""}`.trim()}
              type="button"
              key={value}
              aria-pressed={selected || (value === "custom" && showCustom)}
              onClick={() => onSelect(value)}
            >
              <Icon size={16} />
              <span>{label}</span>
            </button>
          );
        })}
      </div>
      {showCustom ? (
        <div className="task-time-custom">
          <input value={customValue} onChange={(event) => onCustomChange(event.target.value)} placeholder="Например, 10 часов" aria-label="Своя оценка времени" autoFocus />
          <button type="button" disabled={!customValue.trim()} onClick={onConfirmCustom}>Подтвердить</button>
        </div>
      ) : null}
      <p className={`task-time-note ${confirmed ? "is-confirmed" : ""}`.trim()}>
        <CircleHelp size={14} />
        {confirmed ? `Оценка подтверждена: ${confirmed}. Можно начинать задачу.` : "Сначала подтвердите время, затем можно начинать задачу."}
      </p>
    </section>
  );
}

function RouteColumn({ label, side, children }: { label: string; side: "incoming" | "outgoing"; children: ReactNode }) {
  return <div className={`route-column route-${side}`}><small>{label}</small><div>{children}</div></div>;
}

function RouteNode({
  id,
  title,
  done,
  current,
  muted
}: {
  id: string;
  title: string;
  done?: boolean;
  current?: boolean;
  muted?: boolean;
}) {
  return (
    <div className={`route-node ${done ? "is-done" : ""} ${current ? "is-current" : ""} ${muted ? "is-muted" : ""}`.trim()}>
      <span>{id}</span>
      <strong>{title}</strong>
      {done ? <Check size={15} /> : null}
    </div>
  );
}

function MiniMilestone({ icon: Icon, label, note, done }: { icon: IconComponent; label: string; note: string; done?: boolean }) {
  return (
    <div className="mini-milestone">
      <span className={done ? "is-done" : ""}><Icon size={22} /></span>
      <strong>{label}</strong><small>{note}</small>
    </div>
  );
}

function MiniTask({ task, active }: { task: Task; active?: boolean }) {
  return (
    <span className={active ? "mini-task is-active" : "mini-task"}>
      <strong>{task.owner} — {task.id}</strong><small>{statusLabel(task.status)}</small>
    </span>
  );
}

function ProgressGauge({
  value,
  projectedValue,
  contribution
}: {
  value: number;
  projectedValue: number;
  contribution: number;
}) {
  const currentAngle = clampPercent(value) * 3.6;
  const projectedAngle = Math.max(currentAngle, clampPercent(projectedValue) * 3.6);
  return (
    <div
      className="progress-gauge"
      role="img"
      aria-label={`Сейчас ${formatPercent(value)}%, задача прибавит ${formatPercent(contribution)}%, после задачи будет ${formatPercent(projectedValue)}%`}
      style={{
        "--progress-angle": `${currentAngle}deg`,
        "--projected-angle": `${projectedAngle}deg`,
        "--progress-value": `${clampPercent(value)}%`,
        "--projected-value": `${clampPercent(projectedValue)}%`
      } as CSSProperties}
    >
      <div>
        <span className="progress-gauge-label">Готовность</span>
        <strong>{formatPercent(value)}<span>%</span></strong>
        {contribution > 0 ? (
          <span className="progress-gauge-future">
            <b>+{formatPercent(contribution)}%</b>
            <small>ваш вклад</small>
          </span>
        ) : null}
      </div>
    </div>
  );
}

function clampPercent(value: number) {
  return Math.min(100, Math.max(0, Number.isFinite(value) ? value : 0));
}

function formatPercent(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(".", ",");
}

function taskActionLabel(action: TaskActionIntent) {
  if (action === "reject") return "Отклонить";
  if (action === "stuck") return "Застрял";
  if (action === "waiting") return "Жду";
  if (action === "fact") return "Новый факт";
  if (action === "session_close") return "Закрыть сессию";
  return "Готово";
}

function buildTaskActionPreview(action: TaskActionIntent | null, draft: TaskActionDraft, task: Task) {
  const note = draft.note.trim();
  if (!action) return "";
  if (action === "reject") return note ? `Отклонение ${task.id}: ${note}.` : "";
  if (action === "stuck") return note ? `Внутренний блокер по ${task.id}: ${note}.` : "";
  if (action === "waiting") {
    if (!note) return "";
    const nextCheck = draft.nextCheckDate ? ` Следующая проверка: ${formatDate(draft.nextCheckDate)}.` : "";
    return `Ожидание: ${note}.${nextCheck}`;
  }
  if (action === "fact") return note ? `Новый факт по ${task.id}: ${note}.` : "";
  if (action === "session_close") return note ? `Закрытие рабочей сессии: ${note}.` : "";
  return note ? `Результат по ${task.id}: ${note}. GPT должна проверить критерий «${task.acceptanceCriteria || task.expectedResult}».` : "";
}

function previewHint(action: TaskActionIntent) {
  if (action === "reject") return "Объясните GPT, почему задача не должна быть принята вами.";
  if (action === "stuck") return "Опишите конкретный внутренний блокер.";
  if (action === "waiting") return "Укажите, кого или что ждём.";
  if (action === "fact") return "Коротко укажите новый значимый факт для GPT.";
  if (action === "session_close") return "Кратко зафиксируйте результат, остаток и следующий шаг.";
  return "Опишите сделанный результат и evidence для проверки GPT.";
}

function taskWord(count: number) {
  const lastTwo = count % 100;
  if (lastTwo >= 11 && lastTwo <= 14) return "задач";
  const last = count % 10;
  if (last === 1) return "задачу";
  if (last >= 2 && last <= 4) return "задачи";
  return "задач";
}

function taskRelationLabel(task: Task) {
  return `${task.id} — ${task.owner || "не назначен"}`;
}

function updatedTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || "—";
  return new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" }).format(date);
}

function NavItem({ icon: Icon, label, active }: { icon: IconComponent; label: string; active?: boolean }) {
  return <button className={active ? "nav-item is-active" : "nav-item"}><Icon size={17} /><span>{label}</span></button>;
}

function TaskNode({
  task,
  allTasks,
  personName,
  relationship,
  isHovered,
  onHover,
  onOpen
}: {
  task: Task;
  allTasks: Task[];
  personName: string;
  relationship: ReturnType<typeof buildTaskRelationshipFocus> | null;
  isHovered: boolean;
  onHover: (taskId: string) => void;
  onOpen: () => void;
}) {
  const status = effectiveStatus(task, allTasks);
  const isOwn = samePerson(task.owner, personName);
  const isRelated = Boolean(relationship?.highlightedTaskIds.has(task.id));
  const isDimmed = Boolean(relationship && !isRelated);
  return (
    <button
      className={`task-node task-node-${status.toLowerCase()} ${isOwn ? "is-own" : ""} ${isHovered ? "is-hovered" : ""} ${isRelated ? "is-related" : ""} ${isDimmed ? "is-dimmed" : ""}`.trim()}
      onClick={onOpen}
      onMouseEnter={() => { if (isOwn) onHover(task.id); }}
      onMouseLeave={() => { if (isOwn) onHover(""); }}
      onFocus={() => { if (isOwn) onHover(task.id); }}
      onBlur={() => { if (isOwn) onHover(""); }}
    >
      <span className="task-node-id">{task.id}</span>
      <strong>{task.title}</strong>
      <div><OwnerMark owner={task.owner} /><span>{task.owner || "Не назначен"}</span><StatusPill status={status} /></div>
    </button>
  );
}

function OwnerMark({ owner }: { owner: string }) {
  const asset = personAsset(owner, "avatar");
  return (
    <span className={asset ? `owner-mark has-image ${samePerson(owner, "Костя") ? "is-kostya" : ""}`.trim() : "owner-mark"} aria-hidden>
      {asset ? <Image src={asset} alt="" fill sizes="20px" /> : owner ? owner.slice(0, 1) : "?"}
    </span>
  );
}

function StatusBadge({ task, allTasks, prominent }: { task: Task; allTasks: Task[]; prominent?: boolean }) {
  const status = effectiveStatus(task, allTasks);
  return <span className={prominent ? `focus-status status-${status.toLowerCase()}` : `status-badge status-${status.toLowerCase()}`}>{statusLabel(status)}</span>;
}

function StatusPill({ status }: { status: string }) {
  return <span className={`status-pill status-${status.toLowerCase()}`}><i />{statusLabel(status)}</span>;
}

function TaskDrawer({
  task,
  allTasks,
  state,
  onConfirmTaskAction,
  onClose
}: {
  task: Task;
  allTasks: Task[];
  state: DashboardState;
  onConfirmTaskAction: (submission: TaskActionSubmission, onProgress?: (progress: TaskCommandProgress) => void) => Promise<TaskActionSaveResult | undefined>;
  onClose: () => void;
}) {
  const [taskAction, setTaskAction] = useState<TaskActionIntent | null>(null);
  const [draft, setDraft] = useState<TaskActionDraft>(emptyTaskActionDraft);
  const [confirmation, setConfirmation] = useState<TaskActionConfirmation>("idle");
  const [feedback, setFeedback] = useState("");
  const [commandProgress, setCommandProgress] = useState<TaskCommandProgress | null>(null);
  const [timeEstimate, setTimeEstimate] = useState("");
  const [showCustomEstimate, setShowCustomEstimate] = useState(false);
  const [customEstimate, setCustomEstimate] = useState("");
  const status = effectiveStatus(task, allTasks);
  const preview = buildTaskActionPreview(taskAction, draft, task);
  const canStart = !completedStatuses.has(task.status);
  const taskContext = state.taskContexts.find((context) => context.taskId === task.id);
  const taskPerson = state.people.find((person) => samePerson(person.name, task.owner));
  const suggestedTimeEstimate = suggestTaskTimeEstimate(task);

  useEffect(() => {
    setTaskAction(null);
    setDraft(emptyTaskActionDraft());
    setConfirmation("idle");
    setFeedback("");
    setCommandProgress(null);
    setTimeEstimate(window.localStorage.getItem(taskEstimateStorageKey(taskPerson?.id || task.owner, task.id)) || "");
    setShowCustomEstimate(false);
    setCustomEstimate("");
  }, [task.id]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && confirmation !== "saving") onClose();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [confirmation, onClose]);

  useEffect(() => {
    if (confirmation !== "success") return;
    const timer = window.setTimeout(() => {
      setTaskAction(null);
      setDraft(emptyTaskActionDraft());
      setConfirmation("idle");
    }, 1_600);
    return () => window.clearTimeout(timer);
  }, [confirmation]);

  function chooseTaskAction(intent: TaskActionIntent) {
    if (confirmation === "saving") return;
    setTaskAction((current) => current === intent ? null : intent);
    setDraft(emptyTaskActionDraft());
    setConfirmation("idle");
    setFeedback("");
  }

  function confirmDrawerTimeEstimate(value: string) {
    const normalizedValue = value.trim();
    if (!normalizedValue) return;
    window.localStorage.setItem(taskEstimateStorageKey(taskPerson?.id || task.owner, task.id), normalizedValue);
    setTimeEstimate(normalizedValue);
    setShowCustomEstimate(false);
    window.dispatchEvent(new CustomEvent("garment-buro:task-estimate-updated", {
      detail: { taskId: task.id, value: normalizedValue }
    }));
  }

  async function sendDrawerCommand(submission: TaskActionSubmission) {
    setConfirmation("saving");
    setFeedback("");
    setCommandProgress({ stage: "connecting", label: "Фиксируем состояние задачи" });
    try {
      const result = await onConfirmTaskAction(submission, setCommandProgress);
      setFeedback(commandSuccessMessage(result));
      setConfirmation("success");
      return result;
    } catch (error) {
      setFeedback(readErrorMessage(error, "Не удалось зафиксировать изменение."));
      setConfirmation("error");
      return undefined;
    }
  }

  async function startOrContinueTask() {
    if (!canStart || confirmation === "saving") return;
    const accepting = ["BACKLOG", "READY"].includes(task.status);
    await sendDrawerCommand({
      commandId: createCommandId(accepting ? "ACCEPT" : "SESSION-START"),
      taskId: task.id,
      intent: accepting ? "accept" : "session_start",
      details: {
        note: accepting ? `Я оценил задачу в ${timeEstimate}, принял ${task.id} «${task.title}» и начинаю работу.` : `Я оценил задачу в ${timeEstimate} и продолжаю работу по ${task.id} «${task.title}».`,
        sessionId: accepting ? undefined : createCommandId("SESSION"),
        sessionStartedAt: accepting ? undefined : new Date().toISOString()
      },
      preview: accepting ? `Принять ${task.id} и начать работу.` : `Продолжить работу по ${task.id}.`
    });
  }

  async function confirmDrawerAction() {
    if (!taskAction || !preview || confirmation === "saving") return;
    await sendDrawerCommand({
      commandId: createCommandId(taskAction.toUpperCase()),
      taskId: task.id,
      intent: taskAction,
      details: {
        note: draft.note.trim(),
        nextCheckDate: draft.nextCheckDate || undefined,
        acceptanceCriteria: taskAction === "done" ? task.acceptanceCriteria || task.expectedResult : undefined
      },
      preview
    });
  }

  return (
    <>
      <button className="drawer-backdrop" aria-label="Закрыть детали задачи" onClick={onClose} />
      <aside className="task-drawer has-mobile-console" role="dialog" aria-modal="true" aria-labelledby={`task-dialog-title-${task.id}`}>
        <header className="task-modal-header">
          <div><span>{task.id} · {task.owner}</span><h2 id={`task-dialog-title-${task.id}`}>{displayTaskTitle(task.title)}</h2></div>
          <button className="icon-button" onClick={onClose} aria-label="Закрыть"><X size={19} /></button>
        </header>

        <div className="task-modal-body">
          <section className="task-modal-primary" aria-label="Контекст и результат задачи">
            <div className="drawer-tags">
              <StatusPill status={status} />
              <span className="outline-tag">Gate {task.launchGate}</span>
              {task.projectFocus ? <span className="outline-tag accent">Project focus</span> : null}
              {task.priority ? <span className="outline-tag desktop-task-extra">Приоритет {task.priority}</span> : null}
            </div>
            <h3 className="desktop-task-extra">Контекст и результат</h3>
            <DrawerField label="Почему сейчас" value={task.whyNow} />
            <DrawerField label="Ожидаемый результат" value={task.expectedResult} />
            <DrawerField label="Критерий готовности" value={task.acceptanceCriteria} />
            {taskContext?.currentWorkingState ? <div className="desktop-task-extra"><DrawerField label="Текущее рабочее состояние" value={taskContext.currentWorkingState} /></div> : null}
            {taskContext?.openQuestions ? <div className="desktop-task-extra"><DrawerField label="Открытые вопросы" value={taskContext.openQuestions} /></div> : null}
          </section>

          <section className="task-modal-secondary" aria-label="Связи и сроки задачи">
            <h3 className="desktop-task-extra">Связи и сроки</h3>
            <div className="desktop-task-extra"><DrawerField label="Направление" value={task.direction || "—"} /></div>
            <div className="desktop-task-extra"><DrawerField label="Оценка времени" value={timeEstimate || "Не подтверждена"} /></div>
            <DrawerField label="Зависит от" value={task.blockedBy.join(", ") || "—"} />
            <DrawerField label="Открывает" value={task.unlocks.join(", ") || "—"} />
            <DrawerField label="Ждём" value={task.waitingFor || "—"} />
            <DrawerField label="Следующая проверка" value={formatDate(task.nextCheckDate)} />
            <DrawerField label="Срок" value={formatDate(task.deadline)} />
            {taskContext?.canonicalRefs.length ? <div className="desktop-task-extra"><DrawerField label="Материалы" value={taskContext.canonicalRefs.join(", ")} /></div> : null}
            <DrawerField label="Источник" value={task.source || "—"} />
          </section>
        </div>

        {taskAction ? (
          <div className="mobile-task-action-editor">
            <TaskActionPopover
              intent={taskAction}
              draft={draft}
              acceptanceCriteria={task.acceptanceCriteria || task.expectedResult}
              preview={preview}
              onDraftChange={setDraft}
              onClose={() => setTaskAction(null)}
              onSubmit={confirmDrawerAction}
              confirmation={confirmation}
              feedback={feedback}
              progressLabel={commandProgress?.label || "Фиксируем состояние задачи"}
            />
          </div>
        ) : null}

        <footer className="mobile-task-console">
          <section className="mobile-task-time-estimate" aria-label="Оценка времени задачи">
            <TimeEstimateSelector
              suggested={suggestedTimeEstimate}
              confirmed={timeEstimate}
              showCustom={showCustomEstimate}
              customValue={customEstimate}
              onSelect={(estimate) => {
                if (estimate === "custom") {
                  setShowCustomEstimate(true);
                  return;
                }
                confirmDrawerTimeEstimate(taskTimeEstimateLabel(estimate));
              }}
              onCustomChange={setCustomEstimate}
              onConfirmCustom={() => confirmDrawerTimeEstimate(customEstimate)}
            />
          </section>
          <button className="mobile-task-primary" type="button" disabled={!canStart || !timeEstimate || confirmation === "saving"} onClick={startOrContinueTask}>
            {confirmation === "saving" && !taskAction ? <RefreshCw className="spin" size={20} /> : <Play size={21} />}
            <span>Взять задачу</span>
          </button>
          <div>
            <TaskActionButton icon={FilePlus2} label="Новый факт" active={taskAction === "fact"} disabled={confirmation === "saving"} onClick={() => chooseTaskAction("fact")} />
            <TaskActionButton icon={CircleHelp} label="Застрял" active={taskAction === "stuck"} disabled={confirmation === "saving"} onClick={() => chooseTaskAction("stuck")} />
            <TaskActionButton icon={Clock3} label="Жду" active={taskAction === "waiting"} disabled={confirmation === "saving"} onClick={() => chooseTaskAction("waiting")} />
            <TaskActionButton icon={Check} label="Готово" active={taskAction === "done"} disabled={confirmation === "saving"} onClick={() => chooseTaskAction("done")} />
          </div>
          <p className="mobile-task-console-note"><Sparkles size={13} />Все изменения задачи фиксирует GPT в Google Sheets.</p>
        </footer>
      </aside>
    </>
  );
}

function DrawerField({ label, value }: { label: string; value: string }) {
  return <div className="drawer-field"><span>{label}</span><p>{value || "—"}</p></div>;
}

function buildLanes(tasks: Task[]) {
  const assigned = new Set<string>();
  return laneDefinitions.map((definition, index) => {
    const matching = tasks.filter((task) => {
      if (assigned.has(task.id)) return false;
      const match = definition.matches(task) || (index === laneDefinitions.length - 1 && !laneDefinitions.some((item) => item.matches(task)));
      if (match) assigned.add(task.id);
      return match;
    });
    return { ...definition, tasks: sortByDependencyDepth(matching, tasks) };
  });
}

function buildMobileTreeColumns(tasks: Task[], allTasks: Task[]) {
  const uniqueTasks = Array.from(new Map(tasks.map((task) => [task.id, task])).values());
  const columns = new Map<number, Task[]>();
  uniqueTasks.forEach((task) => {
    const depth = taskDepth(task, allTasks);
    columns.set(depth, [...(columns.get(depth) || []), task]);
  });
  return Array.from(columns.entries())
    .sort(([leftDepth], [rightDepth]) => leftDepth - rightDepth)
    .map(([depth, columnTasks]) => ({
      depth,
      tasks: [...columnTasks].sort((left, right) => {
        if (left.id === right.id) return 0;
        if (left.projectFocus !== right.projectFocus) return left.projectFocus ? -1 : 1;
        return left.id.localeCompare(right.id);
      })
    }));
}

function buildMobileRouteGroups(tasks: Task[], allTasks: Task[], currentTaskId: string) {
  const groups = new Map<number, Task[]>();
  tasks.forEach((task) => {
    const depth = taskDepth(task, allTasks);
    groups.set(depth, [...(groups.get(depth) || []), task]);
  });
  return Array.from(groups.entries())
    .sort(([leftDepth], [rightDepth]) => leftDepth - rightDepth)
    .map(([depth, groupTasks]) => ({
      depth,
      tasks: [...groupTasks].sort((left, right) => {
        if (left.id === currentTaskId) return -1;
        if (right.id === currentTaskId) return 1;
        if (left.projectFocus !== right.projectFocus) return left.projectFocus ? -1 : 1;
        return left.id.localeCompare(right.id);
      })
    }));
}

function mobileTreeColumnLabel(depth: number, tasks: Task[], currentTask: Task) {
  if (tasks.some((task) => task.id === currentTask.id)) return "Текущий уровень";
  if (depth === 0) return "Стартовые задачи";
  return `Уровень ${depth + 1}`;
}

function sortByDependencyDepth(tasks: Task[], allTasks: Task[]) {
  return [...tasks].sort((a, b) => taskDepth(a, allTasks) - taskDepth(b, allTasks) || a.id.localeCompare(b.id));
}

function taskDepth(task: Task, allTasks: Task[], seen = new Set<string>()): number {
  if (!task.blockedBy.length || seen.has(task.id)) return 0;
  const nextSeen = new Set(seen).add(task.id);
  return 1 + Math.max(0, ...task.blockedBy.map((id) => {
    const dependency = allTasks.find((item) => item.id === id);
    return dependency ? taskDepth(dependency, allTasks, nextSeen) : 0;
  }));
}

function collectDownstream(start: Task, tasks: Task[]) {
  const result: Task[] = [];
  const visited = new Set<string>([start.id]);
  const queue = [...start.unlocks];
  while (queue.length) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    const task = tasks.find((item) => item.id === id);
    if (!task) continue;
    result.push(task);
    queue.push(...task.unlocks);
  }
  return result;
}

function collectUpstream(start: Task, tasks: Task[]) {
  const result: Task[] = [];
  const visited = new Set<string>([start.id]);
  const queue = [...start.blockedBy];
  while (queue.length) {
    const id = queue.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    const task = tasks.find((item) => item.id === id);
    if (!task) continue;
    result.push(task);
    queue.push(...task.blockedBy);
  }
  return result;
}

function effectiveStatus(task: Task, allTasks: Task[]) {
  if (task.status === "DONE" || task.status === "CANCELLED") return "DONE";
  if (task.status === "IN_PROGRESS") return "IN_PROGRESS";
  if (task.status === "WAITING_EXTERNAL") return "WAITING_EXTERNAL";
  if (task.status === "BLOCKED") return "LOCKED";
  const isLocked = task.blockedBy.some((id) => {
    const dependency = allTasks.find((item) => item.id === id);
    return dependency && !completedStatuses.has(dependency.status);
  });
  return isLocked ? "LOCKED" : task.status || "READY";
}

function calculateLaneProgress(tasks: Task[], gates: ProgressGate[]) {
  const taskIds = new Set(tasks.map((task) => task.id));
  const linkedGates = gates.filter((gate) => gate.active && gate.closedByTask && taskIds.has(gate.closedByTask));
  const scope = linkedGates.reduce((sum, gate) => sum + gate.currentPoints, 0);
  if (!scope) return 0;
  const verified = linkedGates
    .filter((gate) => gate.status === "VERIFIED_DONE")
    .reduce((sum, gate) => sum + gate.currentPoints, 0);
  return Math.round((verified / scope) * 100);
}

function statusLabel(status: string) {
  if (status === "IN_PROGRESS") return "In progress";
  if (status === "WAITING_EXTERNAL") return "Waiting external";
  if (status === "LOCKED") return "Locked";
  if (status === "DONE") return "Done";
  if (status === "READY") return "Ready";
  if (status === "BACKLOG") return "Backlog";
  return status.replaceAll("_", " ");
}

function suggestTaskTimeEstimate(task: Task): Exclude<TaskTimeEstimate, "custom"> {
  if (task.priority === "P0") return "5-7h";
  if (task.priority === "P1") return "3-4h";
  if (task.priority === "P2") return "up-to-2h";
  return "3-4h";
}

function taskTimeEstimateLabel(estimate: TaskTimeEstimate): string {
  if (estimate === "up-to-2h") return "до 2 часов";
  if (estimate === "3-4h") return "3–4 часа";
  if (estimate === "5-7h") return "5–7 часов";
  if (estimate === "1d") return "1 день";
  if (estimate === "2d-plus") return "2+ дня";
  return "свой вариант";
}

function taskEstimateStorageKey(personId: string, taskId: string): string {
  return `garment-buro:task-estimate:${personId}:${taskId}`;
}

function compactTaskDescription(value: string): string {
  const text = value.trim() || "Задача находится в текущем фокусе проекта.";
  const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [text];
  return sentences.slice(0, 2).map((sentence) => sentence.trim()).join(" ");
}

function displayTaskTitle(value: string): string {
  return value
    .replace(/Creator Outreach Kit v0/gi, "Набор материалов для первого контакта с авторами")
    .replace(/Creator Preview Factory v0/gi, "Шаблон персонального примера для авторов")
    .replace(/Creator Pipeline v0/gi, "База потенциальных авторов")
    .replace(/End-to-end paid order test passed/gi, "Полная проверка оплаченного заказа завершена")
    .replace(/payment authorization\/?hold\s*(?:→|->)\s*capture\/?cancel/gi, "резервирование платежа → списание или отмена")
    .replace(/\bhandoff\b/gi, "передача")
    .replace(/\boutreach\b/gi, "первый контакт")
    .replace(/\bcreator\b/gi, "автор")
    .replace(/\bpreview\b/gi, "пример")
    .replace(/\bflow\b/gi, "сценарий");
}

function shortDate(value?: string) {
  if (!value) return "—";
  return formatDate(value).slice(0, 5);
}

function unique(values: string[]) {
  return Array.from(new Set(values));
}

function isTask(task: Task | undefined): task is Task {
  return Boolean(task);
}

function readErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;
  return fallback;
}

function commandSuccessMessage(result?: TaskActionSaveResult) {
  const assistantMessage = result?.assistantMessage || "Команда принята GPT и синхронизирована.";
  const timings = result?.timings;
  if (!timings?.clientRequestMs) return assistantMessage;
  const details = [
    timings.openAiMs ? `GPT ${formatDuration(timings.openAiMs)}` : "",
    timings.driveContextMs ? `Drive ${formatDuration(timings.driveContextMs)}` : "",
    timings.verificationMs ? `проверка ${formatDuration(timings.verificationMs)}` : ""
  ].filter(Boolean).join(" · ");
  return `Синхронизировано за ${formatDuration(timings.clientRequestMs)}${details ? ` (${details})` : ""}. ${assistantMessage}`;
}

function formatDuration(milliseconds: number) {
  return `${Math.max(0.1, milliseconds / 1000).toFixed(1).replace(".0", "")} сек.`;
}

function toggleFullscreen() {
  if (!document.fullscreenElement) {
    void document.documentElement.requestFullscreen?.();
  } else {
    void document.exitFullscreen?.();
  }
}
