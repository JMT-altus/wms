import Link from "next/link";
import { DashboardHeader } from "@/components/layout/header";
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
  toBoardItem,
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
    list.push(toBoardItem(i));
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

  return (
    <>
      <DashboardHeader generatedAt={new Date()} />
      <main className="dcc-page dcc-summary-page mx-auto w-full max-w-[1480px] space-y-3 px-10 pb-10 pt-4 max-lg:px-6 max-md:px-4">
        <header>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-[#0B1F44]">DCC Ranking</h1>
            <span className="rounded-full border border-[#C9DAFB] bg-[#EEF4FF] px-2 py-0.5 text-[11.5px] font-semibold text-[#0B4FB8]">
              Last {WINDOW_DAYS} days
            </span>
          </div>
          <p className="mt-1 text-[12.5px] text-[#5B6B85]">
            Score = 80% compliance + 20% consistency (streak, capped at 30 days). Click a name to open their checklist.
          </p>
        </header>

        {ranked.length === 0 ? (
          <div className="rounded-xl border border-[#DCE4F0] bg-white px-6 py-10 text-center shadow-[0_1px_2px_rgba(11,31,68,0.05)]">
            <Trophy size={26} className="mx-auto mb-2 text-[#94A3B8]" />
            <p className="text-[14px] font-semibold text-[#0B1F44]">Nothing to rank yet.</p>
            <p className="mt-1 text-[12.5px] text-[#64748B]">Once checklists have due days in the window, the ranking fills in.</p>
          </div>
        ) : (
          <>
            {/* The top three, in rank order — a quiet tint per position. */}
            <section aria-label="Top three" className="grid grid-cols-3 gap-3 max-md:grid-cols-1">
              {podium.map((r, i) => {
                const tone = pctTone(r.pct);
                const tint = TOP_TINT[i]!;
                return (
                  <Link
                    key={r.id}
                    href={`/dcc?emp=${r.id}`}
                    className="flex min-w-0 items-center gap-3 rounded-xl border bg-white px-4 py-3 transition-colors hover:bg-[#F8FAFF]"
                    style={{ borderColor: tint.border, boxShadow: `inset 0 3px 0 ${tint.edge}, 0 1px 2px rgba(11,31,68,0.05)` }}
                  >
                    <span
                      className="grid size-7 shrink-0 place-items-center rounded-full text-[12.5px] font-bold tabular-nums"
                      style={{ background: tint.bg, color: tint.fg, border: `1px solid ${tint.border}` }}
                      aria-label={`Rank ${i + 1}`}
                    >
                      {i + 1}
                    </span>
                    <EmployeeAvatar name={r.name} size="md" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-semibold text-[#0B1F44]" title={r.name}>
                        {r.name}
                      </span>
                      <span className="mt-0.5 flex items-center gap-2.5 text-[12px] tabular-nums text-[#64748B]">
                        <span>
                          Compliance{" "}
                          <span className="font-semibold" style={{ color: tone.fg }}>
                            {r.pct}%
                          </span>
                        </span>
                        {r.streak > 0 && (
                          <span className="inline-flex items-center gap-0.5 font-medium text-[#475569]">
                            <Flame size={12} style={{ color: "var(--color-orange)" }} />
                            {r.streak}
                          </span>
                        )}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block text-[22px] font-bold leading-none tabular-nums text-[#0B1F44]">{r.score}</span>
                      <span className="text-[11px] font-semibold text-[#94A3B8]">Score</span>
                    </span>
                  </Link>
                );
              })}
            </section>

            {rest.length > 0 && (
              <div className="overflow-x-auto shadow-[0_1px_2px_rgba(11,31,68,0.05)]">
                <table className="w-full min-w-[560px] border-collapse bg-white text-[13px]" aria-label="Ranking">
                  <thead>
                    <tr>
                      <th scope="col" className="w-16 text-left">Rank</th>
                      <th scope="col" className="text-left">Employee</th>
                      <th scope="col" className="w-28 text-right">Streak</th>
                      <th scope="col" className="w-32 text-right">Compliance</th>
                      <th scope="col" className="w-28 text-right">Score</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rest.map((r, idx) => {
                      const tone = pctTone(r.pct);
                      return (
                        <tr key={r.id}>
                          <td className="px-3 py-2 font-semibold tabular-nums text-[#64748B]">{idx + 4}</td>
                          <td className="max-w-[420px] px-3 py-2">
                            <Link href={`/dcc?emp=${r.id}`} className="group flex min-w-0 items-center gap-2.5">
                              <EmployeeAvatar name={r.name} size="sm" />
                              <span className="truncate font-semibold text-[#0B1F44] group-hover:text-[#0B4FB8] group-hover:underline" title={r.name}>
                                {r.name}
                              </span>
                            </Link>
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {r.streak > 0 ? (
                              <span className="inline-flex items-center gap-1 font-medium text-[#475569]">
                                <Flame size={12} style={{ color: "var(--color-orange)" }} />
                                {r.streak}
                              </span>
                            ) : (
                              <span className="text-[#94A3B8]">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right font-semibold tabular-nums" style={{ color: tone.fg }}>
                            {r.pct}%
                          </td>
                          <td className="px-3 py-2 text-right font-bold tabular-nums text-[#0B1F44]">{r.score}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </main>
    </>
  );
}

/** First, second and third: a quiet gold, silver and bronze tint — readable, not decorative. */
const TOP_TINT = [
  { bg: "#FFF8E7", fg: "#8A6410", border: "#EBD9A6", edge: "#E0B84A" },
  { bg: "#F3F5F8", fg: "#475569", border: "#D5DCE6", edge: "#A7B1C0" },
  { bg: "#FBF2EA", fg: "#8A5531", border: "#E8D0BC", edge: "#C98C5E" },
];
