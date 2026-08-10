import { describe, expect, it } from "vitest";
import {
  applyMapping,
  autoMap,
  matchSalesRep,
  normalisePurchasePattern,
  normaliseSensitivity,
  parseDelimited,
  splitUsableRows,
} from "@/lib/masters/bulk-parse";

describe("parseDelimited", () => {
  it("reads a plain sheet", () => {
    const { headers, rows } = parseDelimited("Name,Code\nFlat 102,S-1001\nRod 40,S-1002");
    expect(headers).toEqual(["Name", "Code"]);
    expect(rows).toEqual([
      { Name: "Flat 102", Code: "S-1001" },
      { Name: "Rod 40", Code: "S-1002" },
    ]);
  });

  it("handles quoted commas, escaped quotes and CRLF", () => {
    const { rows } = parseDelimited('Name,Spec\r\n"Flat, Reg","L 102 "" wide"\r\n');
    expect(rows).toEqual([{ Name: "Flat, Reg", Spec: 'L 102 " wide' }]);
  });

  it("strips a UTF-8 BOM off the first header", () => {
    const { headers } = parseDelimited("﻿Name,Code\nA,1");
    expect(headers[0]).toBe("Name");
  });

  it("returns nothing for an empty file", () => {
    expect(parseDelimited("")).toEqual({ headers: [], rows: [] });
    expect(parseDelimited("\n\n")).toEqual({ headers: [], rows: [] });
  });

  it("pads rows that are short a trailing column", () => {
    const { rows } = parseDelimited("Name,Code,Spec\nOnly a name");
    expect(rows[0]).toEqual({ Name: "Only a name", Code: "", Spec: "" });
  });
});

describe("autoMap", () => {
  it("matches on the field key, the label and aliases, ignoring case and punctuation", () => {
    expect(autoMap(["Item Name", "Part No.", "Specs"], "products")).toEqual({
      "Item Name": "name",
      "Part No.": "code",
      Specs: "specification",
    });
  });

  it("leaves an unrecognised column unmapped rather than guessing", () => {
    const m = autoMap(["Name", "Warehouse Bin"], "products");
    expect(m).toEqual({ Name: "name" });
  });

  it("never maps two columns onto the same field", () => {
    // "Product" and "Item" are both aliases for `name`; only the first wins.
    const m = autoMap(["Product", "Item"], "products");
    expect(Object.values(m).filter((f) => f === "name")).toHaveLength(1);
  });

  it("maps the customer classification columns", () => {
    expect(autoMap(["Customer", "Type", "Frequency", "Loyalty", "Sales Rep"], "customers")).toEqual({
      Customer: "name",
      Type: "customerCategory",
      Frequency: "purchasePattern",
      Loyalty: "sensitivity",
      "Sales Rep": "salesRep",
    });
  });
});

describe("applyMapping", () => {
  it("re-keys by field and drops unmapped columns and blanks", () => {
    const rows = [{ "Item Name": "Flat", Bin: "A4", "Part No.": "  " }];
    expect(applyMapping(rows, { "Item Name": "name", "Part No.": "code" })).toEqual([
      { name: "Flat" },
    ]);
  });
});

describe("splitUsableRows", () => {
  it("keeps rows with a name and counts the rest as skipped", () => {
    const { usable, skipped } = splitUsableRows(
      [{ name: "Flat" }, { code: "S-1" }, { name: "Rod" }],
      "products",
    );
    expect(usable).toHaveLength(2);
    expect(skipped).toBe(1);
  });
});

describe("normalisePurchasePattern", () => {
  it("accepts the stored token, the full label and common shorthands", () => {
    expect(normalisePurchasePattern("regular")).toBe("regular");
    expect(normalisePurchasePattern("Regular (monthly)")).toBe("regular");
    expect(normalisePurchasePattern("Monthly")).toBe("regular");
    expect(normalisePurchasePattern("one_time")).toBe("one_time");
    expect(normalisePurchasePattern("One-time")).toBe("one_time");
    expect(normalisePurchasePattern("one off")).toBe("one_time");
    expect(normalisePurchasePattern("Seasonal (specific cycles)")).toBe("seasonal");
  });

  it("returns null for anything it doesn't recognise, rather than guessing", () => {
    expect(normalisePurchasePattern("sometimes")).toBeNull();
    expect(normalisePurchasePattern("")).toBeNull();
    expect(normalisePurchasePattern(undefined)).toBeNull();
  });
});

describe("normaliseSensitivity", () => {
  it("accepts tokens, labels and the words a sheet actually uses", () => {
    expect(normaliseSensitivity("cost_sensitive")).toBe("cost_sensitive");
    expect(normaliseSensitivity("Cost sensitive (price-driven)")).toBe("cost_sensitive");
    expect(normaliseSensitivity("unloyal")).toBe("cost_sensitive");
    expect(normaliseSensitivity("Neutral")).toBe("neutral");
    expect(normaliseSensitivity("relationship-based")).toBe("loyal");
  });

  it("returns null for anything unrecognised", () => {
    expect(normaliseSensitivity("maybe")).toBeNull();
    expect(normaliseSensitivity(undefined)).toBeNull();
  });
});

describe("matchSalesRep", () => {
  const roster = [
    { id: "a", name: "Mihir Veera", email: "mihir@jmt.test" },
    { id: "b", name: "Priya Shah", email: "priya@jmt.test" },
    { id: "c", name: "Priya Shah", email: "priya.s@jmt.test" },
  ];

  it("matches on name or email, ignoring case and punctuation", () => {
    expect(matchSalesRep("mihir veera", roster)).toBe("a");
    expect(matchSalesRep("MIHIR@JMT.TEST", roster)).toBe("a");
  });

  it("returns null when the name is ambiguous, rather than picking one", () => {
    expect(matchSalesRep("Priya Shah", roster)).toBeNull();
    // …but the unambiguous email still resolves.
    expect(matchSalesRep("priya.s@jmt.test", roster)).toBe("c");
  });

  it("returns null for an unknown or blank rep", () => {
    expect(matchSalesRep("Nobody", roster)).toBeNull();
    expect(matchSalesRep("", roster)).toBeNull();
    expect(matchSalesRep(undefined, roster)).toBeNull();
  });
});
