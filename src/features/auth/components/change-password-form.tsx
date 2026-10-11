import { changePasswordAction } from "@/features/auth/actions";
import { ActionForm } from "@/components/ui/action-form";
import { Field } from "@/components/ui/field";
import { PASSWORD_MIN_LENGTH } from "@/lib/auth/password";

export function ChangePasswordForm() {
  return (
    <ActionForm
      action={changePasswordAction}
      submitLabel="Alterar senha"
      className="flex flex-col gap-4"
    >
      <Field
        label="Senha atual"
        name="currentPassword"
        type="password"
        autoComplete="current-password"
        required
      />
      <Field
        label={`Nova senha (mínimo ${PASSWORD_MIN_LENGTH} caracteres)`}
        name="newPassword"
        type="password"
        autoComplete="new-password"
        minLength={PASSWORD_MIN_LENGTH}
        required
      />
      <Field
        label="Repita a nova senha"
        name="confirmPassword"
        type="password"
        autoComplete="new-password"
        required
      />
    </ActionForm>
  );
}
