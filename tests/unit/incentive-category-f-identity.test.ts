import { describe, expect, it } from "vitest";
import { normaliseMessageId, normaliseReference, normaliseSender, normaliseSubject, testimonialIdentity } from "@/lib/incentives/categories/f-identity";

// Category F (0139): the identity of an email or letterhead testimonial — deterministic, normalised, and the same
// however the same email or letter is entered. Pure; synthetic values only.
const CUST = "6f1c2d3e-4b5a-4c6d-8e7f-0a1b2c3d4e5f";
const OTHER = "7a1c2d3e-4b5a-4c6d-8e7f-0a1b2c3d4e5f";
const email = (evidence: Parameters<typeof testimonialIdentity>[1]["evidence"], o: { customerId?: string; date?: string } = {}) => testimonialIdentity("email", { customerId: o.customerId ?? CUST, date: o.date ?? "2026-09-12", evidence });
const letter = (reference: string | null, o: { customerId?: string; date?: string } = {}) => testimonialIdentity("letterhead", { customerId: o.customerId ?? CUST, date: o.date ?? "2026-09-15", evidence: { reference } });
const ok = <T extends { ok: boolean }>(r: T) => {
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r as Extract<T, { ok: true }>;
};

describe("normalisation", () => {
  it("a Message-ID: brackets, case, spaces and a 'Message-ID:' prefix don't matter; a malformed one is refused, none is null", () => {
    for (const v of ["<CA+abc@Mail.Example.com>", "  ca+abc@mail.example.com ", "Message-ID: <CA+ABC@MAIL.EXAMPLE.COM>", "<<ca+abc@mail.example.com>>"]) expect(normaliseMessageId(v)).toBe("ca+abc@mail.example.com");
    expect(normaliseMessageId("")).toBeNull();
    expect(normaliseMessageId(null)).toBeNull();
    for (const bad of ["no at sign", "a b@c", "@x", "x@", `${"a".repeat(300)}@b`]) expect(normaliseMessageId(bad)).toBe(false);
  });
  it("a sender: its address alone, lower case; a display name, mailto: or invisible characters don't matter; a non-address is refused", () => {
    for (const v of ["Cust A Accounts <Accounts@Cust-A.example>", "accounts@cust-a.example", "  MAILTO:accounts@cust-a.example ", "accounts@cust-a.example​"]) expect(normaliseSender(v)).toBe("accounts@cust-a.example");
    for (const bad of ["", "Cust A", "accounts@localhost", "a b@c.d"]) expect(normaliseSender(bad)).toBeNull();
  });
  it("a subject: case, spacing, Unicode width and reply / forward prefixes don't matter; '(no subject)' is none; nothing given is null", () => {
    const want = "thank you for the quick support";
    for (const v of ["Thank you for the quick support", "RE: Re:  thank you for the QUICK support ", "Fwd: FW: Thank you for the quick support", "AW: Thank you for the quick support", "Re[2]: Thank you for the quick support"]) expect(normaliseSubject(v)).toBe(want);
    expect(normaliseSubject("(No subject)")).toBe("");
    expect(normaliseSubject("   ")).toBeNull();
    // A different subject stays different.
    expect(normaliseSubject("Thank you for the quick support!")).not.toBe(want);
  });
  it("a reference number: separators and spaces unified, case ignored; nothing given is null", () => {
    for (const v of ["CA/2026/77", "ca-2026-77", " CA / 2026 – 77 ", "CA.2026.77", "ca_2026:77", "CA\\2026\\77"]) expect(normaliseReference(v)).toBe("ca/2026/77");
    expect(normaliseReference(" - ")).toBeNull();
    expect(normaliseReference("CA/2026/78")).not.toBe("ca/2026/77");
  });
});

describe("an email's identity", () => {
  const BASE = { messageId: "<CA+thanks-123@cust-a.example>", sender: "Cust A <accounts@cust-a.example>", subject: "Thank you for the quick support" };
  it("is deterministic: the Message-ID is its key; the fingerprint (customer, sender, date, subject) is always recorded", () => {
    const a = ok(email(BASE));
    expect(a).toEqual({ ok: true, evidenceKey: "email:mid:ca+thanks-123@cust-a.example", messageId: "ca+thanks-123@cust-a.example", fingerprint: expect.stringMatching(/^email:[0-9a-f]{64}$/) });
    expect(ok(email(BASE))).toEqual(a);
  });
  it("entered by its Message-ID once and by its sender, date and subject once — the SAME fingerprint (so the database refuses the second)", () => {
    const withId = ok(email(BASE));
    const without = ok(email({ sender: "ACCOUNTS@CUST-A.EXAMPLE", subject: "re: thank you for the QUICK support" }));
    expect(without.messageId).toBeNull();
    expect(without.evidenceKey).toBe(without.fingerprint);
    expect(without.fingerprint).toBe(withId.fingerprint);
  });
  it("entered twice with its Message-ID but a differently typed subject — the SAME Message-ID (the database refuses the second)", () => {
    const a = ok(email(BASE));
    const b = ok(email({ ...BASE, subject: "Thanks for the quick support" }));
    expect(b.fingerprint).not.toBe(a.fingerprint);
    expect(b.messageId).toBe(a.messageId);
    expect(b.evidenceKey).toBe(a.evidenceKey);
  });
  it("genuinely different emails are different: another sender, date, subject or customer", () => {
    const a = ok(email({ sender: BASE.sender, subject: BASE.subject }));
    for (const other of [email({ sender: "md@cust-a.example", subject: BASE.subject }), email({ sender: BASE.sender, subject: BASE.subject }, { date: "2026-09-13" }), email({ sender: BASE.sender, subject: "Second order delivered" }), email({ sender: BASE.sender, subject: BASE.subject }, { customerId: OTHER })]) expect(ok(other).fingerprint).not.toBe(a.fingerprint);
  });
  it("the customer's id is compared without case", () => {
    expect(ok(email(BASE, { customerId: CUST.toUpperCase() })).fingerprint).toBe(ok(email(BASE)).fingerprint);
  });
  it("can't be established without a readable sender and a subject, or with a malformed Message-ID: refused (fail closed)", () => {
    expect(email({ ...BASE, sender: "" })).toEqual({ ok: false, error: expect.stringMatching(/Record the sender's email address/) });
    expect(email({ ...BASE, subject: null })).toEqual({ ok: false, error: expect.stringMatching(/Record the email's subject/) });
    expect(email({ ...BASE, messageId: "not one" })).toEqual({ ok: false, error: expect.stringMatching(/isn't an email Message-ID/) });
    expect(email(null)).toMatchObject({ ok: false });
    expect(email({ ...BASE, subject: "x".repeat(501) })).toEqual({ ok: false, error: expect.stringMatching(/longer than 500/) });
  });
});

describe("a letter's identity", () => {
  it("with a reference: customer + reference is its key (separators ignored); customer + date is its fingerprint", () => {
    const a = ok(letter("CA / 2026-77"));
    expect(a).toEqual({ ok: true, evidenceKey: `letter:ref:${CUST}:ca/2026/77`, messageId: null, fingerprint: expect.stringMatching(/^letter:[0-9a-f]{64}$/) });
    // The same reference typed another way, on another date (a typo): the same key.
    expect(ok(letter("ca-2026-77", { date: "2026-09-16" })).evidenceKey).toBe(a.evidenceKey);
    // The same reference from another customer is another letter.
    expect(ok(letter("CA/2026/77", { customerId: OTHER })).evidenceKey).not.toBe(a.evidenceKey);
  });
  it("without a reference: the customer and date are its identity — another letter from that customer that day can't be told apart (held, never accepted)", () => {
    const noRef = ok(letter(null));
    expect(noRef.evidenceKey).toBe(noRef.fingerprint);
    expect(noRef.fingerprint).toBe(ok(letter("CA/2026/77")).fingerprint);
    expect(ok(letter(null, { date: "2026-09-16" })).fingerprint).not.toBe(noRef.fingerprint);
  });
  it("an email and a letter never share an identity", () => {
    const e = ok(email({ sender: "a@cust-a.example", subject: "x" }, { date: "2026-09-15" }));
    const l = ok(letter(null));
    expect(e.fingerprint.startsWith("email:")).toBe(true);
    expect(l.fingerprint.startsWith("letter:")).toBe(true);
  });
});
