"use server";

import { revalidatePath } from "next/cache";
import { eq, isNotNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { requireUser, requireAdmin } from "@/lib/auth/current";
import { leadBatches, leadConversions, clientMeetings, testimonials, salesOrders } from "@/db/schema";
import { currentPeriodIST } from "@/lib/queries/incentives";
import { P } from "@/lib/incentives";
import { computePeriodForEmployee } from "@/lib/incentives/load";

export type ActionResult = { ok: true } | { ok: false; error: string };

const clampInt = (v: unknown, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, Math.round(Number(v) || 0)));

// ── Employee submissions (enter pending review) ──────────────────────────────

export async function submitLeadBatch(input: { leadCount: number; profiled: boolean }): Promise<ActionResult> {
  const me = await requireUser();
  const leadCount = clampInt(input.leadCount, 0, 100000);
  if (leadCount < 1) return { ok: false, error: "Enter how many leads." };
  await db.insert(leadBatches).values({
    employeeId: me.id, periodMonth: currentPeriodIST(), leadCount, profiled: !!input.profiled,
  });
  revalidatePath("/incentive");
  return { ok: true };
}

export async function submitLeadConversion(input: { convertedCount: number }): Promise<ActionResult> {
  const me = await requireUser();
  const convertedCount = clampInt(input.convertedCount, 0, 100000);
  if (convertedCount < 1) return { ok: false, error: "Enter how many enquiries." };
  await db.insert(leadConversions).values({
    employeeId: me.id, periodMonth: currentPeriodIST(), convertedCount,
  });
  revalidatePath("/incentive");
  return { ok: true };
}

export async function submitMeeting(input: {
  potentialBand: "low" | "medium" | "high";
  justification: string;
}): Promise<ActionResult> {
  const me = await requireUser();
  const band = ["low", "medium", "high"].includes(input.potentialBand) ? input.potentialBand : "medium";
  const justification = String(input.justification ?? "").slice(0, 500);
  if (!justification.trim()) return { ok: false, error: "Add a short justification." };
  await db.insert(clientMeetings).values({
    employeeId: me.id, periodMonth: currentPeriodIST(), potentialBand: band, justification,
  });
  revalidatePath("/incentive");
  return { ok: true };
}

export async function submitTestimonial(input: {
  kind: "google_review" | "email" | "letterhead";
  wordCount: number;
  starRating?: number;
  namesTeamMember: boolean;
  evidenceUrl?: string;
}): Promise<ActionResult> {
  const me = await requireUser();
  const kind = ["google_review", "email", "letterhead"].includes(input.kind) ? input.kind : "email";
  const wordCount = clampInt(input.wordCount, 0, 100000);
  const starRating = input.starRating != null ? clampInt(input.starRating, 1, 5) : null;
  if (kind === "google_review" && starRating !== 5) return { ok: false, error: "Only 5★ reviews qualify." };
  await db.insert(testimonials).values({
    employeeId: me.id, periodMonth: currentPeriodIST(), kind, wordCount,
    starRating, namesTeamMember: !!input.namesTeamMember, evidenceUrl: input.evidenceUrl?.slice(0, 500) ?? null,
  });
  revalidatePath("/incentive");
  return { ok: true };
}

// ── Admin verification ───────────────────────────────────────────────────────

type Queue = "lead_batch" | "lead_conversion" | "meeting" | "testimonial";

export async function reviewSubmission(input: {
  queue: Queue;
  id: string;
  decision: "approved" | "rejected";
  awardedRupees?: number; // meetings only
  namesTeamMember?: boolean; // testimonials only
  note?: string;
}): Promise<ActionResult> {
  const me = await requireAdmin();
  if (!/^[0-9a-f-]{36}$/i.test(input.id)) return { ok: false, error: "Invalid id" };
  const decision = input.decision === "approved" ? "approved" : "rejected";
  const base = { reviewStatus: decision as "approved" | "rejected", reviewedById: me.id, reviewedAt: new Date(), note: input.note?.slice(0, 500) ?? null, updatedAt: new Date() };

  switch (input.queue) {
    case "lead_batch":
      await db.update(leadBatches).set(base).where(eq(leadBatches.id, input.id));
      break;
    case "lead_conversion":
      await db.update(leadConversions).set(base).where(eq(leadConversions.id, input.id));
      break;
    case "meeting": {
      const awarded = P(clampInt(input.awardedRupees, 0, 1000));
      await db.update(clientMeetings).set({ ...base, awardedPaise: awarded }).where(eq(clientMeetings.id, input.id));
      break;
    }
    case "testimonial":
      await db.update(testimonials).set({ ...base, namesTeamMember: !!input.namesTeamMember }).where(eq(testimonials.id, input.id));
      break;
    default:
      return { ok: false, error: "Unknown queue" };
  }
  revalidatePath("/incentive");
  revalidatePath("/incentive/admin");
  return { ok: true };
}

/**
 * Recompute the ledger for a period across every employee with orders or
 * approved activity in it. This is the "COMPUTE" step: run the pure engine and
 * upsert accrual rows idempotently, so approvals and new sales become payable.
 */
export async function recomputePeriod(input?: { period?: string }): Promise<{ ok: true; employees: number } | { ok: false; error: string }> {
  await requireAdmin();
  const period = input?.period ?? currentPeriodIST();

  const ids = new Set<string>();
  const owners = await db.selectDistinct({ id: salesOrders.ownerId }).from(salesOrders).where(isNotNull(salesOrders.ownerId));
  for (const o of owners) if (o.id) ids.add(o.id);

  const [lb, lc, mt, ts] = await Promise.all([
    db.selectDistinct({ id: leadBatches.employeeId }).from(leadBatches).where(eq(leadBatches.periodMonth, period)),
    db.selectDistinct({ id: leadConversions.employeeId }).from(leadConversions).where(eq(leadConversions.periodMonth, period)),
    db.selectDistinct({ id: clientMeetings.employeeId }).from(clientMeetings).where(eq(clientMeetings.periodMonth, period)),
    db.selectDistinct({ id: testimonials.employeeId }).from(testimonials).where(eq(testimonials.periodMonth, period)),
  ]);
  for (const r of [...lb, ...lc, ...mt, ...ts]) ids.add(r.id);

  const asOf = new Date();
  for (const id of ids) await computePeriodForEmployee(id, period, asOf);

  revalidatePath("/incentive");
  revalidatePath("/incentive/admin");
  return { ok: true, employees: ids.size };
}
