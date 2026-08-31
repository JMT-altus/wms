/**
 * GSTIN → State derivation for the Create New Client KYC form's Identity
 * section. A GSTIN's first two digits are the official GST state code
 * (public regulatory data, not a business list this app invents).
 * Best-effort assist only — the derived state stays editable, and an
 * unrecognised or incomplete GSTIN just returns null instead of blocking.
 */
const GST_STATE_CODES: Record<string, string> = {
  "01": "Jammu and Kashmir",
  "02": "Himachal Pradesh",
  "03": "Punjab",
  "04": "Chandigarh",
  "05": "Uttarakhand",
  "06": "Haryana",
  "07": "Delhi",
  "08": "Rajasthan",
  "09": "Uttar Pradesh",
  "10": "Bihar",
  "11": "Sikkim",
  "12": "Arunachal Pradesh",
  "13": "Nagaland",
  "14": "Manipur",
  "15": "Mizoram",
  "16": "Tripura",
  "17": "Meghalaya",
  "18": "Assam",
  "19": "West Bengal",
  "20": "Jharkhand",
  "21": "Odisha",
  "22": "Chhattisgarh",
  "23": "Madhya Pradesh",
  "24": "Gujarat",
  "26": "Dadra and Nagar Haveli and Daman and Diu",
  "27": "Maharashtra",
  "28": "Andhra Pradesh (Old)",
  "29": "Karnataka",
  "30": "Goa",
  "31": "Lakshadweep",
  "32": "Kerala",
  "33": "Tamil Nadu",
  "34": "Puducherry",
  "35": "Andaman and Nicobar Islands",
  "36": "Telangana",
  "37": "Andhra Pradesh",
  "38": "Ladakh",
};

/**
 * The same official list as selectable options, A–Z. Used by the State pickers in
 * Registration & Tax and on every address block — there is no `state` lookup
 * list to manage, and inventing one would mean an admin re-typing regulatory
 * data that already lives here.
 */
export const GST_STATES: readonly string[] = Object.values(GST_STATE_CODES).sort((a, b) =>
  a.localeCompare(b),
);

/**
 * Official GST state code → state name, e.g. "24" → "Gujarat".
 *
 * Exported because a verification API returns the code rather than the name,
 * and the State field holds names. This is the same regulatory list the
 * pickers are built from — there is no second state master to keep in step.
 *
 * Tolerates a single-digit code ("7"), which some sources emit unpadded.
 */
export function stateFromStateCode(code: string | number | null | undefined): string | null {
  if (code === null || code === undefined) return null;
  const key = String(code).trim().padStart(2, "0");
  return GST_STATE_CODES[key] ?? null;
}

/** Best-effort GSTIN → state name. Returns null for anything unrecognised. */
export function deriveStateFromGstin(gstin: string | null | undefined): string | null {
  if (!gstin) return null;
  return stateFromStateCode(gstin.trim().slice(0, 2));
}

/**
 * Loose GSTIN shape check (15 chars, digits + state code + PAN pattern +
 * entity code + 'Z' + checksum). Used only to hint validity, not to block
 * the field — plenty of legitimate legacy data won't match perfectly.
 */
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
export function isPlausibleGstin(gstin: string): boolean {
  return GSTIN_RE.test(gstin.trim().toUpperCase());
}

/**
 * The PAN embedded in a GSTIN.
 *
 * A GSTIN is not an opaque number: it is `SS` + `PAN` + entity code + `Z` +
 * checksum, so characters 3-12 ARE the holder's PAN by construction. No
 * lookup, no API, no network — the number the user already typed contains it.
 *
 * Returns null unless those ten characters match the PAN shape, so a
 * half-typed or malformed GSTIN yields nothing rather than a wrong PAN.
 * Best-effort assist, exactly like `deriveStateFromGstin`: what it produces
 * stays editable and anything the user typed themselves wins.
 */
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

export function panFromGstin(gstin: string | null | undefined): string | null {
  if (!gstin) return null;
  const pan = gstin.trim().toUpperCase().slice(2, 12);
  return PAN_RE.test(pan) ? pan : null;
}
