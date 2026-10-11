import { notFound } from "next/navigation";
import { Suspense } from "react";

import { ActionForm } from "@/components/ui/action-form";
import { Field } from "@/components/ui/field";
import { Loading, PageShell } from "@/components/ui/page-shell";
import { UserMenu } from "@/features/auth/components/user-menu";
import {
  createCategoryAction,
  updateCategoryAction,
} from "@/features/occurrences/actions";
import { FieldsEditor } from "@/features/occurrences/components/fields-editor";
import { FIELD_TYPE_LABELS } from "@/features/occurrences/fields";
import { listCategoriesForAdmin } from "@/features/occurrences/queries";
import { requireActor } from "@/lib/auth/session";
import { formatDateTime } from "@/lib/dates";

export default function OccurrenceCategoriesPage() {
  return (
    <Suspense fallback={<Loading />}>
      <Content />
    </Suspense>
  );
}

async function Content() {
  const actor = await requireActor();
  const categories = await listCategoriesForAdmin(actor);
  if (!categories) notFound();

  return (
    <>
      <UserMenu actor={actor} />
      <PageShell title="Categorias de registros operacionais">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Ex.: ocorrência, ação preventiva, registro de águas-vivas. Cada
          alteração cria uma nova versão; registros antigos mantêm os campos da
          época.
        </p>

        {categories.length === 0 ? (
          <p className="text-zinc-600 dark:text-zinc-400">
            Nenhuma categoria criada.
          </p>
        ) : (
          <ul className="flex flex-col gap-4">
            {categories.map(({ id, current, versions }) => (
              <li
                key={id}
                className="flex flex-col gap-2 rounded-md border border-zinc-200 p-3 dark:border-zinc-800"
              >
                <p className="font-medium">
                  {current.name} · versão {current.version}
                  {current.active ? "" : " (desativada)"}
                </p>
                <p className="text-sm text-zinc-600 dark:text-zinc-400">
                  {current.fields.length === 0
                    ? "Sem campos extras."
                    : current.fields
                        .map(
                          (field) =>
                            `${field.label} (${FIELD_TYPE_LABELS[field.type].toLowerCase()}${field.required ? ", obrigatório" : ""})`,
                        )
                        .join(" · ")}
                </p>
                <details className="text-sm">
                  <summary className="cursor-pointer underline">Editar</summary>
                  <ActionForm
                    action={updateCategoryAction}
                    submitLabel="Salvar nova versão"
                    successMessage="Salvo."
                    className="mt-2 flex flex-col gap-3"
                  >
                    <input type="hidden" name="categoryId" value={id} />
                    <Field
                      label="Nome"
                      name="name"
                      defaultValue={current.name}
                      required
                      maxLength={60}
                    />
                    <Field
                      label="Orientação"
                      name="description"
                      defaultValue={current.description}
                      maxLength={300}
                    />
                    <label className="flex items-center gap-2">
                      <select
                        name="active"
                        defaultValue={current.active ? "true" : "false"}
                        className="rounded-md border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
                      >
                        <option value="true">Ativa</option>
                        <option value="false">Desativada</option>
                      </select>
                    </label>
                    <FieldsEditor initial={current.fields} />
                  </ActionForm>
                </details>
                {versions.length > 1 ? (
                  <details className="text-sm">
                    <summary className="cursor-pointer underline">
                      {versions.length} versões
                    </summary>
                    <ol className="mt-1 text-zinc-600 dark:text-zinc-400">
                      {versions.map((version) => (
                        <li key={version.id}>
                          v{version.version} ·{" "}
                          {formatDateTime(version.createdAt)} ·{" "}
                          {version.createdBy.name} · {version.name} ·{" "}
                          {version.fields.length} campo(s)
                          {version.active ? "" : " · desativada"}
                        </li>
                      ))}
                    </ol>
                  </details>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        <section className="flex max-w-xl flex-col gap-3">
          <h2 className="text-lg font-semibold">Nova categoria</h2>
          <ActionForm
            action={createCategoryAction}
            submitLabel="Criar categoria"
            successMessage="Categoria criada."
            className="flex flex-col gap-3"
          >
            <Field label="Nome" name="name" required maxLength={60} />
            <Field
              label="Orientação (opcional)"
              name="description"
              maxLength={300}
            />
            <FieldsEditor initial={[]} />
          </ActionForm>
        </section>
      </PageShell>
    </>
  );
}
