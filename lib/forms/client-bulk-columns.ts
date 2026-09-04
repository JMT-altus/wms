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
 * Contacts, addresses and bank accounts ARE here, unlike the table, which
 * shows none of them. The table can send you to the Contact Master to read
 * one; an import has nowhere to send you, and a client whose contact, billing
 * address and bank account have to be re-entered one screen at a time after
 * the import is not bulk-imported in any useful sense.
 *
 * They arrive as three blocks — Contact Details, Address Details and Bank
 * Details — carrying the columns the Client Contact Master, Client Address
 * Book and Client Bank Master themselves show, Contact Type and Address Type
 * included. One row is one client, so one row carries at most one of each;
 * the masters stay the place to add a second contact or a second delivery
 * address. A block whose cells are all blank creates no row at all.
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

import {
  CLIENT_ADDRESS_TYPES,
  CLIENT_ADDRESS_TYPE_LABELS,
  CLIENT_CONTACT_TYPES,
  CLIENT_CONTACT_TYPE_LABELS,
  VOLUME_CLASSES,
  type ClientAddressType,
  type ClientContactType,
} from "@/db/enums";

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
  | "designations"
  | "departments"
  | "contactTypes"
  | "addressTypes"
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
  /** A shape the value has to have on top of its kind. */
  format?: "email";
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
 * The Contact Type and Address Type cells offer the labels, not the stored
 * values — "Purchase Contact", not `purchase`. The masters show the labels
 * and so does the KYC form, and a sheet that asked for the database's word
 * for it would be the only screen in the app that does.
 */
export const CONTACT_TYPE_OPTIONS: readonly string[] = CLIENT_CONTACT_TYPES.map(
  (t) => CLIENT_CONTACT_TYPE_LABELS[t],
);
export const ADDRESS_TYPE_OPTIONS: readonly string[] = CLIENT_ADDRESS_TYPES.map(
  (t) => CLIENT_ADDRESS_TYPE_LABELS[t],
);

/**
 * A typed Contact Type back to the value the column stores.
 *
 * Falls back to `other`, which is both the column's own default and the
 * honest reading of a blank cell: a contact whose group nobody recorded.
 */
export function resolveContactType(value: string): ClientContactType {
  const match = matchOption(value, CONTACT_TYPE_OPTIONS);
  const index = match ? CONTACT_TYPE_OPTIONS.indexOf(match) : -1;
  return index >= 0 ? CLIENT_CONTACT_TYPES[index]! : "other";
}

/**
 * A typed Address Type back to the value the column stores.
 *
 * Falls back to `billing`, because `address_type` is NOT NULL and billing is
 * what an address with nothing else said about it means — it is the client's
 * own location, the one `customer_masters.city` is read from.
 */
export function resolveAddressType(value: string): ClientAddressType {
  const match = matchOption(value, ADDRESS_TYPE_OPTIONS);
  const index = match ? ADDRESS_TYPE_OPTIONS.indexOf(match) : -1;
  return index >= 0 ? CLIENT_ADDRESS_TYPES[index]! : "billing";
}

/**
 * The catalogue, in the Client Master table's own order.
 *
 * That order is itself the KYC form's, section by section, so reading across
 * the sheet walks the same path as filling the form in — and a column added
 * from the picker lands where the table would put it rather than on the far
 * right where you would have to scroll to reach it.
 */
const CLIENT_OWN_COLUMNS: readonly ClientBulkColumn[] = [
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

];

/* ── The three directories ──────────────────────────────────────────────── */

/**
 * A group of columns that fills one child row rather than the client row.
 *
 * The sheet is one row per client and the three directories are one-to-many,
 * so a block is the compromise that keeps both true: each block is a fixed
 * slot on the row, and filling it creates exactly one `customer_contacts` /
 * `customer_addresses` / `customer_bank_accounts` row. Leave every cell in a
 * block blank and nothing is created — importing a bare list of company names
 * must not leave an empty contact beside each one.
 *
 * Which contact and which address is a column, not three copies of the block:
 * Contact Type and Address Type are exactly the columns the Client Contact
 * Master and the Client Address Book show, so the sheet reads the way those
 * screens read. A client's second contact or second delivery address is added
 * in that master afterwards — one sheet row is one client.
 *
 * `fields` is the whole contract between the sheet and the import: the KYC
 * payload field on the left, the column key that fills it on the right. The
 * import walks this map, so a column can no more exist here with nowhere to
 * land than one in the catalogue above.
 */
export interface ChildBlock {
  /** The Add-column picker's heading for this block. */
  group: string;
  /** KYC payload field → sheet column key. */
  fields: Readonly<Record<string, string>>;
}

/* Contact Details — the Client Contact Master's own columns. */

const CONTACT_GROUP = "Contact Details";

const CONTACT_COLUMNS: readonly ClientBulkColumn[] = [
  {
    key: "contactType",
    label: "Contact Type",
    kind: "select",
    group: CONTACT_GROUP,
    optionKey: "contactTypes",
    width: 190,
    aliases: ["typeofcontact", "contactgroup"],
    hint: "Blank imports as Other Contact",
  },
  {
    key: "contactFirstName",
    label: "First Name",
    kind: "text",
    group: CONTACT_GROUP,
    maxLength: 80,
    width: 175,
    aliases: ["contactfirstname", "contactperson", "contactname"],
  },
  {
    key: "contactLastName",
    label: "Last Name",
    kind: "text",
    group: CONTACT_GROUP,
    maxLength: 80,
    width: 175,
    aliases: ["contactlastname", "surname"],
  },
  {
    key: "contactNo",
    label: "Contact No",
    kind: "text",
    group: CONTACT_GROUP,
    maxLength: 40,
    width: 175,
    aliases: ["contactnumber", "phone", "phoneno", "mobile", "mobileno", "telephone"],
  },
  {
    key: "contactEmail",
    label: "Contact Email",
    kind: "text",
    group: CONTACT_GROUP,
    format: "email",
    maxLength: 200,
    width: 215,
    aliases: ["email", "emailid", "emailaddress"],
  },
  {
    key: "contactDesignation",
    label: "Designation",
    kind: "select",
    group: CONTACT_GROUP,
    optionKey: "designations",
    width: 185,
    aliases: ["contactdesignation", "jobtitle", "title"],
    hint: "Must match the Designation master",
  },
  {
    key: "contactDepartment",
    label: "Department",
    kind: "select",
    group: CONTACT_GROUP,
    optionKey: "departments",
    width: 185,
    aliases: ["contactdepartment", "dept"],
    hint: "Must match the Department master",
  },
  {
    key: "contactNotes",
    label: "Contact Notes",
    kind: "text",
    group: CONTACT_GROUP,
    maxLength: 1000,
    width: 215,
    aliases: ["contactnote", "contactremarks"],
  },
];

export const CONTACT_BLOCK: ChildBlock = {
  group: CONTACT_GROUP,
  fields: {
    contactType: "contactType",
    firstName: "contactFirstName",
    lastName: "contactLastName",
    contactNo: "contactNo",
    email: "contactEmail",
    // The two that resolve to a row. The cell holds the name; the import
    // turns it into the id, which is why the field keeps the `Id` suffix.
    designationId: "contactDesignation",
    departmentId: "contactDepartment",
    notes: "contactNotes",
  },
};

/* Address Details — the Client Address Book's own columns. */

const ADDRESS_GROUP = "Address Details";

/**
 * One Street Address, not the four lines `customer_addresses` stores.
 *
 * The table keeps line1–line4 because the KYC form collects four boxes, but a
 * spreadsheet column of "Address Line 3" is a column nobody fills. The sheet
 * offers the one column people actually paste into and it lands in `line1`;
 * the other three stay null and the Address Book's edit drawer splits them out
 * later if anyone wants to.
 */
const ADDRESS_COLUMNS: readonly ClientBulkColumn[] = [
  {
    key: "addressType",
    label: "Address Type",
    kind: "select",
    group: ADDRESS_GROUP,
    optionKey: "addressTypes",
    width: 205,
    aliases: ["typeofaddress", "addresskind"],
    hint: "Blank imports as Billing Address",
  },
  {
    key: "addressStreet",
    label: "Street Address",
    kind: "text",
    group: ADDRESS_GROUP,
    maxLength: 200,
    width: 260,
    aliases: ["street", "address", "addressline1", "addressline", "line1", "premises"],
  },
  {
    key: "addressCity",
    label: "City",
    kind: "text",
    group: ADDRESS_GROUP,
    maxLength: 120,
    width: 165,
    aliases: ["town", "addresscity"],
  },
  {
    // "Address State", not "State": the client row already has a State of its
    // own (Registration & Tax), and two columns headed the same would make an
    // uploaded file's "State" heading a coin toss.
    key: "addressState",
    label: "Address State",
    kind: "select",
    group: ADDRESS_GROUP,
    optionKey: "states",
    freeText: true,
    maxLength: 120,
    width: 180,
  },
  {
    key: "addressCountry",
    label: "Address Country",
    kind: "select",
    group: ADDRESS_GROUP,
    optionKey: "countries",
    freeText: true,
    maxLength: 120,
    width: 180,
  },
  {
    key: "addressPinCode",
    label: "Pin Code",
    kind: "text",
    group: ADDRESS_GROUP,
    maxLength: 20,
    width: 150,
    aliases: ["pincode", "postalcode", "postcode", "zip", "zipcode"],
  },
  {
    key: "addressEmail",
    label: "Address Email",
    kind: "text",
    group: ADDRESS_GROUP,
    format: "email",
    maxLength: 200,
    width: 215,
    aliases: ["invoiceemail", "invoicemailingemail"],
  },
];

export const ADDRESS_BLOCK: ChildBlock = {
  group: ADDRESS_GROUP,
  fields: {
    addressType: "addressType",
    line1: "addressStreet",
    city: "addressCity",
    state: "addressState",
    country: "addressCountry",
    pinCode: "addressPinCode",
    email: "addressEmail",
  },
};

/* Bank Details — the Client Bank Master's own columns. */

const BANK_GROUP = "Bank Details";

const BANK_COLUMNS: readonly ClientBulkColumn[] = [
  {
    key: "bankAccountName",
    label: "Account Name",
    kind: "text",
    group: BANK_GROUP,
    maxLength: 160,
    width: 205,
    aliases: ["accountholder", "accountholdername", "bankaccountname"],
  },
  {
    key: "bankName",
    label: "Bank Name",
    kind: "text",
    group: BANK_GROUP,
    maxLength: 160,
    width: 195,
    aliases: ["bank"],
  },
  {
    key: "bankAccountNo",
    label: "Account No",
    kind: "text",
    group: BANK_GROUP,
    maxLength: 60,
    width: 185,
    aliases: ["accountnumber", "acno", "accno", "bankaccountno", "bankaccountnumber"],
  },
  {
    key: "bankIfscSwift",
    label: "IFSC / SWIFT",
    kind: "text",
    group: BANK_GROUP,
    maxLength: 30,
    width: 175,
    aliases: ["ifsc", "ifsccode", "swift", "swiftcode", "ifscswift"],
  },
  {
    key: "bankBranch",
    label: "Branch",
    kind: "text",
    group: BANK_GROUP,
    maxLength: 160,
    width: 175,
    aliases: ["bankbranch", "branchname"],
  },
  {
    key: "bankAccountType",
    label: "Account Type",
    kind: "text",
    group: BANK_GROUP,
    maxLength: 40,
    width: 170,
    aliases: ["bankaccounttype"],
    hint: "Current, Savings, CC — free text",
  },
];

/**
 * The one bank block, marked primary.
 *
 * A client can have several accounts and the Bank Master is where the rest
 * go; the one the sheet carries is the one you pay against, so it lands as
 * `is_primary` rather than as an unranked account nobody can tell apart.
 */
export const BANK_BLOCK: ChildBlock = {
  group: BANK_GROUP,
  fields: {
    accountName: "bankAccountName",
    bankName: "bankName",
    accountNo: "bankAccountNo",
    ifscSwift: "bankIfscSwift",
    branch: "bankBranch",
    accountType: "bankAccountType",
  },
};

/** Every block the sheet carries, for the readers that treat them alike. */
export const CHILD_BLOCKS: readonly ChildBlock[] = [CONTACT_BLOCK, ADDRESS_BLOCK, BANK_BLOCK];

/* ── The record's own, not the form's ───────────────────────────────────── */

const RECORD_COLUMNS: readonly ClientBulkColumn[] = [
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

/**
 * The catalogue: the client's own fields, then its three directories, then
 * the two flags that belong to the record rather than to the form.
 *
 * The directories sit between the two on purpose. Everything before them
 * writes `customer_masters`; everything in them writes a child table; the two
 * after are the Client Master's own view of the row. Reading across the sheet
 * is reading the record outwards, and an added column lands where the table
 * would put it rather than on the far right.
 */
export const CLIENT_BULK_COLUMNS: readonly ClientBulkColumn[] = [
  ...CLIENT_OWN_COLUMNS,
  ...CONTACT_COLUMNS,
  ...ADDRESS_COLUMNS,
  ...BANK_COLUMNS,
  ...RECORD_COLUMNS,
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

/**
 * One block's cells, keyed by the KYC field they fill — or null if it is empty.
 *
 * Null rather than an object of empty strings because "empty" is the answer
 * the import acts on: no contact row, no address row, no bank row. Both the
 * sheet (to grey a block's header) and the server (to decide what to insert)
 * ask this one question of one function, so they cannot disagree about what
 * counts as a filled-in block.
 */
export function blockValues(
  row: SheetRow,
  block: ChildBlock,
): Record<string, string> | null {
  const out: Record<string, string> = {};
  let filled = false;
  for (const [field, key] of Object.entries(block.fields)) {
    const value = (row[key] ?? "").trim();
    out[field] = value;
    if (value) filled = true;
  }
  return filled ? out : null;
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
  if (column.optionKey === "contactTypes") return CONTACT_TYPE_OPTIONS;
  if (column.optionKey === "addressTypes") return ADDRESS_TYPE_OPTIONS;
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

  if (column.format === "email" && !/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(value)) {
    return `${column.label} does not look like an email address.`;
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
