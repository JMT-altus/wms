import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { excelDate, sheetFromRows, EXCEL_DATE_FORMAT } from "@/lib/exports/xlsx-dates";
import { toRichRowCells, toRichRowArray } from "@/lib/exports/tasks-rich";
import { toEntryRowArray, fmtDue } from "@/lib/exports/outstanding-rich";
import type { TaskExportRow } from "@/lib/queries/tasks";

// Excel exports carry dates as real date cells shown dd/mm/yy; PDFs carry dd/mm/yy text.

describe("excelDate", () => {
  it("keeps a calendar date on its own day, whatever the server timezone", () => {
    const d = excelDate("2026-11-02") as Date;
    expect([d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours()]).toEqual([2026, 11, 2, 0]);
    expect(excelDate("2024-02-29")).toBeInstanceOf(Date);
  });

  it("puts an instant on the Indian wall clock", () => {
    const d = excelDate(new Date("2026-11-02T20:30:00Z")) as Date; // 02:00 IST on 3 Nov
    expect([d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes()]).toEqual([2026, 11, 3, 2, 0]);
  });

  it("is an empty cell for nothing", () => {
    expect(excelDate(null)).toBe("");
    expect(excelDate("")).toBe("");
    expect(excelDate("2026-02-30")).toBe("");
  });
});

describe("sheetFromRows", () => {
  it("writes Date values as date cells formatted dd/mm/yy and leaves text alone", () => {
    const ws = sheetFromRows([["Name", "Due"], ["A", excelDate("2026-11-02")], ["B", ""]], [{ wch: 10 }, { wch: 12 }]);
    const due = ws["B2"] as XLSX.CellObject;
    expect(due.t).toBe("d");
    expect(due.z).toBe(EXCEL_DATE_FORMAT);
    expect((ws["A2"] as XLSX.CellObject).t).toBe("s");
    expect(ws["!cols"]).toHaveLength(2);
    // Round trip through the xlsx writer: Excel sees a real date, formatted dd/mm/yy.
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "S");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
    const back = XLSX.read(buf, { type: "buffer", cellDates: true });
    const cell = back.Sheets["S"]!["B2"] as XLSX.CellObject;
    expect(cell.v).toBeInstanceOf(Date);
    expect(cell.w).toBe("02/11/26");
    const sorted = XLSX.utils.sheet_to_json<Record<string, unknown>>(back.Sheets["S"]!, { raw: false });
    expect(sorted[0]!["Due"]).toBe("02/11/26");
  });
});

describe("tasks export rows", () => {
  const row = {
    id: "t1",
    title: "Acme",
    subject: "Renewal",
    status: "done",
    approvalStatus: null,
    priority: "medium",
    doerName: "D",
    initiatorName: "I",
    dueAt: new Date("2026-11-02T10:00:00Z"),
    revisedTargetDate: null,
    createdAt: new Date("2026-10-01T04:00:00Z"),
    tags: ["x"],
  } as unknown as TaskExportRow;

  it("PDF text is dd/mm/yy; Excel cells are Dates", () => {
    const text = toRichRowArray(row);
    expect(text[7]).toBe("02/11/26");
    expect(text[8]).toBe("");
    expect(text[9]).toBe("01/10/26");
    const cells = toRichRowCells(row);
    expect(cells[7]).toBeInstanceOf(Date);
    expect(cells[8]).toBe("");
    expect(cells[9]).toBeInstanceOf(Date);
    expect(cells.slice(0, 7)).toEqual(text.slice(0, 7));
  });
});

describe("outstanding export rows", () => {
  it("fmtDue reads the ymd without a timezone shift and passes junk through", () => {
    expect(fmtDue("2026-01-01")).toBe("01/01/26");
    expect(fmtDue("2026-12-31")).toBe("31/12/26");
    expect(fmtDue(null)).toBe("");
    expect(fmtDue("odd")).toBe("odd");
  });

  it("text mode for PDF, date cells for Excel", () => {
    const e = {
      clientName: "C", productName: "P", cycle: "monthly", dueDate: "2026-11-02", balance: 100,
      state: "overdue", daysOverdue: 3, entityName: "E", responsibleName: "R",
    } as unknown as Parameters<typeof toEntryRowArray>[0];
    expect(toEntryRowArray(e, 0)[4]).toBe("02/11/26");
    expect(toEntryRowArray(e, 0, "excel")[4]).toBeInstanceOf(Date);
  });
});
