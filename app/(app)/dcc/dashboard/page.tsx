import Link from "next/link";
import { DashboardHeader } from "@/components/layout/header";
import { DashboardFooter } from "@/components/layout/footer";
import { EmployeeAvatar } from "@/components/ui/employee-avatar";
import { DccTabs } from "@/components/dcc/dcc-tabs";
import { requireUser } from "@/lib/auth/current";
import { getDccScope } from "@/lib/dcc/access";
import { listDccPeople, listItemsForOwners, listEntriesForOwners, listReviewsForOwners } from "@/lib/queries/dcc";
import { todayIso, addDays, pctTone, pctOf } from "@/lib/dcc/util";
import { indexEntries, summarisePerson, rankScore, toBoardItem, type BoardItem, type BoardEntry } from "@/lib/dcc/board-model";
import { rangeStats, monthStart, weekStart } from "@/lib/dcc/grid-model";
import { Flame, CheckCircle2, AlertTriangle, Users } from "lucide-react";

export const dynamic = "force-dynamic";

/** The streak walk needs a few weeks; the month-to-date column needs the 1st. */
const HISTORY_DAYS = 28;

/**
 * /dcc/dashboard — employee-wise compliance for everyone in the viewer's scope
 * (their reporting line, or everyone with Field Permission `dcc.team.view`).
 * Every number is computed from stored fills; nothing is sampled or seeded.
 */
export default async function DccDashboardPage() {
  const me = await requireUser();
  const scope = await getDccScope(me);

  if (!scope.isManager) {
    return (
      <>
        <DashboardHeader generatedAt={new Date()} />
        <main className="mx-auto w-full max-w-[var(--max-content)] px-6 py-10">
          <div className="rounded-[22px] border border-hairline bg-surface-card px-6 py-14 text-center">
            <Users size={40} className="mx-auto mb-3 text-ink-subtle" />
            <p className="text-[15px] font-bold text-ink-strong">This dashboard is for managers and admins.</p>
            <p className="mt-1.5 text-[13px] text-ink-subtle">
              Your own checklist lives on{" "}
              <Link href="/dcc" className="font-semibold text-altus-red hover:underline">
                the DCC board
              </Link>
              .
            </p>
          </div>
        </main>
        <DashboardFooter />
      </>
    );
  }

  const today = todayIso();
  const thisMonday = weekStart(today);
  const thisMonth = monthStart(today);
  const from = [addDays(today, -HISTORY_DAYS), thisMonth].sort()[0]!;
  const ownerIds = [...scope.visibleIds];

  // Four batched queries for the whole roster — never one per person.
  const [people, items, entries, reviews] = await Promise.all([
    listDccPeople(ownerIds),
    listItemsForOwners(ownerIds),
    listEntriesForOwners(ownerIds, from),
    listReviewsForOwners(ownerIds, from),
  ]);

  const itemsByOwner = new Map<string, BoardItem[]>();
  for (const i of items) {
    const list = itemsByOwner.get(i.ownerEmployeeId) ?? [];
    list.push(toBoardItem(i));
    itemsByOwner.set(i.ownerEmployeeId, list);
  }
  const entriesByOwner = new Map<string, BoardEntry[]>();
  for (const e of entries) {
    const list = entriesByOwner.get(e.ownerId) ?? [];
    list.push({ itemId: e.itemId, entryDate: e.entryDate, status: e.status, valueNumber: e.valueNumber, note: e.note, subjectId: e.subjectId });
    entriesByOwner.set(e.ownerId, list);
  }
  const reviewToday = new Map(reviews.filter((r) => r.reviewDate === today).map((r) => [r.ownerEmployeeId, r]));

  const rows = people.map((p) => {
    const ownerItems = itemsByOwner.get(p.id) ?? [];
    const slots = indexEntries(entriesByOwner.get(p.id) ?? []);
    const day = summarisePerson(p.id, ownerItems, slots, today);
    const week = rangeStats(ownerItems, slots, thisMonday, today);
    const month = rangeStats(ownerItems, slots, thisMonth, today);
    return { person: p, day, week, month, review: reviewToday.get(p.id) ?? null, score: rankScore(month.pct, day.streak) };
  });

  // Ranked: scored people first (month-to-date done rate, with consistency),
  // then anyone with nothing due yet, by name. Nobody is ranked last for having
  // no checklist.
  const ranked = [...rows].sort((a, b) => {
    const aScored = a.month.due > 0 ? 1 : 0;
    const bScored = b.month.due > 0 ? 1 : 0;
    return bScored - aScored || b.score - a.score || b.month.pct - a.month.pct || a.person.name.localeCompare(b.person.name);
  });

  const withDue = rows.filter((r) => r.day.due > 0);
  const dueToday = withDue.reduce((n, r) => n + r.day.due, 0);
  const doneToday = withDue.reduce((n, r) => n + r.day.done, 0);
  const filledToday = withDue.reduce((n, r) => n + r.day.filled, 0);
  const pendingToday = dueToday - filledToday;
  const filledPct = pctOf(filledToday, dueToday);
  const donePct = pctOf(doneToday, dueToday);
  const onTrack = withDue.filter((r) => r.day.pct >= 80).length;
  const yetToFill = withDue.filter((r) => r.day.filled < r.day.due);

  return (
    <>
      <DashboardHeader generatedAt={new Date()} />
      <main className="mx-auto w-full max-w-[var(--max-content)] space-y-4 px-6 py-6 max-md:px-4">
        <div>
          <h1 className="text-display-md text-ink-strong" style={{ fontFamily: "var(--font-serif)" }}>
            DCC — Dashboard
          </h1>
          <p className="mt-1 text-[13.5px] text-ink-subtle">Employee-wise compliance across everyone you can see, for {today}.</p>
        </div>

        <DccTabs
          people={people.map((p) => ({ id: p.id, name: p.name, designation: p.designation, department: p.department }))}
          meId={me.id}
          active="dashboard"
          showDashboard
          query="view=grid"
        />

        <div className="grid grid-cols-5 gap-3 max-lg:grid-cols-2">
          <Tile label="Due today" value={String(dueToday)} tone={dueToday === 0 ? 100 : donePct} />
          <Tile label="Completed today" value={`${doneToday} · ${donePct}%`} tone={donePct} />
          <Tile label="Pending today" value={String(pendingToday)} tone={pendingToday === 0 ? 100 : filledPct} />
          <Tile label="People on track" value={`${onTrack}/${withDue.length}`} tone={pctOf(onTrack, withDue.length)} />
          <Tile label="Need to fill" value={String(yetToFill.length)} tone={yetToFill.length === 0 ? 100 : 0} />
        </div>

        {/* ── Employee-wise table ─────────────────────────────────────── */}
        <section className="rounded-[22px] border border-hairline bg-surface-card p-4">
          <h2 className="text-kpi-label mb-3 text-ink-subtle">Employee-wise compliance</h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] border-collapse text-[13px]" data-testid="dcc-dashboard-table">
              <thead className="text-[11px] font-bold uppercase tracking-[0.06em] text-ink-subtle">
                <tr className="border-b border-hairline">
                  <th className="px-2 py-2 text-left">Rank</th>
                  <th className="px-2 py-2 text-left">Employee</th>
                  <th className="px-2 py-2 text-right">KPIs</th>
                  <th className="px-2 py-2 text-right">Due</th>
                  <th className="px-2 py-2 text-right">Completed</th>
                  <th className="px-2 py-2 text-right">Pending</th>
                  <th className="px-2 py-2 text-right">Today</th>
                  <th className="px-2 py-2 text-right">This week</th>
                  <th className="px-2 py-2 text-right">This month</th>
                  <th className="px-2 py-2 text-right">Streak</th>
                  <th className="px-2 py-2 text-center">Review</th>
                </tr>
              </thead>
              <tbody>
                {ranked.map(({ person, day, week, month, review }, idx) => {
                  const tone = pctTone(day.pct);
                  const scored = month.due > 0;
                  return (
                    <tr key={person.id} className="border-b border-hairline transition hover:bg-surface-soft">
                      <td className="px-2 py-2">
                        <span
                          className="grid size-6 place-items-center rounded-full text-[12px] font-black tabular-nums"
                          style={{
                            background: scored ? (MEDAL[idx] ?? "var(--color-surface-track)") : "transparent",
                            color: scored && idx < 3 ? "#fff" : "var(--color-ink-muted)",
                          }}
                        >
                          {scored ? idx + 1 : "–"}
                        </span>
                      </td>
                      <td className="px-2 py-2">
                        <Link href={`/dcc?emp=${person.id}&view=grid`} className="flex items-center gap-2.5 hover:underline">
                          <EmployeeAvatar name={person.name} size="sm" />
                          <span className="min-w-0 leading-tight">
                            <span className="block font-bold text-ink-strong">
                              {person.name}
                              {person.id === me.id && <span className="ml-1.5 text-[12px] font-normal text-ink-subtle">(me)</span>}
                            </span>
                            {(person.designation || person.department) && (
                              <span className="block text-[11.5px] text-ink-subtle">{[person.designation, person.department].filter(Boolean).join(" · ")}</span>
                            )}
                          </span>
                        </Link>
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums text-ink-soft">{day.itemCount}</td>
                      <td className="px-2 py-2 text-right tabular-nums text-ink-soft">{day.due}</td>
                      <td className="px-2 py-2 text-right tabular-nums text-ink-soft">{day.done}</td>
                      <td className="px-2 py-2 text-right tabular-nums" style={{ color: day.due - day.filled > 0 ? "var(--color-amber-deep)" : "var(--color-ink-soft)" }}>
                        {day.due - day.filled}
                      </td>
                      <td className="px-2 py-2 text-right font-bold tabular-nums" style={{ color: day.due === 0 ? "var(--color-ink-subtle)" : tone.fg }}>
                        {day.due === 0 ? "—" : `${day.pct}%`}
                      </td>
                      <Pct stats={week} />
                      <Pct stats={month} />
                      <td className="px-2 py-2 text-right tabular-nums">
                        {day.streak > 0 ? (
                          <span className="inline-flex items-center gap-1 font-bold text-ink-muted">
                            <Flame size={13} style={{ color: "var(--color-orange)" }} />
                            {day.streak}
                          </span>
                        ) : (
                          <span className="text-ink-subtle">—</span>
                        )}
                      </td>
                      <td className="px-2 py-2 text-center">
                        {review?.status === "approved" ? (
                          <CheckCircle2 size={16} className="mx-auto" style={{ color: "var(--color-green)" }} />
                        ) : review?.status === "needs_rework" ? (
                          <AlertTriangle size={16} className="mx-auto" style={{ color: "var(--color-amber)" }} />
                        ) : (
                          <span className="text-ink-subtle">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {ranked.length === 0 && (
                  <tr>
                    <td colSpan={11} className="px-2 py-8 text-center text-ink-subtle">
                      Nobody in scope yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11.5px] text-ink-subtle">
            Today, This week and This month are completed ÷ due over that period (week from Monday, month from the 1st). Rank weights the month&apos;s rate with the
            streak. Click a name to open their checklist.
          </p>
        </section>

        <section className="rounded-[22px] border border-hairline bg-surface-card p-4">
          <h2 className="text-kpi-label mb-3 text-ink-subtle">Yet to complete today</h2>
          {yetToFill.length === 0 ? (
            <p className="flex items-center gap-2 py-4 text-[13px] font-semibold text-ink-soft">
              <CheckCircle2 size={16} style={{ color: "var(--color-green)" }} />
              Everyone has filled their checklist.
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {yetToFill.map((r) => (
                <Link
                  key={r.person.id}
                  href={`/dcc?emp=${r.person.id}&view=grid`}
                  className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12.5px] font-semibold transition hover:brightness-95"
                  style={{ background: "var(--color-amber-bg)", borderColor: "var(--color-amber)", color: "var(--color-amber-deep)" }}
                >
                  {r.person.name}
                  <span className="tabular-nums opacity-70">
                    {r.day.filled}/{r.day.due}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </section>
      </main>
      <DashboardFooter />
    </>
  );
}

const MEDAL = ["#D4AF37", "#9CA3AF", "#B87333"];

function Pct({ stats }: { stats: { due: number; done: number; pct: number } }) {
  const tone = pctTone(stats.pct);
  return (
    <td className="px-2 py-2 text-right tabular-nums" style={{ color: stats.due === 0 ? "var(--color-ink-subtle)" : tone.fg }}>
      {stats.due === 0 ? "—" : (
        <>
          <span className="font-bold">{stats.pct}%</span>
          <span className="ml-1 text-[11px] text-ink-subtle">
            {stats.done}/{stats.due}
          </span>
        </>
      )}
    </td>
  );
}

function Tile({ label, value, tone }: { label: string; value: string; tone: number }) {
  const t = pctTone(tone);
  return (
    <div className="rounded-kpi border border-hairline bg-surface-card p-4">
      <div className="text-kpi-label mb-2 text-ink-subtle">{label}</div>
      <div className="text-[26px] font-black leading-none tabular-nums" style={{ color: t.fg, fontFamily: "var(--font-serif)" }}>
        {value}
      </div>
    </div>
  );
}
