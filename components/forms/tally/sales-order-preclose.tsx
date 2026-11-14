"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { DateField } from "@/components/ui/date-field";
import { Card, fmtDay, fmtWhen } from "@/components/forms/tally/ui";
import { deliveryState, preClosuresOf, type PreClosure, type SoDelivery } from "@/lib/tally/sales-order-preclose";
import type { PreCloseResult } from "@/lib/queries/sales-order-preclosures";
import { preCloseDelivery } from "@/app/(forms-module)/forms/documents/[type]/[id]/actions";

/**
 * Forms → Sales Orders → an order: its deliveries (item allocations) with what is pre-closed and still open on each,
 * every pre-closure ever recorded (who, when, how much, why), and — for someone allowed to — "Pre-close" on a delivery
 * that still has something open: the matrix's "Update" fields (Pre-Close Quantity, Reason for Pre-Close, Pre-Close
 * Date), labelled as Admin & Master Setup → Sales Order Fields says.
 *
 * The order itself is never changed and no pre-closure can be edited or removed. Each opening of the form is one
 * submission (its own request id): sending it twice records it once. The server decides; the checks here only help.
 */

export interface PreCloseLabels {
  quantity: string;
  reason: string;
  date: string;
  reasonRequired: boolean;
}

type PreCloseSubmission = Parameters<typeof preCloseDelivery>[0];

export function SalesOrderPreClose({
  documentId,
  deliveries,
  records,
  ready,
  canPreClose,
  cancelled,
  labels,
  record = preCloseDelivery as (input: PreCloseSubmission) => Promise<PreCloseResult>,
}: {
  documentId: string;
  deliveries: SoDelivery[];
  records: PreClosure[];
  /** False while migration 0129 isn't applied. */
  ready: boolean;
  canPreClose: boolean;
  cancelled: boolean;
  labels: PreCloseLabels;
  record?: (input: PreCloseSubmission) => Promise<PreCloseResult>;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState<{ d: SoDelivery; requestId: string; expectedCount: number } | null>(null);
  const [form, setForm] = React.useState({ quantity: "", reason: "", date: "" });
  const [busy, setBusy] = React.useState(false);
  const [problem, setProblem] = React.useState<string | null>(null);
  const [done, setDone] = React.useState<string | null>(null);

  if (!deliveries.length) return null;
  const qty = (n: number) => n.toLocaleString("en-IN", { maximumFractionDigits: 6 });

  function start(d: SoDelivery) {
    setProblem(null);
    setDone(null);
    setForm({ quantity: "", reason: "", date: "" });
    // One request id per opening: a second click or a retry of this same submission can't record twice.
    setOpen({ d, requestId: crypto.randomUUID(), expectedCount: preClosuresOf(records, d).length });
  }

  async function submit() {
    if (!open || busy) return;
    const missing = [!form.quantity.trim() && labels.quantity, labels.reasonRequired && !form.reason.trim() && labels.reason, !form.date.trim() && labels.date].filter(Boolean);
    if (missing.length) return setProblem(`${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} required.`);
    setBusy(true);
    setProblem(null);
    try {
      const res = await record({ documentId, requestId: open.requestId, lineNo: open.d.lineNo, allocationNo: open.d.allocationNo, quantity: form.quantity, reason: form.reason, date: form.date, expectedCount: open.expectedCount });
      if (!res.ok) return setProblem(res.error);
      setDone(res.repeated ? "That pre-closure was already recorded; it wasn't recorded again." : `Pre-closed ${qty(res.record.quantity)} ${open.d.ratePer} of ${open.d.item}.`);
      setOpen(null);
      router.refresh();
    } catch {
      setProblem("The pre-closure could not be recorded. Nothing was changed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mt-4">
      <h2 className="mb-1 font-bold text-ink-strong" style={{ fontSize: 15 }}>
        Deliveries and pre-closures
      </h2>
      <p className="mb-2 text-[12.5px] text-ink-muted">
        Each delivery&apos;s Billed Quantity, what has been pre-closed on it and what is still open. The order itself never changes; every pre-closure is kept with who recorded it.
      </p>
      {!ready && (
        <p role="status" className="mb-2 rounded-md px-3 py-2 text-[12.5px] text-ink-muted" style={{ background: "var(--color-amber-bg)" }}>
          Pre-closing needs database update 0129, which isn&apos;t applied yet.
        </p>
      )}
      {done && (
        <p role="status" className="mb-2 rounded-md px-3 py-2 text-[12.5px] font-semibold text-[#047857]" style={{ background: "#ECFDF5" }}>
          {done}
        </p>
      )}
      <div className="overflow-x-auto">
        <table aria-label="Deliveries and pre-closures" className="w-full text-[12.5px]" style={{ minWidth: 760 }}>
          <thead>
            <tr className="text-left text-ink-subtle">
              <th className="px-2 py-1 font-semibold">Delivery</th>
              <th className="px-2 py-1 font-semibold">Item</th>
              <th className="px-2 py-1 font-semibold">Due</th>
              <th className="px-2 py-1 font-semibold text-right">Billed Quantity</th>
              <th className="px-2 py-1 font-semibold text-right">Pre-closed</th>
              <th className="px-2 py-1 font-semibold text-right">Open</th>
              <th className="px-2 py-1 font-semibold" />
            </tr>
          </thead>
          <tbody>
            {deliveries.map((d) => {
              const s = deliveryState(d, records);
              const history = preClosuresOf(records, d);
              const name = `${d.lineNo}.${d.allocationNo}`;
              return (
                <React.Fragment key={name}>
                  <tr className="border-t border-hairline align-top">
                    <td className="px-2 py-1 tabular-nums">{name}</td>
                    <td className="px-2 py-1 text-ink-strong">{d.item}</td>
                    <td className="whitespace-nowrap px-2 py-1">{fmtDay(d.dueDate)}</td>
                    <td className="px-2 py-1 text-right tabular-nums">
                      {qty(d.quantity)} {d.ratePer}
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums">{s.preClosed ? `${qty(s.preClosed)} ${d.ratePer}` : "—"}</td>
                    <td className="px-2 py-1 text-right font-semibold tabular-nums">
                      {qty(s.open)} {d.ratePer}
                    </td>
                    <td className="whitespace-nowrap px-2 py-1 text-right">
                      {canPreClose && ready && !cancelled && s.open > 0 && (
                        <button type="button" aria-label={`Pre-close delivery ${name}`} disabled={busy} onClick={() => start(d)} className="rounded-md px-2 py-1 text-[12px] font-bold text-[#0B4FB8] hover:bg-[#EFF6FF] disabled:opacity-50">
                          Pre-close
                        </button>
                      )}
                    </td>
                  </tr>
                  {history.map((p) => (
                    <tr key={p.id} className="text-[12px] text-ink-muted">
                      <td />
                      <td colSpan={6} className="px-2 pb-1">
                        Pre-closed {qty(p.quantity)} {d.ratePer} on {fmtDay(p.precloseDate)}
                        {p.reason ? ` — ${p.reason}` : ""} · recorded by {p.recordedBy}, {fmtWhen(p.recordedAt)}
                      </td>
                    </tr>
                  ))}
                  {open && open.d.lineNo === d.lineNo && open.d.allocationNo === d.allocationNo && (
                    <tr>
                      <td colSpan={7} className="px-2 pb-3">
                        <div role="group" aria-label={`Pre-close delivery ${name}`} className="rounded-lg p-3" style={{ background: "#F6F8FB", border: "1px solid var(--color-hairline)" }}>
                          <p className="mb-2 text-[12.5px] text-ink-muted">
                            {d.item}, due {fmtDay(d.dueDate)} · open {qty(s.open)} {d.ratePer}
                          </p>
                          <div className="grid grid-cols-[160px_1fr_170px] max-sm:grid-cols-1 gap-2">
                            <label className="grid gap-1 text-[12px] font-semibold text-ink-muted">
                              <span>
                                {labels.quantity} <span className="text-[#B91C1C]">*</span>
                              </span>
                              <input aria-label={labels.quantity} inputMode="decimal" placeholder={`Up to ${qty(s.open)}`} className="h-9 rounded-lg border border-hairline-strong bg-white px-2.5 text-[13px]" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} disabled={busy} />
                            </label>
                            <label className="grid gap-1 text-[12px] font-semibold text-ink-muted">
                              <span>
                                {labels.reason} {labels.reasonRequired && <span className="text-[#B91C1C]">*</span>}
                              </span>
                              <input aria-label={labels.reason} maxLength={500} className="h-9 rounded-lg border border-hairline-strong bg-white px-2.5 text-[13px]" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} disabled={busy} />
                            </label>
                            <label className="grid gap-1 text-[12px] font-semibold text-ink-muted">
                              <span>
                                {labels.date} <span className="text-[#B91C1C]">*</span>
                              </span>
                              <DateField aria-label={labels.date} className="h-9 rounded-lg border border-hairline-strong bg-white px-2.5 text-[13px] tabular-nums" value={form.date} onChange={(x) => setForm({ ...form, date: x })} disabled={busy} />
                            </label>
                          </div>
                          {problem && (
                            <p role="alert" className="mt-2 text-[12.5px] font-semibold text-[#B91C1C]">
                              {problem}
                            </p>
                          )}
                          <div className="mt-2 flex items-center justify-end gap-2">
                            <button type="button" onClick={() => setOpen(null)} disabled={busy} className="h-8 rounded-lg border border-hairline-strong bg-white px-3 text-[12.5px] font-semibold text-ink-strong">
                              Cancel
                            </button>
                            <button type="button" onClick={() => void submit()} disabled={busy} className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[12.5px] font-bold text-white disabled:opacity-50" style={{ background: "#0B4FB8" }}>
                              {busy && <Loader2 size={13} className="animate-spin" aria-hidden />}
                              Record pre-closure
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
