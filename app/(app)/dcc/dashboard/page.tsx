import Link from "next/link";
import { DashboardHeader } from "@/components/layout/header";
import { DashboardFooter } from "@/components/layout/footer";
import { EmployeeAvatar } from "@/components/ui/employee-avatar";
import { requireUser } from "@/lib/auth/current";
import { getDccScope } from "@/lib/dcc/access";
import {
  listDccPeople,
  listItemsForOwners,
  listEntriesForOwners,
  listReviewsForOwners,
} from "@/lib/queries/dcc";
import { todayIso, addDays, pctTone, pctOf } from "@/lib/dcc/util";
import {
  indexEntries,
  summarisePerson,
  windowStats,
  type BoardItem,
  type BoardEntry,
} from "@/lib/dcc/board-model";
import { Flame, CheckCircle2, AlertTriangle, Users } from "lucide-react";

export const dynamic = "force-dynamic";

/** 28 days covers the 7-day leaderboard and leaves room for the streak walk. */
const HISTORY_DAYS = 28;

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
            <p className="text-[15px] font-bold text-ink-strong">
              This dashboard is for managers and admins.
            </p>
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
  const from = addDays(today, -HISTORY_DAYS);
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
    list.push({
      id: i.id,
      section: i.section,
      code: i.code,
      title: i.title,
      frequency: i.frequency,
      weekdays: i.weekdays,
      scheduleKind: i.scheduleKind,
      isParticipantList: i.isParticipantList,
      clientId: i.clientId,
      needsReview: i.needsReview,
      targetNumber: i.targetNumber,
      unit: i.unit,
      sortOrder: i.sortOrder,
    });
    itemsByOwner.set(i.ownerEmployeeId, list);
  }

  const entriesByOwner = new Map<string, BoardEntry[]>();
  for (const e of entries) {
    const list = entriesByOwner.get(e.ownerId) ?? [];
    list.push({
      itemId: e.itemId,
      entryDate: e.entryDate,
      status: e.status,
      valueNumber: e.valueNumber,
      note: e.note,
      subjectId: e.subjectId,
    });
    entriesByOwner.set(e.ownerId, list);
  }

  const reviewToday = new Map(
    reviews.filter((r) => r.reviewDate === today).map((r) => [r.ownerEmployeeId, r]),
  );

  const rows = people.map((p) => {
    const ownerItems = itemsByOwner.get(p.id) ?? [];
    const slots = indexEntries(entriesByOwner.get(p.id) ?? []);
    const day = summarisePerson(p.id, ownerItems, slots, today);
    const week = windowStats(ownerItems, slots, today, 7);
    return { person: p, day, week, review: reviewToday.get(p.id) ?? null };
  });

  const withDue = rows.filter((r) => r.day.due > 0);
  const filledPct = pctOf(
    withDue.reduce((n, r) => n + r.day.filled, 0),
    withDue.reduce((n, r) => n + r.day.due, 0),
  );
  const donePct = pctOf(
    withDue.reduce((n, r) => n + r.day.done, 0),
    withDue.reduce((n, r) => n + r.day.due, 0),
  );
  const onTrack = withDue.filter((r) => r.day.pct >= 80).length;
  const yetToFill = withDue.filter((r) => r.day.filled < r.day.due);

  const leaders = rows
    .filter((r) => r.week.due > 0)
    .sort((a, b) => b.week.pct - a.week.pct)
    .slice(0, 5);

  return (
    <>
      <DashboardHeader generatedAt={new Date()} />
      <main className="mx-auto w-full max-w-[var(--max-content)] space-y-4 px-6 py-6 max-md:px-4">
        <div>
          <h1
            className="text-display-md text-ink-strong"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            DCC — Team
          </h1>
          <p className="mt-1 text-[13.5px] text-ink-subtle">
            Compliance across everyone reporting to you, for {today}.
          </p>
        </div>

        <div className="grid grid-cols-4 gap-3 max-lg:grid-cols-2">
          <Tile label="Filled today" value={`${filledPct}%`} tone={filledPct} />
          <Tile label="Done today" value={`${donePct}%`} tone={donePct} />
          <Tile
            label="People on track"
            value={`${onTrack}/${withDue.length}`}
            tone={pctOf(onTrack, withDue.length)}
          />
          <Tile
            label="Need to fill"
            value={String(yetToFill.length)}
            tone={yetToFill.length === 0 ? 100 : 0}
          />
        </div>

        {/* Roster */}
        <section className="rounded-[22px] border border-hairline bg-surface-card p-4">
          <h2 className="text-kpi-label mb-3 text-ink-subtle">Team roster (today)</h2>
          <ul className="space-y-1.5">
            {rows.map(({ person, day, review }) => {
              const tone = pctTone(day.pct);
              return (
                <li key={person.id}>
                  <Link
                    href={`/dcc?emp=${person.id}`}
                    className="flex items-center gap-3 rounded-[12px] border border-hairline px-3 py-2.5 transition hover:bg-surface-soft"
                  >
                    <EmployeeAvatar name={person.name} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="text-[14px] font-bold text-ink-strong">
                        {person.name}
                        {person.id === me.id && (
                          <span className="ml-1.5 text-[12px] font-normal text-ink-subtle">
                            (me)
                          </span>
                        )}
                      </div>
                      <div className="text-[11.5px] text-ink-subtle tabular-nums">
                        {day.itemCount} KPIs · {day.due} due today
                      </div>
                    </div>

                    {day.streak > 0 && (
                      <span className="flex items-center gap-1 text-[12px] font-bold text-ink-muted tabular-nums">
                        <Flame size={13} style={{ color: "var(--color-orange)" }} />
                        {day.streak}
                      </span>
                    )}

                    <div className="w-[120px] shrink-0 max-sm:hidden">
                      <div className="h-1.5 overflow-hidden rounded-full bg-surface-track">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${day.due === 0 ? 0 : Math.min(100, day.pct)}%`,
                            background: tone.solid,
                          }}
                        />
                      </div>
                    </div>
                    <span
                      className="w-[54px] shrink-0 text-right text-[12.5px] font-bold tabular-nums"
                      style={{ color: day.due === 0 ? "var(--color-ink-subtle)" : tone.fg }}
                    >
                      {day.due === 0 ? "—" : `${day.done}/${day.due}`}
                    </span>

                    {review?.status === "approved" ? (
                      <CheckCircle2 size={16} style={{ color: "var(--color-green)" }} />
                    ) : review?.status === "needs_rework" ? (
                      <AlertTriangle size={16} style={{ color: "var(--color-amber)" }} />
                    ) : (
                      <span className="w-4" />
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>

        <div className="grid grid-cols-2 gap-4 max-lg:grid-cols-1">
          <section className="rounded-[22px] border border-hairline bg-surface-card p-4">
            <h2 className="text-kpi-label mb-3 text-ink-subtle">7-day leaders</h2>
            {leaders.length === 0 ? (
              <p className="py-4 text-[13px] text-ink-subtle">Nothing scored yet.</p>
            ) : (
              <ol className="space-y-1.5">
                {leaders.map((r, idx) => {
                  const tone = pctTone(r.week.pct);
                  return (
                    <li key={r.person.id} className="flex items-center gap-3 px-1 py-1.5">
                      <span
                        className="grid size-6 shrink-0 place-items-center rounded-full text-[12px] font-black tabular-nums"
                        style={{
                          background: MEDAL[idx] ?? "var(--color-surface-track)",
                          color: idx < 3 ? "#fff" : "var(--color-ink-muted)",
                        }}
                      >
                        {idx + 1}
                      </span>
                      <EmployeeAvatar name={r.person.name} size="sm" />
                      <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold text-ink-strong">
                        {r.person.name}
                      </span>
                      <span
                        className="text-[13px] font-black tabular-nums"
                        style={{ color: tone.fg }}
                      >
                        {r.week.pct}%
                      </span>
                    </li>
                  );
                })}
              </ol>
            )}
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
                    href={`/dcc?emp=${r.person.id}`}
                    className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12.5px] font-semibold transition hover:brightness-95"
                    style={{
                      background: "var(--color-amber-bg)",
                      borderColor: "var(--color-amber)",
                      color: "var(--color-amber-deep)",
                    }}
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
        </div>
      </main>
      <DashboardFooter />
    </>
  );
}

const MEDAL = ["#D4AF37", "#9CA3AF", "#B87333"];

function Tile({ label, value, tone }: { label: string; value: string; tone: number }) {
  const t = pctTone(tone);
  return (
    <div className="rounded-kpi border border-hairline bg-surface-card p-4">
      <div className="text-kpi-label mb-2 text-ink-subtle">{label}</div>
      <div
        className="text-[30px] font-black leading-none tabular-nums"
        style={{ color: t.fg, fontFamily: "var(--font-serif)" }}
      >
        {value}
      </div>
    </div>
  );
}
