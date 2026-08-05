import "server-only";
import { cache } from "react";
import { and, eq, exists, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  designations,
  employeeDepartments,
  employees,
  projectAudience,
  projectMembers,
  projectNodes,
  taskAudience,
  tasks,
  type Employee,
} from "@/db/schema";
import { getCurrentEmployee } from "@/lib/auth/current";
import { isSuperAdmin } from "@/lib/auth/super-admin";
import { canSee, type Viewer } from "@/lib/access/visibility";

/**
 * Row-level visibility, as SQL.
 *
 * ONE predicate, applied by every read path, so the rule can't drift between
 * the task list, the board, search, exports and the dashboard. If you add a
 * query that reads `tasks`, it needs `and(..., await visibleTaskCondition())`.
 *
 * Mirrors `canSee` in lib/access/visibility.ts — that's the pure version used
 * by the UI and the tests; this is the same logic pushed into the database so
 * we filter in Postgres rather than fetching rows we must then discard.
 */

/** Resolve the viewer's identity facts once per request. */
export const getViewer = cache(async (): Promise<Viewer | null> => {
  const me = await getCurrentEmployee();
  if (!me || !me.isActive) return null;
  return viewerFor(me);
});

export const viewerFor = cache(async (me: Employee): Promise<Viewer> => {
  const [deptRows, mgmtRows] = await Promise.all([
    db
      .select({ departmentId: employeeDepartments.departmentId })
      .from(employeeDepartments)
      .where(eq(employeeDepartments.employeeId, me.id)),
    me.designationId
      ? db
          .select({ isManagement: designations.isManagement })
          .from(designations)
          .where(eq(designations.id, me.designationId))
      : Promise.resolve([] as { isManagement: boolean }[]),
  ]);

  const departmentIds = new Set(deptRows.map((d) => d.departmentId));
  // The legacy single-department FK is a backstop for anyone not yet migrated
  // onto the M2M table.
  if (me.departmentId) departmentIds.add(me.departmentId);

  return {
    id: me.id,
    isSuperAdmin: isSuperAdmin(me.email),
    isAdmin: me.isAdmin,
    isManagement: mgmtRows[0]?.isManagement ?? false,
    departmentIds: [...departmentIds],
  };
});

/**
 * The MD + admins are exempt from the "your own work only" rule and see every
 * row. One predicate so the three condition builders below can't drift apart.
 */
function seesEverything(v: Viewer): boolean {
  return v.isSuperAdmin || v.isAdmin;
}

/**
 * SQL fragment restricting `tasks` to what the viewer may see.
 *
 * Signed out returns a never-true condition rather than throwing, so a caller
 * that forgets to auth-gate leaks nothing.
 */
export async function visibleTaskCondition(
  viewer?: Viewer | null,
): Promise<SQL | undefined> {
  const v = viewer === undefined ? await getViewer() : viewer;
  if (!v) return sql`false`;
  // The MD + admins see everything; skip the predicate entirely so their
  // queries stay on the existing plans.
  if (seesEverything(v)) return undefined;

  return or(
    // On the row → always visible, whatever the setting says.
    eq(tasks.doerId, v.id),
    eq(tasks.initiatorId, v.id),
    eq(tasks.createdById, v.id),
    eq(tasks.visibility, "internal"),
    and(
      eq(tasks.visibility, "restricted"),
      exists(
        db
          .select({ one: sql`1` })
          .from(taskAudience)
          .where(
            and(
              eq(taskAudience.taskId, tasks.id),
              audienceMatches(taskAudience.kind, taskAudience.refId, v),
            ),
          ),
      ),
    ),
  );
}

/**
 * Shared audience test. Written once and reused for tasks and projects so the
 * two can't diverge — the columns differ, the logic must not.
 */
function audienceMatches(
  kindCol: typeof taskAudience.kind | typeof projectAudience.kind,
  refCol: typeof taskAudience.refId | typeof projectAudience.refId,
  v: Viewer,
): SQL | undefined {
  const arms: (SQL | undefined)[] = [and(eq(kindCol, "employee"), eq(refCol, v.id))];
  if (v.isManagement) {
    arms.push(and(eq(kindCol, "management"), isNull(refCol)));
  }
  if (v.departmentIds.length > 0) {
    arms.push(and(eq(kindCol, "department"), inArray(refCol, v.departmentIds)));
  }
  return or(...arms);
}

/**
 * The same rule as raw SQL, for the one query that can't use the builder:
 * global search is hand-written SQL over the GIN index. The table MUST be
 * aliased `t` and the audience table is referenced directly — kept beside the
 * builder version so the two are edited together.
 */
export async function rawVisibleTaskSql(viewer?: Viewer | null): Promise<SQL> {
  const v = viewer === undefined ? await getViewer() : viewer;
  if (!v) return sql`false`;
  if (seesEverything(v)) return sql`true`;

  const management = v.isManagement ? sql` OR ta.kind = 'management'` : sql``;
  const departments =
    v.departmentIds.length > 0
      ? sql` OR (ta.kind = 'department' AND ta.ref_id IN (${sql.join(
          v.departmentIds.map((d) => sql`${d}::uuid`),
          sql`, `,
        )}))`
      : sql``;

  return sql`(
    t.doer_id = ${v.id}::uuid
    OR t.initiator_id = ${v.id}::uuid
    OR t.created_by_id = ${v.id}::uuid
    OR t.visibility = 'internal'
    OR (t.visibility = 'restricted' AND EXISTS (
      SELECT 1 FROM task_audience ta
       WHERE ta.task_id = t.id
         AND ((ta.kind = 'employee' AND ta.ref_id = ${v.id}::uuid)${management}${departments})
    ))
  )`;
}

/**
 * Same rule for project ROOTS. Visibility lives on the root and is inherited,
 * so callers resolve a node's root first and test that.
 */
export async function visibleProjectRootCondition(
  viewer?: Viewer | null,
): Promise<SQL | undefined> {
  const v = viewer === undefined ? await getViewer() : viewer;
  if (!v) return sql`false`;
  if (seesEverything(v)) return undefined;

  return or(
    eq(projectNodes.ownerId, v.id),
    eq(projectNodes.createdById, v.id),
    eq(projectNodes.visibility, "internal"),
    // Members of the project see it regardless.
    exists(
      db
        .select({ one: sql`1` })
        .from(projectMembers)
        .where(
          and(
            eq(projectMembers.projectNodeId, projectNodes.id),
            eq(projectMembers.employeeId, v.id),
          ),
        ),
    ),
    and(
      eq(projectNodes.visibility, "restricted"),
      exists(
        db
          .select({ one: sql`1` })
          .from(projectAudience)
          .where(
            and(
              eq(projectAudience.projectNodeId, projectNodes.id),
              audienceMatches(projectAudience.kind, projectAudience.refId, v),
            ),
          ),
      ),
    ),
  );
}

/**
 * Single-row check for detail pages, which have already fetched the row and
 * shouldn't re-query. Uses the pure `canSee` so page and list agree.
 */
export async function canViewTask(
  task: {
    id: string;
    visibility: string;
    doerId: string | null;
    initiatorId: string;
    createdById: string | null;
  },
  viewer?: Viewer | null,
): Promise<boolean> {
  const v = viewer === undefined ? await getViewer() : viewer;
  if (!v) return false;

  const audience =
    task.visibility === "restricted"
      ? await db
          .select({ kind: taskAudience.kind, refId: taskAudience.refId })
          .from(taskAudience)
          .where(eq(taskAudience.taskId, task.id))
      : [];

  return canSee(v, {
    visibility: task.visibility as never,
    participantIds: [task.doerId, task.initiatorId, task.createdById],
    audience,
  });
}

/**
 * Ids of every employee the viewer may see tasks for — NOT used for filtering
 * (that's what the SQL predicate is for), only for the "who is on the row"
 * helpers. Exported so callers don't re-implement the participant rule.
 */
export function participantsOf(task: {
  doerId: string | null;
  initiatorId: string;
  createdById: string | null;
}): (string | null)[] {
  return [task.doerId, task.initiatorId, task.createdById];
}
