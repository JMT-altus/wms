"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import * as Dialog from "@radix-ui/react-dialog";
import { ExternalLink, X } from "lucide-react";
import { toast } from "sonner";
import {
  KIND_LABEL,
  durationDays,
  formatDuration,
  formatPlanDate,
  hasSchedule,
  hasTask,
  isExecutable,
  parseDuration,
  toYmd,
  type PlanKind,
} from "@/lib/plan/levels";
import type { TableRow } from "@/lib/plan/table";
import type { PlanNode } from "@/lib/queries/plan";
import { deletePlanNode } from "@/app/(project)/project-plan/actions";
import { PlanEditDialog } from "./plan-edit-dialog";
import { PLAN_GRADIENT, PLAN_GRADIENT_BAR, PLAN_RED, TABULAR } from "./theme";

/**
 * The hierarchy table's three dialogs — detail, edit and the delete
 * confirmation.
 *
 * One file because they share a shell and a submit shape; splitting them would
 * mean three copies of the same header, footer and error handling.
 *
 * There is deliberately NO bulk edit form. Editing is one row at a time on
 * both plan surfaces — the selection bar's per-field menus are how one field
 * is changed across a tick, and a second form free to write six fields at once
 * only ever disagreed with this one.
 */

export type PlanDialog =
  | { mode: "detail" | "edit"; row: TableRow<PlanNode> }
  | { mode: "delete"; row: TableRow<PlanNode>; impact?: { nodes: number; tasks: number } };

interface Props {
  dialog: PlanDialog;
  employees: { id: string; name: string }[];
  onClose: () => void;
  onDone: () => void;
}

export function PlanRowDialogs({ dialog, employees, onClose, onDone }: Props) {
  // ONE edit dialog for the whole module. The hierarchy table used to carry
  // its own, which meant every change to the register's had to be made twice
  // — and the two had already drifted apart on labels and field order.
  if (dialog.mode === "edit") {
    return (
      <PlanEditDialog
        node={dialog.row.node}
        refLabel={dialog.row.ref}
        employees={employees}
        onClose={onClose}
        onDone={onDone}
      />
    );
  }

  return (
    <Shell
      title={
        dialog.mode === "detail"
          ? dialog.row.node.name
          : `Delete this ${KIND_LABEL[dialog.row.node.kind].toLowerCase()}?`
      }
      subtitle={
        dialog.mode === "detail"
          ? `${KIND_LABEL[dialog.row.node.kind]} · ${dialog.row.fullRef}`
          : "This is permanent. Deleted rows cannot be restored."
      }
      onClose={onClose}
    >
      {dialog.mode === "detail" && <Detail row={dialog.row} />}
      {dialog.mode === "delete" && (
        <DeleteConfirm
          row={dialog.row}
          impact={dialog.impact}
          onDone={onDone}
          onClose={onClose}
        />
      )}
    </Shell>
  );
}

function Shell({
  title,
  subtitle,
  children,
  onClose,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  return (
    <Dialog.Root open onOpenChange={(v) => !v && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay
          className="fixed inset-0 z-[60]"
          style={{ background: "rgba(15, 23, 42, 0.45)", backdropFilter: "blur(4px)" }}
        />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-[70] -translate-x-1/2 -translate-y-1/2 rounded-section border border-hairline bg-surface-card shadow-xl overflow-hidden flex flex-col"
          style={{ width: `min(760px, calc(100vw - 48px))`, maxHeight: "calc(100vh - 48px)" }}
        >
          <div
            className="relative px-6 py-4 shrink-0"
            style={{ borderBottom: "1px solid var(--color-hairline)" }}
          >
            <span
              aria-hidden
              className="absolute inset-x-0 top-0 h-[3px]"
              style={{ background: PLAN_GRADIENT_BAR }}
            />
            <Dialog.Title
              className="text-ink-strong font-black pr-8"
              style={{ fontSize: 20, letterSpacing: "-0.015em" }}
            >
              {title}
            </Dialog.Title>
            {subtitle && (
              <Dialog.Description
                className="mt-0.5 text-[13px]"
                style={{ color: "var(--color-ink-muted)" }}
              >
                {subtitle}
              </Dialog.Description>
            )}
            <Dialog.Close
              className="absolute right-4 top-4 grid place-items-center rounded-lg size-8"
              aria-label="Close"
              style={{ color: "var(--color-ink-subtle)" }}
            >
              <X size={16} strokeWidth={2.4} />
            </Dialog.Close>
          </div>
          <div className="overflow-y-auto min-h-0 px-6 py-5">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/* ── Detail ──────────────────────────────────────────────────────────────── */

function Detail({ row }: { row: TableRow<PlanNode> }) {
  const n = row.node;
  const days = durationDays(n.startsAt, n.endsAt);
  return (
    <div className="grid gap-3">
      {/* The full ref belongs HERE, in a detail panel — never as a column, where
          a stack of P3M3RDA5SA1 strings is unreadable. */}
      <Field label="Full reference">
        <code style={{ ...TABULAR, fontSize: 13.5, color: PLAN_RED }}>{row.fullRef}</code>
      </Field>
      {row.path && <Field label="Path">{row.path}</Field>}
      <Field label="Level">{KIND_LABEL[n.kind]}</Field>
      {n.description && <Field label="Description">{n.description}</Field>}
      {!isExecutable(n.kind) && n.notes && (
        <Field label="Initiator notes">{n.notes}</Field>
      )}
      <Field label="Initiator">{n.initiatorName ?? "—"}</Field>
      <Field label="Doer">{n.ownerName ?? "—"}</Field>
      <Field label="Target date">{formatPlanDate(n.targetDate) || "—"}</Field>
      {hasSchedule(n.kind) && (
        <>
          <Field label="Start">{formatPlanDate(n.startsAt) || "—"}</Field>
          <Field label="End">{formatPlanDate(n.endsAt) || "—"}</Field>
          <Field label="Days">{days == null ? "—" : `${days}`}</Field>
          <Field label="Estimate">{formatDuration(n.durationMinutes) || "—"}</Field>
        </>
      )}
      {n.category && <Field label="Category">{n.category}</Field>}
      {n.purpose && <Field label="Purpose">{n.purpose}</Field>}
      {hasTask(n.kind) && (
        <Field label="WMS task">
          {n.task ? (
            <Link
              href={`/tasks/${n.task.id}` as Route}
              className="inline-flex items-center gap-1 hover:underline"
              style={{ color: PLAN_RED }}
            >
              {n.task.taskNo ? `#${n.task.taskNo}` : "Open the task"}
              <ExternalLink size={11} strokeWidth={2.6} />
            </Link>
          ) : (
            <span style={{ color: "var(--color-ink-subtle)" }}>
              Not scheduled — needs an owner and a target date.
            </span>
          )}
        </Field>
      )}
      {n.links && n.links.length > 0 && (
        <Field label="Links">
          <span className="grid gap-0.5">
            {n.links.map((url) => (
              <a
                key={url}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="truncate hover:underline"
                style={{ color: PLAN_RED }}
              >
                {url}
              </a>
            ))}
          </span>
        </Field>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5 sm:grid-cols-[150px_1fr] sm:gap-3">
      <span
        className="text-[12.5px] font-semibold"
        style={{ color: "var(--color-ink-subtle)" }}
      >
        {label}
      </span>
      <span
        className="text-[14px] min-w-0 break-words"
        style={{ color: "var(--color-ink)" }}
      >
        {children}
      </span>
    </div>
  );
}

/* ── Edit ────────────────────────────────────────────────────────────────── */

/* ── Delete ──────────────────────────────────────────────────────────────── */

function DeleteConfirm({
  row,
  impact,
  onDone,
  onClose,
}: {
  row: TableRow<PlanNode>;
  impact?: { nodes: number; tasks: number };
  onDone: () => void;
  onClose: () => void;
}) {
  const [pending, startTransition] = React.useTransition();
  const cancelRef = React.useRef<HTMLButtonElement>(null);

  // Cancel is focused on open, so the safe answer is the one you get by reflex.
  React.useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  function remove() {
    startTransition(async () => {
      const res = await deletePlanNode(row.node.id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(
        res.tasks > 0
          ? `Deleted ${res.nodes} rows and ${res.tasks} tasks.`
          : `Deleted ${res.nodes} rows.`,
      );
      onDone();
    });
  }

  return (
    <div className="grid gap-4">
      {/* The name is the SUBJECT of this dialog, not a phrase inside a
          sentence — set on its own line it reads as "this row", instead of the
          sentence its words happen to spell out when run together with the
          rest. */}
      <div className="grid gap-0.5">
        <span
          className="font-black leading-snug"
          style={{ fontSize: 16, color: "var(--color-ink-strong)" }}
        >
          {row.node.name}
        </span>
        <span className="text-[13.5px]" style={{ color: "var(--color-ink-muted)" }}>
          {KIND_LABEL[row.node.kind]} · <span style={TABULAR}>{row.fullRef}</span> —
          everything under it goes too.
        </span>
      </div>
      {impact && (
        // Say exactly what is about to disappear, rather than "are you sure?".
        <div
          className="rounded-xl p-3.5 text-[14px]"
          style={{
            background: "color-mix(in srgb, #DC2626 7%, transparent)",
            border: "1px solid color-mix(in srgb, #DC2626 22%, transparent)",
            color: "var(--color-ink)",
          }}
        >
          <p>
            <strong style={TABULAR}>{impact.nodes}</strong> plan{" "}
            {impact.nodes === 1 ? "row" : "rows"}
            {impact.tasks > 0 && (
              <>
                {" "}and <strong style={TABULAR}>{impact.tasks}</strong>{" "}
                {impact.tasks === 1 ? "task" : "tasks"} — which also come off the
                task list and the calendar
              </>
            )}
            .
          </p>
        </div>
      )}
      <div className="flex items-center justify-end gap-2">
        <button
          ref={cancelRef}
          type="button"
          onClick={onClose}
          className="rounded-lg px-3.5 h-9 text-[14px] font-semibold"
          style={{
            color: "var(--color-ink-muted)",
            border: "1px solid var(--color-hairline-strong)",
          }}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={remove}
          disabled={pending}
          className="rounded-lg px-4 h-9 text-[14px] font-bold text-white disabled:opacity-50"
          style={{ background: "#DC2626" }}
        >
          {pending ? "Deleting…" : "Delete"}
        </button>
      </div>
    </div>
  );
}

/* ── Small pieces ────────────────────────────────────────────────────────── */

const fieldStyle: React.CSSProperties = {
  background: "var(--color-surface-card)",
  border: "1px solid var(--color-hairline-strong)",
  color: "var(--color-ink)",
};

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="block mb-1 text-[12.5px] font-semibold"
      style={{ color: "var(--color-ink-muted)" }}
    >
      {children}
    </span>
  );
}

function Input({
  label,
  value,
  onChange,
  type,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <Label>{label}</Label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg px-2.5 h-9 text-[14px] outline-none focus:ring-1"
        style={type === "date" ? { ...fieldStyle, ...TABULAR } : fieldStyle}
      />
    </label>
  );
}

function Textarea({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <Label>{label}</Label>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        className="w-full rounded-lg px-2.5 py-2 text-[14px] outline-none focus:ring-1"
        style={fieldStyle}
      />
    </label>
  );
}

function Footer({
  onCancel,
  onSave,
  pending,
  label = "Save",
}: {
  onCancel: () => void;
  onSave: () => void;
  pending: boolean;
  label?: string;
}) {
  return (
    <div className="flex items-center justify-end gap-2 pt-1">
      <button
        type="button"
        onClick={onCancel}
        className="rounded-lg px-3.5 h-9 text-[14px] font-semibold"
        style={{
          color: "var(--color-ink-muted)",
          border: "1px solid var(--color-hairline-strong)",
        }}
      >
        Cancel
      </button>
      <button
        type="button"
        onClick={onSave}
        disabled={pending}
        className="rounded-lg px-4 h-9 text-[14px] font-bold text-white disabled:opacity-50"
        style={{ background: PLAN_GRADIENT }}
      >
        {pending ? "Saving…" : label}
      </button>
    </div>
  );
}
