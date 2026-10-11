import type { Location } from "@/features/attendance/rules";
import type { RegistrationPayload } from "@/features/attendance/schemas";
import type { ServerStatus } from "@/features/attendance/states";

/**
 * Entries kept on the device until the server confirms them.
 *
 * Only entries go to the queue: exit without internet has no approved rule
 * (OD-10). A record leaves the queue only after the server answered that it
 * is stored. Network failures, expired sessions and another account on the
 * device never delete it.
 */

export type QueuedState =
  /** Saved on this device; never sent. */
  | "LOCAL"
  /** At least one attempt failed; waiting for internet or login. */
  | "SYNC_PENDING"
  /** The server confirmed it; kept briefly to show its server status. */
  | "SYNCED"
  /** The server refused it for good (e.g. id already used with other data). */
  | "BLOCKED";

export type QueuedRecord = {
  id: string;
  userId: string;
  postId: string;
  deviceTime: string;
  clockOffsetMs: number | null;
  location: Location;
  state: QueuedState;
  attempts: number;
  lastAttemptAt: string | null;
  message: string | null;
  server: { status: ServerStatus; effectiveTime: string } | null;
};

export interface QueueStorage {
  all(): Promise<QueuedRecord[]>;
  put(record: QueuedRecord): Promise<void>;
  remove(id: string): Promise<void>;
}

export type SendOutcome =
  | { kind: "stored"; status: ServerStatus; effectiveTime: string }
  | { kind: "network" }
  | { kind: "unauthenticated" }
  /** Fine, but not accepted now (another account signed in, server error). */
  | { kind: "retry-later"; message: string }
  /** Refused for good; the record is kept and shown. */
  | { kind: "refused"; message: string };

export type Sender = (payload: RegistrationPayload) => Promise<SendOutcome>;

export function newEntry(input: {
  id: string;
  userId: string;
  postId: string;
  deviceTime: Date;
  clockOffsetMs: number | null;
  location: Location;
}): QueuedRecord {
  return {
    id: input.id,
    userId: input.userId,
    postId: input.postId,
    deviceTime: input.deviceTime.toISOString(),
    clockOffsetMs: input.clockOffsetMs,
    location: input.location,
    state: "LOCAL",
    attempts: 0,
    lastAttemptAt: null,
    message: null,
    server: null,
  };
}

export function toPayload(
  record: QueuedRecord,
  mode: "online" | "offline",
): RegistrationPayload {
  return {
    id: record.id,
    userId: record.userId,
    kind: "CHECK_IN",
    mode,
    deviceTime: record.deviceTime,
    clockOffsetMs: record.clockOffsetMs,
    postId: record.postId,
    location: record.location,
  };
}

/** Applies a server answer to a record. Never loses an unconfirmed record. */
export function applyOutcome(
  record: QueuedRecord,
  outcome: SendOutcome,
  now: Date,
): QueuedRecord {
  const attempted = {
    ...record,
    attempts: record.attempts + 1,
    lastAttemptAt: now.toISOString(),
  };
  switch (outcome.kind) {
    case "stored":
      return {
        ...attempted,
        state: "SYNCED",
        message: null,
        server: {
          status: outcome.status,
          effectiveTime: outcome.effectiveTime,
        },
      };
    case "network":
      return {
        ...attempted,
        state: "SYNC_PENDING",
        message: "Sem conexão com o servidor.",
      };
    case "unauthenticated":
      return {
        ...attempted,
        state: "SYNC_PENDING",
        message: "Entre novamente para enviar.",
      };
    case "retry-later":
      return { ...attempted, state: "SYNC_PENDING", message: outcome.message };
    case "refused":
      return { ...attempted, state: "BLOCKED", message: outcome.message };
  }
}

export type SyncSummary = {
  sent: number;
  stored: number;
  pending: number;
  needsLogin: boolean;
};

/**
 * Sends the user's unconfirmed records, one at a time. Records captured
 * offline are always sent as "offline": the server then knows their time
 * is the device's. Sending again is safe: the server is idempotent by id.
 */
export async function syncQueue(
  storage: QueueStorage,
  send: Sender,
  userId: string,
  now: () => Date = () => new Date(),
): Promise<SyncSummary> {
  const summary: SyncSummary = {
    sent: 0,
    stored: 0,
    pending: 0,
    needsLogin: false,
  };
  const records = (await storage.all()).filter(
    (record) =>
      record.userId === userId &&
      (record.state === "LOCAL" || record.state === "SYNC_PENDING"),
  );
  for (const record of records) {
    const outcome = await send(toPayload(record, "offline"));
    summary.sent++;
    const next = applyOutcome(record, outcome, now());
    await storage.put(next);
    if (next.state === "SYNCED") summary.stored++;
    else summary.pending++;
    if (outcome.kind === "network") break; // no point trying the rest now
    if (outcome.kind === "unauthenticated") {
      summary.needsLogin = true;
      break;
    }
  }
  return summary;
}

/** Synced records are deleted from the device after a while (LGPD). */
export const KEEP_SYNCED_MS = 2 * 24 * 60 * 60 * 1000;

export async function purgeSynced(storage: QueueStorage, now: Date) {
  for (const record of await storage.all()) {
    if (
      record.state === "SYNCED" &&
      record.lastAttemptAt &&
      now.getTime() - Date.parse(record.lastAttemptAt) > KEEP_SYNCED_MS
    ) {
      await storage.remove(record.id);
    }
  }
}
