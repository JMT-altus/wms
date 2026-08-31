import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import {
  KYC_EXPORT_COLUMNS,
  KYC_EXPORT_HEADERS,
  KYC_PDF_COLUMNS,
  toKycRowArray,
  kycExportFilename,
} from "@/lib/exports/client-kyc-rich";
import { renderClientKycPdf } from "@/lib/exports/client-kyc-pdf";
import type { ClientMasterRow } from "@/lib/queries/client-kyc";

function row(over: Partial<ClientMasterRow> = {}): ClientMasterRow {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    name: "Amber Rubber Industries",
    code: "AMB-001",
    grade: "A",
    customerTypes: ["OEM"],
    industryTypes: ["Rubber"],
    tags: ["priority"],
    products: ["Gearbox", "Coupling"],
    salesRepId: null,
    salesRepName: "Mihir",
    gstin: "27AAAAA0000A1Z5",
    exportClient: "No",
    creditLimit: "500000",
    isActive: true,
    focusedView: false,
    createdAt: "2026-07-15T00:00:00.000Z",
    panNo: "AAAAA0000A",
    gstRegistrationType: "Regular",
    msmeUdyamNo: null,
    tinNumber: null,
    website: "https://example.com",
    testCertificateNeeded: true,
    tcsApplicable: false,
    state: "Maharashtra",
    creditDays: 45,
    paymentTerms: "45 days",
    freightCharges: "Extra",
    transporter: "VRL",
    quantityDeviation: "±5%",
    iecNumber: null,
    currency: null,
    country: "India",
    reference: "Trade show",
    otherReferences: null,
    notes: "Long-standing account.",
    ...over,
  } as ClientMasterRow;
}

describe("KYC export columns", () => {
  it("headers and row cells stay the same length", () => {
    // The two used to be separate lists on the task exports and drifted; a
    // mismatch here silently shifts every value one column to the left.
    expect(toKycRowArray(row())).toHaveLength(KYC_EXPORT_HEADERS.length);
    expect(KYC_EXPORT_COLUMNS).toHaveLength(KYC_EXPORT_HEADERS.length);
  });

  it("has no duplicate headers", () => {
    expect(new Set(KYC_EXPORT_HEADERS).size).toBe(KYC_EXPORT_HEADERS.length);
  });

  it("renders booleans as Yes/No and arrays as joined labels", () => {
    const cells = toKycRowArray(row());
    const at = (h: string) => cells[KYC_EXPORT_HEADERS.indexOf(h)];
    expect(at("Test Certificate")).toBe("Yes");
    expect(at("TCS Applicable")).toBe("No");
    expect(at("Status")).toBe("Active");
    expect(at("Products")).toBe("Gearbox, Coupling");
    expect(at("Onboarded")).toBe("15 Jul 2026");
  });

  it("derives Trade from the export flag, case- and space-insensitively", () => {
    const at = (r: ClientMasterRow) =>
      toKycRowArray(r)[KYC_EXPORT_HEADERS.indexOf("Trade")];
    expect(at(row({ exportClient: "Yes" }))).toBe("Export");
    expect(at(row({ exportClient: "  YES  " }))).toBe("Export");
    expect(at(row({ exportClient: "No" }))).toBe("Domestic");
    expect(at(row({ exportClient: null }))).toBe("Domestic");
  });

  it("turns every null into an empty cell, never the string 'null'", () => {
    const blank = row({
      code: null,
      grade: null,
      gstin: null,
      salesRepName: null,
      notes: null,
      creditDays: null,
      customerTypes: [],
      products: [],
    });
    const cells = toKycRowArray(blank);
    expect(cells).not.toContain("null");
    expect(cells).not.toContain("undefined");
    expect(cells[KYC_EXPORT_HEADERS.indexOf("Code")]).toBe("");
    expect(cells[KYC_EXPORT_HEADERS.indexOf("Products")]).toBe("");
  });

  it("survives an unparseable createdAt rather than emitting Invalid Date", () => {
    const cells = toKycRowArray(row({ createdAt: "not-a-date" }));
    expect(cells[KYC_EXPORT_HEADERS.indexOf("Onboarded")]).toBe("");
  });

  it("names files with today's date and the right extension", () => {
    expect(kycExportFilename("xlsx")).toMatch(/^client-kyc-\d{4}-\d{2}-\d{2}\.xlsx$/);
    expect(kycExportFilename("pdf")).toMatch(/^client-kyc-\d{4}-\d{2}-\d{2}\.pdf$/);
  });

  it("PDF columns are a subset of the spreadsheet's, so the two agree", () => {
    for (const c of KYC_PDF_COLUMNS) {
      expect(KYC_EXPORT_HEADERS).toContain(c.header);
    }
  });
});

describe("XLSX sheet", () => {
  it("round-trips headers and values through a real workbook", () => {
    const rows = [row(), row({ name: "Vesh Tech", isActive: false })];
    const aoa = [[...KYC_EXPORT_HEADERS], ...rows.map(toKycRowArray)];
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = KYC_EXPORT_COLUMNS.map((c) => ({ wch: c.width }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Client KYC");

    const buf: Buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
    expect(buf.length).toBeGreaterThan(1000);

    const back = XLSX.read(buf, { type: "buffer" });
    const sheet = back.Sheets["Client KYC"]!;
    const parsed = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1 });
    expect(parsed[0]).toEqual([...KYC_EXPORT_HEADERS]);
    expect(parsed[1]?.[0]).toBe("Amber Rubber Industries");
    expect(parsed[2]?.[0]).toBe("Vesh Tech");
  });
});

describe("renderClientKycPdf", () => {
  it("produces a valid PDF for a normal register", async () => {
    const buf = await renderClientKycPdf([row(), row({ name: "Vesh Tech" })], {
      generatedBy: "Mihir",
    });
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(buf.length).toBeGreaterThan(1000);
  });

  it("produces a valid PDF when there are no clients at all", async () => {
    // The empty state draws different content and is the case nobody clicks
    // until a fresh deployment, where it would be the very first thing tried.
    const buf = await renderClientKycPdf([], { generatedBy: "Mihir" });
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("paginates past one page without throwing", async () => {
    // 120 rows comfortably overflows a landscape A4, exercising addPage(),
    // the repeated header row, and the bufferedPageRange footer pass.
    const many = Array.from({ length: 120 }, (_, i) => row({ name: `Client ${i}` }));
    const buf = await renderClientKycPdf(many, { generatedBy: "Mihir" });
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(buf.length).toBeGreaterThan(5000);
  });

  it("handles nulls and long text without throwing", async () => {
    const nasty = row({
      name: "A".repeat(300),
      code: null,
      gstin: null,
      state: null,
      grade: null,
      creditLimit: null,
      creditDays: null,
      salesRepName: null,
      notes: "…".repeat(500),
    });
    const buf = await renderClientKycPdf([nasty], { generatedBy: "Mihir" });
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
  });
});
