"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import type * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Centered Modal built on Radix Dialog — accessible by default (focus trap,
 * scroll lock, Escape, focus return, aria-modal) so callers don't hand-roll any
 * of it. Themed with the project's tokens. This is the centered-card counterpart
 * to {@link Sheet} (which slides in from the right); both share Radix Dialog.
 *
 * Usage:
 *   <Modal open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
 *     <ModalContent aria-label="…">…</ModalContent>
 *   </Modal>
 */
export const Modal = DialogPrimitive.Root;
export const ModalTrigger = DialogPrimitive.Trigger;
export const ModalClose = DialogPrimitive.Close;
export const ModalTitle = DialogPrimitive.Title;
export const ModalDescription = DialogPrimitive.Description;

type ModalContentProps = React.ComponentProps<typeof DialogPrimitive.Content> & {
  // Extra classes applied to the scrolling wrapper that positions the card. Lets
  // callers control top padding / vertical alignment (e.g. pt-[12vh]).
  wrapperClassName?: string;
};

export function ModalContent({
  className,
  wrapperClassName,
  children,
  ...props
}: ModalContentProps) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-[60] bg-[oklch(20%_0.02_260_/_0.35)] backdrop-blur-[2px] data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
      <div
        className={cn(
          "fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto px-4 pt-[12vh] pb-[8vh] sm:pt-[16vh]",
          wrapperClassName,
        )}
      >
        <DialogPrimitive.Content
          className={cn(
            "relative flex w-full max-w-xl flex-col overflow-hidden rounded-[var(--radius-card)] border border-[var(--hairline)] bg-[var(--surface-raised)] shadow-[0_24px_64px_-24px_rgba(20,20,40,0.45)] duration-150 data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
            className,
          )}
          {...props}
        >
          {children}
        </DialogPrimitive.Content>
      </div>
    </DialogPrimitive.Portal>
  );
}
