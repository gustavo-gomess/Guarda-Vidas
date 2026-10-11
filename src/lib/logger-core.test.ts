import { describe, expect, it } from "vitest";

import {
  createLogger,
  isSensitiveKey,
  REDACTED,
  redact,
  type LogLevel,
} from "@/lib/logger-core";

function captureLogger(level: LogLevel = "debug", json = true) {
  const lines: { level: LogLevel; line: string }[] = [];
  const logger = createLogger({
    level,
    json,
    includeStack: false,
    write: (lineLevel, line) => lines.push({ level: lineLevel, line }),
  });
  return { logger, lines };
}

describe("isSensitiveKey", () => {
  it.each([
    "password",
    "senha",
    "accessToken",
    "refresh_token",
    "Authorization",
    "cookie",
    "apiKey",
    "API_KEY",
    "cpf",
    "email",
    "phoneNumber",
    "sessionId",
  ])("masks %s", (key) => {
    expect(isSensitiveKey(key)).toBe(true);
  });

  it.each(["authorId", "postId", "organization", "target", "status", "count"])(
    "keeps %s",
    (key) => {
      expect(isSensitiveKey(key)).toBe(false);
    },
  );
});

describe("redact", () => {
  it("masks sensitive keys at any depth, including arrays", () => {
    expect(
      redact({
        userId: "u1",
        password: "hunter2",
        nested: { users: [{ id: "u2", email: "a@b.c" }] },
      }),
    ).toEqual({
      userId: "u1",
      password: REDACTED,
      nested: { users: [{ id: "u2", email: REDACTED }] },
    });
  });

  it("serializes errors without the stack by default", () => {
    const error = Object.assign(new Error("boom"), { code: "P1001" });
    expect(redact({ error })).toEqual({
      error: { name: "Error", message: "boom", code: "P1001" },
    });
  });

  it("includes the stack when requested", () => {
    const result = redact(new Error("boom"), true) as { stack?: string };
    expect(result.stack).toContain("boom");
  });

  it("truncates very deep structures", () => {
    const deep = { a: { b: { c: { d: { e: { f: "x" } } } } } };
    expect(JSON.stringify(redact(deep))).toContain("[Truncated]");
  });
});

describe("createLogger", () => {
  it("writes one JSON line with level, message and redacted context", () => {
    const { logger, lines } = captureLogger();
    logger.info("user signed in", { userId: "u1", token: "abc" });

    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0]!.line) as Record<string, unknown>;
    expect(entry).toMatchObject({
      level: "info",
      msg: "user signed in",
      userId: "u1",
      token: REDACTED,
    });
    expect(lines[0]!.line).not.toContain("abc");
  });

  it("drops entries below the configured level", () => {
    const { logger, lines } = captureLogger("warn");
    logger.debug("debug");
    logger.info("info");
    logger.warn("warn");
    logger.error("error");
    expect(lines.map((entry) => entry.level)).toEqual(["warn", "error"]);
  });

  it("writes readable text when json is off", () => {
    const { logger, lines } = captureLogger("debug", false);
    logger.warn("slow query", { ms: 1200 });
    expect(lines[0]!.line).toBe('[warn] slow query {"ms":1200}');
  });
});
