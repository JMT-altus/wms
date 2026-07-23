"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { reviewSubmission } from "@/app/(app)/incentive/actions";
import type { PendingItem } from "@/lib/queries/incentives";

const QUEUE_LABEL: Record<PendingItem["queue"], string> = {
  lead_batch: "LEADS",
  lead_conversion: "ENQUIRIES",
  meeting: "MEETING",
  testimonial: "REVIEW",
};

export function VerificationQueue({ items }: { items: PendingItem[] }) {
  if (items.length === 0) {
    return (
      <div className="rounded-[18px] p-8 text-center" style={{ background: "#fff", border: "1px dashed rgba(15,23,42,0.14)" }}>
        <p className="text-ink-strong font-semibold text-[16px]">Nothing awaiting review.</p>
        <p className="text-ink-muted text-[13.5px] mt-1">Employee submissions will appear here.</p>
      </div>
    );
  }
  return (
    <div className="rounded-[18px] overflow-hidden" style={{ border: "1px solid rgba(15,23,42,0.08)" }}>
      {items.map((it, i) => (
        <Row key={`${it.queue}-${it.id}`} it={it} first={i === 0} />
      ))}
    </div>
  );
}

function Row({ it, first }: { it: PendingItem; first: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [award, setAward] = useState("250");
  const [names, setNames] = useState(!!it.namesTeamMember);

  function decide(decision: "approved" | "rejected") {
    start(async () => {
      const res = await reviewSubmission({
        queue: it.queue, id: it.id, decision,
        awardedRupees: it.needsAward ? Number(award) : undefined,
        namesTeamMember: it.queue === "testimonial" ? names : undefined,
      });
      if (res.ok) router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-4 px-5 py-4 max-md:flex-wrap" style={{ background: "#fff", borderTop: first ? undefined : "1px solid rgba(15,23,42,0.06)" }}>
      <span className="shrink-0 inline-flex items-center rounded-md px-2 py-1 text-[10.5px] font-extrabold tracking-[0.1em]" style={{ background: "rgba(10,108,255,0.08)", color: "#0a47b3", minWidth: 84, justifyContent: "center" }}>
        {QUEUE_LABEL[it.queue]}
      </span>
      <div className="flex-1 min-w-0">
        <div className="font-bold text-ink-strong text-[14px]">{it.employeeName} <span className="text-ink-subtle font-semibold">· {it.period}</span></div>
        <div className="text-ink-muted text-[13px] mt-0.5 truncate">{it.summary}</div>
      </div>

      {it.needsAward && (
        <label className="shrink-0 flex items-center gap-1.5">
          <span className="text-ink-subtle text-[12px] font-bold">₹</span>
          <input value={award} onChange={(e) => setAward(e.target.value)} type="number" min={250} max={1000} className="w-20 rounded-lg px-2 py-1.5 text-[13px]" style={{ border: "1px solid rgba(15,23,42,0.14)" }} />
        </label>
      )}
      {it.queue === "testimonial" && (
        <label className="shrink-0 flex items-center gap-1.5 text-[12.5px] font-semibold text-ink-muted">
          <input type="checkbox" checked={names} onChange={(e) => setNames(e.target.checked)} /> Names 2×
        </label>
      )}

      <div className="shrink-0 flex items-center gap-2">
        <button type="button" disabled={pending} onClick={() => decide("approved")} className="rounded-lg px-3.5 py-2 text-white text-[13px] font-bold disabled:opacity-60" style={{ background: "linear-gradient(135deg, #22b563, #15803d)" }}>
          Approve
        </button>
        <button type="button" disabled={pending} onClick={() => decide("rejected")} className="rounded-lg px-3.5 py-2 text-[13px] font-bold disabled:opacity-60" style={{ background: "rgba(15,23,42,0.05)", color: "#334155" }}>
          Reject
        </button>
      </div>
    </div>
  );
}
