import { describe, expect, it } from "vitest";
import { normaliseGstinResponse, type GstinApiResponse } from "@/lib/gst/normalise";

const GSTIN = "27AAACR5055K1Z7";

/**
 * A real gstinapi.in payload, captured from a live lookup of this GSTIN.
 *
 * Kept verbatim rather than tidied: the nulls, the duplicated locality and the
 * odd `floor` value ("5, TTC Industrial Area") are what the GST registry
 * actually holds, and they are exactly the shapes that broke the first pass.
 */
const live: GstinApiResponse = {
  gstin: GSTIN,
  legal_name: "RELIANCE INDUSTRIES LIMITED",
  trade_name: "RELIANCE INDUSTRIES LIMITED",
  status: "Active",
  taxpayer_type: "Regular",
  business_constitution: null,
  registration_date: "2017-07-01",
  cancellation_date: null,
  state_code: "27",
  state_jurisdiction: null,
  address: "5, 5, TTC Industrial Area, Reliance Corporate Park, Thane Belapur Road, Ghansoli, Navi Mumbai",
  city: "Ghansoli, Navi Mumbai",
  address_details: {
    building_number: "5",
    building_name: "Reliance Corporate Park",
    floor: "5, TTC Industrial Area",
    street: "Thane Belapur Road",
    locality: "Ghansoli, Navi Mumbai",
    district: null,
    city: null,
    state: null,
    landmark: null,
    pincode: "400701",
  },
  pincode: "400701",
  nature_of_business: null,
  block_status: "Unblocked",
};

describe("normaliseGstinResponse — real gstinapi.in payload", () => {
  it("maps the identity fields", () => {
    const d = normaliseGstinResponse(GSTIN, live);
    expect(d.legalName).toBe("RELIANCE INDUSTRIES LIMITED");
    expect(d.tradeName).toBe("RELIANCE INDUSTRIES LIMITED");
    expect(d.status).toBe("Active");
    expect(d.taxpayerType).toBe("Regular");
    expect(d.registrationDate).toBe("2017-07-01");
    expect(d.constitution).toBeNull();
    expect(d.natureOfBusiness).toEqual([]);
  });

  it("fills City and Pin Code from address_details, not the flat string", () => {
    // The first implementation split the one-line address and left both null
    // while the values sat in the response.
    const { addressParts } = normaliseGstinResponse(GSTIN, live);
    expect(addressParts.city).toBe("Ghansoli, Navi Mumbai");
    expect(addressParts.pinCode).toBe("400701");
  });

  it("splits the premises from the street across the two address lines", () => {
    const { addressParts } = normaliseGstinResponse(GSTIN, live);
    expect(addressParts.line1).toBe("5, TTC Industrial Area, 5, Reliance Corporate Park");
    expect(addressParts.line2).toBe("Thane Belapur Road");
  });

  it("does not repeat the locality in both Line 2 and City", () => {
    // `locality` is what `city` falls back to when district is null; printing
    // it in both boxes reads as two different places.
    const { addressParts } = normaliseGstinResponse(GSTIN, live);
    expect(addressParts.line2).not.toContain("Ghansoli");
    expect(addressParts.city).toBe("Ghansoli, Navi Mumbai");
  });

  it("resolves state_code to the name the State picker holds", () => {
    // "27" must never land in the State box verbatim.
    expect(normaliseGstinResponse(GSTIN, live).state).toBe("Maharashtra");
    expect(normaliseGstinResponse("24AAAAA0000A1Z5", { state_code: "24" }).state).toBe("Gujarat");
    expect(normaliseGstinResponse("07AAAAA0000A1Z5", { state_code: 7 }).state).toBe("Delhi");
  });

  it("takes the PAN from the GSTIN, not the response", () => {
    expect(normaliseGstinResponse(GSTIN, live).pan).toBe("AAACR5055K");
    expect(normaliseGstinResponse("2712345234F1Z5", live).pan).toBeNull();
  });

  it("falls back to the GSTIN prefix when no state is given", () => {
    expect(normaliseGstinResponse(GSTIN, { legal_name: "X" }).state).toBe("Maharashtra");
  });

  it("survives an almost-empty record", () => {
    const d = normaliseGstinResponse(GSTIN, {});
    expect(d.legalName).toBeNull();
    expect(d.address).toBeNull();
    expect(d.pan).toBe("AAACR5055K");
  });

  it("treats blank strings as absent", () => {
    const d = normaliseGstinResponse(GSTIN, { legal_name: "  ", trade_name: "" });
    expect(d.legalName).toBeNull();
    expect(d.tradeName).toBeNull();
  });

  it("takes city and pincode from the top level when address_details is absent", () => {
    const d = normaliseGstinResponse(GSTIN, {
      address: "Some Street, Pune",
      city: "Pune",
      pincode: "411001",
    });
    expect(d.addressParts.city).toBe("Pune");
    expect(d.addressParts.pinCode).toBe("411001");
  });

  it("accepts nature_of_business as a bare string", () => {
    expect(normaliseGstinResponse(GSTIN, { nature_of_business: "Retail" }).natureOfBusiness).toEqual([
      "Retail",
    ]);
  });
});

describe("normaliseGstinResponse — GSTN passthrough", () => {
  // Tolerated because several providers forward the raw registry record.
  it("reads the nested shape too", () => {
    const d = normaliseGstinResponse(GSTIN, {
      lgnm: "ABC INDUSTRIES PRIVATE LIMITED",
      sts: "Active",
      dty: "Regular",
      pradr: { addr: { bno: "Plot 12", st: "MIDC Road", dst: "Mumbai", stcd: "Maharashtra", pncd: "400093" } },
    });
    expect(d.legalName).toBe("ABC INDUSTRIES PRIVATE LIMITED");
    expect(d.state).toBe("Maharashtra");
    expect(d.addressParts.city).toBe("Mumbai");
    expect(d.addressParts.pinCode).toBe("400093");
  });
});
