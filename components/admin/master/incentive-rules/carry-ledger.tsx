"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { fireToast } from "@/lib/toast";
import { writeOffCategoryCarry } from "@/app/(masters)/master-setup/incentive-rules/calculation/actions";
import { CARD, RetireButton, day, rs } from "./calc-ui";
import type { CarryBalance } from "@/lib/queries/incentive-calc";

/**
 * The below-minimum carry-forward ledger (0136): every balance held because a month's total was below the smallest
 * amount paid, what is left of it, and what happened to it — released, offset against a recovery, expired, or written
 * off (with who and why). A write-off needs the Record payout right and a reason; the server checks both again.
 */
const KIND: Record<string, string> = { released: "Released", offset: "Offset against a recovery", expired: "Expired", "written-off": "Written off" };

export function CarryLedger({ balances, canWriteOff }: { balances: CarryBalance[]; canWriteOff: boolean }) {
  const router = useRouter();
  if (!balances.length) return null;
  const writeOff = async (lotId: string, reason: string) => {
    const r = await writeOffCategoryCarry({ lotId, reason });
    if (!r.ok) fireToast({ message: r.error, type: "error" });
    else fireToast({ message: `Written off: ${rs(r.amountPaise)}. It stays in the ledger with your reason.`, type: "success" });
    router.refresh();
  };
  return (
    <section aria-label="Carried-forward balances" className="mt-4 rounded-section bg-white p-4" style={CARD}>
      <h2 className="text-[14px] font-bold text-ink-strong">Carried-forward balances ({balances.filter((b) => b.remainingPaise > 0).length} open)</h2>
      <p className="mt-0.5 text-[12.5px] text-ink-muted">A month whose total is below the smallest amount paid is held here and added to the following months until the smallest amount is reached; nothing is released twice.</p>
      <table className="mt-2 w-full text-[12.5px]">
        <thead>
          <tr className="text-left text-ink-subtle">
            <th className="py-1 pr-2 font-semibold">Salesperson</th>
            <th className="py-1 pr-2 font-semibold">Held in</th>
            <th className="py-1 pr-2 text-right font-semibold">Held</th>
            <th className="py-1 pr-2 text-right font-semibold">Left</th>
            <th className="py-1 pr-2 font-semibold">What happened</th>
            <th className="py-1" />
          </tr>
        </thead>
        <tbody>
          {balances.map((b) => (
            <tr key={b.lotId} className="border-t border-hairline align-top">
              <td className="py-1.5 pr-2 text-ink-strong">{b.employeeName}</td>
              <td className="py-1.5 pr-2">{b.month.slice(0, 7)}</td>
              <td className="py-1.5 pr-2 text-right tabular-nums">{rs(b.heldPaise)}</td>
              <td className="py-1.5 pr-2 text-right font-semibold tabular-nums">{rs(b.remainingPaise)}</td>
              <td className="py-1.5 pr-2 text-ink-muted">
                {b.entries.length
                  ? b.entries.map((e, i) => (
                      <div key={i}>
                        {KIND[e.kind] ?? e.kind} in {e.month.slice(0, 7)}: {rs(-e.amountPaise)} ({e.byName}, {day(e.at)}){e.reason ? ` — “${e.reason}”` : ""}
                      </div>
                    ))
                  : "Carried forward"}
              </td>
              <td className="py-1.5 text-right">{canWriteOff && b.remainingPaise > 0 && <RetireButton label={`Write off ${b.employeeName}'s balance from ${b.month.slice(0, 7)}`} onRetire={(reason) => writeOff(b.lotId, reason)} />}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
