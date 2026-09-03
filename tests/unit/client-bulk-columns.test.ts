import { describe, expect, it } from "vitest";
import {
  CLIENT_BULK_COLUMNS,
  COLUMN_BY_KEY,
  STANDARD_COLUMN_KEYS,
  groupedColumns,
  isBlankRow,
  matchHeader,
  matchOption,
  optionsFor,
  orderColumns,
  splitMulti,
  validateCell,
  type ClientBulkOptions,
} from "@/lib/forms/client-bulk-columns";

const options: ClientBulkOptions = {
  salesPeople: ["Mihir Veera", "Anita Rao"],
  products: ["Flat Bar 40", "Round Rod 12"],
  customerTypes: ["End User", "Traders", "OEM"],
  industryTypes: ["Automotive", "Textile"],
  gstRegistrationTypes: ["Regular", "Composition"],
  states: ["Gujarat", "Maharashtra"],
  countries: ["India"],
  currencies: ["INR", "USD"],
  paymentTerms: ["100% Advance", "Against Delivery"],
  freightCharges: ["To Pay"],
  transporters: ["VRL"],
  quantityDeviations: ["+/- 5%"],
  grades: [],
  yesNo: [],
  activeStatus: [],
};

const column = (key: string) => COLUMN_BY_KEY.get(key)!;

describe("the catalogue", () => {
  /**
   * The sheet carries the Client Master table's columns and only those.
   *
   * Spelled out rather than derived, because the table lives in a client
   * component full of JSX renderers and cannot be imported here. That makes
   * this list the contract: change either side without the other and this
   * fails, which is the point.
   */
  it("is exactly the Client Master's columns, in its order", () => {
    expect(CLIENT_BULK_COLUMNS.map((c) => c.key)).toEqual([
      "name",
      "gstin",
      "reference",
      "salesRep",
      "grade",
      "tags",
      "customerTypes",
      "industryTypes",
      "products",
      "panNo",
      "msmeUdyamNo",
      "gstRegistrationType",
      "state",
      "tinNumber",
      "testCertificateNeeded",
      "website",
      "tcsApplicable",
      "paymentTerms",
      "freightCharges",
      "creditDays",
      "creditLimit",
      "transporter",
      "quantityDeviation",
      "otherReferences",
      "notes",
      "exportClient",
      "iecNumber",
      "currency",
      "country",
      "focusedView",
      "isActive",
    ]);
  });

  it("carries no contact, address or bank column — each has a master of its own", () => {
    const keys = CLIENT_BULK_COLUMNS.map((c) => c.key);
    for (const absent of ["contactFirstName", "contactNo", "contactEmail", "addressLine1", "city", "pinCode"]) {
      expect(keys).not.toContain(absent);
    }
  });

  it("offers neither of the two columns nothing can type into", () => {
    const keys = CLIENT_BULK_COLUMNS.map((c) => c.key);
    // Client Code is system-generated; Created is the insert's own timestamp.
    expect(keys).not.toContain("code");
    expect(keys).not.toContain("createdAt");
  });

  it("uses the table's own headings", () => {
    expect(column("name").label).toBe("Company");
    expect(column("salesRep").label).toBe("Sales Co-ordinator");
    expect(column("panNo").label).toBe("PAN / IT No");
    expect(column("notes").label).toBe("Client Notes");
    expect(column("iecNumber").label).toBe("IEC Code");
    expect(column("isActive").label).toBe("Status");
  });

  it("has unique keys and labels", () => {
    const keys = CLIENT_BULK_COLUMNS.map((c) => c.key);
    const labels = CLIENT_BULK_COLUMNS.map((c) => c.label);
    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("opens on the columns the table shows before the Columns menu is touched", () => {
    expect(STANDARD_COLUMN_KEYS).toEqual([
      "name",
      "gstin",
      "salesRep",
      "grade",
      "tags",
      "customerTypes",
      "industryTypes",
      "creditLimit",
      "focusedView",
      "isActive",
    ]);
  });

  it("requires only Company — everything else may import blank", () => {
    expect(CLIENT_BULK_COLUMNS.filter((c) => c.required).map((c) => c.key)).toEqual(["name"]);
  });

  it("gives every select and multi column somewhere to draw options from", () => {
    for (const c of CLIENT_BULK_COLUMNS) {
      if (c.kind !== "select" && c.kind !== "multi") continue;
      // Tags is the one deliberate exception: free text, no master behind it.
      if (c.key === "tags") continue;
      expect(c.optionKey, `${c.key} has no option list`).toBeTruthy();
    }
  });

  it("groups without splitting a group in two", () => {
    const groups = groupedColumns().map((g) => g.group);
    expect(new Set(groups).size).toBe(groups.length);
  });
});

describe("orderColumns", () => {
  it("puts an added column where the table would, not on the far right", () => {
    expect(orderColumns(["notes", "gstin", "name"])).toEqual(["name", "gstin", "notes"]);
    expect(orderColumns(["isActive", "products", "grade"])).toEqual([
      "grade",
      "products",
      "isActive",
    ]);
  });
});

describe("matchHeader", () => {
  it("matches on the label", () => {
    expect(matchHeader("Company")?.key).toBe("name");
    expect(matchHeader("Sales Co-ordinator")?.key).toBe("salesRep");
  });

  it("matches an alias, ignoring case, spaces and punctuation", () => {
    expect(matchHeader("party name")?.key).toBe("name");
    expect(matchHeader("Sales Person")?.key).toBe("salesRep");
    expect(matchHeader("G.S.T. No")?.key).toBe("gstin");
    expect(matchHeader("credit period days")?.key).toBe("creditDays");
  });

  it("returns null for a heading nothing owns", () => {
    expect(matchHeader("Ledger Balance")).toBeNull();
    // Contacts and addresses are not this sheet's business.
    expect(matchHeader("Mobile No.")).toBeNull();
    expect(matchHeader("   ")).toBeNull();
  });
});

describe("splitMulti", () => {
  it("splits on commas and semicolons, dropping blanks", () => {
    expect(splitMulti("End User, Traders ;; OEM ,")).toEqual(["End User", "Traders", "OEM"]);
  });

  it("returns nothing for an empty cell", () => {
    expect(splitMulti("   ")).toEqual([]);
  });
});

describe("matchOption", () => {
  it("returns the master's own spelling, not the typist's", () => {
    expect(matchOption("flat bar 40", options.products)).toBe("Flat Bar 40");
    expect(matchOption("  M A H A R A S H T R A ", options.states)).toBe("Maharashtra");
  });

  it("returns null when nothing matches", () => {
    expect(matchOption("Hex Bolt", options.products)).toBeNull();
  });
});

describe("validateCell", () => {
  it("flags a missing Company and nothing else that is blank", () => {
    expect(validateCell(column("name"), "", options)).toMatch(/required/i);
    expect(validateCell(column("gstin"), "", options)).toBeNull();
    expect(validateCell(column("products"), "  ", options)).toBeNull();
  });

  it("accepts an off-list value in a free-text column", () => {
    expect(validateCell(column("state"), "Tamil Nadu", options)).toBeNull();
    expect(validateCell(column("paymentTerms"), "45 days net", options)).toBeNull();
    // Export is text, not a boolean, so a third answer is allowed.
    expect(validateCell(column("exportClient"), "SEZ", options)).toBeNull();
  });

  it("flags an off-list value where it has to resolve to a row", () => {
    expect(validateCell(column("salesRep"), "Nobody At All", options)).toMatch(
      /not in Sales Co-ordinator/,
    );
    expect(validateCell(column("products"), "Flat Bar 40, Hex Bolt", options)).toMatch(/Hex Bolt/);
    expect(validateCell(column("products"), "flat bar 40", options)).toBeNull();
  });

  it("holds the fixed sets to their values", () => {
    expect(validateCell(column("grade"), "A", options)).toBeNull();
    expect(validateCell(column("grade"), "D", options)).toMatch(/not in Grade/);
    expect(validateCell(column("isActive"), "Inactive", options)).toBeNull();
    expect(validateCell(column("isActive"), "Archived", options)).toMatch(/not in Status/);
    expect(validateCell(column("focusedView"), "Yes", options)).toBeNull();
  });

  it("checks numbers", () => {
    expect(validateCell(column("creditLimit"), "1,50,000", options)).toBeNull();
    expect(validateCell(column("creditLimit"), "-5", options)).toMatch(/negative/);
    expect(validateCell(column("creditDays"), "thirty", options)).toMatch(/must be a number/);
    expect(validateCell(column("creditDays"), "0", options)).toBeNull();
  });

  it("checks the shapes people get wrong", () => {
    expect(validateCell(column("gstin"), "24AAAAA0000A1Z5", options)).toBeNull();
    expect(validateCell(column("gstin"), "24AAAAA", options)).toMatch(/15 characters/);
    expect(validateCell(column("panNo"), "AAAAA0000A", options)).toBeNull();
    expect(validateCell(column("panNo"), "NOTAPAN", options)).toMatch(/5 letters/);
  });

  it("enforces the column's own length limit", () => {
    expect(validateCell(column("name"), "x".repeat(201), options)).toMatch(/200 characters/);
    expect(validateCell(column("tags"), `${"y".repeat(31)}, ok`, options)).toMatch(/30 characters/);
  });
});

describe("optionsFor", () => {
  it("serves the fixed sets from the enum, not from the master lists", () => {
    expect(optionsFor(column("grade"), options)).toEqual(["A", "B", "C"]);
    expect(optionsFor(column("tcsApplicable"), options)).toEqual(["Yes", "No"]);
    expect(optionsFor(column("isActive"), options)).toEqual(["Active", "Inactive"]);
  });

  it("serves a master-backed column from its list", () => {
    expect(optionsFor(column("customerTypes"), options)).toEqual(options.customerTypes);
  });
});

describe("isBlankRow", () => {
  it("ignores whitespace-only cells", () => {
    expect(isBlankRow({ name: "  ", notes: "" })).toBe(true);
    expect(isBlankRow({ name: "ABC Ltd" })).toBe(false);
    expect(isBlankRow({})).toBe(true);
  });
});
