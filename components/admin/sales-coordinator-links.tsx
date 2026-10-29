"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { setCoordinatorLink } from "@/app/(admin)/admin/sales-coordinators/actions";
import type { CoordinatorLinkRow, LinkState } from "@/lib/queries/coordinator-links";

/**
 * The Sales Coordinators table: one row per active login, with its link. Only a
 * super-admin gets the controls, and never on their own row; the server checks
 * both again, validates the label against the Collection Master and refuses a
 * label already linked to someone else.
 */
const NONE = "__none__";
const UNCONFIGURED = "__unconfigured__";
const valueOf = (s: LinkState) => (s.kind === "label" ? `label:${s.label}` : s.kind === "none" ? NONE : UNCONFIGURED);
const stateFromValue = (v: string): LinkState => (v === NONE ? { kind: "none" } : v === UNCONFIGURED ? { kind: "unconfigured" } : { kind: "label", label: v.slice(6) });
const describe = (s: LinkState) => (s.kind === "label" ? s.label : s.kind === "none" ? "Not a Sales Coordinator" : "Not configured");

export function SalesCoordinatorLinks({
  storageReady,
  rows,
  labels,
  canEdit,
  myId,
}: {
  storageReady: boolean;
  rows: CoordinatorLinkRow[];
  labels: string[];
  canEdit: boolean;
  myId: string;
}) {
  if (!storageReady) {
    return (
      <p role="status" className="rounded-lg border border-hairline bg-white px-4 py-3 text-[14px] text-ink-subtle">
        Sales Coordinator links aren&apos;t set up on this database yet (database update 0120 is needed).
      </p>
    );
  }
  const linkedTo = new Map<string, string>();
  for (const r of rows) if (r.state.kind === "label") linkedTo.set(r.state.label, r.name);
  return (
    <div>
      {!canEdit && <p className="mb-3 text-[13px] text-ink-subtle">Only a super-admin can change these links.</p>}
      {labels.length === 0 && <p className="mb-3 text-[13px] text-ink-subtle">The Collection Master has no Sales Coordinators yet, so no login can be linked.</p>}
      <div className="overflow-x-auto rounded-lg border border-hairline bg-white">
        <table className="w-full text-[13.5px]">
          <thead>
            <tr className="text-left text-[12px] text-ink-subtle">
              <th className="px-3 py-2 font-semibold">Login</th>
              <th className="px-3 py-2 font-semibold">Sales Coordinator</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <LinkRow key={`${r.employeeId}:${valueOf(r.state)}`} row={r} labels={labels} linkedTo={linkedTo} editable={canEdit && r.employeeId !== myId} isMe={r.employeeId === myId} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function LinkRow({ row, labels, linkedTo, editable, isMe }: { row: CoordinatorLinkRow; labels: string[]; linkedTo: Map<string, string>; editable: boolean; isMe: boolean }) {
  const router = useRouter();
  const [value, setValue] = React.useState(valueOf(row.state));
  const [busy, setBusy] = React.useState(false);
  const [msg, setMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  const inFlight = React.useRef(false);
  const stale = row.state.kind === "label" && !labels.includes(row.state.label);

  async function save() {
    if (inFlight.current || value === valueOf(row.state)) return;
    inFlight.current = true;
    setBusy(true);
    setMsg(null);
    try {
      const res = await setCoordinatorLink({ employeeId: row.employeeId, choice: stateFromValue(value), expected: row.state });
      if (!res.ok) setMsg({ ok: false, text: res.error });
      else {
        setMsg({ ok: true, text: "Saved." });
        router.refresh();
      }
    } catch {
      setMsg({ ok: false, text: "The link could not be saved, so nothing was changed. Please try again." });
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  return (
    <tr className="border-t border-[#EEF1F6] align-top">
      <td className="px-3 py-2">
        <span className="font-semibold text-ink-strong">{row.name}</span>
        {isMe && <span className="ml-1 text-[12px] text-ink-subtle">(you)</span>}
        <span className="block text-[12px] text-ink-subtle">{row.email}</span>
      </td>
      <td className="px-3 py-2">
        {editable ? (
          <span className="flex flex-wrap items-center gap-2">
            <select
              aria-label={`Sales Coordinator for ${row.name}`}
              value={value}
              disabled={busy}
              onChange={(e) => setValue(e.target.value)}
              className="h-8 rounded-md border border-hairline-strong bg-white px-2 text-[13px]"
            >
              <option value={UNCONFIGURED}>Not configured</option>
              <option value={NONE}>Not a Sales Coordinator</option>
              {stale && row.state.kind === "label" && <option value={valueOf(row.state)}>{row.state.label} (no longer in the Collection Master)</option>}
              {labels.map((l) => {
                const holder = linkedTo.get(l);
                const taken = holder !== undefined && !(row.state.kind === "label" && row.state.label === l);
                return (
                  <option key={l} value={`label:${l}`} disabled={taken}>
                    {l}
                    {taken ? ` (linked to ${holder})` : ""}
                  </option>
                );
              })}
            </select>
            <button
              type="button"
              onClick={save}
              disabled={busy || value === valueOf(row.state)}
              className="h-8 rounded-md bg-[#0B4FB8] px-3 text-[12.5px] font-semibold text-white disabled:opacity-50"
            >
              {busy ? "Saving…" : "Save"}
            </button>
          </span>
        ) : (
          <span className={row.state.kind === "label" ? "text-ink-strong" : "text-ink-subtle"}>
            {describe(row.state)}
            {stale && " (no longer in the Collection Master)"}
          </span>
        )}
        {msg && (
          <span role={msg.ok ? "status" : "alert"} className={`mt-1 block text-[12px] font-semibold ${msg.ok ? "text-[#067647]" : "text-[#B42318]"}`}>
            {msg.text}
          </span>
        )}
      </td>
    </tr>
  );
}
