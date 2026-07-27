"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { confirmSale, deleteSale } from "@/app/(app)/incentive/actions";
import { formatInrCompactPaise } from "@/lib/format";
import type { PendingSale } from "@/lib/queries/incentives";

export function SalesConfirmQueue({ sales }: { sales: PendingSale[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  if (sales.length === 0) {
    return <p className="text-ink-muted text-[13.5px]">No sales awaiting confirmation.</p>;
  }
  return (
    <div className="rounded-[18px] overflow-hidden" style={{ border: "1px solid rgba(15,23,42,0.08)" }}>
      {sales.map((s, i) => (
        <div key={s.orderId} className="flex items-center gap-4 px-5 py-3.5 max-md:flex-wrap" style={{ background: i % 2 ? "rgba(15,23,42,0.015)" : "#fff", borderTop: i ? "1px solid rgba(15,23,42,0.06)" : undefined }}>
          <span className="shrink-0 inline-flex items-center rounded-md px-2 py-1 text-[10.5px] font-extrabold" style={{ background: "rgba(10,108,255,0.08)", color: "#0a47b3", minWidth: 34, justifyContent: "center" }}>{s.category}</span>
          <div className="flex-1 min-w-0">
            <div className="font-bold text-ink-strong text-[13.5px]">{s.customer} <span className="text-ink-subtle font-semibold">· {s.owner}</span></div>
            <div className="text-ink-subtle text-[12.5px]">{formatInrCompactPaise(s.valuePaise)} · {s.bookedAt}</div>
          </div>
          <div className="shrink-0 flex items-center gap-2">
            <button type="button" disabled={pending} onClick={() => start(async () => { const r = await confirmSale({ orderId: s.orderId }); if (r.ok) router.refresh(); })} className="rounded-lg px-3.5 py-2 text-white text-[13px] font-bold disabled:opacity-60" style={{ background: "linear-gradient(135deg, #22b563, #15803d)" }}>Confirm</button>
            {s.invoiceId && <button type="button" disabled={pending} onClick={() => { if (confirm("Reject and delete this logged sale?")) start(async () => { const r = await deleteSale({ invoiceId: s.invoiceId! }); if (r.ok) router.refresh(); }); }} className="rounded-lg px-3.5 py-2 text-[13px] font-bold disabled:opacity-60" style={{ background: "rgba(15,23,42,0.05)", color: "#334155" }}>Reject</button>}
          </div>
        </div>
      ))}
    </div>
  );
}
