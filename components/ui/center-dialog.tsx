"use client";

import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";

/**
 * The centred create/edit popup shared by the module route groups.
 *
 * Modelled on the WMS New Task dialog (components/tasks/new-task-dialog.tsx):
 * blurred overlay, gradient stripe across the top, title + lede in the header,
 * scrolling body, actions pinned in a footer.
 *
 * Radix rather than a hand-rolled panel because it brings focus trapping,
 * focus restore on close, `aria-modal` and Escape handling — all of which a
 * form popup needs and none of which come free otherwise.
 *
 * `accentBar` is the only thing a module varies, so the popup reads as part of
 * whichever module opened it without each one owning a copy of this file.
 */
export function CenterDialog({
  open,
  title,
  subtitle,
  onClose,
  children,
  footer,
  width = 620,
  accentBar,
}: {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  footer?: React.ReactNode;
  width?: number;
  accentBar: string;
}) {
  return (
    <Dialog.Root open={open} onOpenChange={(v) => !v && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay
          className="fixed inset-0 z-[60]"
          style={{ background: "rgba(15, 23, 42, 0.45)", backdropFilter: "blur(4px)" }}
        />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-[70] -translate-x-1/2 -translate-y-1/2 rounded-section border border-hairline bg-surface-card shadow-xl overflow-hidden flex flex-col"
          style={{
            width: `min(${width}px, calc(100vw - 32px))`,
            maxHeight: "calc(100vh - 48px)",
          }}
        >
          <header
            className="relative shrink-0 px-8 py-6 max-md:px-5 max-md:py-5"
            style={{ borderBottom: "1px solid var(--color-hairline)" }}
          >
            <span
              aria-hidden
              className="absolute inset-x-0 top-0"
              style={{ height: 5, background: accentBar }}
            />
            <Dialog.Title
              className="text-ink-strong pr-12"
              style={{
                fontFamily: "var(--font-display), system-ui, sans-serif",
                fontWeight: 900,
                fontSize: "clamp(22px, 2.2vw, 28px)",
                letterSpacing: "-0.02em",
                lineHeight: 1.1,
              }}
            >
              {title}
            </Dialog.Title>
            {subtitle && (
              <Dialog.Description className="mt-1.5 text-ink-muted pr-12" style={{ fontSize: 13.5 }}>
                {subtitle}
              </Dialog.Description>
            )}
            <Dialog.Close asChild>
              <button
                type="button"
                aria-label="Close"
                className="absolute top-5 right-5 inline-flex items-center justify-center rounded-full transition-colors hover:bg-surface-soft"
                style={{
                  width: 40,
                  height: 40,
                  border: "1px solid var(--color-hairline)",
                  background: "#ffffff",
                  color: "var(--color-ink-muted)",
                }}
              >
                <X size={18} strokeWidth={2.4} />
              </button>
            </Dialog.Close>
          </header>

          <div className="flex-1 min-h-0 overflow-y-auto px-8 py-6 max-md:px-5 max-md:py-5">
            {children}
          </div>

          {footer && (
            <footer
              className="shrink-0 px-8 py-4 flex items-center justify-end gap-2.5 max-md:px-5"
              style={{ borderTop: "1px solid var(--color-hairline)" }}
            >
              {footer}
            </footer>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
