import { DashboardClient } from "@/components/dashboard-client";
import { getDashboardState } from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function Page() {
  const state = await getDashboardState();
  return <DashboardClient initialState={state} />;
}
