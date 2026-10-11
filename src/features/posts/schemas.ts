import { z } from "zod";

export const postIdSchema = z.uuid("Posto inválido.");

export const postStatusSchema = z.enum(["OPERATING", "SUSPENDED", "INACTIVE"], {
  error: "Situação inválida.",
});

/** Empty form field -> null; otherwise a number. */
function optionalNumber(min: number, max: number, message: string) {
  return z.preprocess(
    (value) =>
      value === null || value === undefined || String(value).trim() === ""
        ? null
        : Number(String(value).replace(",", ".")),
    z.number(message).min(min, message).max(max, message).nullable(),
  );
}

/**
 * Registration data of a post. Provisional fields (OD-03). Coordinates and
 * radius are optional; the radius must be an approved value (OD-29).
 */
export const postDataSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(
      /^[A-Z0-9][A-Z0-9-]{0,19}$/,
      "Use de 1 a 20 letras sem acento, números ou hífen (ex.: P-01).",
    ),
  name: z.string().trim().min(2, "Informe o nome do posto.").max(80),
  location: z.string().trim().max(200, "Use no máximo 200 caracteres."),
  notes: z.string().trim().max(1000, "Use no máximo 1000 caracteres."),
  latitude: optionalNumber(-90, 90, "Latitude entre -90 e 90."),
  longitude: optionalNumber(-180, 180, "Longitude entre -180 e 180."),
  proximityRadiusMeters: optionalNumber(
    10,
    5000,
    "Raio entre 10 e 5000 metros.",
  ).pipe(z.number().int("Raio em metros inteiros.").nullable()),
});

function coordinatesConsistent(
  data: z.infer<typeof postDataSchema>,
  ctx: z.RefinementCtx,
) {
  if ((data.latitude === null) !== (data.longitude === null)) {
    ctx.addIssue({
      code: "custom",
      path: ["longitude"],
      message: "Informe latitude e longitude juntas.",
    });
  }
  if (data.proximityRadiusMeters !== null && data.latitude === null) {
    ctx.addIssue({
      code: "custom",
      path: ["proximityRadiusMeters"],
      message: "O raio precisa das coordenadas do posto.",
    });
  }
}

export const createPostSchema = postDataSchema.superRefine(
  coordinatesConsistent,
);

export const updatePostSchema = postDataSchema
  .extend({ postId: postIdSchema })
  .superRefine(coordinatesConsistent);

export const setPostStatusSchema = z.object({
  postId: postIdSchema,
  status: postStatusSchema,
});

/** Post + user pair used by coordinator and team operations. */
export const postMemberSchema = z.object({
  postId: postIdSchema,
  userId: z.uuid("Usuário inválido."),
});

export const setCaptainSchema = postMemberSchema.extend({
  isCaptain: z.enum(["true", "false"]).transform((value) => value === "true"),
});
