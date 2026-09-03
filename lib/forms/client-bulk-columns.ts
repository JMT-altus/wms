/**
 * The columns the Client Master bulk-import sheet can show.
 *
 * Deliberately the Client Master table's own column list and nothing else —
 * same fields, same headings, same order (components/forms/client-master-table.tsx).
 * The sheet creates rows for that table, so offering a column the table does
 * not have would be inventing a field, and offering fewer would mean a client
 * you can see but cannot import.
 *
 * Two of the table's columns are absent, because neither takes input:
 *
 *   Client Code   system-generated on insert (`nextCustomerCodes`) and never
 *                 rewritten — the same rule the KYC form and the Customer
 *                 Master already follow.
 *   Created       the moment the row is inserted.
 *
 * Contacts, addresses and bank accounts are absent for the reason the table
 * gives for not carrying them: each has a master of its own, and that is the
 * one place to add or correct them.
 *
 * `standard: true` mirrors the table exactly as well — the columns it shows
 * before you touch the Columns menu. Everything else sits behind "Add column",
 * which is this sheet's Columns menu.
 *
 * Pure and dependency-free, like `lib/masters/bulk-parse.ts`: the browser
 * reads it to draw the sheet and flag cells, the server action reads the same
 * list to turn a row back into a client. One catalogue, so a column can never
 * exist on screen with nowhere to land.
 */

import { VOLUME_CLASSES } from "@/db/enums";

/** Which option list feeds a `select` / `multi` cell. */
export type OptionKey =
  | "salesPeople"
  | "products"
  | "customerTypes"
  | "industryTypes"
  | "gstRegistrationTypes"
  | "states"
  | "countries"
  | "currencies"
  | "paymentTerms"
  | "freightCharges"
  | "transporters"
  | "quantityDeviations"
  | "grades"
  | "yesNo"
  | "activeStatus";

/**
 * The option lists the sheet needs, resolved once on the server.
 *
 * The same lists the KYC form's pickers use (`listClientKycLookups`,
 * `listKycDropdownOptions`, `listActiveProductOptions`, `listEmployeeOptions`)
 * — the sheet must offer exactly what the form offers, or a bulk-created
 * client would carry values the form cannot show back.
 */
export type ClientBulkOptions = Record<OptionKey, string[]>;

export type ColumnKind = "text" | "number" | "select" | "multi";

export interface ClientBulkColumn {
  key: string;
  /** The sheet's heading — the Client Master table's heading, verbatim. */
  label: string;
  kind: ColumnKind;
  /** Which section of the KYC form this field belongs to, for the picker. */
  group: string;
  optionKey?: OptionKey;
  /**
   * A value off the option list is still accepted.
   *
   * True for every column stored as free text on `customer_masters` — State,
   * Payment Terms and friends are admin-managed *suggestion* lists, not
   * enums, and refusing "Tamil Nadu" because nobody has added it yet would
   * make the sheet stricter than the form, which accepts it.
   *
   * False only where the value must resolve to a row: Sales Co-ordinator
   * becomes a `sales_rep_id`, Product Types become `customer_product_map`
   * rows. An unmatched name there is silent data loss, so it is flagged.
   */
  freeText?: boolean;
  maxLength?: number;
  required?: boolean;
  /** Pixel width of the column in the sheet. */
  width: number;
  /** Extra header spellings that auto-match this column on file upload. */
  aliases?: string[];
  /** In the sheet when the dialog first opens. */
  standard?: boolean;
  /** Shown under the heading in the Add column picker. */
  hint?: string;
}

export const YES_NO = ["Yes", "No"] as const;
export const ACTIVE_STATUS = ["Active", "Inactive"] as const;

/**
 * The catalogue, in the Client Master table's own order.
 *
 * That order is itself the KYC form's, section by section, so reading across
 * the sheet walks the same path as filling the form in — and a column added
 * from the picker lands where the table would put it rather than on the far
 * right where you would have to scroll to reach it.
 */
export const CLIENT_BULK_COLUMNS: readonly ClientBulkColumn[] = [
  /* ── Record identity ──────────────────────────────────────────────────── */
  {
    key: "name",
    label: "Company",
    kind: "text",
    group: "Identity",
    required: true,
    maxLength: 200,
    width: 230,
    standard: true,
    aliases: [
      "companyname",
      "client",
      "clientname",
      "customer",
      "customername",
      "party",
      "partyname",
      "name",
    ],
  },

  /* ── 1. Identity ──────────────────────────────────────────────────────── */
  {
    key: "gstin",
    label: "GSTIN",
    kind: "text",
    group: "Identity",
    maxLength: 20,
    width: 180,
    standard: true,
    aliases: ["gst", "gstno", "gstnumber", "gstinno"],
  },
  {
    key: "reference",
    label: "Reference",
    kind: "text",
    group: "Identity",
    maxLength: 200,
    width: 170,
    aliases: ["referenceby", "referredby", "source"],
  },
  {
    key: "salesRep",
    label: "Sales Co-ordinator",
    kind: "select",
    group: "Identity",
    optionKey: "salesPeople",
    width: 190,
    standard: true,
    aliases: ["salesperson", "salesrep", "rep", "coordinator", "salescoordinator", "owner", "executive"],
    hint: "Must match someone on the roster",
  },
  {
    key: "grade",
    label: "Grade",
    kind: "select",
    group: "Identity",
    optionKey: "grades",
    width: 130,
    standard: true,
    aliases: ["volumeclass", "class", "abc"],
    hint: "A, B or C",
  },
  {
    key: "tags",
    label: "Tags",
    kind: "multi",
    group: "Identity",
    freeText: true,
    maxLength: 30,
    width: 180,
    standard: true,
    aliases: ["tag", "labels"],
    hint: "Free text, several allowed",
  },
  {
    key: "customerTypes",
    label: "Customer Type",
    kind: "multi",
    group: "Identity",
    optionKey: "customerTypes",
    freeText: true,
    maxLength: 80,
    width: 200,
    standard: true,
    aliases: ["clienttype", "type"],
    hint: "OEM (L), Dealer, Panel Builder — several allowed",
  },
  {
    key: "industryTypes",
    label: "Industry Type",
    kind: "multi",
    group: "Identity",
    optionKey: "industryTypes",
    freeText: true,
    maxLength: 80,
    width: 200,
    standard: true,
    aliases: ["industry", "segment"],
    hint: "Several allowed",
  },
  {
    key: "products",
    label: "Product Types",
    kind: "multi",
    group: "Identity",
    optionKey: "products",
    maxLength: 200,
    width: 220,
    aliases: ["product", "products", "producttype", "items"],
    hint: "Must match Product Master names",
  },

  /* ── 2. Registration & Tax ────────────────────────────────────────────── */
  {
    key: "panNo",
    label: "PAN / IT No",
    kind: "text",
    group: "Registration & Tax",
    maxLength: 20,
    width: 160,
    aliases: ["pan", "panno", "pannumber", "itno"],
  },
  {
    key: "msmeUdyamNo",
    label: "MSME / Udyam No",
    kind: "text",
    group: "Registration & Tax",
    maxLength: 40,
    width: 190,
    aliases: ["msme", "udyam", "udyamno", "msmeno"],
  },
  {
    key: "gstRegistrationType",
    label: "GST Registration Type",
    kind: "select",
    group: "Registration & Tax",
    optionKey: "gstRegistrationTypes",
    freeText: true,
    maxLength: 60,
    width: 200,
    aliases: ["gsttype", "registrationtype"],
  },
  {
    key: "state",
    label: "State",
    kind: "select",
    group: "Registration & Tax",
    optionKey: "states",
    freeText: true,
    maxLength: 120,
    width: 170,
    aliases: ["province", "region"],
  },
  {
    key: "tinNumber",
    label: "TIN No",
    kind: "text",
    group: "Registration & Tax",
    maxLength: 40,
    width: 150,
    aliases: ["tin", "tinno"],
  },
  {
    key: "testCertificateNeeded",
    label: "Test Certificate Needed",
    kind: "select",
    group: "Registration & Tax",
    optionKey: "yesNo",
    width: 200,
    aliases: ["testcertificate", "tc"],
    hint: "Blank imports as No",
  },
  {
    key: "website",
    label: "Website",
    kind: "text",
    group: "Registration & Tax",
    maxLength: 200,
    width: 190,
    aliases: ["url", "site", "web"],
  },
  {
    key: "tcsApplicable",
    label: "TCS Applicable",
    kind: "select",
    group: "Registration & Tax",
    optionKey: "yesNo",
    width: 170,
    aliases: ["tcs"],
    hint: "Blank imports as No",
  },

  /* ── 5. Commercial & Credit ───────────────────────────────────────────── */
  {
    key: "paymentTerms",
    label: "Payment Terms",
    kind: "select",
    group: "Commercial & Credit",
    optionKey: "paymentTerms",
    freeText: true,
    maxLength: 120,
    width: 200,
    aliases: ["terms", "paymentterm"],
  },
  {
    key: "freightCharges",
    label: "Freight Charges",
    kind: "select",
    group: "Commercial & Credit",
    optionKey: "freightCharges",
    freeText: true,
    maxLength: 120,
    width: 190,
    aliases: ["freight"],
  },
  {
    key: "creditDays",
    label: "Credit Days",
    kind: "number",
    group: "Commercial & Credit",
    width: 150,
    aliases: ["creditperiod", "creditperioddays"],
    hint: "Whole days — 0 is a real answer",
  },
  {
    key: "creditLimit",
    label: "Credit Limit",
    kind: "number",
    group: "Commercial & Credit",
    width: 160,
    standard: true,
    aliases: ["climit", "creditamount"],
  },
  {
    key: "transporter",
    label: "Transporter",
    kind: "select",
    group: "Commercial & Credit",
    optionKey: "transporters",
    freeText: true,
    maxLength: 120,
    width: 180,
    aliases: ["courier", "carrier"],
  },
  {
    key: "quantityDeviation",
    label: "Quantity Deviation",
    kind: "select",
    group: "Commercial & Credit",
    optionKey: "quantityDeviations",
    freeText: true,
    maxLength: 40,
    width: 180,
    aliases: ["qtydeviation", "deviation"],
  },
  {
    key: "otherReferences",
    label: "Other References",
    kind: "text",
    group: "Commercial & Credit",
    maxLength: 2000,
    width: 200,
    aliases: ["otherreference"],
  },
  {
    key: "notes",
    label: "Client Notes",
    kind: "text",
    group: "Commercial & Credit",
    maxLength: 2000,
    width: 240,
    aliases: ["notes", "remark", "remarks", "comment", "comments"],
  },

  /* ── 8. Export Details ────────────────────────────────────────────────── */
  {
    key: "exportClient",
    label: "Export",
    kind: "select",
    group: "Export Details",
    optionKey: "yesNo",
    // Text on the row, not a boolean, so a third answer (SEZ, deemed export)
    // never needs a migration — see the schema comment on `export_client`.
    freeText: true,
    maxLength: 20,
    width: 140,
    aliases: ["isexport", "exportclient", "trade"],
    hint: "Blank imports as Domestic",
  },
  {
    key: "iecNumber",
    label: "IEC Code",
    kind: "text",
    group: "Export Details",
    maxLength: 40,
    width: 150,
    aliases: ["iec", "iecno", "ieccode"],
  },
  {
    key: "currency",
    label: "Currency",
    kind: "select",
    group: "Export Details",
    optionKey: "currencies",
    freeText: true,
    maxLength: 20,
    width: 140,
    aliases: ["curr"],
  },
  {
    key: "country",
    label: "Country",
    kind: "select",
    group: "Export Details",
    optionKey: "countries",
    freeText: true,
    maxLength: 80,
    width: 150,
  },

  /* ── The record's own, not the form's ─────────────────────────────────── */
  {
    key: "focusedView",
    label: "Focused View",
    kind: "select",
    group: "This record",
    optionKey: "yesNo",
    width: 160,
    standard: true,
    aliases: ["focused", "focusedviewlist", "nifty50"],
    hint: "Blank imports as No",
  },
  {
    key: "isActive",
    label: "Status",
    kind: "select",
    group: "This record",
    optionKey: "activeStatus",
    width: 150,
    standard: true,
    aliases: ["active", "status"],
    hint: "Blank imports as Active",
  },
];

/** Catalogue order, so an added column lands where the table would put it. */
const ORDER = new Map(CLIENT_BULK_COLUMNS.map((c, i) => [c.key, i]));

export const COLUMN_BY_KEY = new Map(CLIENT_BULK_COLUMNS.map((c) => [c.key, c]));

export const STANDARD_COLUMN_KEYS: string[] = CLIENT_BULK_COLUMNS.filter((c) => c.standard).map(
  (c) => c.key,
);

/** Sort a set of column keys back into catalogue order. */
export function orderColumns(keys: readonly string[]): string[] {
  return [...keys].sort((a, b) => (ORDER.get(a) ?? 999) - (ORDER.get(b) ?? 999));
}

/** The sheet's groups, in catalogue order, for the Add column picker. */
export function groupedColumns(): { group: string; columns: ClientBulkColumn[] }[] {
  const out: { group: string; columns: ClientBulkColumn[] }[] = [];
  for (const c of CLIENT_BULK_COLUMNS) {
    const last = out[out.length - 1];
    if (last && last.group === c.group) last.columns.push(c);
    else out.push({ group: c.group, columns: [c] });
  }
  return out;
}

/* ── Values ──────────────────────────────────────────────────────────────── */

/** One sheet row: column key → the raw text in that cell. */
export type SheetRow = Record<string, string>;

/** Normalise a header or an option for loose comparison. */
export const norm = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Split a `multi` cell into its values. Comma or semicolon, blanks dropped. */
export function splitMulti(value: string): string[] {
  return value
    .split(/[,;]/)
    .map((v) => v.trim())
    .filter(Boolean);
}

/** A row nobody has typed into. Blank rows are ignored on import. */
export function isBlankRow(row: SheetRow): boolean {
  return Object.values(row).every((v) => !v || !v.trim());
}

/**
 * Match a typed value against an option list, ignoring case and punctuation.
 *
 * Returns the list's own spelling, so "abc engineering pvt ltd" imports as
 * "ABC Engineering Pvt. Ltd." — the sheet exists to take pasted Excel, and
 * an Excel column is never spelled the way the master is.
 */
export function matchOption(value: string, options: readonly string[]): string | null {
  const n = norm(value);
  if (!n) return null;
  return options.find((o) => norm(o) === n) ?? null;
}

/** The option set a `select` / `multi` cell offers. */
export function optionsFor(
  column: ClientBulkColumn,
  options: ClientBulkOptions,
): readonly string[] {
  if (column.optionKey === "grades") return VOLUME_CLASSES;
  if (column.optionKey === "yesNo") return YES_NO;
  if (column.optionKey === "activeStatus") return ACTIVE_STATUS;
  return column.optionKey ? (options[column.optionKey] ?? []) : [];
}

/**
 * What is wrong with this cell, or null.
 *
 * Deliberately a message rather than a boolean: the sheet shows it on hover
 * and in the list under the grid, and "Sales Co-ordinator — nobody on the
 * roster is called that" is the difference between fixing a row and
 * abandoning it.
 */
export function validateCell(
  column: ClientBulkColumn,
  raw: string,
  options: ClientBulkOptions,
): string | null {
  const value = raw.trim();

  if (!value) {
    return column.required ? `${column.label} is required.` : null;
  }

  if (column.kind === "number") {
    const n = Number(value.replace(/,/g, ""));
    if (!Number.isFinite(n)) return `${column.label} must be a number.`;
    if (n < 0) return `${column.label} cannot be negative.`;
    return null;
  }

  const list = column.optionKey ? optionsFor(column, options) : undefined;

  if (column.kind === "multi") {
    const parts = splitMulti(value);
    if (parts.length === 0) return null;
    if (column.maxLength && parts.some((p) => p.length > column.maxLength!)) {
      return `Each ${column.label} value must be ${column.maxLength} characters or fewer.`;
    }
    if (list && !column.freeText) {
      const bad = parts.filter((p) => !matchOption(p, list));
      if (bad.length > 0) {
        return `${bad.join(", ")} — not in ${column.label}. Add it to the master first, or clear the cell.`;
      }
    }
    return null;
  }

  if (column.maxLength && value.length > column.maxLength) {
    return `${column.label} must be ${column.maxLength} characters or fewer.`;
  }

  if (column.kind === "select" && list && !column.freeText && !matchOption(value, list)) {
    return `${value} — not in ${column.label}.`;
  }

  if (column.key === "gstin" && !/^[0-9A-Z]{15}$/i.test(value)) {
    return "A GSTIN is 15 characters — letters and digits.";
  }

  if (column.key === "panNo" && !/^[A-Z]{5}[0-9]{4}[A-Z]$/i.test(value)) {
    return "A PAN is 5 letters, 4 digits, 1 letter.";
  }

  return null;
}

/**
 * Match an uploaded file's heading to a column.
 *
 * Same loose comparison the option matcher uses, against the key, the label
 * and every alias — so a Tally or Google Sheets export whose heading reads
 * "Party Name" or "Sales Person" lands in the right column with no mapping
 * step, which is the whole point of dropping the mapping screen.
 */
export function matchHeader(header: string): ClientBulkColumn | null {
  const n = norm(header);
  if (!n) return null;
  return (
    CLIENT_BULK_COLUMNS.find(
      (c) => norm(c.key) === n || norm(c.label) === n || (c.aliases ?? []).some((a) => norm(a) === n),
    ) ?? null
  );
}
