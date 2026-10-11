import type {
  AttendanceKind,
  AttendanceOrigin,
  LocationStatus,
  ServerStatus,
} from "@/features/attendance/states";
import { operationalToday } from "@/lib/dates";

/**
 * Presence rules, free of Next.js and the database.
 *
 * Approved: one shift per day with entry and exit; entry without internet
 * is provisional and needs coordinator validation; device time and GPS are
 * never proof; nothing is discarded automatically.
 * Provisional (docs/OPEN-DECISIONS.md, OD-28 to OD-31): tolerances below,
 * automatic acceptance of online records without divergence, and the
 * divergence list. Exit without internet is NOT implemented (OD-10).
 */

/** Device clock farther than this from the server is reported. */
export const CLOCK_TOLERANCE_MS = 5 * 60 * 1000;
/** Offline records synchronized after this long are reported (notice). */
export const LATE_SYNC_MS = 12 * 60 * 60 * 1000;
export const MIN_DECISION_REASON = 5;

/** Divergences send a record to review; notices are only information. */
export const DIVERGENCES = {
  NOT_SCHEDULED: "Sem escala confirmada para este dia",
  NOT_IN_TEAM: "Não faz parte da equipe do posto",
  POST_NOT_OPERATING: "Posto fora de operação",
  OUT_OF_RANGE: "Fora do raio do posto",
  CLOCK_AHEAD: "Hora do aparelho no futuro",
  CLOCK_SKEW: "Relógio do aparelho diferente do servidor",
  DUPLICATE: "Entrada repetida no mesmo dia",
  ENTRY_REJECTED: "Saída de uma entrada rejeitada",
  EXIT_BEFORE_ENTRY: "Saída antes da hora da entrada",
} as const;

export const NOTICES = {
  LOCATION_UNAVAILABLE: "Sem localização",
  LOW_ACCURACY: "Localização imprecisa para avaliar o raio",
  PROXIMITY_NOT_CONFIGURED: "Posto sem coordenadas ou raio aprovado",
  DEVICE_CLOCK_DIFFERS:
    "Relógio do aparelho diferente (vale a hora do servidor)",
  CLOCK_NOT_MEASURED: "Relógio do aparelho não foi conferido com o servidor",
  LATE_SYNC: "Sincronizado muito depois do registro",
  POST_DIFFERS: "Posto escolhido difere da escala (vale a escala)",
} as const;

export type Divergence = keyof typeof DIVERGENCES;
export type Notice = keyof typeof NOTICES;
export type Flag = Divergence | Notice;

export const FLAG_LABELS: Record<Flag, string> = { ...DIVERGENCES, ...NOTICES };

export function isDivergence(flag: string): flag is Divergence {
  return flag in DIVERGENCES;
}

// --- Time ------------------------------------------------------------------

export type Timing = {
  origin: AttendanceOrigin;
  /** Official time for online records; declared (unproven) time offline. */
  effectiveTime: Date;
  /** Operational day the record belongs to. */
  date: string;
  flags: Flag[];
};

/**
 * Online records use the server clock. Offline records can only use the
 * device clock, so it is checked against what the server knows.
 */
export function classifyTiming(input: {
  mode: "online" | "offline";
  deviceTime: Date;
  clockOffsetMs: number | null;
  now: Date;
}): Timing {
  const { deviceTime, now, clockOffsetMs } = input;
  const flags: Flag[] = [];
  const drift = deviceTime.getTime() - now.getTime();

  if (input.mode === "online") {
    if (Math.abs(drift) > CLOCK_TOLERANCE_MS)
      flags.push("DEVICE_CLOCK_DIFFERS");
    return {
      origin: "ONLINE",
      effectiveTime: now,
      date: operationalToday(now),
      flags,
    };
  }

  if (drift > CLOCK_TOLERANCE_MS) flags.push("CLOCK_AHEAD");
  if (clockOffsetMs === null) flags.push("CLOCK_NOT_MEASURED");
  else if (Math.abs(clockOffsetMs) > CLOCK_TOLERANCE_MS)
    flags.push("CLOCK_SKEW");
  if (-drift > LATE_SYNC_MS) flags.push("LATE_SYNC");

  // A device time in the future cannot be the day of the record.
  const dayTime = drift > 0 ? now : deviceTime;
  return {
    origin: "OFFLINE",
    effectiveTime: deviceTime,
    date: operationalToday(dayTime),
    flags,
  };
}

/** Device time corrected by the last measured offset, for the reviewer. */
export function estimatedTime(
  deviceTime: Date,
  clockOffsetMs: number | null,
): Date | null {
  return clockOffsetMs === null
    ? null
    : new Date(deviceTime.getTime() + clockOffsetMs);
}

// --- Location ----------------------------------------------------------------

export type Location = {
  status: LocationStatus;
  latitude?: number | null;
  longitude?: number | null;
  accuracyMeters?: number | null;
};

export type PostPlace = {
  latitude: number | null;
  longitude: number | null;
  proximityRadiusMeters: number | null;
};

const EARTH_RADIUS_M = 6_371_000;

/** Great-circle distance in meters. */
export function distanceMeters(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const rad = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude);
  const dLon = rad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.latitude)) *
      Math.cos(rad(b.latitude)) *
      Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/**
 * Proximity is evaluated only when the post has coordinates and a radius.
 * Out of range means: even the most favorable point of the accuracy circle
 * is outside the radius. A missing or imprecise location is a notice, never
 * a reason to refuse the record.
 */
export function evaluateProximity(
  post: PostPlace,
  location: Location,
): { distanceMeters: number | null; flags: Flag[] } {
  const hasPoint =
    location.status === "CAPTURED" &&
    typeof location.latitude === "number" &&
    typeof location.longitude === "number";
  if (!hasPoint)
    return { distanceMeters: null, flags: ["LOCATION_UNAVAILABLE"] };

  if (
    post.latitude === null ||
    post.longitude === null ||
    post.proximityRadiusMeters === null
  ) {
    return { distanceMeters: null, flags: ["PROXIMITY_NOT_CONFIGURED"] };
  }

  const distance = distanceMeters(
    { latitude: post.latitude, longitude: post.longitude },
    { latitude: location.latitude!, longitude: location.longitude! },
  );
  const accuracy = location.accuracyMeters ?? 0;
  const radius = post.proximityRadiusMeters;
  const flags: Flag[] = [];
  if (distance - accuracy > radius) flags.push("OUT_OF_RANGE");
  else if (accuracy > radius) flags.push("LOW_ACCURACY");
  return { distanceMeters: Math.round(distance), flags };
}

// --- Registration --------------------------------------------------------------

export type RegistrationInput = {
  id: string;
  /** User the record was captured for on the device. */
  userId: string;
  kind: AttendanceKind;
  mode: "online" | "offline";
  deviceTime: Date;
  clockOffsetMs: number | null;
  postId: string;
  location: Location;
};

export type PostInfo = PostPlace & { id: string; status: string };

export type RegistrationContext = {
  actor: { id: string; role: string; assignedPostIds: readonly string[] };
  now: Date;
  payloadHash: string;
  /** A record already stored with the same id. */
  existing: { userId: string; payloadHash: string } | null;
  timing: Timing;
  /** The user's published schedule entry for timing.date. */
  scheduledPostId: string | null;
  /** Post the record will be attached to (see `postFor`). */
  post: PostInfo | null;
  /** The user's journey for timing.date, with its primary records. */
  journey: {
    id: string;
    postId: string;
    checkIn: { status: ServerStatus; effectiveTime: Date } | null;
    checkOut: { effectiveTime: Date } | null;
  } | null;
};

export type RegistrationError = {
  type: "error";
  httpStatus: 400 | 403 | 409 | 422;
  code: string;
  message: string;
};

export type RegistrationPlan =
  | RegistrationError
  | { type: "already-stored" }
  | {
      type: "create";
      /** Null: create the journey with this post. */
      journeyId: string | null;
      postId: string;
      primary: boolean;
      origin: AttendanceOrigin;
      distanceMeters: number | null;
      flags: Flag[];
      status: ServerStatus;
    };

function error(
  httpStatus: RegistrationError["httpStatus"],
  code: string,
  message: string,
): RegistrationError {
  return { type: "error", httpStatus, code, message };
}

/** Which post a record belongs to: the journey's, the schedule's, or the chosen one. */
export function postFor(
  input: Pick<RegistrationInput, "kind" | "postId">,
  scheduledPostId: string | null,
  journeyPostId: string | null,
): string {
  if (input.kind === "CHECK_OUT" && journeyPostId) return journeyPostId;
  return scheduledPostId ?? input.postId;
}

const timeFormat = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  timeStyle: "short",
});

/**
 * Decides what to do with a registration, given what the server knows.
 * Errors are returned only when storing the record would be wrong (another
 * user, a forged id, an exit without internet). Offline entries are always
 * stored, at worst flagged for review.
 */
export function planRegistration(
  input: RegistrationInput,
  ctx: RegistrationContext,
): RegistrationPlan {
  if (ctx.actor.role !== "LIFEGUARD") {
    return error(403, "FORBIDDEN", "Somente guarda-vidas registram presença.");
  }
  if (input.userId !== ctx.actor.id) {
    return error(
      409,
      "WRONG_USER",
      "Este registro foi feito por outra conta neste aparelho. Entre com ela para enviá-lo.",
    );
  }
  if (ctx.existing) {
    if (ctx.existing.userId !== ctx.actor.id) {
      return error(409, "ID_CONFLICT", "Identificador de registro inválido.");
    }
    if (ctx.existing.payloadHash !== ctx.payloadHash) {
      return error(
        409,
        "PAYLOAD_CONFLICT",
        "Já existe um registro com este identificador e dados diferentes. O original foi mantido.",
      );
    }
    return { type: "already-stored" };
  }

  const { timing, journey } = ctx;
  const flags: Flag[] = [...timing.flags];

  if (input.kind === "CHECK_OUT") {
    // Exit without internet has no approved rule (OD-10).
    if (timing.origin === "OFFLINE") {
      return error(
        422,
        "OFFLINE_EXIT_NOT_ALLOWED",
        "A saída só pode ser registrada com internet.",
      );
    }
    if (!journey?.checkIn) {
      return error(409, "NO_CHECK_IN", "Não há entrada registrada hoje.");
    }
    if (journey.checkOut) {
      return error(
        409,
        "ALREADY_CHECKED_OUT",
        `Saída já registrada hoje às ${timeFormat.format(journey.checkOut.effectiveTime)}.`,
      );
    }
    if (journey.checkIn.status === "REJECTED") flags.push("ENTRY_REJECTED");
    if (journey.checkIn.effectiveTime > timing.effectiveTime) {
      flags.push("EXIT_BEFORE_ENTRY");
    }
  } else if (journey?.checkIn) {
    if (timing.origin === "ONLINE") {
      return error(
        409,
        "ALREADY_CHECKED_IN",
        `Entrada já registrada hoje às ${timeFormat.format(journey.checkIn.effectiveTime)}.`,
      );
    }
    // Synchronized later: keep it, but never as a second journey.
    flags.push("DUPLICATE");
  }

  if (!ctx.post) return error(422, "UNKNOWN_POST", "Posto não encontrado.");

  if (input.kind === "CHECK_IN" && !journey?.checkIn) {
    if (ctx.scheduledPostId === null) flags.push("NOT_SCHEDULED");
    else if (input.postId !== ctx.scheduledPostId) flags.push("POST_DIFFERS");
  }
  if (!ctx.actor.assignedPostIds.includes(ctx.post.id))
    flags.push("NOT_IN_TEAM");
  if (ctx.post.status !== "OPERATING") flags.push("POST_NOT_OPERATING");

  const proximity = evaluateProximity(ctx.post, input.location);
  flags.push(...proximity.flags);

  const unique = [...new Set(flags)];
  const status: ServerStatus = unique.some(isDivergence)
    ? "UNDER_REVIEW"
    : timing.origin === "OFFLINE"
      ? "AWAITING_VALIDATION"
      : "VALIDATED";

  const primary = !unique.includes("DUPLICATE");
  return {
    type: "create",
    journeyId: journey?.id ?? null,
    postId: ctx.post.id,
    primary,
    origin: timing.origin,
    distanceMeters: proximity.distanceMeters,
    flags: unique,
    status,
  };
}

// --- Decisions -----------------------------------------------------------------

export type DecisionStatus = Exclude<ServerStatus, "AWAITING_VALIDATION">;

/**
 * Coordinator decisions. A justification is required to reject, to send to
 * review, and to revise a final decision. Nothing is deleted: every
 * decision is kept.
 */
export function checkDecision(
  current: ServerStatus,
  next: DecisionStatus,
  reason: string,
): string | null {
  if (current === next) return "O registro já está nesse estado.";
  const needsReason =
    next !== "VALIDATED" || current === "VALIDATED" || current === "REJECTED";
  if (needsReason && reason.trim().length < MIN_DECISION_REASON) {
    return `Informe uma justificativa (mínimo de ${MIN_DECISION_REASON} caracteres).`;
  }
  return null;
}
