import { z } from "zod";

export const postIdSchema = z.uuid("Posto inválido.");

export const postStatusSchema = z.enum(["OPERATING", "SUSPENDED", "INACTIVE"], {
  error: "Situação inválida.",
});

/** Registration data of a post. Provisional fields (OD-03). */
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
});

export const updatePostSchema = postDataSchema.extend({
  postId: postIdSchema,
});

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
