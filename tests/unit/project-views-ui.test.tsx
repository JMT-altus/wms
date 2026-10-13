// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup, screen, within } from "@testing-library/react";
import type { PlanNode } from "@/lib/queries/plan";
import type { PlanViewer } from "@/lib/plan/viewer";

const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace }),
  usePathname: () => "/project-plan/views",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
// Server actions reach the database; nothing here writes.
vi.mock("@/app/(project)/project-plan/actions", () => ({}));
vi.mock("@/app/(project)/project-plan/attachment-actions", () => ({}));
vi.mock("@/app/(app)/tasks/actions", () => ({}));

import { PlanViews } from "@/components/plan/plan-views";
import { PlanSidebar, PlanMobileNav } from "@/components/plan/plan-sidebar";

vi.mock("@/components/layout/rail-collapse", () => ({
  RAIL_WIDTH: 240,
  RAIL_WIDTH_COLLAPSED: 72,
  useRailCollapsed: () => false,
}));
vi.mock("@/components/layout/rail-toggle", () => ({ RailToggle: () => null }));

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

const viewer: PlanViewer = { id: "v", name: "Viewer", isAdmin: true, downlineIds: [] };
const tree: PlanNode[] = [
  node({
    id: "p1", name: "Alpha House", kind: "project", targetDate: "2027-03-31",
    children: [
      node({ id: "m1", name: "Foundation", kind: "milestone", parentId: "p1", children: [
        node({ id: "r1", name: "Plinth poured", kind: "result", parentId: "m1" }),
      ] }),
    ],
  }),
  node({ id: "p2", name: "Beta Office", kind: "project" }),
];

// The toolbar's Collapse, as opposed to a row's chevron (same accessible name,
// but only the chevrons carry aria-expanded).
const toolbarCollapse = () =>
  screen.getAllByRole("button", { name: "Collapse" }).find((b) => !b.hasAttribute("aria-expanded"))!;

const open = () =>
  render(<PlanViews tree={tree} viewer={viewer} employees={[{ id: "e1", name: "Asha" }]} />);

describe("Project Views — content and controls are all still there", () => {
  it("keeps the title, the subtitle and every toolbar control", () => {
    open();
    expect(screen.getByRole("heading", { name: "Project Views" })).toBeTruthy();
    expect(screen.getByText("The whole plan as one tree — open a row to see what sits under it.")).toBeTruthy();
    expect(screen.getByLabelText("Find a row")).toBeTruthy();
    expect(screen.getByLabelText("Show one project")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Expand all/ })).toBeTruthy();
    expect(toolbarCollapse()).toBeTruthy();
  });

  it("keeps the columns in their order, with both status columns", () => {
    open();
    const heads = screen.getAllByRole("columnheader").map((h) => h.textContent);
    expect(heads.slice(0, 7)).toEqual([
      "Name", "Doer Status", "Initiator Status", "Target", "Progress", "Children", "Files",
    ]);
  });

  it("keeps the hierarchy: projects open to their milestones, with the next level still closed", () => {
    open();
    expect(screen.getByText("Alpha House")).toBeTruthy();
    expect(screen.getByText("Foundation")).toBeTruthy(); // a project opens onto its milestones…
    expect(screen.queryByText("Plinth poured")).toBeNull(); // …and what is below them stays closed
    // Opening the milestone reveals its result, closing it hides it again.
    fireEvent.click(screen.getByRole("button", { name: "Expand" }));
    expect(screen.getByText("Plinth poured")).toBeTruthy();
    fireEvent.click(screen.getAllByRole("button", { name: "Collapse" }).find((b) => b.getAttribute("aria-expanded"))!);
  });

  it("Expand all and Collapse still work", () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: /Expand all/ }));
    expect(screen.getByText("Foundation")).toBeTruthy();
    expect(screen.getByText("Plinth poured")).toBeTruthy();
    fireEvent.click(toolbarCollapse());
    expect(screen.queryByText("Foundation")).toBeNull();
    expect(screen.getByText("Alpha House")).toBeTruthy();
  });

  it("search still narrows the tree", () => {
    open();
    fireEvent.change(screen.getByLabelText("Find a row"), { target: { value: "beta" } });
    expect(screen.queryByText("Alpha House")).toBeNull();
    expect(screen.getByText("Beta Office")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Find a row"), { target: { value: "zzz" } });
    expect(screen.getByText("Nothing here matches.")).toBeTruthy();
  });

  it("the project filter still writes the selected project to the URL", () => {
    open();
    const select = screen.getByLabelText("Show one project") as HTMLSelectElement;
    expect([...select.options].map((o) => o.text)).toEqual(["All projects", "P1 · Alpha House", "P2 · Beta Office"]);
    fireEvent.change(select, { target: { value: "p2" } });
    expect(replace).toHaveBeenCalled();
    expect(String(replace.mock.calls.at(-1)![0])).toContain("/project-plan/views");
  });

  it("shows target dates and child counts from the data", () => {
    open();
    expect(screen.getByText("31-Mar-2027")).toBeTruthy();
    expect(screen.getByText(/0\/1 milestone/)).toBeTruthy();
  });
});

describe("Project Views — the toolbar stays on one line", () => {
  it("puts search, project filter, Expand all and Collapse in ONE group, so a wrap can never split them", () => {
    open();
    const search = screen.getByLabelText("Find a row");
    const group = search.closest("label")!.parentElement as HTMLElement;
    const controls = [
      search.closest("label"),
      screen.getByLabelText("Show one project"),
      screen.getByRole("button", { name: /Expand all/ }),
      toolbarCollapse(),
    ];
    for (const c of controls) expect(c!.parentElement).toBe(group);
    // Single row from md up (nowrap); only a phone may wrap.
    expect(group.className).toMatch(/md:flex-nowrap/);
    expect(group.className).toMatch(/max-md:flex-wrap/);
  });

  it("keeps the title and subtitle in their own block, left of the group", () => {
    open();
    const title = screen.getByRole("heading", { name: "Project Views", level: 1 });
    const titleBlock = title.parentElement as HTMLElement;
    expect(titleBlock.textContent).toContain("The whole plan as one tree");
    const group = screen.getByLabelText("Find a row").closest("label")!.parentElement as HTMLElement;
    expect(titleBlock.contains(group)).toBe(false);
    expect(titleBlock.nextElementSibling).toBe(group);
  });
});

describe("Project Views — navy and white, thin rules", () => {
  it("scopes the plan accent to navy for this page only, not the module's red", () => {
    const { container } = open();
    const root = container.firstElementChild as HTMLElement;
    expect(root.hasAttribute("data-plan-calm")).toBe(true);
    expect(root.style.getPropertyValue("--plan-ink")).toBe("#14336B");
    expect(root.style.getPropertyValue("--plan-accent")).toMatch(/#14336B/);
    expect(root.style.getPropertyValue("--plan-ink")).not.toMatch(/E10600/i);
  });

  it("drops the heavy table frame for a single hairline, and the title is no longer oversized", () => {
    const { container } = open();
    const shell = container.querySelector(".data-grid-scroll") as HTMLElement;
    expect(shell.style.border).toMatch(/^1px solid/);
    expect(shell.style.border).not.toMatch(/2px/);
    expect(shell.style.border).not.toMatch(/table-edge/);
    expect(shell.style.background).toMatch(/#FFFFFF|rgb\(255, 255, 255\)/i);
    const h1 = screen.getByRole("heading", { name: "Project Views", level: 1 });
    expect(parseInt(h1.style.fontSize, 10)).toBeLessThanOrEqual(20);
    // Not an <h1> element: the global h1 rule would force it back to 30-46px.
    expect(h1.tagName).not.toBe("H1");
  });

  it("uses thin rules between rows and under the headings", () => {
    const { container } = open();
    const th = container.querySelector("thead th") as HTMLElement;
    const td = container.querySelector("tbody td") as HTMLElement;
    expect(th.style.borderBottom).toMatch(/^1px solid/);
    expect(td.style.borderBottom).toMatch(/^1px solid/);
    expect(th.style.borderBottom + td.style.borderBottom).not.toMatch(/2px/);
  });

  it("draws row references as quiet grey chips, not red ones", () => {
    const { container } = open();
    expect(container.querySelectorAll(".plan-chip--red")).toHaveLength(0);
    expect(container.querySelectorAll(".plan-chip").length).toBeGreaterThan(0);
  });
});

describe("Project Plan rail", () => {
  it("keeps every item, label, hint and route", () => {
    render(<PlanSidebar userName="Asha" />);
    const nav = screen.getByRole("navigation", { name: "Project Plan" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((l) => l.getAttribute("href"))).toEqual([
      "/project-plan/views", "/project-plan", "/project-plan/milestones", "/project-plan/results",
      "/project-plan/actions", "/project-plan/sub-actions", "/project-plan/kanban",
    ]);
    expect(within(nav).getByText("Project Views")).toBeTruthy();
    expect(within(nav).getByText("The whole plan as one tree")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Back to Hub/ })).toBeTruthy();
  });

  it("marks the current page selected with a pale navy-blue wash, not the red block", () => {
    render(<PlanSidebar userName="Asha" />);
    const active = screen.getByRole("link", { name: /Project Views/ });
    expect(active.getAttribute("aria-current")).toBe("page");
    expect(active.style.background).not.toMatch(/gradient|225, 6, 0|E10600/i);
    expect(active.style.background).toMatch(/rgba\(127, 176, 255/);
    // The label pill is not red either.
    const pill = screen.getByText("Project Plan", { selector: "p" });
    expect(pill.style.background).not.toMatch(/gradient|225, 6, 0/i);
  });

  it("the phone strip keeps every link and uses the same selected treatment", () => {
    render(<PlanMobileNav />);
    const links = screen.getAllByRole("link");
    expect(links.length).toBeGreaterThanOrEqual(8); // back + seven
    const active = links.find((l) => l.getAttribute("aria-current") === "page")!;
    expect(active.style.background).not.toMatch(/gradient|225, 6, 0/i);
  });
});
