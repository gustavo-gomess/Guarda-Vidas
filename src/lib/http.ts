/**
 * Helpers for JSON Route Handlers called by our own pages (presence sync,
 * reinforcement alerts). Server Actions get these checks from Next.js;
 * Route Handlers must do them explicitly.
 */

export function jsonResponse(status: number, body: Record<string, unknown>) {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

/** Same-origin check, like Next.js does for Server Actions. */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const host =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/**
 * Origin, content type and size checks, then JSON parsing. Returns the
 * parsed body, or the error response to send.
 */
export async function readJsonRequest(
  request: Request,
  maxBytes: number,
): Promise<{ body: unknown } | { response: Response }> {
  if (!isSameOrigin(request)) {
    return {
      response: jsonResponse(403, {
        code: "BAD_ORIGIN",
        message: "Origem não permitida.",
      }),
    };
  }
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return {
      response: jsonResponse(415, {
        code: "BAD_CONTENT",
        message: "Envie JSON.",
      }),
    };
  }
  const text = await request.text();
  if (text.length > maxBytes) {
    return {
      response: jsonResponse(413, {
        code: "TOO_LARGE",
        message: "Conteúdo grande demais.",
      }),
    };
  }
  try {
    return { body: JSON.parse(text) };
  } catch {
    return {
      response: jsonResponse(400, {
        code: "INVALID",
        message: "Dados inválidos.",
      }),
    };
  }
}
