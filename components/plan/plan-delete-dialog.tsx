"use client";

import * as React from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Trash2, X } from "lucide-react";
import { getPlanDeleteImpact } from "@/app/(project)/project-plan/actions";
import { TABULAR } from "./theme";

/**
 * Confirm deleting one or more plan rows.
 *
 * A real dialog rather than `window.confirm`: the native one is unstyled, its
 * wording is at the browser's mercy, it announces the HOSTNAME above your
 * message, and on some browsers it can be suppressed entirely with a
 * "don't show me again" tick — which would turn the one destructive action in
 * this table into a single unguarded click.
 *
 * It also states the BLAST RADIUS. Deleting a project takes every milestone,
 * result and action under it, and the tasks those rows are — which come off
 * people's calendars. "Are you sure?" cannot say that; a count can.
 */

interface Props {
  ids: string[];
  /** Shown when a single row is being deleted. */
  name?: string;
  onCancel: () => void;
  onConfirm: () => void;
  pending?: boolean;
}

export function PlanDeleteDialog({ ids, name, onCancel, onConfirm, pending }: Props) {
  const [impact, setImpact] = React.useState<{ nodes: number; tasks: number } | null>(null);
  const cancelRef = React.useRef<HTMLButtonElement>(null);

  // Cancel is focused on open, so the safe answer is the one you get by reflex.
  React.useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  React.useEffect(() => {
    let live = true;
    void Promise.all(ids.map((id) => getPlanDeleteImpact(id))).then((results) => {
      if (!live) return;
      let nodes = 0;
      let tasks = 0;
      for (const r of results) {
        if (r.ok) {
          nodes += r.nodes;
          tasks += r.tasks;
        }
      }
      setImpact({ nodes, tasks });
    });
    return () => {
      live = false;
    };
  }, [ids]);

  const rowWord = ids.length === 1 ? "row" : "rows";

  return (
    <Dialog.Root open onOpenChange={(v) => !v && onCancel()}>
      <Dialog.Portal>
        <Dialog.Overlay
          className="fixed inset-0 z-[80]"
          style={{ background: "rgba(15, 23, 42, 0.45)", backdropFilter: "blur(4px)" }}
        />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-[90] -translate-x-1/2 -translate-y-1/2 rounded-section border border-hairline bg-surface-card shadow-xl overflow-hidden"
          style={{ width: "min(520px, calc(100vw - 32px))" }}
        >
          <div className="px-6 pt-5 pb-2 flex items-start gap-3">
            <span
              aria-hidden
              className="grid place-items-center rounded-lg shrink-0"
              style={{
                width: 34,
                height: 34,
                color: "#DC2626",
                background: "color-mix(in srgb, #DC2626 10%, transparent)",
              }}
            >
              <Trash2 size={17} strokeWidth={2.4} />
            </span>
            <div className="min-w-0">
              <Dialog.Title
                className="font-black"
                style={{ fontSize: 18, color: "var(--color-ink-strong)" }}
              >
                {name
                  ? `Delete “${name}”?`
                  : `Delete ${ids.length} ${rowWord}?`}
              </Dialog.Title>
              <Dialog.Description
                className="mt-1 text-[14px]"
                style={{ color: "var(--color-ink-muted)" }}
              >
                This is permanent. Deleted rows cannot be restored.
              </Dialog.Description>
            </div>
            <Dialog.Close
              className="ml-auto grid place-items-center rounded-lg size-8 shrink-0"
              aria-label="Close"
              style={{ color: "var(--color-ink-subtle)" }}
            >
              <X size={16} strokeWidth={2.4} />
            </Dialog.Close>
          </div>

          <div className="px-6 pb-4">
            <div
              className="rounded-xl px-4 py-3 text-[14.5px]"
              style={{
                background: "color-mix(in srgb, #DC2626 6%, transparent)",
                border: "1px solid color-mix(in srgb, #DC2626 20%, transparent)",
                color: "var(--color-ink)",
              }}
            >
              {impact === null ? (
                <span style={{ color: "var(--color-ink-subtle)" }}>
                  Working out what this takes with it…
                </span>
              ) : (
                <>
                  <strong style={TABULAR}>{impact.nodes}</strong> plan{" "}
                  {impact.nodes === 1 ? "row" : "rows"}
                  {impact.tasks > 0 && (
                    <>
                      {" "}
                      and <strong style={TABULAR}>{impact.tasks}</strong>{" "}
                      {impact.tasks === 1 ? "task" : "tasks"}, which also come off
                      the WMS list and the calendar
                    </>
                  )}
                  .
                </>
              )}
            </div>
          </div>

          <div className="flex items-center justify-end gap-2.5 px-6 pb-5">
            <button
              ref={cancelRef}
              type="button"
              onClick={onCancel}
              className="rounded-lg px-4 h-10 text-[14.5px] font-semibold"
              style={{
                color: "var(--color-ink)",
                border: "1px solid var(--color-hairline-strong)",
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={pending}
              className="inline-flex items-center gap-1.5 rounded-lg px-4 h-10 text-[14.5px] font-bold text-white disabled:opacity-50"
              style={{ background: "#DC2626" }}
            >
              <Trash2 size={14} strokeWidth={2.6} />
              {pending ? "Deleting…" : "Delete"}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
