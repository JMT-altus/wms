"use client";

import { useRouter } from "next/navigation";
import type { Route } from "next";
import { DateField } from "@/components/ui/date-field";

/** Date field that re-renders the admin team view for the picked day. */
export function TeamDatePicker({ date }: { date: string }) {
  const router = useRouter();
  return (
    <DateField
      value={date}
      aria-label="Team attendance date"
      onChange={(v) => {
        if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
          router.push(`/attendance?date=${v}` as Route);
        }
      }}
      className="rounded-md border border-[#CBD5E1] px-3 py-2 text-[14px] bg-white tabular-nums"
    />
  );
}
