"use client";

import * as React from "react";
import { Lock, Globe, Users2, Check } from "lucide-react";
import { MultiSelect } from "@/components/ui/multi-select";
import {
  VISIBILITY_HINT,
  VISIBILITY_LABEL,
  type AudienceEntry,
  type Visibility,
} from "@/lib/access/visibility";

export interface VisibilityValue {
  visibility: Visibility;
  audience: AudienceEntry[];
}

interface Props {
  value: VisibilityValue;
  onChange: (next: VisibilityValue) => void;
  departments: { id: string; name: string }[];
  people: { id: string; name: string }[];
  /** Hide "Specific people" where there's no room to configure it (Quick Dump). */
  allowRestricted?: boolean;
  disabled?: boolean;
}

const ICONS: Record<Visibility, typeof Lock> = {
  private: Lock,
  internal: Globe,
  restricted: Users2,
};

/**
 * Who can see this task / project.
 *
 * Three mutually exclusive levels rather than a pile of checkboxes, because
 * the question people actually ask is "is this mine, everyone's, or a specific
 * group's" — the audience only becomes relevant once the third is chosen.
 */
export function VisibilityPicker({
  value,
  onChange,
  departments,
  people,
  allowRestricted = true,
  disabled,
}: Props) {
  // Everyone first — it is the default for new tasks, so the pre-selected card
  // sits where the eye lands rather than second. Narrowing (Personal, then
  // Specific people) reads left to right as progressively tighter.
  //
  // Display order only: the `VISIBILITIES` enum keeps its own order, which the
  // DB column and every stored value depend on.
  const options: Visibility[] = allowRestricted
    ? ["internal", "private", "restricted"]
    : ["internal", "private"];

  const selectedDepartments = value.audience
    .filter((a) => a.kind === "department" && a.refId)
    .map((a) => a.refId!);
  const selectedPeople = value.audience
    .filter((a) => a.kind === "employee" && a.refId)
    .map((a) => a.refId!);
  const includesManagement = value.audience.some((a) => a.kind === "management");

  function setAudience(next: {
    departments?: string[];
    people?: string[];
    management?: boolean;
  }) {
    const departmentIds = next.departments ?? selectedDepartments;
    const peopleIds = next.people ?? selectedPeople;
    const management = next.management ?? includesManagement;
    const audience: AudienceEntry[] = [
      ...departmentIds.map((id) => ({ kind: "department" as const, refId: id })),
      ...peopleIds.map((id) => ({ kind: "employee" as const, refId: id })),
      ...(management ? [{ kind: "management" as const, refId: null }] : []),
    ];
    onChange({ ...value, audience });
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
        {options.map((level) => {
          const Icon = ICONS[level];
          const active = value.visibility === level;
          return (
            <button
              key={level}
              type="button"
              disabled={disabled}
              aria-pressed={active}
              onClick={() =>
                // Dropping out of `restricted` clears the audience: leaving
                // stale rows behind would silently re-share the task if it were
                // ever switched back.
                onChange({
                  visibility: level,
                  audience: level === "restricted" ? value.audience : [],
                })
              }
              className="relative rounded-xl px-3 py-3 text-left transition-all disabled:opacity-60"
              style={
                active
                  ? {
                      background: "rgba(10,108,255,0.07)",
                      border: "1.5px solid rgba(10,108,255,0.55)",
                      boxShadow: "0 10px 24px -14px rgba(10,108,255,0.5)",
                    }
                  : {
                      background: "var(--color-surface-card)",
                      border: "1.5px solid var(--color-hairline)",
                    }
              }
            >
              <span className="flex items-center gap-2">
                <Icon
                  size={15}
                  strokeWidth={2.3}
                  style={{ color: active ? "#0A6CFF" : "var(--color-ink-subtle)" }}
                />
                <span
                  className="text-[14px] font-bold"
                  style={{ color: active ? "#0A47B3" : "var(--color-ink-strong)" }}
                >
                  {VISIBILITY_LABEL[level]}
                </span>
                {active && (
                  <Check size={14} strokeWidth={3} style={{ color: "#0A6CFF", marginLeft: "auto" }} />
                )}
              </span>
              <span
                className="mt-1 block text-[12px]"
                style={{ color: "var(--color-ink-subtle)", lineHeight: 1.4 }}
              >
                {VISIBILITY_HINT[level]}
              </span>
            </button>
          );
        })}
      </div>

      {value.visibility === "restricted" && (
        <div
          className="rounded-xl p-3 space-y-2.5"
          style={{
            background: "var(--color-surface-soft)",
            border: "1px solid var(--color-hairline)",
          }}
        >
          <label className="flex items-center gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={includesManagement}
              disabled={disabled}
              onChange={(e) => setAudience({ management: e.target.checked })}
              className="size-4 accent-[#0A6CFF]"
            />
            <span className="text-[14px] font-semibold text-ink-strong">
              Anyone in management
            </span>
            <span className="text-[12px] text-ink-subtle">
              designations marked as management
            </span>
          </label>

          <div className="filter-chip !w-full">
            <MultiSelect
              options={departments.map((d) => ({ value: d.id, label: d.name }))}
              selected={selectedDepartments}
              onChange={(next) => setAudience({ departments: next })}
              placeholder="Departments…"
              className="!w-full !text-[14px]"
            />
          </div>

          <div className="filter-chip !w-full">
            <MultiSelect
              options={people.map((p) => ({ value: p.id, label: p.name }))}
              selected={selectedPeople}
              onChange={(next) => setAudience({ people: next })}
              placeholder="Specific people…"
              className="!w-full !text-[14px]"
            />
          </div>

          {value.audience.length === 0 && (
            <p className="text-[12.5px] font-semibold" style={{ color: "#b45309" }}>
              Pick at least one — otherwise only you and the assignee will see this.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
