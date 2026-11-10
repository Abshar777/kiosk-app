"use client";

import { useEffect } from "react";

/**
 * Registers the service worker.
 *
 * Skipped on localhost unless NEXT_PUBLIC_SW_DEV is set: a worker that caches
 * the previous build is a miserable way to spend a debugging session, and the
 * thing it protects — a kiosk on flaky venue wifi — does not exist in dev.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;

    const isLocal = ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname);
    if (isLocal && process.env.NEXT_PUBLIC_SW_DEV !== "true") return;

    let cancelled = false;

    const register = async () => {
      try {
        const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
        if (cancelled) return;

        // Activate a new build as soon as it is ready. A kiosk has no one to
        // click "reload", and the alternative is a tablet serving last month's
        // prices until someone notices.
        registration.addEventListener("updatefound", () => {
          const installing = registration.installing;
          if (!installing) return;
          installing.addEventListener("statechange", () => {
            if (installing.state === "installed" && navigator.serviceWorker.controller) {
              installing.postMessage("SKIP_WAITING");
            }
          });
        });

        // Check for a new build periodically, since the page itself may stay
        // open for days between students.
        const timer = window.setInterval(() => void registration.update(), 60 * 60 * 1000);
        return () => window.clearInterval(timer);
      } catch {
        // A failed registration costs offline resilience, nothing else — the
        // kiosk works perfectly without it, so this must never surface.
      }
    };

    void register();

    // Reload once when a new worker takes control, so the page matches it.
    let reloading = false;
    const onControllerChange = () => {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    };
    navigator.serviceWorker.addEventListener("controllerchange", onControllerChange);

    return () => {
      cancelled = true;
      navigator.serviceWorker.removeEventListener("controllerchange", onControllerChange);
    };
  }, []);

  return null;
}
