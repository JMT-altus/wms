import type { CollectionParty } from "@/lib/collections/source";

/**
 * Pure helpers for the Collection screens. No database, no clock, and no
 * accounting rule: nothing here works out an outstanding balance or decides who
 * collects from whom — those arrive on each party from the source.
 */

export interface FollowUpEntry {
  id: string;
  partyName: string;
  /** YYYY-MM-DD, or null for a note-only entry. */
  nextFollowupDate: string | null;
  note: string | null;
  createdByName: string | null;
  createdAt: Date;
}

/** One key for a party's name, so "ABC Traders " and "abc traders" are the same party. */
export const partyKey = (name: string): string => name.trim().toLowerCase();

export interface PartyRow extends CollectionParty {
  /** The next follow-up date from the party's latest entry that has one. */
  nextFollowupDate: string | null;
  /** Most recent first. */
  history: FollowUpEntry[];
}

/** Join the source's parties with their saved follow-ups. */
export function buildRows(parties: CollectionParty[], followUps: FollowUpEntry[]): PartyRow[] {
  const byParty = new Map<string, FollowUpEntry[]>();
  for (const f of followUps) {
    const k = partyKey(f.partyName);
    const list = byParty.get(k);
    if (list) list.push(f);
    else byParty.set(k, [f]);
  }
  return parties.map((p) => {
    const history = [...(byParty.get(partyKey(p.partyName)) ?? [])].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    );
    return {
      ...p,
      history,
      nextFollowupDate: history.find((h) => h.nextFollowupDate)?.nextFollowupDate ?? null,
    };
  });
}

export interface TrackerFilters {
  query: string;
  collectionPerson: string; // "" = all
  /** "" = all, "none" = no follow-up date set, "due" = date today or earlier. */
  followUp: "" | "none" | "due";
}

export function filterRows(rows: PartyRow[], f: TrackerFilters, todayIso: string): PartyRow[] {
  const q = f.query.trim().toLowerCase();
  return rows.filter((r) => {
    if (q) {
      const hay = [r.partyName, r.collectionPerson ?? "", r.coordinatorLabel ?? "", ...r.history.map((h) => h.note ?? "")]
        .join(" ")
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (f.collectionPerson && r.collectionPerson !== f.collectionPerson) return false;
    if (f.followUp === "none" && r.nextFollowupDate) return false;
    if (f.followUp === "due" && !(r.nextFollowupDate && r.nextFollowupDate <= todayIso)) return false;
    return true;
  });
}

export type SortKey = "party" | "debit" | "credit" | "person" | "next";

/** Nulls sort last in both directions, so a blank never leads the list. */
export function sortRows(rows: PartyRow[], key: SortKey, dir: "asc" | "desc"): PartyRow[] {
  const sign = dir === "asc" ? 1 : -1;
  const val = (r: PartyRow): string | number | null =>
    key === "party"
      ? r.partyName.toLowerCase()
      : key === "debit"
        ? r.debit
        : key === "credit"
          ? r.credit
          : key === "person"
            ? (r.collectionPerson?.toLowerCase() ?? null)
            : r.nextFollowupDate;
  return [...rows].sort((a, b) => {
    const x = val(a);
    const y = val(b);
    if (x === null && y === null) return 0;
    if (x === null) return 1;
    if (y === null) return -1;
    return x < y ? -sign : x > y ? sign : 0;
  });
}

/**
 * Ranking by the outstanding figure the SOURCE supplied. Parties with no figure
 * are left out rather than ranked as zero.
 */
export function topByOutstanding(parties: CollectionParty[], n: number): CollectionParty[] {
  return parties
    .filter((p): p is CollectionParty & { outstanding: number } => p.outstanding !== null)
    .sort((a, b) => b.outstanding - a.outstanding)
    .slice(0, n);
}

/**
 * One row per collection person: how many parties they hold and the outstanding
 * the source supplied for them (null if it supplied none). Same figures as
 * everywhere else — nothing recalculated.
 */
export function personSummary(
  parties: CollectionParty[],
): { person: string; parties: number; total: number | null }[] {
  const m = new Map<string, { parties: number; total: number | null }>();
  for (const p of parties) {
    if (!p.collectionPerson) continue;
    const cur = m.get(p.collectionPerson) ?? { parties: 0, total: null };
    cur.parties += 1;
    if (p.outstanding !== null) cur.total = (cur.total ?? 0) + p.outstanding;
    m.set(p.collectionPerson, cur);
  }
  return [...m.entries()]
    .map(([person, v]) => ({ person, ...v }))
    .sort((a, b) => (b.total ?? -1) - (a.total ?? -1) || a.person.localeCompare(b.person));
}

/** Outstanding per collection person, from the same supplied figures. */
export function outstandingByPerson(parties: CollectionParty[]): { person: string; total: number }[] {
  const m = new Map<string, number>();
  for (const p of parties) {
    if (p.outstanding === null || !p.collectionPerson) continue;
    m.set(p.collectionPerson, (m.get(p.collectionPerson) ?? 0) + p.outstanding);
  }
  return [...m.entries()].map(([person, total]) => ({ person, total })).sort((a, b) => b.total - a.total);
}
