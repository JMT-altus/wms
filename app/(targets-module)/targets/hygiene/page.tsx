import type { Route } from "next";
import Link from "next/link";
import { requireModuleAccess } from "@/lib/auth/module-access";
import { getOrgSettings } from "@/lib/queries/org-settings";
import { hygieneRows } from "@/lib/queries/targets";
import { fyLabel, fyStartYearForDate } from "@/lib/targets/period";
import { istYmd } from "@/lib/weekly-goals/week";
import { EmptyPanel, TargetsHead, YearSwitcher } from "@/components/targets/ui";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ fy?: string; kind?: string }>;
}

const KINDS = [
  { key: "month", label: "Monthly" },
  { key: "week", label: "Weekly" },
  { key: "quarter", label: "Quarterly" },
] as const;

/**
 * The hygiene tracker.
 *
 * Its job is narrow and stated plainly: show estimates that were submitted
 * without a supporting note, and periods where the routine was missed. A number
 * people can actually move, rather than a wall of green ticks.
 */
export default async function HygienePage({ searchParams }: PageProps) {
  const me = await requireModuleAccess("targets");
  const sp = await searchParams;

  const today = istYmd(new Date());
  const parsedFy = Number(sp.fy);
  const fyStartYear = Number.isInteger(parsedFy) ? parsedFy : fyStartYearForDate(today);
  const kind = (KINDS.find((k) => k.key === sp.kind)?.key ?? "month") as "month" | "week" | "quarter";

  const settings = await getOrgSettings();
  const rows = await hygieneRows(
    fyStartYear,
    kind,
    {
      monthlyDay: settings.forecastMonthlyDay,
      weeklyDow: settings.forecastWeeklyDow,
      lockDays: settings.forecastLockDays,
    },
    today,
    me.isAdmin ? {} : { employeeId: me.id },
  );

  const flagged = rows.reduce((n, r) => n + r.estimatedWithoutNotes, 0);
  const avg = rows.length > 0 ? Math.round(rows.reduce((s, r) => s + r.score, 0) / rows.length) : 0;

  return (
    <>
      <TargetsHead
        title="Hygiene Tracker"
        lede={
          rows.length === 0
            ? "Estimates submitted without a supporting note."
            : `${flagged} estimate${flagged === 1 ? "" : "s"} with no note · average hygiene ${avg}%`
        }
        right={
          <YearSwitcher
            fyStartYear={fyStartYear}
            label={fyLabel(fyStartYear)}
            basePath="/targets/hygiene"
            extraQuery={`kind=${kind}`}
          />
        }
      />

      <div className="flex items-center gap-1.5 mb-4">
        {KINDS.map((k) => {
          const active = k.key === kind;
          return (
            <Link
              key={k.key}
              href={`/targets/hygiene?fy=${fyStartYear}&kind=${k.key}` as Route}
              aria-current={active ? "page" : undefined}
              className="rounded-chip px-3 h-9 inline-flex items-center font-semibold"
              style={
                active
                  ? { background: "linear-gradient(135deg, #7C3AED, #4F46E5)", color: "#fff", fontSize: 13 }
                  : {
                      background: "var(--color-surface-card)",
                      border: "1px solid var(--color-hairline)",
                      color: "var(--color-ink-soft)",
                      fontSize: 13,
                    }
              }
            >
              {k.label}
            </Link>
          );
        })}
      </div>

      {rows.length === 0 ? (
        <EmptyPanel title="Nothing to check yet.">
          Once estimates start going in, this screen lists anyone who recorded a number without
          saying why — and any period where the routine was missed altogether.
        </EmptyPanel>
      ) : (
        <div className="rounded-section border border-hairline bg-surface-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full" style={{ minWidth: 840 }}>
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
                  <th className="px-4 py-3">Period</th>
                  <th className="px-4 py-3 text-right">Rows</th>
                  <th className="px-4 py-3 text-right">Estimated</th>
                  <th className="px-4 py-3 text-right">No note</th>
                  <th className="px-4 py-3">On time</th>
                  <th className="px-4 py-3 text-right">Hygiene</th>
                  <th className="px-4 py-3">Last update</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const tone = r.score >= 80 ? "green" : r.score >= 50 ? "amber" : "red";
                  return (
                    <tr
                      key={`${r.employeeId}-${r.periodKey}`}
                      className="border-t"
                      style={{ borderColor: "var(--color-hairline)" }}
                    >
                      <td className="px-4 py-2.5">
                        <strong className="text-ink-strong" style={{ fontSize: 13.5 }}>
                          {r.name}
                        </strong>
                      </td>
                      <td className="px-4 py-2.5 text-ink-soft" style={{ fontSize: 13 }}>
                        {r.periodLabel}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-ink-soft" style={{ fontSize: 13 }}>
                        {r.totalRows}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-ink-soft" style={{ fontSize: 13 }}>
                        {r.estimatedRows}/{r.totalRows}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {r.estimatedWithoutNotes === 0 ? (
                          <span className="text-ink-subtle">—</span>
                        ) : (
                          <span
                            className="font-bold tabular-nums"
                            style={{ fontSize: 13, color: "var(--color-red-deep)" }}
                          >
                            {r.estimatedWithoutNotes}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-2.5" style={{ fontSize: 13 }}>
                        {r.onTime ? (
                          <span style={{ color: "var(--color-green-deep)", fontWeight: 700 }}>✓</span>
                        ) : (
                          <span style={{ color: "var(--color-red-deep)", fontWeight: 700 }}>✗ late</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <span
                          className="inline-flex items-center rounded-pill px-2 py-0.5 font-bold tabular-nums"
                          style={{
                            fontSize: 11.5,
                            background: `color-mix(in srgb, var(--color-${tone}) 14%, transparent)`,
                            color: `var(--color-${tone}-deep)`,
                            border: `1px solid color-mix(in srgb, var(--color-${tone}) 30%, transparent)`,
                          }}
                        >
                          {r.score}%
                        </span>
                      </td>
                      <td className="px-4 py-2.5 text-ink-muted tabular-nums" style={{ fontSize: 12.5 }}>
                        {r.lastUpdatedAt
                          ? new Date(r.lastUpdatedAt).toLocaleDateString("en-IN", {
                              day: "numeric",
                              month: "short",
                              timeZone: "Asia/Kolkata",
                            })
                          : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className="mt-4 text-ink-subtle" style={{ fontSize: 12.5 }}>
        Hygiene weighs coverage and notes equally, minus 10 for a missed deadline. Estimating
        everything without a word is as unhelpful as one well-noted row out of twenty.
      </p>
    </>
  );
}
