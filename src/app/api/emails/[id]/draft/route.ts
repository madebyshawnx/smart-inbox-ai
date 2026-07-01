import { NextResponse } from "next/server";
import { createAnthropicClient } from "@/lib/classification/anthropic-client";
import { prisma } from "@/lib/db";
import { loadEmailGmailRef } from "@/lib/email-actions";
import { loadSenderFeedbackSummary } from "@/lib/feedback-summary";
import { createReplyDraft } from "@/lib/google/gmail-actions";
import { getAccessToken } from "@/lib/google/tokens";
import { generateReplyDraft, type ReplyDraftEmail } from "@/lib/reply-draft";
import { loadActiveRuleTexts } from "@/lib/rules";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * POST /api/emails/[id]/draft
 *
 * Generates a reply with the LLM, then creates a Gmail DRAFT (never sends). The
 * email body/thread is untrusted and is injection-defended by the reply-draft
 * system prompt (see src/lib/reply-draft.ts). Returns `{ ok: true, draftId }`.
 *
 * Looks up the email + its Gmail message/thread id from the DB, loads the user's
 * trusted rules + per-sender feedback as grounding context, gets a fresh access
 * token, and fails soft with a clear error. No body required.
 */
export async function POST(_request: Request, context: RouteContext): Promise<NextResponse> {
  const { id } = await context.params;

  const email = await loadEmailGmailRef(prisma, id).catch(() => null);
  if (email === null) {
    return NextResponse.json({ error: "Email not found." }, { status: 404 });
  }
  if (email.gmailMessageId === null) {
    return NextResponse.json(
      { error: "This email is not a Gmail message and cannot be replied to." },
      { status: 400 },
    );
  }

  try {
    // Trusted grounding context — never mixed with the untrusted email body.
    const [rules, feedbackSummary] = await Promise.all([
      loadActiveRuleTexts(prisma).catch(() => []),
      loadSenderFeedbackSummary(prisma, email.senderEmail).catch(() => []),
    ]);

    const draftInput: ReplyDraftEmail = {
      senderName: email.senderName,
      senderEmail: email.senderEmail,
      subject: email.subject,
      bodyText: email.bodyText,
      receivedAt: email.receivedAt.toISOString(),
      summary: email.classification?.summary ?? "",
      recommendedNextStep: email.classification?.recommendedNextStep ?? "",
    };

    const draft = await generateReplyDraft(
      draftInput,
      createAnthropicClient(),
      rules,
      feedbackSummary,
    );

    const accessToken = await getAccessToken(prisma);
    const created = await createReplyDraft(accessToken, {
      threadId: email.threadId,
      to: email.senderEmail,
      subject: draft.subject,
      bodyText: draft.body,
      inReplyToMessageId: email.gmailMessageId,
    });

    // Server-side audit only (no persistent audit table this wave). Never log the
    // draft body — it can echo untrusted content.
    console.info(
      `[emails/draft] created draftId=${created.draftId} emailMessageId=${email.id} gmailMessageId=${email.gmailMessageId}`,
    );
    return NextResponse.json({ ok: true, draftId: created.draftId });
  } catch (err) {
    console.error(`[emails/draft] emailMessageId=${email.id} failed:`, err);
    // Never leak the API key/stack. Nudge toward reconnect since a missing write
    // scope (gmail.compose) is the most likely cause.
    return NextResponse.json(
      { error: "Couldn't create a draft reply. Try reconnecting Gmail and retry." },
      { status: 502 },
    );
  }
}
