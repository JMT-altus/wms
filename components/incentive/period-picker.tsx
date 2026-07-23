"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import type { Route } from "next";

export function PeriodPicker({ current, options }: { current: string; options: { value: string; label: string }[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();

  function change(value: string) {
    const params = new URLSearchParams(sp.toString());
    params.set("period", value);
    router.push(`${pathname}?${params.toString()}` as Route);
  }

  return (
    <select
      value={current}
      onChange={(e) => change(e.target.value)}
      className="rounded-xl px-3.5 py-2 text-[13.5px] font-bold text-ink-strong"
      style={{ background: "#fff", border: "1px solid rgba(15,23,42,0.14)", fontVariantNumeric: "tabular-nums" }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}
