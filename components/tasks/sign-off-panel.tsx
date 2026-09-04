"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { BadgeCheck, Check, Loader2, ShieldCheck, X } from "lucide-react";
import * as Dialog from "@radix-ui/react-dialog";
import { decideTaskApproval } from "@/app/(app)/tasks/approval-actions";
import {
  canSignOff,
  SIGN_OFF_BLOCK_MESSAGES,
  type ApprovalActor,
  type ApprovalTaskShape,
} from "@/lib/tasks/approval-levels";
import { APPROVAL_LEVEL_LABELS, type ApprovalLevel } from "@/db/enums";

/** One rung of the ladder, as the panel draws it. */
interface Stage {
  key: Exclude<ApprovalLevel, "none">;
  title: string;
  byName: string | null;
  at: string | null;
  note: string | null;
}

interface Props {
  taskId: string;
  expectedUpdatedAt: string;
  task: ApprovalTaskShape;
  actor: ApprovalActor;
  manager: { byName: string | null; at: string | null; note: string | null };
  admin: { byName: string | null; at: string | null; note: string | null };
}

function dateLabel(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * Two-stage sign-off, drawn as a ladder.
 *
 * The panel renders the SAME `canSignOff` decision the server defends with, so
 * a button is only ever offered when the action behind it would actually go
 * through — and when it is withheld, the panel says which of the five reasons
 * applies instead of leaving a dead control on screen.
 *
 * This sits alongside the existing Approve / Decline pair rather than replacing
 * it: that control is the manager's verdict, and this is the record of how far
 * that verdict has travelled.
 */
export function SignOffPanel({
  taskId,
  expectedUpdatedAt,
  task,
  actor,
  manager,
  admin,
}: Props) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const [declineOpen, setDeclineOpen] = React.useState(false);
  const [note, setNote] = React.useState("");

  const decision = canSignOff(task, actor);

  const stages: Stage[] = [
    {
      key: "manager",
      title: "Manager approval",
      byName: manager.byName,
      at: manager.at,
      note: manager.note,
    },
    {
      key: "admin",
      title: "Final sign-off",
      byName: admin.byName,
      at: admin.at,
      note: admin.note,
    },
  ];

  const rank: Record<ApprovalLevel, number> = { none: 0, manager: 1, admin: 2 };
  const reached = rank[task.approvalLevel];
  const rejected = task.approvalStatus === "not_approved";

  function submit(verdict: "approved" | "not_approved") {
    start(async () => {
      const result = await decideTaskApproval(
        taskId,
        { decision: verdict, note: note.trim() || undefined },
        expectedUpdatedAt,
      );
      if (!result.ok) {
        // "stale" is called out on its own: someone else got there first, and
        // the fix is a refresh, not a retry of the same click.
        toast.error(
          result.error === "stale"
            ? "Someone else changed this first. Refreshing…"
            : (result.message ?? "That didn't go through."),
        );
        if (result.error === "stale") router.refresh();
        return;
      }
      toast.success(
        verdict === "not_approved"
          ? "Declined."
          : result.stage === "admin"
            ? "Final sign-off recorded."
            : "Approved — now with the founder for final sign-off.",
      );
      setDeclineOpen(false);
      setNote("");
      router.refresh();
    });
  }

  return (
    <section
      className="rounded-section border border-hairline bg-surface-card px-5 py-4"
      style={{
        boxShadow:
          "0 14px 32px -20px rgba(10, 108, 255, 0.16), 0 2px 6px -2px rgba(15, 23, 42, 0.06)",
      }}
    >
      <div className="flex items-center justify-between gap-2 mb-3">
        <h2
          className="inline-flex items-center gap-2 uppercase font-bold tracking-[0.08em] text-ink-subtle"
          style={{ fontSize: 10.5 }}
        >
          <ShieldCheck size={13} strokeWidth={2.4} />
          Sign-off
        </h2>
        <span
          className="tabular-nums text-ink-muted"
          style={{ fontSize: 11.5 }}
        >
          {rejected ? "Not approved" : APPROVAL_LEVEL_LABELS[task.approvalLevel]}
        </span>
      </div>

      {/* The ladder. Both rungs are always drawn — a stage nobody has reached
          yet is the most useful thing on this panel, because it says who the
          task is waiting on. */}
      <ol className="grid gap-1.5 mb-3">
        {stages.map((stage) => {
          const done = !rejected && reached >= rank[stage.key];
          return (
            <li
              key={stage.key}
              className="flex items-start gap-2.5 rounded-chip px-2.5 py-2"
              style={{ background: "var(--color-surface-soft)" }}
            >
              <span
                aria-hidden
                className="mt-[2px] inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full"
                style={{
                  background: done
                    ? "var(--color-green)"
                    : "var(--color-surface-card)",
                  border: done ? "none" : "1.5px solid var(--color-hairline)",
                  color: "#fff",
                }}
              >
                {done && <Check size={10} strokeWidth={3.2} />}
              </span>
              <span className="min-w-0 flex-1">
                <span
                  className="block font-semibold text-ink-strong"
                  style={{ fontSize: 13 }}
                >
                  {stage.title}
                </span>
                <span
                  className="block truncate text-ink-subtle"
                  style={{ fontSize: 11.5 }}
                >
                  {done
                    ? [stage.byName, dateLabel(stage.at)]
                        .filter(Boolean)
                        .join(" · ") || "Recorded"
                    : stage.key === "admin"
                      ? "Founder only"
                      : "Pending"}
                </span>
                {done && stage.note && (
                  <span
                    className="mt-1 block text-ink-muted"
                    style={{ fontSize: 11.5, lineHeight: 1.45 }}
                  >
                    “{stage.note}”
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ol>

      {decision.allowed ? (
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={() => submit("approved")}
            className="inline-flex items-center gap-1.5 rounded-md px-3.5 py-2 text-[13px] font-medium text-white disabled:opacity-50"
            style={{
              background:
                "linear-gradient(135deg, var(--color-green), var(--color-green-deep))",
              boxShadow:
                "0 2px 8px color-mix(in srgb, var(--color-green) 35%, transparent)",
            }}
          >
            {pending ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <BadgeCheck size={14} strokeWidth={2.4} />
            )}
            {decision.stage === "admin" ? "Give final sign-off" : "Approve"}
          </button>

          <Dialog.Root open={declineOpen} onOpenChange={setDeclineOpen}>
            <Dialog.Trigger asChild>
              <button
                type="button"
                disabled={pending}
                className="inline-flex items-center gap-1.5 rounded-md border border-hairline bg-surface-card px-3.5 py-2 text-[13px] font-medium text-ink-strong hover:bg-surface-soft disabled:opacity-50"
              >
                <X size={14} strokeWidth={2.4} />
                Decline
              </button>
            </Dialog.Trigger>
            <Dialog.Portal>
              <Dialog.Overlay
                className="fixed inset-0 z-[60]"
                style={{
                  background: "rgba(15, 23, 42, 0.45)",
                  backdropFilter: "blur(4px)",
                }}
              />
              <Dialog.Content className="fixed left-1/2 top-1/2 z-[70] w-[min(480px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-section border border-hairline bg-surface-card p-6 shadow-xl">
                <Dialog.Title className="text-display-md text-ink-strong">
                  Decline this work
                </Dialog.Title>
                <Dialog.Description
                  className="mt-1.5 text-[15px] text-ink-subtle"
                  style={{ lineHeight: 1.5 }}
                >
                  Declining resets the sign-off — the work goes back for another
                  pass and returns through both stages.
                </Dialog.Description>
                <textarea
                  rows={3}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  className="mt-4 w-full resize-y rounded-md border border-hairline bg-white px-3.5 py-3 text-[15px]"
                  placeholder="What needs to change? (optional)"
                />
                <div className="mt-4 flex items-center justify-end gap-3">
                  <Dialog.Close asChild>
                    <button
                      type="button"
                      disabled={pending}
                      className="rounded-md border border-hairline bg-surface-soft px-5 py-2.5 text-[14px] font-medium text-ink-strong disabled:opacity-50"
                    >
                      Cancel
                    </button>
                  </Dialog.Close>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => submit("not_approved")}
                    className="rounded-md px-5 py-2.5 text-[14px] font-medium text-white disabled:opacity-50"
                    style={{
                      background:
                        "linear-gradient(135deg, var(--color-red), var(--color-red-deep))",
                    }}
                  >
                    {pending ? "Saving…" : "Decline"}
                  </button>
                </div>
              </Dialog.Content>
            </Dialog.Portal>
          </Dialog.Root>
        </div>
      ) : (
        <p className="text-ink-muted" style={{ fontSize: 12.5, lineHeight: 1.5 }}>
          {SIGN_OFF_BLOCK_MESSAGES[decision.reason]}
        </p>
      )}
    </section>
  );
}
