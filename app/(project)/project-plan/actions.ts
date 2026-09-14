"use server";

import { revalidatePath, updateTag } from "next/cache";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  employees,
  projectNodeAttachments,
  projectNodes,
  tasks,
  taskEvents,
  type Employee,
  type ProjectNode,
} from "@/db/schema";
import { requireUser } from "@/lib/auth/current";
import { rateLimitOrError } from "@/lib/rate-limit";
import { CACHE_TAGS } from "@/lib/cache-tags";
import { afterResponse } from "@/lib/after";
import { getSupabaseAdmin, DOCUMENTS_BUCKET } from "@/lib/supabase/admin";
import { reconcileTaskEvent, removeTaskEvent } from "@/lib/google/sync";
import { createTasksCore } from "@/lib/tasks/create-task";
import { applyTaskStatusChange } from "@/lib/tasks/set-status";
import { descendantIds, planDeleteImpact } from "@/lib/queries/plan";
import { actorFor } from "@/lib/plan/actor";
import { rootProject } from "@/lib/plan/task-sync";
import {
  CHILD_KIND,
  KIND_LABEL,
  PARENT_KIND,
  PLAN_KINDS,
  isValidChild,
  hasTask,
  isExecutable,
  isPlanKind,
  UNCLASSIFIED_MILESTONE,
  UNCLASSIFIED_RESULT,
  type PlanKind,
} from "@/lib/plan/levels";
import {
  canSetPlanStatus,
  isRestrictedStatus,
  isWorkingStatus,
  verdictColumnValue,
} from "@/lib/plan/status";
// A "use server" module may only export async functions — one `export const`
// here silences every export in the file. The cap lives with the reader that
// enforces it in the browser.
import { BULK_MAX_ROWS } from "@/lib/plan/bulk";
import type { TaskPriority, TaskStatus } from "@/db/enums";

/**
 * Project Plan server actions.
 *
 * THERE IS EXACTLY ONE PERMISSION RULE IN THIS MODULE AND IT IS STATUS.
 * Create, rename, re-date, move, duplicate, archive, delete and attach are
 * open to any signed-in employee, by explicit product decision — do not add an
 * ownership gate to them later without changing that decision first.
 */

type Result<T = unknown> = ({ ok: true } & T) | { ok: false; error: string };

const uuid = z.string().uuid();
const KindSchema = z.enum(PLAN_KINDS);
const NameSchema = z
  .string()
  .trim()
  .min(1, "Name is required")
  .max(160, "Name is too long");

const UNDEFINED_COLUMN = "42703";
function pgCode(err: unknown): string | undefined {
  return (err as { code?: string } | null)?.code;
}
function pgMessage(err: unknown): string {
  return (err as { message?: string } | null)?.message ?? String(err);
}

/** Both plan surfaces plus the task caches every write can touch. */
function revalidatePlanSurfaces(): void {
  revalidatePath("/project-plan");
  revalidatePath("/projects");
  updateTag(CACHE_TAGS.projectNodes);
  updateTag(CACHE_TAGS.tasks);
}

/** Noon LOCAL, never midnight — see `updatePlanNode`. */
function targetDateAt(ymd: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0, 0);
  return Number.isNaN(d.getTime()) ? null : d;
}

function todayAtNoon(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 0, 0, 0);
}

/** An href is only ever rendered from a validated link. */
function sanitiseLinks(links: string[] | null | undefined): string[] | null {
  if (!links) return null;
  const clean = links
    .map((l) => l.trim())
    .filter((l) => /^https?:\/\//i.test(l))
    .slice(0, 50);
  return clean.length > 0 ? clean : null;
}

/* ── syncNodeTask — the ONLY path that touches a plan row's task ─────────── */

/**
 * Reconcile the one `tasks` row an executable (or Result) node points at.
 *
 * Creation is LAZY: the row becomes a real task the moment it has BOTH an
 * owner and a target date — the two columns `tasks` cannot be inserted
 * without. Until then it is plan-only and reads "Not scheduled". That is what
 * keeps the task list and everyone's calendar free of half-typed placeholders.
 *
 * NEVER THROWS. The hierarchy edit is already committed by the time this runs;
 * a calendar or task hiccup must not roll it back. Log and move on.
 */
export async function syncNodeTask(
  nodeId: string,
  actor: { id: string; name: string; isAdmin?: boolean },
  opts: {
    /**
     * Hand the task to the row's owner.
     *
     * Only passed when the OWNER ITSELF just changed. The owner is who the
     * work belongs to, so moving it should move the person doing it — but
     * doing that on every sync is what used to revert a deliberate
     * reassignment the next time anything on the row was edited. Whoever
     * changed the owner is asking for this; someone renaming the row is not.
     */
    adoptOwnerAsDoer?: boolean;
  } = {},
): Promise<void> {
  try {
    const node = await db.query.projectNodes.findFirst({
      where: eq(projectNodes.id, nodeId),
    });
    if (!node || node.isArchived) return;
    if (!hasTask(node.kind)) return;

    const existing = await db.query.tasks.findFirst({
      where: and(eq(tasks.projectNodeId, nodeId), eq(tasks.archived, false)),
      orderBy: asc(tasks.createdAt),
    });

    /**
     * WHEN a plan row becomes a real task.
     *
     * The deadline it is filed under, in order: the target date if one was
     * given, otherwise the END of its scheduled window, otherwise the start.
     * SCHEDULING AN ACTION IS ENOUGH — putting a start and an end on a row is
     * committing to do it in that window, and that belongs in the task list
     * and on the doer's calendar exactly like a target date does. Before this
     * a scheduled row with no target date stayed plan-only and invisible to
     * the person meant to do it.
     *
     * An owner is still required and always will be: `createTasksCore`
     * refuses a task with no doer, and a task nobody is holding is precisely
     * the placeholder lazy creation exists to keep out.
     */
    const dueSource = node.targetDate ?? node.endsAt ?? node.startsAt;
    const schedulable = Boolean(node.ownerId && dueSource);

    /**
     * THE THREE COLUMNS A TASK LIST USES TO PLACE A ROW, and they must say
     * three different things.
     *
     *   Client   the PROJECT this hangs under — or the client the intake
     *            form named, when someone typed one.
     *   Subject  the kind of work, from the row's own Subject field.
     *   Task     the row's name.
     *
     * All three used to resolve to `node.name`, so a plan task arrived in the
     * list as the same string printed three times, telling you nothing about
     * where it came from.
     */
    /**
     * The Client column, in order of who actually answered the question:
     *
     *   1. this row's own client name, if someone typed one on it;
     *   2. the CLIENT ITS PROJECT IS FOR — the answer the project's create and
     *      edit dialogs collect, which every task in the branch inherits;
     *   3. the project's name, when no client has been named anywhere;
     *   4. the row's own name, for a branch with no project above it at all.
     */
    const project = await rootProject(node.id);
    const clientLabel =
      node.clientName?.trim() ||
      project?.clientName?.trim() ||
      project?.name ||
      node.name;
    const subjectLabel = node.subject?.trim() || null;

    if (existing) {
      // Mirror the plan fields onto the task in place, so the task stays the
      // single execution record. A field momentarily cleared does NOT tear the
      // task down — leave it exactly as it is rather than deleting work.
      await db
        .update(tasks)
        .set({
          // The row's NAME, the same expression the create branch below
          // uses. The client name used to be jammed in here for want of
          // anywhere else to put it; it has its own column now.
          title: node.name,
          client: clientLabel,
          /**
           * THE DOER IS NOT MIRRORED FROM THE OWNER.
           *
           * It used to be: every sync wrote `doerId: node.ownerId`, so a
           * deliberate reassignment on the task — or from the plan's own Doer
           * column, which goes through `reassignDoer` with its lock, its
           * audit event and its calendar move — was silently reverted to the
           * owner by the next edit of ANY field on the row. Change the doer,
           * then rename the row, and the doer changed back.
           *
           * The owner SEEDS the doer once, in the create branch below, and
           * from then on the task owns it — EXCEPT when the owner is the very
           * thing being changed, which `adoptOwnerAsDoer` says.
           */
          ...(opts.adoptOwnerAsDoer && node.ownerId ? { doerId: node.ownerId } : {}),
          // Mirrored when the row names one, so changing the initiator in the
          // plan moves it on the task too. Absent leaves the task's own.
          ...(node.initiatorId ? { initiatorId: node.initiatorId } : {}),
          // Same order as `dueSource` above — a row dated only by its
          // schedule must not keep the due date it was created with once that
          // schedule moves.
          ...(dueSource ? { dueAt: dueSource } : {}),
          startsAt: node.startsAt ?? null,
          endsAt: node.endsAt ?? null,
          estimatedMinutes: node.durationMinutes ?? null,
          // Mirrored on every edit, not only at creation: the plan row is
          // where these are written (the edit dialog offers them there), so a
          // task showing the description the row had last week is stale, not
          // independent. Priority and notes are deliberately absent — an
          // executable row takes those FROM its task, so copying them the
          // other way would fight the person editing the task.
          description: node.description ?? null,
          // Written only when the ROW has one. Rows made before the edit
          // dialog offered a Subject field carry none, and pushing that null
          // would strip the subject the task was created with — the same
          // "a field momentarily cleared does not tear the task down" rule
          // the rest of this branch follows. `mirrorTaskToNode` teaches the
          // row the task's subject the first time the task is edited.
          ...(subjectLabel ? { subject: subjectLabel } : {}),
          tags: node.tags ?? null,
          updatedAt: new Date(),
        })
        .where(eq(tasks.id, existing.id));
      afterResponse(() => reconcileTaskEvent(existing.id));
      return;
    }

    if (!schedulable) return; // plan-only for now — "Not scheduled"

    // Through the SHARED task-create core, so the short id, the audit event,
    // the notifications and the calendar sync are byte-identical to a task
    // created anywhere else in the app.
    const created = await createTasksCore(actor, {
      title: node.name,
      client: clientLabel,
      doerId: node.ownerId!,
      initiatorId: node.initiatorId ?? actor.id,
      priority: "imp_not_urgent",
      dueAt: dueSource!.toISOString(),
      description: node.description ?? null,
      subject: subjectLabel,
      notes: null,
      tags: node.tags ?? null,
      startsAt: node.startsAt?.toISOString() ?? null,
      endsAt: node.endsAt?.toISOString() ?? null,
      projectNodeId: node.id,
      visibility: "internal",
      audience: [],
    });
    if (!created.ok) {
      console.warn("[plan] syncNodeTask create failed", created.error);
      return;
    }
    if (node.durationMinutes != null) {
      await db
        .update(tasks)
        .set({ estimatedMinutes: node.durationMinutes })
        .where(eq(tasks.id, created.id));
    }
  } catch (err) {
    console.warn("[plan] syncNodeTask failed (non-fatal)", pgMessage(err));
  }
}

/* ── Create ──────────────────────────────────────────────────────────────── */

/** Sibling ordering in gaps of TEN — see `movePlanNode` for why. */
async function nextSortOrder(parentId: string | null): Promise<number> {
  const [row] = await db
    .select({ max: sql<number>`coalesce(max(${projectNodes.sortOrder}), 0)::int` })
    .from(projectNodes)
    .where(
      parentId
        ? eq(projectNodes.parentId, parentId)
        : sql`${projectNodes.parentId} is null`,
    );
  return (row?.max ?? 0) + 10;
}

/** Validate a (kind, parentId) pair in BOTH directions before any write. */
async function checkParent(
  kind: PlanKind,
  parentId: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const needs = PARENT_KIND[kind];
  if (!needs) {
    if (parentId) return { ok: false, error: "A project can't have a parent." };
    return { ok: true };
  }
  if (!parentId) {
    return { ok: false, error: `A ${kind.replace(/_/g, " ")} needs a parent ${needs.replace(/_/g, " ")}.` };
  }
  const parent = await db.query.projectNodes.findFirst({
    where: eq(projectNodes.id, parentId),
    columns: { id: true, kind: true, isArchived: true },
  });
  if (!parent) return { ok: false, error: "That parent no longer exists." };
  if (parent.isArchived) return { ok: false, error: "That parent is archived." };
  if (parent.kind !== needs) {
    return {
      ok: false,
      error: `A ${kind.replace(/_/g, " ")} goes under a ${needs.replace(/_/g, " ")}, not a ${parent.kind.replace(/_/g, " ")}.`,
    };
  }
  return { ok: true };
}

const CreateNodeSchema = z.object({
  kind: KindSchema,
  parentId: uuid.nullable().optional().default(null),
  name: NameSchema.optional(),
});

/**
 * The bare `+` on a row.
 *
 * A TASK-LEVEL row seeds `owner_id = me` and `target_date = today` and syncs,
 * so the work is never invisible; both are editable cells the moment the row
 * lands, so a wrong guess costs one click. Containers get neither — a
 * milestone is not something anyone does.
 */
export async function createPlanNode(
  input: z.input<typeof CreateNodeSchema>,
): Promise<Result<{ id: string }>> {
  const me = await requireUser();
  const limited = rateLimitOrError(me.id, "write");
  if (limited) return limited;

  const parsed = CreateNodeSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { kind, parentId, name } = parsed.data;

  const parentCheck = await checkParent(kind, parentId ?? null);
  if (!parentCheck.ok) return parentCheck;

  const seedsTask = hasTask(kind);
  try {
    const [row] = await db
      .insert(projectNodes)
      .values({
        name: name?.trim() || `New ${kind.replace(/_/g, " ")}`,
        kind,
        parentId: parentId ?? null,
        sortOrder: await nextSortOrder(parentId ?? null),
        createdById: me.id,
        // Owned by whoever raised it, at every level — quick-add has no
        // initiator field to ask, so the account adding the row IS the
        // initiator. See the note in `insertNode`; a container used to land
        // here unowned, which left its creator with no standing on it.
        ownerId: me.id,
        // Written as well as implied: the Owner column reads `initiator_id`,
        // so a quick-added row that only carried the id in `owner_id` showed
        // a blank Owner until someone opened the edit dialog.
        initiatorId: me.id,
        ...(seedsTask ? { targetDate: todayAtNoon() } : {}),
      })
      .returning({ id: projectNodes.id });
    if (!row) return { ok: false, error: "Insert returned no row." };

    if (seedsTask) await syncNodeTask(row.id, me);
    revalidatePlanSurfaces();
    return { ok: true, id: row.id };
  } catch (err) {
    return { ok: false, error: `Could not add the row: ${pgMessage(err)}` };
  }
}

/** The intake group the create dialog collects but only a container stores. */
const IntakeSchema = z.object({
  description: z.string().trim().max(8000).nullable().optional().default(null),
  notes: z.string().trim().max(8000).nullable().optional().default(null),
  targetDate: z.string().trim().nullable().optional().default(null),
  ownerId: uuid.nullable().optional().default(null),
  category: z.string().trim().max(120).nullable().optional().default(null),
  purpose: z.string().trim().max(500).nullable().optional().default(null),
  clientName: z.string().trim().max(240).nullable().optional().default(null),
  subject: z.string().trim().max(120).nullable().optional().default(null),
  priority: z.string().trim().max(40).nullable().optional().default(null),
  initiatorId: uuid.nullable().optional().default(null),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).nullable().optional().default(null),
  links: z.array(z.string().trim().max(2000)).max(50).nullable().optional().default(null),
  durationMinutes: z.number().int().min(0).max(60 * 24 * 365).nullable().optional().default(null),
  startsAt: z.string().datetime().nullable().optional().default(null),
  endsAt: z.string().datetime().nullable().optional().default(null),
});

const CreateForTaskSchema = CreateNodeSchema.extend({
  name: NameSchema,
}).and(IntakeSchema);

/**
 * The create dialog's TASK path.
 *
 * Deliberately does NOT call `syncNodeTask`: the caller is about to create the
 * task itself with the full field set, and letting both run is exactly how you
 * get two tasks for one row.
 */
export async function createPlanNodeForTask(
  input: z.input<typeof CreateForTaskSchema>,
): Promise<Result<{ id: string; clientName: string | null }>> {
  const me = await requireUser();
  const limited = rateLimitOrError(me.id, "write");
  if (limited) return limited;

  const parsed = CreateForTaskSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const data = parsed.data;
  if (!hasTask(data.kind)) {
    return {
      ok: false,
      error: `A ${data.kind.replace(/_/g, " ")} has no task — use the container path.`,
    };
  }
  const parentCheck = await checkParent(data.kind, data.parentId ?? null);
  if (!parentCheck.ok) return parentCheck;

  const made = await insertNode(me, data, { syncTask: false });
  if (!made.ok) return made;
  return { ok: true, id: made.id, clientName: await planClientFor(made.id) };
}

/* ── Resolving a task's place in the plan ────────────────────────────────── */

const ResolvePlacementSchema = z.object({
  projectId: uuid,
  /** Blank/absent → the project's Unclassified Milestone, made if needed. */
  milestoneId: uuid.nullable().optional(),
  /** Blank/absent → that milestone's Unclassified Result, made if needed. */
  resultId: uuid.nullable().optional(),
  /**
   * The Action to file UNDER, when the result already has one.
   *
   * Given → the task becomes a SUB-ACTION of it. Blank → the task becomes a
   * new ACTION of the result in its own right.
   */
  actionId: uuid.nullable().optional(),
  /**
   * Names the executable row this creates — the task's own title.
   *
   * OPTIONAL, with a fallback below. A required name here means a caller that
   * does not send one — an older tab still running the previous bundle, say —
   * fails validation with "Name is required" pointing at a field that is not
   * on its form. A row named from the subject is recoverable; a dead submit
   * button is not.
   */
  name: z.string().trim().max(160, "Name is too long").nullable().optional(),
  /** Carried onto that row, so the plan is not a tree of empty names. */
  description: z.string().trim().nullable().optional(),
  subject: z.string().trim().nullable().optional(),
});

/**
 * Turn "this task belongs to Project X" into the RESULT it actually hangs off.
 *
 * The new-task form asks three cascading questions — project, then milestone,
 * then result — and lets you answer only the first. That is the point: people
 * know which project a piece of work is for long before anyone has decided
 * which milestone it serves, and a form that demanded all three would get the
 * other two guessed at or the link abandoned.
 *
 * What it must NOT do is leave the task hanging off the Project itself. The
 * plan's levels are a strict chain (`PARENT_KIND`), rollups count children of
 * the right kind, and a task parented three levels too high is a row every
 * count quietly disagrees about. So an unanswered question becomes a real row:
 * "Unclassified Milestone" under the project, "Unclassified Result" under
 * that. They are ordinary rows — rename one, move work out of it, and it
 * stops being a holding pen without anything special happening.
 *
 * FOUND, NOT DUPLICATED: the lookup is by name within the parent, so a second
 * task filed the same way joins the first one's Unclassified Result instead of
 * creating a second beside it.
 */
export async function resolvePlanPlacement(
  input: z.input<typeof ResolvePlacementSchema>,
): Promise<Result<{ id: string; clientName: string | null }>> {
  const me = await requireUser();
  const limited = rateLimitOrError(me.id, "write");
  if (limited) return limited;

  const parsed = ResolvePlacementSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { projectId, milestoneId, resultId, actionId, name, description, subject } =
    parsed.data;

  /*
   * A chosen Result used to SHORT-CIRCUIT here, returning the Result itself as
   * the task's row. That skipped the project and milestone checks entirely and,
   * more importantly, stopped one level above where a task belongs. The whole
   * chain is now walked every time, and it ends on an executable row.
   */
  const project = await db.query.projectNodes.findFirst({
    where: eq(projectNodes.id, projectId),
    columns: { id: true, kind: true, isArchived: true },
  });
  if (!project || project.isArchived) {
    return { ok: false, error: "That project no longer exists." };
  }
  if (project.kind !== "project") {
    return { ok: false, error: "That row isn't a project." };
  }

  let milestone = milestoneId ?? null;
  if (!milestone && resultId) {
    const row = await db.query.projectNodes.findFirst({
      where: eq(projectNodes.id, resultId),
      columns: { parentId: true },
    });
    milestone = row?.parentId ?? null;
  }
  if (milestone) {
    const row = await db.query.projectNodes.findFirst({
      where: eq(projectNodes.id, milestone),
      columns: { id: true, kind: true, parentId: true, isArchived: true },
    });
    if (!row || row.isArchived) {
      return { ok: false, error: "That milestone no longer exists." };
    }
    if (row.kind !== "milestone" || row.parentId !== project.id) {
      return { ok: false, error: "That milestone isn't in this project." };
    }
  } else {
    const made = await findOrCreateChild(me, project.id, "milestone", UNCLASSIFIED_MILESTONE);
    if (!made.ok) return made;
    milestone = made.id;
  }

  let resultNode = resultId ?? null;
  if (resultNode) {
    const row = await db.query.projectNodes.findFirst({
      where: eq(projectNodes.id, resultNode),
      columns: { id: true, kind: true, parentId: true, isArchived: true },
    });
    if (!row || row.isArchived) {
      return { ok: false, error: "That result no longer exists." };
    }
    if (row.kind !== "result" || row.parentId !== milestone) {
      return { ok: false, error: "That result isn't in this milestone." };
    }
  } else {
    // A RESULT THE CALLER CHOSE USED TO BE DISCARDED HERE. This branch ran
    // unconditionally, so every task filed from the form landed in the
    // Unclassified Result no matter which one the picker had offered and the
    // person had picked. The parameter existed; nothing read it.
    const made = await findOrCreateChild(me, milestone, "result", UNCLASSIFIED_RESULT);
    if (!made.ok) return made;
    resultNode = made.id;
  }

  /*
   * THE LEAF — where the task actually hangs.
   *
   * A task used to be pinned straight onto the Result, which contradicts the
   * level model: `TASK_KINDS` is the three EXECUTABLES, and a Result is a
   * container that reports "2 of 5 actions done" from the work underneath it.
   * A task hanging off the container itself is work no rollup can see.
   *
   * So the last step of placing a task is creating the executable row it IS:
   *
   *   an Action was chosen   → the task is a SUB-ACTION of it
   *   no Action was chosen   → the task is a new ACTION of the result
   *
   * Named and described from the task, so the plan reads as the work rather
   * than as a tree of placeholders. `syncTask: false` throughout: the caller
   * creates the task itself a moment later, and letting both run is exactly
   * how one row ends up with two tasks.
   */
  if (actionId) {
    const row = await db.query.projectNodes.findFirst({
      where: eq(projectNodes.id, actionId),
      columns: { id: true, kind: true, parentId: true, isArchived: true },
    });
    if (!row || row.isArchived) {
      return { ok: false, error: "That action no longer exists." };
    }
    if (row.kind !== "action" || row.parentId !== resultNode) {
      return { ok: false, error: "That action isn't in this result." };
    }
  }

  const leafName = name?.trim() || subject?.trim() || "Untitled action";

  const leaf = actionId
    ? await createLeaf(me, actionId, "sub_action", leafName, description ?? null, subject ?? null)
    : await createLeaf(me, resultNode, "action", leafName, description ?? null, subject ?? null);
  if (!leaf.ok) return leaf;

  // The caller creates the task next and is the only one who can set its
  // Client column; it has no way to know the project's client on its own.
  return { ok: true, id: leaf.id, clientName: await planClientFor(leaf.id) };
}

/**
 * THE CLIENT COLUMN for a task about to be created under a plan row.
 *
 * The same chain `syncNodeTask` uses, and it has to stay the same: the sync
 * rewrites this column on the next edit of the row, so a create that answered
 * differently would show one client until somebody touched the row and another
 * afterwards.
 *
 *   1. the row's own client name, if one was typed on it;
 *   2. THE CLIENT ITS PROJECT IS FOR — the answer the project's create dialog
 *      collects, which every task in the branch inherits;
 *   3. the project's name, when no client was named anywhere;
 *   4. null, letting the caller fall back to the task's own title.
 */
async function planClientFor(nodeId: string): Promise<string | null> {
  const node = await db.query.projectNodes.findFirst({
    where: eq(projectNodes.id, nodeId),
    columns: { clientName: true },
  });
  const own = node?.clientName?.trim();
  if (own) return own;
  const project = await rootProject(nodeId);
  return project?.clientName?.trim() || project?.name || null;
}

/**
 * The executable row a task IS — an Action under a Result, or a Sub-Action
 * under an Action.
 *
 * Always a NEW row, never found-and-reused: two tasks that happen to share a
 * title are two pieces of work, and collapsing them onto one plan row would
 * give that row two tasks and every rollup a number it cannot explain. That is
 * the opposite of `findOrCreateChild`, which exists to avoid a SECOND holding
 * pen of the same name.
 */
async function createLeaf(
  me: Employee,
  parentId: string,
  kind: PlanKind,
  name: string,
  description: string | null,
  subject: string | null,
): Promise<Result<{ id: string }>> {
  return insertNode(
    me,
    {
      kind,
      parentId,
      name,
      description,
      notes: null,
      targetDate: null,
      ownerId: null,
      category: null,
      purpose: null,
      durationMinutes: null,
      startsAt: null,
      endsAt: null,
      clientName: null,
      subject,
      priority: null,
      initiatorId: null,
      tags: null,
      links: null,
    } as IntakeValues,
    { syncTask: false },
  );
}

/**
 * The child of `parentId` with this exact name, or a new one.
 *
 * Deliberately NOT `syncTask`: a holding row has no owner and no date, so
 * `syncNodeTask` would decline to make a task for it anyway — and a Result
 * nobody asked for appearing on the task list is the opposite of what a
 * fallback is for. The task the caller is about to create is the one that
 * belongs on the list.
 */
async function findOrCreateChild(
  me: Employee,
  parentId: string,
  kind: PlanKind,
  name: string,
): Promise<Result<{ id: string }>> {
  const existing = await db.query.projectNodes.findFirst({
    where: and(
      eq(projectNodes.parentId, parentId),
      eq(projectNodes.kind, kind),
      eq(projectNodes.name, name),
      eq(projectNodes.isArchived, false),
    ),
    columns: { id: true },
  });
  if (existing) return { ok: true, id: existing.id };

  return insertNode(
    me,
    {
      kind,
      parentId,
      name,
      description: null,
      notes: null,
      targetDate: null,
      ownerId: null,
      category: null,
      purpose: null,
      durationMinutes: null,
      startsAt: null,
      endsAt: null,
      clientName: null,
      subject: null,
      priority: null,
      initiatorId: null,
      tags: null,
      links: null,
    } as IntakeValues,
    { syncTask: false },
  );
}

const CreateContainerSchema = CreateNodeSchema.extend({
  name: NameSchema,
}).and(IntakeSchema);

/**
 * The create dialog's CONTAINER path — writes a node and NO task.
 *
 * This is exactly why the intake columns exist: the dialog is the app's real
 * task form and collects client, subject, priority, initiator, tags and links
 * at every level. A form that collects six fields and throws them away is
 * worse than one that never asked.
 */
export async function createPlanContainer(
  input: z.input<typeof CreateContainerSchema>,
): Promise<Result<{ id: string }>> {
  const me = await requireUser();
  const limited = rateLimitOrError(me.id, "write");
  if (limited) return limited;

  const parsed = CreateContainerSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const data = parsed.data;
  if (hasTask(data.kind)) {
    return {
      ok: false,
      error: `A ${data.kind.replace(/_/g, " ")} carries a task — use the task path.`,
    };
  }
  const parentCheck = await checkParent(data.kind, data.parentId ?? null);
  if (!parentCheck.ok) return parentCheck;

  return insertNode(me, data, { syncTask: false });
}

type IntakeValues = z.output<typeof IntakeSchema> & {
  kind: PlanKind;
  parentId: string | null;
  name: string;
};

/**
 * The shared insert behind both dialog paths.
 *
 * Retries WITHOUT the intake group on 42703 rather than losing the row: a
 * database one migration behind should cost the caller those fields, not the
 * thing they were trying to create.
 */
async function insertNode(
  me: Employee,
  data: IntakeValues,
  opts: { syncTask: boolean },
): Promise<Result<{ id: string }>> {
  const sortOrder = await nextSortOrder(data.parentId ?? null);
  const base = {
    name: data.name.trim(),
    kind: data.kind,
    parentId: data.parentId ?? null,
    sortOrder,
    createdById: me.id,
    description: data.description || null,
    notes: data.notes || null,
    targetDate: data.targetDate ? targetDateAt(data.targetDate) : null,
    /**
     * A new row is OWNED BY THE PERSON WHO RAISED IT.
     *
     * The intake form asks who the initiator is and defaults it to whoever is
     * filling it in, so that is the answer — and only when nobody was named
     * does it fall back to the account doing the insert. An owner picked
     * explicitly still wins over both.
     *
     * It used to land as `null`, which read as "unowned" everywhere it
     * mattered: `actorForRow` grants isOwner from this column, so a project
     * someone had just created gave its creator no standing on it — they
     * could not set a status or record progress on their own plan unless
     * they happened to be an admin.
     *
     * The DOER is a separate question, and a different column: it belongs to
     * the linked task and is the person doing the work. `syncNodeTask` seeds
     * it from the owner for a row that schedules itself, and reassigning it
     * there never touches who owns the row.
     */
    ownerId: data.ownerId ?? data.initiatorId ?? me.id,
  };
  const intake = {
    category: data.category || null,
    purpose: data.purpose || null,
    durationMinutes: data.durationMinutes ?? null,
    startsAt: data.startsAt ? new Date(data.startsAt) : null,
    endsAt: data.endsAt ? new Date(data.endsAt) : null,
    clientName: data.clientName || null,
    subject: data.subject || null,
    priority: data.priority || null,
    initiatorId: data.initiatorId ?? null,
    tags: data.tags ?? null,
    links: sanitiseLinks(data.links),
  };

  try {
    const [row] = await db
      .insert(projectNodes)
      .values({ ...base, ...intake })
      .returning({ id: projectNodes.id });
    if (!row) return { ok: false, error: "Insert returned no row." };
    if (opts.syncTask) await syncNodeTask(row.id, me);
    revalidatePlanSurfaces();
    return { ok: true, id: row.id };
  } catch (err) {
    if (pgCode(err) !== UNDEFINED_COLUMN) {
      return { ok: false, error: `Could not create: ${pgMessage(err)}` };
    }
    console.warn(
      "[plan] intake columns missing on insert — apply migration 0103. Writing the row without them.",
    );
    try {
      const [row] = await db
        .insert(projectNodes)
        .values(base)
        .returning({ id: projectNodes.id });
      if (!row) return { ok: false, error: "Insert returned no row." };
      if (opts.syncTask) await syncNodeTask(row.id, me);
      revalidatePlanSurfaces();
      return { ok: true, id: row.id };
    } catch (retryErr) {
      return { ok: false, error: `Could not create: ${pgMessage(retryErr)}` };
    }
  }
}

/* ── Bulk create ─────────────────────────────────────────────────────────── */

const BulkRowSchema = z.object({
  name: NameSchema,
  ownerId: uuid.nullable().optional().default(null),
  targetDate: z.string().trim().nullable().optional().default(null),
  startsAt: z.string().trim().nullable().optional().default(null),
  endsAt: z.string().trim().nullable().optional().default(null),
  description: z.string().trim().max(8000).nullable().optional().default(null),
});

const BulkCreateSchema = z.object({
  kind: KindSchema,
  parentId: uuid.nullable().optional().default(null),
  rows: z.array(BulkRowSchema).min(1, "Nothing to import").max(BULK_MAX_ROWS),
});

/**
 * Fifty rows under one parent, in one gesture.
 *
 * NOT a loop over `createPlanNode`: the parent check, the roster lookup and
 * the MAX(sort_order) read are facts about the DESTINATION, so they happen
 * once — fifty rows cost one validation, one ordering query and one INSERT.
 *
 * The plan rows commit FIRST and the tasks follow, so one row's task failure
 * leaves 50 rows and 49 tasks rather than a half-written import and an error
 * page.
 */
export async function bulkCreatePlanNodes(
  input: z.input<typeof BulkCreateSchema>,
): Promise<Result<{ created: number; tasksCreated: number }>> {
  const me = await requireUser();
  const limited = rateLimitOrError(me.id, "write");
  if (limited) return limited;

  const parsed = BulkCreateSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      ok: false,
      error:
        issue?.code === "too_big"
          ? `That's more than ${BULK_MAX_ROWS} rows. Split the paste and import it in batches.`
          : (issue?.message ?? "Invalid input"),
    };
  }
  const { kind, parentId, rows } = parsed.data;

  const parentCheck = await checkParent(kind, parentId ?? null);
  if (!parentCheck.ok) return parentCheck;

  // One ordering read for the whole batch.
  let order = await nextSortOrder(parentId ?? null);
  const seedsTask = hasTask(kind);

  const values = rows.map((r) => {
    const row = {
      name: r.name.trim(),
      kind,
      parentId: parentId ?? null,
      sortOrder: order,
      createdById: me.id,
      description: r.description || null,
      // A blank owner is filled by the importer and a blank date by today, so
      // no imported row quietly fails to become a task.
      ownerId: r.ownerId ?? (seedsTask ? me.id : null),
      targetDate: r.targetDate
        ? targetDateAt(r.targetDate)
        : seedsTask
          ? todayAtNoon()
          : null,
      startsAt: r.startsAt ? targetDateAt(r.startsAt) : null,
      endsAt: r.endsAt ? targetDateAt(r.endsAt) : null,
    };
    order += 10;
    return row;
  });

  let inserted: { id: string }[];
  try {
    inserted = await db
      .insert(projectNodes)
      .values(values)
      .returning({ id: projectNodes.id });
  } catch (err) {
    if (pgCode(err) !== UNDEFINED_COLUMN) {
      return { ok: false, error: `Could not import: ${pgMessage(err)}` };
    }
    console.warn("[plan] bulk insert retried without the schedule columns");
    try {
      inserted = await db
        .insert(projectNodes)
        .values(
          values.map(({ startsAt: _s, endsAt: _e, ...rest }) => rest),
        )
        .returning({ id: projectNodes.id });
    } catch (retryErr) {
      return { ok: false, error: `Could not import: ${pgMessage(retryErr)}` };
    }
  }

  let tasksCreated = 0;
  if (seedsTask) {
    for (const row of inserted) {
      await syncNodeTask(row.id, me);
      tasksCreated++;
    }
  }

  revalidatePlanSurfaces();
  return { ok: true, created: inserted.length, tasksCreated };
}

/* ── Update ──────────────────────────────────────────────────────────────── */

const UpdateSchema = z.object({
  id: uuid,
  name: NameSchema.optional(),
  description: z.string().max(8000).nullable().optional(),
  notes: z.string().max(8000).nullable().optional(),
  targetDate: z.string().nullable().optional(),
  ownerId: uuid.nullable().optional(),
  category: z.string().max(120).nullable().optional(),
  purpose: z.string().max(500).nullable().optional(),
  durationMinutes: z.number().int().min(0).max(60 * 24 * 365).nullable().optional(),
  startsAt: z.string().nullable().optional(),
  endsAt: z.string().nullable().optional(),
  clientName: z.string().max(240).nullable().optional(),
  subject: z.string().max(120).nullable().optional(),
  priority: z.string().max(40).nullable().optional(),
  initiatorId: uuid.nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(40)).max(20).nullable().optional(),
  links: z.array(z.string().trim().max(2000)).max(50).nullable().optional(),
});

/**
 * Inline editing, and the edit dialog.
 *
 * `""` CLEARS TO NULL. A stored blank would still fail every `description &&`
 * check on the read side while the column claimed otherwise — two answers to
 * "is there a description?" depending on who asks.
 */
export async function updatePlanNode(
  input: z.input<typeof UpdateSchema>,
): Promise<Result> {
  const me = await requireUser();
  const limited = rateLimitOrError(me.id, "write");
  if (limited) return limited;

  const parsed = UpdateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { id, ...fields } = parsed.data;

  const node = await db.query.projectNodes.findFirst({
    where: eq(projectNodes.id, id),
    columns: { id: true, kind: true, isArchived: true, startsAt: true, endsAt: true },
  });
  if (!node) return { ok: false, error: "That row no longer exists." };
  if (node.isArchived) return { ok: false, error: "That row is archived." };

  // An executable row takes these FROM ITS TASK. Accepting them here would
  // write a second copy free to disagree with the record of truth.
  if (isExecutable(node.kind)) {
    if (fields.priority !== undefined) {
      return {
        ok: false,
        error: "An action takes its priority from its task — set it there.",
      };
    }
    if (fields.notes !== undefined) {
      return {
        ok: false,
        error: "An action takes its notes from its task — set them there.",
      };
    }
  }

  /**
   * Did this edit MOVE the owner?
   *
   * Read before the write, because after it there is nothing left to compare
   * against. Only this tells the task sync to hand the work to the new owner
   * — see `adoptOwnerAsDoer`. A save that merely re-submits the same owner
   * (which the edit dialog does on every save) must not count, or renaming a
   * row through that form would still stamp on a reassignment.
   */
  let ownerChanged = false;
  if (fields.ownerId !== undefined) {
    const [before] = await db
      .select({ ownerId: projectNodes.ownerId })
      .from(projectNodes)
      .where(eq(projectNodes.id, id));
    ownerChanged = (before?.ownerId ?? null) !== (fields.ownerId ?? null);
  }

  const patch: Partial<typeof projectNodes.$inferInsert> = { updatedAt: new Date() };
  const blankToNull = (v: string | null | undefined) =>
    v === undefined ? undefined : v === null || v.trim() === "" ? null : v.trim();

  if (fields.name !== undefined) patch.name = fields.name.trim();
  if (fields.description !== undefined) patch.description = blankToNull(fields.description);
  if (fields.notes !== undefined) patch.notes = blankToNull(fields.notes);
  if (fields.category !== undefined) patch.category = blankToNull(fields.category);
  if (fields.purpose !== undefined) patch.purpose = blankToNull(fields.purpose);
  if (fields.clientName !== undefined) patch.clientName = blankToNull(fields.clientName);
  if (fields.subject !== undefined) patch.subject = blankToNull(fields.subject);
  if (fields.priority !== undefined) patch.priority = blankToNull(fields.priority);
  if (fields.durationMinutes !== undefined) patch.durationMinutes = fields.durationMinutes;
  if (fields.tags !== undefined) patch.tags = fields.tags?.length ? fields.tags : null;
  if (fields.links !== undefined) patch.links = sanitiseLinks(fields.links);

  if (fields.targetDate !== undefined) {
    // NOON local, not midnight — midnight lands on the previous day for
    // anyone west of the storage zone once it round-trips.
    patch.targetDate = fields.targetDate ? targetDateAt(fields.targetDate) : null;
  }

  let nextStart = node.startsAt;
  let nextEnd = node.endsAt;
  if (fields.startsAt !== undefined) {
    nextStart = fields.startsAt ? new Date(fields.startsAt) : null;
    patch.startsAt = nextStart;
  }
  if (fields.endsAt !== undefined) {
    nextEnd = fields.endsAt ? new Date(fields.endsAt) : null;
    patch.endsAt = nextEnd;
  }
  if (nextStart && nextEnd && nextEnd.getTime() < nextStart.getTime()) {
    return { ok: false, error: "The end date can't be before the start date." };
  }

  if (fields.ownerId !== undefined) {
    if (fields.ownerId) {
      const owner = await db.query.employees.findFirst({
        where: eq(employees.id, fields.ownerId),
        columns: { id: true },
      });
      if (!owner) return { ok: false, error: "That person is no longer on the roster." };
    }
    patch.ownerId = fields.ownerId;
  }
  if (fields.initiatorId !== undefined) patch.initiatorId = fields.initiatorId;

  try {
    await db.update(projectNodes).set(patch).where(eq(projectNodes.id, id));
  } catch (err) {
    if (pgCode(err) !== UNDEFINED_COLUMN) {
      return { ok: false, error: `Could not save: ${pgMessage(err)}` };
    }
    // Retry without the late-added group rather than losing the whole edit.
    console.warn("[plan] update retried without the 0103 columns");
    const {
      priority: _p,
      links: _l,
      category: _c,
      purpose: _pu,
      durationMinutes: _d,
      startsAt: _s,
      endsAt: _e,
      clientName: _cn,
      subject: _sub,
      initiatorId: _i,
      tags: _t,
      ...safe
    } = patch;
    try {
      await db.update(projectNodes).set(safe).where(eq(projectNodes.id, id));
    } catch (retryErr) {
      return { ok: false, error: `Could not save: ${pgMessage(retryErr)}` };
    }
  }

  await syncNodeTask(id, me, { adoptOwnerAsDoer: ownerChanged });
  revalidatePlanSurfaces();
  return { ok: true };
}

/* ── Status ──────────────────────────────────────────────────────────────── */

const SetStatusSchema = z.object({
  id: uuid,
  /** Any string — `canSetPlanStatus` decides, here, before the write. */
  status: z.string().trim().min(1),
  /** The linked task's optimistic-lock token, when the row has one. */
  expectedUpdatedAt: z.string().optional(),
});

/**
 * Route a status to whichever record owns it.
 *
 *   executable + working  → the LINKED TASK, through the task module's own
 *                           status core (its optimistic lock, its audit event,
 *                           its notifications). The node gets no copy.
 *   container  + working  → project_nodes.status
 *   either     + verdict  → project_nodes.approval_status
 *   archived              → is_archived, cascading
 */
export async function setPlanNodeStatus(
  input: z.input<typeof SetStatusSchema>,
): Promise<Result> {
  const me = await requireUser();
  const limited = rateLimitOrError(me.id, "write");
  if (limited) return limited;

  const parsed = SetStatusSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { id, status, expectedUpdatedAt } = parsed.data;
  return applyPlanStatus(me, id, status, expectedUpdatedAt);
}

/**
 * The body of `setPlanNodeStatus`, without the auth and parse it shares with
 * `bulkSetPlanNodeStatus` — so a bar setting ten rows runs the SAME routing
 * and the SAME per-row permission check as the picker in one cell, rather
 * than a second implementation free to disagree with it.
 */
async function applyPlanStatus(
  me: Employee,
  id: string,
  status: string,
  expectedUpdatedAt?: string,
): Promise<Result> {
  const node = await db.query.projectNodes.findFirst({
    where: eq(projectNodes.id, id),
    columns: { id: true, kind: true, isArchived: true },
  });
  if (!node) return { ok: false, error: "That row no longer exists." };
  if (!isPlanKind(node.kind)) return { ok: false, error: "Unrecognised row type." };

  // THE server-side check. The dropdown is a courtesy — this would refuse a
  // hand-rolled POST even if the picker did not exist.
  const actor = await actorFor(me, id);
  const verdict = canSetPlanStatus(actor, status, node.kind);
  if (!verdict.ok) return { ok: false, error: verdict.reason };

  if (status === "archived") return archiveNode(me, id);

  if (isRestrictedStatus(status)) {
    // Layered ON TOP of the working status, never overwriting it.
    try {
      await db
        .update(projectNodes)
        .set({ approvalStatus: verdictColumnValue(status), updatedAt: new Date() })
        .where(eq(projectNodes.id, id));
    } catch (err) {
      if (pgCode(err) === UNDEFINED_COLUMN) {
        return {
          ok: false,
          error:
            "Approvals aren't available yet — this database is missing migration 0103. Ask an admin to apply it.",
        };
      }
      return { ok: false, error: `Could not save: ${pgMessage(err)}` };
    }
    revalidatePlanSurfaces();
    return { ok: true };
  }

  if (!isWorkingStatus(status)) {
    return { ok: false, error: `"${status}" is not a status this module knows.` };
  }

  if (isExecutable(node.kind)) {
    // Through the task module's own action, so the optimistic lock, the audit
    // event and the notifications are the ones every other surface produces.
    const task = await db.query.tasks.findFirst({
      where: and(eq(tasks.projectNodeId, id), eq(tasks.archived, false)),
      orderBy: asc(tasks.createdAt),
      columns: { id: true, updatedAt: true },
    });
    if (!task) {
      return {
        ok: false,
        error:
          "This row isn't a task yet — give it an owner and a target date first.",
      };
    }
    const res = await applyTaskStatusChange(
      { id: me.id, name: me.name, isAdmin: me.isAdmin },
      task.id,
      status as TaskStatus,
      expectedUpdatedAt ?? task.updatedAt.toISOString(),
    );
    if (!res.ok) {
      return {
        ok: false,
        error:
          res.error === "stale"
            ? "Someone else moved this while you were looking at it. Refresh and try again."
            : (res.message ?? "Could not change the status."),
      };
    }
    revalidatePlanSurfaces();
    revalidatePath("/tasks");
    return { ok: true };
  }

  try {
    await db
      .update(projectNodes)
      .set({ status, updatedAt: new Date() })
      .where(eq(projectNodes.id, id));
  } catch (err) {
    if (pgCode(err) === UNDEFINED_COLUMN) {
      return {
        ok: false,
        error:
          "Statuses aren't available yet — this database is missing migration 0103. Ask an admin to apply it.",
      };
    }
    return { ok: false, error: `Could not save: ${pgMessage(err)}` };
  }
  revalidatePlanSurfaces();
  return { ok: true };
}

const SetProgressSchema = z.object({
  id: uuid,
  percent: z.number().int().min(0).max(100).nullable(),
});

/**
 * The recorded partial — only ever an override; `null` returns to derivation.
 *
 * Owner or admin: declaring a milestone 75% done when three of its ten actions
 * are finished is a RULING, not a report.
 */
export async function setPlanNodeProgress(
  input: z.input<typeof SetProgressSchema>,
): Promise<Result> {
  const me = await requireUser();
  const limited = rateLimitOrError(me.id, "write");
  if (limited) return limited;

  const parsed = SetProgressSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { id, percent } = parsed.data;

  const actor = await actorFor(me, id);
  if (!actor.isAdmin && !actor.isOwner) {
    return {
      ok: false,
      error: "Recording a percentage is the owner's call — ask them or an admin.",
    };
  }

  try {
    await db
      .update(projectNodes)
      .set({ progressPercent: percent, updatedAt: new Date() })
      .where(eq(projectNodes.id, id));
  } catch (err) {
    if (pgCode(err) === UNDEFINED_COLUMN) {
      return {
        ok: false,
        error:
          "Recorded progress isn't available yet — this database is missing migration 0103.",
      };
    }
    return { ok: false, error: `Could not save: ${pgMessage(err)}` };
  }
  revalidatePlanSurfaces();
  return { ok: true };
}

/* ── Delete / archive ────────────────────────────────────────────────────── */

/** What deleting this row takes with it, for the confirm dialog. */
export async function getPlanDeleteImpact(
  id: string,
): Promise<Result<{ nodes: number; tasks: number }>> {
  await requireUser();
  if (!uuid.safeParse(id).success) return { ok: false, error: "Invalid id." };
  try {
    const impact = await planDeleteImpact(id);
    return { ok: true, ...impact };
  } catch (err) {
    return { ok: false, error: pgMessage(err) };
  }
}

/**
 * PERMANENT DELETE — the trash button on the plan surfaces.
 *
 * The row, every descendant (the DB's `parent_id ... on delete cascade` plus
 * the recursive CTE, so the count we report is the count we remove) and the
 * tasks those rows ARE, which also tears their calendar events down. Their
 * attachments go with them: the rows cascade, and the storage objects are
 * removed first so a failure leaves a row pointing at a real file rather than
 * a file nothing points at.
 *
 * Archive is still here and still the soft path — it is what
 * `setPlanStatus("archived")` runs (see `archiveNode`). The trash icon used to
 * call it too, which is why the confirm dialog said "nothing is deleted"; the
 * button now means what it says.
 */
export async function deletePlanNode(id: string): Promise<Result<{ nodes: number; tasks: number }>> {
  const me = await requireUser();
  const limited = rateLimitOrError(me.id, "write");
  if (limited) return limited;
  if (!uuid.safeParse(id).success) return { ok: false, error: "Invalid id." };
  return purgeNode(id);
}

async function purgeNode(id: string): Promise<Result<{ nodes: number; tasks: number }>> {
  let ids: string[];
  try {
    ids = await descendantIds(id);
  } catch (err) {
    return { ok: false, error: `Could not read the subtree: ${pgMessage(err)}` };
  }
  if (ids.length === 0) return { ok: false, error: "That row no longer exists." };

  // Calendar pointers have to be read BEFORE the rows carrying them are gone.
  // Archived tasks are included here where the archive cascade skips them —
  // this is the permanent path, and leaving them behind would orphan them
  // (tasks.project_node_id is ON DELETE SET NULL, not CASCADE).
  const taskRows = await db
    .select({
      id: tasks.id,
      googleEventId: tasks.googleEventId,
      googleSyncedDoerId: tasks.googleSyncedDoerId,
    })
    .from(tasks)
    .where(inArray(tasks.projectNodeId, ids));
  const attachments = await db
    .select({ storagePath: projectNodeAttachments.storagePath })
    .from(projectNodeAttachments)
    .where(inArray(projectNodeAttachments.nodeId, ids));

  if (attachments.length > 0) {
    // Best effort, exactly as `deletePlanAttachment` does it. A storage hiccup
    // must not block the delete the user asked for.
    try {
      await getSupabaseAdmin()
        .storage.from(DOCUMENTS_BUCKET)
        .remove(attachments.map((a) => a.storagePath));
    } catch (err) {
      console.warn("[plan] attachment object removal failed", (err as Error).message);
    }
  }

  try {
    await db.transaction(async (tx) => {
      // Tasks first: their events, notifications and audience rows cascade
      // with them, and documents are unlinked rather than dropped.
      if (taskRows.length > 0) {
        await tx.delete(tasks).where(
          inArray(
            tasks.id,
            taskRows.map((t) => t.id),
          ),
        );
      }
      await tx.delete(projectNodes).where(inArray(projectNodes.id, ids));
    });
  } catch (err) {
    return { ok: false, error: `Could not delete: ${pgMessage(err)}` };
  }

  // After the commit — a Google hiccup must not undo a delete that is done.
  for (const t of taskRows) {
    if (!t.googleEventId) continue;
    afterResponse(() =>
      removeTaskEvent({
        googleEventId: t.googleEventId,
        googleSyncedDoerId: t.googleSyncedDoerId,
      }),
    );
  }
  revalidatePlanSurfaces();
  revalidatePath("/tasks");
  return { ok: true, nodes: ids.length, tasks: taskRows.length };
}

async function archiveNode(
  me: Employee,
  id: string,
): Promise<Result<{ nodes: number; tasks: number }>> {
  let ids: string[];
  try {
    ids = await descendantIds(id);
  } catch (err) {
    return { ok: false, error: `Could not read the subtree: ${pgMessage(err)}` };
  }
  if (ids.length === 0) return { ok: false, error: "That row no longer exists." };

  const taskRows = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(inArray(tasks.projectNodeId, ids), eq(tasks.archived, false)));
  const taskIds = taskRows.map((t) => t.id);

  try {
    await db.transaction(async (tx) => {
      await tx
        .update(projectNodes)
        .set({ isArchived: true, updatedAt: new Date() })
        .where(inArray(projectNodes.id, ids));
      if (taskIds.length > 0) {
        await tx.update(tasks).set({ archived: true }).where(inArray(tasks.id, taskIds));
        await tx.insert(taskEvents).values(
          taskIds.map((taskId) => ({
            taskId,
            actorId: me.id,
            eventType: "archived" as const,
            fromValue: null,
            toValue: null,
          })),
        );
      }
    });
  } catch (err) {
    return { ok: false, error: `Could not archive: ${pgMessage(err)}` };
  }

  // Tear the calendar events down after the response — the archive is already
  // committed and a Google hiccup must not undo it.
  for (const taskId of taskIds) afterResponse(() => reconcileTaskEvent(taskId));
  revalidatePlanSurfaces();
  revalidatePath("/tasks");
  return { ok: true, nodes: ids.length, tasks: taskIds.length };
}

/* ── Duplicate ───────────────────────────────────────────────────────────── */

/**
 * Copy a row and its whole subtree in as a NEW SIBLING directly after it, plan
 * fields included — the point is to save re-typing.
 *
 * Each copy then goes through `syncNodeTask`, so duplicating a SCHEDULED
 * branch really does put the copies in the task list, and duplicating a DRAFT
 * branch does not. Same bar a hand-typed row has to clear.
 */
export async function duplicatePlanNode(id: string): Promise<Result<{ id: string }>> {
  const me = await requireUser();
  const limited = rateLimitOrError(me.id, "write");
  if (limited) return limited;
  if (!uuid.safeParse(id).success) return { ok: false, error: "Invalid id." };

  const source = await db.query.projectNodes.findFirst({
    where: eq(projectNodes.id, id),
  });
  if (!source || source.isArchived) {
    return { ok: false, error: "That row no longer exists." };
  }

  const ids = await descendantIds(id);
  const rows = await db
    .select()
    .from(projectNodes)
    .where(inArray(projectNodes.id, ids))
    .orderBy(asc(projectNodes.sortOrder), asc(projectNodes.name));

  const childrenOf = new Map<string, ProjectNode[]>();
  for (const r of rows) {
    if (r.id === id) continue;
    const list = childrenOf.get(r.parentId ?? "") ?? [];
    list.push(r);
    childrenOf.set(r.parentId ?? "", list);
  }

  const createdIds: string[] = [];
  try {
    // Slot the copy directly after the original. Sibling gaps are 10, so
    // +1 lands between it and whatever follows without renumbering anything.
    const rootId = await copyRow(source, source.parentId, source.sortOrder + 1, me.id);
    createdIds.push(rootId);

    const queue: Array<{ sourceId: string; newId: string }> = [
      { sourceId: id, newId: rootId },
    ];
    while (queue.length > 0) {
      const { sourceId, newId } = queue.shift()!;
      const kids = childrenOf.get(sourceId) ?? [];
      for (const kid of kids) {
        const copyId = await copyRow(kid, newId, kid.sortOrder, me.id);
        createdIds.push(copyId);
        queue.push({ sourceId: kid.id, newId: copyId });
      }
    }
  } catch (err) {
    return { ok: false, error: `Could not duplicate: ${pgMessage(err)}` };
  }

  for (const newId of createdIds) await syncNodeTask(newId, me);
  revalidatePlanSurfaces();
  return { ok: true, id: createdIds[0]! };
}

async function copyRow(
  source: ProjectNode,
  parentId: string | null,
  sortOrder: number,
  actorId: string,
): Promise<string> {
  const values: typeof projectNodes.$inferInsert = {
    name: source.name,
    kind: source.kind,
    parentId,
    sortOrder,
    createdById: actorId,
    description: source.description,
    notes: source.notes,
    targetDate: source.targetDate,
    ownerId: source.ownerId,
    visibility: source.visibility,
    category: source.category,
    purpose: source.purpose,
    durationMinutes: source.durationMinutes,
    startsAt: source.startsAt,
    endsAt: source.endsAt,
    status: source.status,
    // A verdict is a ruling about THAT work, not about a copy of it.
    approvalStatus: null,
    progressPercent: source.progressPercent,
    clientName: source.clientName,
    subject: source.subject,
    priority: source.priority,
    initiatorId: source.initiatorId,
    tags: source.tags,
    links: source.links,
  };
  const [row] = await db
    .insert(projectNodes)
    .values(values)
    .returning({ id: projectNodes.id });
  if (!row) throw new Error("Copy returned no row");
  return row.id;
}

/* ── Move ────────────────────────────────────────────────────────────────── */

const MoveSchema = z.object({
  id: uuid,
  direction: z.enum(["up", "down"]),
});

/**
 * Nudge a row within its sibling run. Reordering NEVER changes parentage.
 *
 * RENUMBER THE RUN FIRST. `sort_order` defaults to 100, so every row created
 * before this screen existed shares that one value; swapping two rows that
 * both hold 100 writes 100 twice and silently does nothing — which users
 * report as "the arrows are broken". Renumbering to 10/20/30… in the current
 * visible order is a no-op on runs that are already spaced.
 *
 * At either end this is a NO-OP, not an error: the arrow was there to be
 * pressed, and telling someone off for pressing it is worse than doing nothing.
 */
const ReparentSchema = z.object({
  id: uuid,
  /** The row it should hang off. Never null — only a Project is a root, and a
   *  Project has nowhere else to go. */
  parentId: uuid,
});

/**
 * Move a row — and everything under it — to a DIFFERENT PARENT.
 *
 * The other move action (`movePlanNode`) only ever reorders a row among its
 * own siblings. There was no way to say "this Result belongs under Milestone
 * 2, not Milestone 1" short of deleting the branch and retyping it, which is
 * how a plan ends up with the work in the wrong place and nobody willing to
 * fix it.
 *
 * THREE THINGS ARE CHECKED, and all three have to be:
 *
 *   1. The LEVELS must still line up. `isValidChild` is the same predicate the
 *      create dialog and the drop target use, so a Result cannot land under a
 *      Project and an Action cannot land under a Milestone. The tree's whole
 *      value is that the depth means something.
 *   2. A row may not move INTO ITS OWN SUBTREE. That is the cycle check, and
 *      without it a plan can be detached from its root entirely — the rows
 *      still exist, point at each other in a ring, and appear nowhere.
 *   3. Neither end may be archived.
 *
 * The subtree comes along for free: children point at their parent, so moving
 * the row moves the branch. What does NOT come along for free is the task
 * side — a plan task files itself under its PROJECT (see `rootProjectName`),
 * so a branch dragged into another project has to have its tasks re-synced or
 * they keep naming the project they used to be in.
 */
export async function reparentPlanNode(
  input: z.input<typeof ReparentSchema>,
): Promise<Result> {
  const me = await requireUser();
  const limited = rateLimitOrError(me.id, "write");
  if (limited) return limited;

  const parsed = ReparentSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { id, parentId } = parsed.data;
  if (id === parentId) {
    return { ok: false, error: "A row can't be moved into itself." };
  }

  const node = await db.query.projectNodes.findFirst({
    where: eq(projectNodes.id, id),
    columns: { id: true, kind: true, parentId: true, isArchived: true, name: true },
  });
  if (!node || node.isArchived) return { ok: false, error: "That row no longer exists." };
  if (!isPlanKind(node.kind)) return { ok: false, error: "Unrecognised row type." };
  if (node.parentId === parentId) return { ok: true }; // already there

  const parent = await db.query.projectNodes.findFirst({
    where: eq(projectNodes.id, parentId),
    columns: { id: true, kind: true, isArchived: true, name: true },
  });
  if (!parent || parent.isArchived) {
    return { ok: false, error: "That destination no longer exists." };
  }
  if (!isPlanKind(parent.kind)) return { ok: false, error: "Unrecognised row type." };

  if (!isValidChild(parent.kind, node.kind)) {
    return {
      ok: false,
      error: `A ${KIND_LABEL[node.kind]} can't sit under a ${KIND_LABEL[parent.kind]} — it belongs under a ${
        PARENT_KIND[node.kind] ? KIND_LABEL[PARENT_KIND[node.kind]!] : "root"
      }.`,
    };
  }

  // The cycle check. `descendantIds` includes the row itself, which also
  // covers the "into itself" case a second time — cheap, and the guard above
  // is the one that gives the better message.
  const subtree = await descendantIds(id);
  if (subtree.includes(parentId)) {
    return {
      ok: false,
      error: "That destination is inside the branch you're moving.",
    };
  }

  try {
    await db
      .update(projectNodes)
      .set({
        parentId,
        // Last among its new siblings. Landing it mid-run would silently
        // renumber everything below it on arrival.
        sortOrder: await nextSortOrder(parentId),
        updatedAt: new Date(),
      })
      .where(eq(projectNodes.id, id));
  } catch (err) {
    return { ok: false, error: `Could not move: ${pgMessage(err)}` };
  }

  // Re-file the branch's tasks under whatever project they are in NOW. Bounded
  // by the subtree, and a move is a rare, deliberate act — this is not a hot
  // path. `syncNodeTask` no-ops for a row that has no task.
  afterResponse(async () => {
    for (const nodeId of subtree) await syncNodeTask(nodeId, me);
  });

  revalidatePlanSurfaces();
  return { ok: true };
}

export async function movePlanNode(
  input: z.input<typeof MoveSchema>,
): Promise<Result> {
  const me = await requireUser();
  const limited = rateLimitOrError(me.id, "write");
  if (limited) return limited;

  const parsed = MoveSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { id, direction } = parsed.data;

  const node = await db.query.projectNodes.findFirst({
    where: eq(projectNodes.id, id),
    columns: { id: true, parentId: true, isArchived: true },
  });
  if (!node || node.isArchived) return { ok: false, error: "That row no longer exists." };

  const siblings = await db
    .select({ id: projectNodes.id, sortOrder: projectNodes.sortOrder })
    .from(projectNodes)
    .where(
      and(
        node.parentId
          ? eq(projectNodes.parentId, node.parentId)
          : sql`${projectNodes.parentId} is null`,
        eq(projectNodes.isArchived, false),
      ),
    )
    .orderBy(asc(projectNodes.sortOrder), asc(projectNodes.name));

  const index = siblings.findIndex((s) => s.id === id);
  if (index === -1) return { ok: false, error: "That row no longer exists." };
  const target = direction === "up" ? index - 1 : index + 1;
  if (target < 0 || target >= siblings.length) return { ok: true }; // no-op at the ends

  try {
    await db.transaction(async (tx) => {
      // Step 1 — space the run, in its CURRENT visible order.
      for (let i = 0; i < siblings.length; i++) {
        const want = (i + 1) * 10;
        if (siblings[i]!.sortOrder !== want) {
          await tx
            .update(projectNodes)
            .set({ sortOrder: want })
            .where(eq(projectNodes.id, siblings[i]!.id));
        }
      }
      // Step 2 — swap two now-distinct values.
      await tx
        .update(projectNodes)
        .set({ sortOrder: (target + 1) * 10, updatedAt: new Date() })
        .where(eq(projectNodes.id, id));
      await tx
        .update(projectNodes)
        .set({ sortOrder: (index + 1) * 10, updatedAt: new Date() })
        .where(eq(projectNodes.id, siblings[target]!.id));
    });
  } catch (err) {
    return { ok: false, error: `Could not reorder: ${pgMessage(err)}` };
  }

  revalidatePlanSurfaces();
  return { ok: true };
}

/* ── Bulk edit ───────────────────────────────────────────────────────────── */

const BulkStatusSchema = z.object({
  ids: z.array(uuid).min(1).max(BULK_MAX_ROWS),
  status: z.string().trim().min(1),
});

/**
 * Set one status across the ticked rows.
 *
 * ROW BY ROW, never one UPDATE: a status is routed differently for an
 * executable row than a container, and `canSetPlanStatus` is asked about each
 * row separately. Rows the caller may not rule are SKIPPED and counted, not
 * refused as a batch — half a selection you have standing over is still worth
 * writing, and the count says what happened.
 */
export async function bulkSetPlanNodeStatus(
  input: z.input<typeof BulkStatusSchema>,
): Promise<Result<{ updated: number; skipped: number; firstError?: string }>> {
  const me = await requireUser();
  const limited = rateLimitOrError(me.id, "write");
  if (limited) return limited;

  const parsed = BulkStatusSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const { ids, status } = parsed.data;

  let updated = 0;
  let firstError: string | undefined;
  for (const id of ids) {
    const res = await applyPlanStatus(me, id, status);
    if (res.ok) updated++;
    else firstError ??= res.error;
  }
  return {
    ok: true,
    updated,
    skipped: ids.length - updated,
    ...(firstError ? { firstError } : {}),
  };
}

const BulkEditSchema = z.object({
  ids: z.array(uuid).min(1).max(BULK_MAX_ROWS),
  ownerId: uuid.nullable().optional(),
  initiatorId: uuid.nullable().optional(),
  priority: z.string().max(40).nullable().optional(),
  targetDate: z.string().nullable().optional(),
  category: z.string().max(120).nullable().optional(),
  description: z.string().max(8000).nullable().optional(),
  notes: z.string().max(8000).nullable().optional(),
  links: z.array(z.string().trim().max(2000)).max(50).nullable().optional(),
  startsAt: z.string().nullable().optional(),
  endsAt: z.string().nullable().optional(),
});

/** The hierarchy table's bulk-edit dialog, over ticked rows. */
export async function bulkUpdatePlanNodes(
  input: z.input<typeof BulkEditSchema>,
): Promise<Result<{ updated: number }>> {
  const me = await requireUser();
  const limited = rateLimitOrError(me.id, "write");
  if (limited) return limited;

  const parsed = BulkEditSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }
  const {
    ids,
    ownerId,
    initiatorId,
    priority,
    targetDate,
    category,
    description,
    notes,
    links,
    startsAt,
    endsAt,
  } = parsed.data;

  const blankToNull = (v: string | null | undefined) =>
    v === undefined ? undefined : v === null || v.trim() === "" ? null : v.trim();

  // Everything that is true of a row whatever level it sits at.
  const patch: Partial<typeof projectNodes.$inferInsert> = { updatedAt: new Date() };
  if (ownerId !== undefined) patch.ownerId = ownerId;
  if (initiatorId !== undefined) patch.initiatorId = initiatorId;
  if (targetDate !== undefined) {
    patch.targetDate = targetDate ? targetDateAt(targetDate) : null;
  }
  if (category !== undefined) patch.category = blankToNull(category);
  if (description !== undefined) patch.description = blankToNull(description);
  if (links !== undefined) patch.links = sanitiseLinks(links);
  if (startsAt !== undefined) patch.startsAt = startsAt ? new Date(startsAt) : null;
  if (endsAt !== undefined) patch.endsAt = endsAt ? new Date(endsAt) : null;
  if (patch.startsAt && patch.endsAt && patch.endsAt.getTime() < patch.startsAt.getTime()) {
    return { ok: false, error: "The end date can't be before the start date." };
  }

  // CONTAINER-ONLY, for the same reason `updatePlanNode` refuses them on an
  // executable row: an action takes its priority and its notes FROM ITS TASK,
  // and a copy on the node would be free to disagree with the record of
  // truth. A mixed selection is not refused — each half gets what applies to
  // it, and the priority reaches an action through its task below.
  const containerPatch: Partial<typeof projectNodes.$inferInsert> = { ...patch };
  if (priority !== undefined) containerPatch.priority = blankToNull(priority);
  if (notes !== undefined) containerPatch.notes = blankToNull(notes);

  if (Object.keys(containerPatch).length === 1) {
    return { ok: false, error: "Nothing to change." };
  }

  const rows = await db
    .select({ id: projectNodes.id, kind: projectNodes.kind })
    .from(projectNodes)
    .where(inArray(projectNodes.id, ids));
  const execIds = rows.filter((r) => isExecutable(r.kind)).map((r) => r.id);
  const containerIds = rows.filter((r) => !isExecutable(r.kind)).map((r) => r.id);

  try {
    if (containerIds.length > 0) {
      await db
        .update(projectNodes)
        .set(containerPatch)
        .where(inArray(projectNodes.id, containerIds));
    }
    if (execIds.length > 0) {
      if (Object.keys(patch).length > 1) {
        await db.update(projectNodes).set(patch).where(inArray(projectNodes.id, execIds));
      }
      // Where an action's priority actually lives. `tasks.priority` is NOT
      // NULL, so "None" clears the containers and leaves the tasks alone
      // rather than inventing a priority to write.
      const taskPriority = blankToNull(priority);
      if (taskPriority) {
        await db
          .update(tasks)
          .set({ priority: taskPriority as TaskPriority })
          .where(and(inArray(tasks.projectNodeId, execIds), eq(tasks.archived, false)));
      }
    }
  } catch (err) {
    return { ok: false, error: `Could not save: ${pgMessage(err)}` };
  }

  revalidatePlanSurfaces();
  return { ok: true, updated: ids.length };
}

/* ── Options for the pickers ─────────────────────────────────────────────── */

/** Every level's own child kind, for the "add a …" labels. Server-safe echo of
 *  the client table so a page can label a button without importing the model. */
export async function childKindOf(kind: string): Promise<PlanKind | null> {
  return isPlanKind(kind) ? CHILD_KIND[kind] : null;
}
