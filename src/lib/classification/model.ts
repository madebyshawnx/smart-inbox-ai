/**
 * Single source of truth for the classification model.
 *
 * Lives in its own tiny module so both classify.ts (which stamps the stored
 * `model_version`) and anthropic-client.ts (which makes the actual call) import
 * the SAME value — the stored model_version can never drift from the model the
 * request was sent to. Keeping it separate also avoids a circular import between
 * classify.ts and anthropic-client.ts.
 *
 * Defaults to Haiku — classification is a structured, low-creativity task that
 * Haiku handles well at a fraction of Sonnet's cost. Override with
 * CLASSIFICATION_MODEL when a different model is wanted.
 */
export const CLASSIFICATION_MODEL = process.env.CLASSIFICATION_MODEL ?? "claude-haiku-4-5";
