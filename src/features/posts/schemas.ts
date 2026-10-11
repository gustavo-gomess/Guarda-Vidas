import { z } from "zod";

export const postIdSchema = z.uuid("Posto inválido.");

export const createPostSchema = z.object({
  name: z.string().trim().min(2, "Informe o nome do posto.").max(80),
});

export const setPostActiveSchema = z.object({
  postId: postIdSchema,
  active: z.enum(["true", "false"]).transform((value) => value === "true"),
});

/** Post + user pair used by coordinator and team operations. */
export const postMemberSchema = z.object({
  postId: postIdSchema,
  userId: z.uuid("Usuário inválido."),
});

export const setCaptainSchema = postMemberSchema.extend({
  isCaptain: z.enum(["true", "false"]).transform((value) => value === "true"),
});
