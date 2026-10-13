import Link from "next/link";
import type { Route } from "next";
import { requireAdmin } from "@/lib/auth/current";
import { localDateString } from "@/lib/format";
import { POLICY_DEFS, getPolicyDef, resolvePolicy } from "@/lib/attendance/policy";
import { computeWorkingDays } from "@/lib/attendance/payroll-rules";
import { listPolicyChanges, listPolicyHistory, loadMonthHolidays } from "@/lib/queries/attendance-policy";
import { PolicyRow, describeValue } from "@/components/admin/attendance-policy-editor";

export const dynamic = "force-dynamic";

/**
 * Where attendance rules are managed. Settings are defined in
 * lib/attendance/policy.ts; changes are stored append-only with who, when, why
 * and the effective date. The month preview reads holidays from the Holidays
 * page's table and changes nothing.
 */
export default async function AttendancePolicyPage() {
  await requireAdmin();
  const today = localDateString("Asia/Kolkata");
  const year = Number(today.slice(0, 4));
  const month = Number(today.slice(5, 7));

  const [changes, history, holidays] = await Promise.all([
    listPolicyChanges(),
    listPolicyHistory(50),
    loadMonthHolidays(year, month),
  ]);
  const policy = resolvePolicy(changes, today);
  const wd = computeWorkingDays({ year, month, holidays, policy: resolvePolicy(changes, `${today.slice(0, 7)}-01`) });
  const pendingCount = POLICY_DEFS.filter((d) => d.status === "pending").length;

  return (
    <div className="max-w-[900px]">
      <header className="mb-6">
        <div className="text-[10px] uppercase tracking-[0.18em] text-ink-subtle font-bold">Admin · Attendance</div>
        <h1 className="mt-1 text-[28px] font-bold text-ink-strong">Attendance Policy</h1>
        <p className="mt-1 text-[14px] text-ink-muted">
          Every attendance rule lives here, not in code. A change applies from its effective date and never alters an
          earlier month. {pendingCount} settings are awaiting Sir&apos;s confirmation.
        </p>
      </header>

      <section className="rounded-section bg-surface-card p-5 mb-6" style={{ border: "1px solid var(--color-hairline)" }}>
        <h2 className="text-[16px] font-semibold text-ink-strong">This month, by the current policy</h2>
        <p className="mt-1 text-[13.5px] text-ink-soft tabular-nums">
          {wd.calendarDays} calendar days − {wd.weeklyOffs} weekly offs − {wd.publicHolidays} public holidays −{" "}
          {policy.optional_holidays_reduce_working_days ? wd.optionalHolidays : 0} optional holidays ={" "}
          <strong>{wd.workingDays} working days</strong>
        </p>
        <p className="mt-1 text-[12.5px] text-ink-subtle">
          Holiday dates come from the{" "}
          <Link href={"/admin/holidays" as Route} className="underline underline-offset-2">
            Holidays
          </Link>{" "}
          page — the single source. A date that is both a Sunday and a holiday is counted once. Salary runs do not use
          this yet.
        </p>
      </section>

      <section className="rounded-section bg-surface-card p-5 mb-6" style={{ border: "1px solid var(--color-hairline)" }}>
        <h2 className="text-[16px] font-semibold text-ink-strong">Settings</h2>
        <ul className="mt-2">
          {POLICY_DEFS.map((d) => (
            <PolicyRow key={d.key} def={d} current={policy[d.key]} today={today} />
          ))}
        </ul>
      </section>

      <section className="rounded-section bg-surface-card p-5" style={{ border: "1px solid var(--color-hairline)" }}>
        <h2 className="text-[16px] font-semibold text-ink-strong">Change history</h2>
        {history.length === 0 ? (
          <p className="mt-2 text-[14px] text-ink-subtle">No changes yet — every setting is at its initial value.</p>
        ) : (
          <ul className="mt-2 divide-y divide-hairline">
            {history.map((h) => {
              const def = getPolicyDef(h.key);
              return (
                <li key={h.id} className="py-3 text-[13.5px]">
                  <p className="font-semibold text-ink-strong">{def?.label ?? h.key}</p>
                  <p className="text-ink-soft tabular-nums">
                    {def ? describeValue(def, h.previousValue) : String(h.previousValue)} →{" "}
                    {def ? describeValue(def, h.value) : String(h.value)} · from {h.effectiveFrom}
                  </p>
                  <p className="text-ink-subtle">
                    {h.reason} · {h.changedByName ?? "Unknown"} ·{" "}
                    {h.createdAt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" })}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
