import { format } from "date-fns";
import type { ClientMasterRow } from "@/lib/queries/client-kyc";

/**
 * Client KYC export columns, shared by the XLSX and PDF routes.
 *
 * One definition rather than two parallel header lists: the pair drifted on
 * the task exports once already, and a PDF whose columns disagree with the
 * spreadsheet of the same record is worse than having only one of them.
 *
 * Values are the human-readable form — "Yes"/"No" rather than booleans,
 * "Active"/"Inactive" rather than a flag, joined label lists rather than
 * Postgres arrays — because both formats are read by people, not parsed by
 * scripts. The table's own CSV button keeps the raw view for that.
 */

const yesNo = (v: boolean | null | undefined): string => (v ? "Yes" : "No");

const list = (v: string[] | null | undefined): string =>
  v && v.length > 0 ? v.join(", ") : "";

const text = (v: string | number | null | undefined): string =>
  v === null || v === undefined || v === "" ? "" : String(v);

/** yyyy-mm-dd or an ISO timestamp → "12 Jul 2026". */
const fmtDate = (v: string | null | undefined): string => {
  if (!v) return "";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "" : format(d, "d MMM yyyy");
};

/** Trade type, derived the same way the Client Master table derives it. */
const trade = (r: ClientMasterRow): string =>
  r.exportClient?.trim().toLowerCase() === "yes" ? "Export" : "Domestic";

export interface KycExportColumn {
  header: string;
  /** Column width in characters, used for the XLSX sheet. */
  width: number;
  value: (r: ClientMasterRow) => string;
}

/**
 * Ordered to mirror the KYC form's own sections — Identity, Registration &
 * Tax, Commercial & Credit, Export Details, then free text — so someone
 * reading the export can follow it against the form they filled in.
 */
export const KYC_EXPORT_COLUMNS: readonly KycExportColumn[] = [
  /* Identity */
  { header: "Client Name", width: 30, value: (r) => text(r.name) },
  { header: "Code", width: 12, value: (r) => text(r.code) },
  { header: "Status", width: 10, value: (r) => (r.isActive ? "Active" : "Inactive") },
  { header: "Grade", width: 10, value: (r) => text(r.grade) },
  { header: "Focused View", width: 13, value: (r) => yesNo(r.focusedView) },
  { header: "Customer Type", width: 20, value: (r) => list(r.customerTypes) },
  { header: "Industry", width: 20, value: (r) => list(r.industryTypes) },
  { header: "Products", width: 26, value: (r) => list(r.products) },
  { header: "Tags", width: 20, value: (r) => list(r.tags) },
  { header: "Sales Co-ordinator", width: 20, value: (r) => text(r.salesRepName) },

  /* Registration & Tax */
  { header: "GSTIN", width: 18, value: (r) => text(r.gstin) },
  { header: "GST Reg. Type", width: 18, value: (r) => text(r.gstRegistrationType) },
  { header: "PAN", width: 14, value: (r) => text(r.panNo) },
  { header: "MSME / Udyam", width: 18, value: (r) => text(r.msmeUdyamNo) },
  { header: "TIN", width: 14, value: (r) => text(r.tinNumber) },
  { header: "State", width: 16, value: (r) => text(r.state) },
  { header: "Website", width: 24, value: (r) => text(r.website) },
  { header: "Test Certificate", width: 15, value: (r) => yesNo(r.testCertificateNeeded) },
  { header: "TCS Applicable", width: 14, value: (r) => yesNo(r.tcsApplicable) },

  /* Commercial & Credit */
  { header: "Credit Limit", width: 14, value: (r) => text(r.creditLimit) },
  { header: "Credit Days", width: 12, value: (r) => text(r.creditDays) },
  { header: "Payment Terms", width: 20, value: (r) => text(r.paymentTerms) },
  { header: "Freight Charges", width: 16, value: (r) => text(r.freightCharges) },
  { header: "Transporter", width: 18, value: (r) => text(r.transporter) },
  { header: "Qty Deviation", width: 14, value: (r) => text(r.quantityDeviation) },

  /* Export Details */
  { header: "Trade", width: 11, value: trade },
  { header: "IEC Number", width: 16, value: (r) => text(r.iecNumber) },
  { header: "Currency", width: 10, value: (r) => text(r.currency) },
  { header: "Country", width: 16, value: (r) => text(r.country) },

  /* Free text */
  { header: "Reference", width: 20, value: (r) => text(r.reference) },
  { header: "Other References", width: 22, value: (r) => text(r.otherReferences) },
  { header: "Notes", width: 34, value: (r) => text(r.notes) },
  { header: "Onboarded", width: 14, value: (r) => fmtDate(r.createdAt) },
];

export const KYC_EXPORT_HEADERS: readonly string[] = KYC_EXPORT_COLUMNS.map(
  (c) => c.header,
);

export function toKycRowArray(row: ClientMasterRow): string[] {
  return KYC_EXPORT_COLUMNS.map((c) => c.value(row));
}

/** "client-kyc-2026-08-31.xlsx" */
export function kycExportFilename(ext: "xlsx" | "pdf"): string {
  return `client-kyc-${format(new Date(), "yyyy-MM-dd")}.${ext}`;
}

/**
 * The handful of columns the PDF can actually fit on landscape A4. The full
 * set is 32 columns wide — legible in a spreadsheet, unreadable as a printed
 * table — so the PDF carries the identity and commercial essentials and the
 * XLSX carries everything.
 */
export const KYC_PDF_COLUMNS: readonly (KycExportColumn & { pdfWidth: number })[] = [
  { header: "Client Name", width: 30, pdfWidth: 150, value: (r) => text(r.name) },
  { header: "Code", width: 12, pdfWidth: 58, value: (r) => text(r.code) },
  { header: "GSTIN", width: 18, pdfWidth: 108, value: (r) => text(r.gstin) },
  { header: "State", width: 16, pdfWidth: 88, value: (r) => text(r.state) },
  { header: "Trade", width: 11, pdfWidth: 58, value: trade },
  { header: "Grade", width: 10, pdfWidth: 48, value: (r) => text(r.grade) },
  { header: "Credit Limit", width: 14, pdfWidth: 70, value: (r) => text(r.creditLimit) },
  { header: "Credit Days", width: 12, pdfWidth: 56, value: (r) => text(r.creditDays) },
  {
    header: "Sales Co-ordinator",
    width: 20,
    pdfWidth: 104,
    value: (r) => text(r.salesRepName),
  },
  { header: "Status", width: 10, pdfWidth: 52, value: (r) => (r.isActive ? "Active" : "Inactive") },
];
