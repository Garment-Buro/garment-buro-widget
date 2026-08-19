import { NextResponse } from "next/server";
import { getWebSession } from "@/lib/auth/web-session";
import { getDashboardState } from "@/lib/data";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = getWebSession();
  if (!session) return NextResponse.json({ error: "Требуется вход в виджет." }, { status: 401 });
  const state = await getDashboardState(session.personName);
  return NextResponse.json(state, {
    headers: {
      "Cache-Control": "no-store"
    }
  });
}
