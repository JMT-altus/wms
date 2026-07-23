"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { recomputePeriod } from "@/app/(app)/incentive/actions";

export function RecomputeButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            setMsg(null);
            const res = await recomputePeriod();
            setMsg(res.ok ? `Recomputed ${res.employees} employee(s).` : res.error);
            if (res.ok) router.refresh();
          })
        }
        className="rounded-xl px-5 py-2.5 text-white text-[14px] font-bold disabled:opacity-60"
        style={{ background: "linear-gradient(135deg, #6366F1, #4338CA)", boxShadow: "0 10px 22px -10px rgba(99,102,241,0.5)" }}
      >
        {pending ? "Computing…" : "Recompute this month"}
      </button>
      {msg && <span className="text-[13px] font-semibold text-ink-muted">{msg}</span>}
    </div>
  );
}
