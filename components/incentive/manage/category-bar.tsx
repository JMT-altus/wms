"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { ChevronRight } from "lucide-react";
import { BLUE, type CalcCat } from "@/components/admin/master/incentive-rules/calc-ui";
import { ALL_CATEGORIES, CATEGORY_SHORT, approvalsHref, calcHref } from "./manage-ui";

/**
 * Above a category's own Calculation or Incentive Approvals screen in the Incentive Tracker: where it sits in
 * Incentive Management, and Categories A–G to switch between (keeping the programme and month). The screen below
 * is unchanged.
 */
export function CategoryBar({ category, view, program, month }: { category: CalcCat; view: "calculation" | "approvals"; program?: string | null; month?: string | null }) {
  const q = new URLSearchParams();
  if (program) q.set("program", program);
  if (month && /^\d{4}-\d{2}$/.test(month)) q.set("month", month);
  const keep = q.toString() ? `?${q.toString()}` : "";
  const section = view === "calculation" ? { href: `/incentive/manage/calculate${keep}`, label: "Calculate Incentives" } : { href: `/incentive/manage/approvals${program ? `?program=${program}` : ""}`, label: "Review & Incentive Approvals" };
  return (
    <div className="mb-3">
      <nav aria-label="Breadcrumb" className="mb-2 flex flex-wrap items-center gap-1 text-[12.5px] text-ink-muted">
        <Link href={`/incentive/manage/overview${keep}` as Route} className="font-semibold underline-offset-2 hover:underline" style={{ color: BLUE }}>
          Incentive Management
        </Link>
        <ChevronRight size={13} aria-hidden />
        <Link href={section.href as Route} className="font-semibold underline-offset-2 hover:underline" style={{ color: BLUE }}>
          {section.label}
        </Link>
        <ChevronRight size={13} aria-hidden />
        <span aria-current="page" className="font-semibold text-ink-strong">
          Category {category}
        </span>
      </nav>
      <nav aria-label="Categories" className="flex flex-wrap gap-1.5 text-[12.5px] font-bold">
        {ALL_CATEGORIES.map((c) => (
          <Link
            key={c}
            href={(view === "calculation" ? calcHref(c, program ?? null, month ? `${month}-01` : null) : approvalsHref(c, program ?? null)) as Route}
            aria-current={c === category ? "page" : undefined}
            className="rounded-pill px-3 py-1"
            style={c === category ? { background: BLUE, color: "#fff" } : { background: "#EEF1F6", color: "#172B4D" }}
          >
            {c} · {CATEGORY_SHORT[c]}
          </Link>
        ))}
      </nav>
    </div>
  );
}
