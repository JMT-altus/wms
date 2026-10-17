"use client";
import { UserCheck } from "lucide-react";
import { MultiSelect } from "@/components/ui/multi-select";

/**
 * "All Initiator Status" — the initiator's ruling on a task (the Initiator
 * Status column: Approved, Not Approved, Cancelled, Transferred). Options are
 * passed in, so they stay the same list the column itself offers.
 */
export function InitiatorStatusFilter({
  options,
  selected,
  onChange,
}: {
  options: { value: string; label: string }[];
  selected: string[];
  onChange: (v: string[]) => void;
}) {
  return (
    <div className="filter-chip">
      <UserCheck size={14} className="text-ink-subtle" strokeWidth={2} />
      <MultiSelect
        options={options}
        selected={selected}
        onChange={onChange}
        placeholder="All Initiator Status"
        className="min-w-[6.5rem] !text-[12px] !font-medium"
      />
    </div>
  );
}
