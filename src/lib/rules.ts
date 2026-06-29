import type { PrismaClient } from "@prisma/client";

/**
 * Persistence/business layer for Smart Rules.
 *
 * Every helper takes the Prisma client as its first argument so callers (and
 * tests) can inject a real client or a mock. Like {@link ./persistence.ts},
 * this module deliberately does NOT import the `prisma` singleton — keeping the
 * client dependency-injected makes the functions trivially unit-testable
 * without a database.
 */

// All rules live under a single "Default" priority profile for now. The schema
// supports multiple profiles, but the app surfaces exactly one, resolved by its
// `isDefault` flag rather than by name so a rename can never orphan the rules.
export const DEFAULT_PROFILE_NAME = "Default";

// Plain-English rules are deliberately short — they are injected into the
// classification prompt, so an overlong rule wastes tokens and dilutes intent.
export const MAX_RULE_TEXT_LENGTH = 280;

// The shape consumed by the API/UI layer. Declared explicitly (rather than
// derived from Prisma's generics) so downstream code has a stable contract and
// tests can build plain objects that satisfy it.
export type SmartRuleDTO = {
  id: string;
  ruleText: string;
  isActive: boolean;
  priorityWeight: number;
};

type DefaultProfile = {
  id: string;
  name: string;
  isDefault: boolean;
};

function toDTO(rule: {
  id: string;
  ruleText: string;
  isActive: boolean;
  priorityWeight: number;
}): SmartRuleDTO {
  return {
    id: rule.id,
    ruleText: rule.ruleText,
    isActive: rule.isActive,
    priorityWeight: rule.priorityWeight,
  };
}

// Validate ruleText at the boundary and return the trimmed value. We fail loudly
// rather than silently dropping or truncating so a typo can't quietly persist.
function validateRuleText(ruleText: unknown): string {
  if (typeof ruleText !== "string" || ruleText.trim() === "") {
    throw new Error("ruleText is required");
  }
  const trimmed = ruleText.trim();
  if (trimmed.length > MAX_RULE_TEXT_LENGTH) {
    throw new Error("ruleText too long");
  }
  return trimmed;
}

/**
 * Find the default priority profile, creating it on first use.
 *
 * The profile is resolved by `isDefault = true`, never by name, so the single
 * canonical profile survives a rename. When none exists we create one with the
 * {@link DEFAULT_PROFILE_NAME} and the default flag set.
 */
export async function getOrCreateDefaultProfile(db: PrismaClient): Promise<DefaultProfile> {
  const existing = await db.priorityProfile.findFirst({
    where: { isDefault: true },
  });

  if (existing !== null && existing !== undefined) {
    return { id: existing.id, name: existing.name, isDefault: existing.isDefault };
  }

  const created = await db.priorityProfile.create({
    data: { name: DEFAULT_PROFILE_NAME, isDefault: true },
  });
  return { id: created.id, name: created.name, isDefault: created.isDefault };
}

/**
 * List every rule under the default profile, oldest first, as DTOs.
 */
export async function listRules(db: PrismaClient): Promise<SmartRuleDTO[]> {
  const profile = await getOrCreateDefaultProfile(db);

  const rules = await db.smartRule.findMany({
    where: { priorityProfileId: profile.id },
    orderBy: { createdAt: "asc" },
  });

  return rules.map(toDTO);
}

export type CreateRuleInput = {
  ruleText: string;
  priorityWeight?: number;
};

/**
 * Create a rule under the default profile. `ruleText` is validated (non-empty
 * after trim, at most {@link MAX_RULE_TEXT_LENGTH} chars) before any write.
 */
export async function createRule(db: PrismaClient, input: CreateRuleInput): Promise<SmartRuleDTO> {
  const ruleText = validateRuleText(input.ruleText);
  const profile = await getOrCreateDefaultProfile(db);

  const created = await db.smartRule.create({
    data: {
      priorityProfileId: profile.id,
      ruleText,
      isActive: true,
      priorityWeight: input.priorityWeight ?? 0,
    },
  });

  return toDTO(created);
}

export type EnsureRuleInput = {
  ruleText: string;
  priorityWeight?: number;
};

/**
 * Create a rule only if no active rule with the same text already exists under
 * the default profile. Used by the feedback loop so repeatedly clicking e.g.
 * "Always prioritize this sender" does not pile up duplicate rules.
 *
 * @returns `created: false` with the existing rule when a match is found.
 */
export async function ensureActiveRule(
  db: PrismaClient,
  input: EnsureRuleInput,
): Promise<{ created: boolean; rule: SmartRuleDTO }> {
  const ruleText = validateRuleText(input.ruleText);
  const profile = await getOrCreateDefaultProfile(db);

  const existing = await db.smartRule.findFirst({
    where: { priorityProfileId: profile.id, ruleText, isActive: true },
  });
  if (existing !== null && existing !== undefined) {
    return { created: false, rule: toDTO(existing) };
  }

  const created = await db.smartRule.create({
    data: {
      priorityProfileId: profile.id,
      ruleText,
      isActive: true,
      priorityWeight: input.priorityWeight ?? 0,
    },
  });
  return { created: true, rule: toDTO(created) };
}

export type UpdateRulePatch = {
  ruleText?: string;
  isActive?: boolean;
  priorityWeight?: number;
};

/**
 * Update only the provided fields of a rule. When `ruleText` is present it must
 * pass the same validation as {@link createRule}.
 */
export async function updateRule(
  db: PrismaClient,
  id: string,
  patch: UpdateRulePatch,
): Promise<SmartRuleDTO> {
  const data: { ruleText?: string; isActive?: boolean; priorityWeight?: number } = {};

  if (patch.ruleText !== undefined) {
    data.ruleText = validateRuleText(patch.ruleText);
  }
  if (patch.isActive !== undefined) {
    data.isActive = patch.isActive;
  }
  if (patch.priorityWeight !== undefined) {
    data.priorityWeight = patch.priorityWeight;
  }

  const updated = await db.smartRule.update({
    where: { id },
    data,
  });

  return toDTO(updated);
}

/**
 * Delete a rule by id.
 */
export async function deleteRule(db: PrismaClient, id: string): Promise<void> {
  await db.smartRule.delete({ where: { id } });
}

/**
 * Return the `ruleText` of every active rule under the default profile, ordered
 * by `priorityWeight` desc then `createdAt` asc. This is the array the classify
 * pipeline passes to `classifyEmail(email, client, { rules })`.
 */
export async function loadActiveRuleTexts(db: PrismaClient): Promise<string[]> {
  const profile = await getOrCreateDefaultProfile(db);

  const rules = await db.smartRule.findMany({
    where: { priorityProfileId: profile.id, isActive: true },
    orderBy: [{ priorityWeight: "desc" }, { createdAt: "asc" }],
  });

  return rules.map((rule) => rule.ruleText);
}
