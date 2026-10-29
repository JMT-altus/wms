import type { ScorecardView } from "@/lib/collections/scorecards";
import { formatInrTwoDecimals } from "@/lib/collections/scorecards";

/**
 * The signed-in salesperson's own scorecard, at the top right of the Collection
 * Tracker: ONE card (a single column), never anyone else's. Display only — the
 * server worked out whose card it is and every figure (lib/collections/scorecards.ts);
 * the browser receives nothing about other salespeople. The metric names are
 * labels; the reviewer is whoever holds collection.escalation.review.
 */
export const SCORECARD_LABELS = {
  pending: "Clients with Outstanding Pending",
  total: "Total Outstanding Value",
  escalated: "Entries Escalated to Mihir Bhai",
  resolved: "Escalated Entries Solved by Mihir Bhai",
} as const;

export const SOURCE_NOT_CONFIGURED = "Source not configured";
export const RESTRICTED = "Restricted";
export const UNAVAILABLE = "Couldn't be loaded";
export const UNMAPPED_MESSAGE =
  "Your scorecard isn't available yet: an administrator must link your login to your Sales Coordinator name (Admin Panel → Sales Coordinators).";
export const NOT_SALESPERSON_MESSAGE = "Your login isn't a Sales Coordinator, so there is no salesperson scorecard for it.";
/** The link table doesn't exist in this database: no administrator can link anyone until database update 0120 is applied. */
export const NOT_INSTALLED_MESSAGE =
  "Your scorecard isn't available yet: Sales Coordinator links aren't set up on this database (database update 0120 is needed). Once an administrator has applied it, they can link your login to your Sales Coordinator name (Admin Panel → Sales Coordinators).";
/** The link couldn't be read — a database error, not a missing link. The reason is logged on the server (code only). */
export const UNAVAILABLE_MESSAGE =
  "Your scorecard couldn't be loaded: your Sales Coordinator link couldn't be read just now (a database error, not a missing link). Reload the page; if this keeps happening, tell an administrator.";

const EMPTY_STATE_MESSAGES = {
  unmapped: UNMAPPED_MESSAGE,
  "not-salesperson": NOT_SALESPERSON_MESSAGE,
  "not-installed": NOT_INSTALLED_MESSAGE,
  unavailable: UNAVAILABLE_MESSAGE,
} as const;

function Metric({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold leading-tight text-ink-subtle">{label}</dt>
      <dd className={muted ? "mt-0.5 text-[12px] italic text-ink-subtle" : "mt-0.5 text-[16px] font-bold tabular-nums text-ink-strong"}>{value}</dd>
    </div>
  );
}

export function SalespersonScorecard({ view }: { view: ScorecardView }) {
  if (view.status !== "ok") {
    const problem = view.status === "not-installed" || view.status === "unavailable";
    return (
      <p
        role="status"
        data-scorecard-state={view.status}
        data-scorecard-unmapped={view.status === "unmapped" ? "true" : undefined}
        data-scorecard-not-salesperson={view.status === "not-salesperson" ? "true" : undefined}
        className="w-full rounded-lg border bg-white px-3 py-2 text-[12.5px] sm:max-w-[440px]"
        style={problem ? { borderColor: "#FCD9A0", background: "#FFFBEB", color: "#92400E" } : undefined}
      >
        {EMPTY_STATE_MESSAGES[view.status]}
      </p>
    );
  }
  const c = view.card;
  const o = c.outstanding;
  const e = c.escalations;
  const escValue = (n: number) => (e.status === "ok" ? n.toLocaleString("en-IN") : e.status === "restricted" ? RESTRICTED : UNAVAILABLE);
  return (
    <section aria-label="Your scorecard" className="w-full rounded-lg border border-hairline bg-white px-4 py-3 sm:max-w-[440px]">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <span className="truncate text-[14px] font-bold text-ink-strong" title={c.salesperson}>
          {c.salesperson}
        </span>
        <span className="shrink-0 text-[11.5px] text-ink-subtle tabular-nums">
          {c.clients.toLocaleString("en-IN")} assigned client{c.clients === 1 ? "" : "s"}
        </span>
      </div>
      <dl className="grid grid-cols-1 gap-x-4 gap-y-2 min-[400px]:grid-cols-2">
        <Metric label={SCORECARD_LABELS.pending} value={o.status === "ok" ? o.clientsPending.toLocaleString("en-IN") : SOURCE_NOT_CONFIGURED} muted={o.status !== "ok"} />
        <Metric label={SCORECARD_LABELS.total} value={o.status === "ok" ? formatInrTwoDecimals(o.totalPaise) : SOURCE_NOT_CONFIGURED} muted={o.status !== "ok"} />
        <Metric label={SCORECARD_LABELS.escalated} value={escValue(e.status === "ok" ? e.escalated : 0)} muted={e.status !== "ok"} />
        <Metric label={SCORECARD_LABELS.resolved} value={escValue(e.status === "ok" ? e.resolvedByReviewer : 0)} muted={e.status !== "ok"} />
      </dl>
      {o.status === "ok" && o.unverifiedClients > 0 && (
        <p className="mt-2 text-[11px] text-ink-subtle">
          {o.unverifiedClients.toLocaleString("en-IN")} client{o.unverifiedClients === 1 ? " has" : "s have"} no verified balance (not counted).
        </p>
      )}
    </section>
  );
}
