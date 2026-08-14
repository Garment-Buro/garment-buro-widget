"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  completePomodoro,
  createWorkSession,
  pausePomodoro,
  pauseWorkSession,
  pomodoroRemainingMs,
  resumePomodoro,
  resumeWorkSession,
  startPomodoro,
  workSessionElapsedMs,
  type WorkSessionState
} from "@/lib/domain/work-session";

const storagePrefix = "garment-buro-work-session";
const sessionEvent = "garment-buro-work-session-changed";

export function useWorkSession(personId: string) {
  const storageKey = `${storagePrefix}:${personId || "unknown"}`;
  const [session, setSession] = useState<WorkSessionState | null>(null);
  const [now, setNow] = useState(Date.now());

  const persist = useCallback((next: WorkSessionState | null) => {
    if (next) window.localStorage.setItem(storageKey, JSON.stringify(next));
    else window.localStorage.removeItem(storageKey);
    setSession(next);
    window.dispatchEvent(new Event(sessionEvent));
  }, [storageKey]);

  useEffect(() => {
    setSession(readSession(storageKey));
    const sync = () => setSession(readSession(storageKey));
    window.addEventListener("storage", sync);
    window.addEventListener(sessionEvent, sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener(sessionEvent, sync);
    };
  }, [storageKey]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!session?.pomodoro || session.pomodoro.status !== "running") return;
    if (pomodoroRemainingMs(session.pomodoro, now) > 0) return;
    persist(completePomodoro(session));
  }, [now, persist, session]);

  const api = useMemo(() => ({
    start(taskId: string, sessionId = makeSessionId()) {
      const next = createWorkSession(personId, taskId, sessionId);
      persist(next);
      return next;
    },
    pause() {
      if (session) persist(pauseWorkSession(session));
    },
    resume() {
      if (session) persist(resumeWorkSession(session));
    },
    close() {
      persist(null);
    },
    startPomodoro(durationMinutes: number) {
      if (session) persist(startPomodoro(session, durationMinutes));
    },
    pausePomodoro() {
      if (session?.pomodoro) persist({ ...session, pomodoro: pausePomodoro(session.pomodoro) });
    },
    resumePomodoro() {
      if (session?.pomodoro) persist({ ...session, pomodoro: resumePomodoro(session.pomodoro) });
    }
  }), [personId, persist, session]);

  return {
    session,
    elapsedMs: session ? workSessionElapsedMs(session, now) : 0,
    pomodoroRemainingMs: session ? pomodoroRemainingMs(session.pomodoro, now) : 0,
    ...api
  };
}

function readSession(key: string): WorkSessionState | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) as WorkSessionState : null;
  } catch {
    return null;
  }
}

function makeSessionId() {
  const suffix = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `SESSION-${suffix}`;
}
