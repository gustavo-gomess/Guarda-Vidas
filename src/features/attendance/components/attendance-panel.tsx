"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import {
  captureLocation,
  indexedDbStorage,
  lastClockOffset,
  measureClock,
  requestPersistence,
  sendRegistration,
} from "@/features/attendance/client/device";
import {
  applyOutcome,
  newEntry,
  purgeSynced,
  syncQueue,
  toPayload,
  type QueuedRecord,
} from "@/features/attendance/client/queue";
import {
  KIND_LABELS,
  STATE_LABELS,
  type ServerStatus,
} from "@/features/attendance/states";
import { formatDateTime, formatIsoDate, operationalToday } from "@/lib/dates";

type PostView = { id: string; code: string; name: string };
type RecordView = {
  id: string;
  status: ServerStatus;
  origin: "ONLINE" | "OFFLINE";
  time: string;
  flags: string[];
} | null;

export type AttendancePanelProps = {
  userId: string;
  renderedAt: string;
  posts: PostView[];
  schedule: { date: string; post: PostView }[];
  journeys: {
    id: string;
    date: string;
    post: PostView;
    checkIn: RecordView;
    checkOut: RecordView;
  }[];
};

type Message = { tone: "ok" | "warn" | "error"; text: string } | null;

function subscribeConnectivity(onChange: () => void) {
  window.addEventListener("online", onChange);
  window.addEventListener("offline", onChange);
  return () => {
    window.removeEventListener("online", onChange);
    window.removeEventListener("offline", onChange);
  };
}

/** Rendered on the device only: the server cannot know its date or network. */
function subscribeClock(onChange: () => void) {
  const timer = window.setInterval(onChange, 60_000);
  return () => window.clearInterval(timer);
}

const toneClass = {
  ok: "border-green-600 text-green-800 dark:text-green-300",
  warn: "border-amber-600 text-amber-800 dark:text-amber-300",
  error: "border-red-600 text-red-800 dark:text-red-300",
};

function time(iso: string) {
  return formatDateTime(new Date(iso));
}

function queuedLabel(record: QueuedRecord) {
  if (record.state === "SYNCED" && record.server) {
    return STATE_LABELS[record.server.status];
  }
  if (record.state === "BLOCKED")
    return `Recusado pelo servidor: ${record.message}`;
  if (record.state === "LOCAL") return STATE_LABELS.LOCAL;
  return STATE_LABELS.SYNC_PENDING;
}

export function AttendancePanel(props: AttendancePanelProps) {
  const { userId, posts, schedule, journeys } = props;
  const router = useRouter();
  const [queue, setQueue] = useState<QueuedRecord[]>([]);
  const [storageOk, setStorageOk] = useState(true);
  const online = useSyncExternalStore(
    subscribeConnectivity,
    () => navigator.onLine,
    () => true,
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message>(null);
  const [chosenPost, setChosenPost] = useState(posts[0]?.id ?? "");
  const today = useSyncExternalStore(
    subscribeClock,
    () => operationalToday(new Date()),
    () => null,
  );
  // Same id on every retry of an exit, so a lost answer cannot duplicate it.
  const exitId = useRef<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setQueue(await indexedDbStorage.all());
      setStorageOk(true);
    } catch {
      setStorageOk(false);
    }
  }, []);

  const sync = useCallback(async () => {
    try {
      const summary = await syncQueue(
        indexedDbStorage,
        sendRegistration,
        userId,
      );
      await reload();
      if (summary.stored > 0) router.refresh();
      if (summary.needsLogin) {
        setMessage({
          tone: "warn",
          text: "Sua sessão expirou. Os registros continuam salvos neste aparelho; entre novamente para enviá-los.",
        });
      }
    } catch {
      setStorageOk(false);
    }
  }, [reload, router, userId]);

  useEffect(() => {
    void requestPersistence();
    void (async () => {
      try {
        await purgeSynced(indexedDbStorage, new Date());
      } catch {
        // Reported by reload below.
      }
      await reload();
      if (navigator.onLine) {
        await measureClock();
        await sync();
      }
    })();
    const goOnline = () => void measureClock().then(() => sync());
    window.addEventListener("online", goOnline);
    return () => window.removeEventListener("online", goOnline);
  }, [reload, sync]);

  if (!today) return <p className="text-zinc-500">Carregando…</p>;

  const mine = queue.filter((record) => record.userId === userId);
  const othersPending = queue.filter(
    (record) => record.userId !== userId && record.state !== "SYNCED",
  ).length;
  const unsent = mine.filter(
    (record) => record.state === "LOCAL" || record.state === "SYNC_PENDING",
  );
  const scheduledToday = schedule.find((entry) => entry.date === today) ?? null;
  const journeyToday =
    journeys.find((journey) => journey.date === today) ?? null;
  const localEntryToday = mine.find(
    (record) =>
      record.state !== "BLOCKED" &&
      operationalToday(new Date(record.deviceTime)) === today,
  );
  const renderedDay = operationalToday(new Date(props.renderedAt));
  const stale = !online || renderedDay !== today;
  const canCheckIn = !journeyToday?.checkIn && !localEntryToday;
  const canCheckOut = Boolean(journeyToday?.checkIn) && !journeyToday?.checkOut;
  const postId = scheduledToday?.post.id ?? chosenPost;

  async function checkIn() {
    if (!postId) {
      setMessage({ tone: "error", text: "Escolha o posto." });
      return;
    }
    setBusy(true);
    setMessage(null);
    // The moment of the tap, before waiting for the location.
    const deviceTime = new Date();
    const location = await captureLocation();
    const record = newEntry({
      id: crypto.randomUUID(),
      userId,
      postId,
      deviceTime,
      clockOffsetMs: lastClockOffset(),
      location,
    });

    let saved = true;
    try {
      await indexedDbStorage.put(record);
    } catch {
      saved = false;
    }

    const outcome = await sendRegistration(toPayload(record, "online"));
    const next = applyOutcome(record, outcome, new Date());

    if (outcome.kind === "stored") {
      if (saved) await indexedDbStorage.put(next).catch(() => undefined);
      setMessage({
        tone: outcome.status === "VALIDATED" ? "ok" : "warn",
        text: `Entrada recebida pelo servidor às ${time(outcome.effectiveTime)}. Situação: ${STATE_LABELS[outcome.status]}.`,
      });
      router.refresh();
    } else if (outcome.kind === "refused") {
      // The server answered: nothing to keep for later.
      if (saved)
        await indexedDbStorage.remove(record.id).catch(() => undefined);
      setMessage({ tone: "error", text: outcome.message });
    } else if (saved) {
      await indexedDbStorage.put(next).catch(() => undefined);
      setMessage({
        tone: "warn",
        text:
          outcome.kind === "unauthenticated"
            ? "Sua sessão expirou. A entrada ficou salva SÓ neste aparelho; entre novamente para enviá-la."
            : `Sem confirmação do servidor. A entrada das ${time(record.deviceTime)} (hora do aparelho) ficou salva SÓ neste aparelho e ainda não é presença oficial. Ela será enviada quando a conexão voltar e precisará de validação do coordenador.`,
      });
    } else {
      setMessage({
        tone: "error",
        text: "Não foi possível salvar neste aparelho nem enviar ao servidor. A entrada NÃO foi registrada.",
      });
    }
    await reload();
    setBusy(false);
  }

  async function checkOut() {
    if (!journeyToday) return;
    if (!navigator.onLine) {
      setMessage({
        tone: "error",
        text: "A saída só pode ser registrada com internet. Tente novamente quando tiver conexão.",
      });
      return;
    }
    setBusy(true);
    setMessage(null);
    exitId.current ??= crypto.randomUUID();
    const deviceTime = new Date();
    const location = await captureLocation();
    const outcome = await sendRegistration({
      id: exitId.current,
      userId,
      kind: "CHECK_OUT",
      mode: "online",
      deviceTime: deviceTime.toISOString(),
      clockOffsetMs: lastClockOffset(),
      postId: journeyToday.post.id,
      location,
    });
    if (outcome.kind === "stored") {
      exitId.current = null;
      setMessage({
        tone: outcome.status === "VALIDATED" ? "ok" : "warn",
        text: `Saída recebida pelo servidor às ${time(outcome.effectiveTime)}. Situação: ${STATE_LABELS[outcome.status]}.`,
      });
      router.refresh();
    } else if (outcome.kind === "refused") {
      exitId.current = null;
      setMessage({ tone: "error", text: outcome.message });
    } else {
      setMessage({
        tone: "error",
        text:
          outcome.kind === "unauthenticated"
            ? "Sua sessão expirou. A saída NÃO foi registrada; entre novamente."
            : "Sem confirmação do servidor: a saída NÃO foi registrada. Tente novamente.",
      });
    }
    setBusy(false);
  }

  return (
    <div className="flex flex-col gap-6">
      <p
        role="status"
        className={`rounded-md border px-3 py-2 text-sm ${online ? toneClass.ok : toneClass.warn}`}
      >
        {online
          ? "Com conexão."
          : "Sem conexão. Uma entrada registrada agora fica só neste aparelho até a internet voltar."}
        {stale
          ? ` Informações de escala carregadas em ${time(props.renderedAt)}; podem estar desatualizadas.`
          : ""}
      </p>
      {!storageOk ? (
        <p
          role="alert"
          className={`rounded-md border px-3 py-2 text-sm ${toneClass.error}`}
        >
          Este navegador não permite guardar registros no aparelho (modo anônimo
          ou armazenamento bloqueado). Sem internet, nada poderá ser registrado.
        </p>
      ) : null}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Hoje, {formatIsoDate(today)}</h2>
        {scheduledToday ? (
          <p>
            Escalado no posto{" "}
            <strong>
              {scheduledToday.post.code} · {scheduledToday.post.name}
            </strong>
            .
          </p>
        ) : canCheckIn ? (
          <label className="flex flex-col gap-1 text-sm">
            <span>
              Sem escala confirmada para hoje. A entrada irá para análise do
              coordenador. Posto:
            </span>
            <select
              value={chosenPost}
              onChange={(event) => setChosenPost(event.target.value)}
              className="rounded-md border border-zinc-300 px-2 py-2 dark:border-zinc-700 dark:bg-zinc-900"
            >
              {posts.map((post) => (
                <option key={post.id} value={post.id}>
                  {post.code} · {post.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="font-medium">Entrada</dt>
          <dd>
            {journeyToday?.checkIn
              ? `${time(journeyToday.checkIn.time)} · ${STATE_LABELS[journeyToday.checkIn.status]}`
              : localEntryToday
                ? `${time(localEntryToday.deviceTime)} (hora do aparelho) · ${queuedLabel(localEntryToday)}`
                : "Não registrada"}
          </dd>
          <dt className="font-medium">Saída</dt>
          <dd>
            {journeyToday?.checkOut
              ? `${time(journeyToday.checkOut.time)} · ${STATE_LABELS[journeyToday.checkOut.status]}`
              : "Não registrada"}
          </dd>
        </dl>

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={checkIn}
            disabled={busy || !canCheckIn || posts.length === 0}
            className="rounded-md bg-zinc-900 px-5 py-3 text-white disabled:opacity-40 dark:bg-zinc-100 dark:text-zinc-900"
          >
            {busy ? "Registrando…" : "Registrar entrada"}
          </button>
          <button
            type="button"
            onClick={checkOut}
            disabled={busy || !canCheckOut}
            className="rounded-md border border-zinc-400 px-5 py-3 disabled:opacity-40"
          >
            Registrar saída
          </button>
        </div>
        {localEntryToday && localEntryToday.state !== "SYNCED" ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            A saída fica disponível depois que a entrada for recebida pelo
            servidor. A saída exige internet.
          </p>
        ) : null}
        {posts.length === 0 ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Você não está vinculado a nenhum posto. Procure a coordenação.
          </p>
        ) : null}
        {message ? (
          <p
            role="alert"
            className={`rounded-md border px-3 py-2 text-sm ${toneClass[message.tone]}`}
          >
            {message.text}
          </p>
        ) : null}
      </section>

      {mine.length > 0 || othersPending > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-lg font-semibold">Neste aparelho</h2>
          <ul className="flex flex-col gap-1 text-sm">
            {mine.map((record) => (
              <li key={record.id}>
                {KIND_LABELS.CHECK_IN} de {time(record.deviceTime)} (hora do
                aparelho) · {queuedLabel(record)}
                {record.state === "SYNC_PENDING" && record.message
                  ? ` · ${record.message}`
                  : ""}
              </li>
            ))}
          </ul>
          {othersPending > 0 ? (
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Há {othersPending} registro(s) de outra conta neste aparelho. Eles
              serão enviados quando essa pessoa entrar.
            </p>
          ) : null}
          {unsent.length > 0 ? (
            <button
              type="button"
              onClick={() => void sync()}
              disabled={busy}
              className="self-start rounded border border-zinc-300 px-3 py-1 text-sm dark:border-zinc-700"
            >
              Enviar agora
            </button>
          ) : null}
        </section>
      ) : null}

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Minhas jornadas</h2>
        {journeys.length === 0 ? (
          <p className="text-zinc-600 dark:text-zinc-400">
            Nenhuma jornada recebida pelo servidor.
          </p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm">
            {journeys.map((journey) => (
              <li key={journey.id}>
                <Link
                  href={`/presenca/jornadas/${journey.id}`}
                  className="underline"
                >
                  {formatIsoDate(journey.date)} · {journey.post.code}
                </Link>{" "}
                · entrada:{" "}
                {journey.checkIn ? STATE_LABELS[journey.checkIn.status] : "—"} ·
                saída:{" "}
                {journey.checkOut ? STATE_LABELS[journey.checkOut.status] : "—"}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
