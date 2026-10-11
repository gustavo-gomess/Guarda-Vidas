"use client";

import { useEffect } from "react";

/**
 * Registers the service worker and asks it to keep this page and the files
 * it loaded, so the presence page opens without internet next time.
 */
export function OfflineSupport({ path }: { path: string }) {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    void (async () => {
      try {
        await navigator.serviceWorker.register("/sw.js", { scope: "/" });
        const registration = await navigator.serviceWorker.ready;
        const worker = registration.active;
        if (!worker) return;
        const urls = performance
          .getEntriesByType("resource")
          .map((entry) => entry.name)
          .filter((name) =>
            new URL(name).pathname.startsWith("/_next/static/"),
          );
        worker.postMessage({ type: "CACHE_STATIC", urls });
        worker.postMessage({ type: "CACHE_PAGE", path });
      } catch {
        // Without a service worker the page still works online.
      }
    })();
  }, [path]);
  return null;
}

/**
 * On the login page: forget cached pages of the previous user (they contain
 * names and schedules). Records waiting on the device are NOT deleted.
 */
export function ForgetOfflinePages() {
  useEffect(() => {
    void navigator.serviceWorker?.ready
      .then((registration) =>
        registration.active?.postMessage({ type: "FORGET_PAGES" }),
      )
      .catch(() => undefined);
  }, []);
  return null;
}
