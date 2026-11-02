import { fmtDate } from "@/lib/dates";
import { excelDate, type Cell } from "@/lib/exports/xlsx-dates";
import { OUTSTANDING_CYCLE_LABELS, type OutstandingCycle } from "@/db/enums";
import type { DerivedInstallment } from "@/lib/outstanding/types";
import type { CollectionDisplayRow } from "@/lib/queries/outstanding";

/**
 * Shared column definitions + row mappers for the Outstanding exports
 * (XLSX + PDF). Mirrors lib/exports/tasks-rich.ts — human-readable labels
 * and dd/mm/yy dates rather than raw enum/ISO values (real date cells in the XLSX).
 *
 * The blank-template headers (26 Outstanding columns / 7 Collection columns)
 * match the legacy sheet import format so a downloaded template can be
 * bulk-filled and re-imported.
 */

// ── Derived-installment entries (the dashboard's "All Outstanding Entries") ──

export const OUTSTANDING_ENTRY_HEADERS = [
  "S. No.",
  "Client",
  "Product",
  "Cycle",
  "Due Date",
  "Balance",
  "Days Overdue",
  "Entity",
  "Responsible",
  "Status",
] as const;

export function cycleLabel(cycle: string | undefined): string {
  if (!cycle) return "";
  return OUTSTANDING_CYCLE_LABELS[cycle as OutstandingCycle] ?? cycle;
}

/** "yyyy-mm-dd" → "02/11/26"; an unreadable value is passed through so it is still visible. */
export function fmtDue(iso: string | null | undefined): string {
  if (!iso) return "";
  return fmtDate(iso) || iso;
}

/** How a date column is written: text for the PDF, a genuine date cell for Excel. */
export type DateCells = "text" | "excel";
const dateCell = (iso: string | null | undefined, mode: DateCells): Cell =>
  mode === "excel" ? excelDate(iso) || fmtDue(iso) : fmtDue(iso);

/** Positional array — preserves OUTSTANDING_ENTRY_HEADERS order. */
export function toEntryRowArray(
  e: DerivedInstallment,
  index: number,
  dates: DateCells = "text",
): Cell[] {
  return [
    index + 1,
    e.clientName,
    e.productName ?? "",
    cycleLabel(e.cycle),
    dateCell(e.dueDate, dates),
    e.balance,
    e.state === "overdue" ? e.daysOverdue : "",
    e.entityName ?? "",
    e.responsibleName ?? "",
    e.state === "overdue" ? "Overdue" : "Not Due",
  ];
}

// ── Collection display rows ──

export const COLLECTION_EXPORT_HEADERS = [
  "S. No.",
  "Client",
  "Amount",
  "Payment Mode",
  "Responsible",
  "Comments",
  "Collected At",
] as const;

export function toCollectionRowArray(
  c: CollectionDisplayRow,
  index: number,
  dates: DateCells = "text",
): Cell[] {
  return [
    index + 1,
    c.clientName,
    c.amount,
    c.paymentMode ?? "",
    c.responsible ?? "",
    c.comments ?? "",
    dateCell(c.collectedAt, dates),
  ];
}

// ── Blank import templates (legacy sheet column order) ──

/** The 26 Outstanding-sheet import columns. */
export const OUTSTANDING_TEMPLATE_HEADERS = [
  "S. No.",
  "First Name",
  "Last Name",
  "Cell No",
  "Product",
  "Responsible Person",
  "Amount",
  "GST",
  "Total",
  "Paid Amt",
  "Balance",
  "Payment Cycle",
  "Due Date",
  "Retainer Start Date",
  "Retainer End Date",
  "Bill Date",
  "Start Date",
  "End Date",
  "No. of Subscription",
  "Subscription Start Date",
  "Frequency",
  "Entity",
  "Payment Mode",
  "PDC Received",
  "Other Comments",
  "Attachments",
] as const;

/** The 7 Collection-sheet import columns. */
export const COLLECTION_TEMPLATE_HEADERS = [
  "S.No",
  "Name",
  "Amount",
  "Payment Mode",
  "Responsible Person",
  "Other Comments",
  "Attachments",
] as const;

export function outstandingExportFilename(
  ext: "xlsx" | "pdf",
  scope: "data" | "outstanding-template" | "collection-template" = "data",
  date: Date = new Date(),
): string {
  const iso = date.toISOString().slice(0, 10);
  const slug =
    scope === "outstanding-template"
      ? "outstanding-import-template"
      : scope === "collection-template"
        ? "collection-import-template"
        : "outstanding";
  return `jmt-${slug}-${iso}.${ext}`;
}
