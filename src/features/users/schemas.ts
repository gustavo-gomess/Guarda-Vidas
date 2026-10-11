import { z } from "zod";

export const roleSchema = z.enum(["AUTHORITY", "COORDINATOR", "LIFEGUARD"], {
  error: "Perfil inválido.",
});

export const usernameSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(
    /^[a-z0-9][a-z0-9._-]{2,49}$/,
    "Use de 3 a 50 caracteres: letras sem acento, números, ponto, hífen ou sublinhado.",
  );

const checkbox = z
  .union([z.literal("on"), z.literal("true"), z.null()])
  .transform((value) => value !== null);

export const userIdSchema = z.uuid("Usuário inválido.");

export const createUserSchema = z.object({
  username: usernameSchema,
  name: z.string().trim().min(2, "Informe o nome.").max(120),
  role: roleSchema,
  isAdmin: checkbox,
});

export const updateUserSchema = z.object({
  userId: userIdSchema,
  name: z.string().trim().min(2, "Informe o nome.").max(120),
  role: roleSchema,
  isAdmin: checkbox,
  active: checkbox,
});
