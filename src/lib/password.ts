import {
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback);
const KEY_LENGTH = 64;
const SCRYPT_PREFIX = "scrypt";

type PasswordCheck = {
  valid: boolean;
  needsRehash: boolean;
};

async function deriveKey(password: string, salt: string): Promise<Buffer> {
  return (await scrypt(password, salt, KEY_LENGTH)) as Buffer;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const key = await deriveKey(password, salt);

  return [SCRYPT_PREFIX, salt, key.toString("hex")].join("$");
}

export async function verifyPassword(
  password: string,
  storedHash: string
): Promise<PasswordCheck> {
  const [prefix, salt, hash] = storedHash.split("$");

  if (
    prefix === SCRYPT_PREFIX &&
    /^[a-f0-9]{32}$/i.test(salt || "") &&
    /^[a-f0-9]{128}$/i.test(hash || "")
  ) {
    const expected = Buffer.from(hash, "hex");
    const actual = await deriveKey(password, salt);

    return {
      valid: timingSafeEqual(actual, expected),
      needsRehash: false,
    };
  }

  // Existing accounts used SHA-256. Accept that format once, then upgrade
  // the hash to scrypt after a successful login.
  if (!/^[a-f0-9]{64}$/i.test(storedHash)) {
    return { valid: false, needsRehash: false };
  }

  const expected = Buffer.from(storedHash, "hex");
  const actual = createHash("sha256").update(password).digest();

  return {
    valid: timingSafeEqual(actual, expected),
    needsRehash: true,
  };
}
