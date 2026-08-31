import Link from "next/link";
import type { Route } from "next";
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { employees } from "@/db/schema";
import type { ForecastPeriodKind } from "@/db/enums";
import { requireModuleAccess } from "@/lib/auth/module-access";
import { getMyFieldAccess } from "@/lib/auth/field-access";
import { getOrgSettings } from "@/lib/queries/org-settings";
import { istYmd } from "@/lib/weekly-goals/week";
import {
  listForecastGrid,
  listForecastableCustomers,
  listTargets,
} from "@/lib/queries/targets";
import {
  childKind,
  fyLabel,
  fyStartYearForDate,
  isLocked,
  periodsOfKind,
} from "@/lib/targets/period";
import { ForecastGrid } from "./forecast-grid";
import { TargetsHead, PeriodSwitcher, YearSwitcher } from "./ui";

/**
 * The shared body of the Quarterly, Monthly and Weekly screens.
 *
 * One component parameterised by `kind` rather than three near-identical
 * pages — a change to the grid then lands on all three, which is the whole
 * reason the period model is a single ladder.
 */
export async function PeriodPage({
  kind,
  title,
  lede,
  searchParams,
}: {
  kind: ForecastPeriodKind;
  title: string;
  lede: string;
  searchParams: Promise<{ fy?: string; period?: string; rep?: string }>;
}) {
  const me = await requireModuleAccess("targets");
  const sp = await searchParams;

  const today = istYmd(new Date());
  const parsedFy = Number(sp.fy);
  const fyStartYear = Number.isInteger(parsedFy) ? parsedFy : fyStartYearForDate(today);

  const periods = periodsOfKind(fyStartYear, kind);
  // Default to the period containing today, falling back to the first — opening
  // on "now" is what someone doing the Friday routine actually wants.
  const current = periods.find((p) => today >= p.startDate && today <= p.endDate);
  const active =
    periods.find((p) => p.key === sp.period) ?? current ?? periods[0]!;

  // Reps see only their own book. An admin may look at anyone via ?rep=.
  const roster = me.isAdmin
    ? await db
        .select({ id: employees.id, name: employees.name })
        .from(employees)
        .where(eq(employees.isActive, true))
        .orderBy(asc(employees.name))
    : [];
  const scopedId = me.isAdmin && sp.rep && roster.some((r) => r.id === sp.rep) ? sp.rep : me.id;

  const [rows, customers, targets, fieldAccess, settings] = await Promise.all([
    listForecastGrid(fyStartYear, active, { employeeId: scopedId }),
    listForecastableCustomers(scopedId),
    listTargets(fyStartYear),
    getMyFieldAccess(),
    getOrgSettings(),
  ]);

  const targetPaise =
    targets.find(
      (t) => t.periodKind === kind && t.periodKey === active.key && t.employeeId === scopedId,
    )?.targetPaise ?? 0;

  const locked = isLocked(
    active,
    {
      monthlyDay: settings.forecastMonthlyDay,
      weeklyDow: settings.forecastWeeklyDow,
      lockDays: settings.forecastLockDays,
    },
    today,
  );

  const base = `/targets/${kind === "quarter" ? "quarterly" : kind === "month" ? "monthly" : "weekly"}`;

  return (
    <>
      <TargetsHead
        title={title}
        lede={lede}
        right={
          <>
            {me.isAdmin && roster.length > 0 && (
              <form action={base} className="contents">
                <input type="hidden" name="fy" value={fyStartYear} />
                <input type="hidden" name="period" value={active.key} />
                <select
                  name="rep"
                  defaultValue={scopedId}
                  aria-label="Salesperson"
                  className="rounded-chip px-2.5 h-9 bg-surface-card border border-hairline text-[13px] font-semibold text-ink-soft outline-none"
                >
                  {roster.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
                <button
                  type="submit"
                  className="rounded-chip px-3 h-9 bg-surface-card border border-hairline text-[13px] font-semibold text-ink-soft"
                >
                  View
                </button>
              </form>
            )}
            <YearSwitcher
              fyStartYear={fyStartYear}
              label={fyLabel(fyStartYear)}
              basePath={base}
              extraQuery={`period=${active.key}`}
            />
          </>
        }
      />

      <PeriodSwitcher
        periods={periods.map((p) => ({ key: p.key, label: p.label }))}
        activeKey={active.key}
        basePath={base}
        fyStartYear={fyStartYear}
      />

      <ForecastGrid
        fyStartYear={fyStartYear}
        periodKind={kind}
        periodKey={active.key}
        periodLabel={active.label}
        rows={rows}
        customers={customers}
        employeeId={scopedId}
        targetPaise={targetPaise}
        locked={locked}
        canEditQty={fieldAccess["forecast.quantity"]?.allowed ?? false}
        canEditRate={fieldAccess["forecast.avg_rate"]?.allowed ?? false}
        canRedivide={childKind(kind) !== null}
      />

      <p className="mt-4 text-ink-subtle" style={{ fontSize: 12.5 }}>
        Actual is imported from Tally and can&apos;t be typed here.{" "}
        <Link href={"/targets/dashboard" as Route} style={{ color: "#6D28D9", fontWeight: 600 }}>
          See the dashboard
        </Link>{" "}
        for the whole year.
      </p>
    </>
  );
}
