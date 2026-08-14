import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { enable as enableAutostart, isEnabled as isAutostartEnabled } from "@tauri-apps/plugin-autostart";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { load } from "@tauri-apps/plugin-store";
import { AlertTriangle, LoaderCircle } from "lucide-react";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { DashboardClient } from "@/components/dashboard-client";
import { WidgetClient } from "@/components/widget-client";
import { activePushNotifications } from "@/lib/domain/notification-engine";
import { acknowledgeNotification } from "@/lib/services/notification-service";
import type { DashboardState } from "@/lib/types";
import { loadDesktopDashboard } from "./data";

const settingsFile = "garment-buro-settings.json";
const deliveredNotificationsKey = "deliveredNotificationIds";
const deliveredInProcess = new Set<string>();
let notificationDelivery: Promise<void> = Promise.resolve();

type DesktopSettings = {
  accessToken: string;
  personName: string;
};

export function DesktopApp() {
  const [isDashboard, setIsDashboard] = useState(() => getCurrentWebviewWindow().label === "dashboard");
  const [settings, setSettings] = useState<DesktopSettings | null>(null);
  const [state, setState] = useState<DashboardState | null>(null);
  const [isBooting, setIsBooting] = useState(true);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isAlwaysOnTop, setIsAlwaysOnTop] = useState(false);
  const [error, setError] = useState("");

  const loadState = useCallback(async () => {
    if (!settings) throw new Error("Сначала введите код доступа.");
    const dashboard = await loadDesktopDashboard(settings.accessToken, settings.personName);
    setState(dashboard);
    await deliverProjectNotifications(dashboard, settings.accessToken);
    return dashboard;
  }, [settings]);

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      try {
        const store = await load(settingsFile, { autoSave: true });
        const accessToken = (await store.get<string>("accessToken"))?.trim() || "";
        const personName = (await store.get<string>("personName"))?.trim() || "";
        if (!accessToken) return;

        const savedSettings = { accessToken, personName };
        const dashboard = await loadDesktopDashboard(accessToken, personName);
        if (!cancelled) {
          setSettings(savedSettings);
          setState(dashboard);
        }
        void deliverProjectNotifications(dashboard, accessToken).catch(() => undefined);
        void ensureAutostart();
      } catch (bootError) {
        if (!cancelled) setError(errorMessage(bootError));
      } finally {
        if (!cancelled) setIsBooting(false);
      }
    }

    void boot();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const unlisten = listen<string>("desktop-view", (event) => {
      setIsDashboard(event.payload === "dashboard");
      if (settings) void loadState().catch(() => undefined);
    });
    return () => { void unlisten.then((stop) => stop()); };
  }, [loadState, settings]);

  useEffect(() => {
    void invoke<boolean>("get_always_on_top")
      .then(setIsAlwaysOnTop)
      .catch(() => setIsAlwaysOnTop(false));
    const unlisten = listen<boolean>("always-on-top-changed", (event) => setIsAlwaysOnTop(event.payload));
    return () => { void unlisten.then((stop) => stop()); };
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("desktop-widget-mode", !isDashboard);
    document.body.classList.toggle("desktop-widget-mode", !isDashboard);
  }, [isDashboard]);

  async function activate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const accessToken = String(form.get("accessToken") || "").trim();
    const personName = String(form.get("personName") || "").trim();
    if (!accessToken || !personName) return;

    setError("");
    setIsConnecting(true);
    try {
      const dashboard = await loadDesktopDashboard(accessToken, personName);
      const store = await load(settingsFile, { autoSave: true });
      await store.set("accessToken", accessToken);
      await store.set("personName", personName);
      await store.save();
      setSettings({ accessToken, personName });
      setState(dashboard);
      void ensureAutostart();
      void deliverProjectNotifications(dashboard, accessToken).catch(() => undefined);
    } catch (activationError) {
      setError(errorMessage(activationError));
    } finally {
      setIsConnecting(false);
    }
  }

  function openDashboard() {
    void invoke("open_dashboard_window").then(() => setIsDashboard(true));
  }

  function collapseDashboard() {
    void invoke("collapse_widget_window").then(() => setIsDashboard(false));
  }

  function toggleAlwaysOnTop() {
    void invoke<boolean>("toggle_always_on_top").then(setIsAlwaysOnTop);
  }

  if (isBooting) return <LoadingScreen label="Подключаем рабочее пространство" />;

  if (!settings || !state) {
    return <ActivationScreen error={error} isConnecting={isConnecting} onSubmit={activate} />;
  }

  if (isDashboard) {
    return (
      <div className="desktop-dashboard-view">
        <DashboardClient
          initialState={state}
          loadState={loadState}
          onExit={collapseDashboard}
          accessToken={settings.accessToken}
          isAlwaysOnTop={isAlwaysOnTop}
          onToggleAlwaysOnTop={toggleAlwaysOnTop}
        />
      </div>
    );
  }
  return (
    <WidgetClient
      initialState={state}
      loadState={loadState}
      onOpenDashboard={openDashboard}
      onHideWidget={() => { void invoke("hide_main_window"); }}
      onStartDrag={() => { void getCurrentWebviewWindow().startDragging(); }}
      isAlwaysOnTop={isAlwaysOnTop}
      onToggleAlwaysOnTop={toggleAlwaysOnTop}
    />
  );
}

function LoadingScreen({ label }: { label: string }) {
  return (
    <main className="desktop-status">
      <LoaderCircle className="spin" size={28} />
      <strong>{label}</strong>
    </main>
  );
}

function ActivationScreen({
  error,
  isConnecting,
  onSubmit
}: {
  error: string;
  isConnecting: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <main className="desktop-activation">
      <section>
        <header data-tauri-drag-region>
          <span data-tauri-drag-region>GARMENT BURO</span>
          <small data-tauri-drag-region>Project Control</small>
        </header>
        <div className="desktop-activation-copy">
          <p>Подключение сотрудника</p>
          <h1>Рабочее пространство</h1>
        </div>
        <form onSubmit={onSubmit}>
          <label>
            <span>Имя сотрудника</span>
            <input name="personName" placeholder="Вера, Костя или Никита" autoComplete="name" disabled={isConnecting} />
          </label>
          <label>
            <span>Код доступа</span>
            <input name="accessToken" type="password" autoComplete="off" disabled={isConnecting} autoFocus />
          </label>
          {error ? <p className="desktop-activation-error"><AlertTriangle size={15} />{error}</p> : null}
          <button type="submit" disabled={isConnecting}>
            {isConnecting ? <LoaderCircle className="spin" size={16} /> : null}
            {isConnecting ? "Проверяем" : "Подключить"}
          </button>
        </form>
      </section>
    </main>
  );
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

async function ensureAutostart() {
  try {
    if (!(await isAutostartEnabled())) await enableAutostart();
  } catch {
    // Autostart may be unavailable in an unpackaged development build.
  }
}

function deliverProjectNotifications(state: DashboardState, accessToken: string): Promise<void> {
  const run = notificationDelivery.then(async () => {
    const recipientId = state.person?.id.trim().toLocaleLowerCase("ru");
    if (!recipientId) return;

    const pending = activePushNotifications(state.notifications || [], recipientId);
    if (!pending.length) return;

    const store = await load(settingsFile, { autoSave: true });
    const delivered = new Set((await store.get<string[]>(deliveredNotificationsKey)) || []);
    const alreadyDelivered = pending.filter((notification) => delivered.has(notification.id));
    for (const notification of alreadyDelivered) {
      await acknowledgeNotification(accessToken, notification.id, recipientId).catch(() => undefined);
    }

    const fresh = pending.filter((notification) => !delivered.has(notification.id) && !deliveredInProcess.has(notification.id));
    if (!fresh.length) return;

    let permissionGranted = await isPermissionGranted();
    if (!permissionGranted) permissionGranted = (await requestPermission()) === "granted";
    if (!permissionGranted) return;

    for (const notification of fresh) {
      sendNotification({
        title: notification.title || "GARMENT BURO",
        body: notification.message || notification.taskId || "Новое уведомление"
      });
      delivered.add(notification.id);
      deliveredInProcess.add(notification.id);
      await acknowledgeNotification(accessToken, notification.id, recipientId).catch(() => undefined);
    }
    await store.set(deliveredNotificationsKey, [...delivered].slice(-250));
    await store.save();
  });
  notificationDelivery = run.catch(() => undefined);
  return run;
}
