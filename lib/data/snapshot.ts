import "server-only";

import { mkdir, readFile, rename, writeFile } from "fs/promises";
import path from "path";
import { dashboardConfig } from "@/lib/config";
import { restoreLastGoodSnapshot } from "@/lib/domain/snapshot-engine";
import type { DashboardState } from "@/lib/types";

export { restoreLastGoodSnapshot };

function snapshotPath(): string {
  return path.resolve(process.cwd(), dashboardConfig.snapshotPath);
}

export async function readDashboardSnapshot(): Promise<DashboardState | null> {
  try {
    return JSON.parse(await readFile(snapshotPath(), "utf8")) as DashboardState;
  } catch {
    return null;
  }
}

export async function writeDashboardSnapshot(state: DashboardState): Promise<void> {
  try {
    const target = snapshotPath();
    const temporary = `${target}.tmp`;
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(temporary, JSON.stringify(state), "utf8");
    await rename(temporary, target);
  } catch (error) {
    console.error("Could not write dashboard snapshot", error);
  }
}
