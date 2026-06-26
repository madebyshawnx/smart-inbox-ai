import { z } from "zod";

const senderSchema = z.object({
  name: z.string(),
  email: z.string().email(),
});

export const emailClassificationSchema = z.object({
  email_id: z.string().min(1),
  thread_id: z.string().min(1),
  sender: senderSchema,
  subject: z.string().min(1),
  summary: z.string().min(1),
  priority_level: z.enum(["high", "medium", "low", "ignore"]),
  urgency_level: z.enum(["urgent", "soon", "later", "none"]),
  // Scores are bounded 0-100: values outside this range indicate model hallucination
  importance_score: z.number().int().min(0).max(100),
  confidence_score: z.number().int().min(0).max(100),
  category: z.string().min(1),
  subcategory: z
    .string()
    .nullish()
    .transform((v) => v ?? null),
  detected_deadline: z
    .string()
    .nullish()
    .transform((v) => v ?? null),
  requires_response: z.boolean(),
  requires_decision: z.boolean(),
  requires_payment: z.boolean(),
  requires_scheduling: z.boolean(),
  needs_follow_up: z.boolean(),
  waiting_on_reply: z.boolean(),
  recommended_next_step: z.string().min(1),
  why_this_matters: z.string().min(1),
  risk_if_ignored: z
    .string()
    .nullish()
    .transform((v) => v ?? null),
  suggested_bucket: z.enum([
    "daily_brief",
    "needs_attention",
    "follow_up_today",
    "waiting_on_reply",
    "deadlines",
    "money_or_account_related",
    "read_later",
    "low_priority",
    "safe_to_ignore",
    "needs_review",
  ]),
  safe_to_ignore: z.boolean(),
  model_version: z.string().min(1),
});

export type EmailClassification = z.infer<typeof emailClassificationSchema>;

export function parseClassification(
  raw: unknown,
): { success: true; data: EmailClassification } | { success: false; error: string } {
  const result = emailClassificationSchema.safeParse(raw);
  if (result.success) {
    return { success: true, data: result.data };
  }
  const issues = result.error.issues
    .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
    .join("; ");
  return { success: false, error: issues };
}
