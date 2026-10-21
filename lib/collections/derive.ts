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
  /** Current Collection Amount Confirmation (newest answer); null = not set. Visible to all Tracker users. */
  confirmation?: { value: "yes" | "no"; recordedAt: Date; recordedByName: string | null } | null;
  /** The open escalation awaiting review, if any (who and when — no commitment data). */
  openEscalation?: { escalatedAt: Date; escalatedByName: string | null } | null;
}

/**
 * Saved follow-ups grouped by party (partyKey), each list most recent first.
 * The one matching rule for "which company a comment belongs to" — the Tracker
 * and the commitments page both use it, so they can never disagree.
 */
export function followUpsByParty(followUps: FollowUpEntry[]): Map<string, FollowUpEntry[]> {
  const byParty = new Map<string, FollowUpEntry[]>();
  for (const f of followUps) {
    const k = partyKey(f.partyName);
    const list = byParty.get(k);
    if (list) list.push(f);
    else byParty.set(k, [f]);
  }
  for (const list of byParty.values()) list.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  return byParty;
}

/** A party's comments as the Tracker shows them: entries that carry a note, most recent first. */
export const commentsOf = (history: FollowUpEntry[]): FollowUpEntry[] => history.filter((h) => h.note);

/** Join the source's parties with their saved follow-ups. */
export function buildRows(parties: CollectionParty[], followUps: FollowUpEntry[]): PartyRow[] {
  const byParty = followUpsByParty(followUps);
  return parties.map((p) => {
    const history = [...(byParty.get(partyKey(p.partyName)) ?? [])];
    return {
      ...p,
      history,
      nextFollowupDate: history.find((h) => h.nextFollowupDate)?.nextFollowupDate ?? null,
    };
  });
}

/** Filter value for "no collection person assigned". */
export const UNASSIGNED_PERSON = "__unassigned__";
/** How companies with no collection person are labelled in lists, filters and summaries. */
export const UNASSIGNED_LABEL = "Unassigned";

/**
 * The collection person shown for a row: the one the loader set from the
 * Collection Master, else the coordinator label (rows built elsewhere).
 */
export const personOf = (r: CollectionParty): string | null => r.collectionPerson ?? r.coordinatorLabel ?? null;

export interface TrackerFilters {
  query: string;
  collectionPerson: string; // "" = all, UNASSIGNED_PERSON = none assigned
  /** "" = all, "none" = no follow-up date set, "due" = date today or earlier. */
  followUp: "" | "none" | "due";
}

export function filterRows(rows: PartyRow[], f: TrackerFilters, todayIso: string): PartyRow[] {
  const q = f.query.trim().toLowerCase();
  return rows.filter((r) => {
    if (q) {
      const hay = [r.partyName, personOf(r) ?? "", ...r.history.map((h) => h.note ?? "")]
        .join(" ")
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (f.collectionPerson === UNASSIGNED_PERSON ? personOf(r) !== null : f.collectionPerson && personOf(r) !== f.collectionPerson) return false;
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
            ? (personOf(r)?.toLowerCase() ?? null)
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
 * Group key for a party: its collection person (the same `personOf` the Tracker
 * uses), or UNASSIGNED_PERSON. A separate key, so a coordinator literally named
 * "Unassigned" can never be merged with the unassigned companies.
 */
const groupOf = (p: CollectionParty): string => personOf(p) ?? UNASSIGNED_PERSON;
const labelOf = (key: string): string => (key === UNASSIGNED_PERSON ? UNASSIGNED_LABEL : key);
/** Totals first, then name; Unassigned after named people on a tie. */
const byTotalThenName = <T extends { person: string; unassigned?: true }>(t: (x: T) => number) => (a: T, b: T) =>
  t(b) - t(a) || Number(!!a.unassigned) - Number(!!b.unassigned) || a.person.localeCompare(b.person);

/**
 * One row per collection person: how many parties they hold and the outstanding
 * the source supplied for them (null if it supplied none). Same figures as
 * everywhere else — nothing recalculated. Companies with no collection person
 * form one "Unassigned" row (marked `unassigned: true`), so every party is
 * counted exactly once and the rows add up to the whole list.
 */
export function personSummary(
  parties: CollectionParty[],
): { person: string; parties: number; total: number | null; unassigned?: true }[] {
  const m = new Map<string, { parties: number; total: number | null }>();
  for (const p of parties) {
    const k = groupOf(p);
    const cur = m.get(k) ?? { parties: 0, total: null };
    cur.parties += 1;
    if (p.outstanding !== null) cur.total = (cur.total ?? 0) + p.outstanding;
    m.set(k, cur);
  }
  return [...m.entries()]
    .map(([k, v]) => ({ person: labelOf(k), ...v, ...(k === UNASSIGNED_PERSON ? { unassigned: true as const } : {}) }))
    .sort(byTotalThenName((x) => x.total ?? -1));
}

/**
 * Outstanding per collection person, from the same supplied figures; companies
 * with no collection person are one "Unassigned" entry, counted once.
 */
export function outstandingByPerson(parties: CollectionParty[]): { person: string; total: number; unassigned?: true }[] {
  const m = new Map<string, number>();
  for (const p of parties) {
    if (p.outstanding === null) continue;
    const k = groupOf(p);
    m.set(k, (m.get(k) ?? 0) + p.outstanding);
  }
  return [...m.entries()]
    .map(([k, total]) => ({ person: labelOf(k), total, ...(k === UNASSIGNED_PERSON ? { unassigned: true as const } : {}) }))
    .sort(byTotalThenName((x) => x.total));
}
