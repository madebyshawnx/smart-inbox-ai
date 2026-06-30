"use client";

import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import type * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Token-themed DropdownMenu on Radix — accessible keyboard nav, focus, and
 * dismissal out of the box (replaces hand-rolled popovers). Animated via
 * tw-animate-css.
 */
export const DropdownMenu = DropdownMenuPrimitive.Root;
export const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;

export function DropdownMenuContent({
  className,
  sideOffset = 6,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Content>) {
  return (
    <DropdownMenuPrimitive.Portal>
      <DropdownMenuPrimitive.Content
        sideOffset={sideOffset}
        className={cn(
          "z-50 min-w-52 overflow-hidden rounded-[var(--radius-md)] border border-[var(--hairline)] bg-[var(--surface-raised)] p-1 shadow-[var(--shadow-lg)] data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
          className,
        )}
        {...props}
      />
    </DropdownMenuPrimitive.Portal>
  );
}

export function DropdownMenuItem({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Item>) {
  return (
    <DropdownMenuPrimitive.Item
      className={cn(
        "flex cursor-pointer items-center gap-2 rounded-[var(--radius-sm)] px-2.5 py-2 text-sm text-[var(--ink-700)] outline-none transition-colors data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[highlighted]:bg-[var(--accent-soft)] data-[highlighted]:text-[var(--ink-900)]",
        className,
      )}
      {...props}
    />
  );
}

export function DropdownMenuLabel({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Label>) {
  return <DropdownMenuPrimitive.Label className={cn("px-2.5 py-1.5", className)} {...props} />;
}

export function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return (
    <DropdownMenuPrimitive.Separator
      className={cn("-mx-1 my-1 h-px bg-[var(--hairline)]", className)}
      {...props}
    />
  );
}
