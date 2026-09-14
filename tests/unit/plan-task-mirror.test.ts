import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The RETURN LEG of the plan ↔ task link (`lib/plan/task-sync.ts`).
 *
 * `syncNodeTask` pushes a plan row onto its task; this pushes the task back
 * onto the row. The failure it exists to prevent is silent: the two halves
 * drift, the register shows a stale date, and the next edit of any field on
 * the plan row pushes that stale date straight back over the task — undoing a
 * reschedule nobody remembers making.
 *
 * The db is a mock. A real one would test drizzle; what matters here is which
 * columns the UPDATE carries, and — the part that has two answers depending on
 * the row — whether the task's title lands on `name` or on `clientName`.
 */

// `lib/plan/task-sync.ts` starts with `import "server-only"`, which throws
// outside a React Server Component.
vi.mock("server-only", () => ({}));

const setMock = vi.fn(() => ({ where: whereMock }));
const whereMock = vi.fn(async () => undefined);
const updateMock = vi.fn(() => ({ set: setMock }));
const taskFindFirst = vi.fn();
const nodeFindFirst = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    update: updateMock,
    query: {
      tasks: { findFirst: (...a: unknown[]) => taskFindFirst(...a) },
      projectNodes: { findFirst: (...a: unknown[]) => nodeFindFirst(...a) },
    },
  },
}));
vi.mock("@/db/schema", () => ({
  projectNodes: { id: "project_nodes.id" },
  tasks: { id: "tasks.id", archived: "tasks.archived", projectNodeId: "tasks.project_node_id" },
}));
vi.mock("drizzle-orm", () => ({
  and: (...a: unknown[]) => ({ __and: a }),
  eq: (col: unknown, val: unknown) => ({ __eq: [col, val] }),
  inArray: (col: unknown, vals: unknown) => ({ __in: [col, vals] }),
  isNotNull: (col: unknown) => ({ __notNull: col }),
}));

const { mirrorTaskToNode, rootProject } = await import("@/lib/plan/task-sync");

const DUE = new Date("2026-07-01T06:30:00.000Z");
const START = new Date("2026-06-20T00:00:00.000Z");
const END = new Date("2026-06-30T00:00:00.000Z");

/** A task as the mirror reads it — everything it is allowed to carry back. */
function task(over: Record<string, unknown> = {}) {
  return {
    id: "t1",
    projectNodeId: "n1",
    archived: false,
    title: "Draft the filing",
    description: "The long version",
    subject: "Compliance",
    dueAt: DUE,
    startsAt: START,
    endsAt: END,
    estimatedMinutes: 150,
    tags: ["urgent"],
    doerId: "emp-doer",
    initiatorId: "emp-init",
    ...over,
  };
}

function node(over: Record<string, unknown> = {}) {
  return { id: "n1", kind: "action", isArchived: false, clientName: null, ...over };
}

/** The column values the UPDATE actually set. */
function written(): Record<string, unknown> {
  const calls = setMock.mock.calls as unknown as [Record<string, unknown>][];
  return calls[0]?.[0] ?? {};
}

beforeEach(() => {
  updateMock.mockClear();
  setMock.mockClear();
  whereMock.mockClear();
  taskFindFirst.mockReset();
  nodeFindFirst.mockReset();
});

describe("mirrorTaskToNode", () => {
  it("carries the dates, the doer and the text back onto the plan row", async () => {
    taskFindFirst.mockResolvedValue(task());
    nodeFindFirst.mockResolvedValue(node());

    await mirrorTaskToNode("t1");

    const w = written();
    expect(w.targetDate).toBe(DUE);
    expect(w.startsAt).toBe(START);
    expect(w.endsAt).toBe(END);
    expect(w.durationMinutes).toBe(150);
    expect(w.description).toBe("The long version");
    expect(w.subject).toBe("Compliance");
    expect(w.tags).toEqual(["urgent"]);
    // The task is where the work sits, so its doer IS the row's owner.
    expect(w.ownerId).toBe("emp-doer");
    expect(w.initiatorId).toBe("emp-init");
  });

  it("never writes status, priority or notes — the task owns those", async () => {
    taskFindFirst.mockResolvedValue(task());
    nodeFindFirst.mockResolvedValue(node());

    await mirrorTaskToNode("t1");

    const w = written();
    expect(w).not.toHaveProperty("status");
    expect(w).not.toHaveProperty("approvalStatus");
    expect(w).not.toHaveProperty("priority");
    expect(w).not.toHaveProperty("notes");
  });

  it("carries the title onto the row's name, one to one", async () => {
    taskFindFirst.mockResolvedValue(task());
    nodeFindFirst.mockResolvedValue(node());

    await mirrorTaskToNode("t1");

    expect(written().name).toBe("Draft the filing");
  });

  it("never writes `clientName` — the Client column is derived, not stored", async () => {
    // A plan task's Client is the PROJECT it sits under (`rootProjectName`).
    // Writing that back would freeze today's project name into the row's
    // intake column, and the row would then stop following its own project.
    taskFindFirst.mockResolvedValue(task());
    nodeFindFirst.mockResolvedValue(node({ clientName: "Acme Ltd" }));

    await mirrorTaskToNode("t1");

    expect(written()).not.toHaveProperty("clientName");
  });

  it("writes nothing for a task with no plan row behind it", async () => {
    taskFindFirst.mockResolvedValue(task({ projectNodeId: null }));

    await mirrorTaskToNode("t1");

    expect(updateMock).not.toHaveBeenCalled();
    expect(nodeFindFirst).not.toHaveBeenCalled();
  });

  it("writes nothing for an archived task, or an archived row", async () => {
    taskFindFirst.mockResolvedValue(task({ archived: true }));
    await mirrorTaskToNode("t1");
    expect(updateMock).not.toHaveBeenCalled();

    taskFindFirst.mockResolvedValue(task());
    nodeFindFirst.mockResolvedValue(node({ isArchived: true }));
    await mirrorTaskToNode("t1");
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("writes nothing to a Project or a Milestone — those have no task", async () => {
    taskFindFirst.mockResolvedValue(task());
    for (const kind of ["project", "milestone"]) {
      nodeFindFirst.mockResolvedValue(node({ kind }));
      await mirrorTaskToNode("t1");
    }
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("mirrors a Result too — a Result carries a task by design", async () => {
    taskFindFirst.mockResolvedValue(task());
    nodeFindFirst.mockResolvedValue(node({ kind: "result" }));

    await mirrorTaskToNode("t1");

    expect(updateMock).toHaveBeenCalledTimes(1);
  });

  it("swallows a db failure — the task edit is already committed", async () => {
    taskFindFirst.mockRejectedValue(new Error("connection reset"));
    await expect(mirrorTaskToNode("t1")).resolves.toBeUndefined();
  });
});

/**
 * The Client column a plan task files itself under.
 *
 * Derived by walking up to the project, never stored — so a project rename
 * carries every task under it rather than leaving a hundred rows naming what
 * the project used to be called. The project's own CLIENT NAME, when it has
 * one, is the better answer still: "Altus Corp" is who the work is for where
 * "AICL WMS" is only what the project is called.
 */
describe("rootProject", () => {
  /** Serve a tree as the walk asks for it, one parent lookup at a time. */
  function tree(
    rows: Record<
      string,
      { name: string; kind: string; parentId: string | null; clientName?: string | null }
    >,
  ) {
    nodeFindFirst.mockImplementation(async (arg: unknown) => {
      const id = (arg as { where: { __eq: [unknown, string] } }).where.__eq[1];
      const row = rows[id];
      return row ? { id, clientName: null, ...row } : undefined;
    });
  }

  it("walks an action up to the project it sits under", async () => {
    tree({
      sa1: { name: "Collect the annexures", kind: "sub_action", parentId: "a1" },
      a1: { name: "File the return", kind: "action", parentId: "m1" },
      m1: { name: "Q1 close", kind: "milestone", parentId: "p1" },
      p1: { name: "AICL WMS", kind: "project", parentId: null },
    });

    await expect(rootProject("sa1")).resolves.toEqual({
      name: "AICL WMS",
      clientName: null,
    });
  });

  it("answers with itself when handed the project", async () => {
    tree({ p1: { name: "AICL WMS", kind: "project", parentId: null } });
    await expect(rootProject("p1")).resolves.toEqual({
      name: "AICL WMS",
      clientName: null,
    });
  });

  it("falls back to the topmost row when the branch has no project", async () => {
    // An orphaned branch still has a head, and naming it beats naming nothing.
    tree({
      a1: { name: "File the return", kind: "action", parentId: "m1" },
      m1: { name: "Q1 close", kind: "milestone", parentId: null },
    });

    await expect(rootProject("a1")).resolves.toEqual({
      name: "Q1 close",
      clientName: null,
    });
  });

  it("stops on a parent cycle instead of looping forever", async () => {
    tree({
      a1: { name: "One", kind: "action", parentId: "a2" },
      a2: { name: "Two", kind: "action", parentId: "a1" },
    });

    await expect(rootProject("a1")).resolves.toEqual({
      name: "Two",
      clientName: null,
    });
  });

  it("returns null for a row that no longer exists", async () => {
    tree({});
    await expect(rootProject("gone")).resolves.toBeNull();
  });

  it("prefers the project's CLIENT name over the project's own name", () => {
    // "Altus Corp" is who the work is for; "AICL WMS" is what the project is
    // called. The task list's Client column wants the first.
    tree({
      a1: { name: "File the return", kind: "action", parentId: "p1" },
      p1: { name: "AICL WMS", kind: "project", parentId: null, clientName: "Altus Corp" },
    });

    return expect(rootProject("a1")).resolves.toEqual({
      name: "AICL WMS",
      clientName: "Altus Corp",
    });
  });
});
