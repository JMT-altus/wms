"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";

/** Shared pieces of the Incentive Calculation screens: the section tabs, card style, fields and money. */

export const CARD: React.CSSProperties = { border: "1px solid var(--color-hairline)", boxShadow: "0 2px 6px -2px rgba(15, 23, 42, 0.06)" };
export const FIELD = "h-8 rounded-lg border border-hairline-strong bg-white px-2 text-[12.5px] text-ink-strong";
export const BTN = "inline-flex h-8 items-center gap-1 rounded-pill px-3 text-[12.5px] font-bold text-white disabled:opacity-50";
export const BTN_PLAIN = "inline-flex h-8 items-center gap-1 rounded-pill border border-hairline-strong bg-white px-3 text-[12.5px] font-bold text-ink-strong disabled:opacity-50";
export const BLUE = "#0B4FB8";
export const rs = (p: number | null | undefined) => (p === null || p === undefined ? "—" : `₹${(p / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
export const pct = (ppm: number) => `${(ppm / 10_000).toLocaleString("en-IN", { maximumFractionDigits: 4 })}%`;
export const day = (d: string | null | undefined) => (d ? new Date(`${d.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }) : "—");

const TABS = [
  { href: "/master-setup/incentive-rules/calculation", label: "Calculation" },
  { href: "/master-setup/incentive-rules/calculation/salespeople", label: "Order salespeople" },
  { href: "/master-setup/incentive-rules/calculation/representatives", label: "Representatives" },
  { href: "/master-setup/incentive-rules/calculation/receipts", label: "Receipt events" },
  { href: "/master-setup/incentive-rules/calculation/approvals", label: "Incentive Approvals" },
] as const;
/** In the Incentive Tracker: the calculation and its approval; the inputs and rules stay in Admin & Master Setup (linked). */
const TRACKER_TABS = [
  { href: "/incentive/category-a", label: "Calculation" },
  { href: "/incentive/category-a/approvals", label: "Incentive Approvals" },
] as const;

/** Category B: its calculation, its review queue (manual decisions) and its approvals. */
const B_TABS = [
  { href: "/master-setup/incentive-rules/calculation?category=B", label: "Calculation" },
  { href: "/master-setup/incentive-rules/calculation/qualifications", label: "Review & decisions" },
  { href: "/master-setup/incentive-rules/calculation/approvals?category=B", label: "Incentive Approvals" },
] as const;
const TRACKER_B_TABS = [
  { href: "/incentive/category-b", label: "Calculation" },
  { href: "/incentive/category-b/approvals", label: "Incentive Approvals" },
] as const;

export type CalcCat = "A" | "B" | "C" | "D" | "E" | "F" | "G";
/** Each category's short name (also used by Incentive Tracker → Incentive Management). */
export const CATEGORY_SHORT: Record<CalcCat, string> = { A: "Sales Order Received", B: "Old Customer – New Product / Brand", C: "New Customer", D: "Leads & Enquiries", E: "Client Meetings", F: "Reviews & Testimonials", G: "Consecutive Purchases" };
/** Where a category's calculation lives in the Incentive Tracker. */
export const trackerPath = (c: CalcCat) => (c === "A" ? "/incentive/category-a" : c === "B" ? "/incentive/category-b" : `/incentive/category/${c.toLowerCase()}`);

/** Categories A–G, in Admin & Master Setup → Incentive Calculation. */
export function CategorySwitch({ category }: { category: CalcCat }) {
  const items = (["A", "B", "C", "D", "E", "F", "G"] as const).map((c) => ({ c, href: c === "A" ? "/master-setup/incentive-rules/calculation" : `/master-setup/incentive-rules/calculation?category=${c}`, label: `${c} · ${CATEGORY_SHORT[c]}` }));
  return (
    <nav aria-label="Incentive category" className="mb-2 flex flex-wrap gap-1.5">
      {items.map((i) => (
        <Link key={i.c} href={i.href as Route} aria-current={i.c === category ? "page" : undefined} className="rounded-pill px-3 py-1 text-[12.5px] font-bold" style={i.c === category ? { background: BLUE, color: "#fff" } : { background: "#EEF1F6", color: "#172B4D" }}>
          {i.label}
        </Link>
      ))}
    </nav>
  );
}

export function CalcTabs({ active, variant = "master", category = "A" }: { active: (typeof TABS)[number]["label"] | "Review & decisions"; variant?: "master" | "tracker"; category?: CalcCat }) {
  const other: readonly { href: string; label: string }[] =
    variant === "tracker"
      ? [{ href: trackerPath(category), label: "Calculation" }, { href: `${trackerPath(category)}/approvals`, label: "Incentive Approvals" }]
      : [
          { href: `/master-setup/incentive-rules/calculation?category=${category}`, label: "Calculation" },
          // Category C: its review queue for unmatched records (0136).
          ...(category === "C" ? [{ href: "/master-setup/incentive-rules/calculation/c-review", label: "Review & decisions" }] : []),
          // Category F: its Google review verification queue (0137).
          ...(category === "F" ? [{ href: "/master-setup/incentive-rules/calculation/f-review", label: "Review & decisions" }] : []),
          { href: `/master-setup/incentive-rules/calculation/approvals?category=${category}`, label: "Incentive Approvals" },
        ];
  const tabs: readonly { href: string; label: string }[] = category === "A" ? (variant === "tracker" ? TRACKER_TABS : TABS) : category === "B" ? (variant === "tracker" ? TRACKER_B_TABS : B_TABS) : other;
  return (
    <nav aria-label="Incentive calculation sections" className="mb-3 flex flex-wrap items-center gap-1 border-b border-hairline">
      {tabs.map((t) => (
        <Link
          key={t.href}
          href={t.href as Route}
          aria-current={t.label === active ? "page" : undefined}
          className="-mb-px border-b-2 px-3 py-1.5 text-[13px] font-semibold"
          style={{ borderColor: t.label === active ? BLUE : "transparent", color: t.label === active ? BLUE : "var(--color-ink-muted)" }}
        >
          {t.label}
        </Link>
      ))}
      {variant === "tracker" && (
        <span className="ml-auto flex gap-3 pb-1 text-[12px]">
          {(category === "B" || category === "C" || category === "F") && (
            <Link href={(category === "B" ? "/master-setup/incentive-rules/calculation/qualifications" : category === "C" ? "/master-setup/incentive-rules/calculation/c-review" : "/master-setup/incentive-rules/calculation/f-review") as Route} className="font-semibold underline-offset-2 hover:underline" style={{ color: BLUE }}>
              Review & decisions ↗
            </Link>
          )}
          <Link href={"/master-setup/incentive-rules/calculation/salespeople" as Route} className="font-semibold underline-offset-2 hover:underline" style={{ color: BLUE }}>
            Inputs (salespeople, representatives, receipts) ↗
          </Link>
          <Link href={"/master-setup/incentive-rules" as Route} className="font-semibold underline-offset-2 hover:underline" style={{ color: BLUE }}>
            Rules ↗
          </Link>
        </span>
      )}
    </nav>
  );
}

export function Notice({ tone, children }: { tone: "ok" | "bad" | "info"; children: React.ReactNode }) {
  const bg = tone === "bad" ? "#FEF2F2" : tone === "ok" ? "#EFF6FF" : "var(--color-amber-bg)";
  const border = tone === "bad" ? "#FCA5A5" : tone === "ok" ? "#BFDBFE" : "color-mix(in srgb, var(--color-amber) 35%, transparent)";
  return (
    <div role={tone === "bad" ? "alert" : "status"} className="rounded-section px-4 py-2.5 text-[13px] text-ink-strong" style={{ background: bg, border: `1px solid ${border}` }}>
      {children}
    </div>
  );
}

export function NotReady({ category = "A" }: { category?: CalcCat }) {
  return category !== "A" ? (
    <Notice tone="info">Database update {category === "B" ? "0134 is" : category === "C" ? "0134, 0135 and 0136 are" : category === "F" ? "0134, 0135, 0137, 0138 and 0139 are" : "0134 and 0135 are"} needed before Category {category} can be calculated or reviewed. Nothing else is affected.</Notice>
  ) : (
    <Notice tone="info">Database updates 0132 and 0133 are needed before Category A inputs and calculations can be used. The live Incentive Tracker is not affected.</Notice>
  );
}

/** A small "retire with a reason" control: a row is never edited or deleted, only retired. */
/**
 * onRetire may resolve `false` to say the retirement was refused: the box then stays open with the reason as typed.
 * Anything else (as every existing caller does) closes it as before. The button is usable again in every case.
 */
export function RetireButton({ label, disabled, onRetire }: { label: string; disabled?: boolean; onRetire: (reason: string) => Promise<void | boolean> }) {
  const [open, setOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  if (!open)
    return (
      <button type="button" disabled={disabled} onClick={() => setOpen(true)} className="text-[12px] font-semibold text-[#B91C1C] underline-offset-2 hover:underline disabled:opacity-50" aria-label={`Retire ${label}`}>
        Retire
      </button>
    );
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <input className={`${FIELD} w-56`} placeholder="Why is it retired?" value={reason} onChange={(e) => setReason(e.target.value)} aria-label={`Reason for retiring ${label}`} maxLength={1000} />
      <button
        type="button"
        disabled={busy || !reason.trim()}
        className={BTN}
        style={{ background: "#B91C1C" }}
        onClick={async () => {
          setBusy(true);
          let kept = false;
          try {
            kept = (await onRetire(reason.trim())) === false;
          } finally {
            setBusy(false);
          }
          if (kept) return;
          setOpen(false);
          setReason("");
        }}
      >
        Retire
      </button>
      <button type="button" className={BTN_PLAIN} onClick={() => setOpen(false)}>
        Cancel
      </button>
    </span>
  );
}
