import "server-only";

import { appsScriptConfig, spreadsheetConfig } from "@/lib/config";
import { parseCsv } from "@/lib/ai/csv";
import { makeSourceStatus } from "@/lib/data/normalize";
import type { RawSheetBundle, SourceName } from "@/lib/types";

type SheetData = Omit<RawSheetBundle, "sources">;

interface AppsScriptPayload {
  ok: boolean;
  error?: string;
  generatedAt?: string;
  data?: Partial<SheetData>;
  sourceErrors?: Partial<Record<SourceName, string | null>>;
}

const sheetKeys: Array<keyof SheetData> = [
  "goals",
  "milestones",
  "tasks",
  "taskContexts",
  "progressGates",
  "changeEvents",
  "people",
  "issues",
  "notifications",
  "now"
];

export class AppsScriptDataSource {
  async fetch(): Promise<RawSheetBundle> {
    try {
      if (!appsScriptConfig.webAppUrl || !appsScriptConfig.accessToken) {
        throw new Error("Apps Script connection is not configured");
      }

      const response = await fetch(appsScriptConfig.webAppUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: appsScriptConfig.accessToken }),
        cache: "no-store",
        redirect: "follow",
        signal: AbortSignal.timeout(30_000)
      });

      if (!response.ok) throw new Error(`Apps Script: ${response.status} ${response.statusText}`);
      const payload = (await response.json()) as AppsScriptPayload;
      if (!payload.ok || !payload.data) throw new Error(payload.error || "Apps Script returned no data");

      const sourceErrors = payload.sourceErrors || {};
      const data = normalizeSheetData(payload.data);
      if (data.notifications.length < 2) {
        data.notifications = await fetchPublicNotifications();
      }
      return {
        ...data,
        sources: (["execution", "control"] as SourceName[]).map((source) =>
          makeSourceStatus(source, !sourceErrors[source], sourceErrors[source] || undefined)
        )
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        ...normalizeSheetData({}),
        sources: (["execution", "control"] as SourceName[]).map((source) =>
          makeSourceStatus(source, false, message)
        )
      };
    }
  }
}

async function fetchPublicNotifications(): Promise<string[][]> {
  const response = await fetch(
    `https://docs.google.com/spreadsheets/d/${spreadsheetConfig.executionId}/export?format=csv&gid=1015`,
    { cache: "no-store", signal: AbortSignal.timeout(15_000) }
  );
  if (!response.ok) throw new Error(`NOTIFICATIONS: ${response.status} ${response.statusText}`);
  return parseCsv(await response.text()).filter((row, index) => index === 0 || Boolean(row[0]?.trim()));
}

function normalizeSheetData(data: Partial<SheetData>): SheetData {
  return Object.fromEntries(
    sheetKeys.map((key) => [key, Array.isArray(data[key]) ? data[key] : []])
  ) as SheetData;
}
