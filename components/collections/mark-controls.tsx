"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Flag, MoreHorizontal, Undo2 } from "lucide-react";
import { CenterDialog } from "@/components/ui/center-dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { fireToast } from "@/lib/toast";
import { fmtDateTime } from "@/lib/dates";
import { setCompanyMarks } from "@/app/(collection-module)/collection/marks-actions";
import { MARKS_NOT_READY, STATE_LABELS, markStateOf, marksMessage, type CompanyMarks, type MarkKind, type MarkState } from "@/lib/collections/marks";

/**
 * MARK AS PRIORITY / COLLECTION DONE in the Tracker: the shared runner (one
 * request at a time, confirmation before COLLECTION DONE, toast, refresh), the
 * row's ⋯ menu, the badge beside the company name and the row's colouring.
 * The bulk bar (tracker-bulk-bar.tsx) uses the same runner, so a row action
 * and a bulk action behave identically. Permissions are decided on the server
 * and passed down as flags; the action checks them again.
 */

export interface MarkTarget {
  id: string;
  name: string;
}

export function useMarkRunner({ onDone }: { onDone?: () => void } = {}) {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);
  const pendingRef = React.useRef(false); // blocks a second request before React re-renders the disabled controls
  const [confirm, setConfirm] = React.useState<MarkTarget[] | null>(null);

  const execute = React.useCallback(
    async (targets: MarkTarget[], kind: MarkKind, active: boolean) => {
      if (pendingRef.current || targets.length === 0) return;
      pendingRef.current = true;
      setPending(true);
      try {
        const res = await setCompanyMarks({ companyIds: targets.map((t) => t.id), kind, active });
        if (!res.ok) fireToast({ message: res.error, type: "error" });
        else {
          fireToast({ message: marksMessage(kind, active, res.updated, res.skipped), type: res.updated > 0 ? "success" : "info" });
          onDone?.();
          router.refresh();
        }
      } catch {
        fireToast({ message: "The change could not be saved. Please try again.", type: "error" });
      } finally {
        pendingRef.current = false;
        setPending(false);
      }
    },
    [onDone, router],
  );

  /** COLLECTION DONE asks first; everything else runs at once. */
  const run = React.useCallback(
    (targets: MarkTarget[], kind: MarkKind, active: boolean) => {
      if (kind === "done" && active) setConfirm(targets);
      else void execute(targets, kind, active);
    },
    [execute],
  );

  const dialog = confirm ? (
    <ConfirmDoneDialog
      targets={confirm}
      busy={pending}
      onCancel={() => setConfirm(null)}
      onConfirm={() => {
        const targets = confirm;
        setConfirm(null);
        void execute(targets, "done", true);
      }}
    />
  ) : null;

  return { run, pending, dialog };
}

const LISTED = 8;

function ConfirmDoneDialog({ targets, busy, onCancel, onConfirm }: { targets: MarkTarget[]; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  const n = targets.length;
  return (
    <CenterDialog
      open
      title="Mark collection done?"
      subtitle={n === 1 ? targets[0]!.name : `${n.toLocaleString("en-IN")} companies`}
      onClose={() => !busy && onCancel()}
      accentBar="linear-gradient(90deg, #475569 0%, #1E293B 100%)"
      width={520}
      footer={
        <>
          <button type="button" disabled={busy} onClick={onCancel} className="h-9 rounded-lg border border-hairline-strong bg-white px-3.5 text-[13.5px] font-semibold text-ink-soft hover:bg-[#F8FAFD] disabled:opacity-50">
            Cancel
          </button>
          <button type="button" disabled={busy} onClick={onConfirm} className="h-9 rounded-lg px-4 text-[13.5px] font-semibold text-white disabled:opacity-50" style={{ background: "#1E293B" }}>
            {busy ? "Saving…" : n === 1 ? "Yes, collection done" : `Yes, mark ${n.toLocaleString("en-IN")} done`}
          </button>
        </>
      }
    >
      <p className="text-[13.5px] text-ink-soft">
        {n === 1 ? "This company moves" : "These companies move"} to the bottom of the Collection Tracker, faded, and {n === 1 ? "stays" : "stay"} there for everyone until
        someone undoes it. Nothing is deleted: comments, commitments, escalations and balances are kept, and nothing moves to Collection Logs. Who marked it and when is recorded.
      </p>
      {n > 1 && (
        <ul className="mt-3 grid gap-0.5 text-[13px] text-ink-strong" aria-label="Companies to mark">
          {targets.slice(0, LISTED).map((t) => (
            <li key={t.id} className="truncate">
              {t.name}
            </li>
          ))}
          {n > LISTED && <li className="text-ink-subtle">and {(n - LISTED).toLocaleString("en-IN")} more</li>}
        </ul>
      )}
    </CenterDialog>
  );
}

/**
 * The row's ⋯ menu. Only the entries the viewer may use are offered (decided on
 * the server): Mark as priority / Remove priority with collection.priority.set,
 * Collection done / Undo collection done with collection.done.set. A done
 * company offers its undo (and removing a lingering priority mark) — marking it
 * priority while done would change nothing visible.
 */
export function MarkMenu({
  target,
  marks,
  canSetPriority,
  canSetDone,
  storageReady,
  pending,
  onRun,
}: {
  target: MarkTarget;
  marks: CompanyMarks | null | undefined;
  canSetPriority: boolean;
  canSetDone: boolean;
  storageReady: boolean;
  pending: boolean;
  onRun: (targets: MarkTarget[], kind: MarkKind, active: boolean) => void;
}) {
  const state = markStateOf(marks);
  const items: { label: string; icon: React.ReactNode; kind: MarkKind; active: boolean }[] = [];
  if (canSetPriority) {
    if (marks?.priority) items.push({ label: "Remove priority", icon: <Undo2 size={15} />, kind: "priority", active: false });
    else if (state !== "done") items.push({ label: "Mark as priority", icon: <Flag size={15} />, kind: "priority", active: true });
  }
  if (canSetDone) {
    if (state === "done") items.push({ label: "Undo collection done", icon: <Undo2 size={15} />, kind: "done", active: false });
    else items.push({ label: "Collection done", icon: <CheckCircle2 size={15} />, kind: "done", active: true });
  }
  if (items.length === 0) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={pending || !storageReady}
          aria-label={`Actions for ${target.name}`}
          title={storageReady ? "Priority / Collection done" : MARKS_NOT_READY}
          className="inline-flex size-8 items-center justify-center rounded-lg border border-hairline-strong bg-white text-ink-soft hover:border-[#9fb2d1] hover:text-ink-strong disabled:opacity-50"
        >
          <MoreHorizontal size={15} strokeWidth={2.4} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[12rem]">
        <DropdownMenuLabel>{target.name}</DropdownMenuLabel>
        {items.map((it) => (
          <DropdownMenuItem key={it.label} className="text-[13.5px]" onSelect={() => onRun([target], it.kind, it.active)}>
            {it.icon}
            {it.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The pill beside the company name saying which group the row is in; nothing for pending. */
export function MarkBadge({ marks }: { marks: CompanyMarks | null | undefined }) {
  const state = markStateOf(marks);
  if (state === "pending") return null;
  const info = state === "done" ? marks!.done! : marks!.priority!;
  const title = `${STATE_LABELS[state]}${info.setByName ? ` · ${info.setByName}` : ""}, ${fmtDateTime(info.setAt)}`;
  return (
    <span
      data-mark={state}
      title={title}
      className="ml-2 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 align-middle text-[11px] font-bold"
      style={state === "done" ? { background: "#E2E8F0", color: "#334155" } : { background: "#FDE68A", color: "#713F12" }}
    >
      {state === "done" ? <CheckCircle2 size={11} aria-hidden /> : <Flag size={11} aria-hidden />}
      {STATE_LABELS[state]}
    </span>
  );
}

/**
 * The row's colouring by group. Priority: a full yellow row with a yellow
 * edge, dark text kept as it is (readable). Done: the whole row faded and
 * desaturated but still legible and clickable — undo lives in its menu. These
 * take precedence over the overdue tint, whose badge stays beside the name.
 */
export function markRowStyle(state: MarkState): React.CSSProperties | undefined {
  if (state === "priority") return { background: "#FEF9C3", boxShadow: "inset 3px 0 0 #CA8A04" };
  if (state === "done") return { background: "#F8FAFC", opacity: 0.6, filter: "grayscale(0.5)" };
  return undefined;
}
