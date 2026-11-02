/**
 * The Collection Tracker Bulk Upload sample template — what it contains.
 *
 * Pure and client-safe: the workbook builder (./template-workbook, server
 * only), the upload dialog and the tests all read the same definition, so the
 * file people download, the words the dialog shows and what the tests check
 * cannot drift apart.
 *
 * The template invents nothing. It is the layout the existing importer
 * (./parse) already reads: a "Particulars" heading with "Debit" and "Credit"
 * headings, one row per company, and a "Grand Total" row the rows must add up
 * to. The optional reporting period is written the way the importer reads it
 * (Tally's "1-Apr-26 to 31-Oct-26"). There is no per-row date and no Sales
 * Coordinator column, because the importer has neither.
 */

/** Where the dialog downloads the template from. Same permission as Bulk Upload itself. */
export const BALANCE_TEMPLATE_PATH = "/collection/tracker/bulk-template.xlsx";
export const BALANCE_TEMPLATE_FILENAME = "collection-tracker-bulk-upload-sample.xlsx";

export const BALANCE_TEMPLATE_SHEETS = { data: "Collection Data", instructions: "Instructions" } as const;

/** The importer's own headings, exactly as ./parse looks for them (it ignores case and spacing). */
export const BALANCE_TEMPLATE_HEADERS = ["Particulars", "Debit", "Credit"] as const;

/** The importer's own total row label. */
export const BALANCE_TEMPLATE_TOTAL_LABEL = "Grand Total";

/** Row 1 of the data sheet: an optional label/value pair the importer reads the period from. */
export const BALANCE_TEMPLATE_PERIOD_LABEL = "Reporting period";
export const BALANCE_TEMPLATE_SAMPLE_PERIOD = "1-Apr-26 to 31-Oct-26";

/**
 * Every sample company name starts with this. The names are fictional, so they
 * never match a Collection Master company and the upload skips them. The
 * dialog also warns when a file still carries them.
 */
export const SAMPLE_ROW_PREFIX = "SAMPLE -";

export interface SampleBalanceRow {
  name: string;
  /** Rupees; null = leave the cell blank. */
  debit: number | null;
  credit: number | null;
}

export const SAMPLE_BALANCE_ROWS: readonly SampleBalanceRow[] = [
  { name: `${SAMPLE_ROW_PREFIX} Example Traders Pvt Ltd`, debit: 125000, credit: null },
  { name: `${SAMPLE_ROW_PREFIX} Demo Engineering Works`, debit: 48500.5, credit: 2000 },
  { name: `${SAMPLE_ROW_PREFIX} Test Industries LLP`, debit: null, credit: 7250 },
];

/** True for a row the template shipped with (case and spacing ignored). */
export function isSampleRowName(name: string): boolean {
  return name.trim().replace(/\s+/g, " ").toUpperCase().startsWith(SAMPLE_ROW_PREFIX);
}

/** How many of these rows are template sample rows. */
export function countSampleRows(rows: readonly { name: string }[]): number {
  return rows.filter((r) => isSampleRowName(r.name)).length;
}

/** The short instruction the dialog shows next to the download button. */
export const BALANCE_TEMPLATE_HINT =
  "Download the sample file, fill in your collection data without changing the column headers, and upload the completed file here.";
