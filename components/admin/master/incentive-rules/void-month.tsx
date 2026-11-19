"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { fireToast } from "@/lib/toast";
import { voidCategoryCMonth } from "@/app/(masters)/master-setup/incentive-rules/calculation/actions";
import { BTN, BTN_PLAIN, CARD, FIELD, day, rs } from "./calc-ui";

/**
 * Category C → Void month (0136). An abandoned, UNPAID month (open or locked) is voided by someone with the “Void an
 * unpaid Category C month” permission, with a REQUIRED reason, after confirming what happens: its calculations are
 * kept, its amounts and the adjustments carried into it go to the next month, and the balances it counted stay carried
 * forward. A voided month no longer holds up later months. It is never undone. The server checks everything again.
 */
export function VoidMonth({ programId, month, rowVersion, voided }: { programId: string; month: string; rowVersion: number; voided: { reason: string; byName: string; at: string; carriedToMonth: string | null; carriedPaise: number } | null }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [sure, setSure] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  if (voided)
    return (
      <section aria-label="Voided month" className="mt-4 rounded-section bg-white p-4" style={CARD}>
        <h2 className="text-[14px] font-bold text-ink-strong">This month is voided</h2>
        <p className="mt-1 text-[12.5px] text-ink-muted">
          Voided by {voided.byName} on {day(voided.at)} — “{voided.reason}”. Its calculations are kept for the record; it is never calculated, submitted or paid again, and it no longer holds up later months.{" "}
          {voided.carriedToMonth ? `${rs(voided.carriedPaise)} was carried into ${voided.carriedToMonth.slice(0, 7)}.` : "Nothing needed carrying forward."}
        </p>
      </section>
    );
  return (
    <section aria-label="Void month" className="mt-4 rounded-section bg-white p-4" style={CARD}>
      <h2 className="text-[14px] font-bold text-ink-strong">Void this month</h2>
      <p className="mt-1 text-[12.5px] text-ink-muted">
        For an abandoned month that will never be paid and is holding up later months. Its calculations are kept; each salesperson&apos;s amount and the adjustments carried into it are carried into the next month (which must be open); the balances it counted stay carried forward. A month with records held for review, or not yet settled, can&apos;t be voided. It can&apos;t be undone.
      </p>
      {!open ? (
        <button type="button" className={`${BTN} mt-2`} style={{ background: "#B91C1C" }} onClick={() => setOpen(true)}>
          Void month…
        </button>
      ) : (
        <div className="mt-2 grid gap-2">
          <input className={`${FIELD} w-full max-w-xl`} placeholder="Why is this month voided? (required)" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reason for voiding the month" maxLength={1000} />
          <label className="flex items-center gap-2 text-[12.5px] text-ink-strong">
            <input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} />
            I understand {month.slice(0, 7)} will never be paid, and this can&apos;t be undone.
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={BTN}
              style={{ background: "#B91C1C" }}
              disabled={busy || !reason.trim() || !sure}
              onClick={async () => {
                setBusy(true);
                setError(null);
                const r = await voidCategoryCMonth({ programId, month, rowVersion, category: "C", reason: reason.trim() });
                setBusy(false);
                if (!r.ok) return setError(r.error);
                fireToast({ message: r.carriedToMonth ? `Month voided. ${rs(r.carriedPaise)} carried into ${r.carriedToMonth.slice(0, 7)}.` : "Month voided.", type: "success" });
                setOpen(false);
                router.refresh();
              }}
            >
              Void {month.slice(0, 7)}
            </button>
            <button type="button" className={BTN_PLAIN} onClick={() => setOpen(false)}>
              Cancel
            </button>
            {error && (
              <span role="alert" className="text-[12.5px] font-semibold text-[#B91C1C]">
                {error}
              </span>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
