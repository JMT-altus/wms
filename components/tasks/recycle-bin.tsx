"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { ArrowLeft, Loader2, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { restoreAbandonedTask, type AbandonedTaskRow } from "@/app/(app)/tasks/lifecycle-actions";
import { deleteTask } from "@/app/(app)/tasks/actions";

function dayLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * The Recycle Bin — tasks that were abandoned rather than archived or deleted.
 *
 * Restore is the primary action and is deliberately one click with no
 * confirmation: undoing a bin is safe, and asking "are you sure?" for a safe
 * action trains people to click through the dangerous one. Permanent delete
 * keeps its confirmation, because that one really is irreversible.
 */
export function RecycleBin({ rows }: { rows: AbandonedTaskRow[] }) {
  const router = useRouter();
  const [pendingId, setPendingId] = React.useState<string | null>(null);
  const [, start] = React.useTransition();

  function restore(row: AbandonedTaskRow) {
    setPendingId(row.id);
    start(async () => {
      const result = await restoreAbandonedTask(row.id);
      setPendingId(null);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Restored.");
      router.refresh();
    });
  }

  function purge(row: AbandonedTaskRow) {
    if (
      !confirm(
        `Permanently delete "${row.title}"?\n\nThis removes the task and its whole history and cannot be undone.`,
      )
    )
      return;
    setPendingId(row.id);
    start(async () => {
      const result = await deleteTask(row.id);
      setPendingId(null);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("Deleted for good.");
      router.refresh();
    });
  }

  return (
    <div className="mx-auto w-full max-w-[1120px] px-6 max-md:px-4 py-8 pb-32">
      <Link
        href={"/tasks" as Route}
        className="mb-5 inline-flex items-center gap-1.5 text-[13.5px] font-semibold text-ink-subtle transition-colors hover:text-ink-strong"
      >
        <ArrowLeft size={15} strokeWidth={2.4} />
        Back to Tasks
      </Link>

      <h1
        className="inline-flex items-center gap-2.5 text-ink-strong"
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 27,
          fontWeight: 600,
        }}
      >
        <Trash2
          size={24}
          strokeWidth={2}
          style={{ color: "var(--color-altus-red)" }}
        />
        Recycle Bin
      </h1>
      <p className="mb-7 mt-2 text-ink-soft" style={{ fontSize: 15, maxWidth: "70ch" }}>
        Tasks that were abandoned — dropped from every list without being
        destroyed. Their history is intact, so restoring one brings back
        everything that ever happened to it.
      </p>

      {rows.length === 0 ? (
        <div
          className="rounded-section border border-hairline bg-surface-card px-6 py-14 text-center"
          style={{ boxShadow: "0 1px 3px rgba(15,23,42,0.04)" }}
        >
          <p className="font-semibold text-ink-strong" style={{ fontSize: 17 }}>
            The bin is empty
          </p>
          <p className="mt-1 text-ink-soft" style={{ fontSize: 15 }}>
            Nothing has been abandoned.
          </p>
        </div>
      ) : (
        <ul className="grid gap-2">
          {rows.map((row) => {
            const busy = pendingId === row.id;
            return (
              <li
                key={row.id}
                className="flex flex-wrap items-center gap-3 rounded-section border border-hairline bg-surface-card px-4 py-3"
                style={{ boxShadow: "0 1px 3px rgba(15,23,42,0.04)" }}
              >
                <span className="min-w-0 flex-1">
                  <Link
                    href={`/tasks/${row.id}` as Route}
                    className="block truncate font-semibold text-ink-strong hover:underline"
                    style={{ fontSize: 14.5 }}
                  >
                    {row.taskNo != null && (
                      <span className="tabular-nums text-ink-subtle">
                        #{row.taskNo}{" "}
                      </span>
                    )}
                    {row.title}
                  </Link>
                  <span
                    className="block truncate text-ink-subtle"
                    style={{ fontSize: 12.5 }}
                  >
                    {[row.client, row.subject, row.doerName]
                      .filter(Boolean)
                      .join(" · ") || "No details"}
                  </span>
                </span>

                <span
                  className="shrink-0 text-right text-ink-muted"
                  style={{ fontSize: 12 }}
                >
                  <span className="block tabular-nums">
                    {dayLabel(row.abandonedAt)}
                  </span>
                  {row.abandonedByName && (
                    <span className="block">by {row.abandonedByName}</span>
                  )}
                </span>

                <span className="flex shrink-0 items-center gap-2">
                  <button
                    type="button"
                    onClick={() => restore(row)}
                    disabled={busy}
                    aria-label={`Restore ${row.title}`}
                    className="inline-flex items-center gap-1.5 rounded-md border border-hairline bg-surface-soft px-3 py-1.5 text-[13px] font-medium text-ink-strong disabled:opacity-50"
                  >
                    {busy ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      <RotateCcw size={13} strokeWidth={2.4} />
                    )}
                    Restore
                  </button>
                  <button
                    type="button"
                    onClick={() => purge(row)}
                    disabled={busy}
                    aria-label={`Permanently delete ${row.title}`}
                    className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium text-white disabled:opacity-50"
                    style={{
                      background:
                        "linear-gradient(135deg, var(--color-red), var(--color-red-deep))",
                    }}
                  >
                    <Trash2 size={13} strokeWidth={2.4} />
                    Delete
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
