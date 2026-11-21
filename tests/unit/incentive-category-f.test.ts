import { describe, expect, it } from "vitest";
import { calculateCategoryX } from "@/lib/incentives/categories/engine";
import { inputsHashX } from "@/lib/incentives/categories/hash";
import { evidenceKeyOf, reviewLink, testimonialLink, wordsIn } from "@/lib/incentives/categories/f-url";
import type { CategoryXInput, FReviewIn } from "@/lib/incentives/categories/types";
import { decide } from "@/lib/incentives/category-a/settle";
import type { SettingValue } from "@/lib/incentives/rules-config/spec";
import { completeConfig } from "../fixtures/incentive-config";

// Category F (category-f/3; 0137 + 0138): the original scheme's F.1–F.4 in the pure engine, the testimonial identities,
// on SYNTHETIC data; and the one shared change (settle.ts' recovery window) proven unchanged for every other category.
const RS = (r: number) => Math.round(r * 100);
const id = (k: string, n: number) => `00000000-0000-4000-8000-${k}${String(n).padStart(12 - k.length, "0")}`;
const [EMP, EMP2, EMP3] = [id("f0e", 1), id("f0e", 2), id("f0e", 3)];
/** A team member who isn't a salesperson in the programme (an engineer, say): appreciating them by name still doubles. */
const ENGINEER = id("f0e", 9);
const elig = [EMP, EMP2, EMP3].map((e) => ({ subjectType: "employee" as const, subjectId: e, role: null, subjectLabel: e, mode: "include" as const, effectiveFrom: "2025-01-01", effectiveTo: null }));
function input(reviews: FReviewIn[], settings: Record<string, SettingValue> = {}): CategoryXInput {
  const c = completeConfig({}, elig, "F");
  return {
    category: "F",
    month: "2026-10-01",
    asOf: "2026-11-15",
    configVersion: { id: id("a", 1), programId: id("b", 1), versionNo: 1, status: "published", effectiveFrom: "2026-01-01", effectiveTo: null },
    config: { ...c, settings: { ...c.settings, "caps.perEmployeeCategoryMonth": "none", "caps.perEmployeeAllCategoriesMonth": "none", ...settings } },
    roles: ["doer", "initiator", "both"],
    employees: [EMP, EMP2, EMP3].map((e, i) => ({ id: e, name: `Rep ${i + 1}`, role: "doer", departmentId: null, isActive: true })),
    fReviews: reviews,
  };
}
const review = (n: number, over: Partial<FReviewIn> = {}): FReviewIn => ({ reviewId: id("f0f", n), label: `#${n}`, kind: "google_review", publishedOn: "2026-10-05", rating: 5, wordCount: 10, namedEmployeeIds: [], appreciatedEmployeeIds: [], assignedEmployeeId: null, attribution: null, invalidated: false, ...over });
const email = (n: number, over: Partial<FReviewIn> = {}) => review(n, { kind: "email", rating: null, ...over });
const letter = (n: number, over: Partial<FReviewIn> = {}) => review(n, { kind: "letterhead", rating: null, ...over });
const F = (reviews: FReviewIn[], settings: Record<string, SettingValue> = {}) => calculateCategoryX(input(reviews, settings));
const pay = (r: ReturnType<typeof F>) => Object.fromEntries(r.employees.map((e) => [e.employeeId, e.payablePaise]));
const said = (r: ReturnType<typeof F>) => [...r.excluded, ...r.held].map((x) => x.message).join(" | ");
/** The original scheme's amounts (the template): F.1 ₹100, F.2 ₹100, F.3 ₹150, F.4 × 2. */
const SCHEME = { "f.googleReviewAmount": RS(100), "f.emailAmount": RS(100), "f.letterheadAmount": RS(150), "f.namedMultiple": 2 };

describe("testimonial identities: one per testimonial, across employees and types", () => {
  it("a Google review: its review ID; the same review in another link form has the same identity; tracking and display parameters never count", () => {
    const a = reviewLink("https://www.google.com/maps/reviews/data=!4m8!14m7!1m6!2m5!1sChdDSUhNMG9nS0VJQ0FnSUM!2m1!1s0x0:0xabc");
    const b = reviewLink("https://GOOGLE.com/maps/reviews/data=!4m8!14m7!1m6!2m5!1sChdDSUhNMG9nS0VJQ0FnSUM!2m1!1s0x0:0xabc/?hl=en&utm_source=share#x");
    expect(a).toMatchObject({ ok: true, resolved: true, googleReviewId: "ChdDSUhNMG9nS0VJQ0FnSUM" });
    expect(b).toEqual(a);
    expect(reviewLink("https://www.google.com/maps/place/Acme?reviewId=ABCDEFGH12&hl=en")).toMatchObject({ resolved: true, googleReviewId: "ABCDEFGH12" });
    expect((reviewLink("https://www.google.com/maps/place/Acme/?b=2&a=1") as { urlKey: string }).urlKey).toBe((reviewLink("https://google.com/maps/place/Acme?a=1&b=2") as { urlKey: string }).urlKey);
  });
  it("a short link can't be resolved here (Admin Review); a link that isn't Google's, or no link, is refused for a Google review", () => {
    expect(reviewLink("https://maps.app.goo.gl/abcd")).toMatchObject({ ok: true, resolved: false });
    expect(reviewLink("https://g.page/r/abc/review")).toMatchObject({ ok: true, resolved: false });
    expect(reviewLink("https://example.com/r/1")).toMatchObject({ ok: false });
    expect(reviewLink("https://google.evil.com/maps")).toMatchObject({ ok: false });
    expect(reviewLink("javascript:alert(1)")).toMatchObject({ ok: false });
    expect(reviewLink("")).toMatchObject({ ok: false });
    expect(wordsIn("  great   service  ")).toBe(2);
    expect(wordsIn(null)).toBe(0);
  });
  it("an email or letter: its evidence link, normalised; required; a Google review link keeps its Google identity under any type", () => {
    const e1 = testimonialLink("https://Files.Example.com/t/Thanks-Mail.eml?utm_source=x#top", "email");
    expect(e1).toEqual({ ok: true, resolved: true, urlKey: "doc:files.example.com/t/Thanks-Mail.eml", googleReviewId: null });
    // The same document link submitted as a letterhead: the same identity (a duplicate across types).
    expect(testimonialLink("https://files.example.com/t/Thanks-Mail.eml/", "letterhead")).toEqual(e1);
    const g = reviewLink("https://www.google.com/maps/place/Acme?reviewId=ABCDEFGH12");
    expect(testimonialLink("https://www.google.com/maps/place/Acme?reviewId=ABCDEFGH12", "email")).toEqual(g);
    expect(testimonialLink("", "letterhead")).toMatchObject({ ok: false, error: expect.stringMatching(/letter on the customer's letterhead/) });
    expect(testimonialLink("ftp://x/y", "email")).toMatchObject({ ok: false });
    expect(testimonialLink("https://files.example.com/x.pdf", "google_review")).toMatchObject({ ok: false });
    // The verifier's evidence identity: compared without case or extra spaces; too short identifies nothing.
    expect(evidenceKeyOf("  <CA+abc@Mail.Example.com>  ")).toBe(evidenceKeyOf("<ca+abc@mail.example.com>"));
    expect(evidenceKeyOf("Ref  JMT/22   ·  12-10-2026")).toBe("ref jmt/22 · 12-10-2026");
    expect(evidenceKeyOf("x")).toBeNull();
  });
});

describe("Category F/3: F.1–F.4 rewards", () => {
  it("F.1 ₹100, F.2 ₹100, F.3 ₹150 — each verified testimonial its own type's amount, under its own line", () => {
    const r = F([review(1, { namedEmployeeIds: [EMP] }), email(2, { namedEmployeeIds: [EMP2] }), letter(3, { namedEmployeeIds: [EMP3] })], SCHEME);
    expect(r.engineVersion).toBe("category-f/3");
    expect(pay(r)).toEqual({ [EMP]: RS(100), [EMP2]: RS(100), [EMP3]: RS(150) });
    expect(r.items.map((i) => [i.employeeId, i.lineCode]).sort()).toEqual([[EMP, "F.1"], [EMP2, "F.2"], [EMP3, "F.3"]].sort());
    expect(r.items.find((i) => i.lineCode === "F.2")!.label).toMatch(/^Email testimonial #2/);
    expect(r.items.find((i) => i.lineCode === "F.3")!.label).toMatch(/^Letterhead testimonial #3/);
  });
  it("F.4 doubles each type when it appreciates the CREDITED salesperson by name: ₹200, ₹200, ₹300 — the total, never more", () => {
    const r = F([review(1, { namedEmployeeIds: [EMP], appreciatedEmployeeIds: [EMP] }), email(2, { namedEmployeeIds: [EMP2], appreciatedEmployeeIds: [EMP2] }), letter(3, { namedEmployeeIds: [EMP3], appreciatedEmployeeIds: [EMP3] })], SCHEME);
    expect(pay(r)).toEqual({ [EMP]: RS(200), [EMP2]: RS(200), [EMP3]: RS(300) });
    expect(r.items.find((i) => i.employeeId === EMP3)!.explanation.join(" ")).toMatch(/F\.3 ₹150; F\.4 — it appreciates a person by name: × 2 = ₹300/);
  });
  it("F.4 also when it appreciates ANOTHER team member by name (here an engineer; the customer's salesperson is credited)", () => {
    expect(pay(F([letter(1, { assignedEmployeeId: EMP, appreciatedEmployeeIds: [ENGINEER] })], SCHEME))).toEqual({ [EMP]: RS(300) });
    expect(pay(F([email(1, { assignedEmployeeId: EMP2, appreciatedEmployeeIds: [EMP3, ENGINEER] })], SCHEME))).toEqual({ [EMP2]: RS(200) });
  });
  it("vague appreciation without a specific name is not F.4 (the verifier records nobody): the base reward only", () => {
    expect(pay(F([review(1, { namedEmployeeIds: [EMP] }), letter(2, { assignedEmployeeId: EMP2 })], SCHEME))).toEqual({ [EMP]: RS(100), [EMP2]: RS(150) });
  });
  it("every amount is a setting: other amounts and another multiple apply; a multiple of 1 means no F.4", () => {
    const appreciated = [review(1, { namedEmployeeIds: [EMP], appreciatedEmployeeIds: [EMP] }), letter(2, { namedEmployeeIds: [EMP2], appreciatedEmployeeIds: [EMP2] })];
    expect(pay(F(appreciated, { ...SCHEME, "f.googleReviewAmount": RS(120), "f.letterheadAmount": RS(180), "f.namedMultiple": 3 }))).toEqual({ [EMP]: RS(360), [EMP2]: RS(540) });
    expect(pay(F(appreciated, { ...SCHEME, "f.namedMultiple": 1 }))).toEqual({ [EMP]: RS(100), [EMP2]: RS(150) });
  });
  it("attribution keeps its priority for every type: the one named salesperson, then the assigned one, then a claim; several named → Admin Review, never split", () => {
    expect(pay(F([email(1, { namedEmployeeIds: [EMP], assignedEmployeeId: EMP2 })], SCHEME))).toEqual({ [EMP]: RS(100) });
    expect(pay(F([letter(1, { assignedEmployeeId: EMP2 })], SCHEME))).toEqual({ [EMP2]: RS(150) });
    expect(pay(F([email(1, { attribution: { employeeId: EMP3, basis: "claim" } })], SCHEME))).toEqual({ [EMP3]: RS(100) });
    const two = F([letter(1, { namedEmployeeIds: [EMP, EMP2] })], SCHEME);
    expect(two.items).toEqual([]);
    expect(two.settled).toBe(false);
    expect(said(two)).toMatch(/Letterhead testimonial #1 names 2 salespeople: held for Admin Review/);
    expect(pay(F([letter(1, { namedEmployeeIds: [EMP, EMP2], attribution: { employeeId: EMP2, basis: "named" } })], SCHEME))).toEqual({ [EMP2]: RS(150) });
    expect(said(F([email(1)], SCHEME))).toMatch(/names nobody and its customer has no assigned salesperson: held for Admin Review/);
  });
  it("rating and word minimums are the GOOGLE REVIEW's (five stars by default, configurable 1–5); email and letterhead have no rating", () => {
    expect(pay(F([review(1, { rating: 4, namedEmployeeIds: [EMP] })], SCHEME))).toEqual({});
    expect(said(F([review(1, { rating: 4, namedEmployeeIds: [EMP] })], SCHEME))).toMatch(/4★, below the lowest rating that earns \(5★\)/);
    expect(pay(F([review(1, { rating: 4, namedEmployeeIds: [EMP] })], { ...SCHEME, "f.minRating": 4 }))).toEqual({ [EMP]: RS(100) });
    expect(pay(F([review(1, { wordCount: 0, namedEmployeeIds: [EMP] })], SCHEME))).toEqual({ [EMP]: RS(100) });
    expect(pay(F([review(1, { wordCount: 20, namedEmployeeIds: [EMP] })], { ...SCHEME, "f.googleMinWords": 50 }))).toEqual({});
    // Email / letterhead: no rating, and the Google review's word minimum doesn't apply.
    expect(pay(F([email(1, { wordCount: 3, namedEmployeeIds: [EMP] }), letter(2, { wordCount: 3, namedEmployeeIds: [EMP2] })], { ...SCHEME, "f.googleMinWords": 50, "f.minRating": 5 }))).toEqual({ [EMP]: RS(100), [EMP2]: RS(150) });
  });
  it("a monthly minimum counts every verified testimonial type; none by default", () => {
    const items = [review(1, { namedEmployeeIds: [EMP] }), email(2, { namedEmployeeIds: [EMP] }), letter(3, { namedEmployeeIds: [EMP2] })];
    expect(pay(F(items, SCHEME))).toEqual({ [EMP]: RS(200), [EMP2]: RS(150) });
    const r = F(items, { ...SCHEME, "f.minQualifyingReviews": 2 });
    expect(pay(r)).toEqual({ [EMP]: RS(200) });
    expect(said(r)).toMatch(/1 qualifying testimonial this month, fewer than the 2 needed — no Category F for the month/);
  });
  it("an invalidated testimonial, or one dated in another month (a late one belongs to its OWN month), earns nothing here; the old engine's records never reach it", () => {
    expect(pay(F([letter(1, { namedEmployeeIds: [EMP], invalidated: true })], SCHEME))).toEqual({});
    expect(pay(F([email(1, { namedEmployeeIds: [EMP], publishedOn: "2026-09-30" })], SCHEME))).toEqual({});
    const withOld = { ...input([], SCHEME), testimonials: [{ id: id("f1t", 1), employeeId: EMP, periodMonth: "2026-10", kind: "email" as const, wordCount: 90, starRating: null, hasEvidence: true, namesTeamMember: true, approved: true }] };
    expect(calculateCategoryX(withOld).items).toEqual([]);
  });
  it("the monthly limit applies to the Category F TOTAL, F.4 included (when a limit is set)", () => {
    const four = [1, 2, 3, 4].map((n) => letter(n, { namedEmployeeIds: [EMP], appreciatedEmployeeIds: [EMP] }));
    expect(pay(F(four, SCHEME))).toEqual({ [EMP]: RS(1200) });
    expect(pay(F(four, { ...SCHEME, "caps.perEmployeeCategoryMonth": RS(750) }))).toEqual({ [EMP]: RS(750) });
  });
  it("missing configuration blocks the calculation; the verified facts are part of the input hash", () => {
    const base = input([email(1, { namedEmployeeIds: [EMP] })], SCHEME);
    for (const k of ["f.emailAmount", "f.letterheadAmount", "f.namedMultiple"]) {
      const { [k]: _gone, ...rest } = base.config!.settings;
      expect(calculateCategoryX({ ...base, config: { ...base.config!, settings: rest } }).status, k).toBe("blocked");
    }
    expect(inputsHashX(input([review(1, { rating: 5 })]))).not.toBe(inputsHashX(input([review(1, { rating: 4 })])));
    expect(inputsHashX(input([email(1)]))).not.toBe(inputsHashX(input([email(1, { appreciatedEmployeeIds: [EMP] })])));
    expect(inputsHashX(input([email(1)]))).not.toBe(inputsHashX(input([letter(1)])));
  });
});

describe("the shared recovery window (settle.ts): Category F's choice, every other category unchanged", () => {
  const paid = { month: "2026-06-01", status: "paid" as const, hasCurrentRun: true, currentRunSettled: true, paidAt: "2026-07-05T10:00:00Z" };
  const pay = { adopted: { e: 1000 }, fresh: { e: 0 }, carried: {} };
  const base: Record<string, SettingValue> = { "adjust.lockedOrPaidMonths": "adjustInCurrentMonth", "adjust.windowDays": 30, "period.lateReceipts": "adjustInCurrentOpenMonth" };
  it("Category F 'never': recovered long after payout; 'after a number of days': not after the window", () => {
    expect(decide({ ...base, "f.recoveryExpiry": "never" }, paid, "2027-03-01", true, pay).carries).toEqual([{ employeeId: "e", amountPaise: -1000, toMonth: "2027-03-01" }]);
    expect(decide({ ...base, "f.recoveryExpiry": "afterWindowDays" }, paid, "2027-03-01", true, pay)).toMatchObject({ carries: [], outcome: expect.stringMatching(/payout became final/) });
  });
  it("Category A (no recovery key) and B keep exactly their behaviour", () => {
    expect(decide(base, paid, "2027-03-01", true, pay)).toMatchObject({ carries: [], outcome: expect.stringMatching(/payout became final/) });
    expect(decide(base, paid, "2026-07-20", true, pay).carries).toHaveLength(1);
    expect(decide({ ...base, "b.recoveryExpiry": "never" }, paid, "2027-03-01", true, pay).carries).toHaveLength(1);
    expect(decide({ ...base, "b.recoveryExpiry": "afterWindowDays" }, paid, "2027-03-01", true, pay).carries).toEqual([]);
  });
});
