/**
 * Incentive Management: how a category's month reads on the progress tracker, and what it needs next. Pure display
 * logic over records that already exist — the month's status, its adopted calculation, its latest calculation, the
 * published rules in force and its release date. A stage is "done" only when one of those records shows it; nothing
 * here decides, changes or authorises anything.
 */

export type StageKey = "rules" | "source" | "calculated" | "reviewed" | "submitted" | "approved" | "released" | "paid";
/** done: a record shows it · blocked: the latest calculation was blocked · todo: not yet · na: not applicable (a voided month). */
export type StageState = "done" | "blocked" | "todo" | "na";

export const STAGES: readonly { key: StageKey; label: string; evidence: string }[] = [
  { key: "rules", label: "Rules Published", evidence: "A published Incentive Rules version applies to the month (Rules Approval, in Admin & Master Setup)." },
  { key: "source", label: "Source Data Ready", evidence: "A calculation of the month read its records and rules without a blocking problem." },
  { key: "calculated", label: "Calculated", evidence: "A calculation is adopted for the month." },
  { key: "reviewed", label: "Reviewed", evidence: "The month was locked after review — the lock is the record of the review." },
  { key: "submitted", label: "Submitted", evidence: "The month was submitted for Incentive Approval." },
  { key: "approved", label: "Approved", evidence: "Every Incentive Approval step is complete." },
  { key: "released", label: "Released", evidence: "Approved, and its release date has come: eligible for payout." },
  { key: "paid", label: "Paid", evidence: "The payout is recorded (the WMS records payouts; it moves no money)." },
];

export interface MonthFacts {
  /** False when the category's database updates are not applied. */
  ready: boolean;
  /** The published rules in force for the month (null: none applies). */
  rules: { versionNo: number } | null;
  /** The month's latest calculation, adopted or not (null: never calculated). */
  latest: { status: "computed" | "blocked" } | null;
  /** The month's record (null: never calculated). */
  period: { status: string; hasRun: boolean; releaseOn: string | null } | null;
  /** Today in India (yyyy-mm-dd). */
  today: string;
}

const REVIEWED = ["locked", "submitted", "approved", "paid"];
const SUBMITTED = ["submitted", "approved", "paid"];
const APPROVED = ["approved", "paid"];

/** Released: approved (or paid) and on or after its release date — the same test the Approvals screen uses for "eligible". */
export const isReleased = (status: string | null | undefined, releaseOn: string | null | undefined, today: string) =>
  status === "paid" || (status === "approved" && !!releaseOn && releaseOn.slice(0, 10) <= today);

export function stagesOf(f: MonthFacts): Record<StageKey, StageState> {
  const s = f.period?.status ?? "";
  const voided = s === "voided";
  const hasRun = !!f.period?.hasRun;
  const done = (b: boolean): StageState => (b ? "done" : "todo");
  const later = (b: boolean): StageState => (voided ? "na" : done(b));
  return {
    rules: done(!!f.rules),
    // An adopted calculation is itself a calculation that read the month without a blocking problem.
    source: f.latest?.status === "computed" || hasRun ? "done" : f.latest?.status === "blocked" ? "blocked" : "todo",
    calculated: done(hasRun),
    reviewed: later(REVIEWED.includes(s)),
    submitted: later(SUBMITTED.includes(s)),
    approved: later(APPROVED.includes(s)),
    released: later(isReleased(s, f.period?.releaseOn, f.today)),
    paid: later(s === "paid"),
  };
}

export const fmtDay = (d: string | null | undefined) =>
  d ? new Date(`${d.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }) : "—";
export const fmtMonth = (m: string) => new Date(`${m.slice(0, 7)}-01T00:00:00Z`).toLocaleDateString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" });

export type ActionTone = "action" | "wait" | "none" | "bad";

/**
 * What the month needs next, and who acts — always on the category's own Calculation screen (or, for rules, in
 * Admin & Master Setup), where the existing permission and separation-of-duties checks apply.
 */
export function nextAction(f: MonthFacts, step?: { done: number; required: number | null } | null): { label: string; tone: ActionTone } {
  if (!f.ready) return { label: "Needs a database update first", tone: "bad" };
  const s = f.period?.status ?? null;
  if (s === "voided") return { label: "None — the month is voided", tone: "none" };
  if (s === "paid") return { label: "None — paid", tone: "none" };
  if (s === "approved")
    return isReleased(s, f.period?.releaseOn, f.today) ? { label: "Record the payout", tone: "action" } : { label: `Released on ${fmtDay(f.period?.releaseOn)} — then record the payout`, tone: "wait" };
  if (s === "submitted") return { label: step?.required ? `Incentive Approval — step ${step.done + 1} of ${step.required}` : "Incentive Approval", tone: "action" };
  if (s === "locked") return { label: "Submit for Incentive Approval", tone: "action" };
  if (!f.rules && !f.period?.hasRun) return { label: "Publish rules for the month first (Rules Approval)", tone: "bad" };
  if (f.latest?.status === "blocked") return { label: f.period?.hasRun ? "Latest calculation blocked — resolve it, then calculate again" : "Resolve the blocking problems, then calculate", tone: "bad" };
  if (!f.period?.hasRun) return { label: "Calculate", tone: "action" };
  return { label: "Review, then lock the month", tone: "action" };
}
