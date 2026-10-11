import { z } from "zod";

/**
 * Registration sent by the device (online at once, or later from the
 * offline queue). Everything here is a claim: the server decides the
 * origin, the official time, the post and the status.
 */
export const registrationSchema = z
  .object({
    id: z.uuid("Identificador inválido."),
    userId: z.uuid(),
    kind: z.enum(["CHECK_IN", "CHECK_OUT"]),
    mode: z.enum(["online", "offline"]),
    deviceTime: z.iso
      .datetime({ offset: true })
      .transform((value) => new Date(value)),
    clockOffsetMs: z.number().int().min(-1e11).max(1e11).nullable(),
    postId: z.uuid("Posto inválido."),
    location: z.object({
      status: z.enum([
        "CAPTURED",
        "DENIED",
        "UNAVAILABLE",
        "TIMEOUT",
        "UNSUPPORTED",
      ]),
      latitude: z.number().min(-90).max(90).nullable().optional(),
      longitude: z.number().min(-180).max(180).nullable().optional(),
      accuracyMeters: z.number().min(0).max(1e7).nullable().optional(),
    }),
  })
  .refine(
    (value) =>
      value.location.status !== "CAPTURED" ||
      (typeof value.location.latitude === "number" &&
        typeof value.location.longitude === "number"),
    { message: "Localização incompleta.", path: ["location"] },
  );

export type RegistrationPayload = z.input<typeof registrationSchema>;

export const decisionSchema = z.object({
  recordId: z.uuid("Registro inválido."),
  decision: z.enum(["VALIDATED", "REJECTED", "UNDER_REVIEW"], {
    error: "Decisão inválida.",
  }),
  reason: z.string().trim().max(500, "Use no máximo 500 caracteres."),
});
