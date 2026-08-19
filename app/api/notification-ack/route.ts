import { NextResponse } from "next/server";
import { getWebSession } from "@/lib/auth/web-session";
import { getDashboardState } from "@/lib/data";
import { callAppsScriptGateway } from "@/lib/services/apps-script-gateway";
import type { NotificationAckResult } from "@/lib/services/notification-service";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const session = getWebSession();
    if (!session) return NextResponse.json({ error: "Требуется вход в виджет." }, { status: 401 });
    const body = await request.json() as { notificationId?: unknown; recipientId?: unknown };
    const notificationId = String(body.notificationId || "").trim();
    const requestedRecipientId = String(body.recipientId || "").trim();
    if (!/^[A-Za-z0-9_-]{1,120}$/.test(notificationId)) {
      return NextResponse.json({ error: "Некорректный NOTIFICATION_ID." }, { status: 400 });
    }

    const dashboard = await getDashboardState(session.personName);
    const recipientId = dashboard.person?.id || "";
    if (!recipientId || (requestedRecipientId && requestedRecipientId.toLowerCase() !== recipientId.toLowerCase())) {
      return NextResponse.json({ error: "Получатель уведомления не совпадает с dashboard-пользователем." }, { status: 403 });
    }

    const payload = await callAppsScriptGateway<{ notificationAck?: NotificationAckResult }>("notificationAck", {
      notificationId,
      recipientId
    }, 30_000);
    if (!payload.notificationAck || payload.notificationAck.syncStatus !== "SYNCED") {
      throw new Error("Apps Script не подтвердил запись ACK_AT.");
    }
    return NextResponse.json(payload.notificationAck, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Не удалось подтвердить уведомление.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
