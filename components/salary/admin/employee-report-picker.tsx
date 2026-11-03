"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { NAVY, SLATE } from "@/components/attendance/overview/theme";

/**
 * The admin Employee Salary Report's employee picker: choosing someone opens
 * their report for the month on screen. The list and the access check both
 * come from the server; this only navigates.
 */
export function EmployeeReportPicker({
  employees,
  selectedId,
  month,
}: {
  employees: { id: string; name: string; inactive: boolean }[];
  selectedId: string | null;
  month: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <label className="flex flex-col gap-1 text-[12px] font-bold uppercase tracking-[0.08em]" style={{ color: SLATE }}>
      Employee
      <select
        value={selectedId ?? ""}
        disabled={pending}
        onChange={(e) => {
          const id = e.target.value;
          if (id) start(() => router.push(`/salary/employee/${id}?month=${month}` as Route));
        }}
        aria-label="Employee"
        className="h-10 min-w-[240px] rounded-lg bg-white px-3 text-[14px] font-semibold normal-case tracking-normal max-md:w-full"
        style={{ border: "1px solid #D8E0EB", color: NAVY }}
      >
        <option value="" disabled>
          Choose an employee…
        </option>
        {employees.map((e) => (
          <option key={e.id} value={e.id}>
            {e.name}
            {e.inactive ? " (inactive)" : ""}
          </option>
        ))}
      </select>
    </label>
  );
}
