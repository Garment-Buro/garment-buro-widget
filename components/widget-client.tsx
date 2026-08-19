"use client";

import { AlertTriangle, Bell, Clock3, Maximize2, Pin, PinOff, RefreshCw, Timer, X } from "lucide-react";
import Image from "next/image";
import { type MouseEvent, type ReactNode, useCallback, useEffect, useState } from "react";
import { formatDate } from "@/lib/date";
import { activePushNotifications } from "@/lib/domain/notification-engine";
import { formatTimer } from "@/lib/domain/work-session";
import { personAsset } from "@/lib/person-assets";
import { rewardTierForPercent } from "@/lib/reward-tier";
import { useWorkSession } from "@/lib/use-work-session";
import type { DashboardState } from "@/lib/types";
import { appPath } from "@/lib/base-path";

const refreshMs = 60_000;

export function WidgetClient({
  initialState,
  loadState,
  onOpenDashboard,
  onHideWidget,
  onStartDrag,
  isAlwaysOnTop,
  onToggleAlwaysOnTop,
  updateControl
}: {
  initialState: DashboardState;
  loadState?: () => Promise<DashboardState>;
  onOpenDashboard?: () => void;
  onHideWidget?: () => void;
  onStartDrag?: () => void;
  isAlwaysOnTop?: boolean;
  onToggleAlwaysOnTop?: () => void;
  updateControl?: ReactNode;
}) {
  const [state, setState] = useState(initialState);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setIsRefreshing(true);
    try {
      if (loadState) {
        setState(await loadState());
        return;
      }
      const response = await fetch(appPath("/api/dashboard"), { cache: "no-store" });
      if (response.ok) setState((await response.json()) as DashboardState);
    } catch {
      // Keep the last rendered state during a transient network failure.
    } finally {
      setIsRefreshing(false);
    }
  }, [loadState]);

  useEffect(() => {
    const timer = window.setInterval(() => void refresh(), refreshMs);
    return () => window.clearInterval(timer);
  }, [refresh]);

  const person = state.person;
  const currentTask = state.currentTask;
  const workSession = useWorkSession(person?.id || "");

  if (!person || !currentTask) {
    return (
      <main className="widget-page">
        <section className="widget-empty">
          <AlertTriangle size={28} />
          <strong>Нет активной задачи</strong>
        </section>
      </main>
    );
  }

  const progress = state.progress.readyPercent;
  const projectedProgress = state.progress.afterTaskPercent;
  const contribution = state.progress.taskPotentialPercent;
  const progressWidth = `${Math.min(progress, 100)}%`;
  const contributionWidth = `${Math.min(contribution, 100 - progress)}%`;
  const rewardTier = rewardTierForPercent(contribution);
  const priorityLabel = currentTask.launchCritical ? "Critical" : currentTask.priority || currentTask.status;
  const freshness = state.dataMode === "mock"
    ? "Демо-данные"
    : state.dataHealth.usingSnapshot
      ? `Кеш · ${state.dataHealth.staleMinutes ?? 0} мин`
      : "Данные актуальны";
  const notificationCount = activePushNotifications(state.notifications || [], person.id).length;

  function openDashboard() {
    if (onOpenDashboard) {
      onOpenDashboard();
      return;
    }
    window.location.assign(appPath("/"));
  }

  function startDrag(event: MouseEvent<HTMLElement>) {
    if (!onStartDrag || event.button !== 0 || (event.target as HTMLElement).closest("button")) return;
    onStartDrag();
  }

  return (
    <main className="widget-page">
      <section className={`widget-shell widget-tier-${rewardTier}`} aria-label="Виджет задач GARMENT BURO" onMouseDown={startDrag}>
        <header className="widget-header">
          <small
            className={state.dataHealth.usingSnapshot ? "widget-freshness is-stale" : "widget-freshness"}
          >
            <i aria-hidden="true" />{freshness}
          </small>
          {workSession.session ? (
            <button className="widget-session-pill" type="button" onClick={openDashboard} title="Открыть рабочую сессию">
              <Timer size={14} />
              <span>{workSession.session.status === "paused" ? "Пауза" : formatTimer(workSession.elapsedMs)}</span>
              {workSession.session.pomodoro ? <b>🍅 {formatTimer(workSession.pomodoroRemainingMs)}</b> : null}
            </button>
          ) : null}
          <div className="widget-window-controls">
            {updateControl}
            {notificationCount ? (
              <span className="widget-notification-indicator" title={`Новых уведомлений: ${notificationCount}`}>
                <Bell size={15} /><b>{notificationCount}</b>
              </span>
            ) : null}
            <button type="button" onClick={() => { void refresh(); }} disabled={isRefreshing} title="Обновить данные" aria-label="Обновить данные">
              <RefreshCw className={isRefreshing ? "spin" : undefined} size={16} />
            </button>
            {onToggleAlwaysOnTop ? (
              <button
                className={isAlwaysOnTop ? "is-active" : undefined}
                type="button"
                onClick={onToggleAlwaysOnTop}
                title={isAlwaysOnTop ? "Открепить от верхнего слоя" : "Закрепить поверх всех окон"}
                aria-label={isAlwaysOnTop ? "Открепить виджет" : "Закрепить виджет поверх всех окон"}
                aria-pressed={isAlwaysOnTop}
              >
                {isAlwaysOnTop ? <PinOff size={16} /> : <Pin size={16} />}
              </button>
            ) : null}
            <button type="button" onClick={openDashboard} title="Открыть полный дашборд" aria-label="Открыть полный дашборд">
              <Maximize2 size={16} />
            </button>
            {onHideWidget ? (
              <button type="button" onClick={onHideWidget} title="Скрыть в трей" aria-label="Скрыть в трей">
                <X size={17} />
              </button>
            ) : null}
          </div>
        </header>

        <div className="widget-body">
          <aside className="widget-person">
            <div className="widget-person-art">
              <Image
                src={personAsset(person.name, "full") || appPath("/assets/people/person-placeholder.svg")}
                alt={`Аватар: ${person.name}`}
                fill
                sizes="150px"
                priority
              />
            </div>
            <div className="widget-person-copy">
              <strong>{person.name}</strong>
              <span><i />Ваш ход</span>
              <small>{currentTask.deadline ? `до ${shortDate(currentTask.deadline)}` : "без срока"}</small>
            </div>
          </aside>

          <button className="widget-task" type="button" onClick={openDashboard} aria-label="Открыть текущую задачу в полном дашборде">
            <div className="widget-section-label">
              <span>Текущий таск</span>
              <i />
            </div>
            <strong className="widget-task-id">{currentTask.id}</strong>
            <div className="widget-task-copy">
              <h1>{currentTask.title}</h1>
              <p><b>Результат:</b> {currentTask.expectedResult || currentTask.acceptanceCriteria}</p>
            </div>
            <div className="widget-task-meta">
              <span className="widget-critical"><AlertTriangle size={16} />{priorityLabel}</span>
              <span><Clock3 size={16} />{currentTask.deadline ? `Срок ${shortDate(currentTask.deadline)}` : "Срок не задан"}</span>
            </div>
          </button>

          <section className="widget-progress" aria-label={`Прогресс до MVP: ${progress}%`}>
            <div className="widget-section-label"><span>Прогресс до MVP</span></div>
            <strong>{progress}<span>%</span></strong>
            <div className="widget-progress-track">
              <i style={{ width: progressWidth }} />
              <em style={{ width: progressWidth }}>{displayPercent(progress)}%</em>
              {contribution > 0 ? (
                <b style={{ left: progressWidth, width: contributionWidth }} title={state.progress.potentialLabel}>
                  <span>+{displayPercent(contribution)}%</span><small>потенциал</small>
                </b>
              ) : null}
            </div>
            <p>
              {contribution > 0 ? <><span>+{displayPercent(contribution)}% за этот таск</span><br /></> : null}
              {contribution > 0 ? "После верификации:" : state.progress.potentialLabel || "Потенциал не задан"} {contribution > 0 ? <b>{displayPercent(projectedProgress)}%</b> : null}
            </p>
            {state.progress.scopeDeltaPoints ? (
              <p className="widget-change">Scope {signed(state.progress.scopeDeltaPoints)} · {state.goal?.scopeVersion}</p>
            ) : null}
            {state.progress.forecastDeltaDays && state.recentChange?.forecastDateBefore && state.recentChange.forecastDateAfter ? (
              <p className="widget-change">Forecast {shortDate(state.recentChange.forecastDateBefore)} → {shortDate(state.recentChange.forecastDateAfter)} · {signed(state.progress.forecastDeltaDays)} дн.</p>
            ) : null}
          </section>
        </div>
      </section>
    </main>
  );
}

function shortDate(value: string) {
  return formatDate(value).slice(0, 5);
}

function displayPercent(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(".", ",");
}

function signed(value: number) {
  return value > 0 ? `+${value}` : String(value);
}
