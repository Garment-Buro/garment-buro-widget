export type WorkSessionStatus = "active" | "paused";
export type PomodoroStatus = "running" | "paused" | "completed";

export interface PomodoroState {
  durationMinutes: number;
  status: PomodoroStatus;
  remainingMs: number;
  runningSince: number | null;
  completedCount: number;
}

export interface WorkSessionState {
  id: string;
  taskId: string;
  personId: string;
  startedAt: number;
  status: WorkSessionStatus;
  accumulatedMs: number;
  runningSince: number | null;
  pomodoro: PomodoroState | null;
}

export function createWorkSession(
  personId: string,
  taskId: string,
  id: string,
  now = Date.now()
): WorkSessionState {
  return {
    id,
    taskId,
    personId,
    startedAt: now,
    status: "active",
    accumulatedMs: 0,
    runningSince: now,
    pomodoro: null
  };
}

export function workSessionElapsedMs(session: WorkSessionState, now = Date.now()) {
  const currentRun = session.status === "active" && session.runningSince != null
    ? Math.max(0, now - session.runningSince)
    : 0;
  return session.accumulatedMs + currentRun;
}

export function pauseWorkSession(session: WorkSessionState, now = Date.now()): WorkSessionState {
  if (session.status === "paused") return session;
  return {
    ...session,
    status: "paused",
    accumulatedMs: workSessionElapsedMs(session, now),
    runningSince: null,
    pomodoro: session.pomodoro ? pausePomodoro(session.pomodoro, now) : null
  };
}

export function resumeWorkSession(session: WorkSessionState, now = Date.now()): WorkSessionState {
  if (session.status === "active") return session;
  return { ...session, status: "active", runningSince: now };
}

export function startPomodoro(
  session: WorkSessionState,
  durationMinutes: number,
  now = Date.now()
): WorkSessionState {
  const duration = Math.max(1, Math.round(durationMinutes));
  return {
    ...session,
    pomodoro: {
      durationMinutes: duration,
      status: "running",
      remainingMs: duration * 60_000,
      runningSince: now,
      completedCount: session.pomodoro?.completedCount || 0
    }
  };
}

export function pomodoroRemainingMs(pomodoro: PomodoroState | null, now = Date.now()) {
  if (!pomodoro) return 0;
  if (pomodoro.status !== "running" || pomodoro.runningSince == null) return pomodoro.remainingMs;
  return Math.max(0, pomodoro.remainingMs - Math.max(0, now - pomodoro.runningSince));
}

export function pausePomodoro(pomodoro: PomodoroState, now = Date.now()): PomodoroState {
  if (pomodoro.status !== "running") return pomodoro;
  return {
    ...pomodoro,
    status: "paused",
    remainingMs: pomodoroRemainingMs(pomodoro, now),
    runningSince: null
  };
}

export function resumePomodoro(pomodoro: PomodoroState, now = Date.now()): PomodoroState {
  if (pomodoro.status !== "paused" || pomodoro.remainingMs <= 0) return pomodoro;
  return { ...pomodoro, status: "running", runningSince: now };
}

export function completePomodoro(session: WorkSessionState): WorkSessionState {
  if (!session.pomodoro || session.pomodoro.status === "completed") return session;
  return {
    ...session,
    pomodoro: {
      ...session.pomodoro,
      status: "completed",
      remainingMs: 0,
      runningSince: null,
      completedCount: session.pomodoro.completedCount + 1
    }
  };
}

export function formatTimer(valueMs: number) {
  const seconds = Math.max(0, Math.floor(valueMs / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return hours > 0
    ? [hours, minutes, rest].map((part) => String(part).padStart(2, "0")).join(":")
    : [minutes, rest].map((part) => String(part).padStart(2, "0")).join(":");
}
