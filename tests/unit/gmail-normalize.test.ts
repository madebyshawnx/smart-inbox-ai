import { describe, expect, it } from "vitest";
import {
  type GmailMessage,
  type GmailPart,
  normalizeGmailMessage,
  parseSender,
} from "@/lib/google/gmail";

function b64url(s: string): string {
  return Buffer.from(s).toString("base64url");
}

function plainPart(text: string): GmailPart {
  return { mimeType: "text/plain", body: { data: b64url(text) } };
}

describe("parseSender", () => {
  it("parses a display name and address", () => {
    expect(parseSender("Jane Doe <jane@x.com>")).toEqual({
      name: "Jane Doe",
      email: "jane@x.com",
    });
  });

  it("falls back to the address when the display name is empty", () => {
    expect(parseSender("<bob@y.com>")).toEqual({ name: "bob@y.com", email: "bob@y.com" });
  });

  it("treats a bare address as both name and email", () => {
    expect(parseSender("carol@z.com")).toEqual({ name: "carol@z.com", email: "carol@z.com" });
  });

  it("strips surrounding quotes from a quoted display name", () => {
    expect(parseSender('"Smith, John" <j@s.com>')).toEqual({
      name: "Smith, John",
      email: "j@s.com",
    });
  });
});

describe("normalizeGmailMessage", () => {
  it("normalizes headers, a text/plain body, and internalDate", () => {
    const message: GmailMessage = {
      id: "abc123",
      threadId: "thread-xyz",
      internalDate: "1750000000000",
      payload: {
        headers: [
          { name: "From", value: "Jane Doe <jane@x.com>" },
          { name: "Subject", value: "Quarterly update" },
        ],
        parts: [plainPart("Hello body")],
      },
    };

    const raw = normalizeGmailMessage(message);

    expect(raw.sourceId).toBe("gmail:abc123");
    expect(raw.threadId).toBe("thread-xyz");
    expect(raw.senderName).toBe("Jane Doe");
    expect(raw.senderEmail).toBe("jane@x.com");
    expect(raw.subject).toBe("Quarterly update");
    expect(raw.bodyText).toBe("Hello body");
    expect(raw.receivedAt).toBe(new Date(1750000000000).toISOString());
  });

  it("strips tags from a text/html-only body", () => {
    const message: GmailMessage = {
      id: "html-1",
      threadId: "t-1",
      internalDate: "1750000000000",
      payload: {
        headers: [{ name: "From", value: "h@x.com" }],
        parts: [
          {
            mimeType: "text/html",
            body: { data: b64url("<p>Visible <b>content</b> here</p>") },
          },
        ],
      },
    };

    const raw = normalizeGmailMessage(message);

    expect(raw.bodyText).toContain("Visible");
    expect(raw.bodyText).toContain("content");
    expect(raw.bodyText).toContain("here");
    expect(raw.bodyText).not.toContain("<p>");
    expect(raw.bodyText).not.toContain("<b>");
  });

  it("extracts a text/plain part nested deep in a multipart tree", () => {
    const message: GmailMessage = {
      id: "nested-1",
      threadId: "t-2",
      internalDate: "1750000000000",
      payload: {
        mimeType: "multipart/mixed",
        headers: [{ name: "From", value: "n@x.com" }],
        parts: [
          {
            mimeType: "multipart/alternative",
            parts: [
              { mimeType: "text/html", body: { data: b64url("<p>html version</p>") } },
              plainPart("deep plain body"),
            ],
          },
        ],
      },
    };

    const raw = normalizeGmailMessage(message);
    expect(raw.bodyText).toBe("deep plain body");
  });

  it("defaults the subject to (no subject) when the Subject header is missing", () => {
    const message: GmailMessage = {
      id: "no-subj",
      threadId: "t-3",
      internalDate: "1750000000000",
      payload: {
        headers: [{ name: "From", value: "x@x.com" }],
        parts: [plainPart("body")],
      },
    };

    expect(normalizeGmailMessage(message).subject).toBe("(no subject)");
  });

  it("truncates a body longer than 4000 chars to exactly 4000", () => {
    const longBody = "x".repeat(5000);
    const message: GmailMessage = {
      id: "long-1",
      threadId: "t-4",
      internalDate: "1750000000000",
      payload: {
        headers: [{ name: "From", value: "x@x.com" }],
        parts: [plainPart(longBody)],
      },
    };

    expect(normalizeGmailMessage(message).bodyText.length).toBe(4000);
  });

  it("falls back to the snippet when there is no payload", () => {
    const message: GmailMessage = {
      id: "snip-1",
      threadId: "t-5",
      internalDate: "1750000000000",
      snippet: "snippet fallback text",
    };

    const raw = normalizeGmailMessage(message);
    expect(raw.bodyText).toBe("snippet fallback text");
    expect(raw.senderName).toBe("");
    expect(raw.subject).toBe("(no subject)");
  });
});
