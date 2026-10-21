import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Signed-URL authorization on a REAL (in-memory PGlite) database — nothing here
// can reach Supabase, Storage or any shared database. The Storage client is a
// spy that records every path it is asked to sign; session, module access and
// task visibility are MOCKED so each case can grant or withhold exactly one
// thing. Every refusal must happen BEFORE anything is signed.
const h = vi.hoisted(() => {
  process.env.DATABASE_URL = "postgres://nobody:nothing@db.invalid:1/never";
  return {
    db: null as unknown,
    me: null as null | { id: string; email: string; name: string; isActive: boolean; isAdmin: boolean },
    modules: new Set<string>(),
    visibleTasks: new Set<string>(),
    signed: [] as string[],
  };
});
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), updateTag: vi.fn(), revalidateTag: vi.fn(), unstable_cache: (fn: unknown) => fn }));
vi.mock("@/lib/rate-limit", () => ({ rateLimitOrError: () => null }));
vi.mock("@/lib/db", () => ({
  get db() {
    if (!h.db) throw new Error("test database not ready");
    return h.db;
  },
}));
vi.mock("@/lib/auth/current", () => ({
  getCurrentEmployee: async () => h.me,
  requireUser: async () => {
    if (!h.me?.isActive) throw new Error("NEXT_REDIRECT /login");
    return h.me;
  },
  requireAdmin: async () => {
    if (!h.me?.isActive || !h.me.isAdmin) throw new Error("Forbidden");
    return h.me;
  },
}));
vi.mock("@/lib/auth/module-access", () => ({ canAccessModule: async (m: string) => h.modules.has(m) }));
vi.mock("@/lib/auth/task-visibility", () => ({ canViewTask: async (row: { id: string }) => h.visibleTasks.has(row.id) }));
vi.mock("@/lib/supabase/admin", () => ({
  DOCUMENTS_BUCKET: "documents",
  getSupabaseAdmin: () => ({
    storage: {
      from: () => ({
        createSignedUrl: async (path: string) => {
          h.signed.push(path);
          return { data: { signedUrl: `signed:${path}` }, error: null };
        },
        createSignedUrls: async (paths: string[]) => {
          h.signed.push(...paths);
          return { data: paths.map((p) => ({ path: p, signedUrl: `signed:${p}` })), error: null };
        },
      }),
    },
  }),
}));

import * as schema from "@/db/schema";
import { createTestDb } from "./_pglite";

let pg: Awaited<ReturnType<typeof createTestDb>>["pg"];
let docs: typeof import("@/lib/queries/documents");
let taskActions: typeof import("@/app/(app)/tasks/attachment-actions");
let kyc: typeof import("@/app/(forms-module)/forms/client-kyc/actions");
let outstanding: typeof import("@/app/(app)/outstanding/actions");
let plan: typeof import("@/app/(project)/project-plan/attachment-actions");

const id: Record<string, string> = {};
const LIB_PATH = "0f9d2c5e-8a1b-4c3d-9e7f-123456789abc/handbook.pdf";
const NOT_FOUND = { ok: false, error: "Attachment not found." };

const one = async (sql: string, p: unknown[] = []) => (await pg.query<{ id: string }>(sql, p)).rows[0]!.id;
const doc = (k: string, cols: Record<string, string | null>) =>
  one(
    `insert into documents (title, task_id, customer_master_id, storage_path, link_url) values ($1, $2, $3, $4, $5) returning id`,
    [k, cols.task ?? null, cols.customer ?? null, cols.path ?? null, cols.link ?? null],
  ).then((v) => {
    id[k] = v;
  });

const asEmployee = (over: Partial<NonNullable<typeof h.me>> = {}) => {
  h.me = { id: id.emp!, email: "emp@example.test", name: "Emp", isActive: true, isAdmin: false, ...over };
};

beforeAll(async () => {
  const made = await createTestDb({
    employees: schema.employees,
    tasks: schema.tasks,
    customerMasters: schema.customerMasters,
    documents: schema.documents,
    outstandingContracts: schema.outstandingContracts,
    outstandingCollections: schema.outstandingCollections,
    outstandingAttachments: schema.outstandingAttachments,
    projectNodes: schema.projectNodes,
    projectNodeAttachments: schema.projectNodeAttachments,
  });
  pg = made.pg;
  h.db = made.db;
  id.emp = await one(`insert into employees (name, email, role) values ('Emp', 'emp@example.test', 'both') returning id`);
  id.taskSeen = await one(`insert into tasks (title, due_at, initiator_id) values ('Seen', now(), $1) returning id`, [id.emp]);
  id.taskHidden = await one(`insert into tasks (title, due_at, initiator_id) values ('Hidden', now(), $1) returning id`, [id.emp]);
  id.c1 = await one(`insert into customer_masters (name) values ('Client One') returning id`);
  id.c2 = await one(`insert into customer_masters (name) values ('Client Two') returning id`);

  // Every owner type the documents table holds.
  await doc("library", { path: LIB_PATH });
  await doc("legacyPath", { path: "legacy/old-upload.pdf" }); // ownerless, but not under a library uuid prefix
  await doc("taskFile", { task: id.taskSeen, path: `tasks/${id.taskSeen}/1-plan.pdf` });
  await doc("taskLink", { task: id.taskSeen, link: "https://drive.example.test/seen" });
  await doc("hiddenFile", { task: id.taskHidden, path: `tasks/${id.taskHidden}/1-secret.pdf` });
  await doc("hiddenLink", { task: id.taskHidden, link: "https://drive.example.test/hidden" });
  await doc("orphanFile", { path: "tasks/00000000-0000-4000-8000-000000000000/2-old.pdf" }); // task deleted → task_id SET NULL
  await doc("orphanLink", { link: "https://drive.example.test/orphan" });
  await doc("kyc1", { customer: id.c1, path: `client-kyc/${id.c1}/3-pan.pdf` });
  await doc("kyc2", { customer: id.c2, path: `client-kyc/${id.c2}/3-gst.pdf` });
  await doc("kycWrongFolder", { customer: id.c1, path: `client-kyc/${id.c2}/4-misfiled.pdf` });

  id.contract = await one(`insert into outstanding_contracts (client_name, cycle, base_amount, start_date) values ('Client One', 'monthly_bill', 1000, '2026-01-01') returning id`);
  id.collection = await one(`insert into outstanding_collections (client_name, amount, collected_at) values ('Client One', 500, '2026-02-01') returning id`);
  await pg.query(
    `insert into outstanding_attachments (owner_type, owner_id, storage_path, file_name) values
       ('contract', $1, 'outstanding/contract/aaaa/agreement.pdf', 'agreement.pdf'),
       ('contract', $1, $3, 'misplaced.pdf'),
       ('collection', $2, 'outstanding/collection/bbbb/receipt.pdf', 'receipt.pdf')`,
    [id.contract, id.collection, `client-kyc/${id.c1}/3-pan.pdf`],
  );

  id.node = await one(`insert into project_nodes (name, kind) values ('Milestone', 'milestone') returning id`);
  await pg.query(
    `insert into project_node_attachments (node_id, storage_path, file_name) values ($1, $2, 'brief.pdf'), ($1, $3, 'misplaced.pdf')`,
    [id.node, `project-nodes/${id.node}/brief.pdf`, `client-kyc/${id.c1}/3-pan.pdf`],
  );

  docs = await import("@/lib/queries/documents");
  taskActions = await import("@/app/(app)/tasks/attachment-actions");
  kyc = await import("@/app/(forms-module)/forms/client-kyc/actions");
  outstanding = await import("@/app/(app)/outstanding/actions");
  plan = await import("@/app/(project)/project-plan/attachment-actions");
}, 180_000);
afterAll(async () => {
  await pg?.close();
});
beforeEach(() => {
  asEmployee();
  h.modules = new Set();
  h.visibleTasks = new Set();
  h.signed = [];
});

describe("listDocuments — the shared library", () => {
  it("signs only library files: never task, KYC, orphaned, link or unknown-path rows", async () => {
    h.modules = new Set(["wms"]);
    const rows = await docs.listDocuments();
    expect(rows.map((r) => r.title)).toEqual(["library"]);
    expect(h.signed).toEqual([LIB_PATH]);
  });

  it("without the module, nothing is read or signed", async () => {
    expect(await docs.listDocuments()).toEqual([]);
    expect(h.signed).toEqual([]);
  });
});

describe("getAttachmentUrl — task attachments", () => {
  it("signs a file on a task the caller can see, and nothing else", async () => {
    h.visibleTasks = new Set([id.taskSeen!]);
    expect(await taskActions.getAttachmentUrl(id.taskFile!)).toEqual({ ok: true, url: `signed:tasks/${id.taskSeen}/1-plan.pdf` });
    expect(h.signed).toEqual([`tasks/${id.taskSeen}/1-plan.pdf`]);
  });

  it("returns a link on a visible task without signing anything", async () => {
    h.visibleTasks = new Set([id.taskSeen!]);
    expect(await taskActions.getAttachmentUrl(id.taskLink!)).toEqual({ ok: true, url: "https://drive.example.test/seen" });
    expect(h.signed).toEqual([]);
  });

  it("refuses — identically, before any link or URL — a hidden task's file or link, a missing owner, a deleted task, a KYC or library file, or an unknown id", async () => {
    h.visibleTasks = new Set([id.taskSeen!]);
    for (const k of ["hiddenFile", "hiddenLink", "orphanFile", "orphanLink", "library", "kyc1"]) {
      expect(await taskActions.getAttachmentUrl(id[k]!)).toEqual(NOT_FOUND);
    }
    expect(await taskActions.getAttachmentUrl("11111111-1111-4111-8111-111111111111")).toEqual(NOT_FOUND);
    expect(h.signed).toEqual([]);
  });
});

describe("getClientKycAttachmentUrl — KYC files", () => {
  it("signs a file only for the customer it belongs to, under that customer's folder", async () => {
    asEmployee({ isAdmin: true });
    expect(await kyc.getClientKycAttachmentUrl(id.kyc1!, id.c1!)).toEqual({ ok: true, url: `signed:client-kyc/${id.c1}/3-pan.pdf` });
    expect(h.signed).toEqual([`client-kyc/${id.c1}/3-pan.pdf`]);
  });

  it("refuses a mismatched customer, a misfiled path, a task or library document, and unknown ids — nothing signed", async () => {
    asEmployee({ isAdmin: true });
    expect(await kyc.getClientKycAttachmentUrl(id.kyc1!, id.c2!)).toEqual(NOT_FOUND);
    expect(await kyc.getClientKycAttachmentUrl(id.kyc2!, id.c1!)).toEqual(NOT_FOUND);
    expect(await kyc.getClientKycAttachmentUrl(id.kycWrongFolder!, id.c1!)).toEqual(NOT_FOUND);
    expect(await kyc.getClientKycAttachmentUrl(id.taskFile!, id.c1!)).toEqual(NOT_FOUND);
    expect(await kyc.getClientKycAttachmentUrl(id.library!, id.c1!)).toEqual(NOT_FOUND);
    expect(await kyc.getClientKycAttachmentUrl(id.kyc1!, "not-a-uuid")).toEqual({ ok: false, error: "Invalid id." });
    expect(h.signed).toEqual([]);
  });

  it("a non-admin gets the existing KYC refusal, before any lookup or signing", async () => {
    expect(await kyc.getClientKycAttachmentUrl(id.kyc1!, id.c1!)).toEqual({ ok: false, error: "Client KYC is restricted to admins." });
    expect(h.signed).toEqual([]);
  });
});

describe("listOutstandingAttachments — Outstanding (Sales module)", () => {
  it("without Sales module access: empty, nothing signed", async () => {
    expect(await outstanding.listOutstandingAttachments("contract", id.contract!)).toEqual([]);
    expect(h.signed).toEqual([]);
  });

  it("with access: signs only that owner's files, stored in the Outstanding folder", async () => {
    h.modules = new Set(["sales"]);
    const rows = await outstanding.listOutstandingAttachments("contract", id.contract!);
    expect(rows.map((r) => [r.fileName, r.url])).toEqual([["agreement.pdf", "signed:outstanding/contract/aaaa/agreement.pdf"]]);
    expect(h.signed).toEqual(["outstanding/contract/aaaa/agreement.pdf"]);
  });

  it("refuses an owner that doesn't exist, the wrong owner type, or an unknown type — nothing signed", async () => {
    h.modules = new Set(["sales"]);
    expect(await outstanding.listOutstandingAttachments("contract", "22222222-2222-4222-8222-222222222222")).toEqual([]);
    expect(await outstanding.listOutstandingAttachments("contract", id.collection!)).toEqual([]);
    expect(await outstanding.listOutstandingAttachments("documents" as "contract", id.contract!)).toEqual([]);
    expect(h.signed).toEqual([]);
  });
});

describe("listPlanAttachments — Project Plan", () => {
  it("without Project module access, or for a missing row: one answer, nothing signed", async () => {
    expect(await plan.listPlanAttachments(id.node!)).toEqual({ ok: false, error: "That row no longer exists." });
    h.modules = new Set(["project"]);
    expect(await plan.listPlanAttachments("33333333-3333-4333-8333-333333333333")).toEqual({ ok: false, error: "That row no longer exists." });
    expect(h.signed).toEqual([]);
  });

  it("with access: signs only files under the row's own folder (others list without a link)", async () => {
    h.modules = new Set(["project"]);
    const res = await plan.listPlanAttachments(id.node!);
    if (!res.ok) throw new Error(res.error);
    expect(res.files.map((f) => [f.fileName, f.url])).toEqual([
      ["brief.pdf", `signed:project-nodes/${id.node}/brief.pdf`],
      ["misplaced.pdf", null],
    ]);
    expect(h.signed).toEqual([`project-nodes/${id.node}/brief.pdf`]);
  });
});
