import { describe, expect, it } from "vitest";
import {
  KYC_REQUIREMENT_COUNT,
  isKycComplete,
  kycCompletionPercent,
  missingKycFields,
} from "@/lib/masters/kyc-completeness";

/** A record that satisfies every onboarding requirement. */
const complete = {
  name: "ABC Enterprises",
  gstin: "27ABCDE1234F1Z5",
  panNo: null,
  salesRepId: "0f2c1a44-0000-4000-8000-000000000001",
  contacts: [{ firstName: "John", contactNo: "9876543210" }],
  addresses: [
    { addressType: "billing", line1: "Plot 12", city: "Mumbai", pinCode: "400001" },
  ],
};

describe("missingKycFields", () => {
  it("reports nothing missing on a complete record", () => {
    expect(missingKycFields(complete)).toEqual([]);
    expect(isKycComplete(complete)).toBe(true);
  });

  it("accepts PAN in place of GSTIN — an unregistered client has no GSTIN", () => {
    expect(missingKycFields({ ...complete, gstin: null, panNo: "ABCDE1234F" })).toEqual([]);
  });

  it("names every gap on an empty record, in form order", () => {
    expect(missingKycFields({})).toEqual([
      "Company Name",
      "GSTIN or PAN",
      "Sales Co-ordinator",
      "A contact person with a phone or email",
      "A billing address with street, city and pin code",
    ]);
  });

  it("does not count a contact with no way to reach them", () => {
    const missing = missingKycFields({ ...complete, contacts: [{ firstName: "John" }] });
    expect(missing).toEqual(["A contact person with a phone or email"]);
  });

  it("does not accept a delivery address in place of a billing one", () => {
    const missing = missingKycFields({
      ...complete,
      addresses: [{ addressType: "delivery", line1: "Plot 12", city: "Mumbai", pinCode: "400001" }],
    });
    expect(missing).toEqual(["A billing address with street, city and pin code"]);
  });
});

describe("kycCompletionPercent", () => {
  it("is 100 only when nothing is missing", () => {
    expect(kycCompletionPercent([])).toBe(100);
  });

  it("is 0 when every requirement is unmet", () => {
    expect(kycCompletionPercent(missingKycFields({}))).toBe(0);
  });

  it("scales against the requirement count, not the whole form", () => {
    // The form has well over a hundred fields; the number has to answer
    // "how close is this to onboarding", so it counts only the five.
    expect(missingKycFields({})).toHaveLength(KYC_REQUIREMENT_COUNT);
    expect(kycCompletionPercent(["one gap"])).toBe(80);
    expect(kycCompletionPercent(["a", "b", "c"])).toBe(40);
  });

  it("never goes below zero if given more gaps than requirements", () => {
    expect(kycCompletionPercent(["a", "b", "c", "d", "e", "f", "g"])).toBe(0);
  });
});
