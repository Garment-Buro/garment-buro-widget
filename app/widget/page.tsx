import type { Metadata } from "next";
import { WidgetClient } from "@/components/widget-client";
import { getDashboardState } from "@/lib/data";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "GARMENT BURO / Виджет задач",
  description: "Компактный рабочий виджет GARMENT BURO."
};

export default async function WidgetPage() {
  const state = await getDashboardState();
  return <WidgetClient initialState={state} />;
}
