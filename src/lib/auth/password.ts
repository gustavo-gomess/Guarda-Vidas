import {
  randomBytes,
  randomInt,
  scrypt as scryptCallback,
  timingSafeEqual,
  type ScryptOptions,
} from "node:crypto";

import { z } from "zod";

/**
 * Password hashing with Node's built-in scrypt.
 *
 * Parameters follow the OWASP Password Storage Cheat Sheet option
 * N=2^15, r=8, p=3 (about 32 MiB per hash). They are stored with each hash,
 * so they can be raised later; `needsRehash` reports old hashes.
 */
const PARAMS = { N: 2 ** 15, r: 8, p: 3 } as const;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;
const MAX_MEMORY = 64 * 1024 * 1024;

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 128;

/** Rules for passwords chosen by users. */
export const newPasswordSchema = z
  .string()
  .min(
    PASSWORD_MIN_LENGTH,
    `A senha deve ter pelo menos ${PASSWORD_MIN_LENGTH} caracteres.`,
  )
  .max(
    PASSWORD_MAX_LENGTH,
    `A senha deve ter no máximo ${PASSWORD_MAX_LENGTH} caracteres.`,
  );

function scrypt(
  password: string,
  salt: Buffer,
  keyLength: number,
  options: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keyLength, options, (error, key) =>
      error ? reject(error) : resolve(key),
    );
  });
}

/** Format: scrypt$N$r$p$<salt base64>$<hash base64> */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LENGTH);
  const key = await scrypt(password.normalize("NFKC"), salt, KEY_LENGTH, {
    ...PARAMS,
    maxmem: MAX_MEMORY,
  });
  return [
    "scrypt",
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt.toString("base64"),
    key.toString("base64"),
  ].join("$");
}

type ParsedHash = {
  N: number;
  r: number;
  p: number;
  salt: Buffer;
  key: Buffer;
};

function parseHash(stored: string): ParsedHash | null {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return null;
  const [, n, r, p, salt, key] = parts;
  const N = Number(n);
  const rNum = Number(r);
  const pNum = Number(p);
  if (![N, rNum, pNum].every(Number.isSafeInteger) || !salt || !key) {
    return null;
  }
  return {
    N,
    r: rNum,
    p: pNum,
    salt: Buffer.from(salt, "base64"),
    key: Buffer.from(key, "base64"),
  };
}

/** Constant-time comparison. Returns false for malformed hashes. */
export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const parsed = parseHash(stored);
  if (!parsed) return false;
  const key = await scrypt(
    password.normalize("NFKC"),
    parsed.salt,
    parsed.key.length,
    { N: parsed.N, r: parsed.r, p: parsed.p, maxmem: MAX_MEMORY },
  );
  return key.length === parsed.key.length && timingSafeEqual(key, parsed.key);
}

export function needsRehash(stored: string): boolean {
  const parsed = parseHash(stored);
  return (
    !parsed ||
    parsed.N !== PARAMS.N ||
    parsed.r !== PARAMS.r ||
    parsed.p !== PARAMS.p
  );
}

// No look-alike characters (0/O, 1/l/I), so it can be read aloud or typed
// from a screen.
const TEMP_ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/**
 * Random temporary password (16 characters, ~92 bits), always paired with
 * mustChangePassword = true.
 */
export function generateTemporaryPassword(length = 16): string {
  return Array.from(
    { length },
    () => TEMP_ALPHABET[randomInt(TEMP_ALPHABET.length)],
  ).join("");
}
