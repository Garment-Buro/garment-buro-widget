"use client";

import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BarChart3,
  CalendarDays,
  Check,
  ChevronLeft,
  CircleDot,
  Clock3,
  FileText,
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
  RefreshCw,
  Search,
  Settings,
  Shirt,
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
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { formatDate } from "@/lib/date";
import { rewardTierForPercent } from "@/lib/reward-tier";
import type { DashboardState, Person, ProgressGate, Task } from "@/lib/types";

const refreshMs = 60_000;
const completedStatuses = new Set(["DONE", "CANCELLED"]);
const personAssets: Partial<Record<string, { full: string; avatar: string }>> = {
  "Вера": {
    full: "/assets/people/vera-full.png",
    avatar: "/assets/people/vera-avatar.png"
  }
};

type WorkspaceView = "personal" | "tree";
type IconComponent = LucideIcon;

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
  loadState
}: {
  initialState: DashboardState;
  loadState?: () => Promise<DashboardState>;
}) {
  const [state, setState] = useState(initialState);
  const [view, setView] = useState<WorkspaceView>("personal");
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [treeSearch, setTreeSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [showFilters, setShowFilters] = useState(false);
  const [treeScale, setTreeScale] = useState(1);

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
  const currentTask = state.currentTask;
  const ownedTasks = state.tasks.filter((task) => task.owner === person?.name && !completedStatuses.has(task.status));
  const downstream = currentTask ? collectDownstream(currentTask, state.tasks) : [];
  const directUnlocks = state.dependencies.unlocks;
  const fallbackTask = ownedTasks.find(
    (task) => task.id !== currentTask?.id && !task.blockedBy.length && task.status !== "WAITING_EXTERNAL"
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
          onSearch={setTreeSearch}
          onFilter={setStatusFilter}
          onToggleFilters={() => setShowFilters((value) => !value)}
          onScale={setTreeScale}
          onBack={() => setView("personal")}
          onOpenTask={setSelectedTask}
        />
      )}
      {selectedTask ? (
        <TaskDrawer task={selectedTask} allTasks={state.tasks} onClose={() => setSelectedTask(null)} />
      ) : null}
    </>
  );
}

function PersonalWorkspace({
  state,
  person,
  currentTask,
  downstream,
  directUnlocks,
  fallbackTask,
  waitingTask,
  projectProgress,
  sprint,
  sourceTone,
  isRefreshing,
  onRefresh,
  onOpenTree,
  onOpenTask
}: {
  state: DashboardState;
  person: Person;
  currentTask: Task;
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
}) {
  const goal = state.goal;
  const waitingOwners = unique(directUnlocks.map((task) => task.owner).filter((owner) => owner && owner !== person.name));
  const unlockLabel = directUnlocks.length === 1 ? "1 задачу" : `${directUnlocks.length} задачи`;
  const waitingLabel = directUnlocks.length === 1 ? "1 задача ждёт результата" : `${directUnlocks.length} задачи ждут результата`;
  const expected = currentTask.expectedResult || currentTask.acceptanceCriteria;
  const handoffLabel = currentTask.deadline ? `Срок ${shortDate(currentTask.deadline)}` : "Срок не задан";
  const taskImpact = state.progress.taskPotentialPercent;
  const afterTaskProgress = state.progress.afterTaskPercent;
  const trackerTier = rewardTierForPercent(taskImpact);

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
          <MetaRow icon={Focus} label="Project focus" />
          <MetaRow icon={Layers3} label={`Спринт ${sprint} / 3`} />
        </div>
      </aside>

      <section className="turn-column">
        <header className="turn-header">
          <div>
            <p className="screen-kicker">Личное рабочее пространство</p>
            <h1>Сейчас ваш ход</h1>
          </div>
          <div className="live-controls">
            <span className={`live-state ${sourceTone !== "LIVE" ? "is-warning" : ""}`}>
              <i /> {sourceTone}
            </span>
            <button className="icon-button" onClick={onRefresh} disabled={isRefreshing} aria-label="Обновить данные" title="Обновить данные">
              <RefreshCw size={17} className={isRefreshing ? "spin" : ""} />
            </button>
          </div>
        </header>

        <section className="handoff-panel" aria-label="Эстафета задачи">
          <p className="panel-eyebrow">Эстафета у вас</p>
          <div className="handoff-grid">
            <HandoffItem icon={CircleDot} label={currentTask.launchCritical ? "Критический ход" : statusLabel(currentTask.status)} accent={currentTask.launchCritical} />
            <HandoffItem
              icon={UsersRound}
              label={waitingOwners.length ? `${waitingOwners.length} чел. ждут результата` : waitingLabel}
            />
            <HandoffItem icon={Link2} label={`Открывает ${unlockLabel}`} />
            <HandoffItem icon={Clock3} label={handoffLabel} />
          </div>
        </section>

        <p className="unlock-summary">
          После этого откроется {downstream.length ? downstream.slice(0, 3).map((task) => task.id).join(" → ") : "следующий этап"}
        </p>

        <button className="current-focus-card" onClick={() => onOpenTask(currentTask)}>
          <div className="focus-copy">
            <p className="panel-eyebrow">Текущий фокус</p>
            <h2>{currentTask.id} — {currentTask.title}</h2>
            <p className="waiting-copy">
              {currentTask.waitingFor ? `Ждём: ${currentTask.waitingFor}` : `Следующий результат ждёт цепочка ${downstream.slice(0, 2).map((task) => task.id).join(" → ") || "проекта"}`}
            </p>
            <div className="delivery-copy">
              <strong>Что нужно выдать:</strong>
              <span>{expected || "Зафиксированный результат и понятный следующий шаг."}</span>
            </div>
          </div>
          <div className="focus-tags">
            <StatusBadge task={currentTask} allTasks={state.tasks} prominent />
            {currentTask.projectFocus ? <span className="outline-tag">Project focus</span> : null}
            <span className="outline-tag accent">{handoffLabel}</span>
          </div>
        </button>

        <button className="sprint-map" onClick={onOpenTree} aria-label="Открыть полное дерево задач">
          <div className="sprint-map-head">
            <span>Спринт {sprint} — in progress</span>
            <span>Нажмите, чтобы открыть полное дерево <ArrowRight size={16} /></span>
          </div>
          <div className="mini-route">
            <MiniMilestone icon={Check} label="Спринт 1" note="Done" done />
            <span className="route-arrow">→</span>
            <MiniTask task={currentTask} active />
            {directUnlocks[0] ? (
              <>
                <span className="route-arrow">→</span>
                <MiniTask task={directUnlocks[0]} />
              </>
            ) : null}
            <span className="route-arrow">→</span>
            <MiniMilestone icon={Flag} label="Спринт 3" note="Next" />
          </div>
          <span className="sprint-map-progress"><i style={{ width: `${projectProgress}%` }} /></span>
        </button>
      </section>

      <aside className="progress-column">
        <section className={`progress-panel sprint-tracker tracker-tier-${trackerTier}`}>
          <p className="sprint-tracker-title">Трекер спринта</p>
          <ProgressGauge value={projectProgress} projectedValue={afterTaskProgress} contribution={taskImpact} />
          <p className="progress-sprint">Спринт {sprint} из 3</p>
          <p className="progress-caption">до цели MVP</p>
          <span className="progress-rule" />
          <p className="progress-result">Вклад текущей задачи</p>
          <p className="progress-reward">
            <b>+{formatPercent(taskImpact)}%</b>
            <span>после верификации будет {formatPercent(afterTaskProgress)}%</span>
          </p>
        </section>

        <section className="info-card">
          <div className="info-icon"><LockKeyhole size={24} /></div>
          <div>
            <h3>Что откроется после этого</h3>
            {downstream.slice(0, 3).map((task) => (
              <button key={task.id} onClick={() => onOpenTask(task)}>
                {task.id} — {task.title}
              </button>
            ))}
            {!downstream.length ? <p>Финальная точка этой ветки.</p> : null}
          </div>
        </section>

        <section className="info-card blocked-help">
          <div className="info-icon"><Clock3 size={24} /></div>
          <div>
            <h3>Если упёрлись</h3>
            <p>{waitingTask?.waitingFor ? `Ждём: ${waitingTask.waitingFor}` : "Зафиксируйте блокер в исходной таблице."}</p>
            <p>{fallbackTask ? `Пока ждём: ${fallbackTask.id} — ${fallbackTask.title}` : "Возьмите следующую доступную задачу."}</p>
            <span>Next check: {shortDate(waitingTask?.nextCheckDate || currentTask.nextCheckDate)}</span>
          </div>
        </section>
      </aside>
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
  onSearch,
  onFilter,
  onToggleFilters,
  onScale,
  onBack,
  onOpenTask
}: {
  state: DashboardState;
  person: Person;
  currentTask: Task;
  projectProgress: number;
  search: string;
  statusFilter: string;
  showFilters: boolean;
  scale: number;
  onSearch: (value: string) => void;
  onFilter: (value: string) => void;
  onToggleFilters: () => void;
  onScale: (value: number) => void;
  onBack: () => void;
  onOpenTask: (task: Task) => void;
}) {
  const goal = state.goal;
  const lanes = useMemo(() => buildLanes(state.tasks), [state.tasks]);
  const normalizedSearch = search.trim().toLowerCase();
  const visibleLanes = lanes.map((lane) => ({
    ...lane,
    tasks: lane.tasks.filter((task) => {
      const effective = effectiveStatus(task, state.tasks);
      if (statusFilter !== "ALL" && effective !== statusFilter) return false;
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
        <button className="collapse-button" onClick={onBack}><ChevronLeft size={16} /> Свернуть</button>
      </aside>

      <section className="tree-workspace">
        <header className="tree-header">
          <div>
            <button className="mobile-back" onClick={onBack}><ArrowLeft size={18} /> Назад</button>
            <h1>Полное древо задач</h1>
            <p>Полная карта задач и зависимостей проекта Commercial MVP</p>
          </div>
          <div className="tree-toolbar">
            <button className="toolbar-button" aria-label="Вид дерева"><span>Вид</span><Grid2X2 size={16} /></button>
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
                            <TaskNode task={task} allTasks={state.tasks} onOpen={() => onOpenTask(task)} />
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
  const asset = personAssets[person.name]?.[variant];
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

function MetaRow({ icon: Icon, label }: { icon: IconComponent; label: string }) {
  return <div className="meta-row"><Icon size={26} strokeWidth={1.4} /><span>{label}</span></div>;
}

function HandoffItem({ icon: Icon, label, accent }: { icon: IconComponent; label: string; accent?: boolean }) {
  return <div className={accent ? "handoff-item is-accent" : "handoff-item"}><Icon size={22} /><span>{label}</span></div>;
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
        <span className="progress-gauge-label">Сейчас</span>
        <strong>{formatPercent(value)}<span>%</span></strong>
        {contribution > 0 ? (
          <span className="progress-gauge-future">
            <b>+{formatPercent(contribution)}%</b>
            <small>за задачу</small>
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

function NavItem({ icon: Icon, label, active }: { icon: IconComponent; label: string; active?: boolean }) {
  return <button className={active ? "nav-item is-active" : "nav-item"}><Icon size={17} /><span>{label}</span></button>;
}

function TaskNode({ task, allTasks, onOpen }: { task: Task; allTasks: Task[]; onOpen: () => void }) {
  const status = effectiveStatus(task, allTasks);
  return (
    <button className={`task-node task-node-${status.toLowerCase()}`} onClick={onOpen}>
      <span className="task-node-id">{task.id}</span>
      <strong>{task.title}</strong>
      <div><OwnerMark owner={task.owner} /><span>{task.owner || "Не назначен"}</span><StatusPill status={status} /></div>
    </button>
  );
}

function OwnerMark({ owner }: { owner: string }) {
  const asset = personAssets[owner]?.avatar;
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

function TaskDrawer({ task, allTasks, onClose }: { task: Task; allTasks: Task[]; onClose: () => void }) {
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
