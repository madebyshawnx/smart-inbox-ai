import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge class names with Tailwind-aware conflict resolution. Standard shadcn/ui
 * helper: `clsx` for conditional joins, `tailwind-merge` so later utilities win
 * over earlier conflicting ones (e.g. `px-2 px-4` → `px-4`).
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
