/**
 * Category F — a Google review link's identity (pure). A review is unique by its Google review ID where the link
 * carries it reliably, and otherwise by its NORMALISED URL: lower-case host without "www.", no fragment, no tracking or
 * display parameters, query parameters sorted, no trailing slash. Links that can't be resolved without the network
 * (Google's short links) have no identity here: they go to Admin Review, where a verifier records the canonical review.
 * Nothing is fetched; nothing is guessed.
 */

export type ReviewLink =
  | { ok: true; resolved: true; urlKey: string; googleReviewId: string | null }
  | { ok: true; resolved: false; reason: string }
  | { ok: false; error: string };

/** Hosts whose links only redirect (resolving them needs a network call): Admin Review. */
const SHORT_HOSTS = new Set(["maps.app.goo.gl", "goo.gl", "g.page", "g.co", "share.google"]);
/** Parameters that never identify a review (tracking, language, display). */
const NOISE = /^(utm_.*|hl|gl|entry|g_ep|g_st|authuser|ved|sa|source|sca_esv|ei|uact|rlz|oq|gs_lcrp|sourceid|ie|ust|usg|shorturl|skid)$/i;
/** Google's own hosts only — google.com, google.<cc>, google.co.<cc>, google.com.<cc> (also www. and maps.), search. and business.google.com — never a look-alike such as google.evil.com. */
const isGoogleHost = (h: string) => /^(www\.|maps\.)?google\.(com|[a-z]{2}|co\.[a-z]{2}|com\.[a-z]{2})$/.test(h) || h === "search.google.com" || h === "business.google.com";

/** The Google review ID a link carries, when it carries one reliably: a review-ID parameter, or the !1s… token of a review path. */
export function reviewIdOf(u: URL): string | null {
  for (const k of ["reviewId", "review_id", "rid"]) {
    const v = u.searchParams.get(k);
    if (v && /^[A-Za-z0-9_-]{8,300}$/.test(v)) return v;
  }
  // Google Maps review links carry the review as a "!1sCh…" token (base64 of "\n…") inside the data part of the path.
  const m = decodeURIComponent(u.pathname + u.search).match(/!1s(Ch[A-Za-z0-9_-]{10,300}?)(?=!|$|&|\?)/);
  return m ? m[1]! : null;
}

export function reviewLink(raw: string): ReviewLink {
  const text = (raw ?? "").trim();
  if (!text) return { ok: false, error: "Give the public Google review link (it is required)." };
  if (text.length > 2000) return { ok: false, error: "The link is longer than 2,000 characters." };
  let u: URL;
  try {
    u = new URL(text);
  } catch {
    return { ok: false, error: "That isn't a link: copy the public Google review's address." };
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return { ok: false, error: "The link must start with https://." };
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  if (SHORT_HOSTS.has(host)) return { ok: true, resolved: false, reason: `A ${host} short link can't be resolved here: an authorised reviewer links it to the review.` };
  if (!isGoogleHost(u.hostname.toLowerCase())) return { ok: false, error: "Only a public Google review link is accepted (google.com/maps or search.google.com)." };
  const params = [...u.searchParams.entries()].filter(([k]) => !NOISE.test(k)).sort(([a, av], [b, bv]) => (a === b ? (av < bv ? -1 : 1) : a < b ? -1 : 1));
  const path = decodeURIComponent(u.pathname).replace(/\/+$/, "") || "/";
  const query = params.map(([k, v]) => `${k}=${v}`).join("&");
  const urlKey = `${host}${path}${query ? `?${query}` : ""}`;
  return { ok: true, resolved: true, urlKey, googleReviewId: reviewIdOf(u) };
}

/** Words in a review's text (whitespace-separated). */
export const wordsIn = (text: string | null | undefined) => ((text ?? "").trim() ? (text ?? "").trim().split(/\s+/).length : 0);

export type TestimonialKind = "google_review" | "email" | "letterhead";

/**
 * A submitted testimonial's registry identity (0138), across employees AND types. A Google review (F.1) needs its public
 * Google review link (reviewLink). An email (F.2) or letterhead (F.3) testimonial needs a link to its evidence (the
 * email, or the scanned letter); its identity is that link normalised ("doc:" + host without "www." + path + sorted
 * query, no fragment, no tracking parameters). A Google review link given as email or letterhead evidence keeps its Google
 * identity, so the same review can never earn again as another type. The same document under another link is caught when
 * it is verified (its evidence identity is unique). Nothing is fetched.
 */
export function testimonialLink(raw: string, kind: TestimonialKind): ReviewLink {
  if (kind === "google_review") return reviewLink(raw);
  const text = (raw ?? "").trim();
  if (!text) return { ok: false, error: `Give the link to the ${kind === "email" ? "email" : "letter on the customer's letterhead"} (it is required).` };
  if (text.length > 2000) return { ok: false, error: "The link is longer than 2,000 characters." };
  let u: URL;
  try {
    u = new URL(text);
  } catch {
    return { ok: false, error: "That isn't a link: give the address of the uploaded email or letter." };
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return { ok: false, error: "The link must start with https://." };
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  if (SHORT_HOSTS.has(host) || isGoogleHost(u.hostname.toLowerCase())) {
    const g = reviewLink(text);
    if (g.ok) return g;
  }
  const params = [...u.searchParams.entries()].filter(([k]) => !NOISE.test(k)).sort(([a, av], [b, bv]) => (a === b ? (av < bv ? -1 : 1) : a < b ? -1 : 1));
  const path = decodeURIComponent(u.pathname).replace(/\/+$/, "") || "/";
  const query = params.map(([k, v]) => `${k}=${v}`).join("&");
  return { ok: true, resolved: true, urlKey: `doc:${host}${path}${query ? `?${query}` : ""}`, googleReviewId: null };
}

/**
 * An email or letterhead testimonial's EVIDENCE IDENTITY, as the verifier records it (0138) — for an email its
 * Message-ID (or sender, date and subject), for a letter its reference number, date and customer: compared without
 * case, surrounding spaces or repeated spaces. Unique among active verifications, so the same testimonial earns once
 * across employees and types. Null when it is too short or too long to identify anything.
 */
export function evidenceKeyOf(raw: string | null | undefined): string | null {
  const key = (raw ?? "").normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
  return key.length >= 3 && key.length <= 500 ? key : null;
}
