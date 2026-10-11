import { describe, expect, it } from "vitest";

import {
  generateTemporaryPassword,
  hashPassword,
  needsRehash,
  newPasswordSchema,
  verifyPassword,
} from "@/lib/auth/password";

describe("password hashing", () => {
  it("never stores the password in plain text and verifies it", async () => {
    const hash = await hashPassword("correct horse battery");
    expect(hash).not.toContain("correct horse battery");
    expect(hash).toMatch(/^scrypt\$32768\$8\$3\$/);
    expect(await verifyPassword("correct horse battery", hash)).toBe(true);
  });

  it("rejects a wrong password", async () => {
    const hash = await hashPassword("correct horse battery");
    expect(await verifyPassword("correct horse batterY", hash)).toBe(false);
  });

  it("uses a random salt per hash", async () => {
    const [a, b] = await Promise.all([
      hashPassword("same password"),
      hashPassword("same password"),
    ]);
    expect(a).not.toBe(b);
  });

  it("treats malformed hashes as non-matching", async () => {
    expect(await verifyPassword("x", "")).toBe(false);
    expect(await verifyPassword("x", "plain-text-password")).toBe(false);
    expect(await verifyPassword("x", "scrypt$a$b$c$d$e")).toBe(false);
  });

  it("normalizes Unicode so the same visible password matches", async () => {
    const composed = "senha-çã-segura"; // NFC
    const decomposed = composed.normalize("NFD");
    const hash = await hashPassword(composed);
    expect(await verifyPassword(decomposed, hash)).toBe(true);
  });

  it("flags hashes made with other parameters for rehash", async () => {
    expect(needsRehash(await hashPassword("x"))).toBe(false);
    expect(needsRehash("scrypt$16384$8$1$c2FsdA==$aGFzaA==")).toBe(true);
    expect(needsRehash("bcrypt$whatever")).toBe(true);
  });
});

describe("password rules", () => {
  it("requires at least 10 characters", () => {
    expect(newPasswordSchema.safeParse("123456789").success).toBe(false);
    expect(newPasswordSchema.safeParse("1234567890").success).toBe(true);
  });
});

describe("generateTemporaryPassword", () => {
  it("produces 16 unambiguous characters, different each time", () => {
    const passwords = new Set(
      Array.from({ length: 50 }, () => generateTemporaryPassword()),
    );
    expect(passwords.size).toBe(50);
    for (const password of passwords) {
      expect(password).toMatch(/^[a-km-np-zA-HJ-NP-Z2-9]{16}$/);
    }
  });
});
