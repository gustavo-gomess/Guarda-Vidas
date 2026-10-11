import Form from "next/form";

type Option = { id: string; name: string; code?: string };

const controlClass =
  "rounded-md border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900";

/**
 * GET filters for date, post and person. Values only narrow what the server
 * already allows the user to see; the server validates every parameter.
 */
export function FilterForm({
  action,
  posts,
  people,
  values,
  showDates = false,
}: {
  /** Path of the current page; filters become its search params. */
  action: string;
  posts: readonly Option[];
  /** Omitted for lifeguards, who only see themselves. */
  people?: readonly Option[];
  values: { de?: string; ate?: string; posto?: string; profissional?: string };
  showDates?: boolean;
}) {
  return (
    <Form
      action={action}
      className="flex flex-wrap items-end gap-3 text-sm"
      aria-label="Filtros"
    >
      {showDates ? (
        <>
          <label className="flex flex-col gap-1">
            <span className="font-medium">De</span>
            <input
              type="date"
              name="de"
              defaultValue={values.de}
              className={controlClass}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-medium">Até</span>
            <input
              type="date"
              name="ate"
              defaultValue={values.ate}
              className={controlClass}
            />
          </label>
        </>
      ) : null}
      <label className="flex flex-col gap-1">
        <span className="font-medium">Posto</span>
        <select
          name="posto"
          defaultValue={values.posto ?? ""}
          className={controlClass}
        >
          <option value="">Todos</option>
          {posts.map((post) => (
            <option key={post.id} value={post.id}>
              {post.code ? `${post.code} · ` : ""}
              {post.name}
            </option>
          ))}
        </select>
      </label>
      {people ? (
        <label className="flex flex-col gap-1">
          <span className="font-medium">Profissional</span>
          <select
            name="profissional"
            defaultValue={values.profissional ?? ""}
            className={controlClass}
          >
            <option value="">Todos</option>
            {people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <button
        type="submit"
        className="rounded border border-zinc-300 px-3 py-1 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
      >
        Filtrar
      </button>
    </Form>
  );
}
