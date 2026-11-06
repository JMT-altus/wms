"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { CONTROL, SLATE } from "@/components/salary/ui";

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
    <label className="flex flex-col gap-1 text-[12px] font-semibold" style={{ color: SLATE }}>
      Employee
      <select
        value={selectedId ?? ""}
        disabled={pending}
        onChange={(e) => {
          const id = e.target.value;
          if (id) start(() => router.push(`/salary/employee/${id}?month=${month}` as Route));
        }}
        aria-label="Employee"
        className={`${CONTROL} !h-9 min-w-[240px] max-md:w-full`}
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
