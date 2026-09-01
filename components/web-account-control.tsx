"use client";

import { LoaderCircle, LogOut } from "lucide-react";
import { useState } from "react";
import { appPath } from "@/lib/base-path";

export function WebAccountControl({ personName, compact = false }: { personName: string; compact?: boolean }) {
  const [isLeaving, setIsLeaving] = useState(false);

  async function logOut() {
    setIsLeaving(true);
    try {
      const response = await fetch(appPath("/api/auth/logout/"), { method: "POST", cache: "no-store" });
      if (!response.ok) throw new Error("Не удалось выйти из профиля.");
      window.location.replace(appPath("/"));
    } catch {
      setIsLeaving(false);
    }
  }

  return (
    <button
      className={`web-account-control ${compact ? "is-compact" : ""}`.trim()}
      type="button"
      onClick={() => { void logOut(); }}
      disabled={isLeaving}
      title={`Выйти из профиля · ${personName}`}
      aria-label={`Выйти из профиля ${personName}`}
    >
      {isLeaving ? <LoaderCircle className="spin" size={15} /> : <LogOut size={15} />}
      {!compact ? <span>{isLeaving ? "Выходим" : "Выйти"}</span> : null}
    </button>
  );
}
