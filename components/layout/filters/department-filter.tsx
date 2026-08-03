"use client";
import * as React from "react";
import { Building2 } from "lucide-react";
import { MultiSelect } from "@/components/ui/multi-select";

export function DepartmentFilter({
  options,
  selected,
  onChange,
}: {
  /** Department names straight from the DB — whatever /admin/departments holds. */
  options: string[];
  selected: string[];
  onChange: (v: string[]) => void;
}) {
  const items = React.useMemo(
    () => options.map((d) => ({ value: d, label: d })),
    [options],
  );

  return (
    <div className="filter-chip">
      <Building2 size={16} className="text-ink-subtle" strokeWidth={2} />
      <MultiSelect
        options={items}
        selected={selected}
        onChange={onChange}
        placeholder="All Departments"
        className="min-w-[6.5rem] !text-[14px]"
        openOnHover
      />
    </div>
  );
}
