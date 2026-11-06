"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Sparkles } from "lucide-react";
import { fireToast } from "@/lib/toast";
import { generateSalary } from "@/app/(app)/salary/actions";

/**
 * "Generate Salary for <month>": one run per employee with a CTC profile,
 * computed from the month's attendance. Re-running a month recomputes every
 * existing run from today's attendance, so when runs exist it asks first and
 * says that disbursed runs are left unchanged (the server enforces that).
 * `hero` is the larger button the empty state shows; both are JMT's blue.
 */
export function GenerateButton({ month, monthLabel, rows, hero = false }: { month: string; monthLabel: string; rows: readonly { disbursed: boolean }[]; hero?: boolean }) {
  const router = useRouter();
  const [generating, start] = useTransition();

  function onGenerate() {
    if (rows.length > 0) {
      const paid = rows.filter((r) => r.disbursed).length;
      const ok = window.confirm(
        `Recalculate ${rows.length} existing salary ${rows.length === 1 ? "run" : "runs"} for ${monthLabel} from current attendance?` +
          (paid > 0 ? `\n\n${paid} ${paid === 1 ? "run is" : "runs are"} marked disbursed and will be left unchanged.` : "") +
          `\n\nEmployees without a run yet will get one.`,
      );
      if (!ok) return;
    }
    start(async () => {
      const res = await generateSalary({ month });
      if (!res.ok) {
        fireToast({ message: res.error });
        return;
      }
      const parts = [`Generated ${res.generated} salary ${res.generated === 1 ? "run" : "runs"} for ${monthLabel}.`];
      if (res.skippedDisbursed > 0) parts.push(`${res.skippedDisbursed} disbursed ${res.skippedDisbursed === 1 ? "run" : "runs"} left unchanged.`);
      if (res.skippedNoProfile > 0) parts.push(`${res.skippedNoProfile} without a CTC profile skipped.`);
      fireToast({ message: parts.join(" ") });
      router.refresh();
    });
  }

  return (
    <button
      type="button"
      onClick={onGenerate}
      disabled={generating}
      className={`inline-flex items-center gap-1.5 rounded-lg font-semibold text-white transition-[filter,opacity] hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[#0A6CFF]/30 ${hero ? "h-10 px-4 text-[13.5px]" : "h-9 px-3.5 text-[13px]"}`}
      style={{ background: "linear-gradient(135deg, #0A6CFF, #0751BE)", boxShadow: "0 1px 2px rgba(10, 108, 255, 0.25)" }}
      data-variant={hero ? "hero" : "default"}
    >
      {generating ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Sparkles size={14} strokeWidth={2.2} aria-hidden />}
      {generating ? "Generating…" : `Generate Salary for ${monthLabel}`}
    </button>
  );
}
