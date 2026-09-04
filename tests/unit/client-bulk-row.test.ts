import { describe, expect, it } from "vitest";
import {
  ADDRESS_BLOCK,
  BANK_BLOCK,
  CONTACT_BLOCK,
  type SheetRow,
} from "@/lib/forms/client-bulk-columns";
import { rowToKycInput } from "@/lib/forms/client-bulk-row";
import { ClientKycSchema } from "@/lib/validators/client-kyc";
import type { ClientBulkRosters } from "@/lib/queries/client-bulk-options";

const id = (n: number): string => `0000000${n}-0000-4000-8000-000000000000`.slice(-36);

const ctx: ClientBulkRosters = {
  options: {
    salesPeople: ["Mihir Veera"],
    products: ["Flat Bar 40"],
    customerTypes: ["OEM"],
    industryTypes: ["Automotive"],
    gstRegistrationTypes: ["Regular"],
    states: ["Gujarat", "Maharashtra"],
    countries: ["India"],
    currencies: ["INR"],
    paymentTerms: ["100% Advance"],
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
  },
  salesByName: new Map([["mihirveera", id(1)]]),
  productsByName: new Map([["flatbar40", id(2)]]),
  designationsByName: new Map([
    ["purchasemanager", id(3)],
    ["accountant", id(4)],
  ]),
  departmentsByName: new Map([
    ["purchase", id(5)],
    ["accounts", id(6)],
  ]),
};

const C = CONTACT_BLOCK.fields;
const A = ADDRESS_BLOCK.fields;
const B = BANK_BLOCK.fields;

/** Parse the row the way `bulkImportClients` does, and fail loudly if it can't. */
function parse(row: SheetRow) {
  const result = ClientKycSchema.safeParse(rowToKycInput(row, ctx));
  expect(result.success ? null : result.error.issues[0]?.message).toBeNull();
  return result.success ? result.data : null!;
}

describe("rowToKycInput", () => {
  it("creates no contact, address or bank account from a row that carries none", () => {
    const v = parse({ name: "ABC Engineering", gstin: "24AAAAA0000A1Z5" });
    expect(v.contacts).toEqual([]);
    expect(v.addresses).toEqual([]);
    expect(v.bankAccounts).toEqual([]);
  });

  it("sends the contact block to the Contact Master, typed by its Contact Type", () => {
    const v = parse({
      name: "ABC Engineering",
      [C.contactType!]: "Purchase Contact",
      [C.firstName!]: "Ravi",
      [C.lastName!]: "Shah",
      [C.contactNo!]: "9876543210",
      [C.email!]: "ravi@abceng.co.in",
      [C.designationId!]: "purchase manager",
      [C.departmentId!]: "Purchase",
      [C.notes!]: "Best reached after 4pm",
    });

    expect(v.contacts).toEqual([
      {
        contactType: "purchase",
        firstName: "Ravi",
        lastName: "Shah",
        contactNo: "9876543210",
        email: "ravi@abceng.co.in",
        // Matched case- and punctuation-blind, and stored as the row's id.
        designationId: id(3),
        departmentId: id(5),
        notes: "Best reached after 4pm",
      },
    ]);
  });

  it("sends the address block to the Address Book, typed by its Address Type", () => {
    const v = parse({
      name: "ABC Engineering",
      [A.addressType!]: "Delivery Address",
      [A.line1!]: "12 Phase II, GIDC Vatva",
      [A.city!]: "Ahmedabad",
      [A.state!]: "  gujarat ",
      [A.country!]: "India",
      [A.pinCode!]: "382445",
      [A.email!]: "invoices@abceng.co.in",
    });

    expect(v.addresses).toEqual([
      {
        addressType: "delivery",
        line1: "12 Phase II, GIDC Vatva",
        line2: null,
        line3: null,
        line4: null,
        city: "Ahmedabad",
        // The master's own spelling, not the typist's.
        state: "Gujarat",
        country: "India",
        pinCode: "382445",
        email: "invoices@abceng.co.in",
      },
    ]);
  });

  it("reads a blank type as the default each column documents", () => {
    const v = parse({
      name: "ABC Engineering",
      [C.firstName!]: "Ravi",
      [A.line1!]: "12 Phase II",
    });
    expect(v.contacts[0]!.contactType).toBe("other");
    expect(v.addresses[0]!.addressType).toBe("billing");
  });

  it("keeps an address State the masters have never heard of", () => {
    const v = parse({ name: "ABC Engineering", [A.state!]: "Tamil Nadu" });
    expect(v.addresses[0]!.state).toBe("Tamil Nadu");
  });

  it("makes the one bank account the primary one", () => {
    const v = parse({
      name: "ABC Engineering",
      [B.accountName!]: "ABC Engineering Pvt Ltd",
      [B.bankName!]: "HDFC Bank",
      [B.accountNo!]: "50200012345678",
      [B.ifscSwift!]: "HDFC0001234",
      [B.branch!]: "Vatva",
      [B.accountType!]: "Current",
    });
    expect(v.bankAccounts).toEqual([
      {
        accountName: "ABC Engineering Pvt Ltd",
        bankName: "HDFC Bank",
        accountNo: "50200012345678",
        ifscSwift: "HDFC0001234",
        branch: "Vatva",
        accountType: "Current",
        isPrimary: true,
      },
    ]);
  });

  it("fills all three directories from one row", () => {
    const v = parse({
      name: "ABC Engineering",
      [C.firstName!]: "Ravi",
      [A.line1!]: "12 Phase II",
      [B.bankName!]: "HDFC Bank",
    });
    expect(v.contacts).toHaveLength(1);
    expect(v.addresses).toHaveLength(1);
    expect(v.bankAccounts).toHaveLength(1);
  });

  it("still fills the client row itself, blocks or no blocks", () => {
    const v = parse({
      name: "  ABC Engineering  ",
      salesRep: "mihir veera",
      grade: "b",
      customerTypes: "oem",
      products: "flat bar 40",
      creditLimit: "1,50,000",
      creditDays: "45",
      [A.city!]: "Ahmedabad",
    });
    expect(v.name).toBe("ABC Engineering");
    expect(v.salesRepId).toBe(id(1));
    expect(v.grade).toBe("B");
    expect(v.customerTypes).toEqual(["OEM"]);
    expect(v.productIds).toEqual([id(2)]);
    expect(v.creditLimit).toBe(150000);
    expect(v.creditDays).toBe(45);
  });

  it("drops a designation nobody is — the cell rules flag it before this runs", () => {
    const v = parse({
      name: "ABC Engineering",
      [C.firstName!]: "Ravi",
      [C.designationId!]: "Chief Vibes Officer",
    });
    expect(v.contacts[0]!.designationId).toBeNull();
  });
});
