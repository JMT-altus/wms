"use client";

import * as React from "react";
import { History } from "lucide-react";
import {
  KIND_LABEL,
  PARENT_KIND,
  levelStyleProps,
  type PlanKind,
} from "@/lib/plan/levels";
import type { PlanBranch } from "@/lib/plan/context";
import { seedAncestors } from "@/lib/plan/context";
import { PLAN_RED, PLAN_RED_SOFT } from "./theme";

/**
 * "Where does this go?"
 *
 * A CASCADING chain: a Sub-Action asks Project → Milestone → Result → Action;
 * a Milestone asks only for a Project. Each select is fed from the one above,
 * so an impossible pairing cannot be assembled at all and the server's
 * parent-kind check never has to reject anything.
 *
 * ONE copy, shared by the create dialog and the bulk upload — two would drift
 * the first time a level was added.
 */

export interface PickerNode {
  id: string;
  name: string;
  kind: PlanKind;
  children: PickerNode[];
}

interface Props {
  /** The kind being created. Its ancestors are what get asked for. */
  kind: PlanKind;
  tree: readonly PickerNode[];
  /** Current selection, outermost first. `null` at a level not yet chosen. */
  value: (string | null)[];
  onChange: (next: (string | null)[]) => void;
  /** The last-accessed branch — created or opened — for the seeded chips. */
  branch?: PlanBranch;
  disabled?: boolean;
  /**
   * "grid" pairs the selects two-across with uppercase labels — the create
   * dialog, where the destination is the first thing read. "stack" keeps them
   * in one column for the bulk dialog's narrow sidebar.
   */
  layout?: "grid" | "stack";
}

/** The ancestor levels a row of this kind needs, outermost first. */
export function ancestorLevels(kind: PlanKind): PlanKind[] {
  const out: PlanKind[] = [];
  let parent = PARENT_KIND[kind];
  while (parent) {
    out.unshift(parent);
    parent = PARENT_KIND[parent];
  }
  return out;
}

/** The seeded starting value for a fresh dialog. */
export function seedValue(kind: PlanKind, branch: PlanBranch): (string | null)[] {
  const levels = ancestorLevels(kind);
  const seeded = seedAncestors(kind, branch);
  return levels.map((_, i) => seeded[i]?.id ?? null);
}

export function ParentPickers({
  kind,
  tree,
  value,
  onChange,
  branch = [],
  disabled,
  layout = "stack",
}: Props) {
  const levels = ancestorLevels(kind);
  if (levels.length === 0) return null;

  // Each level's options come from the one above, so an impossible pairing is
  // not offered in the first place.
  const optionsAt = (index: number): PickerNode[] => {
    if (index === 0) return tree.filter((n) => n.kind === levels[0]);
    const parentId = value[index - 1];
    if (!parentId) return [];
    const parent = findPickerNode(tree, parentId);
    return (parent?.children ?? []).filter((c) => c.kind === levels[index]);
  };

  function pick(index: number, id: string | null) {
    // Choosing an ancestor invalidates every level below it — the old
    // milestone is not under the new project.
    const next = value.map((v, i) => (i < index ? v : i === index ? id : null));
    onChange(next);
  }

  return (
    <div className={layout === "grid" ? "grid gap-4 grid-cols-2 max-md:grid-cols-1" : "grid gap-2.5"}>
      {levels.map((level, i) => {
        const options = optionsAt(i);
        const seeded = branch.find((b) => b.kind === level);
        const isSeeded = Boolean(seeded && seeded.id === value[i]);
        // The deepest level is the one this row actually hangs off, so it
        // carries the accent — the levels above it are context.
        const isDeepest = i === levels.length - 1;
        return (
          <label key={level} className="block">
            <span
              className={
                layout === "grid"
                  ? "flex items-center gap-1.5 mb-1.5 text-[12px] font-bold uppercase tracking-[0.09em]"
                  : "flex items-center gap-1.5 mb-1 text-[12.5px] font-semibold"
              }
              style={{ color: "var(--color-ink-muted)" }}
            >
              {KIND_LABEL[level]}
              {isSeeded && (
                // A default, not a lock — the select stays editable.
                <span
                  className="inline-flex items-center gap-1 rounded-pill px-1.5 py-[1px] text-[10.5px] font-bold"
                  style={{
                    color: PLAN_RED,
                    background: `color-mix(in srgb, ${PLAN_RED_SOFT} 55%, transparent)`,
                  }}
                  title="Seeded from the branch you last created or opened"
                >
                  <History size={9} strokeWidth={2.8} />
                  last used
                </span>
              )}
            </span>
            <select
              value={value[i] ?? ""}
              onChange={(e) => pick(i, e.target.value || null)}
              disabled={disabled || (i > 0 && !value[i - 1])}
              className={
                layout === "grid"
                  ? "w-full rounded-lg px-3 h-10 text-[15px] outline-none focus:ring-1 disabled:opacity-50"
                  : "w-full rounded-lg px-2.5 h-9 text-[14px] outline-none focus:ring-1 disabled:opacity-50"
              }
              style={{
                background: "var(--color-surface-card)",
                border: `1px solid ${
                  layout === "grid" && isDeepest && value[i]
                    ? PLAN_RED
                    : "var(--color-hairline-strong)"
                }`,
                color: "var(--color-ink)",
                ...levelStyleProps(level),
                // The level typography is about hierarchy in a TABLE; a select
                // still has to be readable, so only the weight carries over.
                fontSize: layout === "grid" ? 15 : 14,
                fontStyle: "normal",
                textTransform: "none",
              }}
            >
              <option value="">
                {i > 0 && !value[i - 1]
                  ? `Choose a ${KIND_LABEL[levels[i - 1]!].toLowerCase()} first`
                  : options.length === 0
                    ? `No ${KIND_LABEL[level].toLowerCase()} here yet`
                    : `Choose a ${KIND_LABEL[level].toLowerCase()}…`}
              </option>
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
        );
      })}
    </div>
  );
}

export function findPickerNode(
  nodes: readonly PickerNode[],
  id: string,
): PickerNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    const hit = findPickerNode(node.children, id);
    if (hit) return hit;
  }
  return null;
}
