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
    <div className="mx-auto w-full max-w-[1120px] px-8 max-md:px-4 pt-4 pb-3">
      <Link
        href={"/tasks" as Route}
        className="mb-3 inline-flex items-center gap-1.5 text-[13px] font-semibold text-ink-subtle transition-colors hover:text-ink-strong"
      >
        <ArrowLeft size={15} strokeWidth={2.4} />
        Back to Tasks
      </Link>

      {/* A heading div, not <h1>: the global h1 rule forces 30–46px. */}
      <div
        role="heading"
        aria-level={1}
        className="flex items-center gap-2 text-ink-strong"
        style={{
          fontFamily: "var(--font-display)",
          fontSize: 20,
          fontWeight: 800,
          letterSpacing: "-0.02em",
        }}
      >
        <Trash2
          size={18}
          strokeWidth={2.2}
          style={{ color: "var(--color-altus-red)" }}
        />
        Recycle Bin
      </div>
      <p className="mb-4 mt-1 text-ink-soft" style={{ fontSize: 13, lineHeight: 1.5, maxWidth: "80ch" }}>
        Tasks that were abandoned — dropped from every list without being
        destroyed. Their history is intact, so restoring one brings back
        everything that ever happened to it.
      </p>

      {rows.length === 0 ? (
        <div
          className="rounded-xl border border-hairline bg-surface-card px-6 py-10 text-center"
          style={{ boxShadow: "0 1px 3px rgba(15,23,42,0.04)" }}
        >
          <p className="font-semibold text-ink-strong" style={{ fontSize: 15 }}>
            The bin is empty
          </p>
          <p className="mt-1 text-ink-soft" style={{ fontSize: 13 }}>
            Nothing has been abandoned.
          </p>
        </div>
      ) : (
        <ul className="grid gap-1.5">
          {rows.map((row) => {
            const busy = pendingId === row.id;
            return (
              <li
                key={row.id}
                className="flex flex-wrap items-center gap-3 rounded-xl border border-hairline bg-surface-card px-4 py-2.5 hover:bg-[#F7F9FD] transition-colors"
                style={{ boxShadow: "0 1px 3px rgba(15,23,42,0.04)" }}
              >
                <span className="min-w-0 flex-1">
                  <Link
                    href={`/tasks/${row.id}` as Route}
                    className="block truncate font-semibold text-ink-strong hover:underline"
                    style={{ fontSize: 14 }}
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
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#D6DEEB] bg-white px-3 text-[13px] font-semibold text-[#334155] transition-colors hover:bg-[#F5F8FE] hover:border-[#B8CCEE] disabled:opacity-50"
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
