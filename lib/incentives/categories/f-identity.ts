import { createHash } from "node:crypto";

/**
 * Category F — the identity of an EMAIL (F.2) or LETTERHEAD (F.3) testimonial, derived deterministically from what the
 * verifier reads off the original (pure; migration 0139 stores it and makes it unique in the database). The same email
 * or letter therefore gets the same identity however, and by whomever, it is entered — and can be verified only once,
 * across employees and testimonial types. A Google review's identity is its Google review ID / normalised link (f-url.ts).
 *
 *   EMAIL      fingerprint  'email:'  + sha256(customer, sender address, date, subject)   — ALWAYS recorded
 *              Message-ID   normalised (no angle brackets, lower case)                     — when the email shows one
 *              primary key  'email:mid:<Message-ID>' when there is one, else the fingerprint
 *   LETTERHEAD fingerprint  'letter:' + sha256(customer, date)                              — ALWAYS recorded
 *              primary key  'letter:ref:<customer>:<reference>' when it has a reference number, else the fingerprint
 *
 * Each of the three is unique among active verifications, so the same email entered once by its Message-ID and once by
 * its sender, date and subject collides on the fingerprint; the same one entered with a mistyped subject collides on the
 * Message-ID. Two genuinely different emails from the same customer and sender, on the same date, with the same subject
 * (or two letters from one customer on one date) can't be told apart safely: the second is refused and HELD for Admin
 * Review — never accepted as possibly the same one.
 *
 * Normalisation: Unicode NFKC, invisible characters removed, surrounding space trimmed, inner space collapsed, lower case.
 * Subjects lose their reply / forward prefixes (Re:, Fw:, Fwd:, AW:, WG:); "(no subject)" means none. A sender is its
 * address alone ("Name <a@b.com>" → "a@b.com"). A reference number keeps its letters and digits, with every separator
 * (space, -, /, \, ., _, :, dashes) unified ("JMT / 2026-045" = "jmt/2026/045").
 */

export interface EvidenceIdentityInput {
  /** An email's Message-ID header, if it shows one ("<…@…>"). */
  messageId?: string | null;
  /** An email's sender as it shows it ("Name <name@customer.com>" or the address). */
  sender?: string | null;
  /** An email's subject as it shows it; "(no subject)" when it has none. */
  subject?: string | null;
  /** A letter's reference number, if it has one. */
  reference?: string | null;
}
export type EvidenceIdentity = { ok: true; evidenceKey: string; messageId: string | null; fingerprint: string } | { ok: false; error: string };

const clean = (s: string | null | undefined) =>
  (s ?? "")
    .normalize("NFKC")
    .replace(/[​-‍⁠﻿]/g, "")
    .trim();
const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
/** Unit separator between the parts hashed: no part can run into the next. */
const US = "\u001f";

/** A Message-ID without its brackets, lower case; null when none was given; false when it isn't one. */
export function normaliseMessageId(raw: string | null | undefined): string | null | false {
  const s = clean(raw).replace(/^message-id:\s*/i, "").trim();
  if (!s) return null;
  const m = s.replace(/^<+/, "").replace(/>+$/, "").trim().toLowerCase();
  return m.length <= 300 && /^[^\s<>@]+@[^\s<>@]+$/.test(m) ? m : false;
}
/** A sender's address alone, lower case; null when it isn't one. */
export function normaliseSender(raw: string | null | undefined): string | null {
  const s = clean(raw);
  const inBrackets = s.match(/<([^<>]+)>\s*$/);
  const addr = (inBrackets ? inBrackets[1]! : s).trim().replace(/^mailto:/i, "").toLowerCase();
  return addr.length <= 254 && /^[^\s@<>"(),;:]+@[^\s@<>"(),;:]+\.[^\s@<>"(),;:]+$/.test(addr) ? addr : null;
}
/** A subject without reply / forward prefixes, collapsed, lower case; "" for "(no subject)"; null when nothing was given. */
export function normaliseSubject(raw: string | null | undefined): string | null {
  let s = clean(raw).replace(/\s+/g, " ").toLowerCase();
  if (!s) return null;
  for (let prev = ""; prev !== s; ) {
    prev = s;
    s = s.replace(/^(re|fw|fwd|aw|wg)\s*(\[\d+\])?\s*:\s*/, "").trim();
  }
  return s === "(no subject)" || s === "no subject" ? "" : s;
}
/** A reference number with its separators unified, lower case, no spaces; null when none was given. */
export function normaliseReference(raw: string | null | undefined): string | null {
  const s = clean(raw)
    .toLowerCase()
    .replace(/[\s\-‐-―_.\\:/]+/g, "/")
    .replace(/^\/+|\/+$/g, "");
  return s || null;
}

/**
 * The identity of a verified email or letterhead testimonial. `customerId` is its Customer Master record and `date` its
 * own date (yyyy-mm-dd), both already checked by the caller. Refuses (never guesses) when the identity can't be
 * established safely.
 */
export function testimonialIdentity(kind: "email" | "letterhead", x: { customerId: string; date: string; evidence: EvidenceIdentityInput | null | undefined }): EvidenceIdentity {
  const e = x.evidence ?? {};
  const customer = x.customerId.toLowerCase();
  if (kind === "email") {
    const mid = normaliseMessageId(e.messageId);
    if (mid === false) return { ok: false, error: "That isn't an email Message-ID (it looks like <something@domain>). Leave it empty if the email doesn't show one." };
    const sender = normaliseSender(e.sender);
    if (!sender) return { ok: false, error: "Record the sender's email address as the email shows it (for example name@customer.com), so the same email can never earn twice. If it can't be read, hold it for review." };
    const subject = normaliseSubject(e.subject);
    if (subject === null) return { ok: false, error: "Record the email's subject as it shows it (type “(no subject)” if it has none), so the same email can never earn twice." };
    if (subject.length > 500) return { ok: false, error: "The subject is longer than 500 characters." };
    const fingerprint = `email:${sha(["email", customer, sender, x.date, subject].join(US))}`;
    return { ok: true, evidenceKey: mid ? `email:mid:${mid}` : fingerprint, messageId: mid, fingerprint };
  }
  const ref = normaliseReference(e.reference);
  if (ref && ref.length > 200) return { ok: false, error: "The reference number is longer than 200 characters." };
  const fingerprint = `letter:${sha(["letter", customer, x.date].join(US))}`;
  return { ok: true, evidenceKey: ref ? `letter:ref:${customer}:${ref}` : fingerprint, messageId: null, fingerprint };
}
