import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// REAL-POSTGRES tests (in-memory PGlite built from db/schema.ts — nothing reaches a shared or production
// database) for the Project module paths the hierarchy table now uses: the creation popup's server action
// (`createPlanContainer`) places exactly one row under the chosen parent with the description it was given,
// `updatePlanNode` edits that row's description only, and the tree the table renders carries each row's OWN
// description. Mocked: who is signed in, Next's cache, the rate limiter and off-request side effects.
const h = vi.hoisted(() => {
  process.env.DATABASE_URL = "postgres://nobody:nothing@db.invalid:1/never";
  return { db: null as unknown, me: null as null | Record<string, unknown> };
});

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), updateTag: vi.fn(), unstable_cache: (fn: unknown) => fn }));
vi.mock("@/lib/rate-limit", () => ({ rateLimitOrError: () => null }));
vi.mock("@/lib/after", () => ({ afterResponse: () => undefined }));
vi.mock("@/lib/supabase/admin", () => ({ getSupabaseAdmin: () => null, DOCUMENTS_BUCKET: "documents" }));
vi.mock("@/lib/google/sync", () => ({ reconcileTaskEvent: vi.fn(), removeTaskEvent: vi.fn() }));
vi.mock("@/lib/db", () => ({
  get db() {
    if (!h.db) throw new Error("test database not ready");
    return h.db;
  },
}));
vi.mock("@/lib/auth/current", () => ({
  requireUser: async () => {
    if (!h.me) throw new Error("Unauthorized");
    return h.me;
  },
  requireAdmin: async () => {
    if (!h.me?.isAdmin) throw new Error("Forbidden");
    return h.me;
  },
  getCurrentEmployee: async () => h.me,
}));

import * as schema from "@/db/schema";
import { createTestDb } from "./_pglite";

type Made = Awaited<ReturnType<typeof createTestDb>>;
let db: Made["db"];
let pg: Made["pg"];
let actions: typeof import("@/app/(project)/project-plan/actions");
let plan: typeof import("@/lib/queries/plan");

const count = async () => (await pg.query<{ n: number }>(`select count(*)::int n from project_nodes`)).rows[0]!.n;

beforeAll(async () => {
  const made = await createTestDb({
    employees: schema.employees,
    projectNodes: schema.projectNodes,
    tasks: schema.tasks,
    taskEvents: schema.taskEvents,
    taskAudience: schema.taskAudience,
    projectNodeAttachments: schema.projectNodeAttachments,
    clients: schema.clients,
    subjects: schema.subjects,
    taskTimeRollup: schema.taskTimeRollup,
  });
  db = made.db;
  pg = made.pg;
  h.db = db;
  const [me] = await db
    .insert(schema.employees)
    .values({ name: "Plan Admin", email: "plan.admin@example.test", role: "both", isAdmin: true } as typeof schema.employees.$inferInsert)
    .returning();
  h.me = me as unknown as Record<string, unknown>;
  actions = await import("@/app/(project)/project-plan/actions");
  plan = await import("@/lib/queries/plan");
}, 180_000);

afterAll(async () => {
  await pg?.close();
});

describe("creating through the popup's action: one record, under the chosen parent, with its own description", () => {
  let projectId = "";
  let milestoneId = "";

  it("a Project", async () => {
    const before = await count();
    const res = await actions.createPlanContainer({ kind: "project", parentId: null, name: "Implement automation", description: "Automate the stock and price files" });
    if (!res.ok) throw new Error(res.error);
    projectId = res.id;
    expect(await count()).toBe(before + 1);
  });

  it("a Milestone under that Project", async () => {
    const before = await count();
    const res = await actions.createPlanContainer({ kind: "milestone", parentId: projectId, name: "Automation in stock file", description: "Stock file updates itself nightly" });
    if (!res.ok) throw new Error(res.error);
    milestoneId = res.id;
    expect(await count()).toBe(before + 1);
    const [row] = (await pg.query<{ parent_id: string; kind: string }>(`select parent_id, kind from project_nodes where id = $1`, [milestoneId])).rows;
    expect(row).toEqual({ parent_id: projectId, kind: "milestone" });
  });

  it("a Result under that Milestone, with no description", async () => {
    const before = await count();
    const res = await actions.createPlanContainer({ kind: "result", parentId: milestoneId, name: "Accounts", description: "" });
    if (!res.ok) throw new Error(res.error);
    expect(await count()).toBe(before + 1);
    const [row] = (await pg.query<{ parent_id: string; kind: string }>(`select parent_id, kind from project_nodes where id = $1`, [res.id])).rows;
    expect(row).toEqual({ parent_id: milestoneId, kind: "result" });
  });

  it("refuses a level under the wrong parent and writes nothing", async () => {
    const before = await count();
    const res = await actions.createPlanContainer({ kind: "result", parentId: projectId, name: "Misplaced" });
    expect(res.ok).toBe(false);
    expect(await count()).toBe(before);
  });

  it("the tree the table renders carries each row's OWN description; a row without one has none (shown as —)", async () => {
    const tree = await plan.listPlanTree();
    const p = tree.find((n) => n.id === projectId)!;
    const m = p.children.find((n) => n.id === milestoneId)!;
    const r = m.children.find((n) => n.name === "Accounts")!;
    expect(p.description).toBe("Automate the stock and price files");
    expect(m.description).toBe("Stock file updates itself nightly");
    expect(r.description ?? null).toBeNull(); // not the parent's description
  });

  it("editing a description changes only that row", async () => {
    const res = await actions.updatePlanNode({ id: milestoneId, description: "Stock and price files update nightly" });
    expect(res.ok).toBe(true);
    const tree = await plan.listPlanTree();
    const p = tree.find((n) => n.id === projectId)!;
    const m = p.children.find((n) => n.id === milestoneId)!;
    expect(m.description).toBe("Stock and price files update nightly");
    expect(p.description).toBe("Automate the stock and price files");
    // An edit that doesn't send a description keeps it.
    expect((await actions.updatePlanNode({ id: milestoneId, name: "Automation in stock file (v2)" })).ok).toBe(true);
    expect((await plan.listPlanTree()).find((n) => n.id === projectId)!.children.find((n) => n.id === milestoneId)!.description).toBe("Stock and price files update nightly");
  });
});
