import type { SalesOrderView } from "./sales-orders";

/**
 * The problems of a validated Sales Order file as a CSV a person can open in
 * Excel and work through. Pure. One line per message, with the file row it
 * belongs to; orders that are ready to import are left out.
 */

const RESULT: Record<SalesOrderView["state"], string> = { valid: "Valid", attention: "Warning", duplicate: "Duplicate", invalid: "Invalid" };

/** Quotes a cell, and stops a spreadsheet from running one that starts like a formula. */
const csvCell = (v: string | number): string => {
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
};

export const SO_ERROR_REPORT_HEADINGS = ["File row", "Voucher number", "Voucher date", "Customer", "Result", "What to fix"] as const;

export function salesOrderErrorReport(views: readonly SalesOrderView[]): string {
  const lines: string[] = [SO_ERROR_REPORT_HEADINGS.map(csvCell).join(",")];
  for (const v of views) {
    if (v.state === "valid") continue;
    const messages = v.messages.length ? v.messages : [{ rowNo: v.rowNo, text: RESULT[v.state] }];
    for (const m of messages) lines.push([m.rowNo, v.documentNo, v.documentDate, v.partyName, RESULT[v.state], m.text].map(csvCell).join(","));
  }
  // A byte-order mark so Excel reads the rupee sign and any non-English name correctly.
  return `﻿${lines.join("\r\n")}\r\n`;
}

export const hasReportableProblems = (views: readonly SalesOrderView[]) => views.some((v) => v.state !== "valid");
