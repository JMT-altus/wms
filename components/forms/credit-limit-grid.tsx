"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ArrowDownRight, ArrowUpRight, CircleSlash, Sparkles } from "lucide-react";
import { formatInr } from "@/lib/format";
import type { CreditLimitChange } from "@/lib/masters/credit-limit";
import type { ClientMasterRow } from "@/lib/queries/client-kyc";
import type { EmployeeOption } from "@/lib/queries/employees";
import { updateClientMasterRecord } from "@/app/(forms-module)/forms/client-kyc/actions";
import { MasterGrid, type GridCol } from "@/components/admin/master/master-grid";
import type { SaveResult } from "@/components/admin/master/inline-edit";
import {
  clientGridCells,
  clientGridPayload,
  type ClientGridCells,
} from "./client-master-grid";
import { KYC_ACCENT, KYC_ACCENT_SOFT } from "./kyc/tokens";

/**
 * Credit Limit — Grid View.
 *
 * The section's other half. The Table view is the HISTORY: what changed, which
 * way, who did it — a record, and nothing there is editable because nothing
 * there should be. This is where the limits are actually set: one row per
 * client, the credit terms as cells, edit down the column.
 *
 * The two feed each other. Every edit made here writes through
 * `updateClientMasterRecord`, which logs the change, so a review pass done in
 * this grid shows up as rows in the history the moment it is done.
 *
 * Only the credit terms are offered — limit, days, payment terms, and the
 * grade a limit is usually argued from. The rest of a client is the Client
 * Master's grid; a credit review that can also rename the company is a worse
 * screen, not a better one.
 */

/** The columns that make up a credit decision, and nothing else. */
const CREDIT_KEYS = ["creditLimit", "creditDays", "paymentTerms", "grade"] as const;

/**
 * How far one click moves a limit. Shift-click moves ten times that, so a
 * lakh is two clicks — see the stepper in `MasterGrid`.
 */
const LIMIT_STEP = 1000;

const TONE = {
  increased: { color: "var(--color-green-deep)", soft: "color-mix(in srgb, var(--color-green) 12%, transparent)" },
  decreased: { color: "var(--color-red-deep)", soft: "color-mix(in srgb, var(--color-red) 12%, transparent)" },
  set: { color: KYC_ACCENT, soft: KYC_ACCENT_SOFT },
  cleared: { color: "var(--color-ink-muted)", soft: "var(--color-surface-soft)" },
} as const;

/** The table view's own wording for a direction, so the two never diverge. */
export const CHANGE_LABEL = {
  increased: "Increased",
  decreased: "Decreased",
  set: "First set",
  cleared: "Cleared",
} as const;

/**
 * Each client's most recent move, by client id.
 *
 * Exported because the section's filter chips need the same reading: a chip
 * set to Decreased has to leave standing exactly the rows whose Last Change
 * cell says Decreased, and two separate derivations of "last" would drift.
 */
export function lastChangeByClient(
  changes: CreditLimitChange[],
): Map<string, CreditLimitChange> {
  const out = new Map<string, CreditLimitChange>();
  // Newest first out of the query, so the first one seen per client wins.
  for (const c of changes) if (!out.has(c.customerId)) out.set(c.customerId, c);
  return out;
}

const money = (v: string | null) => (v === null ? "—" : formatInr(Number(v)));

/** The signed difference, exactly as the history table writes it. */
function difference(c: CreditLimitChange): string {
  return `${c.delta > 0 ? "+" : c.delta < 0 ? "−" : ""}${formatInr(Math.abs(c.delta))}`;
}

export function CreditLimitGrid({
  clients,
  changes,
  salesPeople,
  paymentTerms,
  toolbar,
  leading,
  emptyTitle,
}: {
  clients: ClientMasterRow[];
  /**
   * The history, so each row can carry its own last move.
   *
   * A limit is rarely judged cold — "is ₹5,00,000 right" is a harder question
   * than "was it just raised by two lakh". The Table view holds the whole
   * record; this puts the one line of it that bears on the edit being made
   * right beside the cell making it.
   */
  changes: CreditLimitChange[];
  /** Only to rebuild the full client payload — no picker shows them here. */
  salesPeople: EmployeeOption[];
  /** The admin-managed Payment Terms list, as the KYC form offers it. */
  paymentTerms: string[];
  /** The view switch, rendered in the sheet's header bar. */
  toolbar?: React.ReactNode;
  /** The All / Increased / Decreased chips, beside the title. */
  leading?: React.ReactNode;
  /** What the sheet says when a chip has filtered every client out. */
  emptyTitle?: string;
}) {
  const router = useRouter();

  const lastChange = React.useMemo(() => lastChangeByClient(changes), [changes]);

  const salesIdByName = React.useMemo(
    () => new Map(salesPeople.map((e) => [e.name, e.id])),
    [salesPeople],
  );

  const columns = React.useMemo<GridCol<ClientMasterRow>[]>(
    () => [
      // Who, pinned and read-only. Renaming a client is not a credit review.
      {
        key: "name",
        label: "Client",
        width: 240,
        kind: "text",
        frozen: true,
        readOnly: true,
        get: (r) => r.name,
      },
      {
        key: "code",
        label: "Client Number",
        width: 130,
        kind: "text",
        frozen: true,
        readOnly: true,
        mono: true,
        get: (r) => r.code ?? "",
      },
      // The one cell the screen exists for, and the only one with buttons:
      // a review moves a limit up or down far more often than it types a
      // fresh figure, so that move is a click.
      {
        key: "creditLimit",
        label: "Credit Limit",
        width: 190,
        kind: "number",
        step: LIMIT_STEP,
        get: (r) => r.creditLimit ?? "",
      },
      // The history's own columns, carried onto the sheet: the same pill, the
      // same From → To, the same signed difference. A limit being edited here
      // is a limit being judged, and the judgement is made against what it
      // last did — reading that in the table and then coming back to type is
      // the trip this column set removes.
      {
        key: "lastChange",
        label: "Last Change",
        width: 150,
        kind: "text",
        readOnly: true,
        get: (r) => {
          const c = lastChange.get(r.id);
          return c ? CHANGE_LABEL[c.direction] : "";
        },
        render: (r) => {
          const c = lastChange.get(r.id);
          if (!c) return <span className="text-ink-subtle">Never changed</span>;
          const tone = TONE[c.direction];
          return (
            <span
              className="inline-flex items-center gap-1 rounded-pill px-2 py-0.5 font-semibold"
              style={{ fontSize: 11.5, background: tone.soft, color: tone.color }}
              title={`${CHANGE_LABEL[c.direction]} by ${c.changedByName ?? "someone"}`}
            >
              {c.direction === "increased" && <ArrowUpRight size={12} strokeWidth={2.8} />}
              {c.direction === "decreased" && <ArrowDownRight size={12} strokeWidth={2.8} />}
              {c.direction === "set" && <Sparkles size={12} strokeWidth={2.6} />}
              {c.direction === "cleared" && <CircleSlash size={12} strokeWidth={2.6} />}
              {CHANGE_LABEL[c.direction]}
            </span>
          );
        },
      },
      {
        key: "from",
        align: "right",
        label: "From",
        width: 130,
        kind: "text",
        readOnly: true,
        get: (r) => {
          const c = lastChange.get(r.id);
          return c ? money(c.previousLimit) : "";
        },
        render: (r) => {
          const c = lastChange.get(r.id);
          return (
            <span className="block text-right tabular-nums text-ink-muted">
              {c ? money(c.previousLimit) : "—"}
            </span>
          );
        },
      },
      {
        key: "to",
        align: "right",
        label: "To",
        width: 130,
        kind: "text",
        readOnly: true,
        get: (r) => {
          const c = lastChange.get(r.id);
          return c ? money(c.newLimit) : "";
        },
        render: (r) => {
          const c = lastChange.get(r.id);
          return (
            <span className="block text-right tabular-nums font-bold text-ink-strong">
              {c ? money(c.newLimit) : "—"}
            </span>
          );
        },
      },
      {
        key: "difference",
        align: "right",
        label: "Difference",
        width: 135,
        kind: "text",
        readOnly: true,
        get: (r) => {
          const c = lastChange.get(r.id);
          return c ? difference(c) : "";
        },
        render: (r) => {
          const c = lastChange.get(r.id);
          if (!c) return <span className="block text-right text-ink-subtle">—</span>;
          return (
            <span
              className="block text-right tabular-nums font-semibold"
              style={{ color: TONE[c.direction].color }}
            >
              {difference(c)}
            </span>
          );
        },
      },
      {
        key: "creditDays",
        label: "Credit Days",
        width: 150,
        kind: "number",
        get: (r) => (r.creditDays === null ? "" : String(r.creditDays)),
      },
      {
        key: "paymentTerms",
        label: "Payment Terms",
        width: 190,
        kind: "select",
        freeText: true,
        options: paymentTerms,
        get: (r) => r.paymentTerms ?? "",
      },
      {
        key: "grade",
        label: "Grade",
        width: 120,
        kind: "select",
        options: ["A", "B", "C"],
        get: (r) => r.grade ?? "",
      },
    ],
    [paymentTerms, lastChange],
  );

  /**
   * Write one row.
   *
   * The whole client each time, rebuilt from the row with only the credit
   * cells overridden — `updateClientMasterRecord` takes a complete record, and
   * a narrower write path built just for this screen would be a second way to
   * update a client that could quietly stop matching the others.
   */
  const save = React.useCallback(
    async (row: ClientMasterRow, cells: ClientGridCells): Promise<SaveResult> => {
      const full: ClientGridCells = { ...clientGridCells(row) };
      for (const k of CREDIT_KEYS) full[k] = cells[k] ?? "";

      const res = await updateClientMasterRecord(row.id, clientGridPayload(full, salesIdByName));
      if (!res.ok) return { ok: false, error: res.error };
      router.refresh();
      return { ok: true };
    },
    [router, salesIdByName],
  );

  return (
    <MasterGrid
      rows={clients}
      columns={columns}
      title="Credit Limit"
      primaryKey="name"
      primarySearchLabel="Search client"
      accent={KYC_ACCENT}
      accentSoft={KYC_ACCENT_SOFT}
      toolbar={toolbar}
      leading={leading}
      emptyTitle={emptyTitle}
      save={save}
      noun="clients"
    />
  );
}
