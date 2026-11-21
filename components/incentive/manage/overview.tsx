"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { BLUE, CARD, rs, type CalcCat } from "@/components/admin/master/incentive-rules/calc-ui";
import type { CategoryMonthSummary, FPending } from "@/lib/queries/incentive-manage";
import { ActionText, CategoryName, Empty, FilterBar, ManageHeader, NotReadyList, StageLegend, StageMark, TableCard, Tile, TwoApprovals, approvalsHref, calcHref } from "./manage-ui";
import { STAGES, fmtDay, fmtMonth, isReleased, nextAction, stagesOf, type StageKey } from "./stages";

export type OverviewCategory = CategoryMonthSummary & { category: CalcCat };

export interface OverviewProps {
  programs: { id: string; code: string; name: string }[];
  programId: string | null;
  month: string;
  today: string;
  categories: OverviewCategory[];
  /** Category F's open review work (all months); null when F isn't set up. */
  f: FPending | null;
  showPayouts: boolean;
}

/** Incentive Management → Overview: every category's month on one page. */
export function ManageOverview(p: OverviewProps) {
  const ready = p.categories.filter((c) => c.ready);
  const facts = (c: OverviewCategory) => ({
    ready: c.ready,
    rules: c.rules,
    latest: c.latest,
    period: c.row ? { status: c.row.status, hasRun: !!c.row.run, releaseOn: c.row.releaseOn } : null,
    today: p.today,
  });
  const count = (f: (c: OverviewCategory) => boolean) => ready.filter(f).length;
  const program = p.programs.find((x) => x.id === p.programId);
  const heldA = p.categories.find((c) => c.category === "A")?.latest?.heldForReview ?? null;
  const heldB = p.categories.find((c) => c.category === "B")?.latest?.heldForReview ?? null;
  const heldC = p.categories.find((c) => c.category === "C")?.latest?.heldForReview ?? null;
  const fOpen = p.f ? p.f.unchecked + p.f.onHold + p.f.invalidations + p.f.writeOffs : 0;
  const held = (heldA ?? 0) + (heldB ?? 0) + (heldC ?? 0) + fOpen;

  const note = (c: OverviewCategory, k: StageKey): string | null => {
    const r = c.row;
    switch (k) {
      case "rules":
        return c.rules ? `v${c.rules.versionNo}` : "none";
      case "source":
        return c.latest ? (c.latest.status === "blocked" ? "blocked" : fmtDay(c.latest.computedAt)) : r?.run ? null : "not checked";
      case "calculated":
        return r?.run ? rs(r.approvedTotalPaise) : null;
      case "submitted":
        return r?.submittedAt && ["submitted", "approved", "paid"].includes(r.status) ? fmtDay(r.submittedAt) : null;
      case "approved":
        return r && (r.status === "approved" || r.status === "paid") && r.approvalsRequired ? `${r.approvalsRequired} step${r.approvalsRequired === 1 ? "" : "s"}` : null;
      case "released":
        return r?.releaseOn && (r.status === "approved" || r.status === "paid") ? fmtDay(r.releaseOn) : null;
      case "paid":
        return r?.status === "paid" ? (p.showPayouts && r.payout ? fmtDay(r.payout.paidOn) : "paid") : null;
      default:
        return null;
    }
  };

  return (
    <div>
      <ManageHeader section="overview" keep={{ program: p.programId, month: p.month.slice(0, 7) }} />
      <FilterBar action="/incentive/manage/overview" programs={p.programs} values={{ program: p.programId, month: p.month }} month="required" />
      <TwoApprovals />
      <NotReadyList categories={p.categories.filter((c) => !c.ready).map((c) => c.category)} />
      {!p.programId ? (
        <Empty>No incentive programme yet. Programmes and their rules are set up in Admin &amp; Master Setup → Incentive Rules.</Empty>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
            <Tile label="Rules published" value={`${count((c) => !!c.rules)} / ${ready.length}`} sub={`for ${fmtMonth(p.month)}`} />
            <Tile label="Calculated" value={`${count((c) => !!c.row?.run)} / ${ready.length}`} sub="an adopted calculation" />
            <Tile label="Awaiting Incentive Approval" value={count((c) => c.row?.status === "submitted")} tone={count((c) => c.row?.status === "submitted") ? "warn" : "plain"} />
            <Tile label="Released, awaiting payout" value={count((c) => c.row?.status === "approved" && isReleased(c.row.status, c.row.releaseOn, p.today))} />
            <Tile label="Paid" value={count((c) => c.row?.status === "paid")} tone="ok" />
            <Tile label="Held for review" value={held} sub="B and C for the month; F across months" tone={held ? "warn" : "plain"} />
          </div>

          <h2 className="mb-1.5 text-[14px] font-bold text-ink-strong">
            {program ? `${program.code} · ${program.name}` : "Programme"} — {fmtMonth(p.month)}
          </h2>
          <TableCard label="Month progress by category" minWidth={1120} head={["Category", ...STAGES.map((s) => s.label), "Next action", ""]}>
            {p.categories.map((c) => {
              const st = stagesOf(facts(c));
              const step = c.row && c.row.approvalsDone !== null ? { done: c.row.approvalsDone, required: c.row.approvalsRequired } : null;
              const next = nextAction(facts(c), step);
              return (
                <tr key={c.category} className="border-t border-hairline align-top" aria-label={`Category ${c.category}`}>
                  <td className="px-3 py-2">
                    <CategoryName category={c.category} />
                  </td>
                  {c.ready ? (
                    STAGES.map((s, i) => (
                      <td key={s.key} className="px-1 py-2 text-center">
                        <StageMark stage={s.key} state={st[s.key]} index={i} note={note(c, s.key)} />
                      </td>
                    ))
                  ) : (
                    <td colSpan={STAGES.length} className="px-3 py-2 text-ink-muted">
                      Needs a database update before it can be calculated.
                    </td>
                  )}
                  <td className="px-3 py-2">
                    <ActionText {...next} />
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right text-[12px]">
                    {c.ready && (
                      <span className="inline-flex flex-col items-end gap-0.5">
                        <Link href={calcHref(c.category, p.programId, p.month) as Route} className="font-bold underline-offset-2 hover:underline" style={{ color: BLUE }} aria-label={`Open Category ${c.category} calculation`}>
                          Open
                        </Link>
                        <Link href={approvalsHref(c.category, p.programId) as Route} className="font-semibold underline-offset-2 hover:underline" style={{ color: BLUE }} aria-label={`Category ${c.category} Incentive Approvals`}>
                          Approvals
                        </Link>
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </TableCard>
          <StageLegend />

          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            <section aria-label="Source data and validation" className="rounded-section bg-white p-4" style={CARD}>
              <h2 className="text-[14px] font-bold text-ink-strong">Source data and validation</h2>
              <p className="mt-0.5 text-[12px] text-ink-muted">What each category&apos;s latest calculation of the month found. Only a calculation checks the month&apos;s records; nothing is assumed ready.</p>
              <ul className="mt-2 grid gap-1.5 text-[12.5px]">
                {ready.map((c) => (
                  <li key={c.category}>
                    <strong className="text-ink-strong">Category {c.category}:</strong>{" "}
                    {!c.latest ? (
                      <span className="text-ink-muted">not calculated yet{c.rules ? "" : " — no published rules apply to the month"}.</span>
                    ) : c.latest.status === "computed" ? (
                      <span className="text-ink-muted">read without a blocking problem on {fmtDay(c.latest.computedAt)} (as of {fmtDay(c.latest.asOf)}).</span>
                    ) : (
                      <div className="inline text-[#B91C1C]">
                        the latest calculation ({fmtDay(c.latest.computedAt)}) was blocked{c.row?.run ? "; the adopted calculation is kept" : ""}:
                        <ul className="ml-4 list-disc text-ink-strong">
                          {c.latest.problems.slice(0, 5).map((x, i) => (
                            <li key={i}>{x}</li>
                          ))}
                          {c.latest.problems.length > 5 && <li>…and {c.latest.problems.length - 5} more on its Calculation screen.</li>}
                          {!c.latest.problems.length && <li>See its Calculation screen.</li>}
                        </ul>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>
            <ReviewsWaiting heldA={heldA} heldB={heldB} heldC={heldC} f={p.f} programId={p.programId} month={p.month} />
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Records a calculation held for a person's decision (B: invoices without a Sales Order; C: unmatched records; F:
 * testimonials to check, invalidations and write-offs awaiting a second person), each linked to its review screen.
 */
export function ReviewsWaiting({ heldA = null, heldB, heldC, f, programId, month }: { heldA?: number | null; heldB: number | null; heldC: number | null; f: FPending | null; programId: string | null; month: string }) {
  const link = (href: string) => (
    <Link href={href as Route} className="font-semibold underline-offset-2 hover:underline" style={{ color: BLUE }}>
      Review &amp; decisions ↗
    </Link>
  );
  return (
    <section aria-label="Reviews waiting" className="rounded-section bg-white p-4" style={CARD}>
      <h2 className="text-[14px] font-bold text-ink-strong">Reviews waiting</h2>
      <p className="mt-0.5 text-[12px] text-ink-muted">Records a calculation held for a person&apos;s decision. They never qualify by themselves; each decision is made, with its reason, on the category&apos;s review screen.</p>
      <ul className="mt-2 grid gap-1.5 text-[12.5px]">
        <li>
          <strong className="text-ink-strong">Category A:</strong> {heldA === null ? "not calculated for the month." : `${heldA} item${heldA === 1 ? "" : "s"} held in the latest calculation of ${fmtMonth(month)} (receipts held, orders credited to nobody, credit notes or pre-closures that can't be applied). Each holds the month until resolved or acknowledged.`} {link(`/master-setup/incentive-rules/calculation?${programId ? `program=${programId}&` : ""}month=${month.slice(0, 7)}`)}
        </li>
        <li>
          <strong className="text-ink-strong">Category B:</strong> {heldB === null ? "not calculated for the month." : `${heldB} invoice${heldB === 1 ? "" : "s"} without a Sales Order in the latest calculation of ${fmtMonth(month)}.`} {link("/master-setup/incentive-rules/calculation/qualifications")}
        </li>
        <li>
          <strong className="text-ink-strong">Category C:</strong> {heldC === null ? "not calculated for the month." : `${heldC} record${heldC === 1 ? "" : "s"} held for review in the latest calculation of ${fmtMonth(month)}.`} {link(`/master-setup/incentive-rules/calculation/c-review?${programId ? `program=${programId}&` : ""}month=${month.slice(0, 7)}`)}
        </li>
        <li>
          <strong className="text-ink-strong">Category F:</strong>{" "}
          {f ? (
            <>
              {f.unchecked} testimonial{f.unchecked === 1 ? "" : "s"} not yet checked, {f.onHold} on hold, {f.invalidations} invalidation{f.invalidations === 1 ? "" : "s"} and {f.writeOffs} write-off{f.writeOffs === 1 ? "" : "s"} awaiting a second person (all months).
            </>
          ) : (
            <span className="text-ink-muted">not set up on this database.</span>
          )}{" "}
          {link("/master-setup/incentive-rules/calculation/f-review")}
        </li>
      </ul>
    </section>
  );
}
