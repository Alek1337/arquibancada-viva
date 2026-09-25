"use client";

import { useEffect } from "react";

export function ServiceWorkerRegistration() {
  useEffect(() => {
    const serviceWorker = (navigator as Navigator & { serviceWorker?: ServiceWorkerContainer })
      .serviceWorker;
    if (serviceWorker) {
      void serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
    }
  }, []);

  return null;
}
