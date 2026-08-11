import { NextResponse } from "next/server";
import { getDashboardState } from "@/lib/data";

export const dynamic = "force-dynamic";

export async function GET() {
  const state = await getDashboardState();
  return NextResponse.json(state, {
    headers: {
      "Cache-Control": "no-store"
    }
  });
}
