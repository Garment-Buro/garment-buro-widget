import "server-only";

import { makeSourceStatus } from "@/lib/data/normalize";
import { callAppsScriptGateway } from "@/lib/services/apps-script-gateway";
import type { RawSheetBundle, SourceName } from "@/lib/types";

type SheetData = Omit<RawSheetBundle, "sources">;

interface AppsScriptPayload {
  ok: boolean;
  error?: string;
  generatedAt?: string;
  data?: Partial<SheetData>;
  sourceErrors?: Partial<Record<SourceName, string | null>>;
  notificationsError?: string | null;
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
      const payload = await callAppsScriptGateway<AppsScriptPayload>("dashboard", undefined, 30_000);
      if (!payload.data) throw new Error("Apps Script returned no data");

      const sourceErrors = { ...(payload.sourceErrors || {}) };
      if (payload.notificationsError && !sourceErrors.execution) {
        sourceErrors.execution = `NOTIFICATIONS: ${payload.notificationsError}`;
      }
      const data = normalizeSheetData(payload.data);
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

function normalizeSheetData(data: Partial<SheetData>): SheetData {
  return Object.fromEntries(
    sheetKeys.map((key) => [key, Array.isArray(data[key]) ? data[key] : []])
  ) as SheetData;
}
