"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { Check, Minus, X } from "lucide-react";
import { BLUE, BTN, CARD, CATEGORY_SHORT, FIELD, NotReady, trackerPath, type CalcCat } from "@/components/admin/master/incentive-rules/calc-ui";
import { MONTH_STATUS } from "@/components/admin/master/incentive-rules/approvals";
import { PageHead } from "@/components/incentive/empty-state";
import { STAGES, type ActionTone, type StageKey, type StageState } from "./stages";

/**
 * Incentive Tracker → Incentive Management: the pieces every section shares — the section tabs, the note that tells
 * Rules Approval from Incentive Approval, the filters (a plain GET form: the address keeps them), status chips and the
 * progress tracker. Display only: every action is on a category's own Calculation screen.
 */

export type Section = "overview" | "calculate" | "approvals" | "payments" | "history";
export const SECTIONS: readonly { key: Section; href: string; label: string; intro: string }[] = [
  { key: "overview", href: "/incentive/manage/overview", label: "Overview", intro: "Where every category's month stands — rules, source data, calculation, Incentive Approval, release and payment." },
  { key: "calculate", href: "/incentive/manage/calculate", label: "Calculate Incentives", intro: "Categories A–G for the month. Open a category to calculate, review and lock it on its own screen." },
  { key: "approvals", href: "/incentive/manage/approvals", label: "Review & Incentive Approvals", intro: "Every month that needs review, submission or Incentive Approval, across Categories A–G." },
  { key: "payments", href: "/incentive/manage/payments", label: "Release & Payments", intro: "Approved months, their release dates and their recorded payouts. The WMS records payouts; it moves no money." },
  { key: "history", href: "/incentive/manage/history", label: "History & Reconciliation", intro: "Every month, calculation, rejection, void, adjustment, carried-forward balance and payout — nothing is hidden." },
];

export { CATEGORY_SHORT };
export const ALL_CATEGORIES: readonly CalcCat[] = ["A", "B", "C", "D", "E", "F", "G"];

/** The category's Calculation screen for a programme and month (where its existing actions are). */
export const calcHref = (c: CalcCat, programId: string | null, month?: string | null) => {
  const q = new URLSearchParams();
  if (programId) q.set("program", programId);
  if (month) q.set("month", month.slice(0, 7));
  const s = q.toString();
  return `${trackerPath(c)}${s ? `?${s}` : ""}`;
};
/** The category's Incentive Approvals screen (its months' approval steps, rejections and payouts). */
export const approvalsHref = (c: CalcCat, programId: string | null) => `${trackerPath(c)}/approvals${programId ? `?program=${programId}` : ""}`;

export function ManageHeader({ section, keep }: { section: Section; keep?: Record<string, string | null | undefined> }) {
  const s = SECTIONS.find((x) => x.key === section)!;
  const q = new URLSearchParams(Object.entries(keep ?? {}).filter((e): e is [string, string] => !!e[1])).toString();
  return (
    <div className="mb-4">
      <PageHead eyebrow="INCENTIVE MANAGEMENT · CATEGORIES A–G" title={s.label} sub={s.intro} />
      <nav aria-label="Incentive Management sections" className="-mt-2 flex flex-wrap items-center gap-1 overflow-x-auto border-b border-hairline">
        {SECTIONS.map((t) => (
          <Link
            key={t.key}
            href={`${t.href}${q ? `?${q}` : ""}` as Route}
            aria-current={t.key === section ? "page" : undefined}
            className="-mb-px whitespace-nowrap border-b-2 px-3 py-1.5 text-[13px] font-semibold"
            style={{ borderColor: t.key === section ? BLUE : "transparent", color: t.key === section ? BLUE : "var(--color-ink-muted)" }}
          >
            {t.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}

/** Rules Approval and Incentive Approval are separate steps, done in separate places, usually by different people. */
export function TwoApprovals() {
  return (
    <section aria-label="Rules Approval and Incentive Approval" className="mb-4 grid gap-2 md:grid-cols-2">
      <div className="rounded-section bg-white px-4 py-3 text-[12.5px] text-ink-muted" style={CARD}>
        <p className="text-[12px] font-bold uppercase tracking-wide text-ink-strong">Rules Approval</p>
        <p className="mt-0.5">
          In Admin &amp; Master Setup → Incentive Rules. A second person approves a rules version; publishing it makes the rules apply to calculations from its month. It approves nobody&apos;s incentive and pays nothing.{" "}
          <Link href={"/master-setup/incentive-rules" as Route} className="font-semibold underline-offset-2 hover:underline" style={{ color: BLUE }}>
            Incentive Rules ↗
          </Link>
        </p>
      </div>
      <div className="rounded-section bg-white px-4 py-3 text-[12.5px] text-ink-muted" style={CARD}>
        <p className="text-[12px] font-bold uppercase tracking-wide text-ink-strong">Incentive Approval</p>
        <p className="mt-0.5">
          Here, category by category. A calculated month is reviewed and locked, submitted, approved step by step by people other than the one who submitted it, released on its date and then paid.
        </p>
      </div>
    </section>
  );
}

export interface FilterValues {
  program?: string | null;
  month?: string | null;
  category?: string | null;
  status?: string | null;
  employee?: string | null;
}

/** Filters as a GET form: applying them changes the address, so a filtered view can be bookmarked or shared. */
export function FilterBar({
  action,
  programs,
  values,
  allPrograms,
  month,
  category,
  statuses,
  employees,
}: {
  action: string;
  programs: { id: string; code: string; name: string }[];
  values: FilterValues;
  /** Offer "All programmes". */
  allPrograms?: boolean;
  /** "required": a month must be chosen; "optional": blank means every month. */
  month?: "required" | "optional";
  category?: boolean;
  statuses?: readonly { value: string; label: string }[];
  employees?: readonly { key: string; name: string }[];
}) {
  return (
    <form method="get" action={action} role="search" aria-label="Filters" className="mb-3 flex flex-wrap items-end gap-2">
      <label className="grid gap-0.5 text-[11.5px] font-semibold text-ink-muted">
        Programme
        <select name="program" defaultValue={values.program ?? (allPrograms ? "all" : (programs[0]?.id ?? ""))} className={FIELD} aria-label="Programme">
          {allPrograms && <option value="all">All programmes</option>}
          {!programs.length && <option value="">No programme yet</option>}
          {programs.map((p) => (
            <option key={p.id} value={p.id}>
              {p.code} · {p.name}
            </option>
          ))}
        </select>
      </label>
      {month && (
        <label className="grid gap-0.5 text-[11.5px] font-semibold text-ink-muted">
          Month{month === "optional" ? " (blank: all)" : ""}
          <input type="month" name="month" defaultValue={values.month?.slice(0, 7) ?? ""} required={month === "required"} className={FIELD} aria-label="Month" />
        </label>
      )}
      {category && (
        <label className="grid gap-0.5 text-[11.5px] font-semibold text-ink-muted">
          Category
          <select name="category" defaultValue={values.category ?? ""} className={FIELD} aria-label="Category">
            <option value="">All categories</option>
            {ALL_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c} · {CATEGORY_SHORT[c]}
              </option>
            ))}
          </select>
        </label>
      )}
      {statuses && (
        <label className="grid gap-0.5 text-[11.5px] font-semibold text-ink-muted">
          Status
          <select name="status" defaultValue={values.status ?? statuses[0]?.value ?? ""} className={FIELD} aria-label="Status">
            {statuses.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {employees && (
        <label className="grid gap-0.5 text-[11.5px] font-semibold text-ink-muted">
          Salesperson
          <select name="employee" defaultValue={values.employee ?? ""} className={`${FIELD} max-w-[220px]`} aria-label="Salesperson">
            <option value="">Everyone</option>
            {employees.map((e) => (
              <option key={e.key} value={e.key}>
                {e.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <button type="submit" className={BTN} style={{ background: BLUE }}>
        Apply
      </button>
      <Link href={action as Route} className="pb-1.5 text-[12px] font-semibold underline-offset-2 hover:underline" style={{ color: BLUE }}>
        Clear
      </Link>
    </form>
  );
}

export function MonthStatus({ status }: { status: string }) {
  const st = MONTH_STATUS[status] ?? { label: status, color: "#475569", bg: "#F1F5F9" };
  return (
    <span className="inline-flex whitespace-nowrap rounded px-1.5 py-0.5 text-[11.5px] font-bold" style={{ color: st.color, background: st.bg }}>
      {st.label}
    </span>
  );
}

export function CategoryBadge({ category }: { category: CalcCat }) {
  return (
    <span className="inline-grid h-6 w-6 shrink-0 place-items-center rounded-md text-[12px] font-extrabold text-white" style={{ background: BLUE }} aria-hidden>
      {category}
    </span>
  );
}

export function CategoryName({ category }: { category: CalcCat }) {
  return (
    <span className="inline-flex items-center gap-2">
      <CategoryBadge category={category} />
      <span className="min-w-0">
        <span className="block font-semibold text-ink-strong">Category {category}</span>
        <span className="block text-[11.5px] text-ink-subtle">{CATEGORY_SHORT[category]}</span>
      </span>
    </span>
  );
}

const TONE: Record<ActionTone, string> = { action: "#0B4FB8", wait: "#B45309", none: "#64748B", bad: "#B91C1C" };
export function ActionText({ label, tone }: { label: string; tone: ActionTone }) {
  return (
    <span className="text-[12.5px] font-semibold" style={{ color: TONE[tone] }}>
      {label}
    </span>
  );
}

const STATE_LABEL: Record<StageState, string> = { done: "done", blocked: "blocked", todo: "not yet", na: "not applicable" };

/** One stage's cell: ✓ done, ✕ blocked, – not applicable, the stage's number when not yet reached. */
export function StageMark({ stage, state, index, note }: { stage: StageKey; state: StageState; index: number; note?: string | null }) {
  const s = STAGES.find((x) => x.key === stage)!;
  const style: React.CSSProperties =
    state === "done" ? { background: "#047857", color: "#fff" } : state === "blocked" ? { background: "#B91C1C", color: "#fff" } : state === "na" ? { background: "#F1F5F9", color: "#94A3B8" } : { background: "#fff", color: "#94A3B8", border: "1px solid #CBD5E1" };
  return (
    <span className="inline-flex flex-col items-center gap-0.5" title={`${s.label}: ${STATE_LABEL[state]}. ${s.evidence}`}>
      <span aria-hidden className="grid h-5 w-5 place-items-center rounded-full text-[10.5px] font-bold" style={style}>
        {state === "done" ? <Check size={12} strokeWidth={3} /> : state === "blocked" ? <X size={12} strokeWidth={3} /> : state === "na" ? <Minus size={12} strokeWidth={3} /> : index + 1}
      </span>
      <span className="sr-only">
        {s.label}: {STATE_LABEL[state]}
      </span>
      {note && <span className="max-w-[92px] text-center text-[10.5px] leading-tight text-ink-subtle">{note}</span>}
    </span>
  );
}

/** The stages in order, with what each one's ✓ is based on. */
export function StageLegend() {
  return (
    <details className="mt-2 text-[12px] text-ink-muted">
      <summary className="cursor-pointer font-semibold" style={{ color: BLUE }}>
        What each stage is based on
      </summary>
      <ol className="mt-1 grid gap-0.5 pl-4" style={{ listStyle: "decimal" }}>
        {STAGES.map((s) => (
          <li key={s.key}>
            <strong className="text-ink-strong">{s.label}</strong> — {s.evidence}
          </li>
        ))}
      </ol>
      <p className="mt-1">✕ means the month&apos;s latest calculation was blocked; – means the stage doesn&apos;t apply (a voided month). A stage is ticked only when a record shows it.</p>
    </details>
  );
}

export function Tile({ label, value, sub, tone = "plain" }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: "plain" | "warn" | "ok" }) {
  const ink = tone === "warn" ? "#B45309" : tone === "ok" ? "#047857" : "var(--color-ink-strong)";
  return (
    <div className="rounded-section bg-white px-4 py-3" style={CARD}>
      <p className="text-[11.5px] font-semibold uppercase tracking-wide text-ink-subtle">{label}</p>
      <p className="mt-0.5 text-[20px] font-bold tabular-nums" style={{ color: ink }}>
        {value}
      </p>
      {sub && <p className="text-[11.5px] text-ink-muted">{sub}</p>}
    </div>
  );
}

/** Categories whose database updates are missing: named, with what they need (the same notice their screens show). */
export function NotReadyList({ categories }: { categories: readonly CalcCat[] }) {
  if (!categories.length) return null;
  return (
    <div className="mb-3 grid gap-2">
      {categories.map((c) => (
        <NotReady key={c} category={c} />
      ))}
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-section bg-white px-4 py-4 text-[13px] text-ink-muted" style={CARD}>{children}</p>;
}

/** A table that scrolls sideways on a narrow screen instead of squeezing its columns. */
export function TableCard({ label, minWidth = 900, head, children }: { label: string; minWidth?: number; head: readonly string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-section bg-white" style={CARD}>
      <table className="w-full text-[12.5px]" style={{ minWidth }} aria-label={label}>
        <thead>
          <tr className="text-left text-ink-subtle">
            {head.map((h, i) => (
              <th key={`${h}-${i}`} className="px-3 py-2 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
