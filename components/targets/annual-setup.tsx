"use client";

import * as React from "react";
import { toast } from "sonner";
import { RefreshCw, Save } from "lucide-react";
import { formatInrCompactPaise } from "@/lib/format";
import { growthSplit } from "@/lib/targets/period";
import type { RepAllocationRow } from "@/lib/queries/targets";
import {
  allocateTarget,
  redivideTargets,
  setCompanyTarget,
  setGrowthSplit,
} from "@/app/(targets-module)/targets/actions";
import { GhostButton, Money, PrimaryButton, RupeeInput, StatTile } from "./ui";

/**
 * The annual screen: one company number, allocated across the team.
 *
 * The **Gap** column is the reason this module is top-down. A rep whose
 * customer rows add up to less than their allocation is visible in April, not
 * in March when nothing can be done about it.
 */
export function AnnualSetup({
  fyStartYear,
  fyLabel,
  companyTargetPaise,
  orgExistingPct,
  reps,
  isAdmin,
}: {
  fyStartYear: number;
  fyLabel: string;
  companyTargetPaise: number;
  orgExistingPct: number;
  reps: RepAllocationRow[];
  isAdmin: boolean;
}) {
  const toRupees = (paise: number) => (paise === 0 ? "" : String(Math.round(paise / 100)));

  const [company, setCompany] = React.useState(toRupees(companyTargetPaise));
  const [split, setSplit] = React.useState(String(orgExistingPct));
  const [alloc, setAlloc] = React.useState<Record<string, string>>(() =>
    Object.fromEntries(reps.map((r) => [r.employeeId, toRupees(r.allocatedPaise)])),
  );
  const [pending, start] = React.useTransition();

  const lastYearTotal = reps.reduce((s, r) => s + r.lastYearPaise, 0);
  const allocatedTotal = reps.reduce((s, r) => s + r.allocatedPaise, 0);
  const plannedTotal = reps.reduce((s, r) => s + r.plannedPaise, 0);
  const orgSplit = growthSplit(companyTargetPaise, lastYearTotal, orgExistingPct);

  function saveCompany() {
    start(async () => {
      const res = await setCompanyTarget({ fyStartYear, targetRupees: company || 0 });
      if (res.ok) toast.success("Company target saved — quarters, months and weeks seeded.");
      else toast.error(res.error);
    });
  }

  function saveSplit() {
    start(async () => {
      const res = await setGrowthSplit({ fyStartYear, employeeId: null, existingPct: split });
      if (res.ok) toast.success("Growth split saved.");
      else toast.error(res.error);
    });
  }

  function saveAlloc(employeeId: string) {
    start(async () => {
      const res = await allocateTarget({
        fyStartYear,
        employeeId,
        targetRupees: alloc[employeeId] || 0,
      });
      if (res.ok) toast.success("Allocation saved.");
      else toast.error(res.error);
    });
  }

  function redivide(employeeId: string | null) {
    if (!confirm("Re-seed every quarter, month and week from the annual number? Values typed by hand will be replaced.")) return;
    start(async () => {
      const res = await redivideTargets({ fyStartYear, employeeId });
      if (res.ok) toast.success("Re-divided.");
      else toast.error(res.error);
    });
  }

  return (
    <>
      <div className="grid gap-3 mb-5" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))" }}>
        {/* For a rep this tile holds THEIR allocation — the page never receives
            the company figure unless the viewer is an admin. */}
        <StatTile
          label={isAdmin ? "Company target" : "My target"}
          paise={companyTargetPaise}
          tone="target"
          sub={fyLabel}
        />
        <StatTile
          label="From existing"
          paise={orgSplit.existingPaise}
          tone="forecast"
          sub={`${orgSplit.existingPct}% of growth`}
        />
        <StatTile
          label="From new business"
          paise={orgSplit.newPaise}
          tone="estimated"
          sub={`${orgSplit.newPct}% of growth`}
        />
        <StatTile
          label={isAdmin ? "Planned by the team" : "Planned by me"}
          paise={plannedTotal}
          tone="actual"
          sub={
            companyTargetPaise > 0
              ? `${Math.round((plannedTotal / companyTargetPaise) * 100)}% of target`
              : "no target set"
          }
        />
      </div>

      {isAdmin && (
        <div className="rounded-section border border-hairline bg-surface-card px-4 py-3.5 mb-5 flex items-end gap-4 flex-wrap">
          <label className="block">
            <span className="block uppercase font-bold tracking-[0.08em] text-ink-subtle mb-1" style={{ fontSize: 10.5 }}>
              Company target for {fyLabel}
            </span>
            <RupeeInput value={company} onChange={setCompany} placeholder="120000000" width={170} />
          </label>
          <PrimaryButton onClick={saveCompany} disabled={pending}>
            <Save size={14} strokeWidth={2.5} />
            Save target
          </PrimaryButton>

          <label className="block ml-2">
            <span className="block uppercase font-bold tracking-[0.08em] text-ink-subtle mb-1" style={{ fontSize: 10.5 }}>
              Growth from existing customers
            </span>
            <span className="inline-flex items-center gap-1">
              <input
                value={split}
                inputMode="numeric"
                onChange={(e) => setSplit(e.target.value)}
                className="rounded-chip px-2 h-9 bg-surface-soft border border-hairline outline-none text-[13.5px] text-ink-strong tabular-nums"
                style={{ width: 64 }}
              />
              <span className="text-ink-subtle" style={{ fontSize: 13 }}>
                % · new business takes the rest
              </span>
            </span>
          </label>
          <GhostButton onClick={saveSplit} disabled={pending}>
            Save split
          </GhostButton>

          <div className="ml-auto">
            <GhostButton
              onClick={() => redivide(null)}
              disabled={pending}
              title="Re-seed the company's quarters, months and weeks"
            >
              <RefreshCw size={14} strokeWidth={2.4} />
              Re-divide company
            </GhostButton>
          </div>
        </div>
      )}

      <div className="rounded-section border border-hairline bg-surface-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full" style={{ minWidth: 860 }}>
            <thead>
              <tr
                className="text-left uppercase tracking-[0.08em]"
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  background: "color-mix(in srgb, var(--color-blue) 8%, var(--color-surface-soft))",
                  color: "var(--color-ink-soft)",
                }}
              >
                <th className="px-4 py-3">Salesperson</th>
                <th className="px-4 py-3 text-right">Last FY</th>
                <th className="px-4 py-3 text-right">Allocated</th>
                <th className="px-4 py-3 text-right">Existing</th>
                <th className="px-4 py-3 text-right">New</th>
                <th className="px-4 py-3 text-right">Planned</th>
                <th className="px-4 py-3 text-right">Gap</th>
                {isAdmin && <th className="px-4 py-3" />}
              </tr>
            </thead>
            <tbody>
              {reps.map((r) => {
                const s = growthSplit(r.allocatedPaise, r.lastYearPaise, r.existingPct);
                const gap = r.plannedPaise - r.allocatedPaise;
                return (
                  <tr key={r.employeeId} className="border-t" style={{ borderColor: "var(--color-hairline)" }}>
                    <td className="px-4 py-2.5">
                      <strong className="text-ink-strong" style={{ fontSize: 14 }}>
                        {r.name}
                      </strong>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <Money paise={r.lastYearPaise} />
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {isAdmin ? (
                        <RupeeInput
                          value={alloc[r.employeeId] ?? ""}
                          onChange={(v) => setAlloc((p) => ({ ...p, [r.employeeId]: v }))}
                          disabled={pending}
                          width={120}
                        />
                      ) : (
                        <Money paise={r.allocatedPaise} bold />
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <Money paise={s.existingPaise} />
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <Money paise={s.newPaise} />
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <Money paise={r.plannedPaise} bold />
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {r.allocatedPaise === 0 ? (
                        <span className="text-ink-subtle">—</span>
                      ) : (
                        <span
                          className="font-semibold tabular-nums whitespace-nowrap"
                          style={{
                            fontSize: 13,
                            color: gap >= 0 ? "var(--color-green-deep)" : "var(--color-red-deep)",
                          }}
                        >
                          {gap >= 0 ? "+" : "−"}
                          {formatInrCompactPaise(Math.abs(gap))}
                        </span>
                      )}
                    </td>
                    {isAdmin && (
                      <td className="px-4 py-2.5">
                        <div className="flex items-center justify-end gap-1.5">
                          <GhostButton onClick={() => saveAlloc(r.employeeId)} disabled={pending} title="Save allocation">
                            <Save size={13} strokeWidth={2.4} />
                          </GhostButton>
                          <GhostButton
                            onClick={() => redivide(r.employeeId)}
                            disabled={pending}
                            title="Re-divide this rep's year"
                          >
                            <RefreshCw size={13} strokeWidth={2.4} />
                          </GhostButton>
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr
                className="border-t"
                style={{ borderColor: "var(--color-hairline)", background: "var(--color-surface-soft)" }}
              >
                <td className="px-4 py-3 font-bold text-ink-strong" style={{ fontSize: 13.5 }}>
                  Total
                </td>
                <td className="px-4 py-3 text-right"><Money paise={lastYearTotal} /></td>
                <td className="px-4 py-3 text-right"><Money paise={allocatedTotal} bold /></td>
                <td className="px-4 py-3 text-right"><Money paise={orgSplit.existingPaise} /></td>
                <td className="px-4 py-3 text-right"><Money paise={orgSplit.newPaise} /></td>
                <td className="px-4 py-3 text-right"><Money paise={plannedTotal} bold /></td>
                <td className="px-4 py-3 text-right">
                  {/* Allocated vs the company number — the two can legitimately
                      differ while an admin is still handing out slices. */}
                  {companyTargetPaise > 0 && allocatedTotal !== companyTargetPaise && (
                    <span
                      className="font-semibold tabular-nums"
                      style={{ fontSize: 12.5, color: "var(--color-amber-deep)" }}
                    >
                      {formatInrCompactPaise(Math.abs(companyTargetPaise - allocatedTotal))}{" "}
                      {allocatedTotal < companyTargetPaise ? "unallocated" : "over"}
                    </span>
                  )}
                </td>
                {isAdmin && <td />}
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </>
  );
}
