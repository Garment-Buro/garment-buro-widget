export type NotificationAckResult = {
  notificationId: string;
  recipientId: string;
  acknowledgedAt: string;
  syncStatus: "SYNCED";
};

export async function acknowledgeNotification(
  accessToken: string | undefined,
  notificationId: string,
  recipientId: string
): Promise<NotificationAckResult> {
  if (isTauriRuntime()) {
    if (!accessToken) throw new Error("Код доступа к рабочему пространству не найден.");
    const { invoke } = await import("@tauri-apps/api/core");
    return invoke<NotificationAckResult>("ack_notification", {
      token: accessToken,
      notificationId,
      recipientId
    });
  }

  const response = await fetch(appPath("/api/notification-ack/"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ notificationId, recipientId }),
    cache: "no-store"
  });
  const body = await response.json() as NotificationAckResult & { error?: string };
  if (!response.ok) throw new Error(body.error || "Не удалось подтвердить уведомление.");
  return body;
}

function isTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
import { appPath } from "../base-path.ts";
