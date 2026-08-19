import { NextResponse } from "next/server";
import { clearWebSession } from "@/lib/auth/web-session";

export async function POST() {
  clearWebSession();
  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
