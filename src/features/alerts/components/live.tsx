"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/** Polling interval for alert screens and the menu badge (OD-38). */
const POLL_MS = 30_000;

/** Re-reads the page from the server periodically (alert lists). */
export function AutoRefresh() {
  const router = useRouter();
  useEffect(() => {
    const timer = window.setInterval(() => router.refresh(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [router]);
  return null;
}

/**
 * Menu link with the number of alerts waiting for acknowledgement in the
 * coordinator's area. A reminder only: when it cannot reach the server it
 * says so instead of showing zero.
 */
export function AlertsLink() {
  const [open, setOpen] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    async function poll() {
      try {
        const response = await fetch("/api/alertas/pendentes", {
          cache: "no-store",
        });
        if (!response.ok) throw new Error(String(response.status));
        const body = (await response.json()) as { open: number };
        if (active) {
          setOpen(body.open);
          setFailed(false);
        }
      } catch {
        if (active) setFailed(true);
      }
    }
    void poll();
    const timer = window.setInterval(() => void poll(), POLL_MS);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, []);

  return (
    <Link href="/alertas" className="underline">
      Alertas
      {open ? (
        <span className="ml-1 rounded-full bg-red-700 px-2 py-0.5 text-xs font-semibold text-white no-underline">
          {open} sem reconhecimento
        </span>
      ) : null}
      {failed ? (
        <span className="ml-1 text-xs text-amber-700">
          (sem conexão: contagem indisponível)
        </span>
      ) : null}
    </Link>
  );
}
