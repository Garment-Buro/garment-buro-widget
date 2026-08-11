import "server-only";

import { dashboardConfig } from "@/lib/config";
import { AppsScriptDataSource } from "@/lib/data/apps-script";
import { GoogleSheetsDataSource } from "@/lib/data/google-sheets";
import { MockDataSource } from "@/lib/data/mock";
import { normalizeDashboard } from "@/lib/data/normalize";
import { readDashboardSnapshot, restoreLastGoodSnapshot, writeDashboardSnapshot } from "@/lib/data/snapshot";
import type { DashboardState } from "@/lib/types";

export async function getDashboardState(): Promise<DashboardState> {
  const sourceName = dashboardConfig.dataSource.toLowerCase();
  const isGoogle = sourceName === "google" || sourceName === "apps-script";
  const source = sourceName === "apps-script"
    ? new AppsScriptDataSource()
    : sourceName === "google"
      ? new GoogleSheetsDataSource()
      : new MockDataSource();
  const raw = await source.fetch();
  const hasSourceError = raw.sources.some((item) => item.status !== "LIVE");

  if (isGoogle && hasSourceError) {
    const snapshot = await readDashboardSnapshot();
    if (snapshot) return restoreLastGoodSnapshot(snapshot, raw.sources);
  }

  const state = normalizeDashboard(raw, {
    dataMode: isGoogle ? "google" : "mock",
    goalId: dashboardConfig.launchGoalId,
    personName: dashboardConfig.personName,
    updatedAt: new Date().toISOString()
  });

  if (isGoogle && !hasSourceError) await writeDashboardSnapshot(state);
  return state;
}
