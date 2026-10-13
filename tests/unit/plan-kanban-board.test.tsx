// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup, screen, within } from "@testing-library/react";
import type { PlanNode } from "@/lib/queries/plan";
import type { PlanViewer } from "@/lib/plan/viewer";
import type { PlanCounts } from "@/lib/plan/table";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/project-plan/kanban",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/app/(project)/project-plan/actions", () => ({}));

import { PlanKanban, boardRefs, doerColumnFor, initiatorColumnFor } from "@/components/plan/plan-kanban";
import { PlanToolbar } from "@/components/plan/plan-toolbar";

afterEach(cleanup);

function node(over: Partial<PlanNode>): PlanNode {
  return {
    id: "n", name: "Row", kind: "project", parentId: null, sortOrder: 0,
    description: null, notes: null, targetDate: null, ownerId: null, ownerName: null,
    initiatorName: null, createdById: null, category: null, purpose: null,
    durationMinutes: null, startsAt: null, endsAt: null, status: null,
    approvalStatus: null, progressPercent: null, clientName: null, subject: null,
    priority: null, initiatorId: null, tags: null, links: null, task: null,
    attachmentCount: 0, children: [],
    ...over,
  } as unknown as PlanNode;
}
const task = (status: string) =>
  ({ id: "t", shortId: null, taskNo: 1, title: "t", status, priority: "imp_not_urgent", doerId: null,
     doerName: null, initiatorId: null, dueAt: "2026-10-08", startsAt: null, endsAt: null,
     estimatedMinutes: null, loggedSeconds: 0, updatedAt: "2026-10-08T00:00:00Z" }) as unknown as PlanNode["task"];

/** A plan with every kind of row, mirroring how the real board is populated. */
function plan(): PlanNode[] {
  const action = node({ id: "a1", name: "New action", kind: "action", parentId: "r1" });                 // no task → not scheduled
  const action2 = node({ id: "a2", name: "Order bricks", kind: "action", parentId: "r1", task: task("dont_know") });
  const sub = node({ id: "s1", name: "Get quotes", kind: "sub_action", parentId: "a2" });                // no task → not scheduled
  action2.children = [sub];
  const result = node({ id: "r1", name: "Plinth poured", kind: "result", parentId: "m1", children: [action, action2] });
  const milestone = node({ id: "m1", name: "Foundation", kind: "milestone", parentId: "p1", children: [result] });
  const milestone2 = node({ id: "m2", name: "Roof", kind: "milestone", parentId: "p1", status: "dont_know" as PlanNode["status"] });
  const project = node({ id: "p1", name: "Alpha House", kind: "project", children: [milestone, milestone2] });
  const ruled = node({ id: "p2", name: "Beta Office", kind: "project", approvalStatus: "not_approved" as PlanNode["approvalStatus"] });
  return [project, ruled];
}
const viewer: PlanViewer = { id: "v", name: "V", isAdmin: true, downlineIds: [] };
const board = (tree = plan(), props: Partial<React.ComponentProps<typeof PlanKanban>> = {}) =>
  render(<PlanKanban tree={tree} viewer={viewer} query="" projectId={null} {...props} />);

/** The cards in one column, found by the column's heading. */
function column(name: string): HTMLElement {
  const heading = screen.getAllByText(name).find((e) => e.closest("[class*='rounded-section']"));
  return heading!.closest("[class*='rounded-section']") as HTMLElement;
}
const cardsIn = (col: HTMLElement) => col.querySelectorAll("article");
/** A card's own title, not a parent path that happens to repeat a name. */
const titlesIn = (root: ParentNode) =>
  [...root.querySelectorAll("article p.line-clamp-2")].map((p) => p.textContent);
const cardOf = (name: string): HTMLElement | null =>
  ([...document.querySelectorAll("article")].find(
    (a) => a.querySelector("p.line-clamp-2")?.textContent === name,
  ) as HTMLElement | undefined) ?? null;

describe("the board shows every kind of row together — on purpose", () => {
  it("files each kind by its own status: containers by their working status, work by its task", () => {
    board();
    // The unscheduled work: an action and a sub-action with no task yet.
    const unscheduled = column("Not scheduled");
    expect(cardsIn(unscheduled)).toHaveLength(2);
    expect(titlesIn(unscheduled).sort()).toEqual(["Get quotes", "New action"]);
    // A task reported "Not Read", and a milestone marked Not Read.
    expect(titlesIn(column("Not Read")).sort()).toEqual(["Order bricks", "Roof"]);
    // Untouched containers are Not Started — the model's default, not a guess.
    expect(titlesIn(column("Not Started")).sort()).toEqual(
      ["Alpha House", "Beta Office", "Foundation", "Plinth poured"],
    );
  });

  it("puts every row in exactly ONE doer column — no duplicates, and the counts add up", () => {
    const { container } = board();
    const total = 8; // 2 projects, 2 milestones, 1 result, 2 actions, 1 sub-action
    expect(container.querySelectorAll("article")).toHaveLength(total);
    const ids = [...container.querySelectorAll("article")].map((a) => a.querySelector("p")!.textContent);
    expect(new Set(ids).size).toBe(total);
    // The numbers in the column headers sum to the rows on the board.
    const counts = [...container.querySelectorAll("section[aria-label='Doer status'] > div:last-child > div")].map(
      (c) => Number(c.querySelector("span.ml-auto")?.textContent ?? 0),
    );
    expect(counts.reduce((a, b) => a + b, 0)).toBe(total);
  });

  it("labels every card with its kind, its reference, its title and where it sits", () => {
    board();
    const bricks = cardOf("Order bricks")!;
    expect(within(bricks).getByText("Action")).toBeTruthy(); // the kind
    expect(within(bricks).getByText("A2")).toBeTruthy(); // the reference (second action under its result)
    expect(within(bricks).getByText("Alpha House / Foundation / Plinth poured")).toBeTruthy(); // the parents
    const quotes = cardOf("Get quotes")!;
    expect(within(quotes).getByText("Sub-Action")).toBeTruthy();
    expect(within(quotes).getByText("SA2.1")).toBeTruthy();
    const project = cardOf("Alpha House")!;
    expect(within(project).getByText("Project")).toBeTruthy();
    expect(within(project).getByText("P1")).toBeTruthy();
  });

  it("gives the whole traceability path in the reference's tooltip", () => {
    board();
    const ref = screen.getByText("SA2.1");
    expect(ref.getAttribute("title")).toBe("P1M1RAA2SA1");
  });

  it("the existing chip filter still narrows the board to one kind", () => {
    board(plan(), { chip: "milestone" });
    expect(cardOf("Alpha House")).toBeNull();
    expect(titlesIn(document.body).sort()).toEqual(["Foundation", "Roof"]);
    cleanup();
    board(plan(), { chip: "unscheduled" });
    expect(screen.getAllByRole("article")).toHaveLength(2);
  });

  it("search and the project filter still narrow it", () => {
    board(plan(), { query: "bricks" });
    expect(screen.getAllByRole("article").length).toBe(1);
    cleanup();
    board(plan(), { projectId: "p2" });
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(cardOf("Beta Office")).toBeTruthy();
  });
});

describe("Doer / Initiator", () => {
  it("opens on Doer; Initiator shows only rows somebody has ruled on, in their ruling's column", () => {
    board();
    expect(screen.getByRole("radio", { name: "Doer" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("radio", { name: "Initiator" }));
    expect(screen.getByLabelText("Initiator status")).toBeTruthy();
    expect(screen.queryByLabelText("Doer status")).toBeNull();
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(titlesIn(column("Not Approved"))).toEqual(["Beta Office"]);
  });

  it("the two halves read different fields", () => {
    const ruled = node({ id: "x", kind: "project", status: "initiated" as PlanNode["status"], approvalStatus: "approved" as PlanNode["approvalStatus"] });
    expect(doerColumnFor(ruled)).toBe("initiated"); // the report survives the ruling…
    expect(initiatorColumnFor(ruled)).toBe("approved"); // …and the ruling has its own column
    expect(initiatorColumnFor(node({ id: "y" }))).toBeNull();
  });
});

describe("status mapping", () => {
  it("scheduling is a fact about the row, not a status", () => {
    expect(doerColumnFor(node({ kind: "action" }))).toBe("__unscheduled__");
    expect(doerColumnFor(node({ kind: "sub_action" }))).toBe("__unscheduled__");
    // A container never needs a task, so it is never "not scheduled".
    for (const kind of ["project", "milestone", "result"] as const) {
      expect(doerColumnFor(node({ kind }))).toBe("not_started");
    }
  });

  it("an executable reads its status from the task, a container from its own status", () => {
    expect(doerColumnFor(node({ kind: "action", task: task("follow_up") }))).toBe("follow_up");
    expect(doerColumnFor(node({ kind: "action", status: "done" as PlanNode["status"], task: task("initiated") }))).toBe("initiated");
    expect(doerColumnFor(node({ kind: "milestone", status: "done" as PlanNode["status"] }))).toBe("done");
  });

  it("files a task's retired status under the one it was folded into, not under Not Started", () => {
    for (const [from, to] of [
      ["follow_up_1", "follow_up"], ["follow_up_2", "follow_up"], ["follow_up_3", "follow_up"], ["need_help", "need_info"],
    ] as const) {
      expect(doerColumnFor(node({ kind: "action", task: task(from) }))).toBe(to);
    }
  });
});

describe("references", () => {
  it("numbers per kind among siblings, over the whole tree, like every other plan table", () => {
    const refs = boardRefs(plan());
    expect(refs.get("p1")!.ref).toBe("P1");
    expect(refs.get("p2")!.ref).toBe("P2");
    expect(refs.get("m1")!.ref).toBe("M1");
    expect(refs.get("m2")!.ref).toBe("M2");
    expect(refs.get("r1")!.ref).toBe("RA");
    expect(refs.get("a1")!.ref).toBe("A1");
    expect(refs.get("a2")!.ref).toBe("A2");
    expect(refs.get("s1")!.fullRef).toBe("P1M1RAA2SA1");
  });

  it("does not renumber when the board is filtered", () => {
    board(plan(), { chip: "milestone" });
    expect(screen.getByText("M2")).toBeTruthy(); // Roof is still M2 with Foundation filtered in too
    cleanup();
    board(plan(), { query: "roof" });
    expect(screen.getByText("M2")).toBeTruthy(); // …and on its own it is not suddenly M1
  });
});

describe("the page header on the board", () => {
  const counts: PlanCounts = {
    total: 8, projects: 2, milestones: 2, results: 1, actions: 3, actionsOnly: 2,
    subActions: 1, subSubActions: 0, inWms: 1, notScheduled: 2,
  };
  const header = (board: boolean) =>
    render(<PlanToolbar level="actions" board={board} counts={counts} chip={null} onChip={() => {}} onFullScreen={() => {}} />);

  it("says Project Plan, not Actions, because the board is not scoped to one level", () => {
    header(true);
    expect(screen.getByRole("heading", { level: 1, name: "Project Plan" })).toBeTruthy();
    expect(screen.getByText(/projects, milestones, results, actions and sub-actions together/)).toBeTruthy();
    const nav = screen.getByRole("navigation", { name: "Level" });
    expect(within(nav).getAllByRole("link").some((l) => l.getAttribute("aria-current") === "page")).toBe(false);
  });

  it("still names the level on the level pages, with the current tab marked", () => {
    header(false);
    expect(screen.getByRole("heading", { level: 1, name: "Actions" })).toBeTruthy();
    const nav = screen.getByRole("navigation", { name: "Level" });
    const current = within(nav).getAllByRole("link").filter((l) => l.getAttribute("aria-current") === "page");
    expect(current.map((l) => l.textContent)).toEqual(["Actions"]);
  });
});
