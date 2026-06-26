import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decrypt, encrypt } from "@/lib/crypto";

// A known, valid 32-byte (AES-256) key, base64-encoded. The crypto module reads
// process.env.ENCRYPTION_KEY at call time, so setting it before the tests run is
// enough — no import-time coupling.
const VALID_KEY = Buffer.alloc(32, 7).toString("base64");

beforeAll(() => {
  process.env.ENCRYPTION_KEY = VALID_KEY;
});

afterAll(() => {
  process.env.ENCRYPTION_KEY = VALID_KEY;
});

describe("encrypt/decrypt round-trip", () => {
  it("round-trips a simple string", () => {
    const plaintext = "hello world";
    expect(decrypt(encrypt(plaintext))).toBe(plaintext);
  });

  it("round-trips a token-like string with special characters", () => {
    const plaintext = "ya29.A0ARrd:Lm-_+/=&?#token<>{}|\\^~`!@$%*()";
    expect(decrypt(encrypt(plaintext))).toBe(plaintext);
  });

  it("produces different ciphertexts for the same input (random IV) that both decrypt back", () => {
    const plaintext = "same-input-different-output";
    const a = encrypt(plaintext);
    const b = encrypt(plaintext);

    expect(a).not.toBe(b);
    expect(decrypt(a)).toBe(plaintext);
    expect(decrypt(b)).toBe(plaintext);
  });
});

describe("encrypt/decrypt integrity & format", () => {
  it("throws when the ciphertext segment is tampered with", () => {
    const token = encrypt("tamper-me");
    const [iv, tag, ct] = token.split(":");

    // Flip a character in the ciphertext segment (keep it valid base64-ish but
    // changed so the GCM auth tag no longer validates).
    const firstChar = ct[0];
    const flipped = firstChar === "A" ? "B" : "A";
    const tamperedCt = flipped + ct.slice(1);
    const tampered = [iv, tag, tamperedCt].join(":");

    expect(() => decrypt(tampered)).toThrow();
  });

  it("throws on malformed input with no colons", () => {
    expect(() => decrypt("not-a-valid-token")).toThrow(/malformed ciphertext/);
  });
});

describe("key handling", () => {
  it("throws on encrypt and decrypt when ENCRYPTION_KEY is missing, then restores", () => {
    const original = process.env.ENCRYPTION_KEY;
    // Capture a valid token while the key is present.
    const token = encrypt("needs-a-key");

    process.env.ENCRYPTION_KEY = undefined;
    delete process.env.ENCRYPTION_KEY;

    expect(() => encrypt("x")).toThrow(/ENCRYPTION_KEY is not set/);
    expect(() => decrypt(token)).toThrow(/ENCRYPTION_KEY is not set/);

    process.env.ENCRYPTION_KEY = original;
    // Sanity: still works after restore.
    expect(decrypt(token)).toBe("needs-a-key");
  });

  it("throws when the key decodes to the wrong length", () => {
    const original = process.env.ENCRYPTION_KEY;
    process.env.ENCRYPTION_KEY = Buffer.alloc(16, 1).toString("base64");

    expect(() => encrypt("x")).toThrow(/must decode to 32 bytes/);

    process.env.ENCRYPTION_KEY = original;
  });
});
