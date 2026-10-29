"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw } from "lucide-react";
import { fireToast } from "@/lib/toast";
import { recalculateEmployeeRun } from "@/app/(app)/salary/actions";
import { inr2 } from "@/lib/salary/money";
import { BORDER, NAVY } from "@/components/attendance/overview/theme";

/**
 * "Recalculate my salary": recompute this employee's run for the month from
 * today's attendance and profile. Salary writes are HR's (admin-only on the
 * server), so the page renders this only for administrators; the server checks
 * again regardless. A disbursed month is refused by the server and said so.
 */
export function RecalculateButton({ month, employeeId, monthLabel, disabledReason }: { month: string; employeeId: string; monthLabel: string; disabledReason?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = () =>
    start(async () => {
      const res = await recalculateEmployeeRun({ month, employeeId });
      if (!res.ok) {
        fireToast({ message: res.error });
        return;
      }
      fireToast({ message: `Recalculated ${monthLabel}: net pay ${inr2(res.netPayable)}.` });
      router.refresh();
    });
  return (
    <button
      type="button"
      onClick={run}
      disabled={pending || Boolean(disabledReason)}
      title={disabledReason}
      className="inline-flex h-10 items-center gap-2 rounded-lg bg-white px-4 text-[13.5px] font-bold transition-colors hover:bg-[#F3F6FA] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A6CFF]"
      style={{ border: `1px solid ${BORDER}`, color: NAVY }}
    >
      {pending ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <RefreshCw size={15} aria-hidden />}
      {pending ? "Recalculating…" : "Recalculate my salary"}
    </button>
  );
}
