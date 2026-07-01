import { describe, expect, it } from "vitest";
import { isDisallowedUnsubscribeHost, parseListUnsubscribe } from "../../src/lib/unsubscribe";

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

describe("isDisallowedUnsubscribeHost (SSRF guard)", () => {
  it("allows ordinary public hostnames", () => {
    expect(isDisallowedUnsubscribeHost("ex.com")).toBe(false);
    expect(isDisallowedUnsubscribeHost("mail.sendgrid.net")).toBe(false);
    expect(isDisallowedUnsubscribeHost("sub.domain.example.co.uk")).toBe(false);
    // A public IPv4.
    expect(isDisallowedUnsubscribeHost("8.8.8.8")).toBe(false);
  });

  it("rejects loopback (127.0.0.0/8) and localhost", () => {
    expect(isDisallowedUnsubscribeHost("127.0.0.1")).toBe(true);
    expect(isDisallowedUnsubscribeHost("127.1.2.3")).toBe(true);
    expect(isDisallowedUnsubscribeHost("localhost")).toBe(true);
    expect(isDisallowedUnsubscribeHost("api.localhost")).toBe(true);
  });

  it("rejects RFC 1918 private ranges", () => {
    expect(isDisallowedUnsubscribeHost("10.0.0.1")).toBe(true);
    expect(isDisallowedUnsubscribeHost("10.255.255.255")).toBe(true);
    expect(isDisallowedUnsubscribeHost("172.16.0.1")).toBe(true);
    expect(isDisallowedUnsubscribeHost("172.31.255.255")).toBe(true);
    expect(isDisallowedUnsubscribeHost("192.168.1.1")).toBe(true);
    // 172.15 and 172.32 are PUBLIC (outside the /12).
    expect(isDisallowedUnsubscribeHost("172.15.0.1")).toBe(false);
    expect(isDisallowedUnsubscribeHost("172.32.0.1")).toBe(false);
  });

  it("rejects link-local, including the cloud metadata endpoint", () => {
    expect(isDisallowedUnsubscribeHost("169.254.169.254")).toBe(true);
    expect(isDisallowedUnsubscribeHost("169.254.0.1")).toBe(true);
  });

  it("rejects 0.0.0.0/8 (this host)", () => {
    expect(isDisallowedUnsubscribeHost("0.0.0.0")).toBe(true);
  });

  it("rejects IPv6 loopback and unique-local / link-local literals", () => {
    expect(isDisallowedUnsubscribeHost("::1")).toBe(true);
    expect(isDisallowedUnsubscribeHost("[::1]")).toBe(true);
    expect(isDisallowedUnsubscribeHost("fc00::1")).toBe(true);
    expect(isDisallowedUnsubscribeHost("fd12:3456::1")).toBe(true);
    expect(isDisallowedUnsubscribeHost("fe80::1")).toBe(true);
    // IPv4-mapped loopback.
    expect(isDisallowedUnsubscribeHost("::ffff:127.0.0.1")).toBe(true);
  });

  it("fails closed on an empty host and normalizes a trailing dot", () => {
    expect(isDisallowedUnsubscribeHost("")).toBe(true);
    expect(isDisallowedUnsubscribeHost("   ")).toBe(true);
    // Trailing-dot FQDN form of localhost still rejected.
    expect(isDisallowedUnsubscribeHost("localhost.")).toBe(true);
    // Trailing-dot public host still allowed.
    expect(isDisallowedUnsubscribeHost("ex.com.")).toBe(false);
  });
});
