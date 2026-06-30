import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "@/lib/utils";

/**
 * App-themed Button primitive (shadcn pattern, wired to this project's design
 * tokens rather than a parallel shadcn palette). `asChild` renders the styles
 * onto a child element (e.g. a Next.js Link) via Radix Slot.
 */
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-[var(--radius-md)] text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:pointer-events-none disabled:opacity-60 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary:
          "bg-[var(--accent)] text-white shadow-[var(--shadow-sm)] hover:bg-[var(--accent-hover)]",
        outline:
          "border border-[var(--hairline)] text-[var(--ink-700)] hover:border-[var(--accent)] hover:text-[var(--accent)]",
        ghost: "text-[var(--ink-700)] hover:bg-[var(--surface-sunken)] hover:text-[var(--ink-900)]",
        destructive:
          "border border-[var(--priority-high)] text-[var(--priority-high)] hover:bg-[var(--priority-high-soft)]",
      },
      size: {
        sm: "h-8 px-3 text-xs",
        md: "h-9 px-4",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  };

export function Button({ className, variant, size, asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

export { buttonVariants };
