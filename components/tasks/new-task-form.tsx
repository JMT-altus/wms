"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { ImagePlus, Link2, Plus, X, FileImage, Check } from "lucide-react";
import {
  TASK_PRIORITIES,
  PRIORITY_LABELS,
  type TaskPriority,
  type TaskRecurrence,
} from "@/db/enums";
import { createTask, completePooledTask } from "@/app/(app)/tasks/actions";
import { EmployeeAvatar } from "@/components/ui/employee-avatar";
import { ScheduleSection, type ScheduleValue } from "./schedule-section";
import {
  KIND_LABEL,
  UNCLASSIFIED_MILESTONE,
  UNCLASSIFIED_RESULT,
  type PlanKind,
} from "@/lib/plan/levels";
import type { ProjectNodeOption } from "@/lib/queries/projects";
import { resolvePlanPlacement } from "@/app/(project)/project-plan/actions";
import { VisibilityPicker, type VisibilityValue } from "./visibility-picker";
import { ClientSelect } from "./client-select";
import { SubjectSelect } from "./subject-select";
import { Select } from "@/components/ui/select";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { DictateButton } from "@/components/ui/dictate-button";

type EmployeeOption = { id: string; name: string };

interface Props {
  employees: EmployeeOption[];
  /** Client roster for the "Client Name" picker, alphabetical. */
  clients: string[];
  /** Subject roster for the "Subject" picker, alphabetical. */
  subjects: string[];
  /**
   * Plan rows for the optional Project link, every level in one flat list.
   *
   * The picker cascades over `kind` and `parentId` rather than showing the
   * path labels as one long dropdown — see the Project field below.
   */
  projectNodes?: ProjectNodeOption[];
  /** Audience options for the visibility picker. */
  departments?: { id: string; name: string }[];
  /** "Specific people" is admin-only; the create action rejects it otherwise. */
  isAdmin?: boolean;
  /** Called after a successful create. Default: navigate to /tasks/[id]. */
  onSuccess?: (taskId: string) => void;
  /**
   * Run before the task is created, and fold what it returns into the payload.
   *
   * Added for the Project Plan module: a plan row at a task level creates the
   * `project_nodes` row FIRST and then hangs THE task off it, so the plan, the
   * task list and the calendar share one record. Returning `false` aborts —
   * the plan row failed, and a task with no row to belong to would be worse
   * than nothing.
   *
   * Absent, the form behaves exactly as it always has.
   */
  beforeSubmit?: (values: {
    title: string;
    subject: string | null;
    description: string | null;
    dueAt: string | null;
  }) => Promise<
    | { ok: true; projectNodeId?: string; clientName?: string | null }
    | { ok: false; error: string }
  >;
  /**
   * Create something OTHER than a task with the same collected fields.
   *
   * The Project Plan module's container path (Project / Milestone) writes a
   * plan row and no task. One gesture should not open two different dialogs
   * depending on which button was pressed, so the same real form serves both
   * and only the destination differs.
   */
  createOverride?: (payload: {
    title: string;
    /** The client this row is FOR, when the preset asked for one — a separate
     *  question from the row's name. Null when the field wasn't offered. */
    clientName: string | null;
    subject: string | null;
    description: string | null;
    notes: string | null;
    priority: TaskPriority;
    initiatorId: string;
    dueAt: string | null;
    tags: string[] | null;
    links: string[] | null;
  }) => Promise<{ ok: true; id: string } | { ok: false; error: string }>;
  /** Hide the Schedule block — Project and Milestone are dated by the work
   *  underneath them, so clock times on one would be metadata nothing honours. */
  hideSchedule?: boolean;
  /**
   * Present this form as one Project Plan level.
   *
   * Presentation only — the fields, the validation and the submit path are
   * unchanged. A plan row is a Project or a Milestone rather than a task for
   * a client, so it needs its own noun on the labels, a plain name box in
   * place of the client picker, and the module's red on the button.
   *
   * Absent, every one of these falls back to what the app-wide "+" has always
   * rendered.
   */
  preset?: {
    /** "Project", "Milestone", "Result", … — the noun on every label. */
    noun: string;
    /** Containers have no subject; the name is the whole of Basics. */
    hideSubject?: boolean;
    /**
     * Also ask WHO THIS IS FOR, beside the row's name.
     *
     * A Project is the one level with a client of its own — the engagement it
     * belongs to — and the whole branch under it inherits that answer on the
     * task list. Before this the row's name was quietly written into
     * `client_name` as well, so every project was its own client and the Client
     * column said the same thing twice.
     */
    clientField?: boolean;
    basicsHint?: string;
    submitLabel?: string;
  };
  /** When set, the form runs in "complete a pool task" mode: it UPDATES this
   *  task (fills in details + optionally assigns) instead of creating a new one. */
  completeTaskId?: string;
  /** Called after a successful complete (instead of onSuccess). */
  onCompleted?: () => void;
  /** Optional defaults for the form (used by the canonical route, the
   *  Duplicate action, and pool-task completion — all prefill from a task). */
  defaults?: {
    doerId?: string;
    initiatorId?: string;
    priority?: TaskPriority;
    title?: string;
    /** Editable task title (complete mode) — seeded from the quick-dump text. */
    taskTitle?: string;
    subject?: string;
    description?: string;
    notes?: string;
    projectNodeId?: string;
    /** Prefill the Due Date (YYYY-MM-DD). Defaults to tomorrow when absent. */
    dueAt?: string;
  };
}

const DEFAULT_PRIORITY: TaskPriority = "not_imp_not_urgent";
const MEDIA_SLOT_COUNT = 4;

// react-hook-form + zod own the validated core fields. Complex/auxiliary
// widgets (tags, schedule, media, links) stay in local state and are folded
// into the payload at submit — same shape createTask has always received.
const NewTaskSchema = z.object({
  title: z.string().trim().min(1, "Client name is required"),
  taskTitle: z.string(), // used only in complete mode; ignored on create
  initiatorId: z.string().min(1, "Initiator is required"),
  doerIds: z.array(z.string()).min(1, "Pick at least one Doer"),
  priority: z.enum(TASK_PRIORITIES),
  dueAt: z.string().min(1, "Due date is required"),
  subject: z.string().trim().min(1, "Subject is required"),
  // REQUIRED. A task whose description is blank arrives on someone's list as
  // a title and a due date, and the person who wrote it is the only one who
  // knows what it means. The Project Plan already insisted on this; the task
  // list was the inconsistent one.
  description: z.string().trim().min(1, "Say what the task is — a description is required"),
  notes: z.string(),
  projectNodeId: z.string(),
});
type NewTaskFormValues = z.infer<typeof NewTaskSchema>;

/**
 * Project Plan mode.
 *
 * The description requirement now lives on `NewTaskSchema` itself — both
 * surfaces insist on it, so this only re-words the message for a plan row,
 * which is read by people who were not in the room when it was created.
 */
const PlanTaskSchema = NewTaskSchema.extend({
  description: z.string().trim().min(1, "Say what this is — a description is required"),
});

/**
 * Project Plan CONTAINER mode — a Project or a Milestone.
 *
 * Subject is not required, because it is not asked: a container has no subject
 * of its own (`preset.hideSubject`), its name is the whole of Basics, and
 * `syncNodeTask` never writes one for it either.
 *
 * It used to run on `PlanTaskSchema`, which requires a subject — so creating a
 * Project failed validation with "Subject is required" pointing at a field
 * that is not on the form. A required field you cannot see is a dead end, not
 * a validation.
 */
const PlanContainerSchema = PlanTaskSchema.extend({
  subject: z.string().trim(),
});

// "Complete a pool task" mode — same shape, relaxed rules: only the Title
// (seeded from the quick-dump text) is required; Client, Doer, Subject, Due and
// Description can be filled in now or later. Same output type as
// NewTaskFormValues so the resolver swaps cleanly.
const CompleteTaskSchema = z.object({
  title: z.string().trim(), // Client Name — optional in complete mode
  taskTitle: z.string().trim().min(1, "Title is required"),
  initiatorId: z.string(),
  doerIds: z.array(z.string()),
  priority: z.enum(TASK_PRIORITIES),
  dueAt: z.string(),
  subject: z.string().trim(),
  description: z.string().trim(),
  notes: z.string(),
  projectNodeId: z.string(),
});

// Media slots are UI-only for now — files live in component state and
// aren't uploaded anywhere. The Links section is wired: URLs get
// appended to the `notes` payload on submit ("Links:\n- ..."), so they
// survive into the task record without needing a new column.
interface PreviewFile {
  file: File;
  url: string;
}

export function NewTaskForm({ employees, clients, subjects, projectNodes = [], departments = [], isAdmin = false, onSuccess, completeTaskId, onCompleted, defaults, beforeSubmit, createOverride, hideSchedule = false, preset }: Props) {
  // Defaults to "Everyone" — new tasks are team-visible unless someone
  // narrows them here.
  //
  // This reverses migration 0078, which made "Personal" the default so people
  // saw only their own work. That rule still governs everything already
  // created; what changed is the starting position of this one picker, on the
  // grounds that work in a shared board is normally shared. Narrowing to
  // Personal or Specific people is now the deliberate act.
  const [visibility, setVisibility] = React.useState<VisibilityValue>({
    visibility: "internal",
    audience: [],
  });
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const isComplete = Boolean(completeTaskId);

  // Default due: 1 day after the entry date.
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  const {
    register,
    control,
    handleSubmit,
    watch,
    setValue,
    getValues,
    formState: { errors },
  } = useForm<NewTaskFormValues>({
    resolver: zodResolver(
      isComplete
        ? CompleteTaskSchema
        : preset?.hideSubject
          ? PlanContainerSchema
          : preset
            ? PlanTaskSchema
            : NewTaskSchema,
    ),
    defaultValues: {
      title: defaults?.title ?? "",
      taskTitle: defaults?.taskTitle ?? "",
      initiatorId: defaults?.initiatorId ?? "",
      doerIds: defaults?.doerId ? [defaults.doerId] : [],
      priority: defaults?.priority ?? DEFAULT_PRIORITY,
      dueAt: defaults?.dueAt ?? tomorrow,
      subject: defaults?.subject ?? "",
      description: defaults?.description ?? "",
      notes: defaults?.notes ?? "",
      projectNodeId: defaults?.projectNodeId ?? "",
    },
  });

  // Auxiliary widgets — local state, folded into the payload at submit.
  const [tags, setTags] = React.useState<string[]>([]);
  /**
   * The three cascading answers to "where in the plan does this belong?".
   *
   * Held apart from the form's own `projectNodeId`: that field is the RESULT
   * the task ends up hanging off, and it is not known until submit — a blank
   * milestone or result has to be turned into a real row by the server first
   * (see `resolvePlanPlacement`). Storing the half-answers in the form value
   * would mean shipping a project id in a field that means a result id.
   */
  /** The preset's optional "who is this for" answer — see `preset.clientField`. */
  const [planClient, setPlanClient] = React.useState("");

  const [projectPick, setProjectPick] = React.useState("");
  const [milestonePick, setMilestonePick] = React.useState("");
  const [resultPick, setResultPick] = React.useState("");
  /**
   * The Action the person explicitly chose. `null` means they have not
   * touched the field — which is NOT the same as choosing "create a new one",
   * and keeping them apart is what lets the default below exist without
   * overriding a deliberate answer.
   */
  const [actionPick, setActionPick] = React.useState<string | null>(null);

  const projectChoices = React.useMemo(
    () => projectNodes.filter((n) => n.kind === "project"),
    [projectNodes],
  );
  const milestoneChoices = React.useMemo(
    () =>
      projectNodes.filter((n) => n.kind === "milestone" && n.parentId === projectPick),
    [projectNodes, projectPick],
  );
  const resultChoices = React.useMemo(
    () =>
      milestonePick
        ? projectNodes.filter((n) => n.kind === "result" && n.parentId === milestonePick)
        : [],
    [projectNodes, milestonePick],
  );
  /**
   * The Actions already under the chosen Result.
   *
   * Their presence decides what this task BECOMES: file it under one and the
   * task is a Sub-Action of it; leave it blank and the task is a new Action of
   * the Result in its own right. Either way it lands on an executable row —
   * a task pinned to a Result is work the Result's own "2 of 5" cannot see.
   */
  const actionChoices = React.useMemo(
    () =>
      resultPick
        ? projectNodes.filter((n) => n.kind === "action" && n.parentId === resultPick)
        : [],
    [projectNodes, resultPick],
  );

  /**
   * ONE existing Action is not a choice, it is the answer — default to it, so
   * the common "this result is already being worked on" case files the task
   * under that work without anyone touching the field.
   *
   * SEVERAL is a real choice and defaults to blank: picking the first of five
   * would be arbitrary, and quietly filing work under the wrong action is the
   * exact disconnection this whole chain exists to prevent.
   *
   * DERIVED, not an effect that writes state — an effect would re-render every
   * time the branch moved, and would have to be careful not to stamp on the
   * answer the person had already given.
   */
  const effectiveAction =
    actionPick ?? (actionChoices.length === 1 ? actionChoices[0]!.id : "");

  /**
   * The name of the plan row this task will BECOME.
   *
   * Required once a project is chosen, and deliberately its own field: the
   * form's `title` is the CLIENT NAME in this dialog, so naming the plan row
   * from it filed every task in the tree under the client rather than under
   * the work. A row in the Project Plan is read by people who were not in the
   * room; "Altus Corp" three levels down says nothing about what to do.
   */
  const [leafName, setLeafName] = React.useState("");

  /**
   * What this task lands as — a Sub-Action when it is filed under an existing
   * Action, otherwise a new Action of the Result. The same rule the server
   * applies in `resolvePlanPlacement`, so the label cannot promise one thing
   * and the plan show another.
   */
  const leafKind: PlanKind = effectiveAction ? "sub_action" : "action";

  /** The chosen branch, outermost first — what the brief panel reads from. */
  const planBrief = React.useMemo(
    () =>
      [
        projectChoices.find((n) => n.id === projectPick),
        milestoneChoices.find((n) => n.id === milestonePick),
        resultChoices.find((n) => n.id === resultPick),
        actionChoices.find((n) => n.id === effectiveAction),
      ].filter(
        (n): n is ProjectNodeOption => Boolean(n && n.description?.trim()),
      ),
    [
      projectChoices, projectPick, milestoneChoices, milestonePick,
      resultChoices, resultPick, actionChoices, effectiveAction,
    ],
  );

  const [tagInput, setTagInput] = React.useState("");
  const [schedule, setSchedule] = React.useState<ScheduleValue>({
    startsAt: null,
    endsAt: null,
    allDay: false,
    recurrence: null,
    recurrenceRule: null,
  });
  const [media, setMedia] = React.useState<PreviewFile[]>([]);
  const [linkInput, setLinkInput] = React.useState("");
  const [links, setLinks] = React.useState<string[]>([]);
  // Server-side error from createTask (field validation is handled by RHF/zod).
  const [error, setError] = React.useState<string | null>(null);

  const doerCount = watch("doerIds").length;
  const tagsCount = tags.length;

  // Live dictation read/write helpers for a text field.
  const fieldGetter = (name: "description" | "notes") => () => getValues(name) ?? "";
  const fieldSetter = (name: "description" | "notes") => (v: string) =>
    setValue(name, v, { shouldDirty: true });

  // Release object-URLs the moment the dialog tears down so we don't
  // leak blobs into the document for the rest of the session.
  React.useEffect(() => {
    return () => {
      media.forEach((m) => URL.revokeObjectURL(m.url));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function addFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const remaining = MEDIA_SLOT_COUNT - media.length;
    if (remaining <= 0) return;
    const next: PreviewFile[] = [];
    for (let i = 0; i < files.length && next.length < remaining; i++) {
      const f = files[i]!;
      if (!f.type.startsWith("image/")) continue;
      next.push({ file: f, url: URL.createObjectURL(f) });
    }
    setMedia((prev) => [...prev, ...next]);
  }

  function removeMedia(idx: number) {
    setMedia((prev) => {
      const target = prev[idx];
      if (target) URL.revokeObjectURL(target.url);
      return prev.filter((_, i) => i !== idx);
    });
  }

  function addLink() {
    const trimmed = linkInput.trim();
    if (!trimmed) return;
    if (links.includes(trimmed)) {
      setLinkInput("");
      return;
    }
    setLinks((prev) => [...prev, trimmed]);
    setLinkInput("");
  }

  function removeLink(idx: number) {
    setLinks((prev) => prev.filter((_, i) => i !== idx));
  }

  const submit = handleSubmit((values) => {
    setError(null);
    // The <input type="date"> gives YYYY-MM-DD; convert to ISO at noon UTC
    // so timezone wrap-arounds don't push the due into the wrong day.
    const dueIso = values.dueAt
      ? new Date(`${values.dueAt}T12:00:00.000Z`).toISOString()
      : null;

    // "Complete a pool task" mode — UPDATE the existing task instead of
    // creating one, then hand control back to the caller (closes the panel).
    if (completeTaskId) {
      startTransition(async () => {
        try {
        const res = await completePooledTask(completeTaskId, {
          title: values.taskTitle, // the editable task title
          client: values.title || null, // Client Name (separate picker)
          subject: values.subject || null,
          description: values.description || null,
          priority: values.priority,
          dueAt: dueIso,
          doerId: values.doerIds[0] ?? null,
        });
        if (!res.ok) {
          setError(res.error);
          return;
        }
        if (onCompleted) onCompleted();
        else router.push(`/tasks/${completeTaskId}` as Route);
        router.refresh();
        } catch (err) {
          console.error("[new-task] complete failed:", err);
          setError(
            err instanceof Error && err.message
              ? err.message
              : "Something went wrong saving this task. Please try again.",
          );
        }
      });
      return;
    }

    // Stamp link URLs onto the notes payload — they survive into the task
    // record so the team can click through later. Media files are UI-only.
    const linksBlock =
      links.length > 0
        ? `\n\nLinks:\n${links.map((l) => `- ${l}`).join("\n")}`
        : "";
    const composedNotes = (values.notes + linksBlock).trim() || null;

    // Commit any pending tag text the user hasn't pressed Enter on yet.
    const pendingTag = tagInput.trim();
    const finalTags =
      pendingTag && !tags.includes(pendingTag) ? [...tags, pendingTag] : tags;

    startTransition(async () => {
      /*
       * EVERY THROW HAS TO LAND SOMEWHERE.
       *
       * `pending` drives the button's "Creating…", and an async transition
       * whose body rejects never settles — so a server action that threw
       * rather than returned `{ok:false}` left the button spinning forever
       * with nothing on screen to say why. That is indistinguishable from a
       * slow network, so people wait, then submit again.
       *
       * Every handled failure below still returns early with `setError`; this
       * only catches what those cannot: a dropped connection, a rate-limit
       * throw, or a stale client calling a server action whose shape has since
       * changed on the server.
       */
      try {
      // The Project Plan container path: same collected fields, different
      // destination. No task is created at all.
      if (createOverride) {
        const res = await createOverride({
          title: values.title,
          clientName: planClient.trim() || null,
          subject: values.subject || null,
          description: values.description || null,
          notes: values.notes.trim() || null,
          priority: values.priority,
          initiatorId: values.initiatorId,
          dueAt: dueIso,
          tags: finalTags.length > 0 ? finalTags : null,
          links: links.length > 0 ? links : null,
        });
        if (!res.ok) {
          setError(res.error);
          return;
        }
        if (onSuccess) onSuccess(res.id);
        return;
      }

      // The Project Plan task path: create the plan row FIRST, then hang THE
      // task off it. Aborting here rather than creating an orphan task is the
      // point — one row, one task, never two.
      let linkedNodeId = values.projectNodeId || null;
      /**
       * The Client column for a task that belongs to a project.
       *
       * Left null, `createTasksCore` falls back to the task's TITLE — which is
       * what the standalone form means by "Client name", but is nonsense for a
       * plan task whose title is the name of an action. The project's own
       * client is the answer, and only the server knows it, so both plan paths
       * hand it back with the row they just created.
       */
      let planClientName: string | null = null;

      // The cascading picker's answer, turned into ONE result id. A blank
      // milestone or result becomes a real Unclassified row under the project
      // — the server does it, because it is a write.
      if (projectPick) {
        if (!leafName.trim()) {
          setError(
            `Give this ${KIND_LABEL[leafKind].toLowerCase()} a name — it is what the Project Plan will show.`,
          );
          return;
        }
        const placed = await resolvePlanPlacement({
          projectId: projectPick,
          milestoneId: milestonePick || null,
          resultId: resultPick || null,
          actionId: effectiveAction || null,
          // The leaf is named and described from the task it carries, so the
          // plan reads as the work rather than as a tree of placeholders.
          // Clamped to what NameSchema accepts. The row name is a label; the
          // task keeps the full title, so trimming here loses nothing.
          name: leafName.trim().slice(0, 160),
          description: values.description || null,
          subject: values.subject || null,
        });
        if (!placed.ok) {
          setError(placed.error);
          return;
        }
        linkedNodeId = placed.id;
        planClientName = placed.clientName;
      }

      if (beforeSubmit) {
        const pre = await beforeSubmit({
          title: values.title,
          subject: values.subject || null,
          description: values.description || null,
          dueAt: dueIso,
        });
        if (!pre.ok) {
          setError(pre.error);
          return;
        }
        if (pre.projectNodeId) linkedNodeId = pre.projectNodeId;
        if (pre.clientName) planClientName = pre.clientName;
      }

      const result = await createTask({
        title: values.title,
        // The project's client when this task belongs to one; otherwise the
        // form's own Client Name field, which IS `title` in this dialog.
        client: planClientName ?? values.title ?? null,
        doerIds: values.doerIds,       // multi-doer fanout — N tasks if N doers
        initiatorId: values.initiatorId,
        priority: values.priority,
        // Create mode always has a due (schema-required); fall back defensively.
        dueAt: dueIso ?? new Date(`${tomorrow}T12:00:00.000Z`).toISOString(),
        description: values.description || null,
        subject: values.subject || null,
        notes: composedNotes,
        tags: finalTags.length > 0 ? finalTags : null,
        // Tier-4 — GCal-style scheduling. All fields nullable; only ship
        // values when the user actually filled in the Schedule section.
        startsAt: schedule.startsAt ? schedule.startsAt.toISOString() : null,
        endsAt: schedule.endsAt ? schedule.endsAt.toISOString() : null,
        allDay: schedule.allDay,
        recurrence: schedule.recurrence,
        recurrenceRule: schedule.recurrenceRule,
        projectNodeId: linkedNodeId,
        visibility: visibility.visibility,
        audience: visibility.audience,
      });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // Single doer → land on the task's detail page. Multi-doer fanout →
      // land on the filtered task list (showing the freshly-minted batch).
      if (onSuccess) onSuccess(result.id);
      else if (result.ids.length === 1) {
        router.push(`/tasks/${result.id}` as Route);
      } else {
        router.push("/tasks" as Route);
      }
      } catch (err) {
        console.error("[new-task] create failed:", err);
        setError(
          err instanceof Error && err.message
            ? err.message
            : "Something went wrong creating this task. Please try again.",
        );
      }
    });
  });

  function commitTag() {
    const t = tagInput.trim();
    if (!t) return;
    if (tags.includes(t)) {
      setTagInput("");
      return;
    }
    setTags((prev) => [...prev, t]);
    setTagInput("");
  }

  function removeTag(idx: number) {
    setTags((prev) => prev.filter((_, i) => i !== idx));
  }

  return (
    <CompactContext.Provider value={Boolean(preset)}>
    <form
      onSubmit={submit}
      onKeyDown={(e) => {
        // ⌘/Ctrl + Enter submits from anywhere in the form.
        if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
          e.preventDefault();
          void submit();
        }
      }}
      className={`flex flex-col ${preset ? "plan-form" : "gap-6"}`}
      noValidate
      /*
       * No browser autofill anywhere in this form.
       *
       * Chrome keys its saved-form-data dropdown off the field id, so the
       * plan-row Name input was offering every throwaway name ever typed into
       * it — "sss", "ggg", "bbbb" — over the dialog. None of these fields are
       * ones a browser can usefully guess: a milestone name, a subject and a
       * description are new text every time, not a remembered identity.
       */
      autoComplete="off"
    >
      {/* ── 01 BASICS ─────────────────────────────────────────────────── */}
      <FormSection number="01" title="Basics" hint={preset?.basicsHint ?? "Who this is for"}>
      {/* Title — editable task title (complete mode only), seeded from the
          quick-dump text. Separate from the Client Name below. */}
      {isComplete && (
        <Field id="nt-tasktitle" label="Title" required>
          <input
            id="nt-tasktitle"
            className="nt-input"
            autoComplete="off"
            placeholder="What's the task?"
            {...register("taskTitle")}
          />
        </Field>
      )}

      {/* Client Name + Subject — one line, above the people/dates. */}
      <div
        className={`grid gap-4 max-md:grid-cols-1 max-md:gap-3 ${
          preset?.hideSubject && !preset?.clientField ? "grid-cols-1" : "grid-cols-2"
        }`}
      >
        <Field
          id="nt-title"
          label={preset ? `${preset.noun} Name` : "Client Name"}
          required={!isComplete}
        >
          <Controller
            control={control}
            name="title"
            render={({ field }) =>
              // A plan row is named, not chosen from the client roster — the
              // picker would offer a list that has nothing to do with it.
              preset ? (
                <input
                  id="nt-title"
                  className="nt-input"
                  autoComplete="off"
                  placeholder={`${preset.noun} Name…`}
                  value={field.value}
                  onChange={(e) => field.onChange(e.target.value)}
                />
              ) : (
                <ClientSelect
                  id="nt-title"
                  value={field.value}
                  onChange={field.onChange}
                  clients={clients}
                  className="nt-input"
                />
              )
            }
          />
        </Field>
        {/* WHO THIS IS FOR — asked only where a preset says to, which today
            means the Project level. Separate from the name above: "AICL WMS"
            is what the project is called and "Altus Corp" is who it is for,
            and the task list needs both. Chosen from the client roster, the
            same list an ordinary task's Client Name comes from, so the two
            cannot drift into two spellings of one client. */}
        {preset?.clientField && (
          <Field id="nt-client" label="Client Name">
            <ClientSelect
              id="nt-client"
              value={planClient}
              onChange={setPlanClient}
              clients={clients}
              className="nt-input"
            />
          </Field>
        )}
        {!preset?.hideSubject && (
        <Field id="nt-subject" label="Subject" required={!isComplete}>
          <Controller
            control={control}
            name="subject"
            render={({ field }) => (
              <SubjectSelect
                id="nt-subject"
                value={field.value}
                onChange={field.onChange}
                subjects={subjects}
                className="nt-input"
                placeholder="Select a subject…"
              />
            )}
          />
        </Field>
        )}
      </div>

      </FormSection>

      {/* ── 02 ASSIGNMENT ─────────────────────────────────────────────── */}
      <FormSection number="02" title="Assignment" hint="Owners, priority & deadline">
      {/* Metadata — two balanced rows (Initiator · Doer / Priority · Due
          Date). The old 4-across row squeezed each field to ~170px: the
          multi-doer chips grew an inner scrollbox and the date input
          clipped its own value. Two columns give every field real room;
          1-col under md. */}
      <div className="grid grid-cols-2 gap-4 max-md:grid-cols-1 max-md:gap-3">
        <Field id="nt-initiator" label="Initiator" required={!isComplete}>
          <Controller
            control={control}
            name="initiatorId"
            render={({ field }) => (
              <Select
                id="nt-initiator"
                value={field.value ?? ""}
                onValueChange={field.onChange}
                placeholder="Select an employee…"
                searchPlaceholder="Search employees…"
                searchable
                options={employees.map((emp) => ({ value: emp.id, label: emp.name }))}
              />
            )}
          />
        </Field>
        <Field
          id="nt-doer"
          label={`Doer${doerCount > 1 ? ` · ${doerCount} selected` : ""}`}
          required={!isComplete}
        >
          <Controller
            control={control}
            name="doerIds"
            render={({ field }) => (
              <DoerMultiSelect
                employees={employees}
                selected={field.value}
                onToggle={(id) =>
                  field.onChange(
                    field.value.includes(id)
                      ? field.value.filter((d) => d !== id)
                      : [...field.value, id],
                  )
                }
              />
            )}
          />
        </Field>
        <Field id="nt-priority" label="Priority">
          <Controller
            control={control}
            name="priority"
            render={({ field }) => (
              <Select
                id="nt-priority"
                value={field.value}
                onValueChange={field.onChange}
                options={TASK_PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABELS[p] }))}
              />
            )}
          />
        </Field>
        <Field id="nt-due" label="Due Date" required={!isComplete}>
          <input id="nt-due" type="date" className="nt-input" {...register("dueAt")} />
        </Field>
      </div>

      </FormSection>

      {/* ── 03 DETAILS ────────────────────────────────────────────────── */}
      <FormSection number="03" title="Details" hint="The work itself">
      {/* Task Description · Initiator Notes — full-width, stacked. */}
      <Field
        id="nt-desc"
        label={preset ? `${preset.noun} Description` : "Task Description"}
        required={!isComplete}
      >
        <div className="relative">
          <textarea
            id="nt-desc"
            rows={4}
            className="nt-input resize-y"
            style={{ fontWeight: 400, paddingRight: 52 }}
            placeholder={
              preset
                ? "What needs to happen, in detail…"
                : "What needs to happen, in detail… (or tap the mic and speak)"
            }
            {...register("description")}
          />
          <div className="absolute top-2.5 right-2.5">
            <DictateButton getValue={fieldGetter("description")} setValue={fieldSetter("description")} title="Dictate description" />
          </div>
        </div>
      </Field>

      <Field id="nt-notes" label="Initiator Notes">
        <div className="relative">
          <textarea
            id="nt-notes"
            rows={3}
            className="nt-input resize-y"
            style={{ fontWeight: 400, paddingRight: 52 }}
            placeholder="Notes only the team sees… (or tap the mic and speak)"
            {...register("notes")}
          />
          <div className="absolute top-2.5 right-2.5">
            <DictateButton getValue={fieldGetter("notes")} setValue={fieldSetter("notes")} title="Dictate notes" />
          </div>
        </div>
      </Field>

      </FormSection>

      {/* ── 04 ORGANIZE ───────────────────────────────────────────────── */}
      <FormSection
        number="04"
        title="Organize"
        hint="Optional — tags, project & schedule"
      >
      {/* Tags — free-form chips. Type a tag, hit Enter or comma to commit.
          Stored as text[] on the task; each chip is searchable later. */}
      <Field id="nt-tags" label={`Tags${tagsCount > 0 ? ` · ${tagsCount}` : ""}`}>
        <TagsInput
          id="nt-tags"
          tags={tags}
          input={tagInput}
          onInputChange={setTagInput}
          onCommit={commitTag}
          onRemove={removeTag}
        />
      </Field>

      {/* Project link — the plan's chain, asked one level at a time.
          ONE flat dropdown of every row at every level used to answer this,
          which meant scrolling a list of "Project / Milestone / Result / …"
          paths to find one line. Three narrow questions is the same choice,
          asked the way people actually hold it: which project, then which
          milestone, then which result. */}
      {projectNodes.length > 0 && (
        <>
          <Field id="nt-project" label="Project">
            <Select
              id="nt-project"
              value={projectPick}
              onValueChange={(v) => {
                setProjectPick(v);
                // Narrowing the branch invalidates what was chosen under it.
                setMilestonePick("");
                setResultPick("");
                setActionPick(null);
              }}
              options={[
                { value: "", label: "Not linked to a project" },
                ...projectChoices.map((n) => ({ value: n.id, label: n.name })),
              ]}
            />
          </Field>

          {projectPick && (
            <>
              <Field id="nt-milestone" label="Milestone">
                <Select
                  id="nt-milestone"
                  value={milestonePick}
                  onValueChange={(v) => {
                    setMilestonePick(v);
                    setResultPick("");
                    setActionPick(null);
                  }}
                  options={[
                    { value: "", label: `Leave blank — ${UNCLASSIFIED_MILESTONE}` },
                    ...milestoneChoices.map((n) => ({
                      value: n.id,
                      label: `${n.ref} · ${n.name}`,
                    })),
                  ]}
                />
              </Field>

              <Field id="nt-result" label="Result">
                <Select
                  id="nt-result"
                  value={resultPick}
                  onValueChange={(v) => {
                    setResultPick(v);
                    setActionPick(null);
                  }}
                  options={[
                    { value: "", label: `Leave blank — ${UNCLASSIFIED_RESULT}` },
                    ...resultChoices.map((n) => ({
                      value: n.id,
                      label: `${n.ref} · ${n.name}`,
                    })),
                  ]}
                />
              </Field>

              {/* The Action level — offered only once a Result is settled,
                  because what it decides is whether this task is an Action of
                  that Result or a Sub-Action of one already under it. */}
              <Field id="nt-action" label="Action">
                <Select
                  id="nt-action"
                  value={effectiveAction}
                  onValueChange={setActionPick}
                  options={[
                    {
                      value: "",
                      label:
                        actionChoices.length === 0
                          ? "A new action will be created for this task"
                          : "Leave blank — create a new action",
                    },
                    ...actionChoices.map((n) => ({
                      value: n.id,
                      label: `${n.ref} · ${n.name}`,
                    })),
                  ]}
                />
              </Field>

              {/* Say what silence will do BEFORE it does it. A task that turns
                  up under a milestone nobody remembers creating is worse than
                  one that was never linked. */}
              <p
                className="-mt-1 text-[12.5px]"
                style={{ color: "var(--color-ink-muted)" }}
              >
                {!milestonePick || !resultPick ? (
                  <>
                    Left blank, this files under{" "}
                    <strong>
                      {milestonePick
                        ? UNCLASSIFIED_RESULT
                        : `${UNCLASSIFIED_MILESTONE} / ${UNCLASSIFIED_RESULT}`}
                    </strong>{" "}
                    in this project — a real row you can rename or move work out
                    of later.{" "}
                  </>
                ) : null}
                {effectiveAction ? (
                  <>
                    This task becomes a <strong>Sub-Action</strong> of the action
                    you picked.
                  </>
                ) : (
                  <>
                    This task becomes a new <strong>Action</strong> under that
                    result.
                  </>
                )}
              </p>

              {/* The brief for the branch being filed into.
                  Sits WITH the pickers rather than beside the description box:
                  it is the thing being chosen, and a description written
                  without it is written blind. Only levels that actually say
                  something appear — an empty panel is noise. */}
              {planBrief.length > 0 && (
                <div
                  className="rounded-lg px-4 py-3 grid gap-2.5"
                  style={{
                    background: "var(--color-surface-soft)",
                    border: "1px solid var(--color-hairline)",
                  }}
                >
                  {planBrief.map((node) => (
                    <div key={node.id}>
                      <span
                        className="block mb-0.5 text-[11px] font-bold uppercase tracking-[0.1em]"
                        style={{ color: "var(--color-ink-subtle)" }}
                      >
                        {KIND_LABEL[node.kind]} · {node.name}
                      </span>
                      <p
                        className="text-[13px] whitespace-pre-wrap"
                        style={{ color: "var(--color-ink-muted)" }}
                      >
                        {node.description}
                      </p>
                    </div>
                  ))}
                </div>
              )}

              {/* The name the Project Plan will show for this task.
                  REQUIRED, and below the branch rather than above it, because
                  what it names — an Action or a Sub-Action — is decided by the
                  Action field directly above. Naming it first would be naming
                  something whose level is not settled yet. */}
              <Field id="nt-leaf-name" label={`${KIND_LABEL[leafKind]} Name`} required>
                <input
                  id="nt-leaf-name"
                  className="nt-input"
                  autoComplete="off"
                  maxLength={160}
                  value={leafName}
                  onChange={(e) => setLeafName(e.target.value)}
                  placeholder={`What this ${KIND_LABEL[leafKind].toLowerCase()} is called…`}
                />
              </Field>
              <p
                className="-mt-1 text-[12.5px]"
                style={{ color: "var(--color-ink-muted)" }}
              >
                This is the row the Project Plan shows under{" "}
                <strong>
                  {resultChoices.find((r) => r.id === resultPick)?.name ??
                    UNCLASSIFIED_RESULT}
                </strong>
                . The task keeps its own title in the task list.
              </p>
            </>
          )}
        </>
      )}

      {/* Who can see it. Sits with the other assignment decisions rather than
          buried in an "advanced" drawer — it's a choice you make WHILE
          deciding who the task is for, not an afterthought. */}
      {!completeTaskId && (
        <Field id="nt-visibility" label="Visible to">
          <VisibilityPicker
            value={visibility}
            onChange={setVisibility}
            departments={departments}
            people={employees.map((e) => ({ id: e.id, name: e.name }))}
            allowRestricted={isAdmin}
          />
        </Field>
      )}

      {/* Schedule — GCal-style start/end + recurrence. Internal metadata
          only; not synced to any actual calendar API. */}
      {!hideSchedule && <ScheduleSection value={schedule} onChange={setSchedule} />}

      </FormSection>

      {/* ── 05 ATTACHMENTS ────────────────────────────────────────────── */}
      <FormSection
        number="05"
        title="Attachments"
        hint="Optional — media & reference links"
      >
        {/* Media + Links — side by side on desktop */}
        <div className="grid grid-cols-2 gap-5 max-md:grid-cols-1">
          <MediaSection
            media={media}
            onAdd={addFiles}
            onRemove={removeMedia}
          />
          <LinksSection
            links={links}
            input={linkInput}
            onInputChange={setLinkInput}
            onAdd={addLink}
            onRemove={removeLink}
          />
        </div>
      </FormSection>

      {(error || Object.values(errors)[0]?.message) && (
        <p
          className="font-semibold"
          style={{ fontSize: 14, color: "var(--color-red-deep)" }}
        >
          {error ?? (Object.values(errors)[0]?.message as string)}
        </p>
      )}

      <div
        className="flex items-center justify-end gap-3 pt-2"
        style={{ borderTop: "1px solid var(--color-hairline)" }}
      >
        {/* Ctrl/⌘ + Enter already submits from anywhere in the form; saying so
            is the only way anyone finds out. */}
        <p
          className="mr-auto flex items-center gap-1.5 text-[12px]"
          style={{ color: "var(--color-ink-subtle)" }}
        >
          <kbd className="rounded border border-hairline px-1.5 py-0.5 text-[10px] font-bold">
            Ctrl
          </kbd>
          +
          <kbd className="rounded border border-hairline px-1.5 py-0.5 text-[10px] font-bold">
            ↵
          </kbd>
          creates from anywhere in the form
        </p>
        <button
          type="submit"
          disabled={pending}
          className="text-cta text-white px-8 py-4 rounded-chip transition-transform disabled:opacity-50"
          style={{
            background: preset
              ? "linear-gradient(135deg, #E10600, #A80400)"
              : "linear-gradient(135deg, rgb(2, 99, 204), rgb(0, 66, 138))",
            boxShadow: preset
              ? "0 6px 16px rgba(225, 6, 0, 0.34)"
              : "0 6px 16px rgba(10, 108, 255, 0.34)",
            fontWeight: 800,
            fontSize: 18,
            letterSpacing: "0.005em",
          }}
          onMouseEnter={(e) => {
            if (pending) return;
            e.currentTarget.style.transform = "translateY(-1px)";
            e.currentTarget.style.boxShadow =
              preset
                ? "0 10px 24px rgba(225, 6, 0, 0.45)"
                : "0 10px 24px rgba(10, 108, 255, 0.45)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = "translateY(0)";
            e.currentTarget.style.boxShadow =
              "0 6px 16px rgba(10, 108, 255, 0.34)";
          }}
        >
          {pending
            ? isComplete
              ? "Saving…"
              : "Creating…"
            : isComplete
              ? "Save details"
              : (preset?.submitLabel ?? "Create Task")}
        </button>
      </div>
    </form>
    </CompactContext.Provider>
  );
}

/**
 * One numbered band of the create form.
 *
 * The form is five sections, and they are NUMBERED on purpose: a task is a
 * commitment between two people, and the order the questions are asked in is
 * the order the decisions get made — who it is for, who owns it and by when,
 * what the work actually is, then the two optional groups. The number, the
 * uppercase micro-label and the one-line hint together tell someone landing
 * mid-form where they are without reading a single field label.
 *
 * Purely presentational: it wraps existing fields and owns no state, so the
 * validated fields keep going through the form library exactly as before.
 */
function FormSection({
  number,
  title,
  hint,
  children,
}: {
  number: string;
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  const compact = React.useContext(CompactContext);
  return (
    <section className={`flex flex-col ${compact ? "gap-3" : "gap-4"}`}>
      <div
        className={`flex items-baseline gap-2.5 border-b border-hairline ${
          compact ? "pb-1.5" : "pb-2"
        }`}
      >
        <span
          className="tabular-nums rounded-md px-1.5 py-1 text-[11px] font-black leading-none text-altus-red"
          style={{ background: "color-mix(in srgb, var(--color-altus-red) 10%, transparent)" }}
          aria-hidden
        >
          {number}
        </span>
        <h3 className="text-[12px] font-black uppercase leading-none tracking-[0.14em] text-ink-strong">
          {title}
        </h3>
        <span className="ml-auto truncate text-[12px] font-medium leading-none text-ink-subtle">
          {hint}
        </span>
      </div>
      <div className={`flex flex-col ${compact ? "gap-3.5" : "gap-5"}`}>{children}</div>
    </section>
  );
}

/**
 * Multi-select dropdown for Doer. Each pick adds a chip; submitting the
 * form creates one task per selected doer (the action fans out server-side).
 *
 * Styled to read the same as the .nt-input single-line inputs above it so
 * the row stays visually balanced.
 */
function DoerMultiSelect({
  employees,
  selected,
  onToggle,
}: {
  employees: EmployeeOption[];
  selected: string[];
  onToggle: (id: string) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [hi, setHi] = React.useState(0); // highlighted option index
  const ref = React.useRef<HTMLDivElement>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const listRef = React.useRef<HTMLUListElement>(null);

  const byId = React.useMemo(() => {
    const m = new Map<string, string>();
    for (const e of employees) m.set(e.id, e.name);
    return m;
  }, [employees]);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return employees;
    return employees.filter((e) => e.name.toLowerCase().includes(q));
  }, [employees, query]);

  // Keep the highlight in range, and scroll it into view as it moves.
  React.useEffect(() => {
    setHi((h) => Math.min(h, Math.max(0, filtered.length - 1)));
  }, [filtered.length]);
  React.useEffect(() => {
    if (!open) return;
    (listRef.current?.children[hi] as HTMLElement | undefined)?.scrollIntoView({
      block: "nearest",
    });
  }, [hi, open]);

  // Toggle a doer, clear the query, and keep the input focused so you can
  // type the next name — fully keyboard-driven, no trackpad needed.
  function commit(id: string | undefined, refocus = true) {
    if (!id) return;
    onToggle(id);
    setQuery("");
    setHi(0);
    // On Tab we deliberately skip the refocus so the browser's default
    // Tab can carry focus on to the next field (Priority).
    if (refocus) inputRef.current?.focus();
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setHi((h) => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHi((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      // Enter picks the highlighted match (or the only match) and keeps the
      // field focused so you can add another doer. Never submits the form.
      e.preventDefault();
      if (filtered.length > 0) commit(filtered[hi]?.id ?? filtered[0]?.id);
    } else if (e.key === "Escape") {
      setOpen(false);
    } else if (e.key === "Tab") {
      // Tab also confirms the highlighted match (so typing "Mis" + Tab picks
      // "Mishtie Kanani"), then lets focus move on to the next field. Only
      // when something is typed AND there's a match — an empty field just
      // tabs through.
      if (query.trim() !== "" && filtered.length > 0) {
        commit(filtered[hi]?.id ?? filtered[0]?.id, /* refocus */ false);
      }
      setOpen(false);
    } else if (e.key === "Backspace" && query === "" && selected.length > 0) {
      onToggle(selected[selected.length - 1]!); // remove the last picked doer
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      {/* Combobox control: Tab lands in the input, type to filter, ↑/↓ + Enter
          to pick, Tab to move on. Chips + input share the field; the dropdown is
          a portalled Popover so it floats above the form, not over the fields. */}
      <PopoverAnchor asChild>
        <div
          ref={ref}
          // Grows with its chips — a capped, scrolling field reads as broken
          // (stray scrollbars) and hides who's already selected.
          className="nt-input flex items-center flex-wrap gap-1.5 cursor-text"
          style={{ minHeight: 46, height: "auto" }}
          onMouseDown={(e) => {
          const t = e.target as HTMLElement;
          if (t.closest("[data-chip-remove]") || t === inputRef.current) return;
          e.preventDefault();
          inputRef.current?.focus();
          setOpen(true);
        }}
      >
        {selected.map((id) => {
          const name = byId.get(id) ?? "Unknown";
          return (
            <span
              key={id}
              className="inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1"
              style={{
                background: "var(--vp-cyan-tint)",
                color: "rgb(var(--vp-cyan-deep))",
                fontSize: 14,
                fontWeight: 700,
              }}
            >
              <EmployeeAvatar name={name} size="sm" />
              {name}
              <button
                type="button"
                data-chip-remove
                tabIndex={-1}
                aria-label={`Remove ${name}`}
                onClick={() => onToggle(id)}
                className="inline-flex items-center justify-center"
                style={{ width: 18, height: 18, borderRadius: 999 }}
              >
                <X size={12} strokeWidth={2.6} />
              </button>
            </span>
          );
        })}
        <input
          ref={inputRef}
          type="text"
          value={query}
          role="combobox"
          aria-expanded={open}
          aria-autocomplete="list"
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setHi(0);
          }}
          onKeyDown={onKeyDown}
          placeholder={selected.length === 0 ? "Type a name…" : ""}
          className="flex-1 min-w-[90px] bg-transparent outline-none"
          style={{ fontSize: 15, fontWeight: 600, color: "var(--color-ink-strong)", padding: "2px 0" }}
        />
        <span
          aria-hidden
          style={{
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 160ms ease",
            color: "var(--color-ink-muted)",
          }}
        >
          ▾
        </span>
        </div>
      </PopoverAnchor>

      <PopoverContent
        align="start"
        sideOffset={6}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onInteractOutside={(e) => {
          if (ref.current?.contains(e.target as Node)) e.preventDefault();
        }}
        className="p-0 w-[var(--radix-popover-trigger-width)] min-w-[14rem] overflow-hidden"
      >
          <ul
            ref={listRef}
            role="listbox"
            aria-multiselectable
            className="max-h-[240px] overflow-y-auto py-1"
          >
          {employees.length === 0 ? (
            <li
              className="px-4 py-3 font-semibold"
              style={{ fontSize: 14, color: "var(--color-ink-muted)" }}
            >
              No employees available.
            </li>
          ) : filtered.length === 0 ? (
            <li
              className="px-4 py-3 font-semibold"
              style={{ fontSize: 14, color: "var(--color-ink-muted)" }}
            >
              No match for “{query}”.
            </li>
          ) : (
            filtered.map((emp, i) => {
              const isSel = selected.includes(emp.id);
              const isHi = i === hi;
              return (
                <li
                  key={emp.id}
                  role="option"
                  aria-selected={isSel}
                  // preventDefault on mousedown keeps the input focused so a
                  // click doesn't blur-close the menu before the toggle lands.
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setHi(i)}
                  onClick={() => commit(emp.id)}
                  className="flex items-center gap-3 px-3.5 py-2.5 cursor-pointer transition-colors"
                  style={{
                    background: isSel
                      ? "var(--vp-cyan-tint)"
                      : isHi
                        ? "var(--color-surface-soft)"
                        : "transparent",
                  }}
                >
                  <EmployeeAvatar name={emp.name} size="sm" />
                  <span
                    className="flex-1 font-semibold"
                    style={{
                      fontSize: 15,
                      color: "var(--color-ink-strong)",
                    }}
                  >
                    {emp.name}
                  </span>
                  {isSel && (
                    <Check
                      size={18}
                      strokeWidth={2.6}
                      style={{ color: "rgb(var(--vp-cyan-deep))" }}
                    />
                  )}
                </li>
              );
            })
          )}
          </ul>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Tag-chip input. Press Enter or comma to commit the pending text into a
 * chip. Backspace on an empty input removes the last chip. Chips stored
 * client-side in `tags: string[]` and shipped to the action.
 */
function TagsInput({
  id,
  tags,
  input,
  onInputChange,
  onCommit,
  onRemove,
}: {
  id: string;
  tags: string[];
  input: string;
  onInputChange: (v: string) => void;
  onCommit: () => void;
  onRemove: (idx: number) => void;
}) {
  return (
    <div
      className="nt-input flex flex-wrap items-center gap-1.5"
      style={{ padding: "10px 12px", minHeight: 56 }}
      onClick={() => document.getElementById(id)?.focus()}
    >
      {tags.map((t, i) => (
        <span
          key={`${t}-${i}`}
          className="inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1"
          style={{
            background: "var(--vp-cyan-tint)",
            color: "rgb(var(--vp-cyan-deep))",
            fontSize: 14,
            fontWeight: 700,
          }}
        >
          {t}
          <span
            role="button"
            aria-label={`Remove tag ${t}`}
            onClick={(e) => {
              e.stopPropagation();
              onRemove(i);
            }}
            className="inline-flex items-center justify-center"
            style={{ width: 18, height: 18, borderRadius: 999 }}
          >
            <X size={12} strokeWidth={2.6} />
          </span>
        </span>
      ))}
      <input
        id={id}
        type="text"
        value={input}
        onChange={(e) => onInputChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            onCommit();
          } else if (e.key === "Backspace" && input === "" && tags.length > 0) {
            onRemove(tags.length - 1);
          }
        }}
        placeholder={
          tags.length === 0
            ? "Type a tag and press Enter or comma to add…"
            : "Add another tag…"
        }
        className="flex-1 min-w-[180px] bg-transparent outline-none"
        style={{
          fontSize: 15,
          fontWeight: 600,
          color: "var(--color-ink-strong)",
          border: "none",
          padding: 0,
        }}
      />
    </div>
  );
}

/**
 * Whether this form is rendering in its compact (Project Plan) size.
 *
 * A context because `Field` and `FormSection` are used a dozen times each, and
 * threading a `compact` prop through every one of them would be noise at every
 * call site for a decision the form makes once.
 */
const CompactContext = React.createContext(false);

function Field({
  id,
  label,
  required,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  const compact = React.useContext(CompactContext);
  return (
    <div className={`flex flex-col ${compact ? "gap-1.5" : "gap-2.5"}`}>
      <label
        htmlFor={id}
        className="font-bold"
        style={{
          fontFamily: "var(--font-sans), system-ui, sans-serif",
          fontSize: compact ? 13.5 : 15,
          letterSpacing: "-0.005em",
          color: "var(--color-ink-strong)",
        }}
      >
        {label}
        {required && (
          <span style={{ color: "rgb(0, 66, 138)" }}> *</span>
        )}
      </label>
      {children}
    </div>
  );
}

function MediaSection({
  media,
  onAdd,
  onRemove,
}: {
  media: PreviewFile[];
  onAdd: (files: FileList | null) => void;
  onRemove: (idx: number) => void;
}) {
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = React.useState(false);

  return (
    <div
      className="rounded-section p-5"
      style={{
        border: "1px solid var(--color-hairline)",
        background: "var(--color-surface-soft)",
      }}
    >
      <div className="flex items-center justify-between mb-4">
        <span
          className="inline-flex items-center gap-2.5 uppercase font-black tracking-[0.10em]"
          style={{
            fontFamily: "var(--font-display), system-ui, sans-serif",
            fontSize: 17,
            color: "rgb(var(--vp-cyan-deep))",
          }}
        >
          <ImagePlus size={22} strokeWidth={2.2} />
          Attach media
        </span>
        <span
          className="tabular-nums font-black"
          style={{
            fontSize: 14,
            color: "var(--color-ink-muted)",
          }}
        >
          {media.length} / {MEDIA_SLOT_COUNT}
        </span>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          onAdd(e.target.files);
          // Reset so re-selecting the same file still fires onChange.
          if (e.target) e.target.value = "";
        }}
      />

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          onAdd(e.dataTransfer.files);
        }}
        className="grid grid-cols-4 gap-2.5 max-sm:grid-cols-2"
        style={{
          padding: 4,
          borderRadius: 12,
          background: dragOver ? "var(--vp-cyan-tint)" : "transparent",
          transition: "background 180ms ease",
        }}
      >
        {Array.from({ length: MEDIA_SLOT_COUNT }).map((_, i) => {
          const item = media[i];
          return item ? (
            <FilledSlot
              key={`f-${item.url}`}
              url={item.url}
              name={item.file.name}
              onRemove={() => onRemove(i)}
            />
          ) : (
            <EmptySlot
              key={`e-${i}`}
              onClick={() => fileInputRef.current?.click()}
            />
          );
        })}
      </div>

      <p
        className="mt-4 font-semibold"
        style={{
          fontSize: 14,
          color: "var(--color-ink-muted)",
          lineHeight: 1.5,
        }}
      >
        Drop images anywhere in the grid, or click a slot to pick. PNG / JPG up
        to {MEDIA_SLOT_COUNT} files.
      </p>
    </div>
  );
}

function EmptySlot({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Add image"
      className="relative aspect-square flex flex-col items-center justify-center gap-1.5 rounded-chip transition-all"
      style={{
        background:
          "linear-gradient(135deg, #f1f5f9 0%, #e2e8f0 100%)",
        border: "1.5px dashed #cbd5e1",
        color: "#94a3b8",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background =
          "linear-gradient(135deg, var(--vp-cyan-tint) 0%, #e0f2fe 100%)";
        e.currentTarget.style.borderColor = "rgb(var(--vp-cyan))";
        e.currentTarget.style.color = "rgb(var(--vp-cyan-deep))";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background =
          "linear-gradient(135deg, #f1f5f9 0%, #e2e8f0 100%)";
        e.currentTarget.style.borderColor = "#cbd5e1";
        e.currentTarget.style.color = "#94a3b8";
      }}
    >
      <FileImage size={34} strokeWidth={1.8} />
      <span
        className="uppercase font-extrabold tracking-[0.10em]"
        style={{ fontSize: 12 }}
      >
        Add image
      </span>
    </button>
  );
}

function FilledSlot({
  url,
  name,
  onRemove,
}: {
  url: string;
  name: string;
  onRemove: () => void;
}) {
  return (
    <div
      className="relative aspect-square rounded-chip overflow-hidden group"
      style={{
        border: "1.5px solid rgb(var(--vp-cyan))",
        background: "#ffffff",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt={name}
        className="absolute inset-0 w-full h-full object-cover"
      />
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${name}`}
        className="absolute top-1.5 right-1.5 inline-flex items-center justify-center rounded-full transition-all"
        style={{
          width: 26,
          height: 26,
          background: "rgba(15, 23, 42, 0.78)",
          color: "#ffffff",
          backdropFilter: "blur(4px)",
        }}
      >
        <X size={14} strokeWidth={2.6} />
      </button>
    </div>
  );
}

function LinksSection({
  links,
  input,
  onInputChange,
  onAdd,
  onRemove,
}: {
  links: string[];
  input: string;
  onInputChange: (v: string) => void;
  onAdd: () => void;
  onRemove: (idx: number) => void;
}) {
  return (
    <div
      className="rounded-section p-5 flex flex-col"
      style={{
        border: "1px solid var(--color-hairline)",
        background: "var(--color-surface-soft)",
      }}
    >
      <div className="flex items-center justify-between mb-4">
        <span
          className="inline-flex items-center gap-2.5 uppercase font-black tracking-[0.10em]"
          style={{
            fontFamily: "var(--font-display), system-ui, sans-serif",
            fontSize: 17,
            color: "rgb(var(--vp-cyan-deep))",
          }}
        >
          <Link2 size={22} strokeWidth={2.2} />
          Add links
        </span>
        <span
          className="tabular-nums font-black"
          style={{
            fontSize: 14,
            color: "var(--color-ink-muted)",
          }}
        >
          {links.length} {links.length === 1 ? "link" : "links"}
        </span>
      </div>

      <div className="flex items-stretch gap-2">
        <input
          type="url"
          value={input}
          onChange={(e) => onInputChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              onAdd();
            }
          }}
          placeholder="https://docs.example.com/borrower/4471"
          className="nt-input flex-1"
        />
        <button
          type="button"
          onClick={onAdd}
          aria-label="Add link"
          className="inline-flex items-center justify-center rounded-chip transition-all"
          style={{
            width: 52,
            background:
              "linear-gradient(135deg, rgb(2, 99, 204), rgb(0, 66, 138))",
            color: "#ffffff",
            border: "none",
            boxShadow: "0 4px 12px rgba(10, 108, 255, 0.32)",
          }}
        >
          <Plus size={22} strokeWidth={2.4} />
        </button>
      </div>

      {/* Link chips — wraps as more are added */}
      <ul className="mt-3 flex flex-col gap-1.5 flex-1">
        {links.length === 0 ? (
          <li
            className="flex-1 flex items-center justify-center rounded-chip"
            style={{
              minHeight: 80,
              background:
                "linear-gradient(135deg, #f1f5f9 0%, #e2e8f0 100%)",
              border: "1.5px dashed #cbd5e1",
              color: "#94a3b8",
              fontSize: 15,
              fontWeight: 700,
            }}
          >
            <span className="inline-flex items-center gap-2">
              <Link2 size={18} strokeWidth={2} />
              No links yet — paste a URL above.
            </span>
          </li>
        ) : (
          links.map((url, i) => (
            <li
              key={`${url}-${i}`}
              className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-chip"
              style={{
                background: "#ffffff",
                border: "1px solid var(--color-hairline)",
              }}
            >
              <Link2
                size={16}
                strokeWidth={2.2}
                style={{ color: "rgb(var(--vp-cyan-deep))" }}
              />
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 truncate text-ink-strong font-bold"
                style={{ fontSize: 16 }}
              >
                {url}
              </a>
              <button
                type="button"
                onClick={() => onRemove(i)}
                aria-label="Remove link"
                className="inline-flex items-center justify-center rounded-full text-ink-subtle hover:text-ink-strong"
                style={{ width: 28, height: 28 }}
              >
                <X size={16} strokeWidth={2.4} />
              </button>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
