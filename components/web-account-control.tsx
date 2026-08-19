"use client";

import { LoaderCircle, UserRound } from "lucide-react";
import { useState } from "react";
import { appPath } from "@/lib/base-path";

export function WebAccountControl({ personName, compact = false }: { personName: string; compact?: boolean }) {
  const [isLeaving, setIsLeaving] = useState(false);

  async function changePerson() {
    setIsLeaving(true);
    try {
      await fetch(appPath("/api/auth/logout/"), { method: "POST", cache: "no-store" });
    } finally {
      window.location.replace(appPath("/"));
    }
  }

  return (
    <button
      className={`web-account-control ${compact ? "is-compact" : ""}`.trim()}
      type="button"
      onClick={() => { void changePerson(); }}
      disabled={isLeaving}
      title={`Сменить сотрудника · ${personName}`}
      aria-label={`Сменить сотрудника. Сейчас ${personName}`}
    >
      {isLeaving ? <LoaderCircle className="spin" size={15} /> : <UserRound size={15} />}
      {!compact ? <span>Сменить</span> : null}
    </button>
  );
}
