// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

// The Project module's hierarchy table (/project-plan, List view): the row "+" and New project open the SAME
// creation popup the toolbar uses (nothing is written by the click), and the Description column shows each
// row's own description. The real table and the real popup are rendered; only the server actions and the big
// shared task form are stood in for — the stand-in calls the popup's own `createOverride`, exactly as the real
// form does on submit (the server side of that path is covered by plan-create-description.db.test.ts).

globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };
Element.prototype.scrollIntoView ??= () => {};

const m = vi.hoisted(() => ({
  createPlanNode: vi.fn(),
  createPlanContainer: vi.fn(),
  createPlanNodeForTask: vi.fn(),
  refresh: vi.fn(),
}));
const anyAction = (name: string) => (name in m ? (m as Record<string, unknown>)[name] : vi.fn(async () => ({ ok: true })));
vi.mock("@/app/(project)/project-plan/actions", () => new Proxy({}, { get: (_t, k) => (k === "then" ? undefined : anyAction(String(k))), has: () => true }));
vi.mock("@/app/(project)/project-plan/attachment-actions", () => new Proxy({}, { get: (_t, k) => (k === "then" ? undefined : vi.fn(async () => ({ ok: true }))), has: () => true }));
vi.mock("@/app/(app)/tasks/actions", () => new Proxy({}, { get: (_t, k) => (k === "then" ? undefined : vi.fn(async () => ({ ok: true }))), has: () => true }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: m.refresh, push: vi.fn() }), usePathname: () => "/project-plan", useSearchParams: () => new URLSearchParams() }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));
vi.mock("@/components/tasks/new-task-form", () => ({
  NewTaskForm: (p: {
    preset?: { submitLabel?: string };
    createOverride?: (payload: Record<string, unknown>) => Promise<{ ok: boolean; id?: string }>;
    onSuccess?: (id: string) => void;
  }) => {
    const [name, setName] = (require("react") as typeof import("react")).useState("");
    const [desc, setDesc] = (require("react") as typeof import("react")).useState("");
    return (
      <div>
        <input aria-label="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <textarea aria-label="Description" value={desc} onChange={(e) => setDesc(e.target.value)} />
        <button
          type="button"
          onClick={async () => {
            if (!name.trim()) return; // the real form insists on a name
            const res = await p.createOverride!({ title: name, description: desc, notes: null, clientName: null, subject: null, priority: "imp_not_urgent", initiatorId: null, tags: [], links: [], dueAt: null });
            if (res.ok && res.id) p.onSuccess?.(res.id);
          }}
        >
          {p.preset?.submitLabel ?? "Create"}
        </button>
      </div>
    );
  },
}));

import { PlanTreeTable } from "@/components/plan/plan-tree-table";
import type { PlanNode } from "@/lib/queries/plan";

const node = (id: string, kind: PlanNode["kind"], name: string, parentId: string | null, description: string | null, children: PlanNode[] = []): PlanNode => ({
  id, name, kind, parentId, sortOrder: 0, description, notes: null, targetDate: null, ownerId: null, ownerName: null, initiatorName: null, createdById: null,
  category: null, purpose: null, durationMinutes: null, startsAt: null, endsAt: null, status: null, approvalStatus: null, progressPercent: null,
  clientName: null, subject: null, priority: null, initiatorId: null, tags: null, links: null, task: null, attachmentCount: 0, children,
});
const P = "11111111-1111-4111-8111-111111111111";
const M = "22222222-2222-4222-8222-222222222222";
const R = "33333333-3333-4333-8333-333333333333";
const tree = [
  node(P, "project", "Implement automation", null, "Automate the stock and price files", [
    node(M, "milestone", "Automation in stock file", P, null, [node(R, "result", "Accounts", M, "Accounts team signs off the file")]),
  ]),
];
const viewer = { id: "99999999-9999-4999-8999-999999999999", name: "Plan Admin", isAdmin: true, downlineIds: [] };

function renderTable() {
  return render(
    <PlanTreeTable
      tree={tree}
      viewer={viewer}
      employees={[{ id: viewer.id, name: "Plan Admin" }]}
      clients={[]}
      subjects={[]}
      query=""
      projectId={null}
      onProjectChange={() => {}}
      projects={[{ id: P, name: "Implement automation", ref: "P1" }]}
      sort="plan"
      onSortChange={() => {}}
      chip={null as never}
      maxDepth={null}
      onMaxDepthChange={() => {}}
      fullScreen={false}
      onFullScreenChange={() => {}}
      onView={() => {}}
    />,
  );
}
const rowOf = (name: string) => screen.getByText(name).closest("tr")!;

beforeEach(() => {
  window.localStorage.clear();
  m.createPlanNode.mockReset().mockResolvedValue({ ok: true, id: "new" });
  m.createPlanContainer.mockReset().mockResolvedValue({ ok: true, id: "44444444-4444-4444-8444-444444444444" });
  m.createPlanNodeForTask.mockReset();
  m.refresh.mockReset();
});
afterEach(cleanup);

describe("Description column", () => {
  it("is shown by default, beside Result / Action, with each row's OWN description and — when there is none", () => {
    renderTable();
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent?.trim());
    expect(headers.indexOf("Description")).toBe(headers.indexOf("Result / Action") + 1);
    expect(within(rowOf("Implement automation")).getByText("Automate the stock and price files")).toBeTruthy();
    const ms = rowOf("Automation in stock file");
    expect(within(ms).queryByText("Automate the stock and price files")).toBeNull(); // not the parent's
    expect(within(ms).getAllByText("—").length).toBeGreaterThan(0);
    const result = within(rowOf("Accounts")).getByText("Accounts team signs off the file");
    expect(result.getAttribute("title")).toBe("Accounts team signs off the file"); // full text on hover
  });

  it("is shown once to someone whose saved columns hid it as the old default; afterwards their own choice stands", async () => {
    window.localStorage.setItem("wms_plan_tree_columns_v1", JSON.stringify({ order: ["ref", "controls", "name", "owner", "description"], hidden: ["from", "to", "wms", "description"] }));
    renderTable();
    let headers = screen.getAllByRole("columnheader").map((h) => h.textContent?.trim());
    expect(headers.indexOf("Description")).toBe(headers.indexOf("Result / Action") + 1);
    cleanup();
    // Hiding it again and saving is respected from then on.
    const { saveColumnPrefs, REVEAL_ONCE } = await import("@/components/plan/plan-columns-store");
    expect(REVEAL_ONCE.map((r) => r.key)).toEqual(["description"]);
    saveColumnPrefs({ order: ["ref", "controls", "name", "description"], hidden: ["description"] });
    renderTable();
    headers = screen.getAllByRole("columnheader").map((h) => h.textContent?.trim());
    expect(headers).not.toContain("Description");
  });
});

describe("row + and New project open the creation popup — the click itself creates nothing", () => {
  it("+ on a Project opens New Milestone with that project chosen; closing creates nothing", async () => {
    renderTable();
    fireEvent.click(within(rowOf("Implement automation")).getByRole("button", { name: "Add a milestone" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("New Milestone")).toBeTruthy();
    expect((within(dialog).getByRole("combobox", { name: /Level/i }) as HTMLSelectElement).value).toBe("milestone");
    expect(within(dialog).getAllByRole("combobox").some((s) => (s as HTMLSelectElement).value === P)).toBe(true);
    expect(m.createPlanNode).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(m.createPlanNode).not.toHaveBeenCalled();
    expect(m.createPlanContainer).not.toHaveBeenCalled();
  });

  it("submitting creates exactly one Milestone under that project, with the description entered", async () => {
    renderTable();
    fireEvent.click(within(rowOf("Implement automation")).getByRole("button", { name: "Add a milestone" }));
    const dialog = within(await screen.findByRole("dialog"));
    fireEvent.change(dialog.getByLabelText("Name"), { target: { value: "Price list in Excel" } });
    fireEvent.change(dialog.getByLabelText("Description"), { target: { value: "Monthly price list, auto-built" } });
    fireEvent.click(dialog.getByRole("button", { name: "Create Milestone" }));
    await waitFor(() => expect(m.createPlanContainer).toHaveBeenCalledTimes(1));
    expect(m.createPlanContainer).toHaveBeenCalledWith(expect.objectContaining({ kind: "milestone", parentId: P, name: "Price list in Excel", description: "Monthly price list, auto-built" }));
    expect(m.createPlanNode).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(m.refresh).toHaveBeenCalled(); // the table reloads with the new row
  });

  it("+ on a Milestone opens New Result with project AND milestone chosen, and creates it under that milestone", async () => {
    renderTable();
    fireEvent.click(within(rowOf("Automation in stock file")).getByRole("button", { name: "Add a result" }));
    const dialog = within(await screen.findByRole("dialog"));
    expect(dialog.getByText("New Result")).toBeTruthy();
    const chosen = dialog.getAllByRole("combobox").map((s) => (s as HTMLSelectElement).value);
    expect(chosen).toEqual(expect.arrayContaining(["result", P, M]));
    fireEvent.change(dialog.getByLabelText("Name"), { target: { value: "Stock ledger" } });
    fireEvent.click(dialog.getByRole("button", { name: "Create Result" }));
    await waitFor(() => expect(m.createPlanContainer).toHaveBeenCalledWith(expect.objectContaining({ kind: "result", parentId: M, name: "Stock ledger" })));
    expect(m.createPlanContainer).toHaveBeenCalledTimes(1);
  });

  it("New project opens New Project (no parent) and nothing is created until it is submitted", async () => {
    renderTable();
    const buttons = screen.getAllByRole("button", { name: /New project/ });
    fireEvent.click(buttons[buttons.length - 1]!);
    const dialog = within(await screen.findByRole("dialog"));
    expect(dialog.getByText("New Project")).toBeTruthy();
    expect(m.createPlanNode).not.toHaveBeenCalled();
    fireEvent.change(dialog.getByLabelText("Name"), { target: { value: "Warehouse revamp" } });
    fireEvent.click(dialog.getByRole("button", { name: "Create Project" }));
    await waitFor(() => expect(m.createPlanContainer).toHaveBeenCalledWith(expect.objectContaining({ kind: "project", parentId: null, name: "Warehouse revamp" })));
    expect(m.createPlanNode).not.toHaveBeenCalled();
  });

  it("an empty submission is refused by the form and creates nothing", async () => {
    renderTable();
    fireEvent.click(within(rowOf("Implement automation")).getByRole("button", { name: "Add a milestone" }));
    const dialog = within(await screen.findByRole("dialog"));
    fireEvent.click(dialog.getByRole("button", { name: "Create Milestone" }));
    await new Promise((r) => setTimeout(r, 50));
    expect(m.createPlanContainer).not.toHaveBeenCalled();
  });

  it("+ on a Result keeps the existing Action flow (date + description prompt), unchanged", async () => {
    renderTable();
    fireEvent.click(within(rowOf("Accounts")).getByRole("button", { name: /^Add an? action$/ }));
    const dialog = within(await screen.findByRole("dialog"));
    expect(dialog.getByText("New Action")).toBeTruthy();
    expect(dialog.queryByRole("combobox", { name: /Level/i })).toBeNull(); // the small prompt, not the popup
    expect(m.createPlanNode).not.toHaveBeenCalled();
    expect(m.createPlanContainer).not.toHaveBeenCalled();
  });
});
