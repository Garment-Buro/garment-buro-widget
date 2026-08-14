import "server-only";

import { spreadsheetConfig } from "@/lib/config";
import { makeSourceStatus } from "@/lib/data/normalize";
import { getGoogleAccessToken } from "@/lib/google/service-account";
import type { RawSheetBundle, SourceName } from "@/lib/types";

type SheetKey = Exclude<keyof RawSheetBundle, "sources">;
type RangeConfig = {
  spreadsheetId: string;
  sheetName: string;
  range: string;
  source: SourceName;
  optional?: boolean;
};

const ranges: Record<SheetKey, RangeConfig> = {
  goals: execution("GOALS", "A1:R300"),
  milestones: execution("MILESTONES", "A1:K500"),
  tasks: execution("TASKS", "A1:Z2000"),
  taskContexts: execution("TASK_CONTEXT", "A1:J500"),
  progressGates: execution("PROGRESS_GATES", "A1:O500"),
  changeEvents: execution("CHANGE_EVENTS", "A1:Q1000"),
  people: execution("PEOPLE", "A1:H100"),
  notifications: execution("NOTIFICATIONS", "A1:U1000"),
  now: { ...execution("NOW", "A1:K200"), optional: true },
  issues: {
    spreadsheetId: spreadsheetConfig.controlId,
    sheetName: "ISSUES",
    range: "A1:M300",
    source: "control"
  }
};

export class GoogleSheetsDataSource {
  async fetch(): Promise<RawSheetBundle> {
    const entries = await Promise.all(
      Object.entries(ranges).map(async ([key, config]) => {
        try {
          const values = await readRange(config.spreadsheetId, config.sheetName, config.range);
          return [key as SheetKey, values, null, config] as const;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          return [key as SheetKey, [], message, config] as const;
        }
      })
    );

    const sourceErrors = new Map<SourceName, string[]>();
    for (const [, , error, config] of entries) {
      if (!error || config.optional) continue;
      const errors = sourceErrors.get(config.source) || [];
      errors.push(error);
      sourceErrors.set(config.source, errors);
    }

    const data = Object.fromEntries(entries.map(([key, values]) => [key, values])) as Record<SheetKey, string[][]>;
    const sources = (["execution", "control"] as SourceName[]).map((source) => {
      const errors = sourceErrors.get(source);
      return makeSourceStatus(source, !errors?.length, errors?.join("; "));
    });

    return { ...data, sources };
  }
}

function execution(sheetName: string, range: string): RangeConfig {
  return {
    spreadsheetId: spreadsheetConfig.executionId,
    sheetName,
    range,
    source: "execution"
  };
}

async function readRange(spreadsheetId: string, sheetName: string, range: string): Promise<string[][]> {
  const auth = await getAuthQuery();
  const encodedRange = encodeURIComponent(`'${sheetName.replace(/'/g, "''")}'!${range}`);
  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodedRange}?valueRenderOption=FORMATTED_VALUE${auth}`,
    { cache: "no-store" }
  );

  if (!response.ok) throw new Error(`${sheetName}: ${response.status} ${response.statusText}`);
  const payload = (await response.json()) as { values?: string[][] };
  return payload.values || [];
}

async function getAuthQuery(): Promise<string> {
  if (process.env.GOOGLE_SHEETS_API_KEY) {
    return `&key=${encodeURIComponent(process.env.GOOGLE_SHEETS_API_KEY)}`;
  }

  const token = await getGoogleAccessToken(["https://www.googleapis.com/auth/spreadsheets.readonly"]);
  return `&access_token=${encodeURIComponent(token)}`;
}
