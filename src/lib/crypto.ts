import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Authenticated symmetric encryption for secrets at rest (Gmail OAuth tokens).
 *
 * AES-256-GCM gives confidentiality AND integrity: a tampered ciphertext fails
 * to decrypt rather than returning garbage. The key comes from ENCRYPTION_KEY
 * (a base64-encoded 32 bytes) and is never written to disk by this module.
 */

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96-bit nonce, the GCM standard
const KEY_LENGTH = 32; // AES-256

function getKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    throw new Error("ENCRYPTION_KEY is not set");
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== KEY_LENGTH) {
    throw new Error(`ENCRYPTION_KEY must decode to ${KEY_LENGTH} bytes (got ${key.length})`);
  }
  return key;
}

/**
 * Encrypt a UTF-8 string. Output format is `iv:authTag:ciphertext`, each part
 * base64 — a single self-describing token safe to store in one DB column.
 */
export function encrypt(plaintext: string): string {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString("base64"), authTag.toString("base64"), ciphertext.toString("base64")].join(
    ":",
  );
}

/**
 * Decrypt a token produced by {@link encrypt}. Throws if the key is wrong, the
 * format is malformed, or the ciphertext/tag has been tampered with.
 */
export function decrypt(token: string): string {
  const parts = token.split(":");
  if (parts.length !== 3) {
    throw new Error("malformed ciphertext");
  }
  const [ivB64, tagB64, ctB64] = parts;
  const iv = Buffer.from(ivB64, "base64");
  const authTag = Buffer.from(tagB64, "base64");
  const ciphertext = Buffer.from(ctB64, "base64");

  const decipher = createDecipheriv(ALGORITHM, getKey(), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}
