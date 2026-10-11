import { describe, expect, it } from "vitest";
import { z } from "zod";

import { fail, invalidInput, ok } from "@/lib/errors";

describe("ActionResult helpers", () => {
  it("ok wraps data", () => {
    expect(ok({ id: 1 })).toEqual({ ok: true, data: { id: 1 } });
    expect(ok()).toEqual({ ok: true, data: undefined });
  });

  it("fail carries a user-facing message", () => {
    expect(fail("Posto não encontrado.")).toEqual({
      ok: false,
      error: "Posto não encontrado.",
    });
  });

  it("invalidInput maps Zod issues to field errors", () => {
    const schema = z.object({
      name: z.string().min(1, "Informe o nome."),
      age: z.number().int(),
    });
    const parsed = schema.safeParse({ name: "", age: 1.5 });
    if (parsed.success) throw new Error("expected validation to fail");

    const result = invalidInput(parsed.error);
    expect(result).toEqual({
      ok: false,
      error: "Confira os campos destacados.",
      fieldErrors: {
        name: ["Informe o nome."],
        age: [expect.any(String)],
      },
    });
  });
});
