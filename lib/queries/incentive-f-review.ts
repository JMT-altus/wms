import "server-only";
import { and, asc, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { customerMasters, employees, incentiveCalcAdjustments, incentiveCalcInputHistory, incentiveCalcPeriods, incentiveCalcRepHistory, incentiveFDecisions, incentiveFReviews, incentiveFSubmissions, incentiveFWriteoffs, type FDecisionKind } from "@/db/schema";
import { reviewLink, testimonialLink, type TestimonialKind } from "@/lib/incentives/categories/f-url";
import { testimonialIdentity, type EvidenceIdentityInput } from "@/lib/incentives/categories/f-identity";
import { CALC_F_NOT_READY, incentiveCalcFReady } from "@/lib/queries/incentive-calc-x";
import type { Actor, Result } from "@/lib/queries/incentive-calc";

/**
 * Category F — reviews and testimonials (migrations 0137 + 0138): F.1 a public Google review, F.2 a testimonial on email,
 * F.3 a testimonial on the customer's letterhead (F.4: appreciation by name multiplies the reward). A salesperson SUBMITS
 * one with its evidence — the public review link, or the link to the email / the scanned letter (always required) — its
 * own date and what they claim it says; it is registered ONCE in the registry, by its Google review ID or normalised link
 * (database-unique, across every employee AND type): a second submission of the same one is a DUPLICATE and never earns
 * again; a short link that can't be resolved here is UNRESOLVED until a verifier links it. An authorised verifier
 * (incentive.f.verify; never the submitter) records what it actually is and says — for an email or letter: its customer,
 * its identity (unique) and that it is genuinely the customer's, of its type and genuine; a document alone never earns —
 * or rejects it, holds it, links it — and, where the priority needs it, who is credited; each decision with a reason,
 * retire-only, in the input history. An invalidation (incentive.f.invalidate) and a recovery write-off (incentive.f.writeOff) each need a SECOND
 * person's approval. Nothing here awards anything: the month's calculation reads the decisions in force. Triggers in the
 * database refuse what these services refuse too.
 */

type Q = typeof db;
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const D = (x: unknown) => (x === null || x === undefined ? null : String(x).slice(0, 10));
const rowsOf = <T>(r: unknown) => (Array.isArray(r) ? r : ((r as { rows?: unknown[] }).rows ?? [])) as T[];
/** Today in India (yyyy-mm-dd). */
const todayIST = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const monthStart = (day: string) => `${day.slice(0, 7)}-01`;

/** The refusal when an email's or letter's identity is already verified (0139's unique identities, checked again by the database). */
const ALREADY_VERIFIED =
  "That testimonial is already verified (the same email or letter — by its Message-ID, its sender, date and subject, or its reference or customer and date — possibly submitted by someone else or as another type), so it was not verified.";
/** 0138's and 0139's unique identities: a uniqueness on one of them means the same testimonial is already verified. */
const IDENTITY_INDEX = /incentive_f_decisions_(evidence_key|message_id|fingerprint)_uq/;
const errorOf = (err: unknown) => {
  const e = err as { code?: string; message?: string; constraint?: string; constraint_name?: string; cause?: { code?: string; message?: string; constraint?: string; constraint_name?: string } } | null;
  return { code: e?.code ?? e?.cause?.code, message: e?.cause?.message ?? e?.message ?? "", constraint: e?.constraint_name ?? e?.constraint ?? e?.cause?.constraint_name ?? e?.cause?.constraint ?? "" };
};
/** Whether a database error is a uniqueness on an email's or letter's identity (someone verified the same one meanwhile). */
const identityClash = (err: unknown) => {
  const e = errorOf(err);
  return e.code === "23505" && (IDENTITY_INDEX.test(e.constraint) || IDENTITY_INDEX.test(e.message));
};
/** A refusal raised by the database (a trigger's message, a uniqueness) as the user should read it; anything else is rethrown. */
function refusal(err: unknown): string {
  const { code, message } = errorOf(err);
  if (code === "23514" || code === "P0001") return message.replace(/^.*?:\s(?=[A-Z])/, "");
  if (identityClash(err)) return ALREADY_VERIFIED;
  if (code === "23505") return "That would make a second active decision of the same kind (someone else decided it meanwhile): reload to see it as it is now.";
  throw err;
}
async function guarded<R extends { ok: boolean }>(fn: () => Promise<R>): Promise<R | { ok: false; error: string }> {
  try {
    return await fn();
  } catch (err) {
    return { ok: false, error: refusal(err) };
  }
}

/* ── submission and the registry ──────────────────────────────────────── */

export interface TestimonialClaim {
  /** 0138: F.1 Google review, F.2 email, F.3 the customer's letterhead. */
  kind: TestimonialKind;
  /** The public Google review link (F.1), or the link to the email / the scanned letter (F.2, F.3). Always required. */
  url: string;
  /** A Google review's screenshot (supporting evidence only). */
  screenshotUrl: string | null;
  /** The testimonial's ORIGINAL date: a Google review's publication date, an email's or a letter's own date. */
  publishedOn: string;
  /** A Google review's star rating (1–5); null for email and letterhead. */
  rating: number | null;
  text: string | null;
}
const WHAT: Record<TestimonialKind, string> = { google_review: "review", email: "email", letterhead: "letter" };
/** Validates a claim before anything is written: its evidence link, its original date (not in the future), a Google review's rating. */
export function checkClaim(c: TestimonialClaim): string | null {
  const link = testimonialLink(c.url, c.kind);
  if (!link.ok) return link.error;
  const dateWord = c.kind === "google_review" ? "the date the review was published (as Google shows it)" : `the date of the ${WHAT[c.kind]}`;
  if (!DAY.test(c.publishedOn ?? "") || Number.isNaN(Date.parse(`${c.publishedOn}T00:00:00Z`))) return `Give ${dateWord}.`;
  if (c.publishedOn > todayIST()) return c.kind === "google_review" ? "A review can't have been published in the future." : `The ${WHAT[c.kind]} can't be dated in the future.`;
  if (c.publishedOn < "2000-01-01") return `Give ${dateWord}.`;
  if (c.kind === "google_review" && (!Number.isInteger(c.rating) || c.rating! < 1 || c.rating! > 5)) return "Choose the review's star rating (1–5).";
  if (c.screenshotUrl && c.screenshotUrl.length > 2000) return "The screenshot link is longer than 2,000 characters.";
  if ((c.text ?? "").length > 5000) return "The text is longer than 5,000 characters.";
  return null;
}

/**
 * Registers a submitted testimonial inside the caller's transaction: one registry row per testimonial — across employees
 * and types (serialised, so two submissions of the same one at the same moment can never both create one) — and the
 * submission as new, duplicate or unresolved. Returns its state.
 */
export async function registerTestimonial(tx: Tx, me: Actor, testimonialId: string | null, c: TestimonialClaim): Promise<{ submissionId: string; state: "new" | "duplicate" | "unresolved" }> {
  const link = testimonialLink(c.url, c.kind);
  if (!link.ok) throw new Error(link.error);
  let reviewId: string | null = null;
  let state: "new" | "duplicate" | "unresolved" = "unresolved";
  if (link.resolved) {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('incentive_f_reviews_register'))`);
    const [found] = await tx
      .select({ id: incentiveFReviews.id })
      .from(incentiveFReviews)
      .where(link.googleReviewId ? or(eq(incentiveFReviews.googleReviewId, link.googleReviewId), eq(incentiveFReviews.urlKey, link.urlKey)) : eq(incentiveFReviews.urlKey, link.urlKey))
      .limit(1);
    if (found) {
      reviewId = found.id;
      state = "duplicate";
    } else {
      const [made] = await tx.insert(incentiveFReviews).values({ googleReviewId: link.googleReviewId, urlKey: link.urlKey, firstUrl: c.url.trim(), source: "manual", createdById: me.id, createdByName: me.name }).returning({ id: incentiveFReviews.id });
      reviewId = made!.id;
      state = "new";
    }
  }
  const [s] = await tx
    .insert(incentiveFSubmissions)
    .values({ testimonialId, reviewId, linkState: state, submittedById: me.id, submittedByName: me.name, submittedUrl: c.url.trim(), urlKey: link.resolved ? link.urlKey : null, googleReviewId: link.resolved ? link.googleReviewId : null, screenshotUrl: c.screenshotUrl?.trim() || null, claimedKind: c.kind, claimedRating: c.kind === "google_review" ? c.rating : null, claimedPublishedOn: c.publishedOn, claimedText: c.text?.trim() || null })
    .returning({ id: incentiveFSubmissions.id });
  return { submissionId: s!.id, state };
}

/** Whether a published Category F version in force for the month (any programme) asks for a screenshot. */
export async function screenshotRequired(q: Q | Tx, month: string): Promise<boolean> {
  const r = await q.execute(sql`
    select exists (
      select 1 from incentive_config_versions v join incentive_config_settings s on s.version_id = v.id
      where v.category_code = 'F' and v.status = 'published' and v.effective_from <= ${month}::date and (v.effective_to is null or v.effective_to >= ${month}::date)
        and s.setting_key = 'f.googleNeedsEvidence' and s.value = '"yes"'::jsonb
    ) as yes`);
  return rowsOf<{ yes: boolean }>(r)[0]?.yes === true;
}

/* ── decisions ────────────────────────────────────────────────────────── */

async function history(tx: Tx, actor: Actor, entityId: string, action: "record" | "retire", before: unknown, after: unknown, note: string) {
  await tx.insert(incentiveCalcInputHistory).values({ entity: "f-decision", entityId, action, before: before ?? null, after: after ?? null, note, actorId: actor.id, actorName: actor.name });
}
const reasonOf = (r: string | null | undefined) => (r ?? "").trim();
const badReason = (r: string) => (!r ? "Give the reason (it is kept with the decision)." : r.length > 1000 ? "The reason is longer than 1,000 characters." : null);

/** The customer's assigned salesperson on a day: its representative history, else (no history at all) its current one. */
async function assignedOn(tx: Q | Tx, customerId: string | null, day: string): Promise<string | null> {
  if (!customerId) return null;
  const hist = await tx.select().from(incentiveCalcRepHistory).where(and(eq(incentiveCalcRepHistory.customerMasterId, customerId), isNull(incentiveCalcRepHistory.retiredAt)));
  if (!hist.length) return (await tx.select({ rep: customerMasters.salesRepId }).from(customerMasters).where(eq(customerMasters.id, customerId)))[0]?.rep ?? null;
  const hit = hist.filter((h) => D(h.effectiveFrom)! <= day && (!h.effectiveTo || D(h.effectiveTo)! >= day)).sort((a, b) => (D(a.effectiveFrom)! < D(b.effectiveFrom)! ? 1 : -1))[0];
  return hit?.employeeId ?? null;
}

export type FDecisionInput =
  | {
      kind: "verify";
      reviewId: string;
      reason: string;
      /** 0138: the type the evidence establishes; a Google review's actual rating (null for email / letterhead). */
      testimonialKind: TestimonialKind;
      rating: number | null;
      /** The original date: a Google review's publication, an email's or a letter's own date. */
      publishedOn: string;
      reviewText: string | null;
      googleReviewId: string | null;
      /** The SALESPEOPLE it clearly names (attribution). */
      namedEmployeeIds: string[];
      /** F.4: the people it appreciates categorically BY NAME — the salesperson or any team member (vague praise: none). */
      appreciatedEmployeeIds: string[];
      customerMasterId: string | null;
      /**
       * Email / letterhead: what identifies it, read off the original — an email's Message-ID (if it shows one), sender and
       * subject; a letter's reference number (if it has one). The identity is DERIVED from these with the customer and the
       * date (f-identity.ts), never typed; then the three findings.
       */
      evidence: EvidenceIdentityInput | null;
      confirmedFromCustomer: boolean;
      confirmedType: boolean;
      confirmedGenuine: boolean;
    }
  | { kind: "reject" | "needs-review"; reviewId: string; reason: string }
  | { kind: "link"; submissionId: string; reason: string; url: string }
  | { kind: "attribute"; reviewId: string; reason: string; creditedEmployeeId: string; basis: "named" | "assigned" | "claim" };

/** Records an authorised verifier's decision (incentive.f.verify; the server action checks the right). */
export async function recordFDecision(actor: Actor, input: FDecisionInput): Promise<Result<{ id: string }>> {
  const reason = reasonOf(input.reason);
  const bad = badReason(reason);
  if (bad) return { ok: false, error: bad };
  if (!(await incentiveCalcFReady(db))) return { ok: false, error: CALC_F_NOT_READY };
  // An email's or letter's identity already verified (found here, or raised by the database's unique identities when
  // someone verified the same one at the same moment): never verified — held for Admin Review instead (fail closed).
  let clash = false;
  let result: Result<{ id: string }>;
  try {
    result = await recordIn();
  } catch (err) {
    if (input.kind !== "verify" || !identityClash(err)) return { ok: false, error: refusal(err) };
    clash = true;
    result = { ok: false, error: ALREADY_VERIFIED };
  }
  if (clash && input.kind === "verify" && !result.ok) return holdPossibleDuplicate(actor, input.reviewId, result.error);
  return result;

  function recordIn() {
    return db.transaction(async (tx) => {
      let values: typeof incentiveFDecisions.$inferInsert;
      if (input.kind === "link") {
        if (!UUID.test(input.submissionId)) return { ok: false as const, error: "Choose the submission." };
        const [sub] = await tx.select().from(incentiveFSubmissions).where(eq(incentiveFSubmissions.id, input.submissionId));
        if (!sub) return { ok: false as const, error: "That submission doesn't exist." };
        if (sub.reviewId) return { ok: false as const, error: "That submission is already linked to a review." };
        const link = reviewLink(input.url);
        if (!link.ok) return { ok: false as const, error: link.error };
        if (!link.resolved) return { ok: false as const, error: "Give the review's full public Google link (a short link can't be resolved here)." };
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext('incentive_f_reviews_register'))`);
        const [found] = await tx.select({ id: incentiveFReviews.id }).from(incentiveFReviews).where(link.googleReviewId ? or(eq(incentiveFReviews.googleReviewId, link.googleReviewId), eq(incentiveFReviews.urlKey, link.urlKey)) : eq(incentiveFReviews.urlKey, link.urlKey)).limit(1);
        const reviewId = found?.id ?? (await tx.insert(incentiveFReviews).values({ googleReviewId: link.googleReviewId, urlKey: link.urlKey, firstUrl: input.url.trim(), source: "manual", createdById: actor.id, createdByName: actor.name }).returning({ id: incentiveFReviews.id }))[0]!.id;
        values = { reviewId, submissionId: sub.id, kind: "link", reason, createdById: actor.id, createdByName: actor.name };
      } else {
        if (!UUID.test(input.reviewId)) return { ok: false as const, error: "Choose the review." };
        const [review] = await tx.select().from(incentiveFReviews).where(eq(incentiveFReviews.id, input.reviewId));
        if (!review) return { ok: false as const, error: "That review doesn't exist." };
        values = { reviewId: review.id, kind: input.kind, reason, createdById: actor.id, createdByName: actor.name };
        if (input.kind === "verify") {
          const tk = input.testimonialKind;
          if (tk !== "google_review" && tk !== "email" && tk !== "letterhead") return { ok: false as const, error: "Record what the testimonial is: a Google review, an email or a letter on the customer's letterhead." };
          const google = tk === "google_review";
          if (google && (!Number.isInteger(input.rating) || input.rating! < 1 || input.rating! > 5)) return { ok: false as const, error: "Record the review's actual star rating (1–5)." };
          if (!DAY.test(input.publishedOn ?? "") || input.publishedOn > todayIST()) return { ok: false as const, error: google ? "Record the review's original publication date (not in the future)." : `Record the ${tk === "email" ? "email's" : "letter's"} own date (not in the future).` };
          if ((input.reviewText ?? "").length > 10000) return { ok: false as const, error: "The text is longer than 10,000 characters." };
          const gid = google ? (input.googleReviewId ?? "").trim() || null : null;
          if (gid && !/^[A-Za-z0-9_-]{4,300}$/.test(gid)) return { ok: false as const, error: "That isn't a Google review ID." };
          if (gid) {
            const [other] = await tx.select({ id: incentiveFReviews.id }).from(incentiveFReviews).where(eq(incentiveFReviews.googleReviewId, gid));
            if (other && other.id !== review.id) return { ok: false as const, error: "That Google review ID belongs to another registered review: this one is a duplicate (reject it with that reason)." };
          }
          // An email or letterhead testimonial: genuinely the customer's, really of its type, genuine — and its identity,
          // DERIVED (never typed) from what the verifier read off it, with the customer and the date (0139).
          let identity: { evidenceKey: string; messageId: string | null; fingerprint: string } | null = null;
          if (!google) {
            if (!input.customerMasterId || !UUID.test(input.customerMasterId)) return { ok: false as const, error: `Choose the customer the ${tk === "email" ? "email" : "letter"} comes from: an email or letterhead testimonial is verified against its customer.` };
            if (!input.confirmedFromCustomer || !input.confirmedType || !input.confirmedGenuine)
              return { ok: false as const, error: tk === "email" ? "Verify all three before recording it: the email is genuinely from the customer, it is an email testimonial, and it is genuine. Otherwise reject it or hold it for review." : "Verify all three before recording it: the letterhead is the customer's, it is a testimonial on that letterhead, and it is genuine. Otherwise reject it or hold it for review." };
            const id = testimonialIdentity(tk, { customerId: input.customerMasterId, date: input.publishedOn, evidence: input.evidence });
            if (!id.ok) return { ok: false as const, error: id.error };
            identity = id;
            // The same email or letter already verified — by any of its identities, under any employee or type: never twice.
            const [other] = await tx
              .select({ id: incentiveFDecisions.id })
              .from(incentiveFDecisions)
              .where(and(eq(incentiveFDecisions.kind, "verify"), isNull(incentiveFDecisions.retiredAt), or(eq(incentiveFDecisions.evidenceKey, id.evidenceKey), eq(incentiveFDecisions.evidenceFingerprint, id.fingerprint), ...(id.messageId ? [eq(incentiveFDecisions.evidenceMessageId, id.messageId)] : []))))
              .limit(1);
            if (other) {
              clash = true;
              return { ok: false as const, error: ALREADY_VERIFIED };
            }
          }
          const pick = async (raw: string[] | undefined, what: string) => {
            const ids = [...new Set(raw ?? [])];
            if (ids.some((x) => !UUID.test(x))) return `Choose ${what} from the list.`;
            const rows = ids.length ? await tx.select({ id: employees.id, name: employees.name }).from(employees).where(inArray(employees.id, ids)) : [];
            if (rows.length !== ids.length) return `Someone ${what === "who it names" ? "it names" : "it appreciates"} isn't an employee.`;
            return rows.sort((a, b) => (a.id < b.id ? -1 : 1));
          };
          const named = await pick(input.namedEmployeeIds, "who it names");
          if (typeof named === "string") return { ok: false as const, error: named };
          const appreciated = await pick(input.appreciatedEmployeeIds, "who it appreciates by name");
          if (typeof appreciated === "string") return { ok: false as const, error: appreciated };
          if (input.customerMasterId) {
            const [c] = await tx.select({ id: customerMasters.id }).from(customerMasters).where(eq(customerMasters.id, input.customerMasterId));
            if (!c) return { ok: false as const, error: "That customer isn't in the Customer Master." };
          }
          Object.assign(values, {
            testimonialKind: tk,
            rating: google ? input.rating : null,
            publishedOn: input.publishedOn,
            reviewMonth: monthStart(input.publishedOn),
            reviewText: input.reviewText?.trim() || null,
            googleReviewId: gid,
            namedEmployeeIds: named.map((n) => n.id),
            namedEmployeeNames: named.map((n) => n.name),
            appreciatedEmployeeIds: appreciated.map((n) => n.id),
            appreciatedEmployeeNames: appreciated.map((n) => n.name),
            customerMasterId: input.customerMasterId || null,
            evidenceKey: identity?.evidenceKey ?? null,
            evidenceMessageId: identity?.messageId ?? null,
            evidenceFingerprint: identity?.fingerprint ?? null,
            confirmedFromCustomer: !google && input.confirmedFromCustomer === true,
            confirmedType: !google && input.confirmedType === true,
            confirmedGenuine: !google && input.confirmedGenuine === true,
          });
        }
        if (input.kind === "attribute") {
          if (!UUID.test(input.creditedEmployeeId)) return { ok: false as const, error: "Choose who is credited." };
          const [e] = await tx.select({ id: employees.id, name: employees.name }).from(employees).where(eq(employees.id, input.creditedEmployeeId));
          if (!e) return { ok: false as const, error: "That person isn't an employee." };
          const [v] = await tx.select().from(incentiveFDecisions).where(and(eq(incentiveFDecisions.reviewId, review.id), eq(incentiveFDecisions.kind, "verify"), isNull(incentiveFDecisions.retiredAt)));
          if (!v) return { ok: false as const, error: "A review is attributed only once it is verified." };
          // The priority (the database checks the named rule too): the assigned salesperson only when nobody is named;
          // a claim only when nobody is named AND the customer has no assigned salesperson on the publication date.
          const assigned = v.namedEmployeeIds.length ? null : await assignedOn(tx, v.customerMasterId, D(v.publishedOn)!);
          if (input.basis === "assigned" && assigned !== e.id) return { ok: false as const, error: "That isn't the customer's assigned salesperson on the review's publication date." };
          if (input.basis === "claim" && (v.namedEmployeeIds.length || assigned)) return { ok: false as const, error: "A claim is confirmed only when the review names nobody and the customer has no assigned salesperson." };
          Object.assign(values, { creditedEmployeeId: e.id, creditedEmployeeName: e.name, basis: input.basis });
        }
      }
      const [row] = await tx.insert(incentiveFDecisions).values(values).returning();
      await history(tx, actor, row!.id, "record", null, row, reason);
      return { ok: true as const, id: row!.id };
    });
  }
}

/**
 * Fail closed on a possible duplicate: the testimonial is NOT verified; it is held for Admin Review (a needs-review
 * decision, with the reason, in the input history) so it can't be verified by mistake later. If it can't be held (it
 * already has a verdict, or the database refuses), the refusal alone is returned.
 */
async function holdPossibleDuplicate(actor: Actor, reviewId: string, error: string): Promise<{ ok: false; error: string }> {
  const reason = "Held automatically: a possible duplicate — the same email or letter (by one of its identities) is already verified for another submission. It was not verified.";
  try {
    await db.transaction(async (tx) => {
      const [row] = await tx.insert(incentiveFDecisions).values({ reviewId, kind: "needs-review", reason, createdById: actor.id, createdByName: actor.name }).returning();
      await history(tx, actor, row!.id, "record", null, row, reason);
    });
    return { ok: false, error: `${error} It is held for Admin Review: a possible duplicate is never verified.` };
  } catch (err) {
    const { code } = errorOf(err);
    if (code !== "23505" && code !== "23514" && code !== "P0001") throw err;
    return { ok: false, error: `${error} Hold it for review, or reject it as a duplicate.` };
  }
}

/** Retires a verdict, link or attribution (with the reason): the review goes back to how it stood before. Invalidations are permanent. */
export async function retireFDecision(actor: Actor, id: string, reason: string): Promise<Result> {
  const why = reasonOf(reason);
  const bad = badReason(why);
  if (bad) return { ok: false, error: bad };
  if (!UUID.test(id)) return { ok: false, error: "That decision doesn't exist." };
  if (!(await incentiveCalcFReady(db))) return { ok: false, error: CALC_F_NOT_READY };
  return guarded(() =>
    db.transaction(async (tx) => {
      const [row] = await tx.select().from(incentiveFDecisions).where(eq(incentiveFDecisions.id, id)).for("update");
      if (!row) return { ok: false as const, error: "That decision doesn't exist." };
      if (row.retiredAt) return { ok: false as const, error: "It was already retired." };
      if (!(["verify", "reject", "needs-review", "link", "attribute"] as FDecisionKind[]).includes(row.kind)) return { ok: false as const, error: "An invalidation decision is permanent." };
      const [after] = await tx.update(incentiveFDecisions).set({ retiredAt: new Date(), retiredById: actor.id, retiredReason: why }).where(eq(incentiveFDecisions.id, id)).returning();
      await history(tx, actor, id, "retire", row, after, why);
      return { ok: true as const };
    }),
  );
}

/* ── invalidation (two people) ────────────────────────────────────────── */

export async function requestFInvalidation(actor: Actor, input: { reviewId: string; reason: string; evidenceUrl: string }): Promise<Result<{ id: string }>> {
  const reason = reasonOf(input.reason);
  const bad = badReason(reason);
  if (bad) return { ok: false, error: bad };
  const evidence = (input.evidenceUrl ?? "").trim();
  if (!evidence) return { ok: false, error: "Give the evidence that the review was deleted or is invalid (a link or reference)." };
  if (evidence.length > 2000) return { ok: false, error: "The evidence is longer than 2,000 characters." };
  if (!UUID.test(input.reviewId)) return { ok: false, error: "Choose the review." };
  if (!(await incentiveCalcFReady(db))) return { ok: false, error: CALC_F_NOT_READY };
  return guarded(() =>
    db.transaction(async (tx) => {
      const [row] = await tx.insert(incentiveFDecisions).values({ reviewId: input.reviewId, kind: "invalidate-request", reason, evidenceUrl: evidence, createdById: actor.id, createdByName: actor.name }).returning();
      await history(tx, actor, row!.id, "record", null, row, reason);
      return { ok: true as const, id: row!.id };
    }),
  );
}

/** A second person approves or refuses an invalidation request. Approved: the review earns nothing from its next calculation; a paid month never changes — the difference is recovered from later months. */
export async function decideFInvalidation(actor: Actor, input: { requestId: string; decision: "approve" | "refuse"; reason: string }): Promise<Result<{ id: string; reviewMonth: string | null }>> {
  const reason = reasonOf(input.reason);
  const bad = badReason(reason);
  if (bad) return { ok: false, error: bad };
  if (!UUID.test(input.requestId)) return { ok: false, error: "Choose the request." };
  if (input.decision !== "approve" && input.decision !== "refuse") return { ok: false, error: "Approve or refuse it." };
  if (!(await incentiveCalcFReady(db))) return { ok: false, error: CALC_F_NOT_READY };
  return guarded(() =>
    db.transaction(async (tx) => {
      const [req] = await tx.select().from(incentiveFDecisions).where(eq(incentiveFDecisions.id, input.requestId));
      if (!req || req.kind !== "invalidate-request") return { ok: false as const, error: "That invalidation request doesn't exist." };
      if (req.createdById === actor.id) return { ok: false as const, error: "You requested this invalidation: a second person approves or refuses it." };
      const [row] = await tx.insert(incentiveFDecisions).values({ reviewId: req.reviewId, kind: input.decision === "approve" ? "invalidate-approve" : "invalidate-refuse", requestId: req.id, reason, createdById: actor.id, createdByName: actor.name }).returning();
      await history(tx, actor, row!.id, "record", null, row, reason);
      const [v] = await tx.select({ m: incentiveFDecisions.reviewMonth }).from(incentiveFDecisions).where(and(eq(incentiveFDecisions.reviewId, req.reviewId), eq(incentiveFDecisions.kind, "verify"), isNull(incentiveFDecisions.retiredAt)));
      return { ok: true as const, id: row!.id, reviewMonth: D(v?.m) };
    }),
  );
}

/* ── recovery write-off (two people) ──────────────────────────────────── */

type Adjustment = typeof incentiveCalcAdjustments.$inferSelect;
/**
 * The testimonials behind a recovery: those credited to its employee in the month the difference arose (in that month's
 * run in force), whose invalidation a second person approved. Reads only.
 */
async function recoveryTestimonials(tx: Tx, a: Adjustment): Promise<{ reviewId: string; line: string; label: string }[]> {
  if (!a.employeeId || !a.fromMonth) return [];
  const r = await tx.execute(sql`
    select distinct i.source_id "reviewId", i.line_code line, i.label from incentive_calc_items i
    join incentive_calc_periods p on p.current_run_id = i.run_id
    where p.program_id = ${a.programId} and p.category_code = 'F' and p.month = ${D(a.fromMonth)}::date and i.employee_id = ${a.employeeId} and i.source_type = 'testimonial'
      and exists (select 1 from incentive_f_decisions d where d.review_id::text = i.source_id and d.kind = 'invalidate-approve')
    order by 1`);
  return rowsOf<{ reviewId: string; line: string; label: string }>(r);
}
/**
 * Every write-off request and decision in the input history too (0139: entity 'f-writeoff'; append-only, like the
 * write-off table itself): the employee, the recovery and the testimonials behind it, the amount, the reason, the
 * request it answers and the write-off it settled, who and when.
 */
async function writeOffHistory(tx: Tx, actor: Actor, row: typeof incentiveFWriteoffs.$inferSelect, a: Adjustment) {
  await tx.insert(incentiveCalcInputHistory).values({
    entity: "f-writeoff",
    entityId: row.id,
    action: "record",
    before: null,
    after: {
      kind: row.kind,
      requestId: row.requestId,
      recoveryAdjustmentId: row.adjustmentId,
      writeOffAdjustmentId: row.resultAdjustmentId,
      employeeId: row.employeeId,
      employeeName: row.employeeName,
      amountPaise: Number(row.amountPaise),
      recoveryPaise: Number(a.amountPaise),
      fromMonth: D(a.fromMonth),
      toMonth: D(a.toMonth),
      testimonials: await recoveryTestimonials(tx, a),
      reason: row.reason,
      evidenceUrl: row.evidenceUrl,
      at: row.createdAt.toISOString(),
    },
    note: row.reason,
    actorId: actor.id,
    actorName: actor.name,
  });
}

async function monthOpen(tx: Tx, programId: string, month: string): Promise<boolean> {
  const [p] = await tx.select({ status: incentiveCalcPeriods.status }).from(incentiveCalcPeriods).where(and(eq(incentiveCalcPeriods.programId, programId), eq(incentiveCalcPeriods.categoryCode, "F"), eq(incentiveCalcPeriods.month, month))).for("update");
  return !p || p.status === "open";
}

export async function requestFWriteOff(actor: Actor, input: { adjustmentId: string; amountPaise: number; reason: string; evidenceUrl: string | null }): Promise<Result<{ id: string }>> {
  const reason = reasonOf(input.reason);
  const bad = badReason(reason);
  if (bad) return { ok: false, error: bad };
  if (!UUID.test(input.adjustmentId)) return { ok: false, error: "Choose the recovery." };
  if (!Number.isSafeInteger(input.amountPaise) || input.amountPaise <= 0) return { ok: false, error: "Give the amount to write off." };
  if (!(await incentiveCalcFReady(db))) return { ok: false, error: CALC_F_NOT_READY };
  return guarded(() =>
    db.transaction(async (tx) => {
      const [a] = await tx.select().from(incentiveCalcAdjustments).where(eq(incentiveCalcAdjustments.id, input.adjustmentId));
      if (!a || a.categoryCode !== "F" || Number(a.amountPaise) >= 0 || !a.toMonth) return { ok: false as const, error: "Only a Category F recovery (an amount carried into a month) is written off." };
      if (!(await monthOpen(tx, a.programId, D(a.toMonth)!))) return { ok: false as const, error: `${D(a.toMonth)!.slice(0, 7)} — the month it is recovered in — isn't open: reopen it first. Nothing was requested.` };
      const [row] = await tx.insert(incentiveFWriteoffs).values({ kind: "request", adjustmentId: a.id, employeeId: a.employeeId, employeeName: a.employeeName, amountPaise: input.amountPaise, reason, evidenceUrl: input.evidenceUrl?.trim() || null, createdById: actor.id, createdByName: actor.name }).returning();
      await writeOffHistory(tx, actor, row!, a);
      return { ok: true as const, id: row!.id };
    }),
  );
}

/** A second person approves (the approved amount is carried into the same month as a positive write-off, once) or refuses. */
export async function decideFWriteOff(actor: Actor, input: { requestId: string; decision: "approve" | "refuse"; reason: string }): Promise<Result<{ id: string }>> {
  const reason = reasonOf(input.reason);
  const bad = badReason(reason);
  if (bad) return { ok: false, error: bad };
  if (!UUID.test(input.requestId)) return { ok: false, error: "Choose the request." };
  if (input.decision !== "approve" && input.decision !== "refuse") return { ok: false, error: "Approve or refuse it." };
  if (!(await incentiveCalcFReady(db))) return { ok: false, error: CALC_F_NOT_READY };
  return guarded(() =>
    db.transaction(async (tx) => {
      const [req] = await tx.select().from(incentiveFWriteoffs).where(eq(incentiveFWriteoffs.id, input.requestId));
      if (!req || req.kind !== "request") return { ok: false as const, error: "That write-off request doesn't exist." };
      if (req.createdById === actor.id) return { ok: false as const, error: "You requested this write-off: a second person approves or refuses it." };
      const [a] = await tx.select().from(incentiveCalcAdjustments).where(eq(incentiveCalcAdjustments.id, req.adjustmentId));
      let resultAdjustmentId: string | null = null;
      if (input.decision === "approve") {
        if (!(await monthOpen(tx, a!.programId, D(a!.toMonth)!))) return { ok: false as const, error: `${D(a!.toMonth)!.slice(0, 7)} — the month it is recovered in — isn't open: reopen it first. Nothing was approved.` };
        const [w] = await tx
          .insert(incentiveCalcAdjustments)
          .values({ programId: a!.programId, categoryCode: "F", fromMonth: a!.fromMonth, toMonth: a!.toMonth, employeeId: a!.employeeId, employeeName: a!.employeeName, kind: "recovery-write-off", amountPaise: Number(req.amountPaise), sourceRunId: a!.sourceRunId, note: `Recovery written off (approved by ${actor.name}): ${reason}`.slice(0, 1000), createdById: actor.id })
          .returning({ id: incentiveCalcAdjustments.id });
        resultAdjustmentId = w!.id;
      }
      const [row] = await tx.insert(incentiveFWriteoffs).values({ kind: input.decision === "approve" ? "approve" : "refuse", requestId: req.id, adjustmentId: req.adjustmentId, resultAdjustmentId, employeeId: req.employeeId, employeeName: req.employeeName, amountPaise: Number(req.amountPaise), reason, createdById: actor.id, createdByName: actor.name }).returning();
      await writeOffHistory(tx, actor, row!, a!);
      return { ok: true as const, id: row!.id };
    }),
  );
}

/* ── the employee's own view ──────────────────────────────────────────── */

export type MyFStatus = "submitted" | "duplicate" | "under-review" | "on-hold" | "verified" | "rejected" | "invalidated";
/** One of the employee's OWN submissions, as they may see it: its state and a standard explanation — never a reviewer's
 * notes, names, evidence links, who is credited or appreciated, or another employee's submission. */
export interface MyFTestimonial {
  submissionId: string;
  submittedAt: string;
  kind: TestimonialKind;
  /** Its own date: as verified once verified, else as submitted. */
  ownDate: string;
  status: MyFStatus;
  explanation: string;
  /** Verified: the month (yyyy-mm) whose Category F calculation it counts in. */
  countsIn: string | null;
  /** Verified: whether the verifier recorded appreciation by name (F.4) — not who. */
  appreciation: boolean | null;
}
const MY_F_TEXT: Record<MyFStatus, string> = {
  submitted: "Submitted. A verifier links it to its full public review first (a short link can't be checked as it is).",
  duplicate: "Already registered: the same testimonial was submitted before (by you or someone else). A testimonial earns once.",
  "under-review": "Waiting for verification against its original. It earns nothing until it is verified.",
  "on-hold": "Held for Admin Review. It earns nothing until it is verified.",
  verified: "Verified against its original. It counts in the Category F calculation of the month of its own date, credited by the attribution rules.",
  rejected: "Not accepted after checking its original. Your administrator can tell you why.",
  invalidated: "Found deleted, withdrawn or invalid after verification (confirmed by a second reviewer). It earns nothing; anything already paid for it is recovered from later months.",
};

/**
 * The signed-in employee's OWN Category F submissions (newest first) with their verification state — reads only, by the
 * submitter's id. Nothing here decides anything; an employee never verifies, approves, invalidates or writes off.
 */
export async function myFTestimonials(employeeId: string, q: Q = db): Promise<{ ready: boolean; rows: MyFTestimonial[] }> {
  if (!UUID.test(employeeId) || !(await incentiveCalcFReady(q))) return { ready: false, rows: [] };
  const subs = await q
    .select({ id: incentiveFSubmissions.id, reviewId: incentiveFSubmissions.reviewId, linkState: incentiveFSubmissions.linkState, kind: incentiveFSubmissions.claimedKind, publishedOn: incentiveFSubmissions.claimedPublishedOn, createdAt: incentiveFSubmissions.createdAt })
    .from(incentiveFSubmissions)
    .where(eq(incentiveFSubmissions.submittedById, employeeId))
    .orderBy(desc(incentiveFSubmissions.createdAt))
    .limit(200);
  if (!subs.length) return { ready: true, rows: [] };
  const links = await q
    .select({ submissionId: incentiveFDecisions.submissionId, reviewId: incentiveFDecisions.reviewId })
    .from(incentiveFDecisions)
    .where(and(eq(incentiveFDecisions.kind, "link"), isNull(incentiveFDecisions.retiredAt), inArray(incentiveFDecisions.submissionId, subs.map((s) => s.id))));
  const reviewOf = (s: (typeof subs)[number]) => s.reviewId ?? links.find((l) => l.submissionId === s.id)?.reviewId ?? null;
  const reviewIds = [...new Set(subs.map(reviewOf).filter((x): x is string => !!x))];
  const decisions = reviewIds.length
    ? await q
        .select({ reviewId: incentiveFDecisions.reviewId, kind: incentiveFDecisions.kind, retiredAt: incentiveFDecisions.retiredAt, testimonialKind: incentiveFDecisions.testimonialKind, publishedOn: incentiveFDecisions.publishedOn, appreciated: incentiveFDecisions.appreciatedEmployeeIds })
        .from(incentiveFDecisions)
        .where(inArray(incentiveFDecisions.reviewId, reviewIds))
    : [];
  const rows = subs.map((s): MyFTestimonial => {
    const base = { submissionId: s.id, submittedAt: s.createdAt.toISOString(), kind: s.kind, ownDate: D(s.publishedOn)!, countsIn: null, appreciation: null };
    const reviewId = reviewOf(s);
    // A duplicate is never shown with the original's state: that may be someone else's.
    const status: MyFStatus = s.linkState === "duplicate" ? "duplicate" : !reviewId ? "submitted" : "under-review";
    if (status !== "under-review") return { ...base, status, explanation: MY_F_TEXT[status] };
    const mine = decisions.filter((d) => d.reviewId === reviewId);
    if (mine.some((d) => d.kind === "invalidate-approve")) return { ...base, status: "invalidated", explanation: MY_F_TEXT.invalidated };
    const verdict = mine.find((d) => (d.kind === "verify" || d.kind === "reject" || d.kind === "needs-review") && !d.retiredAt);
    if (!verdict) return { ...base, status, explanation: MY_F_TEXT[status] };
    if (verdict.kind === "reject") return { ...base, status: "rejected", explanation: MY_F_TEXT.rejected };
    if (verdict.kind === "needs-review") return { ...base, status: "on-hold", explanation: MY_F_TEXT["on-hold"] };
    const own = D(verdict.publishedOn) ?? base.ownDate;
    return { ...base, kind: verdict.testimonialKind ?? s.kind, ownDate: own, status: "verified", explanation: MY_F_TEXT.verified, countsIn: own.slice(0, 7), appreciation: verdict.appreciated.length > 0 };
  });
  return { ready: true, rows };
}

/* ── the Admin Review screen ──────────────────────────────────────────── */

export interface FReviewRow {
  reviewId: string | null;
  submissionId: string;
  submittedBy: string;
  submittedAt: string;
  url: string;
  screenshotUrl: string | null;
  claimed: { kind: TestimonialKind; rating: number | null; publishedOn: string; text: string | null };
  state: "new" | "duplicate" | "unresolved";
  /** The review's active verdict, attribution, and invalidation state. */
  verdict: { id: string; kind: string; testimonialKind: TestimonialKind | null; rating: number | null; publishedOn: string | null; named: string[]; appreciated: string[]; reason: string; byName: string } | null;
  attribution: { id: string; employeeName: string | null; basis: string; reason: string; byName: string } | null;
  invalidation: { requestId: string; byName: string; reason: string; evidence: string | null; decided: "approved" | "refused" | null } | null;
  history: { kind: string; reason: string; byName: string; at: string; retired: boolean }[];
}
export interface FRecovery {
  adjustmentId: string;
  employeeName: string;
  fromMonth: string;
  toMonth: string;
  amountPaise: number;
  writeOff: { requestId: string; amountPaise: number; byName: string; reason: string; decided: "approved" | "refused" | null } | null;
}

/** Every submission (newest first), with its review's decisions; and every Category F recovery with its write-off state. Reads only. */
export async function fReviewQueue(q: Q = db): Promise<{ ready: boolean; rows: FReviewRow[]; recoveries: FRecovery[] }> {
  if (!(await incentiveCalcFReady(q))) return { ready: false, rows: [], recoveries: [] };
  const subs = await q.select().from(incentiveFSubmissions).orderBy(desc(incentiveFSubmissions.createdAt)).limit(300);
  const reviewIds = [...new Set(subs.map((s) => s.reviewId).filter((x): x is string => !!x))];
  const decisions = reviewIds.length ? await q.select().from(incentiveFDecisions).where(inArray(incentiveFDecisions.reviewId, reviewIds)).orderBy(asc(incentiveFDecisions.createdAt)) : [];
  const links = await q.select().from(incentiveFDecisions).where(and(eq(incentiveFDecisions.kind, "link"), isNull(incentiveFDecisions.retiredAt)));
  const rows: FReviewRow[] = subs.map((s) => {
    const reviewId = s.reviewId ?? links.find((l) => l.submissionId === s.id)?.reviewId ?? null;
    const mine = decisions.filter((d) => d.reviewId === reviewId);
    const verdict = mine.find((d) => ["verify", "reject", "needs-review"].includes(d.kind) && !d.retiredAt) ?? null;
    const attribution = mine.find((d) => d.kind === "attribute" && !d.retiredAt) ?? null;
    const req = [...mine].reverse().find((d) => d.kind === "invalidate-request") ?? null;
    const answer = req ? mine.find((d) => d.requestId === req.id) : undefined;
    return {
      reviewId,
      submissionId: s.id,
      submittedBy: s.submittedByName,
      submittedAt: s.createdAt.toISOString(),
      url: s.submittedUrl,
      screenshotUrl: s.screenshotUrl,
      claimed: { kind: s.claimedKind, rating: s.claimedRating, publishedOn: D(s.claimedPublishedOn)!, text: s.claimedText },
      state: s.linkState,
      verdict: verdict ? { id: verdict.id, kind: verdict.kind, testimonialKind: verdict.testimonialKind, rating: verdict.rating, publishedOn: D(verdict.publishedOn), named: verdict.namedEmployeeNames, appreciated: verdict.appreciatedEmployeeNames, reason: verdict.reason, byName: verdict.createdByName } : null,
      attribution: attribution ? { id: attribution.id, employeeName: attribution.creditedEmployeeName, basis: attribution.basis ?? "", reason: attribution.reason, byName: attribution.createdByName } : null,
      invalidation: req ? { requestId: req.id, byName: req.createdByName, reason: req.reason, evidence: req.evidenceUrl, decided: answer ? (answer.kind === "invalidate-approve" ? "approved" : "refused") : null } : null,
      history: mine.map((d) => ({ kind: d.kind, reason: d.reason, byName: d.createdByName, at: d.createdAt.toISOString(), retired: !!d.retiredAt })),
    };
  });
  const adj = await q.select().from(incentiveCalcAdjustments).where(and(eq(incentiveCalcAdjustments.categoryCode, "F"), sql`${incentiveCalcAdjustments.amountPaise} < 0`, sql`${incentiveCalcAdjustments.toMonth} is not null`)).orderBy(desc(incentiveCalcAdjustments.createdAt));
  const wos = adj.length ? await q.select().from(incentiveFWriteoffs).where(inArray(incentiveFWriteoffs.adjustmentId, adj.map((a) => a.id))).orderBy(asc(incentiveFWriteoffs.createdAt)) : [];
  const recoveries: FRecovery[] = adj.map((a) => {
    const req = [...wos].reverse().find((w) => w.adjustmentId === a.id && w.kind === "request");
    const answer = req ? wos.find((w) => w.requestId === req.id) : undefined;
    return { adjustmentId: a.id, employeeName: a.employeeName, fromMonth: D(a.fromMonth)!, toMonth: D(a.toMonth)!, amountPaise: Number(a.amountPaise), writeOff: req ? { requestId: req.id, amountPaise: Number(req.amountPaise), byName: req.createdByName, reason: req.reason, decided: answer ? (answer.kind === "approve" ? "approved" : "refused") : null } : null };
  });
  return { ready: true, rows, recoveries };
}
