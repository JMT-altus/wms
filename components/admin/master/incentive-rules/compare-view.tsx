"use client";

import { useRouter } from "next/navigation";
import type { Route } from "next";
import type { Difference } from "@/lib/incentives/rules-config/validate";
import { DiffTable } from "./version-editor";
import { STATUS_LABEL, type StatusName } from "./status";

/** The comparison of two versions: pick them, see every setting that differs (red: the first; green: the second). */
export function CompareView({ a, b, versions, diffs, problem }: { a: { id: string; versionNo: number; status: StatusName } | null; b: { id: string; versionNo: number; status: StatusName } | null; versions: { id: string; versionNo: number; status: StatusName; categoryCode: string }[]; diffs: Difference[] | null; problem: string | null }) {
  const router = useRouter();
  const go = (na: string | undefined, nb: string | undefined) => router.push(`/master-setup/incentive-rules/compare?a=${na ?? ""}&b=${nb ?? ""}` as Route);
  const select = (label: string, value: string | undefined, on: (v: string) => void) => (
    <label className="grid gap-1 text-[12px] font-semibold text-ink-muted">
      {label}
      <select aria-label={label} className="h-9 rounded-lg border border-hairline-strong bg-white px-2.5 text-[13px] text-ink-strong" value={value ?? ""} onChange={(e) => on(e.target.value)}>
        <option value="">Choose…</option>
        {versions.map((v) => (
          <option key={v.id} value={v.id}>
            {v.categoryCode} v{v.versionNo} — {STATUS_LABEL[v.status]}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <section aria-label="Comparison" className="mt-3 rounded-section bg-white p-4" style={{ border: "1px solid var(--color-hairline)" }}>
      <div className="grid grid-cols-2 max-sm:grid-cols-1 gap-3">
        {select("First version", a?.id, (v) => go(v, b?.id))}
        {select("Second version", b?.id, (v) => go(a?.id, v))}
      </div>
      <div className="mt-3 overflow-x-auto">
        {problem ? <p className="text-[13px] text-ink-muted">{problem}</p> : diffs && <DiffTable diffs={diffs} empty="The two versions are the same." />}
      </div>
    </section>
  );
}
