"use client";

import * as React from "react";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { recordRepresentativePeriod, retireIncentiveInput } from "@/app/(masters)/master-setup/incentive-rules/calculation/input-actions";
import { BLUE, BTN, CARD, FIELD, Notice, NotReady, RetireButton, day } from "./calc-ui";

/**
 * Representatives: who represented each Customer Master customer, and when — for Category A when its configuration
 * credits a sale to "the representative on the order's date". The Customer Master keeps only the current
 * representative; these periods are its history. Periods of one customer never overlap (the database refuses it); a
 * period is never edited, only retired with a reason and replaced.
 */

export interface RepresentativesProps {
  ready: boolean;
  canEdit: boolean;
  rows: { id: string; name: string; code: string | null; currentRepName: string | null; periods: { id: string; employeeName: string; from: string; to: string | null; note: string | null; createdAt: string; retiredAt: string | null; retiredReason: string | null }[] }[];
  truncated: boolean;
  employees: { id: string; name: string }[];
  filters: { search: string; filter: "all" | "missing" | "recorded" };
}

export function Representatives(p: RepresentativesProps) {
  const router = useRouter();
  const [msg, setMsg] = React.useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [adding, setAdding] = React.useState<string | null>(null);
  const [form, setForm] = React.useState({ employeeId: "", from: "", to: "", note: "" });
  const [busy, setBusy] = React.useState(false);
  const [f, setF] = React.useState(p.filters);
  if (!p.ready) return <NotReady />;

  async function save(customerId: string) {
    setBusy(true);
    const r = await recordRepresentativePeriod({ customerId, employeeId: form.employeeId, from: form.from, to: form.to || null, note: form.note.trim() || null });
    setBusy(false);
    if (!r.ok) return setMsg({ tone: "bad", text: r.error });
    setMsg({ tone: "ok", text: "Representative period recorded." });
    setAdding(null);
    router.refresh();
  }
  async function retire(id: string, reason: string) {
    const r = await retireIncentiveInput({ entity: "rep-history", id, reason });
    setMsg(r.ok ? { tone: "ok", text: "Period retired; it stays in the history." } : { tone: "bad", text: r.error });
    if (r.ok) router.refresh();
  }

  return (
    <div className="grid gap-3">
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          router.push(`/master-setup/incentive-rules/calculation/representatives?${new URLSearchParams(Object.entries(f).filter(([, v]) => v) as [string, string][])}` as Route);
        }}
      >
        <input className={`${FIELD} w-64`} placeholder="Customer name or code" value={f.search} onChange={(e) => setF({ ...f, search: e.target.value })} aria-label="Search customers" />
        <select className={FIELD} value={f.filter} onChange={(e) => setF({ ...f, filter: e.target.value as typeof f.filter })} aria-label="Show">
          <option value="all">All customers</option>
          <option value="missing">No period recorded</option>
          <option value="recorded">With periods</option>
        </select>
        <button type="submit" className={BTN} style={{ background: BLUE }}>
          Search
        </button>
      </form>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      <div className="overflow-x-auto rounded-section bg-white" style={CARD}>
        <table className="w-full text-[12.5px]" style={{ minWidth: 820 }} aria-label="Customers and their representatives">
          <thead>
            <tr className="text-left text-ink-subtle">
              {["Customer", "Current (Customer Master)", "Periods"].map((h) => (
                <th key={h} className="px-3 py-2 font-semibold">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!p.rows.length && (
              <tr>
                <td colSpan={3} className="px-3 py-4 text-ink-muted">
                  No customer matches.
                </td>
              </tr>
            )}
            {p.rows.map((c) => {
              const active = c.periods.filter((x) => !x.retiredAt);
              const retired = c.periods.filter((x) => x.retiredAt);
              return (
                <tr key={c.id} className="border-t border-hairline align-top" aria-label={`Customer ${c.name}`}>
                  <td className="px-3 py-2 font-semibold text-ink-strong">
                    {c.name}
                    {c.code && <span className="ml-1 font-mono text-[11px] text-ink-subtle">{c.code}</span>}
                  </td>
                  <td className="px-3 py-2">{c.currentRepName ?? <span className="text-ink-subtle">None</span>}</td>
                  <td className="px-3 py-2">
                    {!active.length && <span className="text-[12px] font-semibold text-[#B45309]">No period recorded</span>}
                    <ul className="grid gap-1">
                      {active.map((x) => (
                        <li key={x.id} className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-ink-strong">{x.employeeName}</span>
                          <span>
                            {day(x.from)} – {x.to ? day(x.to) : "open"}
                          </span>
                          {x.note && <span className="text-[11.5px] text-ink-subtle">{x.note}</span>}
                          {p.canEdit && <RetireButton label={`${x.employeeName} for ${c.name}`} onRetire={(why) => retire(x.id, why)} />}
                        </li>
                      ))}
                    </ul>
                    {!!retired.length && (
                      <details className="mt-1 text-[11.5px] text-ink-subtle">
                        <summary className="cursor-pointer">History ({retired.length} retired)</summary>
                        <ul>
                          {retired.map((x) => (
                            <li key={x.id}>
                              {x.employeeName} {day(x.from)} – {x.to ? day(x.to) : "open"} — retired {day(x.retiredAt)}: {x.retiredReason}
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                    {p.canEdit &&
                      (adding === c.id ? (
                        <div className="mt-1 flex flex-wrap items-center gap-1">
                          <select className={FIELD} value={form.employeeId} onChange={(e) => setForm({ ...form, employeeId: e.target.value })} aria-label={`Representative for ${c.name}`}>
                            <option value="">Choose a representative…</option>
                            {p.employees.map((e) => (
                              <option key={e.id} value={e.id}>
                                {e.name}
                              </option>
                            ))}
                          </select>
                          <input type="date" className={FIELD} value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} aria-label={`From for ${c.name}`} />
                          <span>–</span>
                          <input type="date" className={FIELD} value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} aria-label={`To for ${c.name} (empty = open)`} />
                          <input className={`${FIELD} w-40`} placeholder="Note (optional)" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} aria-label={`Note for ${c.name}`} maxLength={1000} />
                          <button type="button" disabled={busy || !form.employeeId || !form.from} className={BTN} style={{ background: BLUE }} onClick={() => save(c.id)}>
                            Record
                          </button>
                          <button type="button" className="text-[12px] text-ink-muted" onClick={() => setAdding(null)}>
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button type="button" className="mt-1 text-[12px] font-semibold text-[#0B4FB8]" onClick={() => (setAdding(c.id), setForm({ employeeId: "", from: "", to: "", note: "" }))}>
                          + Add period
                        </button>
                      ))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {p.truncated && <p className="text-[12px] text-ink-subtle">Showing the first {p.rows.length}; narrow the search to see others.</p>}
    </div>
  );
}
