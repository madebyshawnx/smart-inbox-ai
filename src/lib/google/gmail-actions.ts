/**
 * Gmail WRITE actions for Tier 1 email actions (archive / un-archive / draft
 * reply).
 *
 * HARD SAFETY CONTRACT for this module:
 *  - Archive = users.messages.modify removeLabelIds:["INBOX"]. Un-archive =
 *    addLabelIds:["INBOX"]. We NEVER trash or delete a message — archiving is
 *    fully reversible, which is what makes the undo affordance honest.
 *  - Reply drafting uses ONLY users.drafts.create. There is NO code path here
 *    that calls users.messages.send or users.drafts.send — this app can prepare
 *    a reply for the user to review and send themselves, never send on their
 *    behalf.
 *
 * Every function is small and takes the access token + a `fetch` implementation
 * so it stays pure-ish and unit-testable (inject a fake fetch, assert the exact
 * request shape) without hitting the network or the Google SDK.
 */

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1/users/me";

// Node/Next runtime provides a global fetch; inject it (or a fake) for tests.
export type FetchFn = typeof fetch;

const INBOX_LABEL = "INBOX";

async function gmailPost<T>(
  fetchFn: FetchFn,
  accessToken: string,
  path: string,
  body: unknown,
): Promise<T> {
  const res = await fetchFn(`${GMAIL_API}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    // Never echo the token or full response body — surface status only.
    throw new Error(`Gmail API request failed (${res.status})`);
  }
  return (await res.json()) as T;
}

/**
 * Archive a message: remove the INBOX label via users.messages.modify. This is
 * reversible (see {@link unarchiveMessage}) — nothing is trashed or deleted.
 */
export async function archiveMessage(
  accessToken: string,
  gmailMessageId: string,
  fetchFn: FetchFn = fetch,
): Promise<void> {
  await gmailPost(fetchFn, accessToken, `/messages/${gmailMessageId}/modify`, {
    removeLabelIds: [INBOX_LABEL],
  });
}

/**
 * Un-archive (undo an archive): add the INBOX label back via
 * users.messages.modify. The exact reverse of {@link archiveMessage}.
 */
export async function unarchiveMessage(
  accessToken: string,
  gmailMessageId: string,
  fetchFn: FetchFn = fetch,
): Promise<void> {
  await gmailPost(fetchFn, accessToken, `/messages/${gmailMessageId}/modify`, {
    addLabelIds: [INBOX_LABEL],
  });
}

export type CreateReplyDraftInput = {
  // Gmail thread id so the draft threads under the original conversation.
  threadId: string | null;
  // Recipient address (the original sender).
  to: string;
  // Subject line (typically "Re: <original subject>").
  subject: string;
  // Plain-text reply body produced by the reply-draft generator.
  bodyText: string;
  // Original message id, used for the In-Reply-To / References headers so mail
  // clients thread the reply correctly. Optional.
  inReplyToMessageId?: string | null;
};

export type CreateReplyDraftResult = {
  draftId: string;
  messageId: string | null;
};

/**
 * Build an RFC822 message and base64url-encode it for the Gmail drafts API.
 * Pure and exported so a test can assert the exact wire format (headers,
 * threading, body) without any network.
 */
export function buildRawReplyMessage(input: CreateReplyDraftInput): string {
  const headers: string[] = [
    `To: ${input.to}`,
    `Subject: ${input.subject}`,
    "Content-Type: text/plain; charset=UTF-8",
    "MIME-Version: 1.0",
  ];

  // In-Reply-To / References make standards-compliant clients thread the reply
  // under the original message. Gmail's message ids are opaque, so we wrap them
  // as message-id-shaped tokens; Gmail itself threads via threadId regardless.
  if (input.inReplyToMessageId) {
    headers.push(`In-Reply-To: ${input.inReplyToMessageId}`);
    headers.push(`References: ${input.inReplyToMessageId}`);
  }

  const raw = `${headers.join("\r\n")}\r\n\r\n${input.bodyText}`;
  return Buffer.from(raw, "utf8").toString("base64url");
}

/**
 * Create a Gmail DRAFT reply. Uses ONLY users.drafts.create — never sends. The
 * draft lands in the user's Drafts folder for them to review, edit, and send
 * themselves. Returns the draft id (and message id when Google includes it).
 */
export async function createReplyDraft(
  accessToken: string,
  input: CreateReplyDraftInput,
  fetchFn: FetchFn = fetch,
): Promise<CreateReplyDraftResult> {
  const raw = buildRawReplyMessage(input);

  const message: { raw: string; threadId?: string } = { raw };
  if (input.threadId) {
    message.threadId = input.threadId;
  }

  const result = await gmailPost<{ id?: string; message?: { id?: string } }>(
    fetchFn,
    accessToken,
    "/drafts",
    { message },
  );

  if (!result.id) {
    throw new Error("Gmail drafts.create did not return a draft id");
  }

  return { draftId: result.id, messageId: result.message?.id ?? null };
}
