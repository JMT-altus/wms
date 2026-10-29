import { formatInrExact } from "@/lib/collections/money";
import type { CollectionParty, TransactionSourceInfo } from "@/lib/collections/source";

/**
 * Salesperson scorecards for the Collection Tracker. Pure — safe for client components.
 *
 * The Tracker shows ONE scorecard: the signed-in employee's own (scorecardFor). Which
 * salesperson they are is resolved on the server from the super-admin-kept link only
 * (lib/collections/salesperson-identity.ts); without one the view is "unmapped" (or
 * "not-salesperson") and no salesperson's figures are computed or sent.
 *
 * The "salesperson" is the Sales Coordinator LABEL the Collection Master holds for a
 * company (`coordinatorLabel`) — the same assignment the Tracker shows. It is a
 * label, not an employee account; companies without one form "Unassigned". Every
 * figure is an overall total over the assigned companies (the Tracker's filters do
 * not change it).
 *
 *   A/B  Clients with outstanding pending / total outstanding: ONLY from an approved
 *        transaction source with a verified company-level figure. With no approved
 *        source (today) they are "not configured" — never 0. A company without a
 *        verified figure is never counted as zero.
 *   C/D  Escalations and those resolved by the reviewer: counted on the server from
 *        the escalation records (lib/queries/collection-scorecards.ts), and only for
 *        holders of collection.escalation.review; anyone else sees "restricted".
 */

export const UNASSIGNED_SALESPERSON = "Unassigned";

export type OutstandingMetrics =
  | { status: "not-configured" }
  /** totalPaise: exact whole paise as decimal text (serialises safely to the browser). */
  | { status: "ok"; clientsPending: number; totalPaise: string; verifiedClients: number; unverifiedClients: number };

export type EscalationMetrics =
  | { status: "restricted" }
  | { status: "unavailable" }
  | { status: "ok"; escalated: number; resolvedByReviewer: number };

export interface Scorecard {
  salesperson: string;
  clients: number;
  outstanding: OutstandingMetrics;
  escalations: EscalationMetrics;
}

/**
 * What the Tracker is given: the signed-in salesperson's own card, or why there is none —
 *   "unmapped"         no link configured yet (an administrator can add one);
 *   "not-salesperson"  explicitly not a Sales Coordinator;
 *   "not-installed"    the link table is missing (migration 0120 not applied) — nobody can link anyone yet;
 *   "unavailable"      the link couldn't be read (a database error) — NOT a missing link.
 */
export type ScorecardView =
  | { status: "unmapped" }
  | { status: "not-salesperson" }
  | { status: "not-installed" }
  | { status: "unavailable" }
  | { status: "ok"; card: Scorecard };

/** One salesperson's escalation figures (counted on the server for that label only). */
export interface OwnEscalationCounts {
  escalated: number;
  resolvedByReviewer: number;
}

/** Per-salesperson escalation counts, keyed by the label exactly as in the Collection Master (null = unassigned). */
export type EscalationCounts = Map<string | null, { escalated: number; resolvedByReviewer: number }>;

const labelOf = (p: Pick<CollectionParty, "coordinatorLabel">) => p.coordinatorLabel ?? null;
/** A verified figure in whole paise, or null (missing, null, non-finite — never treated as zero). */
export function verifiedPaise(v: unknown): bigint | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return BigInt(Math.round(v * 100));
}

/**
 * One card per salesperson label that has at least one company (plus "Unassigned"
 * when some company has none). Clients are counted by distinct Collection Master id.
 * `escalations`: null = the viewer may not see escalation figures; "error" = they
 * could not be read.
 */
export function buildScorecards(
  parties: Pick<CollectionParty, "masterId" | "coordinatorLabel" | "outstanding">[],
  source: Pick<TransactionSourceInfo, "approved"> | undefined,
  escalations: EscalationCounts | null | "error",
): Scorecard[] {
  const groups = new Map<string | null, Map<string, Pick<CollectionParty, "outstanding">>>();
  for (const p of parties) {
    if (!p.masterId) continue; // only Collection Master companies are assigned
    const key = labelOf(p);
    const g = groups.get(key) ?? new Map();
    g.set(p.masterId, p); // distinct client ids
    groups.set(key, g);
  }
  const approved = source?.approved === true;
  const cards: Scorecard[] = [];
  for (const [label, clients] of groups) {
    let outstanding: OutstandingMetrics = { status: "not-configured" };
    if (approved) {
      let clientsPending = 0, totalPaise = 0n, verifiedClients = 0, unverifiedClients = 0;
      for (const c of clients.values()) {
        const paise = verifiedPaise(c.outstanding);
        if (paise === null) {
          unverifiedClients++;
          continue;
        }
        verifiedClients++;
        if (paise > 0n) {
          clientsPending++;
          totalPaise += paise;
        }
      }
      outstanding = { status: "ok", clientsPending, totalPaise: totalPaise.toString(), verifiedClients, unverifiedClients };
    }
    const counts = escalations instanceof Map ? escalations.get(label) : undefined;
    cards.push({
      salesperson: label ?? UNASSIGNED_SALESPERSON,
      clients: clients.size,
      outstanding,
      escalations:
        escalations === null ? { status: "restricted" }
        : escalations === "error" ? { status: "unavailable" }
        : { status: "ok", escalated: counts?.escalated ?? 0, resolvedByReviewer: counts?.resolvedByReviewer ?? 0 },
    });
  }
  // Named salespeople A–Z, "Unassigned" last.
  return cards.sort((a, b) =>
    a.salesperson === UNASSIGNED_SALESPERSON ? 1 : b.salesperson === UNASSIGNED_SALESPERSON ? -1 : a.salesperson.localeCompare(b.salesperson),
  );
}

/**
 * The card for ONE salesperson label, from that label's companies only (distinct
 * Collection Master ids). Other labels' companies are ignored entirely. A label
 * with no companies gets a card with 0 clients — never anyone else's figures.
 */
export function scorecardFor(
  label: string,
  parties: Pick<CollectionParty, "masterId" | "coordinatorLabel" | "outstanding">[],
  source: Pick<TransactionSourceInfo, "approved"> | undefined,
  escalations: OwnEscalationCounts | null | "error",
): Scorecard {
  const own = parties.filter((p) => p.masterId && p.coordinatorLabel === label);
  const counts: EscalationCounts | null | "error" = escalations === null || escalations === "error" ? escalations : new Map([[label, escalations]]);
  const [card] = buildScorecards(own, source, counts);
  if (card) return card;
  return {
    salesperson: label,
    clients: 0,
    outstanding: source?.approved === true ? { status: "ok", clientsPending: 0, totalPaise: "0", verifiedClients: 0, unverifiedClients: 0 } : { status: "not-configured" },
    escalations:
      escalations === null ? { status: "restricted" }
      : escalations === "error" ? { status: "unavailable" }
      : { status: "ok", escalated: escalations.escalated, resolvedByReviewer: escalations.resolvedByReviewer },
  };
}

/** "₹12,34,567.00" — Indian grouping, always two decimals, exact (no floating point). */
export function formatInrTwoDecimals(paise: bigint | string): string {
  const s = formatInrExact(typeof paise === "string" ? BigInt(paise) : paise);
  return /\.\d{2}$/.test(s) ? s : `${s}.00`;
}
