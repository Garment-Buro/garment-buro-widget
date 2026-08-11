import { invoke } from "@tauri-apps/api/core";
import { makeSourceStatus, normalizeDashboard } from "@/lib/data/normalize";
import type { DashboardState, RawSheetBundle, SourceName } from "@/lib/types";

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
  "now"
];

export async function loadDesktopDashboard(token: string, personName: string): Promise<DashboardState> {
  const payload = await invoke<AppsScriptPayload>("fetch_dashboard_data", { token });

  if (!payload.ok || !payload.data) {
    throw new Error(readableConnectionError(payload.error));
  }

  const sourceErrors = payload.sourceErrors || {};
  const sheets = Object.fromEntries(
    sheetKeys.map((key) => [key, Array.isArray(payload.data?.[key]) ? payload.data?.[key] : []])
  ) as SheetData;
  const raw: RawSheetBundle = {
    ...sheets,
    sources: (["execution", "control"] as SourceName[]).map((source) =>
      makeSourceStatus(source, !sourceErrors[source], sourceErrors[source] || undefined)
    )
  };

  return normalizeDashboard(raw, {
    dataMode: "google",
    personName,
    updatedAt: payload.generatedAt || new Date().toISOString()
  });
}

function readableConnectionError(error?: string) {
  if (!error) return "Не удалось получить данные. Проверьте интернет и повторите попытку.";
  if (/token|access|unauthor/i.test(error)) return "Код доступа не принят. Проверьте код и попробуйте снова.";
  return error;
}
