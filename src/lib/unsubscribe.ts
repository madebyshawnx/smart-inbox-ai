/**
 * Pure parser for the RFC 2369 `List-Unsubscribe` header and the RFC 8058
 * `List-Unsubscribe-Post` header.
 *
 * HARD SAFETY CONTRACT: this module only PARSES header text. It never performs a
 * network call and, critically, it never treats a `mailto:` unsubscribe as
 * actionable — a mailto would require SENDING mail on the user's behalf, which
 * this app must never do. We surface the mailto target so the UI can hand it to
 * the user, but only an HTTPS URL combined with the RFC 8058 one-click marker is
 * ever safe to POST automatically (see google/gmail-actions.ts).
 *
 * `List-Unsubscribe` is a comma-separated list of angle-bracket URIs, e.g.:
 *   List-Unsubscribe: <https://ex.com/u?id=1>, <mailto:unsub@ex.com?subject=x>
 * `List-Unsubscribe-Post` (RFC 8058) is exactly:
 *   List-Unsubscribe-Post: List-Unsubscribe=One-Click
 * The one-click POST is only valid when BOTH an https URI is present AND the
 * Post header carries the `List-Unsubscribe=One-Click` token.
 */

export type ParsedListUnsubscribe = {
  // The first https URI from the header, if any. Only this may be POSTed.
  httpsUrl: string | null;
  // The first mailto target from the header, if any. NEVER acted on — returned
  // for the UI to offer to the user.
  mailto: string | null;
  // True only when an https URL is present AND List-Unsubscribe-Post signals
  // RFC 8058 one-click. This is the sole gate for an automatic POST.
  oneClick: boolean;
};

const ONE_CLICK_TOKEN = "list-unsubscribe=one-click";

/**
 * SSRF guard for the one-click unsubscribe POST target.
 *
 * The List-Unsubscribe URL is attacker-controlled (it comes from an untrusted
 * inbound email). Before we POST to it we must reject hostnames that resolve to
 * the loopback, link-local, or RFC 1918 private ranges — otherwise a malicious
 * sender could point the URL at internal infrastructure (e.g. the cloud
 * metadata endpoint 169.254.169.254) and use our server as a confused deputy.
 *
 * PURE and hostname-only: it does NOT do DNS resolution (that is a runtime
 * concern and can't be done deterministically in a unit test). It rejects
 * literal private/loopback/link-local IPs and the obvious hostnames. Returns
 * true when the host is DISALLOWED (must not be POSTed).
 */
export function isDisallowedUnsubscribeHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/\.$/, "");
  if (host === "") {
    return true;
  }

  // Bracketed / bare IPv6 loopback and unique-local (fc00::/7 → fc.. or fd..).
  const ipv6 = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
  if (ipv6 === "::1" || ipv6 === "::" || ipv6 === "0:0:0:0:0:0:0:1") {
    return true;
  }
  if (ipv6.includes(":")) {
    // fc00::/7 unique-local addresses start with fc or fd.
    if (/^f[cd][0-9a-f]*:/.test(ipv6)) {
      return true;
    }
    // IPv4-mapped IPv6 (e.g. ::ffff:127.0.0.1) — fall through to the v4 check
    // on the trailing dotted-quad if present.
    const mapped = ipv6.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
    if (mapped) {
      return isDisallowedIpv4(mapped[1]);
    }
    // Any other IPv6 literal we can't positively vet: allow (public), but the
    // common private ones above are covered. Link-local fe80::/10:
    if (/^fe[89ab][0-9a-f]*:/.test(ipv6)) {
      return true;
    }
    return false;
  }

  // Loopback / localhost hostnames.
  if (host === "localhost" || host.endsWith(".localhost")) {
    return true;
  }

  // Literal IPv4 → range check.
  if (/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) {
    return isDisallowedIpv4(host);
  }

  return false;
}

/** True when a dotted-quad IPv4 is in a loopback/private/link-local range. */
function isDisallowedIpv4(ip: string): boolean {
  const parts = ip.split(".").map((p) => Number(p));
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    // Malformed → treat as disallowed (fail closed).
    return true;
  }
  const [a, b] = parts;
  // 127.0.0.0/8 loopback
  if (a === 127) {
    return true;
  }
  // 10.0.0.0/8 private
  if (a === 10) {
    return true;
  }
  // 172.16.0.0/12 private (172.16 - 172.31)
  if (a === 172 && b >= 16 && b <= 31) {
    return true;
  }
  // 192.168.0.0/16 private
  if (a === 192 && b === 168) {
    return true;
  }
  // 169.254.0.0/16 link-local (includes the 169.254.169.254 metadata endpoint)
  if (a === 169 && b === 254) {
    return true;
  }
  // 0.0.0.0/8 "this host"
  if (a === 0) {
    return true;
  }
  return false;
}

/**
 * Extract the bracketed URIs from a `List-Unsubscribe` header value. Robust to
 * missing/extra whitespace and to entries that are not wrapped in angle brackets
 * (some senders omit them). Returns entries in header order.
 */
function extractUris(headerValue: string): string[] {
  const uris: string[] = [];
  const bracketed = headerValue.matchAll(/<([^>]+)>/g);
  for (const match of bracketed) {
    const uri = match[1].trim();
    if (uri !== "") {
      uris.push(uri);
    }
  }
  // Fallback: no angle brackets at all — treat the comma-split value as URIs.
  if (uris.length === 0 && headerValue.trim() !== "") {
    for (const part of headerValue.split(",")) {
      const uri = part.trim();
      if (uri !== "") {
        uris.push(uri);
      }
    }
  }
  return uris;
}

/**
 * Parse the `List-Unsubscribe` (+ optional `List-Unsubscribe-Post`) headers into
 * a safe, structured result. Pure and side-effect free.
 */
export function parseListUnsubscribe(
  headerValue: string | null | undefined,
  postHeaderValue?: string | null,
): ParsedListUnsubscribe {
  const value = headerValue ?? "";
  const uris = extractUris(value);

  let httpsUrl: string | null = null;
  let mailto: string | null = null;
  for (const uri of uris) {
    const lower = uri.toLowerCase();
    if (httpsUrl === null && lower.startsWith("https://")) {
      httpsUrl = uri;
    } else if (mailto === null && lower.startsWith("mailto:")) {
      // Strip the "mailto:" scheme so the UI gets a bare address/target.
      mailto = uri.slice("mailto:".length);
    }
  }

  const post = (postHeaderValue ?? "").toLowerCase();
  // Normalize whitespace so "List-Unsubscribe = One-Click" style spacing still
  // matches the RFC 8058 token.
  const postNormalized = post.replace(/\s+/g, "");
  const oneClick = httpsUrl !== null && postNormalized.includes(ONE_CLICK_TOKEN);

  return { httpsUrl, mailto, oneClick };
}
