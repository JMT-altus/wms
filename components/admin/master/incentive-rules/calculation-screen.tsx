import type * as React from "react";
import type { Employee } from "@/db/schema";
import type { IncentiveCalcRights } from "@/lib/auth/incentive-calc";
import { carryBalances, monthView, todayIST } from "@/lib/queries/incentive-calc";
import { CategoryACalculation } from "./calculation";
import { CarryLedger } from "./carry-ledger";
import { VoidMonth } from "./void-month";
import { CalcTabs, CategorySwitch, type CalcCat } from "./calc-ui";
import { NoCalcAccess } from "./no-calc-access";

/**
 * The Calculation screen (Category A, or Category B with `category="B"`), shared by Admin & Master Setup and the
 * Incentive Tracker: one loader (monthView), one component, the same server-side rights. `basePath` keeps the month
 * and programme links inside the module the screen is opened from. Provisional figures appear only to holders of an
 * Incentive Calculation right.
 */
export async function CategoryACalculationScreen({
  me,
  rights,
  searchParams,
  basePath,
  variant,
  head,
  category = "A",
}: {
  me: Employee;
  rights: IncentiveCalcRights;
  searchParams: { program?: string; month?: string };
  basePath: string;
  variant: "master" | "tracker";
  head: React.ReactNode;
  category?: CalcCat;
}) {
  if (!rights.view)
    return (
      <div>
        {head}
        <NoCalcAccess />
      </div>
    );
  const sp = searchParams;
  const today = todayIST();
  const month = sp.month && /^\d{4}-\d{2}$/.test(sp.month) ? `${sp.month}-01` : `${today.slice(0, 7)}-01`;
  const view = category !== "A" ? await monthView(sp.program ?? null, month, undefined, category) : await monthView(sp.program ?? null, month);
  const programId = view.period?.programId ?? (sp.program && view.programs.some((p) => p.id === sp.program) ? sp.program : (view.programs[0]?.id ?? null));
  const c = view.current;
  const per = view.period;
  // Category C: a voided month is shown as Voided (from its void record), and no action is offered on it.
  const shownStatus = view.voided ? "voided" : per?.status;
  const names = new Map((c?.results ?? []).filter((r) => r.employeeId).map((r) => [r.employeeId!, r.employeeName]));
  return (
    <div>
      {head}
      {variant === "master" && <CategorySwitch category={category} />}
      <CalcTabs active="Calculation" variant={variant} category={category} />
      <CategoryACalculation
        category={category}
        canQualify={rights.qualify}
        qualifications={(view.qualifications ?? []).map((x) => ({ id: x.id, orderNo: x.orderNo, orderDate: String(x.orderDate), customerName: x.customerName, outcome: x.outcome, automaticOutcome: x.automaticOutcome, overrideDecision: x.overrideDecision, invoiceNo: x.invoiceNo, invoiceDate: x.invoiceDate ? String(x.invoiceDate) : null, netTaxablePaise: x.netTaxablePaise === null ? null : Number(x.netTaxablePaise), baseExact: x.baseExact, inMonth: x.inMonth, pinned: x.pinned, reasons: x.reasons, evidence: x.evidence as never }))}
        reviewInvoices={view.reviewInvoices ?? []}
        items={(view.items ?? []).map((i) => ({ id: i.id, employeeName: i.employeeId ? (names.get(i.employeeId) ?? null) : null, lineCode: i.lineCode, label: i.label, baseExact: i.baseExact, earnedExact: i.earnedExact, payableExact: i.payableExact, multiplierPpm: i.multiplierPpm, status: i.status, explanation: i.explanation }))}
        excludedNotes={view.excludedNotes ?? []}
        basePath={basePath}
        workflow={
          per && programId && per.currentRunId
            ? {
                programId,
                month,
                me: me.id,
                rights: { submit: rights.submit, approve: rights.approve, pay: rights.pay, approvals: rights.approvals, payouts: rights.payouts },
                approvedTotalPaise: view.approvedTotalPaise,
                period: { status: shownStatus!, rowVersion: per.rowVersion, submissionNo: per.submissionNo, approvalsRequired: per.approvalsRequired, submittedByName: view.submittedByName, submittedById: per.submittedById, submittedAt: per.submittedAt ? per.submittedAt.toISOString() : null, releaseOn: per.releaseOn ? String(per.releaseOn) : null, payoutReference: per.payoutReference },
                approvals: (rights.approvals ? view.approvals : []).map((a) => ({ id: a.id, submissionNo: a.submissionNo, stepNo: a.stepNo, decision: a.decision, reason: a.reason, actorName: a.actorName, actorId: a.actorId, at: a.at.toISOString() })),
                payout: rights.payouts && view.payout ? { reference: view.payout.payout.reference, releaseOn: String(view.payout.payout.releaseOn), paidOn: String(view.payout.payout.paidOn), totalPaise: Number(view.payout.payout.totalPaise), recordedByName: view.payout.payout.recordedByName, note: view.payout.payout.note, lines: view.payout.lines.map((l) => ({ employeeName: l.employeeName, payablePaise: Number(l.payablePaise), adjustmentsPaise: Number(l.adjustmentsPaise), amountPaise: Number(l.amountPaise) })) } : null,
              }
            : null
        }
        ready={view.ready}
        canRun={rights.run}
        canLock={rights.lock}
        programs={view.programs}
        programId={programId}
        month={month}
        period={view.period ? { status: shownStatus!, rowVersion: view.period.rowVersion } : null}
        latestProblems={view.latestProblems}
        current={
          c
            ? {
                runId: c.run.id,
                configVersionNo: c.run.configVersionNo,
                asOf: String(c.run.asOf),
                computedAt: c.run.computedAt.toISOString(),
                computedByName: c.run.computedByName,
                inputsHash: c.run.inputsHash,
                results: c.results.map((r) => ({ employeeName: r.employeeName, salesPaise: Number(r.salesPaise), qualified: r.qualified, earnedPaise: Number(r.earnedPaise), payablePaise: Number(r.payablePaise), pendingPaise: Number(r.pendingPaise), projectedPaise: Number(r.projectedPaise), explanation: r.explanation })),
                orders: c.orders.map((o) => ({ id: o.id, documentNo: o.documentNo, employeeId: o.employeeId, employeeName: o.employeeId ? (names.get(o.employeeId) ?? null) : null, valuePaise: Number(o.valuePaise), collectedPaise: Number(o.collectedPaise), collectiblePaise: Number(o.collectiblePaise), fullyCollected: o.fullyCollected, explanation: o.explanation })),
                receipts: c.receipts.map((p) => ({ id: p.id, receiptNo: p.receiptNo, receiptDate: String(p.receiptDate), invoiceNo: p.invoiceDocumentId ? (c.documentNos[p.invoiceDocumentId] ?? null) : null, unitNo: p.unitDocumentId ? (c.documentNos[p.unitDocumentId] ?? null) : null, employeeName: p.employeeId ? (names.get(p.employeeId) ?? null) : null, amountPaise: Number(p.amountPaise), delayDays: p.delayDays, multiplierPpm: p.multiplierPpm, status: p.status, note: p.note })),
              }
            : null
        }
        runs={view.runs.map((r) => ({ id: r.id, computedAt: r.computedAt.toISOString(), computedByName: r.computedByName, status: r.status, adopted: r.adopted, outcome: r.outcome, configVersionNo: r.configVersionNo, asOf: r.asOf }))}
        adjustmentsIn={view.adjustmentsIn.map((a) => ({ id: a.id, employeeName: a.employeeName, kind: a.kind, amountPaise: Number(a.amountPaise), fromMonth: String(a.fromMonth), note: a.note }))}
      />
      {category === "C" && view.ready && programId && per && (view.voided || (rights.void && per.currentRunId && (per.status === "open" || per.status === "locked"))) && <VoidMonth programId={programId} month={month} rowVersion={per.rowVersion} voided={view.voided ?? null} />}
      {category === "C" && view.ready && programId && <CarryLedger balances={await carryBalances(programId, "C")} canWriteOff={rights.pay} />}
    </div>
  );
}
