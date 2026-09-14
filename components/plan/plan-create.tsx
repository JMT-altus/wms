"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { Plus, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { NewTaskForm } from "@/components/tasks/new-task-form";
import {
  KIND_LABEL,
  PARENT_KIND,
  PLAN_KINDS,
  hasTask,
  type PlanKind,
} from "@/lib/plan/levels";
import { rememberPlanBranch, type PlanBranch } from "@/lib/plan/context";
import {
  createPlanContainer,
  createPlanNodeForTask,
} from "@/app/(project)/project-plan/actions";
import {
  ParentPickers,
  ancestorLevels,
  findPickerNode,
  seedValue,
  type PickerNode,
} from "./parent-pickers";
import { BulkUploadDialog } from "./bulk-upload-dialog";
import { PLAN_GRADIENT_BAR, PLAN_RED, PLAN_RED_SOFT } from "./theme";

/**
 * The five create boxes, plus Bulk Upload.
 *
 * ONE component used by both the register toolbar and the board's search row.
 * Two copies would drift the first time a level was added.
 *
 * There is NO PERMISSION GATE ON CREATE — creating a row is not a verdict
 * about anyone's work.
 */

/**
 * Single-key shortcuts, shown as keycaps in the corner of each box.
 *
 * T FOR ACTION, NOT A. `A` is Select-All in every list on earth and `S` is
 * Save; T (for Task, which is what an Action becomes) leaves Action on one key
 * without teaching people that a bare A does something surprising.
 *
 * NO SIXTH BOX for Sub-Sub-Action: it is a sub-division of one particular
 * sub-action, added from that row where the parent is already unambiguous.
 */
const BOXES: ReadonlyArray<{ kind: PlanKind; key: string; hint: string }> = [
  { kind: "project", key: "P", hint: "A body of work" },
  { kind: "milestone", key: "M", hint: "What it delivers" },
  { kind: "result", key: "R", hint: "What that produces" },
  { kind: "action", key: "T", hint: "The work itself" },
  { kind: "sub_action", key: "S", hint: "An action, broken down" },
];

export interface PlanCreateProps {
  tree: readonly PickerNode[];
  branch: PlanBranch;
  employees: { id: string; name: string }[];
  clients: string[];
  subjects: string[];
  departments?: { id: string; name: string }[];
  defaultInitiatorId?: string;
  isAdmin?: boolean;
  /** Roster for the bulk upload's owner matching. */
  roster: { id: string; name: string; email?: string | null }[];
  onDone?: () => void;
}

export function PlanCreate(props: PlanCreateProps) {
  const [openKind, setOpenKind] = React.useState<PlanKind | null>(null);
  const [bulkOpen, setBulkOpen] = React.useState(false);

  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // With any modifier held this is somebody's browser shortcut, not ours.
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      // While a field has focus, "Project review" in the search box would
      // otherwise open five dialogs.
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        target?.isContentEditable
      ) {
        return;
      }

      // While ANY modal is open — Radix stamps data-state="open" on its
      // content, so this catches the plan dialogs and every other one.
      if (document.querySelector('[role="dialog"][data-state="open"]')) return;

      const box = BOXES.find((b) => b.key.toLowerCase() === e.key.toLowerCase());
      if (!box) return;
      e.preventDefault();
      setOpenKind(box.kind);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {BOXES.map((box) => (
          <button
            key={box.kind}
            type="button"
            onClick={() => setOpenKind(box.kind)}
            title={box.hint}
            className="group relative inline-flex items-center gap-1.5 rounded-lg pl-3 pr-5 h-10 text-[14px] font-semibold whitespace-nowrap transition-colors"
            style={{
              background: "var(--color-surface-card)",
              border: "1px solid var(--color-hairline-strong)",
              color: "var(--color-ink)",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = PLAN_RED;
              e.currentTarget.style.background = `color-mix(in srgb, ${PLAN_RED_SOFT} 22%, var(--color-surface-card))`;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = "var(--color-hairline-strong)";
              e.currentTarget.style.background = "var(--color-surface-card)";
            }}
          >
            <Plus size={14} strokeWidth={2.8} />
            {KIND_LABEL[box.kind]}
            {/* The shortcut sits as a keycap in the corner, the way it does on
                the thing it operates — not in a tooltip nobody opens. */}
            <kbd
              aria-hidden
              className="plan-chip absolute right-1.5 top-1.5"
              style={{ fontSize: 10.5, padding: "1px 5px" }}
            >
              {box.key}
            </kbd>
          </button>
        ))}

        <button
          type="button"
          onClick={() => setBulkOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-lg px-3.5 h-10 text-[14px] font-semibold whitespace-nowrap"
          style={{
            background: "var(--color-surface-card)",
            border: "1px solid var(--color-hairline-strong)",
            color: "var(--color-ink)",
          }}
        >
          <Upload size={14} strokeWidth={2.6} />
          Bulk Upload
        </button>
      </div>

      {openKind && (
        <CreateDialog
          {...props}
          kind={openKind}
          onClose={() => setOpenKind(null)}
        />
      )}

      {bulkOpen && (
        <BulkUploadDialog
          tree={props.tree}
          branch={props.branch}
          roster={props.roster}
          onClose={() => setBulkOpen(false)}
          onDone={props.onDone}
        />
      )}
    </>
  );
}

/**
 * ONE DIALOG, TWO DESTINATIONS.
 *
 * Every button opens the SAME real task form the app-wide "+" opens — client,
 * subject, initiator, priority, due date, description, notes, tags, links,
 * attachments. One gesture should not open two different dialogs depending on
 * which button was pressed.
 *
 * Where the two paths part is ONLY the destination:
 *
 *   hasTask(kind)         `beforeSubmit` creates the plan row, then the form
 *                         creates THE task hanging off it. One record shared
 *                         by the plan, the task list and the calendar.
 *   project / milestone   a `createOverride` writes a project_nodes row and NO
 *                         task, with the Schedule block hidden.
 */
function CreateDialog({
  kind: initialKind,
  tree,
  branch,
  employees,
  clients,
  subjects,
  departments,
  defaultInitiatorId,
  isAdmin,
  onClose,
  onDone,
}: PlanCreateProps & { kind: PlanKind; onClose: () => void }) {
  const router = useRouter();
  // The level is state, not just the button that opened the dialog: picking
  // the wrong one should cost a dropdown, not a close and a re-open.
  const [kind, setKind] = React.useState<PlanKind>(initialKind);
  const [parents, setParents] = React.useState<(string | null)[]>(() =>
    seedValue(initialKind, branch),
  );

  function changeKind(next: PlanKind) {
    setKind(next);
    // A different level needs a different chain — re-seed from the branch
    // rather than carrying ids that belong to the old shape.
    setParents(seedValue(next, branch));
  }

  const levels = ancestorLevels(kind);
  const parentId = levels.length === 0 ? null : (parents[levels.length - 1] ?? null);
  const parentReady = levels.length === 0 || Boolean(parentId);
  const needs = PARENT_KIND[kind];
  const isTaskLevel = hasTask(kind);

  /**
   * Remember the row that was just written, so the NEXT dialog opens inside
   * it: create a Project and New Milestone already has it chosen; create that
   * Milestone and New Result arrives with Project AND Milestone filled.
   *
   * The chain is rebuilt from the pickers rather than from the new row alone —
   * `rememberPlanBranch` stores a PATH, and a milestone id with no project
   * above it is a hole it would refuse to keep.
   *
   * Called the moment the plan row exists. At a task level that is BEFORE the
   * task itself is written, which is deliberate: the row is real either way,
   * and a failed task should not cost the placement that produced it.
   */
  function rememberCreated(id: string, name: string) {
    const chain: PlanBranch = [];
    for (let i = 0; i < levels.length; i++) {
      const ancestorId = parents[i];
      if (!ancestorId) break;
      const node = findPickerNode(tree, ancestorId);
      if (!node) break;
      chain.push({ id: node.id, kind: node.kind, name: node.name });
    }
    chain.push({ id, kind, name });
    rememberPlanBranch(chain);
  }

  function finish() {
    onClose();
    onDone?.();
    router.refresh();
  }

  return (
    <Dialog.Root open onOpenChange={(v) => !v && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay
          className="fixed inset-0 z-[60]"
          style={{ background: "rgba(15, 23, 42, 0.45)", backdropFilter: "blur(4px)" }}
        />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-[70] -translate-x-1/2 -translate-y-1/2 rounded-section border border-hairline bg-surface-card shadow-xl overflow-hidden flex flex-col"
          style={{ width: `min(1000px, calc(100vw - 48px))`, maxHeight: "calc(100vh - 48px)" }}
        >
          <div
            className="relative px-7 py-4 shrink-0 max-md:px-4 max-md:py-3"
            style={{ borderBottom: "1px solid var(--color-hairline)" }}
          >
            <span
              aria-hidden
              className="absolute inset-x-0 top-0 h-[3px]"
              style={{ background: PLAN_GRADIENT_BAR }}
            />
            <Dialog.Title
              className="text-ink-strong font-black"
              style={{ fontSize: 23, letterSpacing: "-0.02em" }}
            >
              New {KIND_LABEL[kind]}
            </Dialog.Title>
            <Dialog.Description
              className="mt-0.5 text-[14px] font-semibold"
              style={{ color: "var(--color-ink-muted)", maxWidth: 860 }}
            >
              Pick where it sits, then name it and say what it is.{" "}
              {isTaskLevel
                ? `A ${KIND_LABEL[kind].toLowerCase()} becomes a real WMS task, with a doer, a due date and the whole record behind it.`
                : `A ${KIND_LABEL[kind].toLowerCase()} holds the plan, so it stays off the task list and the calendar.`}
            </Dialog.Description>
            <Dialog.Close
              className="absolute right-5 top-5 grid place-items-center rounded-lg size-8"
              aria-label="Close"
              style={{ color: "var(--color-ink-subtle)" }}
            >
              <X size={16} strokeWidth={2.4} />
            </Dialog.Close>
          </div>

          <div className="overflow-y-auto min-h-0 px-7 py-4 max-md:px-4">
            <div
              className="mb-4 pb-4 grid gap-3"
              style={{ borderBottom: "1px solid var(--color-hairline)" }}
            >
              <label className="block">
                <span
                  className="block mb-1.5 text-[12px] font-bold uppercase tracking-[0.09em]"
                  style={{ color: "var(--color-ink-muted)" }}
                >
                  Level
                </span>
                <select
                  value={kind}
                  onChange={(e) => changeKind(e.target.value as PlanKind)}
                  className="w-full rounded-lg px-3 h-10 text-[15px] outline-none focus:ring-1"
                  style={{
                    background: "var(--color-surface-card)",
                    border: "1px solid var(--color-hairline-strong)",
                    color: "var(--color-ink)",
                  }}
                >
                  {PLAN_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {KIND_LABEL[k]}
                    </option>
                  ))}
                </select>
              </label>

              <ParentPickers
                kind={kind}
                tree={tree}
                value={parents}
                onChange={setParents}
                branch={branch}
                layout="grid"
              />

            </div>

            {/*
              THE DESTINATION COMES FIRST, and nothing else is drawn until it
              is settled.

              A form asking for a name, a doer and a due date is answering
              "what is this?" — but a plan row's first question is "where does
              it go?", and the answer changes what the row even is. Showing
              thirty fields above an unanswered parent invites someone to fill
              them all in and only then discover the branch they meant is not
              the one selected.

              A Project has no parent, so it never sees this gate.
            */}
            {!parentReady ? (
              <div
                className="rounded-xl px-6 py-8 text-center"
                style={{
                  background: "color-mix(in srgb, var(--color-ink-strong) 4%, transparent)",
                }}
              >
                <p
                  className="text-[15px] font-bold"
                  style={{ color: "var(--color-ink-soft)" }}
                >
                  Choose the {needs ? KIND_LABEL[needs].toLowerCase() : "parent"} this
                  sits under to continue.
                </p>
              </div>
            ) : (
            <NewTaskForm
              employees={employees}
              clients={clients}
              subjects={subjects}
              departments={departments}
              isAdmin={isAdmin}
              defaults={{ initiatorId: defaultInitiatorId }}
              // Project and Milestone are dated by the work underneath them.
              hideSchedule={!isTaskLevel}
              preset={{
                noun: KIND_LABEL[kind],
                // A container has no subject of its own — its name is the
                // whole of Basics.
                hideSubject: !isTaskLevel,
                // A PROJECT is the one level with a client of its own: the
                // engagement it belongs to, which every task under it then
                // files itself against. A Milestone or Result inherits that
                // answer rather than being asked again.
                clientField: kind === "project",
                basicsHint: isTaskLevel ? "Who this is for" : "What this is",
                submitLabel: `Create ${KIND_LABEL[kind]}`,
              }}
              // Remount when the level changes, so the labels and the field set
              // follow it instead of keeping the shape they opened with.
              key={kind}
              onSuccess={finish}
              {...(isTaskLevel
                ? {
                    // Plan row first, then THE task hanging off it. The action
                    // deliberately does not sync — the form is about to create
                    // the task itself with the full field set, and letting both
                    // run is how you get two tasks for one row.
                    beforeSubmit: async (values) => {
                      if (!parentReady) {
                        return {
                          ok: false as const,
                          error: `Pick a ${needs ? KIND_LABEL[needs].toLowerCase() : "parent"} first.`,
                        };
                      }
                      const res = await createPlanNodeForTask({
                        kind,
                        parentId,
                        /*
                         * THE NAME FIELD NAMES THE ROW — not the Subject.
                         *
                         * This read `subject || title`, so an Action given a
                         * Subject was filed under it and the Action Name the
                         * form had just insisted on was thrown away: every
                         * collection action in the tree read "Collection",
                         * and `syncNodeTask` then copied that over the task
                         * title too.
                         *
                         * They answer different questions and the register
                         * has a column for each — Subject is the KIND of work,
                         * the name is THIS piece of it. Subject survives only
                         * as a fallback for a row that somehow arrives unnamed.
                         */
                        name: values.title.trim() || values.subject?.trim() || "",
                        description: values.description,
                        // Carried onto the ROW, not only onto the task the
                        // form is about to make. The row is what every later
                        // sync reads from, so a subject the row never learned
                        // is one the next plan-side edit would wipe off the
                        // task. The edit dialog offers the same field.
                        subject: values.subject ?? null,
                        targetDate: values.dueAt?.slice(0, 10) ?? null,
                      });
                      if (!res.ok) return { ok: false as const, error: res.error };
                      rememberCreated(res.id, values.title.trim() || values.subject?.trim() || "");
                      // The project's client, so the task lands in the list
                      // under the engagement it belongs to rather than under
                      // its own action name.
                      return {
                        ok: true as const,
                        projectNodeId: res.id,
                        clientName: res.clientName,
                      };
                    },
                  }
                : {
                    // A form that collects six fields and throws them away is
                    // worse than one that never asked — this is exactly why the
                    // intake columns exist.
                    createOverride: async (payload) => {
                      if (!parentReady) {
                        return {
                          ok: false as const,
                          error: `Pick a ${needs ? KIND_LABEL[needs].toLowerCase() : "parent"} first.`,
                        };
                      }
                      const res = await createPlanContainer({
                        kind,
                        parentId,
                        name: payload.title.trim() || payload.subject?.trim() || "",
                        description: payload.description,
                        notes: payload.notes,
                        // The client the form ASKED for, not the row's own
                        // name. It used to be `payload.title`, so every
                        // project was its own client and the task list's
                        // Client column said the project name twice.
                        clientName: payload.clientName,
                        subject: payload.subject,
                        priority: payload.priority,
                        initiatorId: payload.initiatorId,
                        tags: payload.tags,
                        links: payload.links,
                        targetDate: payload.dueAt?.slice(0, 10) ?? null,
                      });
                      if (!res.ok) {
                        toast.error(res.error);
                        return { ok: false as const, error: res.error };
                      }
                      rememberCreated(res.id, payload.title.trim() || payload.subject?.trim() || "");
                      return { ok: true as const, id: res.id };
                    },
                  })}
            />
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
