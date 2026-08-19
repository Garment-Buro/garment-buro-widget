"use client";

import { useEffect } from "react";
import { appPath } from "@/lib/base-path";

export function PwaRegistration() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    if (process.env.NODE_ENV !== "production") {
      void navigator.serviceWorker.getRegistrations().then((registrations) => (
        Promise.all(registrations.map((registration) => registration.unregister()))
      ));
      return;
    }

    void navigator.serviceWorker.register(appPath("/sw.js"), { updateViaCache: "none" });
  }, []);

  return null;
}
