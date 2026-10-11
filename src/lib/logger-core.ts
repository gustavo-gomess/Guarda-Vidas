export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogContext = Record<string, unknown>;

export type Logger = {
  [Level in LogLevel]: (message: string, context?: LogContext) => void;
};

type LoggerOptions = {
  level: LogLevel;
  /** One JSON object per line (production) or readable text (development). */
  json: boolean;
  /** Include error stack traces. Keep off in production. */
  includeStack: boolean;
  write?: (level: LogLevel, line: string) => void;
};

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export const REDACTED = "[REDACTED]";

// Key words whose values are never logged: credentials and personal data.
// Matched against whole words of the key (camelCase, snake_case, kebab-case),
// so `accessToken` is masked but `authorId` is not.
const SENSITIVE_WORDS = new Set([
  "password",
  "passwd",
  "pwd",
  "senha",
  "secret",
  "token",
  "authorization",
  "cookie",
  "cookies",
  "credential",
  "credentials",
  "session",
  "cpf",
  "rg",
  "email",
  "phone",
  "telefone",
  "celular",
  "address",
  "endereco",
  "birthdate",
  "nascimento",
]);
const SENSITIVE_COMPOUNDS = ["apikey", "privatekey", "secretkey"];

export function isSensitiveKey(key: string): boolean {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  const joined = words.join("");
  return (
    words.some((word) => SENSITIVE_WORDS.has(word)) ||
    SENSITIVE_COMPOUNDS.some((compound) => joined.includes(compound))
  );
}

const MAX_DEPTH = 5;

/** Returns a copy of `value` with sensitive keys masked. */
export function redact(
  value: unknown,
  includeStack = false,
  depth = 0,
): unknown {
  if (value instanceof Error) {
    return serializeError(value, includeStack, depth);
  }
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (depth >= MAX_DEPTH) {
    return "[Truncated]";
  }
  if (Array.isArray(value)) {
    return value.map((item) => redact(item, includeStack, depth + 1));
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      isSensitiveKey(key) ? REDACTED : redact(item, includeStack, depth + 1),
    ]),
  );
}

function serializeError(error: Error, includeStack: boolean, depth: number) {
  const serialized: Record<string, unknown> = {
    name: error.name,
    message: error.message,
  };
  if ("code" in error) serialized.code = error.code;
  if ("digest" in error) serialized.digest = error.digest;
  if (includeStack && error.stack) serialized.stack = error.stack;
  if (error.cause !== undefined) {
    serialized.cause = redact(error.cause, includeStack, depth + 1);
  }
  return serialized;
}

function defaultWrite(level: LogLevel, line: string) {
  // The only place in the app allowed to call console directly.
  console[level](line);
}

export function createLogger(options: LoggerOptions): Logger {
  const write = options.write ?? defaultWrite;
  const minimum = LEVEL_ORDER[options.level];

  const log = (level: LogLevel, message: string, context?: LogContext) => {
    if (LEVEL_ORDER[level] < minimum) return;

    const safeContext = context
      ? (redact(context, options.includeStack) as LogContext)
      : undefined;

    const line = options.json
      ? JSON.stringify({
          time: new Date().toISOString(),
          level,
          msg: message,
          ...safeContext,
        })
      : `[${level}] ${message}${safeContext ? ` ${JSON.stringify(safeContext)}` : ""}`;

    write(level, line);
  };

  return {
    debug: (message, context) => log("debug", message, context),
    info: (message, context) => log("info", message, context),
    warn: (message, context) => log("warn", message, context),
    error: (message, context) => log("error", message, context),
  };
}
