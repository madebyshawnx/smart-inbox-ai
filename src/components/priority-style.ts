/**
 * Maps a free-form priority string onto one of four tasteful visual tiers.
 * Centralized so every card/chip color-codes priority the same way.
 */
export type PriorityTier = "high" | "medium" | "low" | "ignore";

export function resolvePriorityTier(priorityLevel: string): PriorityTier {
  const value = priorityLevel.toLowerCase();
  if (value.includes("ignore")) {
    return "ignore";
  }
  if (value.includes("high") || value.includes("urgent") || value.includes("critical")) {
    return "high";
  }
  if (value.includes("low")) {
    return "low";
  }
  return "medium";
}

type TierStyle = {
  /** Accent color CSS var for text/border emphasis. */
  accentVar: string;
  /** Soft background CSS var for the chip fill. */
  softVar: string;
};

const TIER_STYLES: Record<PriorityTier, TierStyle> = {
  high: { accentVar: "var(--priority-high)", softVar: "var(--priority-high-soft)" },
  medium: { accentVar: "var(--priority-medium)", softVar: "var(--priority-medium-soft)" },
  low: { accentVar: "var(--priority-low)", softVar: "var(--priority-low-soft)" },
  ignore: { accentVar: "var(--priority-ignore)", softVar: "var(--priority-ignore-soft)" },
};

export function tierStyle(tier: PriorityTier): TierStyle {
  return TIER_STYLES[tier];
}
