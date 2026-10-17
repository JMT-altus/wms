"use client";
import { CalendarClock, Check, ChevronDown } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DUE_BUCKETS } from "@/lib/due-buckets";

/**
 * "All Due Dates" — a single-select over open tasks' distance from their due
 * date (overdue by how much, due today, or still ahead). "" means no limit.
 */
export function DueDateFilter({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const current = DUE_BUCKETS.find((b) => b.value === value);
  return (
    <div className="filter-chip">
      <CalendarClock size={14} className="text-ink-subtle" strokeWidth={2} />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            data-filter-active={value ? "" : undefined}
            className="inline-flex items-center gap-1 text-left text-[12px] font-medium text-ink-strong outline-none"
          >
            <span className="truncate">{current ? current.label : "All Due Dates"}</span>
            <ChevronDown size={12} className="text-ink-subtle" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-[260px]">
          {[{ value: "", label: "All Due Dates" }, ...DUE_BUCKETS].map((b) => (
            <DropdownMenuItem
              key={b.value || "all"}
              onSelect={() => onChange(b.value)}
              className="justify-between text-[13px] font-medium"
            >
              <span>{b.label}</span>
              {value === b.value && <Check size={14} strokeWidth={2.4} className="text-[#0A6CFF]" />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
