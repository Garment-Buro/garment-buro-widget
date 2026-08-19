import "server-only";

import { mkdir, readFile, rename, writeFile } from "fs/promises";
import { createHash } from "node:crypto";
import path from "path";
import { dashboardConfig } from "@/lib/config";
import { restoreLastGoodSnapshot } from "@/lib/domain/snapshot-engine";
import type { DashboardState } from "@/lib/types";

export { restoreLastGoodSnapshot };

function snapshotPath(personName: string): string {
  const configured = path.resolve(process.cwd(), dashboardConfig.snapshotPath);
  const extension = path.extname(configured);
  const stem = extension ? configured.slice(0, -extension.length) : configured;
  const personKey = createHash("sha256").update(personName.trim().toLocaleLowerCase("ru")).digest("hex").slice(0, 12);
  return `${stem}-${personKey}${extension || ".json"}`;
}

export async function readDashboardSnapshot(personName: string): Promise<DashboardState | null> {
  try {
    return JSON.parse(await readFile(snapshotPath(personName), "utf8")) as DashboardState;
  } catch {
    return null;
  }
}

export async function writeDashboardSnapshot(state: DashboardState, personName: string): Promise<void> {
  try {
    const target = snapshotPath(personName);
    const temporary = `${target}.tmp`;
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(temporary, JSON.stringify(state), "utf8");
    await rename(temporary, target);
  } catch (error) {
    console.error("Could not write dashboard snapshot", error);
  }
}
