"use client";

import * as React from "react";
import { Search } from "lucide-react";
import type { DashboardRow } from "@/lib/queries/attendance-status";
import { EmployeeDetailDialog } from "./employee-detail";

export function AttendanceDashboardTable({
  rows,
  year,
  month,
}: {
  rows: DashboardRow[];
  year: number;
  month: number;
}) {
  const [query, setQuery] = React.useState("");
  const [selected, setSelected] = React.useState<{
    id: string;
    name: string;
  } | null>(null);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.name.toLowerCase().includes(q));
  }, [rows, query]);

  return (
    <section
      className="rounded-xl border border-[#DCE4F0] bg-white p-4 max-md:p-3"
      style={{ boxShadow: "0 1px 2px rgba(11, 31, 68, 0.05)" }}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full max-w-[320px]">
          <Search
            size={14}
            strokeWidth={2.2}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-[#94A3B8] pointer-events-none"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by employee…"
            aria-label="Search employees"
            className="h-9 w-full rounded-lg border border-[#D6DEEB] bg-white pl-8 pr-3 text-[13px] text-[#0B1F44] placeholder:text-[#94A3B8] outline-none transition-[border-color,box-shadow] hover:border-[#B9C6DB] focus:border-[#0A6CFF] focus:ring-[3px] focus:ring-[#0A6CFF]/15"
          />
        </div>
        <span className="rounded-full bg-[#F1F5FB] px-2.5 py-1 text-[12px] font-semibold text-[#475569] tabular-nums">
          {filtered.length} {filtered.length === 1 ? "person" : "people"}
        </span>
      </div>

      {filtered.length === 0 ? (
        <p className="py-8 text-center font-semibold text-ink-subtle" style={{ fontSize: 14 }}>
          {rows.length === 0
            ? "No active employees for this month."
            : "No employees match your search."}
        </p>
      ) : (
        // Scrolls sideways inside its own frame on narrow screens; the Employee column stays pinned while it does.
        <div className="overflow-x-auto rounded-lg border border-[#E2E8F0]">
          <table className="att-report-table w-full border-collapse min-w-[1080px]">
            <thead>
              <tr style={{ background: "#F5F7FB" }}>
                <Th>Employee</Th>
                <Th align="right">Present</Th>
                <Th align="right">Absent</Th>
                <Th align="right">Half-Day</Th>
                <Th align="right">Late</Th>
                <Th align="right">Left-Early</Th>
                <Th align="right">Late-Waived</Th>
                <Th align="right">Weekly-Off</Th>
                <Th align="right">Holiday</Th>
                <Th align="right" hint="Holiday Present">HP</Th>
                <Th align="right">Paid Leave</Th>
                <Th align="right">Unpaid Leave</Th>
                <Th align="right">Comp-Off</Th>
                <Th align="right">Payable Days</Th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => {
                const s = r.summary;
                return (
                  <tr
                    key={r.employeeId}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelected({ id: r.employeeId, name: r.name })}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelected({ id: r.employeeId, name: r.name });
                      }
                    }}
                    data-row-index={i}
                    className="group cursor-pointer border-t border-[#EEF2F7] bg-white outline-none transition-colors hover:bg-[#F6F9FF] focus-visible:bg-[#EEF4FF]"
                  >
                    <td
                      className="sticky left-0 z-[1] whitespace-nowrap bg-white px-3 py-2 font-semibold text-[#0B1F44] transition-colors group-hover:bg-[#F6F9FF] group-focus-visible:bg-[#EEF4FF]"
                      style={{ fontSize: 13 }}
                    >
                      {r.name}
                    </td>
                    <Td align="right">{s.present}</Td>
                    <Td align="right">{s.absent}</Td>
                    <Td align="right">{s.halfDay}</Td>
                    <Td
                      align="right"
                      style={s.late > 0 ? { color: "var(--color-red-deep)" } : undefined}
                    >
                      {s.late}
                    </Td>
                    <Td align="right">{s.leftEarly}</Td>
                    <Td
                      align="right"
                      style={
                        s.lateWaived > 0 ? { color: "var(--color-amber-deep)" } : undefined
                      }
                    >
                      {s.lateWaived}
                    </Td>
                    <Td align="right">{s.weeklyOff}</Td>
                    <Td align="right">{s.holiday}</Td>
                    <Td
                      align="right"
                      style={
                        s.holidayPresent > 0 ? { color: "var(--color-green-deep)" } : undefined
                      }
                    >
                      {s.holidayPresent}
                    </Td>
                    <Td
                      align="right"
                      style={
                        s.paidLeave > 0 ? { color: "var(--color-blue-deep)" } : undefined
                      }
                    >
                      {s.paidLeave}
                    </Td>
                    <Td align="right">{s.unpaidLeave}</Td>
                    <Td
                      align="right"
                      style={
                        s.compOff > 0 ? { color: "var(--color-teal-deep)" } : undefined
                      }
                    >
                      {s.compOff}
                    </Td>
                    <td
                      className="px-3 py-2 text-right font-bold text-[#0B1F44] tabular-nums whitespace-nowrap"
                      style={{ fontSize: 13, background: "rgba(10,108,255,0.04)" }}
                    >
                      {s.payableDays}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <EmployeeDetailDialog
        open={selected !== null}
        onOpenChange={(o) => {
          if (!o) setSelected(null);
        }}
        employeeId={selected?.id ?? null}
        employeeName={selected?.name ?? ""}
        year={year}
        month={month}
      />
    </section>
  );
}

function Th({
  children,
  align = "left",
  hint,
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  hint?: string;
}) {
  return (
    <th
      className="px-3 py-2.5 font-semibold text-[#334155] whitespace-nowrap first:sticky first:left-0 first:z-[2] first:bg-[#F5F7FB]"
      style={{ fontSize: 12, textAlign: align, borderBottom: "1px solid #E2E8F0" }}
      title={hint}
    >
      <span className="inline-flex items-center gap-1">
        {children}
        {hint && (
          <span
            className="rounded px-1 py-px text-[9.5px] font-semibold"
            style={{ background: "#E8EEF8", color: "#64748B" }}
          >
            {hint}
          </span>
        )}
      </span>
    </th>
  );
}

function Td({
  children,
  align = "left",
  style,
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  style?: React.CSSProperties;
}) {
  return (
    <td
      className="px-3 py-2 font-medium text-[#334155] tabular-nums whitespace-nowrap"
      style={{ fontSize: 13, textAlign: align, ...style }}
    >
      {children}
    </td>
  );
}
