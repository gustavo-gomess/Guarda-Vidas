import {
  FLAG_LABELS,
  estimatedTime,
  isDivergence,
} from "@/features/attendance/rules";
import {
  LOCATION_LABELS,
  ORIGIN_LABELS,
  type LocationStatus,
} from "@/features/attendance/states";
import { formatDateTime } from "@/lib/dates";

type RecordDetailsProps = {
  origin: "ONLINE" | "OFFLINE";
  deviceTime: Date;
  receivedAt: Date;
  clockOffsetMs: number | null;
  locationStatus: LocationStatus;
  accuracyMeters: number | null;
  distanceMeters: number | null;
  latitude?: number | null;
  longitude?: number | null;
  flags: string[];
};

/** The evidence of a record, as it arrived. Nothing here is proof. */
export function RecordDetails(record: RecordDetailsProps) {
  const estimate =
    record.origin === "OFFLINE"
      ? estimatedTime(record.deviceTime, record.clockOffsetMs)
      : null;
  const divergences = record.flags.filter(isDivergence);
  const notices = record.flags.filter((flag) => !isDivergence(flag));
  const label = (flag: string) =>
    FLAG_LABELS[flag as keyof typeof FLAG_LABELS] ?? flag;

  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
      <dt className="font-medium">Origem</dt>
      <dd>{ORIGIN_LABELS[record.origin]}</dd>
      <dt className="font-medium">Hora do aparelho</dt>
      <dd>
        {formatDateTime(record.deviceTime)}
        {estimate
          ? ` (corrigida pelo último ajuste de relógio: ${formatDateTime(estimate)})`
          : ""}
      </dd>
      <dt className="font-medium">Recebido pelo servidor</dt>
      <dd>{formatDateTime(record.receivedAt)}</dd>
      <dt className="font-medium">Localização</dt>
      <dd>
        {LOCATION_LABELS[record.locationStatus]}
        {record.accuracyMeters !== null
          ? ` · precisão de ${Math.round(record.accuracyMeters)} m`
          : ""}
        {record.distanceMeters !== null
          ? ` · ${record.distanceMeters} m do posto`
          : ""}
        {typeof record.latitude === "number" &&
        typeof record.longitude === "number"
          ? ` · ${record.latitude.toFixed(5)}, ${record.longitude.toFixed(5)}`
          : ""}
      </dd>
      {divergences.length > 0 ? (
        <>
          <dt className="font-medium text-amber-700 dark:text-amber-400">
            Divergências
          </dt>
          <dd className="text-amber-700 dark:text-amber-400">
            {divergences.map(label).join("; ")}
          </dd>
        </>
      ) : null}
      {notices.length > 0 ? (
        <>
          <dt className="font-medium">Observações</dt>
          <dd>{notices.map(label).join("; ")}</dd>
        </>
      ) : null}
    </dl>
  );
}
