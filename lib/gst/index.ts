import "server-only";
import { normaliseGstinResponse, type GstinApiResponse, type GstinDetails } from "./normalise";

export type { GstinDetails } from "./normalise";

/**
 * GSTIN verification via gstinapi.in.
 *
 * Server-only, and the `server-only` import above enforces it: the API key
 * must never reach a browser bundle, so a client component importing this
 * file fails the build rather than shipping the credential.
 *
 * One call, no token exchange:
 *   GET https://www.gstinapi.in/v1/gstin/{GSTIN}   header: x-api-key
 *
 * Nothing is written to the database and no second GST store exists: this
 * returns what the registry says, the form fills its boxes from it, and the
 * client record is saved by the ordinary KYC path.
 */

const BASE_URL = "https://www.gstinapi.in/v1/gstin";

/** Bounded so a silent upstream cannot hold a request open indefinitely. */
const TIMEOUT_MS = 12_000;

export type GstinFailure =
  | "not_configured"
  | "invalid"
  | "not_found"
  | "unauthorised"
  | "no_credits"
  | "rate_limited"
  | "provider_error"
  | "unavailable";

export type GstinLookup =
  | { ok: true; data: GstinDetails }
  | { ok: false; reason: GstinFailure; error: string };

/**
 * One message per documented status, worded for the person at the form.
 *
 * A 401 or 402 is an administrator's problem, not the user's, so those say to
 * contact an administrator rather than implying the GSTIN they typed is
 * wrong — and neither leaks anything about the key or the account.
 */
const MESSAGES: Record<GstinFailure, string> = {
  not_configured:
    "GST verification is not configured correctly. Please contact the administrator.",
  invalid: "Enter a valid GSTIN.",
  not_found: "GSTIN not found. Please check the GSTIN and try again.",
  unauthorised:
    "GST verification is not configured correctly. Please contact the administrator.",
  no_credits: "GST verification credits are unavailable. Please contact the administrator.",
  rate_limited: "Too many GST verification requests. Please try again shortly.",
  provider_error: "GST verification service is temporarily unavailable. Please try again.",
  unavailable: "GST verification is temporarily unavailable. Please try again.",
};

const fail = (reason: GstinFailure): GstinLookup => ({
  ok: false,
  reason,
  error: MESSAGES[reason],
});

export function isGstVerificationConfigured(): boolean {
  return Boolean(process.env.GSTIN_API_KEY);
}

/**
 * Look one GSTIN up in the GST registry.
 *
 * Never throws: every failure comes back as a typed reason the caller turns
 * into a message, because the one thing this must not do is take down a form
 * someone has been filling in for ten minutes.
 *
 * The caller is expected to have checked the GSTIN's shape already — a
 * malformed number is refused before the network is touched, so it cannot
 * burn a request against the account's quota.
 */
export async function lookupGstin(gstin: string): Promise<GstinLookup> {
  const apiKey = process.env.GSTIN_API_KEY;
  if (!apiKey) return fail("not_configured");

  const clean = gstin.trim().toUpperCase();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${BASE_URL}/${encodeURIComponent(clean)}`, {
      method: "GET",
      headers: { "x-api-key": apiKey, Accept: "application/json" },
      signal: controller.signal,
      cache: "no-store",
    });

    if (!res.ok) {
      switch (res.status) {
        // Documented as "malformed GSTIN" — and documented as NOT consuming a
        // credit, which is why the shape check happens before this call at all.
        case 400:
          return fail("invalid");
        case 401:
        case 403:
          return fail("unauthorised");
        case 402:
          return fail("no_credits");
        case 404:
          return fail("not_found");
        case 429:
          return fail("rate_limited");
        case 502:
        case 503:
        case 504:
          return fail("provider_error");
        default:
          // Status only. Never the key, never the response body, which could
          // carry account or taxpayer detail.
          console.error(`[gst] ${clean} → HTTP ${res.status}`);
          return fail("unavailable");
      }
    }

    const body = (await res.json()) as
      | (GstinApiResponse & { data?: GstinApiResponse; error?: unknown; message?: string })
      | null;
    if (!body) return fail("not_found");

    // Some wrappers nest the record under `data`; read either.
    const record: GstinApiResponse = body.data ?? body;

    // A 200 carrying an error object is a "not found" in disguise — the status
    // code alone would read it as a success with every field empty.
    if (body.error && !record.gstin && !record.legal_name && !record.lgnm) {
      return fail("not_found");
    }
    if (!record.gstin && !record.legal_name && !record.lgnm) return fail("not_found");

    return { ok: true, data: normaliseGstinResponse(clean, record) };
  } catch (err) {
    // AbortError is the timeout; anything else is a network fault. Both are
    // "try again", and neither should say anything about the configuration.
    console.error(`[gst] ${clean} lookup failed`, (err as Error)?.name);
    return fail("unavailable");
  } finally {
    clearTimeout(timer);
  }
}
