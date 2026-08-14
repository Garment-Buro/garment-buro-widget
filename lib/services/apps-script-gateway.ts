import "server-only";

import { appsScriptConfig } from "@/lib/config";

type GatewayEnvelope<T> = {
  ok?: boolean;
  error?: string;
} & T;

export async function callAppsScriptGateway<T extends object>(
  action: string,
  request?: Record<string, unknown>,
  timeoutMs = 90_000
): Promise<GatewayEnvelope<T>> {
  if (!appsScriptConfig.webAppUrl || !appsScriptConfig.accessToken) {
    throw new Error("Apps Script gateway не настроен.");
  }

  const response = await fetch(appsScriptConfig.webAppUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      token: appsScriptConfig.accessToken,
      action,
      ...(request ? { request } : {})
    }),
    cache: "no-store",
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs)
  });

  const responseText = await response.text();
  if (!response.ok) throw new Error(`Apps Script вернул HTTP ${response.status}.`);

  let payload: GatewayEnvelope<T>;
  try {
    payload = JSON.parse(responseText) as GatewayEnvelope<T>;
  } catch {
    throw new Error("Apps Script вернул не JSON. Проверьте доступ к Web app deployment.");
  }
  if (!payload.ok) throw new Error(payload.error || "Apps Script gateway отклонил запрос.");
  return payload;
}
