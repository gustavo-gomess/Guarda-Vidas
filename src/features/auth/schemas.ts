import { z } from "zod";

import { newPasswordSchema, PASSWORD_MAX_LENGTH } from "@/lib/auth/password";

export const loginSchema = z.object({
  username: z.string().trim().min(1, "Informe o usuário.").max(50),
  // Not validated against the policy: old passwords must still work.
  password: z.string().min(1, "Informe a senha.").max(PASSWORD_MAX_LENGTH),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z
      .string()
      .min(1, "Informe a senha atual.")
      .max(PASSWORD_MAX_LENGTH),
    newPassword: newPasswordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "As senhas não conferem.",
    path: ["confirmPassword"],
  })
  .refine((data) => data.newPassword !== data.currentPassword, {
    message: "A nova senha deve ser diferente da atual.",
    path: ["newPassword"],
  });
