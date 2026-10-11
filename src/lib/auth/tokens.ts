import { createHash, randomBytes } from "node:crypto";

/** 256-bit random session token, sent to the browser only in a cookie. */
export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * The database stores only this hash, so a leaked sessions table does not
 * expose usable tokens.
 */
export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
