// One pure function per PDF rule. Each returns raw Accruals (pre-cap, with a
// per-occurrence cap already applied and a decay multiplier attached). The
// engine runs the cap cascade and applies decay. No DB, no Date.

import type {
  Accrual,
  CrossSellInvoice,
  EvaluationInput,
  LeadBatchInput,
  LeadConversionInput,
  LineCode,
  MeetingInput,
  NewCustomerCohort,
  SalesSlabInput,
  SchemeConfig,
  TestimonialInput,
} from "./types";
import { decayMultiplier, decayLabel } from "./collection";
import { formatInrPaise, formatInrCompactPaise } from "@/lib/format";

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// ── A · marginal sales slabs (A.1–A.3) ──
export function slabAccruals(sales: SalesSlabInput | undefined, cfg: SchemeConfig): Accrual[] {
  if (!sales) return [];
  const sales_ = sales.monthlySalesPaise;
  if (sales_ < cfg.entryThresholdPaise) return [];
  const decay = sales.decayMultiplier ?? 1;
  const out: Accrual[] = [];

  cfg.slabBands.forEach((band, i) => {
    if (sales_ <= band.fromPaise) return;
    const isTop = i === cfg.slabBands.length - 1;
    const upper =
      isTop && cfg.slabContinuesAboveTop ? sales_ : Math.min(sales_, band.toPaise);
    const portion = upper - band.fromPaise;
    if (portion <= 0) return;
    const amount = Math.round(portion * band.rate);
    if (amount <= 0) return;
    const code = `A.${i + 1}` as LineCode;
    out.push({
      lineCode: code,
      category: "A",
      sourceRef: `slab:${code}`,
      basePaise: amount,
      decayMultiplier: decay,
      explanation:
        `${code} · SALES SLAB — ${formatInrCompactPaise(sales_)} booked. ` +
        `Band ${formatInrCompactPaise(band.fromPaise)}–${formatInrCompactPaise(band.toPaise)} ` +
        `at ${(band.rate * 100).toFixed(2)}% on ${formatInrPaise(portion)} = ${formatInrPaise(amount)}. ` +
        `Multiplier ${decayLabel(decay)}.`,
    });
  });
  return out;
}

// ── B · cross-sell / up-sell (B.1): flat 1% of a first invoice above ₹1 L ──
export function crossSellAccruals(invoices: CrossSellInvoice[] | undefined, cfg: SchemeConfig): Accrual[] {
  if (!invoices) return [];
  const perOcc = cfg.categoryCaps.B; // ₹1,500 per qualifying first invoice
  return invoices.flatMap((inv) => {
    if (inv.invoiceValuePaise < cfg.crossSell.minInvoicePaise) return [];
    const raw = Math.round(inv.invoiceValuePaise * cfg.crossSell.rate);
    const amount = Math.min(raw, perOcc);
    const decay = decayMultiplier(inv.daysPastTerms, cfg.decaySteps);
    const capNote = amount < raw ? ` (capped from ${formatInrPaise(raw)})` : "";
    return [
      {
        lineCode: "B.1" as LineCode,
        category: "B" as const,
        sourceRef: `crosssell:${inv.id}`,
        basePaise: amount,
        decayMultiplier: decay,
        explanation:
          `B.1 · CROSS-SELL — 1% of ${formatInrPaise(inv.invoiceValuePaise)}` +
          `${inv.customer ? ` (${inv.customer})` : ""} = ${formatInrPaise(amount)}${capNote}. ` +
          `Multiplier ${decayLabel(decay)}.`,
      },
    ];
  });
}

// ── C · new-customer acquisition (C.1): 1% of first 3 transactions ──
export function newCustomerAccruals(cohorts: NewCustomerCohort[] | undefined, cfg: SchemeConfig): Accrual[] {
  if (!cohorts) return [];
  return cohorts.flatMap((c) => {
    const eligible =
      c.fyTurnoverPaise >= cfg.newCustomer.minTurnoverPaise &&
      c.transactionsDone >= cfg.newCustomer.requiredTxns &&
      c.fullyPaid;
    if (!eligible) return [];
    const raw = Math.round(c.first3TotalPaise * cfg.newCustomer.rate);
    const amount = Math.min(raw, cfg.categoryCaps.C);
    const decay = decayMultiplier(c.daysPastTerms, cfg.decaySteps);
    return [
      {
        lineCode: "C.1" as LineCode,
        category: "C" as const,
        sourceRef: `newcust:${c.id}`,
        basePaise: amount,
        decayMultiplier: decay,
        explanation:
          `C.1 · NEW CUSTOMER — 1% of first 3 (${formatInrPaise(c.first3TotalPaise)})` +
          `${c.customer ? ` for ${c.customer}` : ""} = ${formatInrPaise(amount)}. ` +
          `Multiplier ${decayLabel(decay)}.`,
      },
    ];
  });
}

// ── D · leads (D.1: ₹250/10 profiled) & conversions (D.2: ₹250/5 to enquiry) ──
export function leadAccruals(batches: LeadBatchInput[] | undefined, cfg: SchemeConfig): Accrual[] {
  if (!batches) return [];
  return batches.flatMap((b) => {
    if (!b.approved || !b.profiled) return [];
    const units = Math.floor(b.leadCount / cfg.leads.perUnit);
    if (units <= 0) return [];
    const amount = units * cfg.leads.unitPaise;
    return [
      {
        lineCode: "D.1" as LineCode,
        category: "D" as const,
        sourceRef: `leads:${b.id}`,
        basePaise: amount,
        decayMultiplier: 1,
        explanation:
          `D.1 · LEADS — ${units}×10 profiled leads (${b.leadCount}) = ${formatInrPaise(amount)}.`,
      },
    ];
  });
}

export function conversionAccruals(convs: LeadConversionInput[] | undefined, cfg: SchemeConfig): Accrual[] {
  if (!convs) return [];
  return convs.flatMap((c) => {
    if (!c.approved) return [];
    const units = Math.floor(c.convertedCount / cfg.conversions.perUnit);
    if (units <= 0) return [];
    const amount = units * cfg.conversions.unitPaise;
    return [
      {
        lineCode: "D.2" as LineCode,
        category: "D" as const,
        sourceRef: `conv:${c.id}`,
        basePaise: amount,
        decayMultiplier: 1,
        explanation:
          `D.2 · ENQUIRIES — ${units}×5 leads→enquiry (${c.convertedCount}) = ${formatInrPaise(amount)}.`,
      },
    ];
  });
}

// ── E · discretionary high-value meeting (E.1): admin ₹250–₹1,000 ──
export function meetingAccruals(meetings: MeetingInput[] | undefined, cfg: SchemeConfig): Accrual[] {
  if (!meetings) return [];
  return meetings.flatMap((m) => {
    if (!m.approved) return [];
    const amount = clamp(m.awardedPaise, cfg.meeting.minPaise, cfg.meeting.maxPaise);
    return [
      {
        lineCode: "E.1" as LineCode,
        category: "E" as const,
        sourceRef: `meeting:${m.id}`,
        basePaise: amount,
        decayMultiplier: 1,
        explanation: `E.1 · MEETING — admin award ${formatInrPaise(amount)}.`,
      },
    ];
  });
}

// ── F · reviews / testimonials (F.1–F.3) + F.4 appreciation doubling ──
export function testimonialAccruals(items: TestimonialInput[] | undefined, cfg: SchemeConfig): Accrual[] {
  if (!items) return [];
  return items.flatMap((t) => {
    if (!t.approved) return [];
    let base: number;
    let code: LineCode;
    let label: string;
    if (t.kind === "google_review") {
      if (cfg.testimonials.requireFiveStar && t.starRating !== 5) return [];
      if (t.wordCount < cfg.testimonials.minWords) return [];
      if (t.hasScreenshot === false) return [];
      base = cfg.testimonials.googleReviewPaise;
      code = "F.1";
      label = "GOOGLE REVIEW";
    } else if (t.kind === "email") {
      base = cfg.testimonials.emailPaise;
      code = "F.2";
      label = "EMAIL TESTIMONIAL";
    } else {
      base = cfg.testimonials.letterheadPaise;
      code = "F.3";
      label = "LETTERHEAD TESTIMONIAL";
    }
    const doubled = t.namesTeamMember;
    const amount = doubled ? base * cfg.testimonials.appreciationMultiplier : base;
    return [
      {
        lineCode: code,
        category: "F" as const,
        sourceRef: `testimonial:${t.id}`,
        basePaise: amount,
        decayMultiplier: 1,
        explanation:
          `${code} · ${label} — ${formatInrPaise(base)}` +
          `${doubled ? ` ×${cfg.testimonials.appreciationMultiplier} (F.4 names a team member) = ${formatInrPaise(amount)}` : ""}.`,
      },
    ];
  });
}

/** All raw accruals for one employee-period, before the cap cascade. */
export function collectAccruals(input: EvaluationInput, cfg: SchemeConfig): Accrual[] {
  return [
    ...slabAccruals(input.sales, cfg),
    ...crossSellAccruals(input.crossSellInvoices, cfg),
    ...newCustomerAccruals(input.newCustomerCohorts, cfg),
    ...leadAccruals(input.leadBatches, cfg),
    ...conversionAccruals(input.leadConversions, cfg),
    ...meetingAccruals(input.meetings, cfg),
    ...testimonialAccruals(input.testimonials, cfg),
  ];
}
