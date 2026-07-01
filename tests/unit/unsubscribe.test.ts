import { describe, expect, it } from "vitest";
import { parseListUnsubscribe } from "../../src/lib/unsubscribe";

describe("parseListUnsubscribe", () => {
  it("extracts an https-only unsubscribe URL", () => {
    const result = parseListUnsubscribe("<https://ex.com/u?id=1>");
    expect(result.httpsUrl).toBe("https://ex.com/u?id=1");
    expect(result.mailto).toBeNull();
    expect(result.oneClick).toBe(false);
  });

  it("extracts a mailto-only target and strips the scheme, never one-click", () => {
    const result = parseListUnsubscribe(
      "<mailto:unsub@ex.com?subject=off>",
      "List-Unsubscribe=One-Click",
    );
    expect(result.httpsUrl).toBeNull();
    expect(result.mailto).toBe("unsub@ex.com?subject=off");
    // No https URL means one-click can never be true even if Post says so.
    expect(result.oneClick).toBe(false);
  });

  it("extracts BOTH https and mailto, preferring https for the URL slot", () => {
    const result = parseListUnsubscribe("<https://ex.com/u?id=1>, <mailto:unsub@ex.com>");
    expect(result.httpsUrl).toBe("https://ex.com/u?id=1");
    expect(result.mailto).toBe("unsub@ex.com");
    expect(result.oneClick).toBe(false);
  });

  it("sets oneClick when https + RFC 8058 Post header are both present", () => {
    const result = parseListUnsubscribe(
      "<https://ex.com/u?id=1>, <mailto:unsub@ex.com>",
      "List-Unsubscribe=One-Click",
    );
    expect(result.httpsUrl).toBe("https://ex.com/u?id=1");
    expect(result.oneClick).toBe(true);
  });

  it("matches the one-click token case-insensitively and ignoring spacing", () => {
    const result = parseListUnsubscribe("<https://ex.com/u>", "list-unsubscribe = one-click");
    expect(result.oneClick).toBe(true);
  });

  it("returns all-null/false for a missing header", () => {
    expect(parseListUnsubscribe(null)).toEqual({
      httpsUrl: null,
      mailto: null,
      oneClick: false,
    });
    expect(parseListUnsubscribe(undefined)).toEqual({
      httpsUrl: null,
      mailto: null,
      oneClick: false,
    });
    expect(parseListUnsubscribe("")).toEqual({
      httpsUrl: null,
      mailto: null,
      oneClick: false,
    });
  });

  it("does not set oneClick without the Post header even with https present", () => {
    const result = parseListUnsubscribe("<https://ex.com/u>");
    expect(result.oneClick).toBe(false);
  });

  it("tolerates URIs without angle brackets", () => {
    const result = parseListUnsubscribe("https://ex.com/u, mailto:x@ex.com");
    expect(result.httpsUrl).toBe("https://ex.com/u");
    expect(result.mailto).toBe("x@ex.com");
  });

  it("ignores http (non-TLS) URLs — only https is actionable", () => {
    const result = parseListUnsubscribe("<http://ex.com/u>", "List-Unsubscribe=One-Click");
    expect(result.httpsUrl).toBeNull();
    expect(result.oneClick).toBe(false);
  });
});
