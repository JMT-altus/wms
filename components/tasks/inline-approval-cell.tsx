"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import * as Popover from "@radix-ui/react-popover";
import { ChevronDown, Check, Loader2 } from "lucide-react";
import { APPROVAL_STATUSES, type ApprovalStatus } from "@/db/enums";
import { setTaskApprovalStatus } from "@/app/(app)/tasks/actions";
import { fireToast } from "@/lib/toast";

/**
 * The INITIATOR's ruling on one task, as a chip in the list.
 *
 * The sibling of `InlineStatusCell`, and deliberately a separate column from
 * it. `status` is the doer's progress report and `approval_status` is the
 * ruling on it — two columns in the database, because "approved" must never
 * erase the fact that the work was at Follow Up when the verdict landed. A
 * list that showed only one of them could only ever tell you half of what the
 * row knew.
 *
 * NO RULING IS AN EM DASH, not a status. "Not approved" and "nobody has ruled
 * yet" are different facts and the column must not confuse them — which is
 * also why `null` is an option in the menu rather than something you can only
 * reach by undoing a verdict elsewhere.
 *
 * Admin-only to change, matching `setTaskApprovalStatus`, which refuses a
 * non-admin outright. Everyone else gets the chip without the affordance —
 * the ruling is worth seeing even where it is not yours to make.
 */

/** The four verdicts, then the way back to no verdict at all. */
const OPTIONS: (ApprovalStatus | null)[] = [...APPROVAL_STATUSES, null];

const LABEL: Record<ApprovalStatus, string> = {
  approved: "Approved",
  not_approved: "Not Approved",
  cancelled: "Cancelled",
  transferred: "Transferred",
};

/** Token names, resolved to `--color-<token>` the way the status chip does. */
const TONE: Record<ApprovalStatus, string> = {
  approved: "purple",
  not_approved: "rose",
  cancelled: "stone",
  transferred: "brown",
};

interface Props {
  taskId: string;
  approvalStatus: ApprovalStatus | null;
  isAdmin: boolean;
}

export function InlineApprovalCell({ taskId, approvalStatus, isAdmin }: Props) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  // Optimistic, so the chip flips while the server confirms; rolls back on
  // error. Same contract as the status chip beside it.
  const [shown, setShown] = React.useState<ApprovalStatus | null>(approvalStatus);

  // A fresh server value is adopted DURING RENDER rather than in an effect:
  // an effect renders the stale ruling for one frame first, and setting state
  // from one is the cascading-render pattern the lint rule is about.
  const [seen, setSeen] = React.useState(approvalStatus);
  if (approvalStatus !== seen) {
    setSeen(approvalStatus);
    setShown(approvalStatus);
  }

  const tone = shown ? TONE[shown] : null;

  async function pick(next: ApprovalStatus | null) {
    setOpen(false);
    if (next === shown) return;
    const prev = shown;
    setShown(next);
    setPending(true);
    try {
      const res = await setTaskApprovalStatus(taskId, { approvalStatus: next });
      if (!res.ok) {
        setShown(prev);
        fireToast({
          message:
            res.error === "forbidden"
              ? "Only an admin can rule on a task."
              : (res.message ?? "Could not set the ruling."),
        });
        return;
      }
      fireToast({
        message: next ? `Ruled ${LABEL[next]}.` : "Ruling cleared.",
      });
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  const chip = (
    <span
      className="inline-flex min-w-[104px] items-center justify-center gap-1.5 rounded-pill px-2.5 py-1.5 text-[13px] font-bold max-md:min-w-[96px]"
      style={
        tone
          ? {
              background: `color-mix(in srgb, var(--color-${tone}) 12%, transparent)`,
              color: `var(--color-${tone}-deep)`,
              border: `1px solid color-mix(in srgb, var(--color-${tone}) 30%, transparent)`,
              cursor: pending ? "wait" : isAdmin ? "pointer" : "default",
              opacity: pending ? 0.7 : 1,
            }
          : {
              // No ruling yet. Drawn as an outline rather than a grey pill so
              // it reads as an empty slot, not as a status called "—".
              color: "var(--color-ink-subtle)",
              border: "1px dashed var(--color-hairline-strong)",
              cursor: pending ? "wait" : isAdmin ? "pointer" : "default",
              opacity: pending ? 0.7 : 1,
            }
      }
    >
      {shown ? LABEL[shown] : "—"}
      {pending ? (
        <Loader2
          size={12}
          strokeWidth={2.4}
          style={{ animation: "spinFast 0.8s linear infinite" }}
        />
      ) : (
        isAdmin && <ChevronDown size={12} strokeWidth={2.6} />
      )}
    </span>
  );

  if (!isAdmin) return chip;

  return (
    <Popover.Root open={open} onOpenChange={(next) => !pending && setOpen(next)}>
      <Popover.Trigger asChild>
        <button
          type="button"
          onClick={(e) => e.stopPropagation()}
          disabled={pending}
          aria-label={`Initiator status: ${shown ? LABEL[shown] : "none"}. Click to change.`}
        >
          {chip}
        </button>
      </Popover.Trigger>
      {/* Portalled for the same reason the status menu is: the cell clips its
          own overflow for long titles, and an in-cell menu is clipped to a
          sliver. */}
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          collisionPadding={12}
          onOpenAutoFocus={(e) => e.preventDefault()}
          className="z-[60] min-w-[200px] max-md:min-w-[170px] overflow-y-auto rounded-chip border bg-surface-card"
          style={{
            borderColor: "var(--color-hairline-strong)",
            boxShadow: "0 16px 40px rgba(15, 23, 42, 0.18)",
          }}
        >
          <ul role="listbox" aria-label="Set the initiator's ruling">
            {OPTIONS.map((s) => {
              const sel = s === shown;
              const t = s ? TONE[s] : null;
              return (
                <li
                  key={s ?? "__none__"}
                  role="option"
                  aria-selected={sel}
                  onClick={(e) => {
                    e.stopPropagation();
                    void pick(s);
                  }}
                  className="flex items-center gap-2.5 px-3 py-2 text-[13.5px] cursor-pointer transition-colors"
                  style={{
                    background: sel ? "var(--vp-cyan-tint)" : "transparent",
                    fontWeight: sel ? 700 : 500,
                  }}
                  onMouseEnter={(e) => {
                    if (!sel)
                      e.currentTarget.style.background = "var(--color-surface-soft)";
                  }}
                  onMouseLeave={(e) => {
                    if (!sel) e.currentTarget.style.background = "transparent";
                  }}
                >
                  <span
                    aria-hidden
                    className="inline-block size-2.5 rounded-full shrink-0"
                    style={{
                      background: t ? `var(--color-${t})` : "transparent",
                      boxShadow: "inset 0 0 0 1px rgba(15, 23, 42, 0.18)",
                    }}
                  />
                  <span className="flex-1" style={{ color: "var(--color-ink-strong)" }}>
                    {s ? LABEL[s] : "No ruling"}
                  </span>
                  {sel && (
                    <Check
                      size={14}
                      strokeWidth={2.6}
                      style={{ color: "rgb(var(--vp-cyan-deep))" }}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
