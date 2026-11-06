"use client";

import { useState, useTransition } from "react";
import { ChevronDown, ChevronUp, MoreHorizontal, Archive, ArchiveRestore, Trash2, Check, ReceiptText } from "lucide-react";
import { fireToast } from "@/lib/toast";
import {
  setModuleAdminFields,
  decideModule,
  setModuleArchived,
  deleteModuleSubmission,
} from "@/app/(app)/forms/actions";
import { visibleFields, fieldPairs, type FormFieldDef } from "@/lib/forms/field-types";
import type { ModuleSubmissionRow } from "@/lib/queries/modules";
import { formatDate } from "@/lib/format";
import { Field, FieldInput } from "./form-fields";

type Status = "pending" | "approved" | "rejected";

const PENDING_STYLE = { bg: "rgba(245,158,11,0.12)", fg: "#B45309" };
const STATUS_STYLE: Record<string, { bg: string; fg: string }> = {
  pending: PENDING_STYLE,
  approved: { bg: "rgba(22,163,74,0.12)", fg: "#15803D" },
  rejected: { bg: "rgba(10,108,255,0.10)", fg: "#0751BE" },
};

export function ModuleList({
  rows,
  isAdmin,
  requestFields,
  adminFields,
  productOptions,
  grantLabel = "Approve",
  approvedLabel = "Approved",
  view = "active",
  primaryKey,
  layout = "cards",
}: {
  rows: ModuleSubmissionRow[];
  isAdmin: boolean;
  requestFields: FormFieldDef[];
  adminFields: FormFieldDef[];
  productOptions: string[];
  grantLabel?: string;
  approvedLabel?: string;
  view?: "active" | "archived";
  /** request field key shown as the card's headline (e.g. expense_for). */
  primaryKey?: string;
  /** "table" — the Reimbursements page's WMS table; "cards" (default) for the other modules. */
  layout?: "cards" | "table";
}) {
  if (layout === "table") {
    return (
      <SubmissionTable rows={rows} isAdmin={isAdmin} requestFields={requestFields} adminFields={adminFields} productOptions={productOptions}
        grantLabel={grantLabel} approvedLabel={approvedLabel} view={view} primaryKey={primaryKey} />
    );
  }
  if (rows.length === 0) {
    return <p className="text-[15px] text-ink-subtle">{view === "archived" ? "Nothing archived." : "No submissions yet."}</p>;
  }
  return (
    <ul className="space-y-3">
      {rows.map((r) => (
        <Card key={r.id} row={r} isAdmin={isAdmin} requestFields={requestFields} adminFields={adminFields}
          productOptions={productOptions} grantLabel={grantLabel} approvedLabel={approvedLabel} view={view} primaryKey={primaryKey} />
      ))}
    </ul>
  );
}

function Card({
  row, isAdmin, requestFields, adminFields, productOptions, grantLabel, approvedLabel, view, primaryKey,
}: {
  row: ModuleSubmissionRow;
  isAdmin: boolean;
  requestFields: FormFieldDef[];
  adminFields: FormFieldDef[];
  productOptions: string[];
  grantLabel: string;
  approvedLabel: string;
  view: "active" | "archived";
  primaryKey?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const { pending, decide } = useDecision(row.id, approvedLabel);
  const style = STATUS_STYLE[row.status] ?? PENDING_STYLE;
  const statusText = row.status === "approved" ? approvedLabel : row.status === "rejected" ? "Rejected" : "Pending";

  const headline =
    (primaryKey && row.fields[primaryKey]) ||
    requestFields.map((f) => row.fields[f.key]).find((v) => v) ||
    "Submission";

  const pairs = fieldPairs(visibleFields(requestFields, row.fields), row.fields);
  const adminPairs = fieldPairs(adminFields, row.adminFields);

  return (
    <li className="rounded-section bg-surface-card p-5 max-md:p-4" style={{ border: "1px solid var(--color-hairline)", boxShadow: "0 1px 3px rgba(15,23,42,0.04)" }}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5 flex-wrap">
            <span className="text-[16px] font-semibold text-ink-strong break-words">{headline}</span>
            <span className="rounded-pill px-2.5 py-0.5 text-[12px] font-bold" style={{ background: style.bg, color: style.fg }}>{statusText}</span>
          </div>
          <p className="text-[13.5px] text-ink-subtle mt-1">
            {isAdmin ? `${row.employeeName} · ` : ""}{formatDate(row.createdAt)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && row.status !== "approved" && (
            <button type="button" disabled={pending} onClick={() => decide("approved")}
              className="rounded-md px-3.5 py-2 text-[13px] font-semibold text-white disabled:opacity-50" style={{ background: "linear-gradient(135deg, #16A34A, #15803D)" }}>
              {grantLabel}
            </button>
          )}
          {isAdmin && row.status !== "rejected" && (
            <button type="button" disabled={pending} onClick={() => decide("rejected")}
              className="rounded-md px-3.5 py-2 text-[13px] font-semibold disabled:opacity-50" style={{ background: "rgba(10,108,255,0.08)", color: "#0751BE", border: "1px solid rgba(10,108,255,0.25)" }}>
              Reject
            </button>
          )}
          <button type="button" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}
            className="inline-flex items-center gap-1 rounded-md px-2.5 py-2 text-[13px] font-medium text-ink-soft hover:bg-surface-soft">
            {expanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />} Details
          </button>
          {isAdmin && <CardMenu row={row} view={view} />}
        </div>
      </div>

      {expanded && (
        <div className="mt-4 border-t pt-4" style={{ borderColor: "var(--color-hairline)" }}>
          <dl className="grid grid-cols-2 max-md:grid-cols-1 gap-x-6 gap-y-2.5">
            {pairs.map(([label, value]) => (
              <div key={label}>
                <dt className="text-[12px] font-semibold uppercase tracking-wide text-ink-subtle">{label}</dt>
                <dd className="text-[14.5px] text-ink-strong mt-0.5 break-words">{value}</dd>
              </div>
            ))}
          </dl>
          {!isAdmin && adminPairs.length > 0 && (
            <dl className="mt-3 grid grid-cols-2 max-md:grid-cols-1 gap-x-6 gap-y-2.5">
              {adminPairs.map(([label, value]) => (
                <div key={label}>
                  <dt className="text-[12px] font-semibold uppercase tracking-wide text-altus-red">{label}</dt>
                  <dd className="text-[14.5px] text-ink-strong mt-0.5 break-words">{value}</dd>
                </div>
              ))}
            </dl>
          )}
          {isAdmin && adminFields.length > 0 && (
            <AdminPanel row={row} adminFields={adminFields} productOptions={productOptions} />
          )}
        </div>
      )}
    </li>
  );
}

/** Approve / reject / reopen one submission — the same action and messages for the cards and the table. */
function useDecision(id: string, approvedLabel: string) {
  const [pending, start] = useTransition();
  function decide(status: Status) {
    start(async () => {
      const res = await decideModule({ id, status });
      fireToast(res.ok
        ? { message: status === "approved" ? `${approvedLabel}.` : status === "rejected" ? "Rejected." : "Reopened.", type: status === "rejected" ? "info" : "success" }
        : { message: res.error, type: "error" });
    });
  }
  return { pending, decide };
}

/* ── The Reimbursements page's WMS table ─────────────────────────────────── */

const WMS_STATUS: Record<string, { bg: string; fg: string; line: string }> = {
  pending: { bg: "#FFF7E6", fg: "#B45309", line: "#F6DDA6" },
  approved: { bg: "#EAF7EF", fg: "#15803D", line: "#BFE5CD" },
  rejected: { bg: "#FDEEEE", fg: "#B91C1C", line: "#F5C2C2" },
};
const TH_CLS = "whitespace-nowrap px-3 py-2 text-left text-[12px] font-semibold text-[#334155]";

/** An amount as entered, shown in rupees when it is a number (display only — nothing is recalculated). */
function money(v: string | undefined): string {
  if (!v) return "—";
  const n = Number(v.replace(/[,₹\s]/g, ""));
  return Number.isFinite(n) ? `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}` : v;
}
function day(v: string | undefined): string {
  if (!v) return "—";
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? formatDate(new Date(`${v}T00:00:00`)) : v;
}

/**
 * Submissions as a WMS table: Expense, Employee (admins), Expense date, Amount, Expense head, Submitted, Status and the
 * actions. Details open in a row underneath — every request field, the review (who decided and when), the admin
 * response, and for admins the response form. The same actions, messages and fields as the cards.
 */
function SubmissionTable({
  rows, isAdmin, requestFields, adminFields, productOptions, grantLabel, approvedLabel, view, primaryKey,
}: {
  rows: ModuleSubmissionRow[];
  isAdmin: boolean;
  requestFields: FormFieldDef[];
  adminFields: FormFieldDef[];
  productOptions: string[];
  grantLabel: string;
  approvedLabel: string;
  view: "active" | "archived";
  primaryKey?: string;
}) {
  if (rows.length === 0) {
    return (
      <div className="rounded-xl border border-[#DCE4F0] bg-white px-6 py-10 text-center shadow-[0_1px_2px_rgba(11,31,68,0.05)]" data-testid="module-empty">
        <ReceiptText size={26} className="mx-auto mb-2 text-[#94A3B8]" aria-hidden />
        <p className="text-[14px] font-semibold text-[#0B1F44]">{view === "archived" ? "Nothing archived." : "No submissions yet."}</p>
        <p className="mx-auto mt-1 max-w-[56ch] text-[12.5px] text-[#64748B]">
          {view === "archived"
            ? "Archived submissions appear here; restore or delete them from the ⋯ menu."
            : "Raise an expense with Request Reimbursement — it appears here with its amount, dates and approval status."}
        </p>
      </div>
    );
  }
  const cols = isAdmin ? 8 : 7;
  return (
    <div className="rounded-xl border border-[#DCE4F0] bg-white shadow-[0_1px_2px_rgba(11,31,68,0.05)] max-md:overflow-x-auto">
      <table className="w-full border-collapse text-[13px] max-md:min-w-[860px]" aria-label="Submissions">
        <thead>
          <tr style={{ background: "#F5F7FB" }}>
            <th scope="col" className={`${TH_CLS} rounded-tl-xl`}>Expense</th>
            {isAdmin && <th scope="col" className={TH_CLS}>Employee</th>}
            <th scope="col" className={TH_CLS}>Expense date</th>
            <th scope="col" className={`${TH_CLS} !text-right`}>Amount</th>
            <th scope="col" className={TH_CLS}>Expense head</th>
            <th scope="col" className={TH_CLS}>Submitted</th>
            <th scope="col" className={TH_CLS}>Status</th>
            <th scope="col" className={`${TH_CLS} rounded-tr-xl !text-right`}>
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <SubmissionRow key={r.id} row={r} cols={cols} isAdmin={isAdmin} requestFields={requestFields} adminFields={adminFields} productOptions={productOptions}
              grantLabel={grantLabel} approvedLabel={approvedLabel} view={view} primaryKey={primaryKey} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SubmissionRow({
  row, cols, isAdmin, requestFields, adminFields, productOptions, grantLabel, approvedLabel, view, primaryKey,
}: {
  row: ModuleSubmissionRow;
  cols: number;
  isAdmin: boolean;
  requestFields: FormFieldDef[];
  adminFields: FormFieldDef[];
  productOptions: string[];
  grantLabel: string;
  approvedLabel: string;
  view: "active" | "archived";
  primaryKey?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const { pending, decide } = useDecision(row.id, approvedLabel);
  const tone = WMS_STATUS[row.status] ?? WMS_STATUS.pending!;
  const statusText = row.status === "approved" ? approvedLabel : row.status === "rejected" ? "Rejected" : "Pending";
  const headline = (primaryKey && row.fields[primaryKey]) || requestFields.map((f) => row.fields[f.key]).find((v) => v) || "Submission";
  const pairs = fieldPairs(visibleFields(requestFields, row.fields), row.fields);
  const adminPairs = fieldPairs(adminFields, row.adminFields);
  const detailsId = `submission-${row.id}`;
  const cell = "px-3 py-2.5 align-top";

  return (
    <>
      <tr className="border-t border-[#EEF2F7]" style={expanded ? { background: "#F8FAFF" } : undefined}>
        <td className={`${cell} max-w-[300px]`}>
          <span className="block break-words font-semibold text-[#0B1F44]">{headline}</span>
          {row.fields.product && <span className="block text-[11.5px] text-[#64748B]">{row.fields.product}</span>}
        </td>
        {isAdmin && <td className={`${cell} max-w-[200px] break-words text-[#334155]`}>{row.employeeName}</td>}
        <td className={`${cell} whitespace-nowrap tabular-nums text-[#334155]`}>{day(row.fields.expense_date)}</td>
        <td className={`${cell} whitespace-nowrap text-right font-semibold tabular-nums text-[#0B1F44]`}>{money(row.fields.amount)}</td>
        <td className={`${cell} text-[#334155]`}>{row.adminFields?.expense_head || <span className="text-[#94A3B8]">—</span>}</td>
        <td className={`${cell} whitespace-nowrap tabular-nums text-[#334155]`}>{formatDate(row.createdAt)}</td>
        <td className={cell}>
          <span className="inline-block whitespace-nowrap rounded-full border px-2 py-0.5 text-[11.5px] font-semibold" style={{ background: tone.bg, color: tone.fg, borderColor: tone.line }}>
            {statusText}
          </span>
        </td>
        <td className={`${cell} py-2`}>
          <div className="flex items-center justify-end gap-1.5">
            {isAdmin && row.status !== "approved" && (
              <button type="button" disabled={pending} onClick={() => decide("approved")}
                className="inline-flex h-8 items-center rounded-lg bg-[#16A34A] px-3 text-[12.5px] font-semibold text-white transition-colors hover:bg-[#15803D] disabled:opacity-50">
                {grantLabel}
              </button>
            )}
            {isAdmin && row.status !== "rejected" && (
              <button type="button" disabled={pending} onClick={() => decide("rejected")}
                className="inline-flex h-8 items-center rounded-lg border border-[#F3C4C4] bg-white px-3 text-[12.5px] font-semibold text-[#B91C1C] transition-colors hover:bg-[#FEF2F2] disabled:opacity-50">
                Reject
              </button>
            )}
            <button type="button" onClick={() => setExpanded((v) => !v)} aria-expanded={expanded} aria-controls={detailsId}
              className="inline-flex h-8 items-center gap-1 rounded-lg border border-[#DCE4F0] bg-white px-2.5 text-[12.5px] font-semibold text-[#0B4FB8] transition-colors hover:bg-[#F5F8FC]">
              {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />} Details
            </button>
            {isAdmin && <CardMenu row={row} view={view} look="wms" />}
          </div>
        </td>
      </tr>
      {expanded && (
        <tr id={detailsId} style={{ background: "#F8FAFF" }}>
          <td colSpan={cols} className="px-3 pb-3.5 pt-0">
            <div className="rounded-lg border border-[#E2E8F0] bg-white p-3.5">
              <dl className="grid grid-cols-3 gap-x-6 gap-y-2.5 max-lg:grid-cols-2 max-md:grid-cols-1">
                {pairs.map(([label, value]) => (
                  <div key={label} className="min-w-0">
                    <dt className="text-[11.5px] font-semibold text-[#5B6B85]">{label}</dt>
                    <dd className="mt-0.5 break-words text-[13px] text-[#0B1F44]">{value}</dd>
                  </div>
                ))}
              </dl>
              {row.status !== "pending" && row.decidedAt && (
                <p className="mt-3 border-t border-[#EEF2F7] pt-2.5 text-[12px] text-[#64748B]">
                  {statusText}
                  {row.decidedByName ? ` by ${row.decidedByName}` : ""} on {formatDate(row.decidedAt)}
                </p>
              )}
              {!isAdmin && adminPairs.length > 0 && (
                <div className="mt-3 border-t border-[#EEF2F7] pt-2.5">
                  <p className="mb-2 text-[11.5px] font-semibold uppercase tracking-[0.06em] text-[#0B4FB8]">Admin response</p>
                  <dl className="grid grid-cols-3 gap-x-6 gap-y-2.5 max-lg:grid-cols-2 max-md:grid-cols-1">
                    {adminPairs.map(([label, value]) => (
                      <div key={label} className="min-w-0">
                        <dt className="text-[11.5px] font-semibold text-[#5B6B85]">{label}</dt>
                        <dd className="mt-0.5 break-words text-[13px] text-[#0B1F44]">{value}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              )}
              {isAdmin && adminFields.length > 0 && <AdminPanel row={row} adminFields={adminFields} productOptions={productOptions} look="wms" />}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function AdminPanel({ row, adminFields, productOptions, look }: { row: ModuleSubmissionRow; adminFields: FormFieldDef[]; productOptions: string[]; look?: "wms" }) {
  const [values, setValues] = useState<Record<string, string>>(row.adminFields ?? {});
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const setValue = (key: string, v: string) => setValues((p) => ({ ...p, [key]: v }));
  const visible = visibleFields(adminFields, values);

  function save() {
    setError(null);
    start(async () => {
      const res = await setModuleAdminFields({ id: row.id, adminFields: values });
      if (!res.ok) { setError(res.error); return; }
      fireToast({ message: "Saved." });
    });
  }

  if (look === "wms") {
    return (
      <div className="wms-form mt-3 border-t border-[#EEF2F7] pt-3">
        <p className="mb-2.5 text-[11.5px] font-semibold uppercase tracking-[0.06em] text-[#0B4FB8]">Admin response</p>
        <div className="grid grid-cols-3 gap-3 max-lg:grid-cols-2 max-md:grid-cols-1">
          {visible.map((f) => (
            <Field key={f.key} label={f.label} required={f.required}>
              <FieldInput field={f} value={values[f.key] ?? ""} onChange={setValue} productOptions={productOptions} isAdmin />
            </Field>
          ))}
        </div>
        {error && <div role="alert" className="mt-3 rounded-lg border border-[#FECACA] bg-[#FEF2F2] px-3 py-2 text-[13px] text-[#B91C1C]">{error}</div>}
        <div className="mt-3 flex justify-end">
          <button type="button" onClick={save} disabled={pending}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#0A6CFF] px-3.5 text-[13px] font-semibold text-white shadow-[0_1px_2px_rgba(10,108,255,0.25)] transition-colors hover:bg-[#0058D6] disabled:opacity-50">
            <Check size={14} /> {pending ? "Saving…" : "Save response"}
          </button>
        </div>
      </div>
    );
  }
  return (
    <div className="mt-4 rounded-xl border border-dashed border-hairline p-4 bg-black/[0.015]">
      <p className="text-[12px] font-black uppercase tracking-[0.05em] text-altus-red mb-3">Admin · Response</p>
      <div className="grid grid-cols-2 max-md:grid-cols-1 gap-3">
        {visible.map((f) => (
          <Field key={f.key} label={f.label} required={f.required}>
            <FieldInput field={f} value={values[f.key] ?? ""} onChange={setValue} productOptions={productOptions} isAdmin />
          </Field>
        ))}
      </div>
      {error && <div role="alert" className="mt-3 rounded-md border border-[#BFDBFE] bg-[#EFF6FF] px-3 py-2 text-[13px] text-[#0751BE]">{error}</div>}
      <button type="button" onClick={save} disabled={pending}
        className="mt-3 inline-flex items-center gap-1.5 rounded-md px-4 py-2 text-[13px] font-bold text-white disabled:opacity-50"
        style={{ background: "linear-gradient(135deg, #0A6CFF, #0751BE)" }}>
        <Check size={14} /> {pending ? "Saving…" : "Save response"}
      </button>
    </div>
  );
}

function CardMenu({ row, view, look }: { row: ModuleSubmissionRow; view: "active" | "archived"; look?: "wms" }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  function archive(next: boolean) {
    setOpen(false);
    start(async () => {
      const res = await setModuleArchived({ id: row.id, archived: next });
      fireToast(res.ok ? { message: next ? "Archived." : "Restored.", type: "success" } : { message: res.error, type: "error" });
    });
  }
  function remove() {
    setOpen(false);
    if (!confirm("Delete this submission permanently?")) return;
    start(async () => {
      const res = await deleteModuleSubmission({ id: row.id });
      fireToast(res.ok ? { message: "Deleted.", type: "success" } : { message: res.error, type: "error" });
    });
  }

  return (
    <div className="relative">
      <button type="button" disabled={pending} onClick={() => setOpen((v) => !v)} aria-label="More actions"
        className={look === "wms"
          ? "inline-flex size-8 items-center justify-center rounded-lg border border-[#DCE4F0] bg-white text-[#475569] transition-colors hover:bg-[#F5F8FC] disabled:opacity-50"
          : "inline-flex items-center justify-center size-9 rounded-md text-ink-soft hover:bg-surface-soft disabled:opacity-50"}>
        <MoreHorizontal size={16} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-30 mt-1 min-w-[160px] rounded-xl border border-hairline bg-white p-1.5 shadow-xl" style={{ boxShadow: "0 12px 28px -10px rgba(15,23,42,0.22)" }}>
            {view === "archived" ? (
              <button type="button" onClick={() => archive(false)} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-[14px] font-medium text-ink-strong hover:bg-surface-soft"><ArchiveRestore size={15} /> Restore</button>
            ) : (
              <button type="button" onClick={() => archive(true)} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-[14px] font-medium text-ink-strong hover:bg-surface-soft"><Archive size={15} /> Archive</button>
            )}
            <button type="button" onClick={remove} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-[14px] font-medium text-[#0751BE] hover:bg-[#EFF6FF]"><Trash2 size={15} /> Delete</button>
          </div>
        </>
      )}
    </div>
  );
}
