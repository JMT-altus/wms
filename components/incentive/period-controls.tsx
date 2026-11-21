"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setPeriodStatus } from "@/app/(app)/incentive/actions";

const STEPS: { status: "open" | "review" | "locked" | "paid"; label: string }[] = [
  { status: "open", label: "Open" },
  { status: "review", label: "Review" },
  { status: "locked", label: "Locked" },
  { status: "paid", label: "Paid" },
];

export function PeriodControls({ status, period }: { status: string; /** The month shown (YYYY-MM): the controls act on it, never on another. */ period?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const currentIdx = STEPS.findIndex((s) => s.status === status);

  function move(to: "open" | "review" | "locked" | "paid") {
    setError(null);
    start(async () => {
      const res = await setPeriodStatus({ status: to, ...(period ? { period } : {}) });
      if (res.ok) router.refresh();
      else setError(res.error);
    });
  }

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <div className="inline-flex items-center gap-1.5">
        {STEPS.map((s, i) => (
          <span key={s.status} className="inline-flex items-center gap-1.5">
            <span
              className="inline-flex items-center rounded-full px-3 py-1 text-[11.5px] font-extrabold tracking-[0.08em]"
              style={i <= currentIdx
                ? { background: "linear-gradient(135deg, #0a6cff, #12b6a0)", color: "#fff" }
                : { background: "rgba(15,23,42,0.06)", color: "#94a3b8" }}
            >
              {s.label.toUpperCase()}
            </span>
            {i < STEPS.length - 1 && <span className="text-ink-subtle">→</span>}
          </span>
        ))}
      </div>
      <div className="flex items-center gap-2">
        {status === "open" && <Btn pending={pending} onClick={() => move("review")}>Move to review</Btn>}
        {status === "review" && <><Btn pending={pending} onClick={() => move("locked")}>Lock period</Btn><GhostBtn pending={pending} onClick={() => move("open")}>Reopen</GhostBtn></>}
        {status === "locked" && <><Btn pending={pending} onClick={() => move("paid")}>Mark paid → payroll</Btn><GhostBtn pending={pending} onClick={() => move("review")}>Unlock</GhostBtn></>}
        {status === "paid" && <span className="text-[13px] font-semibold" style={{ color: "#15803d" }}>Paid &amp; pushed to payroll.</span>}
        {error && <span role="alert" className="text-[12.5px] font-semibold" style={{ color: "#b91c1c" }}>{error}</span>}
      </div>
    </div>
  );
}

function Btn({ pending, onClick, children }: { pending: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" disabled={pending} onClick={onClick} className="rounded-xl px-4 py-2 text-white text-[13.5px] font-bold disabled:opacity-60" style={{ background: "linear-gradient(135deg, #6366F1, #4338CA)" }}>{children}</button>;
}
function GhostBtn({ pending, onClick, children }: { pending: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type="button" disabled={pending} onClick={onClick} className="rounded-xl px-4 py-2 text-[13.5px] font-bold disabled:opacity-60" style={{ background: "rgba(15,23,42,0.05)", color: "#334155" }}>{children}</button>;
}
