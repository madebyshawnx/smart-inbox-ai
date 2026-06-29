import type { RawEmail } from "@/lib/classification/classify";

/**
 * Minimal Gmail read-only ingestion: list recent messages, fetch them, and
 * normalize each into the `RawEmail` shape the classifier already consumes.
 * Gmail is just another source feeding the existing pipeline.
 */

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

// Cap the stored body. Data minimization (we don't retain whole raw messages)
// and token-cost control: the classifier only needs the gist.
const MAX_BODY_CHARS = 4000;

export type GmailHeader = { name: string; value: string };
export type GmailPart = {
  mimeType?: string;
  body?: { data?: string; size?: number };
  parts?: GmailPart[];
  headers?: GmailHeader[];
};
export type GmailMessage = {
  id: string;
  threadId: string;
  snippet?: string;
  internalDate?: string;
  labelIds?: string[];
  payload?: GmailPart;
};

async function gmailGet<T>(accessToken: string, path: string): Promise<T> {
  const res = await fetch(`${GMAIL_API}${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    // Don't leak the token; surface status only.
    throw new Error(`Gmail API request failed (${res.status})`);
  }
  return (await res.json()) as T;
}

/** The connected mailbox's own address, used to label the ConnectedAccount. */
export async function getProfileEmail(accessToken: string): Promise<string> {
  const data = await gmailGet<{ emailAddress?: string }>(accessToken, "/profile");
  if (!data.emailAddress) {
    throw new Error("Gmail profile did not include an email address");
  }
  return data.emailAddress;
}

export async function listRecentMessageIds(
  accessToken: string,
  maxResults = 25,
): Promise<string[]> {
  const data = await gmailGet<{ messages?: Array<{ id: string }> }>(
    accessToken,
    `/messages?maxResults=${maxResults}&q=in:inbox`,
  );
  return (data.messages ?? []).map((m) => m.id);
}

export async function getMessage(accessToken: string, id: string): Promise<GmailMessage> {
  return gmailGet<GmailMessage>(accessToken, `/messages/${id}?format=full`);
}

function header(headers: GmailHeader[] | undefined, name: string): string {
  const found = (headers ?? []).find((h) => h.name.toLowerCase() === name.toLowerCase());
  return found?.value ?? "";
}

// "Jane Doe <jane@x.com>" -> { name, email }; bare "jane@x.com" -> name falls back to the address.
export function parseSender(from: string): { name: string; email: string } {
  const match = from.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (match) {
    const name = match[1].trim();
    const email = match[2].trim();
    return { name: name === "" ? email : name, email };
  }
  const email = from.trim();
  return { name: email, email };
}

function decodeBase64Url(data: string): string {
  return Buffer.from(data, "base64url").toString("utf8");
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function findPart(part: GmailPart, mimeType: string): GmailPart | null {
  if (part.mimeType === mimeType && part.body?.data) {
    return part;
  }
  for (const child of part.parts ?? []) {
    const found = findPart(child, mimeType);
    if (found !== null) {
      return found;
    }
  }
  return null;
}

// Walk the MIME tree, preferring text/plain; fall back to stripped text/html.
function extractBody(payload: GmailPart | undefined): string {
  if (!payload) {
    return "";
  }

  const plain = findPart(payload, "text/plain");
  if (plain?.body?.data) {
    return decodeBase64Url(plain.body.data);
  }
  const html = findPart(payload, "text/html");
  if (html?.body?.data) {
    return stripHtml(decodeBase64Url(html.body.data));
  }
  if (payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }
  return "";
}

/**
 * Normalize a full Gmail message into a `RawEmail`. Pure and side-effect free so
 * it can be unit-tested against fixture payloads without any network.
 */
export function normalizeGmailMessage(message: GmailMessage): RawEmail {
  const headers = message.payload?.headers;
  const sender = parseSender(header(headers, "From"));
  const subject = header(headers, "Subject");

  const receivedAt =
    message.internalDate !== undefined
      ? new Date(Number(message.internalDate)).toISOString()
      : new Date().toISOString();

  const body = extractBody(message.payload) || message.snippet || "";

  return {
    sourceId: `gmail:${message.id}`,
    threadId: message.threadId,
    senderName: sender.name,
    senderEmail: sender.email,
    subject: subject === "" ? "(no subject)" : subject,
    bodyText: body.slice(0, MAX_BODY_CHARS),
    receivedAt,
    labels: message.labelIds ?? [],
  };
}

/**
 * Fetch and normalize the most recent inbox messages. Failures on individual
 * messages are skipped rather than failing the whole sync.
 */
export async function fetchRecentEmails(accessToken: string, maxResults = 25): Promise<RawEmail[]> {
  const ids = await listRecentMessageIds(accessToken, maxResults);
  const messages = await Promise.all(
    ids.map((id) =>
      getMessage(accessToken, id)
        .then(normalizeGmailMessage)
        .catch(() => null),
    ),
  );
  return messages.filter((m): m is RawEmail => m !== null);
}
