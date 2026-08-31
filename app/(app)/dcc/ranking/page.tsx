import Link from "next/link";
import { DashboardHeader } from "@/components/layout/header";
import { DashboardFooter } from "@/components/layout/footer";
import { EmployeeAvatar } from "@/components/ui/employee-avatar";
import { requireUser } from "@/lib/auth/current";
import {
  listAllActivePeople,
  listItemsForOwners,
  listEntriesForOwners,
} from "@/lib/queries/dcc";
import { todayIso, addDays, pctTone } from "@/lib/dcc/util";
import {
  indexEntries,
  computeStreak,
  windowStats,
  rankScore,
  type BoardItem,
  type BoardEntry,
} from "@/lib/dcc/board-model";
import { Flame, Trophy } from "lucide-react";

export const dynamic = "force-dynamic";

/** The ranking window. */
const WINDOW_DAYS = 30;

interface Ranked {
  id: string;
  name: string;
  pct: number;
  streak: number;
  score: number;
  due: number;
  done: number;
}

export default async function DccRankingPage() {
  await requireUser();

  const today = todayIso();
  // The streak walk can reach back past the scoring window, so load a little
  // more history than WINDOW_DAYS.
  const from = addDays(today, -(WINDOW_DAYS + 30));

  const people = await listAllActivePeople();
  const ownerIds = people.map((p) => p.id);
  const [items, entries] = await Promise.all([
    listItemsForOwners(ownerIds),
    listEntriesForOwners(ownerIds, from),
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

  const ranked: Ranked[] = [];
  for (const p of people) {
    const ownerItems = itemsByOwner.get(p.id) ?? [];
    // Nobody is ranked last for having no checklist yet.
    if (ownerItems.length === 0) continue;
    const slots = indexEntries(entriesByOwner.get(p.id) ?? []);
    const w = windowStats(ownerItems, slots, today, WINDOW_DAYS);
    if (w.due === 0) continue; // no due days in the window — not scored
    const streak = computeStreak(ownerItems, slots, today);
    ranked.push({
      id: p.id,
      name: p.name,
      pct: w.pct,
      streak,
      score: rankScore(w.pct, streak),
      due: w.due,
      done: w.done,
    });
  }

  ranked.sort((a, b) => b.score - a.score || b.pct - a.pct || b.streak - a.streak);

  const podium = ranked.slice(0, 3);
  const rest = ranked.slice(3);
  // Visual order puts 1st in the middle, raised above 2nd and 3rd.
  const podiumOrder = [podium[1], podium[0], podium[2]].filter(Boolean) as Ranked[];

  return (
    <>
      <DashboardHeader generatedAt={new Date()} />
      <main className="mx-auto w-full max-w-[var(--max-content)] space-y-5 px-6 py-6 max-md:px-4">
        <div>
          <h1
            className="text-display-md text-ink-strong"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            DCC Ranking
          </h1>
          <p className="mt-1 text-[13.5px] text-ink-subtle">
            Last {WINDOW_DAYS} days. Score = 80% compliance + 20% consistency (streak,
            capped at 30 days).
          </p>
        </div>

        {ranked.length === 0 ? (
          <div className="rounded-[22px] border border-hairline bg-surface-card px-6 py-14 text-center">
            <Trophy size={40} className="mx-auto mb-3 text-ink-subtle" />
            <p className="text-[15px] font-bold text-ink-strong">Nothing to rank yet.</p>
            <p className="mt-1 text-[13px] text-ink-subtle">
              Once checklists have due days in the window, the ranking fills in.
            </p>
          </div>
        ) : (
          <>
            <section className="rounded-[22px] border border-hairline bg-surface-card p-6">
              <div className="flex items-end justify-center gap-4 max-sm:gap-2">
                {podiumOrder.map((r) => {
                  const rank = ranked.indexOf(r) + 1;
                  const isFirst = rank === 1;
                  return (
                    <Link
                      key={r.id}
                      href={`/dcc?emp=${r.id}`}
                      className="flex flex-1 flex-col items-center gap-2 transition hover:opacity-90"
                      style={{ maxWidth: 200 }}
                    >
                      <EmployeeAvatar
                        name={r.name}
                        size={isFirst ? "lg" : "md"}
                        background={MEDAL_BG[rank - 1]}
                      />
                      <div className="text-center">
                        <div
                          className="truncate text-[13.5px] font-bold text-ink-strong"
                          style={{ maxWidth: 160 }}
                        >
                          {r.name}
                        </div>
                        <div
                          className="text-[26px] font-black leading-tight tabular-nums"
                          style={{
                            color: pctTone(r.pct).fg,
                            fontFamily: "var(--font-serif)",
                          }}
                        >
                          {r.score}
                        </div>
                      </div>
                      <div
                        className="flex w-full items-start justify-center rounded-t-[12px] pt-2 text-[12px] font-black text-white tabular-nums"
                        style={{
                          height: isFirst ? 84 : 56,
                          background: MEDAL_BG[rank - 1],
                        }}
                      >
                        {rank}
                      </div>
                    </Link>
                  );
                })}
              </div>
            </section>

            {rest.length > 0 && (
              <section className="rounded-[22px] border border-hairline bg-surface-card p-4">
                <ol className="space-y-1">
                  {rest.map((r, idx) => {
                    const tone = pctTone(r.pct);
                    return (
                      <li key={r.id}>
                        <Link
                          href={`/dcc?emp=${r.id}`}
                          className="flex items-center gap-3 rounded-[12px] px-3 py-2.5 transition hover:bg-surface-soft"
                        >
                          <span className="w-6 shrink-0 text-center text-[13px] font-black text-ink-subtle tabular-nums">
                            {idx + 4}
                          </span>
                          <EmployeeAvatar name={r.name} size="sm" />
                          <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-ink-strong">
                            {r.name}
                          </span>
                          {r.streak > 0 && (
                            <span className="flex items-center gap-1 text-[12px] font-bold text-ink-muted tabular-nums">
                              <Flame size={13} style={{ color: "var(--color-orange)" }} />
                              {r.streak}
                            </span>
                          )}
                          <span
                            className="w-[52px] text-right text-[13px] font-bold tabular-nums"
                            style={{ color: tone.fg }}
                          >
                            {r.pct}%
                          </span>
                          <span className="w-[42px] text-right text-[14px] font-black text-ink-strong tabular-nums">
                            {r.score}
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ol>
              </section>
            )}
          </>
        )}
      </main>
      <DashboardFooter />
    </>
  );
}

const MEDAL_BG = [
  "linear-gradient(145deg,#E6C244,#B8912A)",
  "linear-gradient(145deg,#C9CDD3,#9099A3)",
  "linear-gradient(145deg,#CD8B54,#9C6234)",
];
