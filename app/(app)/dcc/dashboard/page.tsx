import Link from "next/link";
import { DashboardHeader } from "@/components/layout/header";
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
        <main className="dcc-page mx-auto w-full max-w-[1480px] px-10 pb-10 pt-6 max-lg:px-6 max-md:px-4">
          <div className="rounded-xl border border-[#DCE4F0] bg-white px-6 py-10 text-center shadow-[0_1px_2px_rgba(11,31,68,0.05)]">
            <Users size={26} className="mx-auto mb-2 text-[#94A3B8]" />
            <p className="text-[14px] font-semibold text-[#0B1F44]">This dashboard is for managers and admins.</p>
            <p className="mt-1 text-[12.5px] text-[#64748B]">
              Your own checklist lives on{" "}
              <Link href="/dcc" className="font-semibold text-[#0B4FB8] hover:underline">
                the DCC board
              </Link>
              .
            </p>
          </div>
        </main>
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
      <main className="dcc-page dcc-summary-page mx-auto w-full max-w-[1480px] space-y-3 px-10 pb-10 pt-4 max-lg:px-6 max-md:px-4">
        <header>
          <h1 className="text-[#0B1F44]">DCC Dashboard</h1>
          <p className="mt-1 text-[12.5px] text-[#5B6B85]">
            Employee-wise compliance across everyone you can see, for <span className="font-semibold tabular-nums text-[#334155]">{today}</span>.
          </p>
        </header>

        <div className="pb-1">
          <DccTabs
            people={people.map((p) => ({ id: p.id, name: p.name, designation: p.designation, department: p.department }))}
            meId={me.id}
            active="dashboard"
            showDashboard
            query="view=grid"
          />
        </div>

        <div className="grid grid-cols-5 gap-3 max-lg:grid-cols-2 max-sm:grid-cols-1">
          <Tile label="Due today" value={String(dueToday)} tone={dueToday === 0 ? 100 : donePct} />
          <Tile label="Completed today" value={String(doneToday)} sub={`· ${donePct}%`} tone={donePct} />
          <Tile label="Pending today" value={String(pendingToday)} tone={pendingToday === 0 ? 100 : filledPct} />
          <Tile label="People on track" value={`${onTrack}/${withDue.length}`} tone={pctOf(onTrack, withDue.length)} />
          <Tile label="Need to fill" value={String(yetToFill.length)} tone={yetToFill.length === 0 ? 100 : 0} />
        </div>

        {/* ── Employee-wise table ─────────────────────────────────────── */}
        <section className={CARD}>
          <div className="flex items-center justify-between gap-3 border-b border-[#E6ECF5] px-4 py-2.5">
            <h2 className="text-[14px] font-semibold text-[#0B1F44]">Employee-wise compliance</h2>
            <span className="rounded-full border border-[#DCE4F0] bg-[#F5F8FC] px-2 py-0.5 text-[11.5px] font-semibold tabular-nums text-[#475569]">
              {ranked.length} {ranked.length === 1 ? "employee" : "employees"}
            </span>
          </div>
          <div className="p-3">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[920px] border-collapse text-[13px]" data-testid="dcc-dashboard-table">
                <thead>
                  <tr>
                    <th className="w-14 text-left">Rank</th>
                    <th className="text-left">Employee</th>
                    <th className="w-16 text-right">KPIs</th>
                    <th className="w-16 text-right">Due</th>
                    <th className="w-24 text-right">Completed</th>
                    <th className="w-20 text-right">Pending</th>
                    <th className="w-20 text-right">Today</th>
                    <th className="w-28 text-right">This week</th>
                    <th className="w-28 text-right">This month</th>
                    <th className="w-20 text-right">Streak</th>
                    <th className="w-20 text-center">Review</th>
                  </tr>
                </thead>
                <tbody>
                  {ranked.map(({ person, day, week, month, review }, idx) => {
                    const tone = pctTone(day.pct);
                    const scored = month.due > 0;
                    const tint = scored ? TOP_TINT[idx] : undefined;
                    return (
                      <tr key={person.id}>
                        <td className="px-3 py-2">
                          <span
                            className="grid size-6 place-items-center rounded-full text-[12px] font-bold tabular-nums"
                            style={tint ? { background: tint.bg, color: tint.fg, border: `1px solid ${tint.border}` } : { color: "#64748B" }}
                          >
                            {scored ? idx + 1 : "–"}
                          </span>
                        </td>
                        <td className="max-w-[320px] px-3 py-2">
                          <Link href={`/dcc?emp=${person.id}&view=grid`} className="group flex min-w-0 items-center gap-2.5">
                            <EmployeeAvatar name={person.name} size="sm" />
                            <span className="min-w-0 leading-tight">
                              <span className="flex min-w-0 items-baseline gap-1.5">
                                <span className="truncate font-semibold text-[#0B1F44] group-hover:text-[#0B4FB8] group-hover:underline" title={person.name}>
                                  {person.name}
                                </span>
                                {person.id === me.id && <span className="shrink-0 text-[11.5px] font-normal text-[#64748B]">(me)</span>}
                              </span>
                              {(person.designation || person.department) && (
                                <span className="block truncate text-[11.5px] text-[#64748B]">{[person.designation, person.department].filter(Boolean).join(" · ")}</span>
                              )}
                            </span>
                          </Link>
                        </td>
                        <td className="px-3 py-2 text-right font-medium tabular-nums text-[#334155]">{day.itemCount}</td>
                        <td className="px-3 py-2 text-right font-medium tabular-nums text-[#334155]">{day.due}</td>
                        <td className="px-3 py-2 text-right font-medium tabular-nums text-[#334155]">{day.done}</td>
                        <td
                          className="px-3 py-2 text-right font-medium tabular-nums"
                          style={{ color: day.due - day.filled > 0 ? "var(--color-amber-deep)" : "#334155" }}
                        >
                          {day.due - day.filled}
                        </td>
                        <td className="px-3 py-2 text-right font-semibold tabular-nums" style={{ color: day.due === 0 ? "#94A3B8" : tone.fg }}>
                          {day.due === 0 ? "—" : `${day.pct}%`}
                        </td>
                        <Pct stats={week} />
                        <Pct stats={month} />
                        <td className="px-3 py-2 text-right tabular-nums">
                          {day.streak > 0 ? (
                            <span className="inline-flex items-center gap-1 font-medium text-[#475569]">
                              <Flame size={12} style={{ color: "var(--color-orange)" }} />
                              {day.streak}
                            </span>
                          ) : (
                            <span className="text-[#94A3B8]">—</span>
                          )}
                        </td>
                        <td className="px-3 py-2 text-center">
                          {review?.status === "approved" ? (
                            <CheckCircle2 size={15} className="mx-auto" style={{ color: "var(--color-green)" }} />
                          ) : review?.status === "needs_rework" ? (
                            <AlertTriangle size={15} className="mx-auto" style={{ color: "var(--color-amber)" }} />
                          ) : (
                            <span className="text-[#94A3B8]">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {ranked.length === 0 && (
                    <tr>
                      <td colSpan={11} className="px-3 py-8 text-center text-[#64748B]">
                        Nobody in scope yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[11.5px] leading-snug text-[#64748B]">
              Today, This week and This month are completed ÷ due over that period (week from Monday, month from the 1st). Rank weights the month&apos;s rate with the
              streak. Click a name to open their checklist.
            </p>
          </div>
        </section>

        <section className={CARD}>
          <div className="flex items-center justify-between gap-3 border-b border-[#E6ECF5] px-4 py-2.5">
            <h2 className="text-[14px] font-semibold text-[#0B1F44]">Yet to complete today</h2>
            {yetToFill.length > 0 && (
              <span
                className="rounded-full border px-2 py-0.5 text-[11.5px] font-semibold tabular-nums"
                style={{ background: "var(--color-amber-bg)", borderColor: "#F3D9A4", color: "var(--color-amber-deep)" }}
              >
                {yetToFill.length} pending
              </span>
            )}
          </div>
          <div className="px-4 py-3">
            {yetToFill.length === 0 ? (
              <p className="flex items-center gap-2 text-[13px] font-medium text-[#334155]">
                <CheckCircle2 size={15} style={{ color: "var(--color-green)" }} />
                Everyone has filled their checklist.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {yetToFill.map((r) => (
                  <Link
                    key={r.person.id}
                    href={`/dcc?emp=${r.person.id}&view=grid`}
                    className="inline-flex h-8 max-w-[260px] items-center gap-2 rounded-lg border border-[#DCE4F0] bg-white pl-2.5 pr-1.5 text-[12.5px] font-semibold text-[#0B1F44] transition-colors hover:border-[#B9C6DB] hover:bg-[#F8FAFD]"
                  >
                    <span className="truncate" title={r.person.name}>
                      {r.person.name}
                    </span>
                    <span
                      className="shrink-0 rounded-md px-1.5 py-px text-[11.5px] font-semibold tabular-nums"
                      style={{ background: "var(--color-amber-bg)", color: "var(--color-amber-deep)" }}
                    >
                      {r.day.filled}/{r.day.due}
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </section>
      </main>
    </>
  );
}

const CARD = "overflow-hidden rounded-xl border border-[#DCE4F0] bg-white shadow-[0_1px_2px_rgba(11,31,68,0.05)]";

/** First, second and third: a quiet gold, silver and bronze tint — readable, not decorative. */
const TOP_TINT = [
  { bg: "#FFF8E7", fg: "#8A6410", border: "#F2DDA4" },
  { bg: "#F3F5F8", fg: "#475569", border: "#D5DCE6" },
  { bg: "#FBF2EA", fg: "#8A5531", border: "#ECCFB7" },
];

function Pct({ stats }: { stats: { due: number; done: number; pct: number } }) {
  const tone = pctTone(stats.pct);
  return (
    <td className="px-3 py-2 text-right tabular-nums" style={{ color: stats.due === 0 ? "#94A3B8" : tone.fg }}>
      {stats.due === 0 ? (
        "—"
      ) : (
        <>
          <span className="font-semibold">{stats.pct}%</span>
          <span className="ml-1.5 text-[11.5px] font-normal text-[#94A3B8]">
            {stats.done}/{stats.due}
          </span>
        </>
      )}
    </td>
  );
}

/** A summary tile: white with a thin blue top edge; the value keeps the compliance colour. */
function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone: number }) {
  const t = pctTone(tone);
  return (
    <div className="flex h-[76px] flex-col justify-between rounded-xl border border-[#DCE4F0] bg-white px-4 py-3 shadow-[inset_0_2px_0_#0A6CFF,0_1px_2px_rgba(11,31,68,0.05)]">
      <div className="text-[12px] font-semibold text-[#5B6B85]">{label}</div>
      <div className="flex items-baseline gap-1">
        <span className="text-[22px] font-bold leading-none tabular-nums" style={{ color: t.fg }}>
          {value}
        </span>
        {sub && <span className="text-[13px] font-semibold tabular-nums" style={{ color: t.fg }}>{sub}</span>}
      </div>
    </div>
  );
}
