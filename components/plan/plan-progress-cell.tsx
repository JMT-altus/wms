"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  CHILD_KIND,
  KIND_LABEL,
  KIND_LABEL_PLURAL,
  isExecutable,
  type PlanKind,
} from "@/lib/plan/levels";
import {
  childCompletion,
  formatCompleted,
  formatCompletion,
  nodeFraction,
  projectFraction,
  toPercent,
  type ProgressNode,
} from "@/lib/plan/progress";
import { setPlanNodeProgress } from "@/app/(project)/project-plan/actions";
import { PLAN_RED, TABULAR } from "./theme";

/**
 * A row's progress, computed from the subtree it is handed.
 *
 *   Project    the headline: 40% over 3.5/10
 *   Milestone  its own percent, EDITABLE by the owner or an admin — that
 *              input is what makes the 3.5 above
 *   Result     derived from the actions beneath it, read-only: there is
 *              nothing to judge, the actions either are done or are not
 *   Executable NO PERCENT AT ALL — an action's progress IS its status, and a
 *              second number beside the chip could only disagree with it
 */

interface Props {
  node: ProgressNode & { id: string; kind: PlanKind };
  /** Owner or admin — recording a partial is a ruling, not a report. */
  canRecord: boolean;
  /**
   * Suppress the "0 out of 3 milestones" line on a surface that already has a
   * rollup column, or a one-line cell overflows into the very column that was
   * already saying it.
   */
  showChildren?: boolean;
  onDone?: () => void;
}

export function PlanProgressCell({ node, canRecord, showChildren = true, onDone }: Props) {
  // An action's progress IS its status. Nothing to draw.
  if (isExecutable(node.kind)) return null;

  const fraction = node.kind === "project" ? projectFraction(node) : nodeFraction(node);
  const childKind = CHILD_KIND[node.kind];
  const rollup = childCompletion(node, childKind);
  const editable = node.kind === "milestone" && canRecord;

  return (
    <div className="min-w-0 leading-[1.3]">
      <div className="flex items-baseline gap-1.5">
        <span
          className="font-bold"
          style={{ ...TABULAR, fontSize: 13.5, color: "var(--color-ink-strong)" }}
        >
          {toPercent(fraction)}%
        </span>
        {rollup.total > 0 && (
          <span
            style={{ ...TABULAR, fontSize: 12, color: "var(--color-ink-subtle)" }}
          >
            {formatCompletion(rollup)}
          </span>
        )}
        {editable && <RecordedInput node={node} onDone={onDone} />}
      </div>

      {showChildren && childKind && rollup.total > 0 && (
        <p className="truncate" style={{ fontSize: 11.5, color: "var(--color-ink-subtle)" }}>
          {formatCompleted(rollup.completed)} out of {rollup.total}{" "}
          {(rollup.total === 1 ? KIND_LABEL[childKind] : KIND_LABEL_PLURAL[childKind]).toLowerCase()}
        </p>
      )}
    </div>
  );
}

/**
 * The recorded partial.
 *
 * Clearing it is a first-class action: blank the box and progress goes back to
 * being derived, which is the honest default.
 *
 * Exported because Project Views records the same number against the same
 * rows, and a second box that wrote the same column through its own code
 * could disagree with this one about what "clear it" means.
 *
 * It asks for the id and the stored percent, not a whole `ProgressNode`: a
 * caller that has a row in front of it should not have to build a subtree to
 * let someone type into a box.
 */
export function RecordedInput({
  node,
  onDone,
}: {
  node: { id: string; progressPercent?: number | null };
  onDone?: () => void;
}) {
  const stored = node.progressPercent;
  const [value, setValue] = React.useState(stored == null ? "" : String(stored));
  const [pending, startTransition] = React.useTransition();

  // Adopt a fresh server value during render rather than in an effect, so the
  // box never shows a stale number for a frame after a revalidate.
  const [lastStored, setLastStored] = React.useState(stored);
  if (stored !== lastStored) {
    setLastStored(stored);
    setValue(stored == null ? "" : String(stored));
  }

  function commit() {
    const raw = value.trim();
    const next = raw === "" ? null : Number(raw);
    if (next !== null && (!Number.isFinite(next) || next < 0 || next > 100)) {
      toast.error("Enter a whole percent between 0 and 100, or clear the box.");
      setValue(stored == null ? "" : String(stored));
      return;
    }
    const rounded = next === null ? null : Math.round(next);
    if (rounded === stored) return;
    startTransition(async () => {
      const res = await setPlanNodeProgress({ id: node.id, percent: rounded });
      if (!res.ok) {
        toast.error(res.error);
        setValue(stored == null ? "" : String(stored));
        return;
      }
      onDone?.();
    });
  }

  return (
    <span className="inline-flex items-center gap-0.5">
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            setValue(stored == null ? "" : String(stored));
            e.currentTarget.blur();
          }
        }}
        disabled={pending}
        inputMode="numeric"
        placeholder="—"
        aria-label="Recorded progress percent"
        title="Record a percentage, or clear the box to go back to the derived number"
        className="rounded-md text-center outline-none focus:ring-1"
        style={{
          ...TABULAR,
          width: 34,
          height: 19,
          fontSize: 12,
          color: stored == null ? "var(--color-ink-subtle)" : PLAN_RED,
          background: "transparent",
          border: "1px dashed var(--color-hairline-strong)",
        }}
      />
      <span style={{ fontSize: 11, color: "var(--color-ink-subtle)" }}>%</span>
    </span>
  );
}
