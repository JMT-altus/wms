"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { fireToast } from "@/lib/toast";
import { decideCategoryCarryWriteOff, writeOffCategoryCarry } from "@/app/(masters)/master-setup/incentive-rules/calculation/actions";
import { BTN, BTN_PLAIN, CARD, FIELD, day, rs } from "./calc-ui";
import type { CarryBalance } from "@/lib/queries/incentive-calc";

/**
 * The below-minimum carry-forward ledger (0136): every balance held because a month's total was below the smallest
 * amount paid, what is left of it, and what happened to it — released, offset against a recovery, expired, or written
 * off (with who and why). A write-off takes TWO people (0141): one requests it with a reason, a second approves or
 * refuses it with a reason; both need the Record payout right, and the server checks every step again.
 */
const KIND: Record<string, string> = { released: "Released", offset: "Offset against a recovery", expired: "Expired", "written-off": "Written off" };
const WO: Record<string, string> = { request: "Write-off requested", approve: "Write-off approved", refuse: "Write-off refused" };

/** A button that asks for a reason before it acts. */
function WithReason({ label, action, tone = "plain", onSubmit }: { label: string; action: string; tone?: "plain" | "go" | "stop"; onSubmit: (reason: string) => Promise<boolean> }) {
  const [open, setOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const bg = tone === "go" ? "#047857" : tone === "stop" ? "#B91C1C" : undefined;
  if (!open)
    return (
      <button type="button" className={bg ? BTN : BTN_PLAIN} style={bg ? { background: bg } : undefined} onClick={() => setOpen(true)} aria-label={`${action}: ${label}`}>
        {action}
      </button>
    );
  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-1">
      <input className={`${FIELD} w-56`} placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} aria-label={`Reason — ${action}: ${label}`} maxLength={1000} />
      <button
        type="button"
        disabled={busy || !reason.trim()}
        className={BTN}
        style={{ background: bg ?? "#0B4FB8" }}
        onClick={async () => {
          setBusy(true);
          const ok = await onSubmit(reason.trim());
          setBusy(false);
          if (ok) {
            setOpen(false);
            setReason("");
          }
        }}
      >
        Confirm
      </button>
      <button type="button" className={BTN_PLAIN} onClick={() => setOpen(false)}>
        Cancel
      </button>
    </span>
  );
}

export function CarryLedger({ balances, canWriteOff, me }: { balances: CarryBalance[]; canWriteOff: boolean; me?: string }) {
  const router = useRouter();
  if (!balances.length) return null;
  const request = async (lotId: string, reason: string) => {
    const r = await writeOffCategoryCarry({ lotId, reason });
    if (!r.ok) fireToast({ message: r.error, type: "error" });
    else fireToast({ message: `Write-off of ${rs(r.amountPaise)} requested. A second person approves or refuses it.`, type: "success" });
    router.refresh();
    return r.ok;
  };
  const decide = async (requestId: string, decision: "approve" | "refuse", reason: string) => {
    const r = await decideCategoryCarryWriteOff({ requestId, decision, reason });
    if (!r.ok) fireToast({ message: r.error, type: "error" });
    else fireToast({ message: decision === "approve" ? `Written off: ${rs(r.amountPaise)}. It stays in the ledger with both reasons.` : "Write-off refused. The balance stays carried forward.", type: "success" });
    router.refresh();
    return r.ok;
  };
  return (
    <section aria-label="Carried-forward balances" className="mt-4 rounded-section bg-white p-4" style={CARD}>
      <h2 className="text-[14px] font-bold text-ink-strong">Carried-forward balances ({balances.filter((b) => b.remainingPaise > 0).length} open)</h2>
      <p className="mt-0.5 text-[12.5px] text-ink-muted">
        A month whose total is below the smallest amount paid is held here and added to the following months until the smallest amount is reached; nothing is released twice. Writing a balance off takes two people, each with a reason.
      </p>
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
          {balances.map((b) => {
            const label = `${b.employeeName}'s balance from ${b.month.slice(0, 7)}`;
            const req = b.writeOffRequest ?? null;
            const writeOffs = b.writeOffs ?? [];
            return (
              <tr key={b.lotId} className="border-t border-hairline align-top" aria-label={label}>
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
                  {req && (
                    <div className="mt-0.5 font-semibold text-[#B45309]">
                      Write-off of {rs(req.amountPaise)} requested by {req.byName} ({day(req.at)}): “{req.reason}” — awaiting a second person
                    </div>
                  )}
                  {writeOffs.some((w) => w.kind !== "request") && (
                    <details className="mt-0.5 text-[11.5px]">
                      <summary className="cursor-pointer">Write-off history ({writeOffs.length})</summary>
                      <ul>
                        {writeOffs.map((w, i) => (
                          <li key={i}>
                            {WO[w.kind]}: {rs(w.amountPaise)} — {w.byName}, {day(w.at)}: “{w.reason}”
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </td>
                <td className="py-1.5 text-right">
                  {canWriteOff && b.remainingPaise > 0 && !req && <WithReason label={label} action="Request write-off" onSubmit={(why) => request(b.lotId, why)} />}
                  {canWriteOff && req && req.byId !== me && (
                    <span className="inline-flex flex-col items-end gap-1">
                      <WithReason label={label} action="Approve write-off" tone="go" onSubmit={(why) => decide(req.requestId, "approve", why)} />
                      <WithReason label={label} action="Refuse write-off" tone="stop" onSubmit={(why) => decide(req.requestId, "refuse", why)} />
                    </span>
                  )}
                  {canWriteOff && req && req.byId === me && <span className="text-[12px] text-ink-subtle">You requested it: a second person decides.</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
