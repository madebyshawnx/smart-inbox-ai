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
