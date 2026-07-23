// End-to-end scheme verification: drives every condition in the Incentive
// Planning PDF through the REAL pipeline (DB → loader → compute), acting as a
// salesperson (logging deals + activity) and an admin (approving + collecting).
// Each scenario is isolated (QA-* customers + a test period) and asserted
// against the sheet.  pnpm tsx --env-file=.env.local scripts/verify-scheme.ts

import { and, eq, inArray, like } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  employees, customers, salesOrders, invoices, receipts,
  leadBatches, leadConversions, clientMeetings, testimonials, incentivePeriods,
} from "@/db/schema";
import { computePeriodForEmployee } from "@/lib/incentives/load";
import { P, L, CR } from "@/lib/incentives";
import { formatInrPaise } from "@/lib/format";

const PERIOD = "2030-06";
const addDays = (d: string, n: number) => new Date(new Date(d).getTime() + n * 86_400_000).toISOString().slice(0, 10);

let EMP = "";
let pass = 0, fail = 0;

async function clean() {
  const cs = await db.select({ id: customers.id }).from(customers).where(like(customers.code, "QA-%"));
  const ids = cs.map((c) => c.id);
  if (ids.length) await db.delete(customers).where(inArray(customers.id, ids)); // cascades orders → invoices → receipts
  await db.delete(leadBatches).where(and(eq(leadBatches.employeeId, EMP), eq(leadBatches.periodMonth, PERIOD)));
  await db.delete(leadConversions).where(and(eq(leadConversions.employeeId, EMP), eq(leadConversions.periodMonth, PERIOD)));
  await db.delete(clientMeetings).where(and(eq(clientMeetings.employeeId, EMP), eq(clientMeetings.periodMonth, PERIOD)));
  await db.delete(testimonials).where(and(eq(testimonials.employeeId, EMP), eq(testimonials.periodMonth, PERIOD)));
}

interface SaleOpts { code: string; cat: "A" | "B" | "C" | "N" | "I" | "R" | "V"; valuePaise: number; invDate: string; terms: number; paidPaise?: number; paidDate?: string; newCust?: boolean; firstTxnAt?: string; turnoverPaise?: number; }
async function sale(o: SaleOpts) {
  let [c] = await db.select().from(customers).where(eq(customers.code, o.code)).limit(1);
  if (!c) [c] = await db.insert(customers).values({ name: o.code, code: o.code, isNewCustomer: !!o.newCust, acquisitionEmployeeId: o.newCust ? EMP : null, firstTransactionAt: o.firstTxnAt ? new Date(o.firstTxnAt) : null, fyTurnoverPaise: o.turnoverPaise ?? 0 }).returning();
  const [ord] = await db.insert(salesOrders).values({ customerId: c!.id, ownerId: EMP, orderValuePaise: o.valuePaise, categoryCode: o.cat, bookedAt: new Date(o.invDate) }).returning();
  const [inv] = await db.insert(invoices).values({ orderId: ord!.id, invoiceNo: o.code, invoiceValuePaise: o.valuePaise, invoiceDate: o.invDate, agreedTermsDays: o.terms, dueDate: addDays(o.invDate, o.terms) }).returning();
  if (o.paidPaise) await db.insert(receipts).values({ invoiceId: inv!.id, amountPaise: o.paidPaise, receivedAt: o.paidDate ?? o.invDate });
}

async function check(name: string, setup: () => Promise<void>, expect: Partial<Record<"A" | "B" | "C" | "D" | "E" | "F" | "total", number>>, asOf = new Date("2030-06-20")) {
  await clean();
  await setup();
  const res = await computePeriodForEmployee(EMP, PERIOD, asOf);
  const got: Record<string, number> = { ...res.categoryTotals, total: res.totalFinalPaise };
  const diffs: string[] = [];
  for (const [k, v] of Object.entries(expect)) if ((got[k] ?? 0) !== v) diffs.push(`${k}: expected ${formatInrPaise(v!)}, got ${formatInrPaise(got[k] ?? 0)}`);
  if (diffs.length === 0) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name}\n      ${diffs.join("\n      ")}`); }
}

async function main() {
  EMP = (await db.select({ id: employees.id }).from(employees).limit(1))[0]?.id ?? "";
  if (!EMP) throw new Error("No employees.");
  console.log(`\nVerifying Sales-BH scheme through the live pipeline (period ${PERIOD})\n`);

  console.log("A · Sales slabs (marginal, eligible after ₹1 Cr, payable on collection)");
  await check("below ₹1 Cr → nothing", () => sale({ code: "QA-A", cat: "A", valuePaise: CR(0.99), invDate: "2030-06-05", terms: 30, paidPaise: CR(0.99), paidDate: "2030-06-10" }), { A: 0 });
  await check("exactly ₹1 Cr → nothing", () => sale({ code: "QA-A", cat: "A", valuePaise: CR(1.0), invDate: "2030-06-05", terms: 30, paidPaise: CR(1.0), paidDate: "2030-06-10" }), { A: 0 });
  await check("₹1.2 Cr → ₹2,000 (A.1 only)", () => sale({ code: "QA-A", cat: "A", valuePaise: CR(1.2), invDate: "2030-06-05", terms: 30, paidPaise: CR(1.2), paidDate: "2030-06-10" }), { A: P(2000) });
  await check("₹1.5 Cr → ₹7,000 (marginal)", () => sale({ code: "QA-A", cat: "A", valuePaise: CR(1.5), invDate: "2030-06-05", terms: 30, paidPaise: CR(1.5), paidDate: "2030-06-10" }), { A: P(7000) });
  await check("₹1.6 Cr → ₹9,000 (cap)", () => sale({ code: "QA-A", cat: "A", valuePaise: CR(1.6), invDate: "2030-06-05", terms: 30, paidPaise: CR(1.6), paidDate: "2030-06-10" }), { A: P(9000) });
  await check("₹2.0 Cr → ₹9,000 (capped above ₹1.6 Cr)", () => sale({ code: "QA-A", cat: "A", valuePaise: CR(2.0), invDate: "2030-06-05", terms: 30, paidPaise: CR(2.0), paidDate: "2030-06-10" }), { A: P(9000) });

  console.log("\nCollection decay (≤45 → 1.0 · 46–75 → 0.5 · 76–100 → 0.25 · >100 → nil)");
  // due 2030-07-05; paid X days past due
  await check("₹1.5 Cr collected 40d past → ₹7,000 (×1.0)", () => sale({ code: "QA-A", cat: "A", valuePaise: CR(1.5), invDate: "2030-06-05", terms: 30, paidPaise: CR(1.5), paidDate: addDays("2030-07-05", 40) }), { A: P(7000) }, new Date("2030-09-01"));
  await check("₹1.5 Cr collected 46d past → ₹3,500 (×0.5)", () => sale({ code: "QA-A", cat: "A", valuePaise: CR(1.5), invDate: "2030-06-05", terms: 30, paidPaise: CR(1.5), paidDate: addDays("2030-07-05", 46) }), { A: P(3500) }, new Date("2030-09-01"));
  await check("₹1.5 Cr collected 76d past → ₹1,750 (×0.25)", () => sale({ code: "QA-A", cat: "A", valuePaise: CR(1.5), invDate: "2030-06-05", terms: 30, paidPaise: CR(1.5), paidDate: addDays("2030-07-05", 76) }), { A: P(1750) }, new Date("2030-10-01"));
  await check("₹1.5 Cr collected 101d past → ₹0 (nil)", () => sale({ code: "QA-A", cat: "A", valuePaise: CR(1.5), invDate: "2030-06-05", terms: 30, paidPaise: CR(1.5), paidDate: addDays("2030-07-05", 101) }), { A: 0 }, new Date("2030-11-01"));

  console.log("\nB · Cross-sell (1% of first invoice above ₹1 L, cap ₹1,500)");
  await check("₹2 L invoice → ₹1,500 (1% capped)", () => sale({ code: "QA-B", cat: "B", valuePaise: L(2), invDate: "2030-06-05", terms: 30, paidPaise: L(2), paidDate: "2030-06-10" }), { B: P(1500) });
  await check("₹1 L invoice → ₹1,000 (1%)", () => sale({ code: "QA-B", cat: "B", valuePaise: L(1), invDate: "2030-06-05", terms: 30, paidPaise: L(1), paidDate: "2030-06-10" }), { B: P(1000) });
  await check("₹0.9 L invoice → ₹0 (below ₹1 L)", () => sale({ code: "QA-B", cat: "B", valuePaise: L(0.9), invDate: "2030-06-05", terms: 30, paidPaise: L(0.9), paidDate: "2030-06-10" }), { B: 0 });
  await check("₹2 L collected 46d past → ₹750 (×0.5)", () => sale({ code: "QA-B", cat: "B", valuePaise: L(2), invDate: "2030-06-05", terms: 30, paidPaise: L(2), paidDate: addDays("2030-07-05", 46) }), { B: P(750) }, new Date("2030-09-01"));

  console.log("\nC · New customer (1% of first 3 txns; ≥₹2.5 L turnover; 3 txns; fully paid; cap ₹5,000)");
  const cohort = async (opts: { turnover: number; txns: number; paid: boolean; total: number }) => {
    // create N transactions for one new customer; 3rd booked in June 2030
    const per = Math.round(opts.total / opts.txns);
    for (let i = 0; i < opts.txns; i++) {
      const inv = i < opts.txns - 1 ? `2030-0${4 + i}-05` : "2030-06-05"; // last in June
      await sale({ code: "QA-C", cat: "C", valuePaise: per, invDate: inv, terms: 30, paidPaise: opts.paid ? per : undefined, paidDate: inv, newCust: true, firstTxnAt: "2030-04-05", turnoverPaise: opts.turnover });
    }
  };
  await check("3 txns · ₹10 L · paid → ₹5,000 (1% capped)", () => cohort({ turnover: L(10), txns: 3, paid: true, total: L(10) }), { C: P(5000) });
  await check("3 txns · ₹3 L · paid → ₹3,000 (1%)", () => cohort({ turnover: L(3), txns: 3, paid: true, total: L(3) }), { C: P(3000) });
  await check("turnover ₹2.4 L → ₹0 (ineligible)", () => cohort({ turnover: L(2.4), txns: 3, paid: true, total: L(3) }), { C: 0 });
  await check("only 2 txns → ₹0 (ineligible)", () => cohort({ turnover: L(10), txns: 2, paid: true, total: L(10) }), { C: 0 });
  await check("not fully paid → ₹0 (ineligible)", () => cohort({ turnover: L(10), txns: 3, paid: false, total: L(10) }), { C: 0 });

  console.log("\nD · Leads ₹250/10 profiled · Enquiries ₹250/5 · shared cap ₹1,000");
  await check("30 profiled leads (approved) → ₹750", async () => { await db.insert(leadBatches).values({ employeeId: EMP, periodMonth: PERIOD, leadCount: 30, profiled: true, reviewStatus: "approved" }); }, { D: P(750) });
  await check("30 leads NOT profiled → ₹0", async () => { await db.insert(leadBatches).values({ employeeId: EMP, periodMonth: PERIOD, leadCount: 30, profiled: false, reviewStatus: "approved" }); }, { D: 0 });
  await check("leads pending (not approved) → ₹0", async () => { await db.insert(leadBatches).values({ employeeId: EMP, periodMonth: PERIOD, leadCount: 30, profiled: true, reviewStatus: "pending" }); }, { D: 0 });
  await check("10 enquiries (approved) → ₹500", async () => { await db.insert(leadConversions).values({ employeeId: EMP, periodMonth: PERIOD, convertedCount: 10, reviewStatus: "approved" }); }, { D: P(500) });
  await check("30 leads + 10 enquiries → ₹1,000 (category cap)", async () => { await db.insert(leadBatches).values({ employeeId: EMP, periodMonth: PERIOD, leadCount: 30, profiled: true, reviewStatus: "approved" }); await db.insert(leadConversions).values({ employeeId: EMP, periodMonth: PERIOD, convertedCount: 10, reviewStatus: "approved" }); }, { D: P(1000) });

  console.log("\nE · Meetings (admin discretionary ₹250–₹1,000, cap ₹1,000)");
  await check("award ₹1,000 → ₹1,000", async () => { await db.insert(clientMeetings).values({ employeeId: EMP, periodMonth: PERIOD, awardedPaise: P(1000), reviewStatus: "approved" }); }, { E: P(1000) });
  await check("award ₹1,500 → clamps to ₹1,000", async () => { await db.insert(clientMeetings).values({ employeeId: EMP, periodMonth: PERIOD, awardedPaise: P(1500), reviewStatus: "approved" }); }, { E: P(1000) });
  await check("award ₹100 → clamps to ₹250", async () => { await db.insert(clientMeetings).values({ employeeId: EMP, periodMonth: PERIOD, awardedPaise: P(100), reviewStatus: "approved" }); }, { E: P(250) });
  await check("two ₹1,000 meetings → ₹1,000 (cap)", async () => { await db.insert(clientMeetings).values([{ employeeId: EMP, periodMonth: PERIOD, awardedPaise: P(1000), reviewStatus: "approved" }, { employeeId: EMP, periodMonth: PERIOD, awardedPaise: P(1000), reviewStatus: "approved" }]); }, { E: P(1000) });

  console.log("\nF · Reviews (Google ₹100 5★≥50w · email ₹100 · letterhead ₹150 · F.4 doubles, cap ₹750)");
  const t = async (o: Partial<typeof testimonials.$inferInsert>) => { await db.insert(testimonials).values({ employeeId: EMP, periodMonth: PERIOD, kind: "google_review", wordCount: 60, starRating: 5, namesTeamMember: false, reviewStatus: "approved", evidenceUrl: "x", ...o }); };
  await check("Google 5★ 60w screenshot → ₹100", () => t({}), { F: P(100) });
  await check("Google 4★ → ₹0", () => t({ starRating: 4 }), { F: 0 });
  await check("Google 40 words → ₹0", () => t({ wordCount: 40 }), { F: 0 });
  await check("Google no screenshot → ₹0", () => t({ evidenceUrl: null }), { F: 0 });
  await check("Email testimonial → ₹100", () => t({ kind: "email", wordCount: 10, starRating: null }), { F: P(100) });
  await check("Letterhead testimonial → ₹150", () => t({ kind: "letterhead", wordCount: 10, starRating: null }), { F: P(150) });
  await check("Letterhead naming a teammate → ₹300 (F.4 2×)", () => t({ kind: "letterhead", wordCount: 10, starRating: null, namesTeamMember: true }), { F: P(300) });
  await check("6 doubled reviews → ₹750 (cap)", async () => { for (let i = 0; i < 6; i++) await t({ kind: "letterhead", wordCount: 10, starRating: null, namesTeamMember: true }); }, { F: P(750) });

  console.log("\nGrand total (every category at cap)");
  await check("full month → ₹18,250 total", async () => {
    await sale({ code: "QA-A", cat: "A", valuePaise: CR(1.6), invDate: "2030-06-05", terms: 30, paidPaise: CR(1.6), paidDate: "2030-06-10" });      // A 9000
    await sale({ code: "QA-B", cat: "B", valuePaise: L(2), invDate: "2030-06-05", terms: 30, paidPaise: L(2), paidDate: "2030-06-10" });            // B 1500
    await cohort({ turnover: L(10), txns: 3, paid: true, total: L(10) });                                                                            // C 5000
    await db.insert(leadBatches).values({ employeeId: EMP, periodMonth: PERIOD, leadCount: 40, profiled: true, reviewStatus: "approved" });          // D 1000
    await db.insert(clientMeetings).values({ employeeId: EMP, periodMonth: PERIOD, awardedPaise: P(1000), reviewStatus: "approved" });               // E 1000
    for (let i = 0; i < 6; i++) await t({ kind: "letterhead", wordCount: 10, starRating: null, namesTeamMember: true });                             // F 750
  }, { A: P(9000), B: P(1500), C: P(5000), D: P(1000), E: P(1000), F: P(750), total: P(18250) });

  await clean();
  await db.delete(incentivePeriods).where(eq(incentivePeriods.month, PERIOD)); // cascades the test ledger
  console.log(`\n=== ${pass} passed · ${fail} failed ===\n`);
  process.exit(fail === 0 ? 0 : 1);
}
main().catch((e) => { console.error(e); process.exit(1); });
