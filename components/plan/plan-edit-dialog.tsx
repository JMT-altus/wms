"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { Check, Link2, Plus, Trash2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { TASK_PRIORITIES, PRIORITY_LABELS } from "@/db/enums";
import {
  KIND_LABEL,
  durationDays,
  hasSchedule,
  isExecutable,
} from "@/lib/plan/levels";
import type { PlanNode } from "@/lib/queries/plan";
import { updatePlanNode } from "@/app/(project)/project-plan/actions";
import {
  deletePlanAttachment,
  listPlanAttachments,
  uploadPlanAttachment,
  type PlanAttachment,
} from "@/app/(project)/project-plan/attachment-actions";
import { PlanRef } from "./plan-ref";
import { PLAN_RED } from "./theme";

/**
 * Edit one plan row.
 *
 * Deliberately NOT the create dialog. Creating asks where a row goes and what
 * it is across five numbered sections; editing is a short list of the things
 * that actually change afterwards — the name, who owns it, when it is due, and
 * the notes and files that accumulate around it. A row's PARENT is not here on
 * purpose: moving a branch is a different act from correcting a name, and the
 * two should not share an accidental dropdown.
 */

interface Props {
  node: PlanNode;
  /** The short ref, shown in the header so the row is unmistakable. */
  refLabel: string;
  employees: { id: string; name: string }[];
  onClose: () => void;
  onDone: () => void;
}

export function PlanEditDialog({ node, refLabel, employees, onClose, onDone }: Props) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();

  // An executable row takes its priority and its notes FROM ITS TASK — the
  // action refuses them here, so the fields are not offered either.
  const executable = isExecutable(node.kind);

  const [name, setName] = React.useState(node.name);
  const [description, setDescription] = React.useState(node.description ?? "");
  // Result and the action levels are the rows that reach the task list, and
  // Subject is one of the three columns that places them there — see the
  // three-column note in `syncNodeTask`.
  // Subject belongs to the rows that describe WORK — Result and the three
  // action levels. `hasSchedule` is that exact set (everything but Project and
  // Milestone); it is not `hasTask` any more, because a Result stopped
  // carrying a task of its own and still has a subject worth naming.
  const titled = hasSchedule(node.kind);
  const [subject, setSubject] = React.useState(node.subject ?? "");

  // A PROJECT carries the client the whole branch is for — every task under it
  // files itself against this name. Only the project is asked: a milestone or
  // a result inherits the answer rather than being able to contradict it.
  const isProject = node.kind === "project";
  const [clientName, setClientName] = React.useState(node.clientName ?? "");
  const [ownerId, setOwnerId] = React.useState(node.ownerId ?? "");
  const [initiatorId, setInitiatorId] = React.useState(node.initiatorId ?? "");
  const [targetDate, setTargetDate] = React.useState(node.targetDate ?? "");
  const [priority, setPriority] = React.useState(node.priority ?? "");
  const [notes, setNotes] = React.useState(node.notes ?? "");
  const [links, setLinks] = React.useState<string[]>(node.links ?? []);
  const [linkDraft, setLinkDraft] = React.useState<string | null>(null);

  // Result and the three action levels carry a start and an end of their own;
  // Project and Milestone are dated BY THE WORK UNDERNEATH THEM, so they are
  // not asked. Same predicate the register and the create dialog use.
  const scheduled = hasSchedule(node.kind);
  const [startDate, setStartDate] = React.useState(node.startsAt?.slice(0, 10) ?? "");
  const [endDate, setEndDate] = React.useState(node.endsAt?.slice(0, 10) ?? "");

  // Derived, never stored — see `durationDays`. Both ends inclusive, so a row
  // that starts and finishes on the same day is 1 day and not 0.
  const days = durationDays(startDate || null, endDate || null);

  function save() {
    if (name.trim() === "") {
      toast.error("A name is required.");
      return;
    }
    // Caught here as well as on the server: an inverted range is a typo the
    // person is still looking at, and the box is the place to say so.
    if (scheduled && days != null && days < 1) {
      toast.error("The end date can't be before the start date.");
      return;
    }
    startTransition(async () => {
      const res = await updatePlanNode({
        id: node.id,
        name,
        description,
        ownerId: ownerId || null,
        initiatorId: initiatorId || null,
        targetDate: targetDate || null,
        links,
        ...(titled ? { subject: subject.trim() || null } : {}),
        ...(isProject ? { clientName: clientName.trim() || null } : {}),
        ...(executable ? {} : { priority: priority || null, notes }),
        // A plain `YYYY-MM-DD` becomes LOCAL midnight before it is sent —
        // `new Date("2026-06-12")` is UTC midnight, which comes back as the
        // 11th anywhere west of the storage zone.
        ...(scheduled
          ? {
              startsAt: startDate ? localIso(startDate) : null,
              endsAt: endDate ? localIso(endDate) : null,
            }
          : {}),
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      onDone();
      router.refresh();
    });
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
          style={{ width: `min(900px, calc(100vw - 24px))`, maxHeight: "calc(100vh - 48px)" }}
        >
          <div className="relative flex items-center gap-2.5 px-6 pt-5 pb-3 shrink-0">
            <PlanRef tone="red">{refLabel}</PlanRef>
            <Dialog.Title
              className="font-black uppercase tracking-[0.09em]"
              style={{ fontSize: 14, color: "var(--color-ink-strong)" }}
            >
              Edit {KIND_LABEL[node.kind]}
            </Dialog.Title>
            {/* Named for screen readers rather than left undefined — Radix
                warns on a dialog with no description, and "what is this box"
                is a fair question for something that opens over the page. */}
            <Dialog.Description className="sr-only">
              Change this {KIND_LABEL[node.kind].toLowerCase()}&apos;s name,
              client, subject, initiator, doer, target date, schedule, notes,
              links and attachments.
            </Dialog.Description>
            <Dialog.Close
              className="ml-auto grid place-items-center rounded-lg size-8"
              aria-label="Close"
              style={{ color: "var(--color-ink-subtle)" }}
            >
              <X size={17} strokeWidth={2.2} />
            </Dialog.Close>
          </div>

          <div className="overflow-y-auto min-h-0 px-6 pb-5">
            <div
              className="rounded-xl p-5 grid gap-4"
              style={{ border: "1px solid var(--color-hairline-strong)" }}
            >
              <Row label={KIND_LABEL[node.kind]}>
                <input
                  autoComplete="off"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="plan-edit-input plan-edit-input--name"
                  // Red only when it is actually wrong. A permanently red
                  // outline reads as an error on a field that is perfectly
                  // fine, and leaves nothing louder to say when it is not.
                  style={name.trim() === "" ? { borderColor: "#DC2626" } : undefined}
                />
              </Row>

              {isProject && (
                <Row label="Client name">
                  <input
                    autoComplete="off"
                    value={clientName}
                    onChange={(e) => setClientName(e.target.value)}
                    placeholder="Who this project is for — optional"
                    maxLength={240}
                    className="plan-edit-input"
                  />
                </Row>
              )}

              {titled && (
                <Row label="Subject">
                  <input
                    autoComplete="off"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder="What kind of work — optional"
                    maxLength={120}
                    className="plan-edit-input"
                  />
                </Row>
              )}

              <Row label="Description">
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  placeholder="What this covers — optional"
                  className="plan-edit-input resize-y"
                />
              </Row>

              {/* Initiator and Doer, side by side. The two read as one
                  thought — who asked, who is doing it — exactly as a task
                  states them.

                  "Doer" is this node's `ownerId`: `seedTask` sets the task's
                  doerId from it, so that is what the field has always meant,
                  whatever the column is called. Initiator is the node's own
                  `initiatorId`, which the create flow already collected but
                  no screen could show back until now. */}
              <div className="grid grid-cols-2 gap-4 max-md:grid-cols-1">
                <Row label="Initiator">
                  <select
                    value={initiatorId}
                    onChange={(e) => setInitiatorId(e.target.value)}
                    className="plan-edit-input"
                  >
                    <option value="">Unassigned</option>
                    {employees.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name}
                      </option>
                    ))}
                  </select>
                </Row>
                <Row label="Doer">
                  <select
                    value={ownerId}
                    onChange={(e) => setOwnerId(e.target.value)}
                    className="plan-edit-input"
                  >
                    <option value="">Unassigned</option>
                    {employees.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name}
                      </option>
                    ))}
                  </select>
                </Row>
              </div>

              <div className="grid grid-cols-2 gap-4 max-md:grid-cols-1">
                <Row label="Target date">
                  <input
                    type="date"
                    value={targetDate}
                    onChange={(e) => setTargetDate(e.target.value)}
                    className="plan-edit-input"
                  />
                </Row>
              </div>

              {!executable && (
                <>
                  <Row label="Priority">
                    <select
                      value={priority}
                      onChange={(e) => setPriority(e.target.value)}
                      className="plan-edit-input"
                    >
                      <option value="">None</option>
                      {TASK_PRIORITIES.map((p) => (
                        <option key={p} value={p}>
                          {PRIORITY_LABELS[p]}
                        </option>
                      ))}
                    </select>
                  </Row>

                  <Row label="Initiator notes">
                    <textarea
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      rows={3}
                      placeholder="Notes only the team sees — optional"
                      className="plan-edit-input resize-y"
                    />
                  </Row>
                </>
              )}

              {executable && (
                <p className="text-[13px]" style={{ color: "var(--color-ink-subtle)" }}>
                  Priority, status and notes live on this row&apos;s task, not here —
                  one record, one answer.
                </p>
              )}

              <Row label="Links">
                <div className="grid gap-1.5">
                  {links.map((url, i) => (
                    <div key={`${url}-${i}`} className="flex items-center gap-2 group">
                      <Link2 size={13} strokeWidth={2.4} style={{ color: PLAN_RED }} />
                      <a
                        href={url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-1 min-w-0 truncate text-[14px] hover:underline"
                        style={{ color: PLAN_RED }}
                      >
                        {url}
                      </a>
                      <button
                        type="button"
                        onClick={() => setLinks(links.filter((_, j) => j !== i))}
                        aria-label={`Remove ${url}`}
                        className="opacity-0 group-hover:opacity-100 transition-opacity"
                        style={{ color: "var(--color-ink-subtle)" }}
                      >
                        <Trash2 size={13} strokeWidth={2.4} />
                      </button>
                    </div>
                  ))}

                  {linkDraft === null ? (
                    <button
                      type="button"
                      onClick={() => setLinkDraft("")}
                      className="inline-flex w-fit items-center gap-1.5 rounded-lg px-3 h-9 text-[14px] font-semibold"
                      style={{
                        color: "var(--color-ink)",
                        border: "1px dashed var(--color-hairline-strong)",
                      }}
                    >
                      <Plus size={13} strokeWidth={2.8} />
                      Add a link
                    </button>
                  ) : (
                    <div className="flex items-center gap-2">
                      <input
                        autoFocus
                        autoComplete="off"
                        value={linkDraft}
                        onChange={(e) => setLinkDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Escape") setLinkDraft(null);
                          if (e.key === "Enter") {
                            e.preventDefault();
                            commitLink();
                          }
                        }}
                        placeholder="https://…"
                        className="plan-edit-input"
                      />
                      <button
                        type="button"
                        onClick={commitLink}
                        aria-label="Add link"
                        className="shrink-0 grid place-items-center rounded-lg size-9 text-white"
                        style={{ background: PLAN_RED }}
                      >
                        <Plus size={15} strokeWidth={2.8} />
                      </button>
                    </div>
                  )}
                </div>
              </Row>

              <Row label="Attachments">
                <Attachments nodeId={node.id} />
              </Row>
            </div>

            {/* The schedule, in a band of its own.

                Deliberately outside the box above: the fields above describe
                WHAT this row is, these describe WHEN it runs, and running the
                two together buried the dates in the middle of a long form.
                Duration is READ-ONLY on purpose — a stored day count starts
                disagreeing with its own two dates the moment either moves. */}
            {scheduled && (
              <div
                className="mt-4 rounded-xl p-5 grid grid-cols-3 gap-4 items-start max-md:grid-cols-1"
                style={{ border: "1px solid var(--color-hairline-strong)" }}
              >
                <Row label="Start date">
                  <input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="plan-edit-input"
                  />
                </Row>
                <Row label="End date">
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="plan-edit-input"
                    style={
                      days != null && days < 1 ? { borderColor: "#DC2626" } : undefined
                    }
                  />
                </Row>
                <Row label="Duration (days)">
                  <span
                    className="flex items-center h-10 tabular-nums font-bold"
                    style={{
                      fontSize: 16,
                      color:
                        days == null
                          ? "var(--color-ink-subtle)"
                          : "var(--color-ink-strong)",
                    }}
                  >
                    {days == null ? "—" : days}
                  </span>
                </Row>
              </div>
            )}
          </div>

          <div className="flex items-center justify-end gap-2.5 px-6 py-4 shrink-0">
            <Dialog.Close
              className="rounded-lg px-4 h-10 text-[14.5px] font-semibold"
              style={{
                color: "var(--color-ink)",
                border: "1px solid var(--color-hairline-strong)",
              }}
            >
              Cancel
            </Dialog.Close>
            <button
              type="button"
              onClick={save}
              disabled={pending}
              className="inline-flex items-center gap-1.5 rounded-lg px-5 h-10 text-[14.5px] font-bold text-white disabled:opacity-50"
              style={{ background: PLAN_RED }}
            >
              <Check size={15} strokeWidth={3} />
              {pending ? "Saving…" : "Save"}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );

  /** `YYYY-MM-DD` at LOCAL midnight, as an ISO instant — the same conversion
   *  the hierarchy table's inline date cells make. */
  function localIso(ymd: string): string {
    return new Date(`${ymd}T00:00:00`).toISOString();
  }

  function commitLink() {
    const url = (linkDraft ?? "").trim();
    if (url === "") {
      setLinkDraft(null);
      return;
    }
    // The server validates this too — an href the register renders must never
    // carry `javascript:`.
    if (!/^https?:\/\//i.test(url)) {
      toast.error("A link has to start with http:// or https://");
      return;
    }
    setLinks([...links, url]);
    setLinkDraft(null);
  }
}

/** The files on this row — fetched when the dialog opens, not with the table. */
function Attachments({ nodeId }: { nodeId: string }) {
  const [files, setFiles] = React.useState<PlanAttachment[] | null>(null);
  const [pending, startTransition] = React.useTransition();
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    let live = true;
    void listPlanAttachments(nodeId).then((res) => {
      if (live) setFiles(res.ok ? res.files : []);
    });
    return () => {
      live = false;
    };
  }, [nodeId]);

  function upload(list: FileList) {
    startTransition(async () => {
      for (const file of Array.from(list)) {
        const form = new FormData();
        form.set("nodeId", nodeId);
        form.set("file", file);
        const res = await uploadPlanAttachment(form);
        if (!res.ok) toast.error(res.error);
      }
      const fresh = await listPlanAttachments(nodeId);
      if (fresh.ok) setFiles(fresh.files);
    });
  }

  function remove(id: string) {
    startTransition(async () => {
      const res = await deletePlanAttachment(id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setFiles((prev) => prev?.filter((f) => f.id !== id) ?? null);
    });
  }

  return (
    <div className="grid gap-2">
      {files === null ? (
        <p className="text-[14px]" style={{ color: "var(--color-ink-subtle)" }}>
          Loading…
        </p>
      ) : files.length === 0 ? (
        <p className="text-[14px]" style={{ color: "var(--color-ink-soft)" }}>
          Nothing attached yet.
        </p>
      ) : (
        files.map((f) => (
          <div key={f.id} className="flex items-center gap-2 group">
            {f.url ? (
              <a
                href={f.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 min-w-0 truncate text-[14px] hover:underline"
                style={{ color: PLAN_RED }}
              >
                {f.fileName}
              </a>
            ) : (
              <span
                className="flex-1 min-w-0 truncate text-[14px]"
                style={{ color: "var(--color-ink-subtle)" }}
              >
                {f.fileName}
              </span>
            )}
            <button
              type="button"
              onClick={() => remove(f.id)}
              disabled={pending}
              aria-label={`Remove ${f.fileName}`}
              className="opacity-0 group-hover:opacity-100 transition-opacity"
              style={{ color: "var(--color-ink-subtle)" }}
            >
              <Trash2 size={13} strokeWidth={2.4} />
            </button>
          </div>
        ))
      )}

      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) upload(e.target.files);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={pending}
        className="inline-flex items-center justify-center gap-1.5 rounded-lg h-10 text-[14.5px] font-semibold disabled:opacity-50"
        style={{
          color: "var(--color-ink)",
          border: "1px solid var(--color-hairline-strong)",
        }}
      >
        <Upload size={14} strokeWidth={2.4} />
        {pending ? "Working…" : "Add files"}
      </button>
      <p className="text-center text-[12.5px]" style={{ color: "var(--color-ink-subtle)" }}>
        Pick several at once · up to 20 MB each
      </p>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span
        className="block mb-1.5 text-[12px] font-bold uppercase tracking-[0.09em]"
        style={{ color: "var(--color-ink-muted)" }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}
