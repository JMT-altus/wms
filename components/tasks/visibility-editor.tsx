"use client";

import * as React from "react";
import { toast } from "sonner";
import { Globe, Lock, Pencil, Users2 } from "lucide-react";
import { VisibilityPicker, type VisibilityValue } from "./visibility-picker";
import { VISIBILITY_LABEL, type AudienceEntry, type Visibility } from "@/lib/access/visibility";
import { setTaskVisibility } from "@/app/(app)/tasks/actions";

const ICONS: Record<Visibility, typeof Lock> = {
  private: Lock,
  internal: Globe,
  restricted: Users2,
};

/**
 * Change who can see a task, after it has been created.
 *
 * The server action for this (`setTaskVisibility`) already existed, complete
 * with its own permission rule and audit trail — it simply had no caller. This
 * is that caller.
 *
 * Read-only for anyone who isn't on the task: the action rejects them anyway,
 * and offering a control that always fails is worse than showing the answer.
 */
export function VisibilityEditor({
  taskId,
  visibility,
  audience,
  departments,
  people,
  canEdit,
  isAdmin,
}: {
  taskId: string;
  visibility: Visibility;
  audience: AudienceEntry[];
  departments: { id: string; name: string }[];
  people: { id: string; name: string }[];
  canEdit: boolean;
  /** "Specific people" is admin-only; the action rejects it for anyone else. */
  isAdmin: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [value, setValue] = React.useState<VisibilityValue>({ visibility, audience });
  const [pending, start] = React.useTransition();

  // The task can change under us (someone else edits, revalidate re-renders).
  // Re-sync when it does, or the editor would keep showing a stale answer.
  const signature = `${visibility}|${audience.map((a) => `${a.kind}:${a.refId ?? ""}`).sort().join(",")}`;
  const [lastSignature, setLastSignature] = React.useState(signature);
  if (signature !== lastSignature) {
    setLastSignature(signature);
    setValue({ visibility, audience });
  }

  const Icon = ICONS[visibility];

  function save() {
    start(async () => {
      try {
        const res = await setTaskVisibility(taskId, {
          visibility: value.visibility,
          audience: value.audience,
        });
        if (res.ok) {
          toast.success("Visibility updated.");
          setOpen(false);
        } else {
          toast.error(res.error);
        }
      } catch {
        toast.error("Couldn't reach the server. Try again in a moment.");
      }
    });
  }

  /**
   * Flip between Personal and Everyone in one click.
   *
   * The full picker could already do this, but it sat two clicks behind a
   * muted "Change" link and had never once been used. Switching a task
   * between the whole team and just its participants is the common case, so
   * it gets a control of its own; the picker stays for "Specific people".
   *
   * Any audience rows are dropped either way — neither target level uses
   * them, and leaving them behind is how a stale grant survives a re-scope.
   */
  function quickSet(next: Visibility) {
    start(async () => {
      // A server action that REJECTS inside a transition is re-thrown by React
      // and caught by the (app) error boundary, which replaces the whole page
      // with "That didn't go through". The action is guarded now, but this is
      // the last line: a network drop between here and the server rejects on
      // the client, where only this catch can turn it into a toast.
      try {
        const res = await setTaskVisibility(taskId, { visibility: next, audience: [] });
        if (res.ok) {
          setValue({ visibility: next, audience: [] });
          toast.success(
            next === "private"
              ? "Now a personal task — only the people on it can see it."
              : "Now a public task — everyone signed in can see it.",
          );
        } else {
          toast.error(res.error);
        }
      } catch {
        toast.error("Couldn't reach the server. Try again in a moment.");
      }
    });
  }

  const audienceSummary =
    visibility === "restricted" && audience.length > 0
      ? `${audience.length} ${audience.length === 1 ? "group" : "groups"}`
      : null;

  return (
    <section
      className="rounded-section border border-hairline bg-surface-card px-5 py-4"
      style={{ boxShadow: "0 14px 32px -20px rgba(10, 108, 255, 0.16), 0 2px 6px -2px rgba(15, 23, 42, 0.06)" }}
    >
      <div className="flex items-center justify-between gap-2">
        <h2
          className="uppercase font-bold tracking-[0.08em] text-ink-subtle"
          style={{ fontSize: 10.5 }}
        >
          Who can see this
        </h2>
        {canEdit && !open && (
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="inline-flex items-center gap-1.5 text-ink-muted hover:text-ink-strong transition-colors"
            style={{ fontSize: 12 }}
          >
            <Pencil size={12} strokeWidth={2.4} />
            Change
          </button>
        )}
      </div>

      {!open && (
        <div className="mt-2.5 flex items-center gap-2">
          <Icon size={15} strokeWidth={2.3} className="shrink-0 text-ink-muted" />
          <span className="font-bold text-ink-strong" style={{ fontSize: 13.5 }}>
            {VISIBILITY_LABEL[visibility]}
          </span>
          {audienceSummary && (
            <span className="text-ink-subtle" style={{ fontSize: 12 }}>
              · {audienceSummary}
            </span>
          )}
          {canEdit && (
            // Offers the opposite of whatever it is now, so the card always
            // carries a way out in one click — including back to Everyone.
            <button
              type="button"
              onClick={() => quickSet(visibility === "private" ? "internal" : "private")}
              disabled={pending}
              title={
                visibility === "private"
                  ? "Every signed-in member of the team will be able to see this task"
                  : "Only the people on this task will be able to see it"
              }
              className="ml-auto inline-flex items-center gap-1.5 rounded-pill px-2.5 h-7 font-semibold text-ink-soft bg-surface-card hover:text-ink-strong disabled:opacity-50 whitespace-nowrap"
              style={{ fontSize: 12, border: "1px solid var(--color-hairline-strong)" }}
            >
              {visibility === "private" ? (
                <Globe size={12} strokeWidth={2.4} />
              ) : (
                <Lock size={12} strokeWidth={2.4} />
              )}
              {pending
                ? "Saving…"
                : visibility === "private"
                  ? "Make public"
                  : "Make personal"}
            </button>
          )}
        </div>
      )}

      {open && (
        <div className="mt-3">
          <VisibilityPicker
            value={value}
            onChange={setValue}
            departments={departments}
            people={people}
            disabled={pending}
            // Non-admins keep whatever audience is already set — they just
            // can't pick "Specific people" themselves. Shown when the task is
            // already restricted so the card doesn't vanish mid-edit.
            allowRestricted={isAdmin || visibility === "restricted"}
          />
          <div className="mt-3 flex items-center gap-1.5">
            <button
              type="button"
              onClick={save}
              disabled={pending}
              className="rounded-chip px-3 h-8 text-[12.5px] font-bold text-white disabled:opacity-60"
              style={{ background: "linear-gradient(135deg, #0A6CFF, #0047B3)" }}
            >
              {pending ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={() => {
                setValue({ visibility, audience });
                setOpen(false);
              }}
              className="rounded-chip px-3 h-8 text-[12.5px] font-semibold text-ink-soft border border-hairline"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
