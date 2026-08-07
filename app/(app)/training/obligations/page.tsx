import { Check, X } from "lucide-react";
import { DashboardHeader } from "@/components/layout/header";
import { DashboardFooter } from "@/components/layout/footer";
import { requireUser } from "@/lib/auth/current";
import { listObligations } from "@/lib/queries/training";
import { EmptyState, PageHead, ProgressBar } from "@/components/training/ui";

export const dynamic = "force-dynamic";

/**
 * Obligations is DERIVED — there is no obligations table. Every number here is
 * computed from the library, watches, self-learning and share tables, so it
 * cannot drift from the pages that own that data.
 *
 * Admins see the whole team; everyone else sees only their own row.
 */
export default async function ObligationsPage() {
  const me = await requireUser();
  const all = await listObligations();
  const rows = me.isAdmin ? all : all.filter((r) => r.employeeId === me.id);

  return (
    <>
      <DashboardHeader generatedAt={new Date()} />
      <main className="mx-auto max-w-[1400px] px-10 max-md:px-4 pt-8 pb-16">
        <PageHead
          eyebrow="OBLIGATIONS"
          title="Training Obligations"
          sub={
            me.isAdmin
              ? "Where everyone stands against induction, self-learning and the weekly share."
              : "Where you stand against induction, self-learning and the weekly share."
          }
        />

        {rows.length === 0 ? (
          <EmptyState title="Nothing to show yet." />
        ) : (
          <div className="rounded-section border border-hairline bg-surface-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full" style={{ minWidth: 820 }}>
                <thead>
                  <tr
                    className="text-left uppercase tracking-[0.08em] text-ink-subtle"
                    style={{ fontSize: 11.5, fontWeight: 700 }}
                  >
                    <th className="px-5 py-3.5">Employee</th>
                    <th className="px-5 py-3.5">Induction</th>
                    <th className="px-5 py-3.5">Self-learning this month</th>
                    <th className="px-5 py-3.5">Share this week</th>
                    <th className="px-5 py-3.5">Materials watched</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const learnPct =
                      r.selfLearningTarget > 0
                        ? (r.selfLearningMinutes / r.selfLearningTarget) * 100
                        : 0;
                    const learnDone = r.selfLearningMinutes >= r.selfLearningTarget;
                    return (
                      <tr
                        key={r.employeeId}
                        className="border-t"
                        style={{ borderColor: "var(--color-hairline)" }}
                      >
                        <td
                          className="px-5 py-4 font-bold text-ink-strong whitespace-nowrap"
                          style={{ fontSize: 15 }}
                        >
                          {r.employeeName}
                        </td>

                        <td className="px-5 py-4" style={{ minWidth: 180 }}>
                          <div className="flex items-center gap-2.5">
                            <div className="flex-1">
                              <ProgressBar
                                pct={r.inductionPct}
                                tone={r.inductionPct === 100 ? "green" : "teal"}
                                height={8}
                              />
                            </div>
                            <span
                              className="tabular-nums font-bold text-ink-soft shrink-0"
                              style={{ fontSize: 13 }}
                            >
                              {r.inductionDone}/{r.inductionTotal}
                            </span>
                          </div>
                        </td>

                        <td className="px-5 py-4" style={{ minWidth: 200 }}>
                          <div className="flex items-center gap-2.5">
                            <div className="flex-1">
                              <ProgressBar
                                pct={learnPct}
                                tone={learnDone ? "green" : "amber"}
                                height={8}
                              />
                            </div>
                            <span
                              className="tabular-nums font-bold text-ink-soft shrink-0"
                              style={{ fontSize: 13 }}
                            >
                              {(r.selfLearningMinutes / 60).toFixed(1)}/
                              {(r.selfLearningTarget / 60).toFixed(1)}h
                            </span>
                          </div>
                        </td>

                        <td className="px-5 py-4">
                          <YesNo ok={r.sharedThisWeek} />
                        </td>

                        <td
                          className="px-5 py-4 tabular-nums font-semibold text-ink-soft"
                          style={{ fontSize: 14 }}
                        >
                          {r.materialsWatched} / {r.materialsTotal}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>
      <DashboardFooter />
    </>
  );
}

/** Icon + word, never colour alone — red/green is not readable for everyone. */
function YesNo({ ok }: { ok: boolean }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 font-bold"
      style={{
        fontSize: 12,
        background: ok
          ? "color-mix(in srgb, var(--color-green) 14%, transparent)"
          : "color-mix(in srgb, var(--color-red) 10%, transparent)",
        color: ok ? "var(--color-green-deep)" : "var(--color-red-deep)",
        border: `1px solid color-mix(in srgb, var(--color-${ok ? "green" : "red"}) 30%, transparent)`,
      }}
    >
      {ok ? <Check size={13} strokeWidth={3} /> : <X size={13} strokeWidth={3} />}
      {ok ? "Done" : "Missing"}
    </span>
  );
}
