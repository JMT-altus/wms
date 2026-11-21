"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { Plus, GitCompare } from "lucide-react";
import { CenterDialog } from "@/components/ui/center-dialog";
import { fireToast } from "@/lib/toast";
import { MASTERS_GRADIENT, MASTERS_GRADIENT_BAR, MASTERS_INK } from "@/components/masters/theme";
import { CATEGORY_LABEL, CONFIGURABLE_CATEGORIES, type CategoryCode } from "@/lib/incentives/rules-config/spec";
import { createIncentiveDraft, createIncentiveProgram } from "@/app/(masters)/master-setup/incentive-rules/actions";
import { StatusBadge, type StatusName } from "./status";

/**
 * Admin & Master Setup → Incentive Rules: every incentive programme and its configuration versions, newest first —
 * status, effective dates, who wrote, approved and published each. New programmes and new drafts (empty, from the
 * reference template, or a copy of a version) start here; a version opens in its own editor.
 */

const FIELD = "h-9 w-full rounded-lg border border-hairline-strong bg-white px-2.5 text-[13px] text-ink-strong";
const CARD: React.CSSProperties = { border: "1px solid var(--color-hairline)", boxShadow: "0 2px 6px -2px rgba(15, 23, 42, 0.06)" };

export interface HomeVersion {
  id: string;
  categoryCode: string;
  versionNo: number;
  status: StatusName;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  createdByName: string | null;
  approvedByName: string | null;
  publishedByName: string | null;
  updatedAt: string;
}
export interface HomeProgram {
  id: string;
  code: string;
  name: string;
  description: string | null;
  isActive: boolean;
  versions: HomeVersion[];
}

/** How complete a version being prepared is (the check that decides whether it can be submitted and published). */
export interface HomeCheck {
  problems: number;
  missing: number;
  /** The first few messages, as the version's editor shows them. */
  messages: string[];
}

const WORKING: readonly StatusName[] = ["draft", "submitted", "approved", "rejected"];
const RULES_APPROVAL: Partial<Record<StatusName, string>> = {
  draft: "Not yet submitted",
  submitted: "Awaiting Rules Approval",
  approved: "Rules approved — publish to apply",
  rejected: "Rejected — edit and resubmit",
};
const ym = (d: string | null) => (d ? d.slice(0, 7) : "—");

/** The rules' own workflow, start to finish — and what it does not do. */
function RulesWorkflow() {
  const steps = [
    ["Draft", "Written and saved; may be incomplete."],
    ["Submit for Rules Approval", "Every required setting chosen."],
    ["Approve rules", "By another authorised person."],
    ["Publish", "Choose the month it applies from."],
    ["Effective from the month", "Calculations of that month onwards use it."],
  ] as const;
  return (
    <section aria-label="Rules workflow" className="rounded-section bg-white p-4" style={CARD}>
      <h2 className="text-[13px] font-bold text-ink-strong">How rules take effect</h2>
      <ol className="mt-2 grid gap-2 sm:grid-cols-5">
        {steps.map(([label, sub], i) => (
          <li key={label} className="relative rounded-lg px-3 py-2" style={{ background: "#F5F8FF", border: "1px solid #DCE6FA" }}>
            <span className="text-[11px] font-bold tabular-nums" style={{ color: MASTERS_INK }}>
              {i + 1}
            </span>
            <span className="block text-[12.5px] font-bold text-ink-strong">{label}</span>
            <span className="block text-[11.5px] text-ink-muted">{sub}</span>
          </li>
        ))}
      </ol>
      <p role="note" className="mt-2 rounded-lg px-3 py-2 text-[12.5px] text-ink-strong" style={{ background: "#EFF6FF", border: "1px solid #BFDBFE" }}>
        <strong>Rules Approval is not Incentive Approval.</strong> Approving and publishing rules decides how incentives are worked out from a month onwards. It does not approve any employee&apos;s calculated incentive, release it or pay it — each month&apos;s calculated amounts go through Incentive Approval, category by category, in{" "}
        <Link href={"/incentive/manage/overview" as Route} className="font-semibold underline-offset-2 hover:underline" style={{ color: MASTERS_INK }}>
          Incentive Tracker → Incentive Management
        </Link>
        .
      </p>
    </section>
  );
}

/** One programme's Categories A–G: what is in force this month, what is being prepared, its Rules Approval and how complete it is. */
function CategoryOverview({ program, currentMonth, checks }: { program: HomeProgram; currentMonth: string; checks: Record<string, HomeCheck> }) {
  return (
    <div className="mt-2 overflow-x-auto">
      <table className="w-full text-[12.5px]" style={{ minWidth: 940 }} aria-label={`${program.code} categories`}>
        <thead>
          <tr className="text-left text-ink-subtle">
            {["Category", "In force this month", "Being prepared", "Rules Approval", "Published", "Effective month", "Configuration", ""].map((h) => (
              <th key={h} className="px-2 py-1 font-semibold">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {CONFIGURABLE_CATEGORIES.map((c) => {
            const mine = program.versions.filter((v) => v.categoryCode === c);
            const inForce = mine.find((v) => v.status === "published" && !!v.effectiveFrom && v.effectiveFrom <= currentMonth && (!v.effectiveTo || v.effectiveTo >= currentMonth));
            const upcoming = mine.filter((v) => v.status === "published" && !!v.effectiveFrom && v.effectiveFrom > currentMonth).sort((a, b) => a.effectiveFrom!.localeCompare(b.effectiveFrom!))[0];
            const working = mine.find((v) => WORKING.includes(v.status));
            const check = working ? checks[working.id] : undefined;
            const open = working ?? inForce ?? upcoming;
            return (
              <tr key={c} className="border-t border-hairline align-top" aria-label={`Category ${c}`}>
                <td className="px-2 py-1.5">
                  <span className="font-semibold text-ink-strong">{c}</span> · {CATEGORY_LABEL[c]}
                </td>
                <td className="px-2 py-1.5">{inForce ? <>Version {inForce.versionNo}</> : <span className="text-ink-subtle">None</span>}</td>
                <td className="px-2 py-1.5">
                  {working ? (
                    <span className="inline-flex flex-wrap items-center gap-1">
                      v{working.versionNo} <StatusBadge status={working.status} />
                    </span>
                  ) : (
                    <span className="text-ink-subtle">—</span>
                  )}
                </td>
                <td className="px-2 py-1.5">{working ? RULES_APPROVAL[working.status] : inForce || upcoming ? <span className="text-ink-muted">Approved and published</span> : <span className="text-ink-subtle">—</span>}</td>
                <td className="px-2 py-1.5">
                  {inForce ? `Yes — v${inForce.versionNo}` : upcoming ? `Yes — v${upcoming.versionNo}, not yet in force` : <span className="text-ink-subtle">No</span>}
                  {inForce && upcoming && <span className="block text-[11.5px] text-ink-subtle">then v{upcoming.versionNo} from {ym(upcoming.effectiveFrom)}</span>}
                </td>
                <td className="px-2 py-1.5 tabular-nums">{inForce ? `since ${ym(inForce.effectiveFrom)}${inForce.effectiveTo ? ` (to ${inForce.effectiveTo})` : ""}` : upcoming ? `from ${ym(upcoming.effectiveFrom)}` : "—"}</td>
                <td className="px-2 py-1.5">
                  {check ? (
                    check.problems + check.missing === 0 ? (
                      <span className="font-semibold text-[#047857]">Complete{working!.status === "draft" || working!.status === "rejected" ? " — can be submitted" : ""}</span>
                    ) : (
                      <>
                        <span className="font-semibold text-[#B45309]">
                          {[check.missing ? `${check.missing} missing` : null, check.problems ? `${check.problems} to correct` : null].filter(Boolean).join(", ")}
                        </span>
                        <ul className="mt-0.5 text-[11.5px] text-ink-muted">
                          {check.messages.map((m, i) => (
                            <li key={i}>{m}</li>
                          ))}
                        </ul>
                      </>
                    )
                  ) : inForce || upcoming ? (
                    <span className="text-ink-muted">Complete (published)</span>
                  ) : (
                    <span className="text-ink-subtle">Not configured</span>
                  )}
                </td>
                <td className="px-2 py-1.5 text-right">
                  {open && (
                    <Link href={`/master-setup/incentive-rules/${open.id}` as Route} className="text-[12.5px] font-bold" style={{ color: MASTERS_INK }} aria-label={`Open ${program.code} Category ${c} version ${open.versionNo}`}>
                      Open
                    </Link>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function IncentiveRulesHome({ programs, ready, canEdit, currentMonth, checks = {} }: { programs: HomeProgram[]; ready: boolean; canEdit: boolean; currentMonth: string; checks?: Record<string, HomeCheck> }) {
  const router = useRouter();
  const [newProgram, setNewProgram] = React.useState<{ code: string; name: string; description: string } | null>(null);
  const [newDraft, setNewDraft] = React.useState<{ programId: string; category: CategoryCode; startFrom: string } | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [problem, setProblem] = React.useState<string | null>(null);

  async function act<T extends { ok: boolean }>(call: () => Promise<T>, done: (r: T) => void) {
    setBusy(true);
    setProblem(null);
    try {
      const r = await call();
      if (!r.ok) return setProblem((r as unknown as { error: string }).error);
      done(r);
    } catch {
      setProblem("That couldn't be saved. Nothing was changed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      {!ready && (
        <div role="status" className="rounded-section px-5 py-4 text-[14px] text-ink-muted" style={{ background: "var(--color-amber-bg)", border: "1px solid color-mix(in srgb, var(--color-amber) 35%, transparent)" }}>
          <strong className="text-ink-strong">Database update 0131 needed.</strong> Incentive Rules can be configured once it is applied. The live Incentive Tracker is not affected.
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[13px] text-ink-muted">
          Each programme&apos;s rules are versioned: a draft is edited, submitted, approved by another authorised person and published from a month onwards. Published versions never change. Nothing here calculates or pays an incentive.
        </p>
        <button type="button" disabled={!ready || !canEdit} onClick={() => (setProblem(null), setNewProgram({ code: "", name: "", description: "" }))} className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-pill px-4 text-[13px] font-bold text-white disabled:opacity-50" style={{ background: MASTERS_GRADIENT }}>
          <Plus size={15} aria-hidden /> New programme
        </button>
      </div>
      <RulesWorkflow />

      {ready && programs.length === 0 && (
        <p className="rounded-section bg-white p-5 text-[13.5px] text-ink-muted" style={CARD}>
          No incentive programme yet. Create one to start configuring its rules.
        </p>
      )}

      {programs.map((p) => {
        const inForce = p.versions.find((v) => v.status === "published" && v.effectiveFrom! <= currentMonth && (!v.effectiveTo || v.effectiveTo >= currentMonth));
        return (
          <section key={p.id} aria-label={`Programme ${p.code}`} className="rounded-section bg-white p-4" style={CARD}>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-bold text-ink-strong" style={{ fontSize: 15 }}>
                {p.name} <span className="font-mono text-[12px] text-ink-subtle">{p.code}</span>
              </h2>
              {!p.isActive && <span className="rounded px-1.5 text-[11px] font-bold text-[#B91C1C]" style={{ background: "#FEF2F2" }}>Inactive</span>}
              <span className="text-[12.5px] text-ink-muted">{inForce ? `In force this month: version ${inForce.versionNo}` : "No version in force this month"}</span>
              <span className="ml-auto flex gap-2">
                {p.versions.length > 1 && (
                  <Link href={`/master-setup/incentive-rules/compare?a=${p.versions[1]!.id}&b=${p.versions[0]!.id}` as Route} className="inline-flex h-8 items-center gap-1 rounded-pill border border-hairline-strong bg-white px-3 text-[12.5px] font-bold text-ink-strong">
                    <GitCompare size={14} aria-hidden /> Compare versions
                  </Link>
                )}
                <button type="button" disabled={!canEdit || !p.isActive} onClick={() => (setProblem(null), setNewDraft({ programId: p.id, category: "A", startFrom: "blank" }))} className="inline-flex h-8 items-center gap-1 rounded-pill px-3 text-[12.5px] font-bold text-white disabled:opacity-50" style={{ background: MASTERS_INK }}>
                  <Plus size={14} aria-hidden /> New draft
                </button>
              </span>
            </div>
            {p.description && <p className="mt-1 text-[12.5px] text-ink-muted">{p.description}</p>}
            <h3 className="mt-3 text-[12px] font-bold uppercase tracking-wide text-ink-subtle">Categories A–G — {currentMonth.slice(0, 7)}</h3>
            <CategoryOverview program={p} currentMonth={currentMonth} checks={checks} />
            <h3 className="mt-4 text-[12px] font-bold uppercase tracking-wide text-ink-subtle">All versions</h3>
            {p.versions.length === 0 ? (
              <p className="mt-2 text-[12.5px] text-ink-subtle">No version yet.</p>
            ) : (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-[12.5px]" style={{ minWidth: 760 }}>
                  <thead>
                    <tr className="text-left text-ink-subtle">
                      {["Version", "Category", "Status", "Effective", "Written by", "Approved by", "Published by", ""].map((h) => (
                        <th key={h} className="px-2 py-1 font-semibold">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {p.versions.map((v) => (
                      <tr key={v.id} className="border-t border-hairline">
                        <td className="px-2 py-1.5 font-semibold tabular-nums text-ink-strong">v{v.versionNo}</td>
                        <td className="px-2 py-1.5">{v.categoryCode} · {CATEGORY_LABEL[v.categoryCode as CategoryCode]}</td>
                        <td className="px-2 py-1.5"><StatusBadge status={v.status} /></td>
                        <td className="px-2 py-1.5 tabular-nums">{v.effectiveFrom ? `${v.effectiveFrom} → ${v.effectiveTo ?? "open"}` : "—"}</td>
                        <td className="px-2 py-1.5">{v.createdByName ?? "—"}</td>
                        <td className="px-2 py-1.5">{v.approvedByName ?? "—"}</td>
                        <td className="px-2 py-1.5">{v.publishedByName ?? "—"}</td>
                        <td className="px-2 py-1.5 text-right">
                          <Link href={`/master-setup/incentive-rules/${v.id}` as Route} className="text-[12.5px] font-bold" style={{ color: MASTERS_INK }} aria-label={`Open ${p.code} version ${v.versionNo}`}>
                            Open
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        );
      })}

      <CenterDialog
        open={newProgram !== null}
        title="New incentive programme"
        subtitle="A programme holds the rule versions for one group of salespeople."
        accentBar={MASTERS_GRADIENT_BAR}
        width={520}
        onClose={() => setNewProgram(null)}
        footer={
          <div className="flex items-center justify-end gap-2">
            {problem && <p role="alert" className="mr-auto text-[12.5px] font-semibold text-[#B91C1C]">{problem}</p>}
            <button type="button" onClick={() => setNewProgram(null)} className="h-9 rounded-lg border border-hairline-strong bg-white px-4 text-[13.5px] font-semibold">Cancel</button>
            <button type="button" disabled={busy || !newProgram?.code.trim() || !newProgram?.name.trim()} onClick={() => newProgram && void act(() => createIncentiveProgram({ code: newProgram.code, name: newProgram.name, description: newProgram.description.trim() || null }), () => { fireToast({ message: "Programme created.", type: "success" }); setNewProgram(null); router.refresh(); })} className="h-9 rounded-lg px-4 text-[13.5px] font-semibold text-white disabled:opacity-50" style={{ background: MASTERS_GRADIENT }}>
              Create programme
            </button>
          </div>
        }
      >
        {newProgram && (
          <div className="grid gap-3">
            <label className="grid gap-1 text-[12px] font-semibold text-ink-muted">
              Code (capital letters, digits, - or _)
              <input aria-label="Programme code" className={FIELD} value={newProgram.code} maxLength={32} onChange={(e) => setNewProgram({ ...newProgram, code: e.target.value.toUpperCase() })} />
            </label>
            <label className="grid gap-1 text-[12px] font-semibold text-ink-muted">
              Name
              <input aria-label="Programme name" className={FIELD} value={newProgram.name} maxLength={120} onChange={(e) => setNewProgram({ ...newProgram, name: e.target.value })} />
            </label>
            <label className="grid gap-1 text-[12px] font-semibold text-ink-muted">
              Description (optional)
              <textarea aria-label="Programme description" rows={2} className={`${FIELD} h-auto py-2`} value={newProgram.description} maxLength={1000} onChange={(e) => setNewProgram({ ...newProgram, description: e.target.value })} />
            </label>
          </div>
        )}
      </CenterDialog>

      <CenterDialog
        open={newDraft !== null}
        title="New draft"
        subtitle="A draft can be saved incomplete; it can be submitted only once every required setting is chosen."
        accentBar={MASTERS_GRADIENT_BAR}
        width={560}
        onClose={() => setNewDraft(null)}
        footer={
          <div className="flex items-center justify-end gap-2">
            {problem && <p role="alert" className="mr-auto text-[12.5px] font-semibold text-[#B91C1C]">{problem}</p>}
            <button type="button" onClick={() => setNewDraft(null)} className="h-9 rounded-lg border border-hairline-strong bg-white px-4 text-[13.5px] font-semibold">Cancel</button>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                newDraft &&
                void act(
                  () => createIncentiveDraft({ programId: newDraft.programId, category: newDraft.category, startFrom: newDraft.startFrom === "blank" || newDraft.startFrom === "reference" ? newDraft.startFrom : { versionId: newDraft.startFrom } }),
                  (r) => router.push(`/master-setup/incentive-rules/${(r as unknown as { versionId: string }).versionId}` as Route),
                )
              }
              className="h-9 rounded-lg px-4 text-[13.5px] font-semibold text-white disabled:opacity-50"
              style={{ background: MASTERS_GRADIENT }}
            >
              Create draft
            </button>
          </div>
        }
      >
        {newDraft && (
          <div className="grid gap-3">
            <label className="grid gap-1 text-[12px] font-semibold text-ink-muted">
              Category
              <select aria-label="Category" className={FIELD} value={newDraft.category} onChange={(e) => setNewDraft({ ...newDraft, category: e.target.value as CategoryCode })}>
                {CONFIGURABLE_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c} · {CATEGORY_LABEL[c]}
                  </option>
                ))}
              </select>
            </label>
            <fieldset className="grid gap-1.5 text-[13px]">
              <legend className="mb-1 text-[12px] font-semibold text-ink-muted">Start from</legend>
              <label className="inline-flex items-start gap-2">
                <input type="radio" name="startFrom" checked={newDraft.startFrom === "blank"} onChange={() => setNewDraft({ ...newDraft, startFrom: "blank" })} />
                <span>Nothing — every setting starts empty</span>
              </label>
              <label className="inline-flex items-start gap-2">
                <input type="radio" name="startFrom" checked={newDraft.startFrom === "reference"} onChange={() => setNewDraft({ ...newDraft, startFrom: "reference" })} />
                <span>
                  The reference template — the values the Incentive Planning PDF and the April examples establish (threshold, slabs, delay steps, limits). Every business decision they leave open stays empty.
                </span>
              </label>
              {programs
                .find((p) => p.id === newDraft.programId)
                ?.versions.filter((v) => v.categoryCode === newDraft.category)
                .map((v) => (
                  <label key={v.id} className="inline-flex items-start gap-2">
                    <input type="radio" name="startFrom" checked={newDraft.startFrom === v.id} onChange={() => setNewDraft({ ...newDraft, startFrom: v.id })} />
                    <span>
                      A copy of version {v.versionNo} ({v.status})
                    </span>
                  </label>
                ))}
            </fieldset>
          </div>
        )}
      </CenterDialog>
    </div>
  );
}
