"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, ListChecks, Loader2, Plus, Trash2 } from "lucide-react";
import {
  addChecklistItem,
  deleteChecklistItem,
  toggleChecklistItem,
  type ChecklistItemRow,
} from "@/app/(app)/tasks/checklist-actions";

interface Props {
  taskId: string;
  items: ChecklistItemRow[];
  canEdit: boolean;
}

/**
 * The sub-steps inside one task.
 *
 * Ticking writes through immediately and optimistically: a checklist that waits
 * on a round-trip before the box fills in feels broken, and the only cost of
 * being wrong is one re-render when the refresh lands.
 *
 * The counter in the header is the point of the whole panel — "3/7" answers
 * "how far in is this?" without reading a single line.
 */
export function TaskChecklist({ taskId, items, canEdit }: Props) {
  const router = useRouter();
  const [pending, start] = React.useTransition();
  const [draft, setDraft] = React.useState("");
  // Local overlay so a tick paints instantly; dropped the moment fresh server
  // rows arrive, so the server always wins in the end.
  //
  // Reconciled DURING RENDER against the props snapshot it was built on,
  // rather than in an effect: an effect would paint one frame of stale
  // optimistic state over the new server truth before clearing it.
  const [snapshot, setSnapshot] = React.useState(items);
  const [optimistic, setOptimistic] = React.useState<Record<string, boolean>>({});
  if (snapshot !== items) {
    setSnapshot(items);
    setOptimistic({});
  }

  const resolved = items.map((i) => ({
    ...i,
    done: optimistic[i.id] ?? i.done,
  }));
  const doneCount = resolved.filter((i) => i.done).length;

  function toggle(item: ChecklistItemRow, next: boolean) {
    setOptimistic((prev) => ({ ...prev, [item.id]: next }));
    start(async () => {
      const result = await toggleChecklistItem(taskId, item.id, next);
      if (!result.ok) {
        setOptimistic((prev) => {
          const { [item.id]: _dropped, ...rest } = prev;
          return rest;
        });
        toast.error(result.message ?? "Couldn't update that step.");
        return;
      }
      router.refresh();
    });
  }

  function add(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    start(async () => {
      const result = await addChecklistItem(taskId, text);
      if (!result.ok) {
        toast.error(result.message ?? "Couldn't add that step.");
        return;
      }
      setDraft("");
      router.refresh();
    });
  }

  function remove(item: ChecklistItemRow) {
    start(async () => {
      const result = await deleteChecklistItem(taskId, item.id);
      if (!result.ok) {
        toast.error(result.message ?? "Couldn't remove that step.");
        return;
      }
      router.refresh();
    });
  }

  return (
    <section
      className="rounded-section border border-hairline bg-surface-card px-5 py-4"
      style={{
        boxShadow:
          "0 14px 32px -20px rgba(10, 108, 255, 0.16), 0 2px 6px -2px rgba(15, 23, 42, 0.06)",
      }}
    >
      <div className="flex items-center justify-between gap-2 mb-3">
        <h2
          className="inline-flex items-center gap-2 uppercase font-bold tracking-[0.08em] text-ink-subtle"
          style={{ fontSize: 10.5 }}
        >
          <ListChecks size={13} strokeWidth={2.4} />
          Checklist
        </h2>
        {resolved.length > 0 && (
          <span
            className="tabular-nums text-ink-muted"
            style={{ fontSize: 11.5 }}
          >
            {doneCount}/{resolved.length}
          </span>
        )}
      </div>

      {resolved.length === 0 && (
        <p className="text-ink-muted mb-3" style={{ fontSize: 13 }}>
          No steps yet.
          {canEdit && " Break the work down if it helps."}
        </p>
      )}

      {resolved.length > 0 && (
        <ul className="grid gap-1 mb-3">
          {resolved.map((item) => (
            <li
              key={item.id}
              className="group flex items-start gap-2.5 rounded-chip px-2.5 py-1.5"
              style={{ background: "var(--color-surface-soft)" }}
            >
              <button
                type="button"
                disabled={!canEdit}
                aria-pressed={item.done}
                aria-label={item.done ? "Mark step not done" : "Mark step done"}
                onClick={() => toggle(item, !item.done)}
                className="mt-[2px] inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px] disabled:cursor-default"
                style={{
                  background: item.done ? "var(--color-green)" : "transparent",
                  border: item.done
                    ? "none"
                    : "1.5px solid var(--color-hairline)",
                  color: "#fff",
                }}
              >
                {item.done && <Check size={10} strokeWidth={3.2} />}
              </button>
              <span
                className="min-w-0 flex-1 text-ink-strong"
                style={{
                  fontSize: 13,
                  lineHeight: 1.5,
                  textDecoration: item.done ? "line-through" : undefined,
                  color: item.done ? "var(--color-ink-muted)" : undefined,
                }}
              >
                {item.content}
              </span>
              {canEdit && (
                <button
                  type="button"
                  onClick={() => remove(item)}
                  aria-label={`Remove step: ${item.content}`}
                  className="shrink-0 text-ink-muted opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                >
                  <Trash2 size={13} strokeWidth={2.2} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {canEdit && (
        <form onSubmit={add} className="flex items-center gap-1.5">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={500}
            placeholder="Add a step…"
            aria-label="Add a checklist step"
            className="min-w-0 flex-1 rounded-md border border-hairline bg-white px-2.5 py-1.5 text-[13px]"
          />
          <button
            type="submit"
            disabled={pending || draft.trim().length === 0}
            aria-label="Add step"
            className="inline-flex shrink-0 items-center justify-center rounded-md border border-hairline bg-surface-soft px-2.5 py-1.5 text-ink-strong disabled:opacity-40"
          >
            {pending ? (
              <Loader2 size={14} className="animate-spin" />
            ) : (
              <Plus size={14} strokeWidth={2.4} />
            )}
          </button>
        </form>
      )}
    </section>
  );
}
