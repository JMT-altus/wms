// Isolated demo seed for the Incentive Tracker. Idempotent: wipes prior
// SEED-* rows first, so it's safe to re-run. Creates one realistic month for
// the first employee — sales slabs (on time), a new-customer cohort with an
// overdue invoice (exercises decay), cross-sell, leads, meetings, testimonials
// — then computes the period and prints the ledger to self-verify.
//
//   pnpm tsx --env-file=.env.local scripts/seed-incentives.ts

import { and, eq, like, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  employees, customers, salesOrders, invoices, receipts,
  leadBatches, leadConversions, clientMeetings, testimonials,
  incentiveSchemes, ruleVersions, schemeAssignments, incentivePeriods, incentiveLedger,
} from "@/db/schema";
import { P, L, CR, SALES_BH_SCHEME } from "@/lib/incentives";
import { computePeriodForEmployee } from "@/lib/incentives/load";
import { formatInrPaise } from "@/lib/format";

const PERIOD = "2026-07";
const ASOF = new Date("2026-07-23T00:00:00Z");
const d = (s: string) => s; // date-column strings

async function wipe() {
  const seededCustomers = await db.select({ id: customers.id }).from(customers).where(like(customers.code, "SEED-%"));
  const custIds = seededCustomers.map((c) => c.id);
  if (custIds.length) {
    const ords = await db.select({ id: salesOrders.id }).from(salesOrders).where(inArray(salesOrders.customerId, custIds));
    const ordIds = ords.map((o) => o.id);
    if (ordIds.length) {
      const invs = await db.select({ id: invoices.id }).from(invoices).where(inArray(invoices.orderId, ordIds));
      const invIds = invs.map((i) => i.id);
      if (invIds.length) await db.delete(receipts).where(inArray(receipts.invoiceId, invIds));
      await db.delete(invoices).where(inArray(invoices.orderId, ordIds));
    }
    await db.delete(salesOrders).where(inArray(salesOrders.customerId, custIds));
    await db.delete(customers).where(inArray(customers.id, custIds));
  }
  await db.delete(incentiveSchemes).where(like(incentiveSchemes.name, "SEED %"));
}

async function main() {
  // Target the signed-in admin by default so the demo month shows on their
  // "My Incentives". Override with SEED_EMPLOYEE_EMAIL=someone@x.com.
  const targetEmail = process.env.SEED_EMPLOYEE_EMAIL;
  let emp = targetEmail
    ? (await db.select().from(employees).where(eq(employees.email, targetEmail)).limit(1))[0]
    : undefined;
  emp ??= (await db.select().from(employees).where(eq(employees.isAdmin, true)).limit(1))[0];
  emp ??= (await db.select().from(employees).limit(1))[0];
  if (!emp) throw new Error("No employees — run the main seed first.");
  console.log(`Seeding incentive demo for ${emp.name} (${emp.id}), period ${PERIOD}\n`);

  await wipe();
  // Clear this employee's prior submissions for the period so re-runs stay clean.
  await db.delete(leadBatches).where(and(eq(leadBatches.employeeId, emp.id), eq(leadBatches.periodMonth, PERIOD)));
  await db.delete(leadConversions).where(and(eq(leadConversions.employeeId, emp.id), eq(leadConversions.periodMonth, PERIOD)));
  await db.delete(clientMeetings).where(and(eq(clientMeetings.employeeId, emp.id), eq(clientMeetings.periodMonth, PERIOD)));
  await db.delete(testimonials).where(and(eq(testimonials.employeeId, emp.id), eq(testimonials.periodMonth, PERIOD)));

  // Scheme + published rule version (snapshot of the config the engine used).
  const [scheme] = await db.insert(incentiveSchemes).values({
    name: "SEED Sales BH", scopeRole: "sales_bh", effectiveFrom: d("2026-04-01"),
  }).returning();
  await db.insert(ruleVersions).values({
    schemeId: scheme!.id, version: 1, config: SALES_BH_SCHEME as unknown as object,
    effectiveFrom: d("2026-04-01"), publishedAt: ASOF,
  });
  await db.insert(schemeAssignments).values({ employeeId: emp.id, schemeId: scheme!.id, effectiveFrom: d("2026-04-01") });

  // ── A · sales slabs — ₹1.5 Cr of July orders, invoiced this month (on time) ──
  const slabCust = (await db.insert(customers).values({ name: "SEED Bharat Traders", code: "SEED-A1", isNewCustomer: false }).returning())[0]!;
  const [slabOrder] = await db.insert(salesOrders).values({
    customerId: slabCust.id, ownerId: emp.id, orderValuePaise: CR(1.5), categoryCode: "A", bookedAt: new Date("2026-07-08"),
  }).returning();
  const [slabInv] = await db.insert(invoices).values({
    orderId: slabOrder!.id, invoiceNo: "SEED-INV-A", invoiceValuePaise: CR(1.5),
    invoiceDate: d("2026-07-08"), agreedTermsDays: 30, dueDate: d("2026-08-07"),
  }).returning();
  await db.insert(receipts).values({ invoiceId: slabInv!.id, amountPaise: CR(1.5), receivedAt: d("2026-07-20") });

  // ── B · cross-sell — first invoice ₹2 L, on time ──
  const [bOrder] = await db.insert(salesOrders).values({
    customerId: slabCust.id, ownerId: emp.id, orderValuePaise: L(2), categoryCode: "B",
    productRef: "New Brand X", bookedAt: new Date("2026-07-12"),
  }).returning();
  const [bInv] = await db.insert(invoices).values({
    orderId: bOrder!.id, invoiceNo: "SEED-INV-B", invoiceValuePaise: L(2),
    invoiceDate: d("2026-07-12"), agreedTermsDays: 30, dueDate: d("2026-08-11"), isFirstInvoiceForCustomer: false,
  }).returning();
  await db.insert(receipts).values({ invoiceId: bInv!.id, amountPaise: L(2), receivedAt: d("2026-07-18") });

  // ── C · new customer — 3 transactions (May/Jun/Jul), one invoice overdue → decay ──
  const newCust = (await db.insert(customers).values({
    name: "SEED Acme Corp", code: "SEED-C1", acquisitionEmployeeId: emp.id,
    firstTransactionAt: new Date("2026-05-05"), fyTurnoverPaise: L(10), isNewCustomer: true,
  }).returning())[0]!;
  const cTxns = [
    // Paid, but collected LATE (due 06-04, received 07-20 → ~46d past → decay 0.50).
    { booked: "2026-05-05", inv: "2026-05-05", terms: 30, val: L(4), paidOn: "2026-07-20" },
    { booked: "2026-06-10", inv: "2026-06-10", terms: 30, val: L(3), paidOn: "2026-06-15" },
    { booked: "2026-07-15", inv: "2026-07-15", terms: 30, val: L(3), paidOn: "2026-07-16" }, // 3rd completes in July
  ];
  for (const [i, t] of cTxns.entries()) {
    const [o] = await db.insert(salesOrders).values({
      customerId: newCust.id, ownerId: emp.id, orderValuePaise: t.val, categoryCode: "C", bookedAt: new Date(t.booked),
    }).returning();
    const [inv] = await db.insert(invoices).values({
      orderId: o!.id, invoiceNo: `SEED-INV-C${i + 1}`, invoiceValuePaise: t.val,
      invoiceDate: d(t.inv), agreedTermsDays: t.terms, dueDate: d(new Date(new Date(t.inv).getTime() + t.terms * 86400000).toISOString().slice(0, 10)),
      isFirstInvoiceForCustomer: i === 0,
    }).returning();
    await db.insert(receipts).values({ invoiceId: inv!.id, amountPaise: t.val, receivedAt: d(t.paidOn) });
  }

  // ── Outstanding overdue invoices — exercise the at-risk decay panel ──
  const odCust = (await db.insert(customers).values({ name: "SEED Overdue Co", code: "SEED-OD", isNewCustomer: false }).returning())[0]!;
  const overdue = [
    { inv: "2026-06-10", val: L(5), no: "SEED-OD-1" }, // due 06-10 → ~43d past → HALVES IN a few days
    { inv: "2026-05-20", val: L(3), no: "SEED-OD-2" }, // due 05-20 → ~64d past → already ×0.50
  ];
  for (const od of overdue) {
    const [o] = await db.insert(salesOrders).values({
      customerId: odCust.id, ownerId: emp.id, orderValuePaise: od.val, categoryCode: "A", bookedAt: new Date(od.inv),
    }).returning();
    await db.insert(invoices).values({
      orderId: o!.id, invoiceNo: od.no, invoiceValuePaise: od.val, invoiceDate: d(od.inv), agreedTermsDays: 0, dueDate: d(od.inv),
    }); // no receipt → outstanding
  }

  // ── D/E/F · activity submissions (approved) ──
  await db.insert(leadBatches).values({ employeeId: emp.id, periodMonth: PERIOD, leadCount: 30, profiled: true, reviewStatus: "approved" });
  await db.insert(leadConversions).values({ employeeId: emp.id, periodMonth: PERIOD, convertedCount: 10, reviewStatus: "approved" });
  await db.insert(clientMeetings).values({ employeeId: emp.id, periodMonth: PERIOD, potentialBand: "high", awardedPaise: P(1000), reviewStatus: "approved", justification: "Key account, ₹50L potential" });
  await db.insert(testimonials).values([
    { employeeId: emp.id, periodMonth: PERIOD, kind: "letterhead", wordCount: 80, namesTeamMember: true, reviewStatus: "approved", evidenceUrl: "seed://doc" },
    { employeeId: emp.id, periodMonth: PERIOD, kind: "email", wordCount: 60, namesTeamMember: false, reviewStatus: "approved", evidenceUrl: "seed://email" },
    { employeeId: emp.id, periodMonth: PERIOD, kind: "google_review", wordCount: 65, starRating: 5, namesTeamMember: false, reviewStatus: "approved", evidenceUrl: "seed://shot" },
  ]);

  // ── Compute + print ──
  console.log("Computing period…\n");
  const result = await computePeriodForEmployee(emp.id, PERIOD, ASOF);
  for (const line of result.lines.filter((l) => l.finalPaise > 0 || l.prePaise > 0)) {
    console.log(`  ${line.lineCode.padEnd(4)} ${formatInrPaise(line.finalPaise).padStart(10)}   ${line.explanation}`);
  }
  console.log(`\n  Category totals: ${Object.entries(result.categoryTotals).filter(([, v]) => v > 0).map(([k, v]) => `${k}=${formatInrPaise(v)}`).join(" · ")}`);
  console.log(`  TOTAL PAYABLE:   ${formatInrPaise(result.totalFinalPaise)}  (pre-decay/cap ${formatInrPaise(result.totalPrePaise)})`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
