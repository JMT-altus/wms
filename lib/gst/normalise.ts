import { GST_STATES, stateFromStateCode } from "@/lib/masters/gstin";

/**
 * The GST registry record, flattened into the shape the KYC form fills from.
 *
 * Pure and provider-agnostic on purpose — no network, no `server-only` — so
 * this half can be unit tested without an API key, which is where most of the
 * risk in an integration like this actually lives.
 */

export interface GstinDetails {
  gstin: string;
  legalName: string | null;
  tradeName: string | null;
  /** Derived from the GSTIN itself — characters 3-12 are the PAN by construction. */
  pan: string | null;
  status: string | null;
  taxpayerType: string | null;
  constitution: string | null;
  registrationDate: string | null;
  natureOfBusiness: string[];
  /** The state NAME, resolved from whatever the response carried. */
  state: string | null;
  /** The registered address as one line. */
  address: string | null;
  /** The same address split up, for the form's own address boxes. */
  addressParts: {
    line1: string | null;
    line2: string | null;
    city: string | null;
    state: string | null;
    pinCode: string | null;
  };
}

/**
 * The record gstinapi.in returns, confirmed against a live lookup.
 *
 * Richer than the published field list: alongside the flat `address` string
 * it carries `address_details` broken into parts, plus `city` and `pincode`
 * at the top level. Reading those is the difference between filling the
 * form's City and Pin boxes and leaving them empty while the data sits right
 * there in the response.
 *
 * The nested GSTN `pradr` shape is tolerated too, since several providers
 * forward the raw registry payload and it costs a few lines to accept both.
 */
export interface GstinApiResponse {
  gstin?: string;
  legal_name?: string;
  trade_name?: string;
  status?: string;
  taxpayer_type?: string;
  business_constitution?: string | null;
  state_code?: string | number;
  state?: string;
  state_jurisdiction?: string | null;
  registration_date?: string;
  cancellation_date?: string | null;
  nature_of_business?: string[] | string | null;
  block_status?: string | null;
  address?: string | GstnAddr;
  city?: string | null;
  pincode?: string | null;
  address_details?: {
    building_number?: string | null;
    building_name?: string | null;
    floor?: string | null;
    street?: string | null;
    locality?: string | null;
    district?: string | null;
    city?: string | null;
    state?: string | null;
    landmark?: string | null;
    pincode?: string | null;
  } | null;
  /** GSTN passthrough, if the provider forwards the raw record. */
  lgnm?: string;
  tradeNam?: string;
  sts?: string;
  dty?: string;
  rgdt?: string;
  ctb?: string;
  stj?: string;
  nba?: string[] | string;
  pradr?: { addr?: GstnAddr };
}

export interface GstnAddr {
  bno?: string;
  bnm?: string;
  flno?: string;
  st?: string;
  loc?: string;
  city?: string;
  dst?: string;
  stcd?: string;
  pncd?: string;
  landMark?: string;
  locality?: string;
}

const clean = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length === 0 ? null : t;
};

const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

/**
 * Join the parts that are actually present.
 *
 * Without this, a registration carrying only a plot number renders as
 * ", , , 400001" — punctuation standing in for data that was never there.
 */
function joinParts(...parts: (string | null | undefined)[]): string | null {
  const joined = parts.map(clean).filter(Boolean).join(", ");
  return joined.length === 0 ? null : joined;
}

/**
 * Pull a pin code and a state name out of a one-line address.
 *
 * gstinapi.in documents `address` as a single string, so the form's separate
 * City / State / Pin boxes have nothing to read unless the line is picked
 * apart. Only the two unambiguous pieces are taken — a six-digit run is a pin
 * code, and a trailing segment matching a real state name is that state.
 * Guessing at street versus city from comma positions would be inventing
 * data, so the whole line goes to Address Line 1 and the user tidies it.
 */
function splitOneLineAddress(line: string): GstinDetails["addressParts"] {
  const pin = line.match(/\b(\d{6})\b/)?.[1] ?? null;

  const segments = line
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);

  let state: string | null = null;
  // Scanned from the end: an Indian address puts the state last, just before
  // or after the pin code.
  for (let i = segments.length - 1; i >= 0 && i >= segments.length - 3; i--) {
    const candidate = segments[i]!.replace(/\b\d{6}\b/, "").trim();
    const match = GST_STATES.find((s) => s.toLowerCase() === candidate.toLowerCase());
    if (match) {
      state = match;
      break;
    }
  }

  // Everything that is not the pin code or the state, kept in order.
  const rest = segments
    .map((p) => p.replace(/\b\d{6}\b/, "").trim())
    .filter((p) => p.length > 0 && p.toLowerCase() !== (state ?? "").toLowerCase());

  return {
    line1: rest.join(", ") || null,
    line2: null,
    city: null,
    state,
    pinCode: pin,
  };
}

/**
 * A state name, whatever form it arrived in — a code ("27"), or the name
 * itself. Returns null for anything that is neither.
 */
function resolveStateName(v: string | number | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const text = String(v).trim();
  if (text.length === 0) return null;
  const byCode = stateFromStateCode(text);
  if (byCode) return byCode;
  return GST_STATES.find((s) => s.toLowerCase() === text.toLowerCase()) ?? null;
}

function partsFromGstnAddr(a: GstnAddr): GstinDetails["addressParts"] {
  return {
    // Split rather than concatenated, so the premises land in Address Line 1
    // and the street in Line 2 instead of one long run-on.
    line1: joinParts(a.flno, a.bno, a.bnm),
    line2: joinParts(a.st, a.landMark, a.locality ?? a.loc),
    city: clean(a.dst) ?? clean(a.city) ?? clean(a.loc),
    state: clean(a.stcd),
    pinCode: clean(a.pncd),
  };
}

export function normaliseGstinResponse(gstin: string, raw: GstinApiResponse): GstinDetails {
  // Flat field first, GSTN passthrough second — see GstinApiResponse.
  const legalName = clean(raw.legal_name) ?? clean(raw.lgnm);
  const tradeName = clean(raw.trade_name) ?? clean(raw.tradeNam);
  const status = clean(raw.status) ?? clean(raw.sts);
  const taxpayerType = clean(raw.taxpayer_type) ?? clean(raw.dty);
  const registrationDate = clean(raw.registration_date) ?? clean(raw.rgdt);
  const constitution = clean(raw.business_constitution) ?? clean(raw.ctb);

  const rawNba = raw.nature_of_business ?? raw.nba;
  const natureOfBusiness = Array.isArray(rawNba)
    ? rawNba.map(clean).filter((v): v is string => v !== null)
    : clean(rawNba)
      ? [clean(rawNba)!]
      : [];

  // Best source first. `address_details` is the structured one and is what
  // lets City and Pin Code reach their own boxes; splitting the flat string
  // is the last resort, and it can only ever recover a pin code and a state.
  const details = raw.address_details;
  const nested = raw.pradr?.addr ?? (typeof raw.address === "object" ? raw.address : undefined);

  let addressParts: GstinDetails["addressParts"];
  if (details) {
    addressParts = {
      line1: joinParts(details.floor, details.building_number, details.building_name),
      // Locality is deliberately NOT repeated here — it is usually what `city`
      // holds when the district is blank, and printing it twice reads as two
      // different places.
      line2: joinParts(details.street, details.landmark),
      city: clean(details.district) ?? clean(details.city) ?? clean(raw.city) ?? clean(details.locality),
      state: clean(details.state),
      pinCode: clean(details.pincode) ?? clean(raw.pincode),
    };
  } else if (nested) {
    addressParts = partsFromGstnAddr(nested);
  } else if (typeof raw.address === "string" && raw.address.trim()) {
    addressParts = splitOneLineAddress(raw.address.trim());
    // The flat string rarely yields these, but the response carries them
    // separately — so take them rather than leaving the boxes empty.
    addressParts.city = addressParts.city ?? clean(raw.city);
    addressParts.pinCode = addressParts.pinCode ?? clean(raw.pincode);
  } else {
    addressParts = {
      line1: null,
      line2: null,
      city: clean(raw.city),
      state: null,
      pinCode: clean(raw.pincode),
    };
  }

  // The State field holds names, so a bare code has to be resolved through the
  // official list the pickers already use. Order: an explicit state name, the
  // state code, whatever the address yielded, then the GSTIN's own prefix —
  // which is always present and can never contradict the number searched.
  const state =
    resolveStateName(raw.state) ??
    resolveStateName(raw.state_code) ??
    resolveStateName(addressParts.state) ??
    resolveStateName(raw.address_details?.state) ??
    stateFromStateCode(gstin.slice(0, 2));

  // The PAN sits inside the GSTIN by construction, so it needs no field of its
  // own in the response and cannot disagree with the number that was searched.
  const panPart = gstin.slice(2, 12);

  // The resolved state is what both outputs carry, so the one-line address and
  // the split parts can never disagree about which state this client is in.
  const parts = { ...addressParts, state: state ?? addressParts.state };

  return {
    gstin: clean(raw.gstin) ?? gstin,
    legalName,
    tradeName,
    pan: PAN_RE.test(panPart) ? panPart : null,
    status,
    taxpayerType,
    constitution,
    registrationDate,
    natureOfBusiness,
    state,
    // Composed only when the response actually carried an address. The state
    // alone is not one — it is derived from the GSTIN and would turn an empty
    // record into an address line reading "Maharashtra".
    address:
      typeof raw.address === "string" && raw.address.trim()
        ? raw.address.trim()
        : parts.line1 || parts.line2 || parts.city || parts.pinCode
          ? joinParts(parts.line1, parts.line2, parts.city, parts.state, parts.pinCode)
          : null,
    addressParts: parts,
  };
}
