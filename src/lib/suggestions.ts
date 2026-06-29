import type { PrismaClient } from "@prisma/client";
import { loadClassifiedEmails } from "./persistence";
import { listRules } from "./rules";

/**
 * Behavioral-learning suggestions.
 *
 * The user's own Gmail handling (read/starred/important labels) plus our
 * classifications are turned into *proposed* Smart Rules. These are NEVER
 * auto-applied — they surface as user-approved suggestions in Settings.
 *
 * Like the rest of the lib layer, the Prisma client is injected so this is
 * trivially unit-testable without a database, and the computation is kept
 * deterministic (no Date.now / Math.random).
 */

// Mirror the sender-rule wording/weights the feedback loop uses (see
// {@link ./feedback.ts}) so a suggestion the user accepts dedupes cleanly
// against a rule that loop may already have created.
const PRIORITIZE_SENDER_WEIGHT = 100;
const IGNORE_SENDER_WEIGHT = -100;

// A sender needs at least this many Gmail-sourced emails (gmailLabels non-null)
// before we trust a behavioral pattern. Fixtures (null labels) never qualify.
const MIN_SIGNAL_EMAILS = 2;

// At most this many suggestions are surfaced at once to avoid clutter.
const MAX_SUGGESTIONS = 5;

export type Suggestion = {
  signature: string;
  ruleText: string;
  reason: string;
  priorityWeight: number;
};

export type ParsedLabels = {
  isRead: boolean;
  isStarred: boolean;
  isImportant: boolean;
};

/**
 * Parse a Gmail `gmailLabels` JSON string into the behavioral signals we care
 * about. Returns null for absent/invalid label data (e.g. sample fixtures),
 * which the caller treats as "no signal".
 */
export function parseLabels(gmailLabels: string | null): ParsedLabels | null {
  if (gmailLabels === null) {
    return null;
  }

  let labels: unknown;
  try {
    labels = JSON.parse(gmailLabels);
  } catch {
    return null;
  }

  if (!Array.isArray(labels)) {
    return null;
  }

  const ids = labels.filter((value): value is string => typeof value === "string");
  return {
    isRead: !ids.includes("UNREAD"),
    isStarred: ids.includes("STARRED"),
    isImportant: ids.includes("IMPORTANT"),
  };
}

// Match feedback.ts's describeSender: "Name (email)" when a name is present,
// otherwise just the email. Keeps suggestion ruleText byte-identical to the
// rule the feedback loop would create for the same sender.
function describeSender(senderName: string, senderEmail: string): string {
  const name = senderName.trim();
  return name === "" ? senderEmail : `${name} (${senderEmail})`;
}

function prioritizeRuleText(sender: string): string {
  return `Always prioritize emails from ${sender}.`;
}

function ignoreRuleText(sender: string): string {
  return `Treat emails from ${sender} as low priority unless they are clearly urgent.`;
}

type SenderGroup = {
  senderName: string;
  senderEmail: string;
  signals: ParsedLabels[];
  lowOrIgnoreCount: number;
  total: number;
};

const LOW_PRIORITY_LEVELS = new Set(["low", "ignore"]);

/**
 * Compute behavioral suggestions from how the user handles their inbox.
 *
 * Senders are grouped by email; only Gmail-sourced emails (parsed labels)
 * contribute signal, and a sender needs >= {@link MIN_SIGNAL_EMAILS} of them.
 * Prioritize-suggestions sort before ignore-suggestions, capped at
 * {@link MAX_SUGGESTIONS}. Suggestions already covered by an active rule or
 * previously dismissed are excluded.
 */
export async function computeSuggestions(db: PrismaClient): Promise<Suggestion[]> {
  const rows = await loadClassifiedEmails(db);

  const groups = new Map<string, SenderGroup>();
  for (const { message, classification } of rows) {
    const parsed = parseLabels(message.gmailLabels);
    if (parsed === null) {
      // Fixtures / non-Gmail emails carry no behavioral signal.
      continue;
    }

    let group = groups.get(message.senderEmail);
    if (group === undefined) {
      group = {
        senderName: message.senderName,
        senderEmail: message.senderEmail,
        signals: [],
        lowOrIgnoreCount: 0,
        total: 0,
      };
      groups.set(message.senderEmail, group);
    }

    group.signals.push(parsed);
    group.total += 1;
    if (LOW_PRIORITY_LEVELS.has(classification.priorityLevel)) {
      group.lowOrIgnoreCount += 1;
    }
  }

  const prioritize: Suggestion[] = [];
  const ignore: Suggestion[] = [];

  // Iterate over a stable, sorted key order so output is deterministic.
  const sortedEmails = [...groups.keys()].sort();
  for (const email of sortedEmails) {
    const group = groups.get(email);
    if (group === undefined || group.signals.length < MIN_SIGNAL_EMAILS) {
      continue;
    }

    const sender = describeSender(group.senderName, group.senderEmail);
    const starredOrImportant = group.signals.filter(
      (signal) => signal.isStarred || signal.isImportant,
    ).length;

    if (starredOrImportant >= MIN_SIGNAL_EMAILS) {
      const ruleText = prioritizeRuleText(sender);
      prioritize.push({
        signature: ruleText,
        ruleText,
        reason: `You've starred/flagged ${starredOrImportant} emails from ${group.senderName.trim() || group.senderEmail}.`,
        priorityWeight: PRIORITIZE_SENDER_WEIGHT,
      });
      continue;
    }

    const allRead = group.signals.every((signal) => signal.isRead);
    const noneStarred = group.signals.every((signal) => !signal.isStarred);
    const noneImportant = group.signals.every((signal) => !signal.isImportant);
    const predominantlyLow = group.lowOrIgnoreCount >= MIN_SIGNAL_EMAILS;

    if (allRead && noneStarred && noneImportant && predominantlyLow) {
      const ruleText = ignoreRuleText(sender);
      ignore.push({
        signature: ruleText,
        ruleText,
        reason: `You've read and never starred the last ${group.signals.length} emails from ${group.senderName.trim() || group.senderEmail}.`,
        priorityWeight: IGNORE_SENDER_WEIGHT,
      });
    }
  }

  const ordered = [...prioritize, ...ignore];

  // DEDUPE against existing active rules and previously dismissed suggestions.
  const activeRules = await listRules(db);
  const activeRuleTexts = new Set(activeRules.map((rule) => rule.ruleText));

  const dismissed = await db.dismissedSuggestion.findMany({ select: { signature: true } });
  const dismissedSignatures = new Set(dismissed.map((row) => row.signature));

  const filtered = ordered.filter(
    (suggestion) =>
      !activeRuleTexts.has(suggestion.ruleText) && !dismissedSignatures.has(suggestion.signature),
  );

  return filtered.slice(0, MAX_SUGGESTIONS);
}
