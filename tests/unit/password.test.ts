import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import { hashPassword, verifyPassword } from "../../src/lib/password";

describe("password hashing", () => {
  test("hashes and verifies a password with scrypt", async () => {
    const password = "AeroDynamic-test-password-2026";
    const hash = await hashPassword(password);

    expect(hash).not.toBe(password);
    expect(hash.startsWith("scrypt$")).toBe(true);
    await expect(verifyPassword(password, hash)).resolves.toEqual({
      valid: true,
      needsRehash: false,
    });
  });

  test("rejects an incorrect password", async () => {
    const hash = await hashPassword("AeroDynamic-test-password-2026");

    await expect(verifyPassword("wrong-password", hash)).resolves.toEqual({
      valid: false,
      needsRehash: false,
    });
  });

  test("supports existing SHA-256 hashes so they can be upgraded after login", async () => {
    const password = "legacy-password";
    const legacyHash = createHash("sha256").update(password).digest("hex");

    await expect(verifyPassword(password, legacyHash)).resolves.toEqual({
      valid: true,
      needsRehash: true,
    });
  });

  test("rejects malformed stored hashes", async () => {
    await expect(verifyPassword("any-password", "not-a-valid-hash")).resolves.toEqual({
      valid: false,
      needsRehash: false,
    });
  });
});
