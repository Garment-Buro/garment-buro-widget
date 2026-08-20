import type { Metadata } from "next";
import { WidgetClient } from "@/components/widget-client";
import { WebAccountControl } from "@/components/web-account-control";
import { WebLogin } from "@/components/web-login";
import { getWebSession } from "@/lib/auth/web-session";
import { getDashboardState } from "@/lib/data";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "GARMENT BURO / Виджет задач",
  description: "Компактный рабочий виджет GARMENT BURO."
};

export default async function WidgetPage() {
  const session = getWebSession();
  if (!session) return <WebLogin redirectTo="/widget" />;

  const state = await getDashboardState(session.personName);
  if (!state.person) return <WebLogin initialName={session.personName} message="Профиль больше не доступен. Войдите заново." redirectTo="/widget" />;
  return <WidgetClient initialState={state} updateControl={<WebAccountControl personName={state.person.name} compact />} />;
}
