import type { Location } from "@/features/attendance/rules";
import type { RegistrationPayload } from "@/features/attendance/schemas";
import type {
  QueuedRecord,
  QueueStorage,
  SendOutcome,
} from "@/features/attendance/client/queue";
import type { ServerStatus } from "@/features/attendance/states";

/**
 * Browser-only helpers: IndexedDB storage, location, clock and the HTTP
 * call. No library: IndexedDB and the Geolocation API are enough here.
 */

const DB_NAME = "guarda-vidas";
const STORE = "attendance-queue";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(STORE, mode);
      const request = action(transaction.objectStore(STORE));
      // Resolve only when the write is durable (transaction complete).
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  } finally {
    db.close();
  }
}

export const indexedDbStorage: QueueStorage = {
  all: () =>
    run("readonly", (store) => store.getAll() as IDBRequest<QueuedRecord[]>),
  put: async (record) => {
    await run("readwrite", (store) => store.put(record));
  },
  remove: async (id) => {
    await run("readwrite", (store) => store.delete(id));
  },
};

/** Asks the browser for persistent storage, so the queue is not evicted. */
export async function requestPersistence(): Promise<boolean> {
  try {
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

/** Current position, or the reason it is missing. Never throws. */
export function captureLocation(timeoutMs = 10_000): Promise<Location> {
  if (!("geolocation" in navigator)) {
    return Promise.resolve({ status: "UNSUPPORTED" });
  }
  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          status: "CAPTURED",
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracyMeters: Math.round(position.coords.accuracy),
        }),
      (error) =>
        resolve({
          status:
            error.code === error.PERMISSION_DENIED
              ? "DENIED"
              : error.code === error.TIMEOUT
                ? "TIMEOUT"
                : "UNAVAILABLE",
        }),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30_000 },
    );
  });
}

const CLOCK_KEY = "gv-clock-offset";

/** Last measured (server - device) offset, or null if never measured. */
export function lastClockOffset(): number | null {
  try {
    const raw = localStorage.getItem(CLOCK_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as { offsetMs: number };
    return typeof value.offsetMs === "number" ? value.offsetMs : null;
  } catch {
    return null;
  }
}

/** Measures the device clock against the server. Null when offline. */
export async function measureClock(): Promise<number | null> {
  try {
    const before = Date.now();
    const response = await fetch("/api/presenca/hora", { cache: "no-store" });
    const after = Date.now();
    if (!response.ok) return null;
    const { serverTime } = (await response.json()) as { serverTime: string };
    const offsetMs = Math.round(Date.parse(serverTime) - (before + after) / 2);
    try {
      localStorage.setItem(
        CLOCK_KEY,
        JSON.stringify({ offsetMs, measuredAt: new Date().toISOString() }),
      );
    } catch {
      // Storage unavailable: the offset is simply not remembered.
    }
    return offsetMs;
  } catch {
    return null;
  }
}

type ServerRecord = { id: string; status: ServerStatus; effectiveTime: string };

/**
 * Sends one registration. Any failure to get an answer is "network": the
 * caller keeps the record. Only an explicit server answer changes that.
 */
export async function sendRegistration(
  payload: RegistrationPayload,
): Promise<SendOutcome> {
  let response: Response;
  try {
    response = await fetch("/api/presenca/registros", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      cache: "no-store",
    });
  } catch {
    return { kind: "network" };
  }
  let body: { code?: string; message?: string; record?: ServerRecord } = {};
  try {
    body = await response.json();
  } catch {
    // A proxy or captive portal answered with something else.
    return { kind: "network" };
  }
  if (response.ok && body.record) {
    return {
      kind: "stored",
      status: body.record.status,
      effectiveTime: body.record.effectiveTime,
    };
  }
  if (response.status === 401) return { kind: "unauthenticated" };
  const message = body.message ?? "O servidor recusou o registro.";
  // Another account on this device, temporary password, server error:
  // the record is fine, it just cannot be accepted right now.
  if (
    body.code === "WRONG_USER" ||
    response.status === 403 ||
    response.status >= 500
  ) {
    return { kind: "retry-later", message };
  }
  return { kind: "refused", message };
}
