import type { DashboardState, SourceStatus } from "../types.ts";

export function restoreLastGoodSnapshot(snapshot: DashboardState, sources: SourceStatus[]): DashboardState {
  const staleMinutes = Math.max(0, Math.floor((Date.now() - Date.parse(snapshot.updatedAt)) / 60_000));
  const details = sources
    .filter((source) => source.status !== "LIVE")
    .map((source) => `${source.name}: ${source.error || source.status}`);
  const codes = new Set(snapshot.dataHealth.codes);
  codes.add("STALE_DATA");
  if (sources.some((source) => source.status === "LIVE") && sources.some((source) => source.status !== "LIVE")) {
    codes.add("PARTIAL_SOURCE_ERROR");
  }

  return {
    ...snapshot,
    dataMode: "google",
    sources,
    dataHealth: {
      codes: [...codes],
      details: [...snapshot.dataHealth.details, ...details],
      staleMinutes: Number.isFinite(staleMinutes) ? staleMinutes : null,
      usingSnapshot: true
    }
  };
}
