/**
 * Pure mapping from onboarding questionnaire answers to Smart Rules.
 *
 * The questionnaire asks a handful of plain-English questions; this module turns
 * each non-empty answer into one or more concrete `{ ruleText, priorityWeight }`
 * rules that the existing Smart Rules engine understands. Keeping it pure (no
 * Prisma, no fetch) makes the answer→rule logic trivially unit-testable and lets
 * both the client component and an API route share a single source of truth.
 */

import { MAX_RULE_TEXT_LENGTH } from "@/lib/rules";

// The free-text answers collected by the questionnaire. Every field is optional
// — the user can skip any question — so each is a (possibly empty) string.
export type OnboardingAnswers = {
  // "Who should always be prioritized?" (names / emails)
  alwaysPrioritize?: string;
  // "Which senders or domains are low priority?"
  lowPriority?: string;
  // "What topics are high-stakes for you?" (invoices, contracts, renewals…)
  highStakesTopics?: string;
  // "What should go straight to Read Later?" (newsletters, promotions…)
  readLater?: string;
  // "What should never be ignored?"
  neverIgnore?: string;
};

export type RuleDraft = {
  ruleText: string;
  priorityWeight: number;
};

// Priority weights per question, matching the product spec.
const WEIGHT_ALWAYS_PRIORITIZE = 100;
const WEIGHT_LOW_PRIORITY = -100;
const WEIGHT_HIGH_STAKES = 50;
const WEIGHT_READ_LATER = 0;
const WEIGHT_NEVER_IGNORE = 50;

/**
 * Split a free-text answer into individual items. Users naturally separate
 * multiple entries with commas (and sometimes newlines or semicolons), so we
 * split on those, trim each piece, and drop blanks. An answer with no real
 * content yields an empty array.
 */
function splitItems(raw: string | undefined): string[] {
  if (typeof raw !== "string") {
    return [];
  }
  return raw
    .split(/[,;\n]+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

/**
 * Build one rule per item, skipping any rule whose text would exceed the engine's
 * max length (so a pathological answer can never produce an unstorable rule).
 */
function rulesForItems(
  items: string[],
  toText: (item: string) => string,
  priorityWeight: number,
): RuleDraft[] {
  const drafts: RuleDraft[] = [];
  for (const item of items) {
    const ruleText = toText(item);
    if (ruleText.length > 0 && ruleText.length <= MAX_RULE_TEXT_LENGTH) {
      drafts.push({ ruleText, priorityWeight });
    }
  }
  return drafts;
}

/**
 * Convert questionnaire answers into a flat list of rule drafts.
 *
 * Comma-separated lists become separate rules where it reads naturally (senders,
 * low-priority sources, read-later sources). The two "topic bundle" questions —
 * high-stakes topics and never-ignore — read better as a single combined rule,
 * so their items are re-joined into one human sentence. Empty answers contribute
 * nothing.
 */
export function buildRulesFromAnswers(answers: OnboardingAnswers): RuleDraft[] {
  const drafts: RuleDraft[] = [];

  // 1. Always prioritize — one rule per sender/name.
  drafts.push(
    ...rulesForItems(
      splitItems(answers.alwaysPrioritize),
      (item) => `Always prioritize emails from ${item}.`,
      WEIGHT_ALWAYS_PRIORITIZE,
    ),
  );

  // 2. Low priority — one rule per sender/domain.
  drafts.push(
    ...rulesForItems(
      splitItems(answers.lowPriority),
      (item) => `Treat emails from ${item} as low priority.`,
      WEIGHT_LOW_PRIORITY,
    ),
  );

  // 3. High-stakes topics — a single combined rule listing the topics.
  const topics = splitItems(answers.highStakesTopics);
  if (topics.length > 0) {
    const ruleText = `Flag anything about ${joinList(topics)} as important.`;
    if (ruleText.length <= MAX_RULE_TEXT_LENGTH) {
      drafts.push({ ruleText, priorityWeight: WEIGHT_HIGH_STAKES });
    }
  }

  // 4. Read Later — one rule per source so each can be toggled independently.
  drafts.push(
    ...rulesForItems(
      splitItems(answers.readLater),
      (item) => `Put ${item} into Read Later.`,
      WEIGHT_READ_LATER,
    ),
  );

  // 5. Never ignore — a single combined rule.
  const neverIgnore = splitItems(answers.neverIgnore);
  if (neverIgnore.length > 0) {
    const ruleText = `Never mark ${joinList(neverIgnore)} as safe to ignore.`;
    if (ruleText.length <= MAX_RULE_TEXT_LENGTH) {
      drafts.push({ ruleText, priorityWeight: WEIGHT_NEVER_IGNORE });
    }
  }

  return drafts;
}

/**
 * Join a list of items into a natural English fragment:
 * ["a"] -> "a", ["a","b"] -> "a and b", ["a","b","c"] -> "a, b, and c".
 */
function joinList(items: string[]): string {
  if (items.length === 1) {
    return items[0];
  }
  if (items.length === 2) {
    return `${items[0]} and ${items[1]}`;
  }
  const head = items.slice(0, -1).join(", ");
  const tail = items[items.length - 1];
  return `${head}, and ${tail}`;
}
