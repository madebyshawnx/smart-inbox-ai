import type { PrismaClient } from "@prisma/client";
import { type SaveFeedbackInput, saveFeedback } from "./persistence";
import { ensureActiveRule } from "./rules";

/**
 * The feedback loop: record a user's feedback, and for sender-scoped feedback,
 * derive a trusted Smart Rule so the correction actually changes future triage.
 *
 * Per the master prompt, v1 "learning" is explicit rules, not a model — so
 * "always prioritize this sender" becomes a concrete, user-visible rule rather
 * than an opaque weight.
 */

// Sender rules carry strong weights so they sort to the top (or bottom) of the
// rule list the classifier sees, without being absolute overrides.
const PRIORITIZE_SENDER_WEIGHT = 100;
const IGNORE_SENDER_WEIGHT = -100;

export type ApplyFeedbackResult = {
  // Whether a new Smart Rule was created from this feedback (false if the
  // feedback isn't sender-scoped, the rule already existed, or the email is gone).
  ruleCreated: boolean;
  ruleText: string | null;
  // The sender the feedback was given against, when the email could be resolved.
  // Lets the caller trigger a targeted re-classification of that sender's stored
  // mail so the correction visibly takes effect. Null when the email is gone.
  senderEmail: string | null;
};

function describeSender(senderName: string, senderEmail: string): string {
  const name = senderName.trim();
  return name === "" ? senderEmail : `${name} (${senderEmail})`;
}

export async function applyFeedback(
  db: PrismaClient,
  input: SaveFeedbackInput,
): Promise<ApplyFeedbackResult> {
  // Always record the raw feedback first (validates the type, throws on unknown).
  await saveFeedback(db, input);

  // Resolve the sender for every feedback type — not just sender rules. Even
  // corrective feedback (mark_urgent, safe_to_ignore, …) is attributed to a
  // sender so the caller can re-classify that sender's stored mail and the
  // feedback-summary guidance can take effect on the next pass.
  const email = await db.emailMessage.findUnique({
    where: { id: input.emailMessageId },
    select: { senderName: true, senderEmail: true },
  });
  const senderEmail = email?.senderEmail ?? null;

  const isSenderRule =
    input.feedbackType === "always_prioritize_sender" ||
    input.feedbackType === "usually_ignore_sender";
  if (!isSenderRule || email === null || email === undefined) {
    return { ruleCreated: false, ruleText: null, senderEmail };
  }

  const sender = describeSender(email.senderName, email.senderEmail);
  const { ruleText, priorityWeight } =
    input.feedbackType === "always_prioritize_sender"
      ? {
          ruleText: `Always prioritize emails from ${sender}.`,
          priorityWeight: PRIORITIZE_SENDER_WEIGHT,
        }
      : {
          ruleText: `Treat emails from ${sender} as low priority unless they are clearly urgent.`,
          priorityWeight: IGNORE_SENDER_WEIGHT,
        };

  const { created } = await ensureActiveRule(db, { ruleText, priorityWeight });
  return { ruleCreated: created, ruleText, senderEmail };
}
