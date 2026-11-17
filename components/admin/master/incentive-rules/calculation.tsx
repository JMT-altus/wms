"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { Calculator, Lock, LockOpen } from "lucide-react";
import { fireToast } from "@/lib/toast";
import { MASTERS_GRADIENT, MASTERS_INK } from "@/components/masters/theme";
import { calculateCategoryAMonth, setCategoryAMonthLocked } from "@/app/(masters)/master-setup/incentive-rules/calculation/actions";
import { CalcWorkflow, type WorkflowProps } from "./calc-workflow";

/**
 * Admin & Master Setup → Incentive Rules → Calculation (Category A). Choose a programme and month; Calculate records a
 * new run from Forms and the published configuration (adopted only while the month is open); Lock / Reopen as the
 * rights allow. Every figure comes with the reasons the engine gave. Approval and payout are not here.
 */

const CARD: React.CSSProperties = { border: "1px solid var(--color-hairline)", boxShadow: "0 2px 6px -2px rgba(15, 23, 42, 0.06)" };
const FIELD = "h-9 rounded-lg border border-hairline-strong bg-white px-2.5 text-[13px] text-ink-strong";
const rs = (p: number) => `₹${(p / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const STATUS_LABEL: Record<string, string> = { open: "Open", locked: "Locked", submitted: "Submitted for approval", approved: "Approved", paid: "Paid" };

export interface CalcProps {
  /** Where this screen lives (Admin & Master Setup or the Incentive Tracker): month and programme links stay there. */
  basePath?: string;
  ready: boolean;
  canRun: boolean;
  canLock: boolean;
  programs: { id: string; code: string; name: string }[];
  programId: string | null;
  month: string;
  period: { status: string; rowVersion: number } | null;
  latestProblems: string[];
  current: {
    runId: string;
    configVersionNo: number | null;
    asOf: string;
    computedAt: string;
    computedByName: string;
    inputsHash: string;
    results: { employeeName: string; salesPaise: number; qualified: boolean; earnedPaise: number; payablePaise: number; pendingPaise: number; projectedPaise: number; explanation: string[] }[];
    orders: { id: string; documentNo: string; employeeId: string | null; employeeName?: string | null; valuePaise: number; collectedPaise: number; collectiblePaise: number; fullyCollected: boolean; explanation: string[] }[];
    receipts: { id: string; receiptNo: string; receiptDate: string; invoiceNo?: string | null; unitNo?: string | null; employeeName?: string | null; amountPaise: number; delayDays: number | null; multiplierPpm: number | null; status: string; note: string }[];
  } | null;
  runs: { id: string; computedAt: string; computedByName: string; status: string; adopted: boolean; outcome: string; configVersionNo: number | null; asOf: string }[];
  adjustmentsIn: { id: string; employeeName: string; kind: string; amountPaise: number; fromMonth: string; note: string }[];
  /** Approval and payout of the month (absent until it has been calculated). */
  workflow?: WorkflowProps | null;
}

export function CategoryACalculation(p: CalcProps) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [message, setMessage] = React.useState<{ tone: "ok" | "bad"; text: string; list?: string[] } | null>(null);
  const go = (programId: string | null, month: string) => router.push(`${p.basePath ?? "/master-setup/incentive-rules/calculation"}?${new URLSearchParams({ ...(programId ? { program: programId } : {}), month: month.slice(0, 7) })}` as Route);
  const status = p.period?.status ?? "open";

  async function calculate() {
    if (!p.programId) return;
    setBusy(true);
    setMessage(null);
    const r = await calculateCategoryAMonth({ programId: p.programId, month: p.month });
    setBusy(false);
    if (!r.ok) return setMessage({ tone: "bad", text: r.error });
    setMessage({ tone: r.status === "blocked" ? "bad" : "ok", text: r.status === "blocked" ? "Not calculated:" : r.outcome, list: r.problems });
    fireToast({ message: r.status === "blocked" ? "Calculation blocked" : r.unchanged ? "Nothing changed" : "Calculated" });
    router.refresh();
  }
  async function lock(on: boolean) {
    if (!p.programId || !p.period) return;
    setBusy(true);
    const r = await setCategoryAMonthLocked({ programId: p.programId, month: p.month, lock: on, rowVersion: p.period.rowVersion });
    setBusy(false);
    if (!r.ok) return setMessage({ tone: "bad", text: r.error });
    setMessage({ tone: "ok", text: on ? "Month locked." : "Month reopened.", list: r.notes });
    router.refresh();
  }

  if (!p.ready)
    return (
      <div role="status" className="rounded-section px-5 py-4 text-[14px] text-ink-muted" style={{ background: "var(--color-amber-bg)", border: "1px solid color-mix(in srgb, var(--color-amber) 35%, transparent)" }}>
        <strong className="text-ink-strong">Database updates 0132 and 0133 needed.</strong> Calculations can be made once they are applied. The live Incentive Tracker is not affected.
      </div>
    );

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <div className="flex flex-wrap items-end gap-2">
        <label className="grid gap-1 text-[12px] font-semibold text-ink-muted">
          Programme
          <select className={FIELD} value={p.programId ?? ""} onChange={(e) => go(e.target.value, p.month)} aria-label="Programme">
            {!p.programs.length && <option value="">No programme yet</option>}
            {p.programs.map((x) => (
              <option key={x.id} value={x.id}>
                {x.code} · {x.name}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-[12px] font-semibold text-ink-muted">
          Month
          <input type="month" className={FIELD} value={p.month.slice(0, 7)} onChange={(e) => e.target.value && go(p.programId, `${e.target.value}-01`)} aria-label="Month" />
        </label>
        <span className="rounded-pill px-3 py-1 text-[12px] font-bold text-ink-strong" style={{ background: "var(--color-hairline)" }} aria-label="Month status">
          {STATUS_LABEL[status] ?? status}
        </span>
        <span className="ml-auto flex gap-2">
          {p.canRun && (
            <button type="button" disabled={busy || !p.programId || status === "paid"} onClick={calculate} className="inline-flex h-9 items-center gap-1.5 rounded-pill px-4 text-[13px] font-bold text-white disabled:opacity-50" style={{ background: MASTERS_GRADIENT }}>
              <Calculator size={15} aria-hidden /> Calculate
            </button>
          )}
          {p.canLock && status === "open" && p.current && (
            <button type="button" disabled={busy} onClick={() => lock(true)} className="inline-flex h-9 items-center gap-1.5 rounded-pill px-4 text-[13px] font-bold text-white disabled:opacity-50" style={{ background: MASTERS_INK }}>
              <Lock size={14} aria-hidden /> Lock month
            </button>
          )}
          {p.canLock && status === "locked" && (
            <button type="button" disabled={busy} onClick={() => lock(false)} className="inline-flex h-9 items-center gap-1.5 rounded-pill border border-hairline-strong bg-white px-4 text-[13px] font-bold text-ink-strong disabled:opacity-50">
              <LockOpen size={14} aria-hidden /> Reopen
            </button>
          )}
        </span>
      </div>

      {message && (
        <div role={message.tone === "bad" ? "alert" : "status"} className="rounded-section bg-white px-4 py-3 text-[13px]" style={{ ...CARD, borderColor: message.tone === "bad" ? "#FCA5A5" : undefined }}>
          <p className="font-semibold text-ink-strong">{message.text}</p>
          {!!message.list?.length && (
            <ul className="mt-1 list-disc pl-5 text-ink-muted">
              {message.list.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {!message && !!p.latestProblems.length && (
        <div role="alert" className="rounded-section bg-white px-4 py-3 text-[13px]" style={CARD}>
          <p className="font-semibold text-ink-strong">The latest calculation was blocked:</p>
          <ul className="mt-1 list-disc pl-5 text-ink-muted">
            {p.latestProblems.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </div>
      )}

      {!p.current ? (
        <p className="rounded-section bg-white p-5 text-[13.5px] text-ink-muted" style={CARD}>
          No calculation adopted for this month yet.
        </p>
      ) : (
        <section aria-label="Adopted calculation" className="rounded-section bg-white p-4" style={CARD}>
          <p className="text-[12.5px] text-ink-muted">
            Configuration version {p.current.configVersionNo} · as of {p.current.asOf} · by {p.current.computedByName} · <span className="font-mono">{p.current.inputsHash.slice(0, 12)}</span>
          </p>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-[12.5px]" style={{ minWidth: 720 }}>
              <thead>
                <tr className="text-left text-ink-subtle">
                  {["Salesperson", "Sales", "Qualifies", "Earned", "Payable", "Pending", "Not yet received"].map((h) => (
                    <th key={h} className="px-2 py-1 font-semibold">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {p.current.results.map((r) => (
                  <tr key={r.employeeName} className="border-t border-hairline align-top">
                    <td className="px-2 py-1.5 font-semibold text-ink-strong">
                      {r.employeeName}
                      <details className="mt-1 font-normal text-ink-muted">
                        <summary className="cursor-pointer text-[12px]">Why</summary>
                        <ul className="list-disc pl-4">
                          {r.explanation.map((x, i) => (
                            <li key={i}>{x}</li>
                          ))}
                        </ul>
                      </details>
                    </td>
                    <td className="px-2 py-1.5 tabular-nums">{rs(r.salesPaise)}</td>
                    <td className="px-2 py-1.5">{r.qualified ? "Yes" : "No"}</td>
                    <td className="px-2 py-1.5 tabular-nums">{rs(r.earnedPaise)}</td>
                    <td className="px-2 py-1.5 font-semibold tabular-nums text-ink-strong">{rs(r.payablePaise)}</td>
                    <td className="px-2 py-1.5 tabular-nums">{rs(r.pendingPaise)}</td>
                    <td className="px-2 py-1.5 tabular-nums">{rs(r.projectedPaise)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <details className="mt-3">
            <summary className="cursor-pointer text-[13px] font-semibold text-ink-strong">Orders ({p.current.orders.length})</summary>
            <div className="mt-1 overflow-x-auto">
              <table className="w-full text-[12.5px]" style={{ minWidth: 760 }} aria-label="Orders">
                <thead>
                  <tr className="text-left text-ink-subtle">
                    {["Sales Order", "Salesperson", "Counted value", "To collect", "Collected", "Status"].map((h) => (
                      <th key={h} className="px-2 py-1 font-semibold">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {p.current.orders.map((o) => (
                    <tr key={o.id} className="border-t border-hairline align-top">
                      <td className="px-2 py-1.5 font-semibold text-ink-strong">
                        {o.documentNo}
                        <details className="font-normal text-ink-muted">
                          <summary className="cursor-pointer text-[11.5px]">Why</summary>
                          {o.explanation.join(" ")}
                        </details>
                      </td>
                      <td className="px-2 py-1.5">{o.employeeName ?? "—"}</td>
                      <td className="px-2 py-1.5 tabular-nums">{rs(o.valuePaise)}</td>
                      <td className="px-2 py-1.5 tabular-nums">{rs(o.collectiblePaise)}</td>
                      <td className="px-2 py-1.5 tabular-nums">{rs(o.collectedPaise)}</td>
                      <td className="px-2 py-1.5">{o.fullyCollected ? "Fully collected" : <span className="font-semibold text-[#B45309]">Not fully collected — not payable yet</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
          <details className="mt-2">
            <summary className="cursor-pointer text-[13px] font-semibold text-ink-strong">Receipts — each at its own delay ({p.current.receipts.length})</summary>
            <div className="mt-1 overflow-x-auto">
              <table className="w-full text-[12.5px]" style={{ minWidth: 900 }} aria-label="Receipts">
                <thead>
                  <tr className="text-left text-ink-subtle">
                    {["Receipt", "Date", "Applied to", "Salesperson", "Amount", "Delay", "Step", "Status"].map((h) => (
                      <th key={h} className="px-2 py-1 font-semibold">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {p.current.receipts.map((r) => (
                    <tr key={r.id} className="border-t border-hairline align-top">
                      <td className="px-2 py-1.5 font-semibold text-ink-strong">
                        {r.receiptNo}
                        <span className="block text-[11.5px] font-normal text-ink-muted">{r.note}</span>
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5">{r.receiptDate}</td>
                      <td className="px-2 py-1.5">{r.invoiceNo ? `${r.invoiceNo}${r.unitNo && r.unitNo !== r.invoiceNo ? ` (${r.unitNo})` : ""}` : "—"}</td>
                      <td className="px-2 py-1.5">{r.employeeName ?? "—"}</td>
                      <td className="px-2 py-1.5 tabular-nums">{rs(r.amountPaise)}</td>
                      <td className="px-2 py-1.5 tabular-nums">{r.delayDays !== null ? `${r.delayDays} days` : "—"}</td>
                      <td className="px-2 py-1.5 tabular-nums">{r.multiplierPpm !== null ? `${r.multiplierPpm / 10_000}%` : "—"}</td>
                      <td className="px-2 py-1.5">{r.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </section>
      )}

      {p.workflow && <CalcWorkflow {...p.workflow} />}

      {!!p.adjustmentsIn.length && (
        <section aria-label="Carried into this month" className="rounded-section bg-white p-4 text-[12.5px]" style={CARD}>
          <h2 className="text-[14px] font-bold text-ink-strong">Carried into this month</h2>
          <ul className="mt-1 grid gap-1 text-ink-muted">
            {p.adjustmentsIn.map((a) => (
              <li key={a.id}>
                {a.employeeName}: {rs(a.amountPaise)} from {a.fromMonth.slice(0, 7)} ({a.kind}). {a.note}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-label="Calculation history" className="rounded-section bg-white p-4" style={CARD}>
        <h2 className="text-[14px] font-bold text-ink-strong">Every calculation of this month</h2>
        {!p.runs.length ? (
          <p className="mt-1 text-[12.5px] text-ink-subtle">None yet.</p>
        ) : (
          <ul className="mt-1 grid gap-1 text-[12.5px] text-ink-muted">
            {p.runs.map((r) => (
              <li key={r.id}>
                {new Date(r.computedAt).toLocaleString("en-IN")} · {r.computedByName} · {r.status}
                {r.configVersionNo ? ` · version ${r.configVersionNo}` : ""} · as of {r.asOf}
                {r.adopted ? " · adopted" : ""} — {r.outcome}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
