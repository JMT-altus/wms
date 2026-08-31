import { requireModuleAccess } from "@/lib/auth/module-access";
import { getMyModuleAccess } from "@/lib/auth/module-access";
import {
  getCompanyAnnualTarget,
  listForecastGrid,
  periodTotals,
} from "@/lib/queries/targets";
import {
  annualPeriod,
  fyLabel,
  fyStartYearForDate,
  quarterPeriods,
} from "@/lib/targets/period";
import { istYmd } from "@/lib/weekly-goals/week";
import {
  PeriodComparisonChart,
  ProgressBar,
  TopMoversChart,
  type MoverRow,
} from "@/components/targets/dashboard-charts";
import { EmptyPanel, StatTile, TargetsHead, YearSwitcher } from "@/components/targets/ui";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ fy?: string }>;
}

export default async function TargetsDashboardPage({ searchParams }: PageProps) {
  const me = await requireModuleAccess("targets");
  await getMyModuleAccess();
  const sp = await searchParams;

  const today = istYmd(new Date());
  const parsedFy = Number(sp.fy);
  const fyStartYear = Number.isInteger(parsedFy) ? parsedFy : fyStartYearForDate(today);

  // Reps see their own year; admins see the whole company.
  const scope = me.isAdmin ? {} : { employeeId: me.id };

  const [quarters, months, companyTarget, annualRows] = await Promise.all([
    periodTotals(fyStartYear, "quarter", scope),
    periodTotals(fyStartYear, "month", scope),
    getCompanyAnnualTarget(fyStartYear),
    listForecastGrid(fyStartYear, annualPeriod(fyStartYear), scope),
  ]);

  const yearTotals = quarters.reduce(
    (a, q) => ({
      target: a.target + q.targetPaise,
      forecast: a.forecast + q.forecastPaise,
      estimated: a.estimated + q.estimatedPaise,
      actual: a.actual + q.actualPaise,
    }),
    { target: 0, forecast: 0, estimated: 0, actual: 0 },
  );
  // The company annual row is authoritative when an admin is looking; a rep's
  // own quarters are the honest total for them.
  const headlineTarget = me.isAdmin && companyTarget > 0 ? companyTarget : yearTotals.target;

  const movers: MoverRow[] = annualRows
    .map((r) => ({
      name: r.isNewBusiness ? "New business" : r.customerName ?? "—",
      variancePaise: r.actualPaise - r.forecastPaise,
    }))
    .filter((r) => r.variancePaise !== 0)
    .sort((a, b) => Math.abs(b.variancePaise) - Math.abs(a.variancePaise))
    .slice(0, 10);

  const nothingYet = yearTotals.forecast === 0 && yearTotals.actual === 0 && headlineTarget === 0;

  return (
    <>
      <TargetsHead
        title="Dashboard"
        lede={
          me.isAdmin
            ? "The whole company's year — planned, expected and delivered."
            : "Your year — planned, expected and delivered."
        }
        right={
          <YearSwitcher
            fyStartYear={fyStartYear}
            label={fyLabel(fyStartYear)}
            basePath="/targets/dashboard"
          />
        }
      />

      {nothingYet ? (
        <EmptyPanel title={`Nothing recorded for ${fyLabel(fyStartYear)} yet.`}>
          Set the company target on the <strong>Annual</strong> screen, then add customer rows on
          Quarterly or Monthly. Actuals appear once a Tally export has been imported.
        </EmptyPanel>
      ) : (
        <>
          <div
            className="grid gap-3 mb-4"
            style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}
          >
            <StatTile label="Target" paise={headlineTarget} tone="target" sub={fyLabel(fyStartYear)} />
            <StatTile
              label="Forecast"
              paise={yearTotals.forecast}
              tone="forecast"
              sub={
                headlineTarget > 0
                  ? `${Math.round((yearTotals.forecast / headlineTarget) * 100)}% of target`
                  : "—"
              }
            />
            <StatTile label="Estimated" paise={yearTotals.estimated} tone="estimated" sub="rep expectation" />
            <StatTile
              label="Actual"
              paise={yearTotals.actual}
              tone="actual"
              sub={
                yearTotals.forecast > 0
                  ? `${Math.round((yearTotals.actual / yearTotals.forecast) * 100)}% of forecast`
                  : "from Tally"
              }
            />
          </div>

          <div className="grid gap-4 mb-4">
            <ProgressBar
              targetPaise={headlineTarget}
              forecastPaise={yearTotals.forecast}
              estimatedPaise={yearTotals.estimated}
              actualPaise={yearTotals.actual}
            />
          </div>

          <div className="grid gap-4 mb-4">
            <PeriodComparisonChart data={quarters} />
          </div>

          <div
            className="grid gap-4"
            style={{ gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))" }}
          >
            <PeriodComparisonChart data={months} />
            <TopMoversChart rows={movers} />
          </div>

          <p className="mt-4 text-ink-subtle" style={{ fontSize: 12.5 }}>
            Quarters shown: {quarterPeriods(fyStartYear).map((q) => q.label).join(" · ")}.
          </p>
        </>
      )}
    </>
  );
}
