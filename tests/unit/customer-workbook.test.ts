import { describe, expect, it } from "vitest";
import {
  computeSalesLineAmounts,
  parseDateLoose,
  parseNonNegative,
  parseYesNoStrict,
  validateAccountRow,
  validateBasicRow,
  validateSalesRow,
} from "@/lib/masters/customer-workbook";

const CATEGORIES = ["OEM (L)", "OEM (NL)", "User", "Dealer", "Sub dealer", "Panel Builder/Electrician"];

describe("validateBasicRow", () => {
  it("requires Customer Name", () => {
    const errors = validateBasicRow({}, 5, CATEGORIES);
    expect(errors).toContain("Basic Details — Row 5 — Customer Name is required.");
  });

  it("rejects a Customer Category not in the live list", () => {
    const errors = validateBasicRow({ customerName: "Acme", customerCategory: "Not Real" }, 8, CATEGORIES);
    expect(errors).toContain("Basic Details — Row 8 — Customer Category is invalid.");
  });

  it("accepts a Customer Category that is in the live list", () => {
    const errors = validateBasicRow({ customerName: "Acme", customerCategory: "OEM (L)" }, 2, CATEGORIES);
    expect(errors).toHaveLength(0);
  });

  it("rejects a negative Credit Limit or Credit Period", () => {
    const errors = validateBasicRow(
      { customerName: "Acme", creditLimit: "-500", creditPeriod: "-30" },
      4,
      CATEGORIES,
    );
    expect(errors).toContain("Basic Details — Row 4 — Credit Limit cannot be negative.");
    expect(errors).toContain("Basic Details — Row 4 — Credit Period cannot be negative.");
  });

  it("rejects a Focused View / TCS value that isn't Yes or No", () => {
    const errors = validateBasicRow(
      { customerName: "Acme", focusedView: "maybe", tcsApplicable: "sure" },
      3,
      CATEGORIES,
    );
    expect(errors).toContain("Basic Details — Row 3 — Add to Focused View List must be Yes or No.");
    expect(errors).toContain("Basic Details — Row 3 — TCS Applicable? must be Yes or No.");
  });

  it("a fully valid row has no errors", () => {
    const errors = validateBasicRow(
      {
        customerName: "Acme Pumps",
        customerCategory: "OEM (L)",
        creditLimit: "50000",
        creditPeriod: "30",
        focusedView: "Yes",
        tcsApplicable: "No",
      },
      2,
      CATEGORIES,
    );
    expect(errors).toHaveLength(0);
  });
});

describe("validateAccountRow", () => {
  it("requires Customer Code", () => {
    expect(validateAccountRow({}, 2)).toContain("Account Details — Row 2 — Customer Code is required.");
  });

  it("rejects negative Credit Limit/Period and a bad TCS value", () => {
    const errors = validateAccountRow(
      { customerCode: "001", creditLimit: "-1", creditPeriod: "-1", tcsApplicable: "nope" },
      6,
    );
    expect(errors).toContain("Account Details — Row 6 — Credit Limit cannot be negative.");
    expect(errors).toContain("Account Details — Row 6 — Credit Period cannot be negative.");
    expect(errors).toContain("Account Details — Row 6 — TCS Applicable? must be Yes or No.");
  });
});

describe("validateSalesRow", () => {
  it("requires Customer Code", () => {
    expect(validateSalesRow({}, 2)).toContain("Sales — Row 2 — Customer Code is required.");
  });

  it("matches the spec's exact example message for non-numeric Qty", () => {
    const errors = validateSalesRow({ customerCode: "001", qty: "ten" }, 13);
    expect(errors).toContain("Sales — Row 13 — Qty must be numeric.");
  });

  it("rejects a bad date and a bad TC Required value", () => {
    const errors = validateSalesRow(
      { customerCode: "001", customerPoEmailDate: "today", tcRequired: "maybe" },
      7,
    );
    expect(errors.some((e) => e.startsWith("Sales — Row 7 — Customer PO Email Date"))).toBe(true);
    expect(errors).toContain("Sales — Row 7 — TC Required? must be Yes or No.");
  });

  it("accepts DD-MM-YYYY and ISO dates", () => {
    expect(validateSalesRow({ customerCode: "001", customerPoEmailDate: "15-08-2026" }, 2)).toHaveLength(0);
    expect(validateSalesRow({ customerCode: "001", customerPoEmailDate: "2026-08-15" }, 2)).toHaveLength(0);
  });

  it("blank optional numeric fields are not errors", () => {
    expect(validateSalesRow({ customerCode: "001" }, 2)).toHaveLength(0);
  });
});

describe("parseNonNegative / parseYesNoStrict / parseDateLoose", () => {
  it("parseNonNegative accepts 0 and rejects negative/non-numeric", () => {
    expect(parseNonNegative("0")).toBe(0);
    expect(parseNonNegative("500")).toBe(500);
    expect(parseNonNegative("-1")).toBe("invalid");
    expect(parseNonNegative("abc")).toBe("invalid");
    expect(parseNonNegative(undefined)).toBeNull();
    expect(parseNonNegative("")).toBeNull();
  });

  it("parseYesNoStrict is case-insensitive and rejects anything else", () => {
    expect(parseYesNoStrict("yes")).toBe(true);
    expect(parseYesNoStrict("YES")).toBe(true);
    expect(parseYesNoStrict("no")).toBe(false);
    expect(parseYesNoStrict(undefined)).toBeNull();
    expect(parseYesNoStrict("")).toBeNull();
    expect(parseYesNoStrict("maybe")).toBe("invalid");
  });

  it("parseDateLoose normalises DD-MM-YYYY / DD/MM/YYYY to ISO, rejects garbage", () => {
    expect(parseDateLoose("15-08-2026")).toBe("2026-08-15");
    expect(parseDateLoose("15/08/2026")).toBe("2026-08-15");
    expect(parseDateLoose("2026-08-15")).toBe("2026-08-15");
    expect(parseDateLoose(undefined)).toBeNull();
    expect(parseDateLoose("today")).toBe("invalid");
    expect(parseDateLoose("31-13-2026")).toBe("invalid"); // month 13 doesn't exist
  });
});

describe("computeSalesLineAmounts", () => {
  it("Total = Qty × Rate, GST = Total × rate/100, Line Total = Total + GST, Sales Total adds Freight + Installation", () => {
    const amounts = computeSalesLineAmounts({
      customerCode: "001",
      qty: "10",
      rate: "500",
      gstPercent: "18",
      freightCharges: "100",
      installationCharges: "50",
    });
    expect(amounts.total).toBe(5000);
    expect(amounts.gstAmount).toBe(900);
    expect(amounts.lineTotal).toBe(5900);
    expect(amounts.salesTotal).toBe(6050);
  });

  it("Sales Total falls back to Line Total when Freight/Installation are blank", () => {
    const amounts = computeSalesLineAmounts({ customerCode: "001", qty: "2", rate: "100", gstPercent: "0" });
    expect(amounts.total).toBe(200);
    expect(amounts.gstAmount).toBe(0);
    expect(amounts.lineTotal).toBe(200);
    expect(amounts.salesTotal).toBe(200);
  });

  it("Total/GST/Line Total/Sales Total are null when Qty or Rate is missing", () => {
    const amounts = computeSalesLineAmounts({ customerCode: "001", qty: "10" });
    expect(amounts.total).toBeNull();
    expect(amounts.gstAmount).toBeNull();
    expect(amounts.lineTotal).toBeNull();
    expect(amounts.salesTotal).toBeNull();
  });
});
