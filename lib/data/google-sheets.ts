import "server-only";

import { createSign } from "crypto";
import { readFile } from "fs/promises";
import { spreadsheetConfig } from "@/lib/config";
import { makeSourceStatus } from "@/lib/data/normalize";
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
  now: { ...execution("NOW", "A1:K200"), optional: true },
  issues: {
    spreadsheetId: spreadsheetConfig.controlId,
    sheetName: "ISSUES",
    range: "A1:M300",
    source: "control"
  }
};

let cachedToken: { token: string; expiresAt: number } | null = null;

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

  const token = await getServiceAccountToken();
  return `&access_token=${encodeURIComponent(token)}`;
}

async function getServiceAccountToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.token;

  const credentials = await getServiceAccountCredentials();
  if (!credentials.client_email || !credentials.private_key) {
    throw new Error("Google Sheets credentials are not configured");
  }

  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64Url(JSON.stringify({
    iss: credentials.client_email,
    scope: "https://www.googleapis.com/auth/spreadsheets.readonly",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now
  }));
  const unsigned = `${header}.${claim}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(credentials.private_key, "base64url");
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${signature}`
    })
  });

  if (!response.ok) throw new Error(`Google token request failed: ${response.status} ${response.statusText}`);
  const payload = (await response.json()) as { access_token: string; expires_in: number };
  cachedToken = { token: payload.access_token, expiresAt: Date.now() + payload.expires_in * 1000 };
  return cachedToken.token;
}

async function getServiceAccountCredentials(): Promise<{ client_email?: string; private_key?: string }> {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    const file = await readFile(process.env.GOOGLE_APPLICATION_CREDENTIALS, "utf8");
    return JSON.parse(file) as { client_email?: string; private_key?: string };
  }

  return {
    client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n")
  };
}

function base64Url(value: string): string {
  return Buffer.from(value).toString("base64url");
}
