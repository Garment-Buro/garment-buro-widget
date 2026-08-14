"use client";

import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BarChart3,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Clock3,
  Cloud,
  FileText,
  FilePlus2,
  Filter,
  Flag,
  Focus,
  Grid2X2,
  Layers3,
  Link2,
  ListChecks,
  LockKeyhole,
  Maximize2,
  Minus,
  Pin,
  PinOff,
  Play,
  RefreshCw,
  Search,
  Settings,
  Shirt,
  Sparkles,
  Star,
  Target,
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
import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { formatDate } from "@/lib/date";
import { buildDependencySummary } from "@/lib/domain/dependency-engine";
import { calculateProgress } from "@/lib/domain/progress-engine";
import { buildTaskRelationshipFocus, tasksInPersonalRelationshipView } from "@/lib/domain/task-relationship";
import { buildPersonalTaskQueue, isTaskPausedForPerson, type LocalTaskSignal } from "@/lib/domain/task-queue";
import { personAsset, samePerson } from "@/lib/person-assets";
import { rewardTierForPercent } from "@/lib/reward-tier";
import {
  requestTaskActionHelp,
  requestTaskAssistant,
  saveTaskActionMock,
  type TaskActionIntent,
  type TaskActionSubmission
} from "@/lib/services/task-action-service";
import type { DashboardState, DependencySummary, Person, ProgressGate, Task } from "@/lib/types";

export type { TaskActionSubmission } from "@/lib/services/task-action-service";

const refreshMs = 60_000;
const completedStatuses = new Set(["DONE", "CANCELLED"]);
type WorkspaceView = "personal" | "tree";
type TreeViewMode = "all" | "personal";
type IconComponent = LucideIcon;
type TaskActionConfirmation = "idle" | "saving" | "success";
type BlockerOutcome = "helped" | "blocked";

type TaskActionDraft = {
  note: string;
  nextCheckDate: string;
  blockerOutcome: BlockerOutcome | null;
  doneConfirmed: boolean;
};

const emptyTaskActionDraft = (): TaskActionDraft => ({
  note: "",
  nextCheckDate: "",
  blockerOutcome: null,
  doneConfirmed: false
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
  isAlwaysOnTop,
  onToggleAlwaysOnTop
}: {
  initialState: DashboardState;
  loadState?: () => Promise<DashboardState>;
  onExit?: () => void;
  onConfirmTaskAction?: (submission: TaskActionSubmission) => Promise<void>;
  isAlwaysOnTop?: boolean;
  onToggleAlwaysOnTop?: () => void;
}) {
  const [state, setState] = useState(initialState);
  const [view, setView] = useState<WorkspaceView>("personal");
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [focusedTaskId, setFocusedTaskId] = useState("");
  const [localTaskSignals, setLocalTaskSignals] = useState<Record<string, LocalTaskSignal>>({});
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
  const effectiveTasks = useMemo(
    () => state.tasks.map((task) => localTaskSignals[task.id] === "done" ? { ...task, status: "DONE" } : task),
    [localTaskSignals, state.tasks]
  );
  const taskQueue = useMemo(
    () => person ? buildPersonalTaskQueue(effectiveTasks, person.name, localTaskSignals) : [],
    [effectiveTasks, localTaskSignals, person]
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

  const confirmTaskAction = useCallback(async (submission: TaskActionSubmission) => {
    if (onConfirmTaskAction) await onConfirmTaskAction(submission);
    else await saveTaskActionMock(submission);

    const queueIndex = taskQueue.findIndex((task) => task.id === submission.taskId);
    const nextTask = taskQueue[queueIndex + 1];
    const shouldAdvance = submission.intent === "done"
      || submission.intent === "waiting"
      || (submission.intent === "stuck" && submission.details.blockerOutcome === "blocked");
    const signal = submission.intent === "stuck" && submission.details.blockerOutcome === "helped"
      ? "fact"
      : submission.intent;

    setLocalTaskSignals((signals) => ({ ...signals, [submission.taskId]: signal }));
    if (submission.intent === "done") setFocusedTaskId("");
    else if (shouldAdvance && nextTask) setFocusedTaskId(nextTask.id);
  }, [onConfirmTaskAction, taskQueue]);

  if (!person || !currentTask) {
    return (
      <main className="empty-state">
        <AlertTriangle size={28} />
        <h1>Не хватает данных для персонального экрана</h1>
        <p>Добавьте активного сотрудника и хотя бы одну назначенную ему задачу.</p>
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
          localTaskSignals={localTaskSignals}
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
        <TaskDrawer task={selectedTask} allTasks={state.tasks} state={state} onClose={() => setSelectedTask(null)} />
      ) : null}
    </>
  );
}

function PersonalWorkspace({
  state,
  person,
  currentTask,
  taskQueue,
  localTaskSignals,
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
  localTaskSignals: Record<string, LocalTaskSignal>;
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
  onConfirmTaskAction?: (submission: TaskActionSubmission) => Promise<void>;
  isAlwaysOnTop?: boolean;
  onToggleAlwaysOnTop?: () => void;
}) {
  const [taskAction, setTaskAction] = useState<TaskActionIntent | null>(null);
  const [taskActionDraft, setTaskActionDraft] = useState<TaskActionDraft>(emptyTaskActionDraft);
  const [assistantReply, setAssistantReply] = useState("");
  const [isRequestingHelp, setIsRequestingHelp] = useState(false);
  const [confirmation, setConfirmation] = useState<TaskActionConfirmation>("idle");
  const goal = state.goal;
  const waitingOwners = unique(directUnlocks.map((task) => task.owner).filter((owner) => owner && owner !== person.name));
  const handoffLabel = currentTask.deadline ? `Срок ${shortDate(currentTask.deadline)}` : "Срок не задан";
  const taskImpact = focusedProgress.taskPotentialPercent;
  const afterTaskProgress = focusedProgress.afterTaskPercent;
  const trackerTier = rewardTierForPercent(taskImpact);
  const taskContext = state.taskContexts.find((context) => context.taskId === currentTask.id);
  const relatedIssue = state.issues.find((issue) => issue.relatedTask === currentTask.id);
  const currentIndex = Math.max(0, taskQueue.findIndex((task) => task.id === currentTask.id));
  const previousTask = currentIndex > 0 ? taskQueue[currentIndex - 1] : undefined;
  const nextTask = currentIndex < taskQueue.length - 1 ? taskQueue[currentIndex + 1] : undefined;
  const incoming = dependencies.blockedBy.slice(0, 2);
  const outgoingTasks = directUnlocks.slice(0, 2);
  const outgoingGates = dependencies.unlocksGates.slice(0, Math.max(0, 2 - outgoingTasks.length));
  const eventTask = waitingTask || currentTask;
  const eventDate = eventTask.nextCheckDate || eventTask.deadline;
  const nextAction = relatedIssue?.nextAction || taskContext?.handoffResult || currentTask.expectedResult;
  const actionPreview = buildTaskActionPreview(taskAction, taskActionDraft, currentTask);
  const actionNote = confirmation === "saving"
    ? "Фиксируем выбранное состояние задачи."
    : confirmation === "success"
      ? "Состояние подтверждено локально. Запись в Google Drive подключим следующим этапом."
      : actionPreview
        ? "Проверьте preview и подтвердите фиксацию."
        : taskAction
          ? "Заполните короткую форму выбранного действия."
          : "Выберите быстрое действие, если состояние задачи изменилось.";

  useEffect(() => {
    if (confirmation !== "success") return;
    const timer = window.setTimeout(() => setConfirmation("idle"), 1_800);
    return () => window.clearTimeout(timer);
  }, [confirmation]);

  useEffect(() => {
    setTaskAction(null);
    setTaskActionDraft(emptyTaskActionDraft());
    setAssistantReply("");
    setIsRequestingHelp(false);
    setConfirmation("idle");
  }, [currentTask.id]);

  function selectTaskAction(intent: TaskActionIntent) {
    if (confirmation === "saving") return;
    if (intent !== taskAction) {
      setTaskActionDraft(emptyTaskActionDraft());
      setAssistantReply("");
      setIsRequestingHelp(false);
    }
    setTaskAction(intent);
    setConfirmation("idle");
  }

  function closeTaskAction() {
    if (confirmation === "saving") return;
    setTaskAction(null);
    setTaskActionDraft(emptyTaskActionDraft());
    setAssistantReply("");
  }

  async function requestBlockerHelp() {
    if (!taskActionDraft.note.trim() || isRequestingHelp) return;
    setIsRequestingHelp(true);
    setAssistantReply("");
    setTaskActionDraft((draft) => ({ ...draft, blockerOutcome: null }));
    try {
      setAssistantReply(await requestTaskActionHelp(currentTask.id, taskActionDraft.note, state));
    } catch (error) {
      setAssistantReply(error instanceof Error ? error.message : "Не удалось получить подсказку GPT.");
    } finally {
      setIsRequestingHelp(false);
    }
  }

  async function confirmTaskAction() {
    if (!taskAction || !actionPreview || confirmation === "saving") return;
    const submission: TaskActionSubmission = {
      taskId: currentTask.id,
      intent: taskAction,
      details: {
        note: taskActionDraft.note.trim(),
        nextCheckDate: taskActionDraft.nextCheckDate || undefined,
        blockerOutcome: taskActionDraft.blockerOutcome || undefined,
        acceptanceCriteria: taskAction === "done" ? currentTask.acceptanceCriteria || currentTask.expectedResult : undefined
      },
      preview: actionPreview
    };
    setConfirmation("saving");
    try {
      if (onConfirmTaskAction) {
        await onConfirmTaskAction(submission);
      } else {
        await saveTaskActionMock(submission);
      }
      setTaskAction(null);
      setTaskActionDraft(emptyTaskActionDraft());
      setAssistantReply("");
      setConfirmation("success");
    } catch {
      setConfirmation("idle");
    }
  }

  return (
    <main className="personal-page">
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
        <header className="turn-header">
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

          <article className="work-task-card">
            <div className="work-task-copy">
              <span className="task-id-chip">{currentTask.id}</span>
              <h2>{currentTask.title}</h2>
              <div className="task-detail-block">
                <strong>Почему сейчас</strong>
                <p>{currentTask.whyNow || "Задача находится в текущем фокусе проекта."}</p>
              </div>
              <div className="task-detail-block is-ready">
                <strong>Что считается готовым</strong>
                <p><Check size={15} />{currentTask.acceptanceCriteria || currentTask.expectedResult}</p>
              </div>
              <div className="task-detail-block is-next">
                <strong>Next action</strong>
                <p>{nextAction || "Зафиксировать результат и передать его следующему участнику процесса."}</p>
              </div>
            </div>

            <aside className="task-action-panel">
              <button className="primary-task-action" type="button" onClick={() => onOpenTask(currentTask)}><Play size={22} /><span>{currentTask.status === "IN_PROGRESS" ? "Продолжить" : "Начать"}</span></button>
              <div className="task-action-grid">
                <TaskActionButton icon={CircleHelp} label="Застрял" active={taskAction === "stuck"} disabled={confirmation === "saving"} onClick={() => selectTaskAction("stuck")} />
                <TaskActionButton icon={Clock3} label="Жду" active={taskAction === "waiting"} disabled={confirmation === "saving"} onClick={() => selectTaskAction("waiting")} />
                <TaskActionButton icon={FilePlus2} label="Новый факт" active={taskAction === "fact"} disabled={confirmation === "saving"} onClick={() => selectTaskAction("fact")} />
                <TaskActionButton icon={Check} label="Готово" active={taskAction === "done"} disabled={confirmation === "saving"} success onClick={() => selectTaskAction("done")} />
              </div>
              {taskAction ? (
                <TaskActionPopover
                  intent={taskAction}
                  draft={taskActionDraft}
                  acceptanceCriteria={currentTask.acceptanceCriteria || currentTask.expectedResult}
                  assistantReply={assistantReply}
                  isRequestingHelp={isRequestingHelp}
                  preview={actionPreview}
                  onDraftChange={setTaskActionDraft}
                  onRequestHelp={() => { void requestBlockerHelp(); }}
                  onClose={closeTaskAction}
                  onContinue={() => {
                    closeTaskAction();
                    onOpenTask(currentTask);
                  }}
                />
              ) : null}
              <div className={`assistant-note ${confirmation === "success" ? "is-success" : ""}`} aria-live="polite">
                {confirmation === "success" ? <Check size={19} /> : <Sparkles size={19} />}
                <p>{actionNote}</p>
              </div>
              <button
                className={`confirm-task-action is-${confirmation}`}
                type="button"
                disabled={!actionPreview || confirmation !== "idle"}
                onClick={() => { void confirmTaskAction(); }}
              >
                {confirmation === "saving" ? <RefreshCw className="spin" size={17} /> : confirmation === "success" ? <Check size={17} /> : null}
                <span>{confirmation === "saving" ? "Фиксируем" : confirmation === "success" ? onConfirmTaskAction ? "Зафиксировано" : "Подтверждено" : "Зафиксировать"}</span>
              </button>
            </aside>
          </article>

          <button className="task-nav-button is-next" type="button" onClick={() => nextTask && onFocusTask(nextTask.id)} disabled={!nextTask} aria-label="Следующая задача" title={nextTask ? `${nextTask.id}: ${nextTask.title}` : "Это последняя доступная задача"}>
            <ChevronRight size={22} />
          </button>
        </section>

        <div className="task-position" aria-label="Положение задачи в очереди">
          {taskQueue.map((task, index) => {
            const paused = isTaskPausedForPerson(task, localTaskSignals, person.name);
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
          <p className="progress-explainer">* Потенциальный вклад после фиксации результата. Данные из Google Drive.</p>
        </section>

        <section className="workspace-side-card event-card">
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
      </aside>

      <footer className="workspace-footer">
        <span><Cloud size={16} />Последняя фиксация: {updatedTime(state.updatedAt)}</span><i /><span>Данные из Google Drive</span>
        <button type="button" onClick={onRefresh} disabled={isRefreshing}><RefreshCw size={15} className={isRefreshing ? "spin" : ""} />Обновить</button>
        <small>{sourceTone === "LIVE" ? "Данные актуальны" : sourceTone}</small>
      </footer>
    </main>
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

  return (
    <main className="tree-page">
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
                <div><strong>{goal?.id || "Цель не задана"}</strong><p>{goal?.title || "Нет данных"}</p></div>
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
  return (
    <div className={`person-artwork person-artwork-${variant}`} aria-label={`Аватар: ${person.name}`}>
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
  assistantReply,
  isRequestingHelp,
  preview,
  onDraftChange,
  onRequestHelp,
  onClose,
  onContinue
}: {
  intent: TaskActionIntent;
  draft: TaskActionDraft;
  acceptanceCriteria: string;
  assistantReply: string;
  isRequestingHelp: boolean;
  preview: string;
  onDraftChange: (draft: TaskActionDraft) => void;
  onRequestHelp: () => void;
  onClose: () => void;
  onContinue: () => void;
}) {
  const updateDraft = (patch: Partial<TaskActionDraft>) => onDraftChange({ ...draft, ...patch });

  return (
    <section className={`task-action-popover action-${intent}`} aria-label={`Действие: ${taskActionLabel(intent)}`}>
      <header>
        <div><small>Быстрое действие</small><strong>{taskActionLabel(intent)}</strong></div>
        <button type="button" onClick={onClose} aria-label="Закрыть" title="Закрыть"><X size={16} /></button>
      </header>

      {intent === "stuck" ? (
        <div className="action-popover-body">
          <label>Что мешает продолжить?</label>
          <textarea autoFocus rows={2} value={draft.note} onChange={(event) => {
            updateDraft({ note: event.target.value, blockerOutcome: null });
          }} placeholder="Одна конкретная помеха" />
          <button className="popover-helper-button" type="button" disabled={!draft.note.trim() || isRequestingHelp} onClick={onRequestHelp}>
            <Sparkles size={15} /><span>{isRequestingHelp ? "Ищу следующий шаг" : "Получить короткую подсказку"}</span>
          </button>
          {assistantReply ? (
            <div className="popover-assistant-reply"><Sparkles size={15} /><p>{assistantReply}</p></div>
          ) : null}
          {assistantReply ? (
            <div className="popover-choice-row" aria-label="Результат подсказки">
              <button className={draft.blockerOutcome === "helped" ? "is-selected" : ""} type="button" onClick={() => updateDraft({ blockerOutcome: "helped" })}>Помогло</button>
              <button className={draft.blockerOutcome === "blocked" ? "is-selected" : ""} type="button" onClick={() => updateDraft({ blockerOutcome: "blocked" })}>Всё ещё блокирует</button>
            </div>
          ) : null}
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
          <div className="popover-choice-row is-confirmation" aria-label="Подтверждение готовности">
            <button className={draft.doneConfirmed ? "is-selected" : ""} type="button" onClick={() => updateDraft({ doneConfirmed: true })}>Да, готово</button>
            <button type="button" onClick={onContinue}>Нет, продолжить</button>
          </div>
        </div>
      ) : null}

      <div className={`task-action-preview ${preview ? "is-ready" : ""}`} aria-live="polite">
        <small>Будет зафиксировано</small>
        <p>{preview || previewHint(intent)}</p>
      </div>
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
        "--projected-angle": `${projectedAngle}deg`
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
  if (action === "stuck") return "Застрял";
  if (action === "waiting") return "Жду";
  if (action === "fact") return "Новый факт";
  return "Готово";
}

function buildTaskActionPreview(action: TaskActionIntent | null, draft: TaskActionDraft, task: Task) {
  const note = draft.note.trim();
  if (!action) return "";
  if (action === "stuck") {
    if (!note || !draft.blockerOutcome) return "";
    return `Блокер: ${note}. ${draft.blockerOutcome === "helped" ? "Подсказка помогла" : "Всё ещё блокирует"}.`;
  }
  if (action === "waiting") {
    if (!note) return "";
    const nextCheck = draft.nextCheckDate ? ` Следующая проверка: ${formatDate(draft.nextCheckDate)}.` : "";
    return `Ожидание: ${note}.${nextCheck}`;
  }
  if (action === "fact") return note ? `Новый факт: ${note}.` : "";
  if (!draft.doneConfirmed) return "";
  return `Готово: критерий задачи «${task.acceptanceCriteria || task.expectedResult}» подтверждён.`;
}

function previewHint(action: TaskActionIntent) {
  if (action === "stuck") return "Опишите помеху, получите подсказку и отметьте результат.";
  if (action === "waiting") return "Укажите, кого или что ждём.";
  if (action === "fact") return "Коротко укажите новый факт.";
  return "Подтвердите соответствие критерию готовности.";
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
    <span className={asset ? "owner-mark has-image" : "owner-mark"} aria-hidden>
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
  onClose
}: {
  task: Task;
  allTasks: Task[];
  state: DashboardState;
  onClose: () => void;
}) {
  const status = effectiveStatus(task, allTasks);
  return (
    <>
      <button className="drawer-backdrop" aria-label="Закрыть детали задачи" onClick={onClose} />
      <aside className="task-drawer">
        <header>
          <div><span>{task.id} · {task.owner}</span><h2>{task.title}</h2></div>
          <button className="icon-button" onClick={onClose} aria-label="Закрыть"><X size={19} /></button>
        </header>
        <div className="drawer-tags">
          <StatusPill status={status} />
          <span className="outline-tag">Gate {task.launchGate}</span>
          {task.projectFocus ? <span className="outline-tag accent">Project focus</span> : null}
        </div>
        <DrawerField label="Почему сейчас" value={task.whyNow} />
        <DrawerField label="Ожидаемый результат" value={task.expectedResult} />
        <DrawerField label="Критерий готовности" value={task.acceptanceCriteria} />
        <DrawerField label="Зависит от" value={task.blockedBy.join(", ") || "—"} />
        <DrawerField label="Открывает" value={task.unlocks.join(", ") || "—"} />
        <DrawerField label="Ждём" value={task.waitingFor || "—"} />
        <DrawerField label="Следующая проверка" value={formatDate(task.nextCheckDate)} />
        <DrawerField label="Срок" value={formatDate(task.deadline)} />
        <DrawerField label="Источник" value={task.source || "—"} />
        <TaskAssistantPanel task={task} state={state} />
      </aside>
    </>
  );
}

function TaskAssistantPanel({ task, state }: { task: Task; state: DashboardState }) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [sourceNote, setSourceNote] = useState("");

  useEffect(() => {
    setQuestion("");
    setAnswer("");
    setError("");
    setSourceNote("");
    setIsLoading(false);
  }, [task.id]);

  async function ask(mode: "start" | "ask" | "acceptance") {
    if (isLoading || (mode === "ask" && !question.trim())) return;
    setIsLoading(true);
    setAnswer("");
    setError("");
    setSourceNote("");
    try {
      const response = await requestTaskAssistant({
        taskId: task.id,
        mode,
        message: mode === "ask" ? question.trim() : undefined
      }, state);
      setAnswer(response.answer);
      const warning = response.warnings[0];
      setSourceNote(warning || `Сверено с Google Drive · ${response.model}`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Не удалось получить ответ GPT.");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <section className="drawer-assistant" aria-label="GPT-навигатор по задаче">
      <header>
        <div><span>GPT-навигатор</span><strong>Работа с текущими данными</strong></div>
        <Sparkles size={19} />
      </header>
      <p>Перед ответом читаем актуальный мастер‑промпт, задачу, контекст, playbook и последние события из Google Drive.</p>
      <div className="drawer-assistant-actions">
        <button type="button" disabled={isLoading} onClick={() => { void ask("start"); }}>Как начать</button>
        <button type="button" disabled={isLoading} onClick={() => { void ask("acceptance"); }}>Проверить готовность</button>
      </div>
      <form onSubmit={(event) => { event.preventDefault(); void ask("ask"); }}>
        <textarea
          rows={3}
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="Спросить GPT по этой задаче"
          maxLength={4000}
        />
        <button type="submit" disabled={isLoading || !question.trim()}>
          {isLoading ? <RefreshCw className="spin" size={15} /> : <ArrowRight size={15} />}
          {isLoading ? "Сверяю данные" : "Спросить"}
        </button>
      </form>
      {answer ? <div className="drawer-assistant-answer"><Sparkles size={16} /><p>{answer}</p></div> : null}
      {error ? <div className="drawer-assistant-error"><AlertTriangle size={16} /><p>{error}</p></div> : null}
      {sourceNote ? <small>{sourceNote}</small> : null}
    </section>
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

function toggleFullscreen() {
  if (!document.fullscreenElement) {
    void document.documentElement.requestFullscreen?.();
  } else {
    void document.exitFullscreen?.();
  }
}
