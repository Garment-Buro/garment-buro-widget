import type { ProjectNotification } from "../types.ts";

const closedStatuses = new Set(["RESOLVED", "CLOSED", "DONE", "CANCELLED"]);

export function activePushNotifications(
  notifications: ProjectNotification[],
  recipientId: string
): ProjectNotification[] {
  const normalizedRecipient = recipientId.trim().toLocaleLowerCase("ru");
  if (!normalizedRecipient) return [];
  return notifications.filter((notification) => (
    Boolean(notification.id)
    && notification.push
    && notification.recipientId.trim().toLocaleLowerCase("ru") === normalizedRecipient
    && !closedStatuses.has(notification.status.trim().toUpperCase())
    && !notification.ackAt
    && !notification.resolvedAt
  ));
}
