import { describe, expect, it, vi } from "vitest";
import { extractGmailMessageId } from "../../src/lib/email-actions";
import {
  archiveMessage,
  buildRawReplyMessage,
  createReplyDraft,
  type FetchFn,
  fetchUnsubscribeInfo,
  performOneClickUnsubscribe,
  unarchiveMessage,
} from "../../src/lib/google/gmail-actions";
import { GMAIL_WRITE_SCOPES, hasWriteScopes } from "../../src/lib/google/oauth";

const READONLY = "https://www.googleapis.com/auth/gmail.readonly";
const MODIFY = "https://www.googleapis.com/auth/gmail.modify";
const COMPOSE = "https://www.googleapis.com/auth/gmail.compose";

describe("hasWriteScopes", () => {
  it("is true only when BOTH write scopes are present", () => {
    expect(hasWriteScopes(`${READONLY} ${MODIFY} ${COMPOSE}`)).toBe(true);
  });

  it("is false when only one write scope is present", () => {
    expect(hasWriteScopes(`${READONLY} ${MODIFY}`)).toBe(false);
    expect(hasWriteScopes(`${READONLY} ${COMPOSE}`)).toBe(false);
  });

  it("is false for a readonly-only (legacy) grant", () => {
    expect(hasWriteScopes(READONLY)).toBe(false);
  });

  it("is false for an empty scope string", () => {
    expect(hasWriteScopes("")).toBe(false);
    expect(hasWriteScopes("   ")).toBe(false);
  });

  it("tolerates extra whitespace between scopes", () => {
    expect(hasWriteScopes(`  ${MODIFY}   ${COMPOSE}  `)).toBe(true);
  });

  it("exposes exactly the two write scopes as the constant", () => {
    expect(GMAIL_WRITE_SCOPES).toEqual([MODIFY, COMPOSE]);
  });
});

describe("extractGmailMessageId", () => {
  it("strips the gmail: prefix", () => {
    expect(extractGmailMessageId("gmail:abc123")).toBe("abc123");
  });

  it("returns null for a non-gmail sourceId", () => {
    expect(extractGmailMessageId("sample:1")).toBeNull();
    expect(extractGmailMessageId("abc123")).toBeNull();
  });

  it("returns null for an empty gmail id", () => {
    expect(extractGmailMessageId("gmail:")).toBeNull();
  });
});

function okJson(payload: unknown): FetchFn {
  return vi.fn(
    async () => new Response(JSON.stringify(payload), { status: 200 }),
  ) as unknown as FetchFn;
}

describe("archiveMessage / unarchiveMessage", () => {
  it("archive removes the INBOX label via messages.modify", async () => {
    const fetchFn = okJson({ id: "m1" });
    await archiveMessage("token-x", "m1", fetchFn);

    const mock = fetchFn as unknown as ReturnType<typeof vi.fn>;
    const [url, init] = mock.mock.calls[0];
    expect(url).toContain("/messages/m1/modify");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ removeLabelIds: ["INBOX"] });
    // Never trashes/deletes.
    expect(url).not.toContain("/trash");
    expect(url).not.toContain("/delete");
  });

  it("unarchive adds the INBOX label back (undo)", async () => {
    const fetchFn = okJson({ id: "m1" });
    await unarchiveMessage("token-x", "m1", fetchFn);

    const mock = fetchFn as unknown as ReturnType<typeof vi.fn>;
    const [, init] = mock.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({ addLabelIds: ["INBOX"] });
  });

  it("throws (status only, no token leak) on a Gmail error", async () => {
    const fetchFn = vi.fn(async () => new Response("nope", { status: 403 })) as unknown as FetchFn;
    await expect(archiveMessage("secret-token", "m1", fetchFn)).rejects.toThrow(/403/);
    await expect(archiveMessage("secret-token", "m1", fetchFn)).rejects.not.toThrow(/secret-token/);
  });
});

describe("buildRawReplyMessage", () => {
  it("builds an RFC822 message with To/Subject and threading headers", () => {
    const encoded = buildRawReplyMessage({
      threadId: "t1",
      to: "rachel@example.com",
      subject: "Re: Q2 budget",
      bodyText: "Sending now.",
      inReplyToMessageId: "m1",
    });
    const decoded = Buffer.from(encoded, "base64url").toString("utf8");
    expect(decoded).toContain("To: rachel@example.com");
    expect(decoded).toContain("Subject: Re: Q2 budget");
    expect(decoded).toContain("In-Reply-To: m1");
    expect(decoded).toContain("References: m1");
    expect(decoded).toContain("Sending now.");
    // Headers separated from body by a blank line.
    expect(decoded).toContain("\r\n\r\n");
  });

  it("omits threading headers when no source message id is given", () => {
    const encoded = buildRawReplyMessage({
      threadId: null,
      to: "x@y.com",
      subject: "Re: Hi",
      bodyText: "Hello",
    });
    const decoded = Buffer.from(encoded, "base64url").toString("utf8");
    expect(decoded).not.toContain("In-Reply-To");
    expect(decoded).not.toContain("References");
  });
});

describe("createReplyDraft", () => {
  it("uses drafts.create (NEVER send) and includes threadId", async () => {
    const fetchFn = okJson({ id: "draft-1", message: { id: "msg-1" } });
    const result = await createReplyDraft(
      "token-x",
      {
        threadId: "t1",
        to: "rachel@example.com",
        subject: "Re: Q2 budget",
        bodyText: "On it.",
        inReplyToMessageId: "m1",
      },
      fetchFn,
    );

    expect(result).toEqual({ draftId: "draft-1", messageId: "msg-1" });

    const mock = fetchFn as unknown as ReturnType<typeof vi.fn>;
    const [url, init] = mock.mock.calls[0];
    // Drafts endpoint only — no send anywhere.
    expect(url).toContain("/drafts");
    expect(url).not.toContain("/send");
    const parsed = JSON.parse(init.body);
    expect(parsed.message.threadId).toBe("t1");
    expect(typeof parsed.message.raw).toBe("string");
  });

  it("throws when Google returns no draft id", async () => {
    const fetchFn = okJson({ message: { id: "msg-1" } });
    await expect(
      createReplyDraft(
        "token-x",
        { threadId: null, to: "a@b.com", subject: "Re", bodyText: "hi" },
        fetchFn,
      ),
    ).rejects.toThrow(/draft id/);
  });
});

describe("fetchUnsubscribeInfo", () => {
  it("requests the List-Unsubscribe headers via metadata format (read-only)", async () => {
    const fetchFn = okJson({
      payload: {
        headers: [
          { name: "List-Unsubscribe", value: "<https://ex.com/u>, <mailto:x@ex.com>" },
          { name: "List-Unsubscribe-Post", value: "List-Unsubscribe=One-Click" },
        ],
      },
    });

    const info = await fetchUnsubscribeInfo("token-x", "m1", fetchFn);

    const mock = fetchFn as unknown as ReturnType<typeof vi.fn>;
    const [url, init] = mock.mock.calls[0];
    expect(url).toContain("/messages/m1");
    expect(url).toContain("format=metadata");
    expect(url).toContain("metadataHeaders=List-Unsubscribe");
    expect(url).toContain("metadataHeaders=List-Unsubscribe-Post");
    // Read-only: no POST, no modify/trash.
    expect(init?.method ?? "GET").toBe("GET");
    expect(url).not.toContain("/modify");

    expect(info).toEqual({
      httpsUrl: "https://ex.com/u",
      mailto: "x@ex.com",
      oneClick: true,
    });
  });

  it("returns mailto-only (not one-click) when no https URL is present", async () => {
    const fetchFn = okJson({
      payload: { headers: [{ name: "List-Unsubscribe", value: "<mailto:x@ex.com>" }] },
    });
    const info = await fetchUnsubscribeInfo("token-x", "m1", fetchFn);
    expect(info).toEqual({ httpsUrl: null, mailto: "x@ex.com", oneClick: false });
  });

  it("throws (status only, no token leak) on a Gmail error", async () => {
    const fetchFn = vi.fn(async () => new Response("nope", { status: 401 })) as unknown as FetchFn;
    await expect(fetchUnsubscribeInfo("secret-token", "m1", fetchFn)).rejects.toThrow(/401/);
    await expect(fetchUnsubscribeInfo("secret-token", "m1", fetchFn)).rejects.not.toThrow(
      /secret-token/,
    );
  });
});

describe("performOneClickUnsubscribe", () => {
  it("POSTs the RFC 8058 one-click body to the https URL (never sends email)", async () => {
    const fetchFn = vi.fn(async () => new Response("", { status: 200 })) as unknown as FetchFn;
    await performOneClickUnsubscribe("https://ex.com/u?id=1", fetchFn);

    const mock = fetchFn as unknown as ReturnType<typeof vi.fn>;
    const [url, init] = mock.mock.calls[0];
    expect(url).toBe("https://ex.com/u?id=1");
    expect(init.method).toBe("POST");
    expect(init.body).toBe("List-Unsubscribe=One-Click");
    expect(init.headers["Content-Type"]).toBe("application/x-www-form-urlencoded");
  });

  it("refuses to POST a non-https URL", async () => {
    const fetchFn = vi.fn() as unknown as FetchFn;
    await expect(performOneClickUnsubscribe("http://ex.com/u", fetchFn)).rejects.toThrow(/https/);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("throws (status only) when the endpoint rejects", async () => {
    const fetchFn = vi.fn(async () => new Response("no", { status: 500 })) as unknown as FetchFn;
    await expect(performOneClickUnsubscribe("https://ex.com/u", fetchFn)).rejects.toThrow(/500/);
  });
});
