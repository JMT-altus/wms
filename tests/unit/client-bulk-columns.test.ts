import { describe, expect, it } from "vitest";
import {
  ADDRESS_BLOCK,
  ADDRESS_TYPE_OPTIONS,
  BANK_BLOCK,
  CHILD_BLOCKS,
  CLIENT_BULK_COLUMNS,
  COLUMN_BY_KEY,
  CONTACT_BLOCK,
  CONTACT_TYPE_OPTIONS,
  STANDARD_COLUMN_KEYS,
  blockValues,
  resolveAddressType,
  resolveContactType,
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
  designations: ["Purchase Manager", "Accountant"],
  departments: ["Purchase", "Accounts"],
  contactTypes: [],
  addressTypes: [],
  grades: [],
  yesNo: [],
  activeStatus: [],
};

const column = (key: string) => COLUMN_BY_KEY.get(key)!;

/**
 * The groups that write a child table rather than the client row.
 *
 * Named here so the test below can still assert the Client Master's own
 * column list exactly — the blocks were added beside those columns, not in
 * among them, and that separation is the thing worth pinning down.
 */
const DIRECTORY_GROUPS = new Set(CHILD_BLOCKS.map((b) => b.group));

const clientOwnKeys = () =>
  CLIENT_BULK_COLUMNS.filter((c) => !DIRECTORY_GROUPS.has(c.group)).map((c) => c.key);

describe("the catalogue", () => {
  /**
   * The sheet carries the Client Master table's columns and only those.
   *
   * Spelled out rather than derived, because the table lives in a client
   * component full of JSX renderers and cannot be imported here. That makes
   * this list the contract: change either side without the other and this
   * fails, which is the point.
   */
  it("still carries the Client Master's columns, in its order", () => {
    expect(clientOwnKeys()).toEqual([
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

  /**
   * The three directories.
   *
   * Asserted through the block maps rather than through a list of column
   * keys, because the maps are what the import walks: a field missing here is
   * a field the sheet cannot carry, whatever columns happen to exist.
   */
  it("carries the Client Contact Master's columns, Contact Type included", () => {
    expect(Object.keys(CONTACT_BLOCK.fields)).toEqual([
      "contactType",
      "firstName",
      "lastName",
      "contactNo",
      "email",
      "designationId",
      "departmentId",
      "notes",
    ]);
    expect(column(CONTACT_BLOCK.fields.contactType!).label).toBe("Contact Type");
    expect(column(CONTACT_BLOCK.fields.email!).label).toBe("Contact Email");
    expect(optionsFor(column(CONTACT_BLOCK.fields.contactType!), options)).toEqual([
      "Purchase Contact",
      "Accounts Contact",
      "Other Contact",
    ]);
  });

  it("carries the Client Address Book's columns, Address Type included", () => {
    expect(Object.keys(ADDRESS_BLOCK.fields)).toEqual([
      "addressType",
      "line1",
      "city",
      "state",
      "country",
      "pinCode",
      "email",
    ]);
    // One Street Address column, landing in line1 — nobody fills "Line 3".
    expect(column(ADDRESS_BLOCK.fields.line1!).label).toBe("Street Address");
    expect(optionsFor(column(ADDRESS_BLOCK.fields.addressType!), options)).toEqual([
      "Billing Address",
      "Delivery Address",
      "Invoice Mailing Address",
    ]);
  });

  it("carries the Client Bank Master's columns", () => {
    expect(Object.keys(BANK_BLOCK.fields)).toEqual([
      "accountName",
      "bankName",
      "accountNo",
      "ifscSwift",
      "branch",
      "accountType",
    ]);
    expect(column(BANK_BLOCK.fields.ifscSwift!).label).toBe("IFSC / SWIFT");
  });

  it("gives every block column somewhere to land", () => {
    for (const block of CHILD_BLOCKS) {
      for (const key of Object.values(block.fields)) {
        expect(COLUMN_BY_KEY.get(key), `${key} is in a block but not the catalogue`).toBeTruthy();
        expect(COLUMN_BY_KEY.get(key)!.group).toBe(block.group);
      }
    }
  });

  it("leaves every block column out of the sheet until it is asked for", () => {
    const blockKeys = new Set(CHILD_BLOCKS.flatMap((b) => Object.values(b.fields)));
    expect(STANDARD_COLUMN_KEYS.filter((k) => blockKeys.has(k))).toEqual([]);
  });

  it("never lets one heading mean two columns", () => {
    const owner = new Map<string, string>();
    for (const c of CLIENT_BULK_COLUMNS) {
      for (const spelling of [c.key, c.label, ...(c.aliases ?? [])]) {
        const n = spelling.toLowerCase().replace(/[^a-z0-9]/g, "");
        expect(owner.get(n) ?? c.key, `"${spelling}" is claimed twice`).toBe(c.key);
        owner.set(n, c.key);
      }
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

  it("matches a block heading, however it is spelled", () => {
    expect(matchHeader("Contact Type")?.key).toBe(CONTACT_BLOCK.fields.contactType);
    expect(matchHeader("First Name")?.key).toBe(CONTACT_BLOCK.fields.firstName);
    expect(matchHeader("Mobile No.")?.key).toBe(CONTACT_BLOCK.fields.contactNo);
    expect(matchHeader("Email")?.key).toBe(CONTACT_BLOCK.fields.email);
    expect(matchHeader("Address Line 1")?.key).toBe(ADDRESS_BLOCK.fields.line1);
    expect(matchHeader("pincode")?.key).toBe(ADDRESS_BLOCK.fields.pinCode);
    expect(matchHeader("IFSC")?.key).toBe(BANK_BLOCK.fields.ifscSwift);
    expect(matchHeader("A/c No")?.key).toBe(BANK_BLOCK.fields.accountNo);
  });

  /**
   * The client row's own State wins a bare "State" heading, because it is the
   * older column and the one the Client Master shows. The address block's is
   * headed "Address State" for exactly that reason.
   */
  it("keeps the client's own State and Country ahead of the address block's", () => {
    expect(matchHeader("State")?.key).toBe("state");
    expect(matchHeader("Country")?.key).toBe("country");
    expect(matchHeader("Address State")?.key).toBe(ADDRESS_BLOCK.fields.state);
    expect(matchHeader("Address Country")?.key).toBe(ADDRESS_BLOCK.fields.country);
  });

  it("returns null for a heading nothing owns", () => {
    expect(matchHeader("Ledger Balance")).toBeNull();
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

  it("checks a block's email and holds its two rosters to the master", () => {
    const email = column(CONTACT_BLOCK.fields.email!);
    expect(validateCell(email, "ravi@abceng.co.in", options)).toBeNull();
    expect(validateCell(email, "", options)).toBeNull();
    expect(validateCell(email, "ravi at abceng", options)).toMatch(/email address/);

    const designation = column(CONTACT_BLOCK.fields.designationId!);
    expect(validateCell(designation, "purchase manager", options)).toBeNull();
    expect(validateCell(designation, "Chief Vibes Officer", options)).toMatch(
      /not in Designation/,
    );
  });

  it("holds the two type columns to their fixed lists", () => {
    const contactType = column(CONTACT_BLOCK.fields.contactType!);
    expect(validateCell(contactType, "accounts contact", options)).toBeNull();
    expect(validateCell(contactType, "Sales Contact", options)).toMatch(/not in Contact Type/);

    const addressType = column(ADDRESS_BLOCK.fields.addressType!);
    expect(validateCell(addressType, "Delivery Address", options)).toBeNull();
    expect(validateCell(addressType, "Warehouse", options)).toMatch(/not in Address Type/);
  });

  it("lets an address State off the list, like the client's own State", () => {
    expect(validateCell(column(ADDRESS_BLOCK.fields.state!), "Tamil Nadu", options)).toBeNull();
    expect(validateCell(column(ADDRESS_BLOCK.fields.pinCode!), "382445", options)).toBeNull();
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

describe("blockValues", () => {
  it("reads a block's cells back by the field they fill", () => {
    expect(
      blockValues(
        {
          name: "ABC Ltd",
          [ADDRESS_BLOCK.fields.line1!]: " 12 Phase II, GIDC Vatva ",
          [ADDRESS_BLOCK.fields.city!]: "Ahmedabad",
        },
        ADDRESS_BLOCK,
      ),
    ).toEqual({
      addressType: "",
      line1: "12 Phase II, GIDC Vatva",
      city: "Ahmedabad",
      state: "",
      country: "",
      pinCode: "",
      email: "",
    });
  });

  it("is null when the block was left alone — an empty block makes no row", () => {
    expect(blockValues({ name: "ABC Ltd" }, ADDRESS_BLOCK)).toBeNull();
    expect(blockValues({ [ADDRESS_BLOCK.fields.line1!]: "   " }, ADDRESS_BLOCK)).toBeNull();
  });

  it("reads only its own block, not the one beside it", () => {
    const row = { [ADDRESS_BLOCK.fields.city!]: "Ahmedabad" };
    expect(blockValues(row, ADDRESS_BLOCK)?.city).toBe("Ahmedabad");
    expect(blockValues(row, CONTACT_BLOCK)).toBeNull();
    expect(blockValues(row, BANK_BLOCK)).toBeNull();
  });

  it("reads the bank block the same way", () => {
    expect(blockValues({ [BANK_BLOCK.fields.bankName!]: "HDFC" }, BANK_BLOCK)).toMatchObject({
      bankName: "HDFC",
      accountNo: "",
    });
  });
});

describe("the two type columns", () => {
  it("offers the labels the masters show, not the values they store", () => {
    expect(CONTACT_TYPE_OPTIONS).toEqual([
      "Purchase Contact",
      "Accounts Contact",
      "Other Contact",
    ]);
    expect(ADDRESS_TYPE_OPTIONS).toEqual([
      "Billing Address",
      "Delivery Address",
      "Invoice Mailing Address",
    ]);
  });

  it("resolves a label back to the stored value, case and punctuation blind", () => {
    expect(resolveContactType("Purchase Contact")).toBe("purchase");
    expect(resolveContactType("accounts contact")).toBe("accounts");
    expect(resolveAddressType("Delivery Address")).toBe("delivery");
    expect(resolveAddressType("invoice-mailing address")).toBe("invoice_mailing");
  });

  it("reads a blank as the default each column documents", () => {
    // `contact_type` defaults to other; `address_type` is NOT NULL and an
    // unqualified address is the client's own, which is billing.
    expect(resolveContactType("")).toBe("other");
    expect(resolveContactType("Sales Contact")).toBe("other");
    expect(resolveAddressType("")).toBe("billing");
    expect(resolveAddressType("Warehouse")).toBe("billing");
  });
});

describe("isBlankRow", () => {
  it("ignores whitespace-only cells", () => {
    expect(isBlankRow({ name: "  ", notes: "" })).toBe(true);
    expect(isBlankRow({ name: "ABC Ltd" })).toBe(false);
    expect(isBlankRow({})).toBe(true);
  });
});
