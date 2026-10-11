import { describe, expect, it, vi } from "vitest";

import {
  applyOutcome,
  KEEP_SYNCED_MS,
  newEntry,
  purgeSynced,
  syncQueue,
  toPayload,
  type QueuedRecord,
  type QueueStorage,
  type Sender,
} from "@/features/attendance/client/queue";

class MemoryStorage implements QueueStorage {
  records = new Map<string, QueuedRecord>();
  async all() {
    return [...this.records.values()];
  }
  async put(record: QueuedRecord) {
    this.records.set(record.id, record);
  }
  async remove(id: string) {
    this.records.delete(id);
  }
}

const NOW = new Date("2026-10-12T13:00:00Z");
const ANA = "user-ana";
const BIA = "user-bia";

function entry(id: string, userId = ANA): QueuedRecord {
  return newEntry({
    id,
    userId,
    postId: "post-a",
    deviceTime: new Date("2026-10-12T10:00:00Z"),
    clockOffsetMs: 1200,
    location: { status: "TIMEOUT" },
  });
}

const stored: Awaited<ReturnType<Sender>> = {
  kind: "stored",
  status: "AWAITING_VALIDATION",
  effectiveTime: "2026-10-12T10:00:00.000Z",
};

async function storageWith(...records: QueuedRecord[]) {
  const storage = new MemoryStorage();
  for (const record of records) await storage.put(record);
  return storage;
}

describe("a new entry", () => {
  it("starts as saved only on the device", () => {
    expect(entry("r1")).toMatchObject({
      state: "LOCAL",
      attempts: 0,
      server: null,
    });
  });

  it("is sent from the queue as offline, with its original data and id", () => {
    expect(toPayload(entry("r1"), "offline")).toEqual({
      id: "r1",
      userId: ANA,
      kind: "CHECK_IN",
      mode: "offline",
      deviceTime: "2026-10-12T10:00:00.000Z",
      clockOffsetMs: 1200,
      postId: "post-a",
      location: { status: "TIMEOUT" },
    });
  });
});

describe("synchronization", () => {
  it("marks records confirmed only after the server stored them", async () => {
    const storage = await storageWith(entry("r1"));
    const send = vi.fn<Sender>().mockResolvedValue(stored);
    const summary = await syncQueue(storage, send, ANA, () => NOW);
    expect(summary).toEqual({
      sent: 1,
      stored: 1,
      pending: 0,
      needsLogin: false,
    });
    expect(storage.records.get("r1")).toMatchObject({
      state: "SYNCED",
      attempts: 1,
      server: { status: "AWAITING_VALIDATION" },
    });
  });

  it("keeps everything on a network failure and stops trying", async () => {
    const storage = await storageWith(entry("r1"), entry("r2"));
    const send = vi.fn<Sender>().mockResolvedValue({ kind: "network" });
    const summary = await syncQueue(storage, send, ANA, () => NOW);
    expect(send).toHaveBeenCalledTimes(1);
    expect(summary.pending).toBe(1);
    expect(storage.records.get("r1")?.state).toBe("SYNC_PENDING");
    expect(storage.records.get("r2")?.state).toBe("LOCAL");
  });

  it("sends the same id again after a failure (the server deduplicates)", async () => {
    const storage = await storageWith(entry("r1"));
    const send = vi
      .fn<Sender>()
      .mockResolvedValueOnce({ kind: "network" })
      .mockResolvedValueOnce(stored);
    await syncQueue(storage, send, ANA, () => NOW);
    await syncQueue(storage, send, ANA, () => NOW);
    expect(send.mock.calls.map(([payload]) => payload.id)).toEqual([
      "r1",
      "r1",
    ]);
    expect(storage.records.get("r1")).toMatchObject({
      state: "SYNCED",
      attempts: 2,
    });
  });

  it("does not resend confirmed records", async () => {
    const storage = await storageWith(applyOutcome(entry("r1"), stored, NOW));
    const send = vi.fn<Sender>();
    await syncQueue(storage, send, ANA, () => NOW);
    expect(send).not.toHaveBeenCalled();
  });

  it("keeps records when the session expired and asks for login", async () => {
    const storage = await storageWith(entry("r1"));
    const summary = await syncQueue(
      storage,
      async () => ({ kind: "unauthenticated" }),
      ANA,
      () => NOW,
    );
    expect(summary.needsLogin).toBe(true);
    expect(storage.records.get("r1")?.state).toBe("SYNC_PENDING");
  });

  it("sends only the signed-in user's records", async () => {
    const storage = await storageWith(entry("r1", ANA), entry("r2", BIA));
    const send = vi.fn<Sender>().mockResolvedValue(stored);
    await syncQueue(storage, send, ANA, () => NOW);
    expect(send).toHaveBeenCalledTimes(1);
    expect(storage.records.get("r2")?.state).toBe("LOCAL");
  });

  it("keeps a record the server cannot accept now", async () => {
    const storage = await storageWith(entry("r1"));
    await syncQueue(
      storage,
      async () => ({ kind: "retry-later", message: "Outra conta" }),
      ANA,
      () => NOW,
    );
    expect(storage.records.get("r1")).toMatchObject({
      state: "SYNC_PENDING",
      message: "Outra conta",
    });
  });

  it("keeps a refused record visible instead of deleting it", async () => {
    const storage = await storageWith(entry("r1"));
    await syncQueue(
      storage,
      async () => ({ kind: "refused", message: "Dados diferentes" }),
      ANA,
      () => NOW,
    );
    expect(storage.records.get("r1")).toMatchObject({
      state: "BLOCKED",
      message: "Dados diferentes",
    });
  });
});

describe("cleaning the device", () => {
  it("removes only confirmed records, after a while", async () => {
    const old = applyOutcome(
      entry("old"),
      stored,
      new Date(NOW.getTime() - KEEP_SYNCED_MS - 1),
    );
    const recent = applyOutcome(entry("recent"), stored, NOW);
    const pending = applyOutcome(
      entry("pending"),
      { kind: "network" },
      new Date(0),
    );
    const blocked = applyOutcome(
      entry("blocked"),
      { kind: "refused", message: "x" },
      new Date(0),
    );
    const storage = await storageWith(old, recent, pending, blocked);
    await purgeSynced(storage, NOW);
    expect([...storage.records.keys()].sort()).toEqual([
      "blocked",
      "pending",
      "recent",
    ]);
  });
});
