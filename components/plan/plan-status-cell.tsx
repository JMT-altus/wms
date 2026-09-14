"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Check, Lock } from "lucide-react";
import { toast } from "sonner";
import {
  PLAN_DEFAULT_STATUS,
  PLAN_RESTRICTED_STATUSES,
  PLAN_STATUS_LABEL,
  PLAN_STATUS_TONE,
  PLAN_WORKING_STATUSES,
  canSetPlanStatus,
  effectivePlanStatus,
  isRestrictedStatus,
  isWorkingStatus,
  type PlanActor,
  type PlanStatusChoice,
} from "@/lib/plan/status";
import type { PlanKind } from "@/lib/plan/levels";
import { setPlanNodeStatus } from "@/app/(project)/project-plan/actions";

/**
 * One row's status, as a chip that opens a menu.
 *
 * The menu renders exactly what `canSetPlanStatus` allows for this actor —
 * and the server calls the SAME function before it writes. The dropdown is a
 * courtesy; the check is the control.
 *
 * ── The two flows, and why the cell renders ONE of them ───────────────────
 * A plan row carries two independent answers: the DOER'S progress report
 * (`status`) and the INITIATOR'S ruling on it (`approval_status`). They are
 * separate columns in the database for the reason this module repeats
 * everywhere — "approved" must never erase the fact that the work was at
 * Follow Up when the verdict landed.
 *
 * This used to render them through `effectivePlanStatus`, which picks the
 * verdict over the report, in ONE column. That column could therefore only
 * ever show you half of what the row knew: once an initiator ruled on a row,
 * its doer's own status became unreadable, and the doer's next report landed
 * invisibly underneath. `flow` splits them into the two columns the table now
 * has — each showing its own value and offering only its own vocabulary.
 *
 * `flow: "both"` keeps the old single-chip behaviour for surfaces with room
 * for one column, like the kanban card.
 */

interface Props {
  nodeId: string;
  /** The row's working status (container) — an executable reads its task. */
  status: string | null;
  approvalStatus: string | null;
  isArchived?: boolean;
  actor: PlanActor;
  /** The row's level — a project's status is owner/admin only. */
  kind: PlanKind;
  /**
   * WHICH of the row's two answers this chip is.
   *
   *   doer       the progress report — `status`, the working vocabulary
   *   initiator  the ruling — `approval_status`, the restricted vocabulary
   *   both       one chip for both, verdict outranking report (the default,
   *              and what the kanban card still wants)
   */
  flow?: "doer" | "initiator" | "both";
  /** The linked task's optimistic-lock token, for an executable row. */
  expectedUpdatedAt?: string;
  onDone?: () => void;
  disabled?: boolean;
  compact?: boolean;
}

export function PlanStatusCell({
  nodeId,
  status,
  approvalStatus,
  isArchived,
  actor,
  kind,
  flow = "both",
  expectedUpdatedAt,
  onDone,
  disabled,
  compact,
}: Props) {
  const [open, setOpen] = React.useState(false);
  const [pending, startTransition] = React.useTransition();
  const ref = React.useRef<HTMLDivElement>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);
  /** Viewport coordinates for the portalled menu. */
  const [at, setAt] = React.useState<{ top: number; left: number } | null>(null);

  /**
   * Place the menu against the trigger, in VIEWPORT coordinates.
   *
   * The menu is portalled to <body> rather than living in the cell, because
   * the table wrapper is `overflow: auto` and an absolutely-positioned child
   * of a cell is clipped to that box — which is why this menu appeared cut off
   * or empty for any row near the bottom or right edge of the table.
   */
  const place = React.useCallback(() => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    const MENU_W = 200;
    const MENU_H = 288;
    // Flip above when there is not room below, and keep it on screen at the
    // right edge rather than letting it hang off.
    const below = window.innerHeight - rect.bottom;
    const top = below < MENU_H && rect.top > below ? rect.top - MENU_H - 4 : rect.bottom + 4;
    const left = Math.min(rect.left, window.innerWidth - MENU_W - 8);
    setAt({ top: Math.max(8, top), left: Math.max(8, left) });
  }, []);

  /**
   * The value THIS chip stands for, and the list it may offer.
   *
   * An archived row reads "Archived" on the initiator side — archiving is a
   * ruling — and leaves the doer's last report alone underneath, which is the
   * point of splitting them. A row with no ruling yet shows an em dash rather
   * than inventing one: "not approved" and "not yet looked at" are different
   * facts and the column must not confuse them.
   */
  const vocabulary: readonly PlanStatusChoice[] =
    flow === "doer"
      ? PLAN_WORKING_STATUSES
      : flow === "initiator"
        ? PLAN_RESTRICTED_STATUSES
        : [...PLAN_WORKING_STATUSES, ...PLAN_RESTRICTED_STATUSES];

  const verdict: PlanStatusChoice | null = isArchived
    ? "archived"
    : approvalStatus && isRestrictedStatus(approvalStatus)
      ? approvalStatus
      : null;

  const current: PlanStatusChoice | null =
    flow === "doer"
      ? status && isWorkingStatus(status)
        ? status
        : PLAN_DEFAULT_STATUS
      : flow === "initiator"
        ? verdict
        : effectivePlanStatus(status, approvalStatus, isArchived);

  const tone = current ? PLAN_STATUS_TONE[current] : "#94A3B8";

  React.useEffect(() => {
    if (!open) return;
    function onAway(e: MouseEvent) {
      const t = e.target as Node;
      if (ref.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    /**
     * Close on scroll — but only when something OUTSIDE the menu scrolled.
     *
     * The menu is positioned against its cell, so once the table scrolls
     * underneath it the two part company and it hangs over the page pointing
     * at nothing. Capture phase is what lets this see the table container's
     * own scroll, which never bubbles to the window.
     *
     * That same capture listener also hears the menu scrolling ITSELF — this
     * list is taller than its 288px box — so without the containment check it
     * would slam shut the instant you tried to reach "Archived".
     */
    function onScroll(e: Event) {
      const target = e.target;
      // The menu scrolls itself when the list is taller than its box; only an
      // OUTSIDE scroll means the trigger has moved out from under it.
      if (target instanceof Node && menuRef.current?.contains(target)) return;
      setOpen(false);
    }
    document.addEventListener("mousedown", onAway);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      document.removeEventListener("mousedown", onAway);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [open]);

  function choose(next: PlanStatusChoice) {
    setOpen(false);
    if (next === current) return;
    startTransition(async () => {
      const res = await setPlanNodeStatus({
        id: nodeId,
        status: next,
        expectedUpdatedAt,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      onDone?.();
    });
  }

  // Nothing to offer means nothing to open — a menu of greyed-out rows is
  // worse than a plain chip.
  const canOpen =
    !disabled && vocabulary.some((s) => canSetPlanStatus(actor, s, kind).ok);

  const chip = (
    <span
      className="inline-flex items-center gap-1.5 rounded-pill px-2.5 h-[22px] font-semibold whitespace-nowrap"
      style={{
        fontSize: compact ? 11.5 : 12.5,
        color: tone,
        background: `color-mix(in srgb, ${tone} 12%, transparent)`,
        border: `1px solid color-mix(in srgb, ${tone} 34%, transparent)`,
      }}
    >
      {current ? PLAN_STATUS_LABEL[current] : "—"}
      {canOpen ? (
        <ChevronDown size={11} strokeWidth={2.6} style={{ opacity: 0.7 }} />
      ) : (
        <Lock size={9} strokeWidth={2.6} style={{ opacity: 0.45 }} />
      )}
    </span>
  );

  if (!canOpen) return chip;

  return (
    <div ref={ref} className="relative inline-block">
      <button
        type="button"
        onClick={() => {
          if (!open) place();
          setOpen((v) => !v);
        }}
        disabled={pending}
        aria-haspopup="menu"
        aria-expanded={open}
        className="disabled:opacity-60"
        style={{ cursor: pending ? "wait" : "pointer" }}
      >
        {chip}
      </button>

      {open && at && createPortal(
        <div
          ref={menuRef}
          role="menu"
          // Eleven statuses is taller than the space under a row near the
          // bottom of a long table, so the menu scrolls — with the bar hidden,
          // because a scrollbar inside a 190px popover is more chrome than
          // content. `no-scrollbar` is the app's own utility.
          className="no-scrollbar fixed z-[100] w-[200px] overflow-y-auto rounded-xl p-1 shadow-lg"
          style={{
            top: at.top,
            left: at.left,
            maxHeight: 288,
            background: "var(--color-surface-card)",
            border: "1px solid var(--color-hairline-strong)",
          }}
        >
          {flow !== "initiator" && (
            <Group
              label={flow === "doer" ? "Doer status" : "Progress"}
              statuses={PLAN_WORKING_STATUSES}
              actor={actor}
              kind={kind}
              current={current}
              onPick={choose}
            />
          )}
          {flow === "both" && (
            <div
              className="my-1"
              style={{ borderTop: "1px solid var(--color-hairline)" }}
            />
          )}
          {flow !== "doer" && (
            <Group
              label={flow === "initiator" ? "Initiator status" : "Decision"}
              statuses={PLAN_RESTRICTED_STATUSES}
              actor={actor}
              kind={kind}
              current={current}
              onPick={choose}
            />
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}

function Group({
  label,
  statuses,
  actor,
  kind,
  current,
  onPick,
}: {
  label: string;
  statuses: readonly PlanStatusChoice[];
  actor: PlanActor;
  kind: PlanKind;
  current: PlanStatusChoice | null;
  onPick: (s: PlanStatusChoice) => void;
}) {
  const allowed = statuses.filter((s) => canSetPlanStatus(actor, s, kind).ok);
  if (allowed.length === 0) return null;
  return (
    <>
      <p
        className="px-2.5 pt-1 pb-1 text-[11px] font-bold uppercase tracking-wide"
        style={{ color: "var(--color-ink-subtle)" }}
      >
        {label}
      </p>
      {allowed.map((s) => (
        <button
          key={s}
          type="button"
          role="menuitem"
          onClick={() => onPick(s)}
          className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[13.5px] text-left hover:bg-black/[0.04]"
          style={{ color: "var(--color-ink)" }}
        >
          <span
            aria-hidden
            className="size-2 rounded-full shrink-0"
            style={{ background: PLAN_STATUS_TONE[s] }}
          />
          <span className="flex-1">{PLAN_STATUS_LABEL[s]}</span>
          {s === current && <Check size={13} strokeWidth={2.6} />}
        </button>
      ))}
    </>
  );
}
