// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup, screen, within } from "@testing-library/react";
import type { PlanNode } from "@/lib/queries/plan";
import type { PlanViewer } from "@/lib/plan/viewer";
import type { PlanCounts } from "@/lib/plan/table";

const replace = vi.fn();
let viewParam: string | null = null;
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace }),
  usePathname: () => "/project-plan",
  useSearchParams: () => new URLSearchParams(viewParam ? { view: viewParam } : {}),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
// Server actions reach the database; nothing here writes.
vi.mock("@/app/(project)/project-plan/actions", () => ({}));
vi.mock("@/app/(project)/project-plan/attachment-actions", () => ({}));
vi.mock("@/app/(app)/tasks/actions", () => ({}));
vi.mock("@/app/(app)/tasks/import-actions", () => ({}));

import { PlanToolbar } from "@/components/plan/plan-toolbar";
import { PlanWorkspace } from "@/components/plan/plan-workspace";

afterEach(() => {
  cleanup();
  viewParam = null;
  replace.mockClear();
});

const counts: PlanCounts = {
  total: 49, projects: 5, milestones: 16, results: 11, actions: 17, actionsOnly: 17,
  subActions: 0, subSubActions: 0, inWms: 4, notScheduled: 13,
};

function toolbar(level: "projects" | "milestones" = "projects", over: Partial<React.ComponentProps<typeof PlanToolbar>> = {}) {
  const onChip = vi.fn();
  const onFullScreen = vi.fn();
  render(<PlanToolbar level={level} counts={counts} chip={null} onChip={onChip} onFullScreen={onFullScreen} {...over} />);
  return { onChip, onFullScreen };
}

describe("Projects page header", () => {
  it("shows a compact Projects heading with its subtitle, as the page's level-1 heading", () => {
    toolbar();
    const h = screen.getByRole("heading", { name: "Projects", level: 1 });
    expect(parseInt(h.style.fontSize, 10)).toBeLessThanOrEqual(20);
    expect(h.tagName).not.toBe("H1"); // the global h1 rule would force it back to 30-46px
    expect(screen.getByText(/Every project in the plan, with its status, progress and milestone rollup\./)).toBeTruthy();
  });

  it("follows the level: the same header says Milestones on the Milestones register", () => {
    toolbar("milestones");
    expect(screen.getByRole("heading", { name: "Milestones", level: 1 })).toBeTruthy();
  });

  it("keeps Full screen working and adds Hierarchy view as a link to Project Views", () => {
    const { onFullScreen } = toolbar();
    fireEvent.click(screen.getByRole("button", { name: /Full screen/ }));
    expect(onFullScreen).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("link", { name: /Hierarchy view/ }).getAttribute("href")).toBe("/project-plan/views");
  });
});

describe("Projects page — level tabs and count chips are unchanged in behaviour", () => {
  it("keeps all five level tabs with their routes, marks the current one, and carries ?view=", () => {
    viewParam = "register";
    toolbar();
    const nav = screen.getByRole("navigation", { name: "Level" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((l) => l.textContent)).toEqual(["Projects", "Milestones", "Results", "Actions", "Sub-Actions"]);
    expect(links.map((l) => l.getAttribute("href"))).toEqual([
      "/project-plan?view=register",
      "/project-plan/milestones?view=register",
      "/project-plan/results?view=register",
      "/project-plan/actions?view=register",
      "/project-plan/sub-actions?view=register",
    ]);
    expect(links[0]!.getAttribute("aria-current")).toBe("page");
    expect(links[1]!.getAttribute("aria-current")).toBeNull();
  });

  it("shows every count from the data and keeps each chip a filter", () => {
    const { onChip } = toolbar();
    for (const [label, n] of [
      ["Total", "49"], ["Projects", "5"], ["Milestones", "16"], ["Results", "11"],
      ["Actions", "17"], ["In WMS", "4"], ["Not scheduled", "13"],
    ] as const) {
      const chip = screen.getByRole("button", { name: new RegExp(`${n}\\s*${label}`) });
      expect(chip).toBeTruthy();
    }
    fireEvent.click(screen.getByRole("button", { name: /16\s*Milestones/ }));
    expect(onChip).toHaveBeenLastCalledWith("milestone");
    fireEvent.click(screen.getByRole("button", { name: /49\s*Total/ }));
    expect(onChip).toHaveBeenLastCalledWith(null);
  });

  it("an active chip toggles off when clicked again, and says it is pressed", () => {
    const { onChip } = toolbar("projects", { chip: "milestone" });
    const chip = screen.getByRole("button", { name: /16\s*Milestones/ });
    expect(chip.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(chip);
    expect(onChip).toHaveBeenLastCalledWith(null);
  });

  it("draws the chips as quiet pills and no longer uses red for the Projects dot", () => {
    toolbar();
    const chip = screen.getByRole("button", { name: /5\s*Projects/ });
    expect(chip.className).toMatch(/rounded-full/);
    const dot = chip.querySelector("span[aria-hidden]") as HTMLElement;
    expect(dot.style.background).not.toMatch(/E10600|225, 6, 0/i);
  });
});

describe("Projects page — the workspace", () => {
  const node = (over: Partial<PlanNode>) =>
    ({
      id: "n", name: "Row", kind: "project", parentId: null, sortOrder: 0,
      description: null, notes: null, targetDate: null, ownerId: null, ownerName: null,
      initiatorName: null, createdById: null, category: null, purpose: null,
      durationMinutes: null, startsAt: null, endsAt: null, status: null,
      approvalStatus: null, progressPercent: null, clientName: null, subject: null,
      priority: null, initiatorId: null, tags: null, links: null, task: null,
      attachmentCount: 0, children: [], ...over,
    }) as unknown as PlanNode;
  const viewer: PlanViewer = { id: "v", name: "V", isAdmin: true, downlineIds: [] };
  const tree = [node({ id: "p1", name: "Alpha House" }), node({ id: "p2", name: "Beta Office" })];

  const open = () =>
    render(
      <PlanWorkspace
        tree={tree} viewer={viewer} level="projects" employees={[]} roster={[]}
        clients={[]} subjects={[]} departments={[]}
      />,
    );

  it("keeps the search, every create button and Bulk Upload", () => {
    open();
    expect(screen.getByLabelText("Search the plan")).toBeTruthy();
    for (const name of [/Project/, /Milestone/, /Result/, /Action/, /Sub-Action/]) {
      expect(screen.getAllByRole("button", { name }).length).toBeGreaterThan(0);
    }
    expect(screen.getByRole("button", { name: /Bulk Upload/ })).toBeTruthy();
  });

  it("is drawn in navy and white for this screen, with the table framed by one hairline", () => {
    const { container } = open();
    const root = container.firstElementChild as HTMLElement;
    expect(root.hasAttribute("data-plan-calm")).toBe(true);
    expect(root.style.getPropertyValue("--plan-ink")).toBe("#14336B");
    const frame = container.querySelector(".plan-table")!.parentElement as HTMLElement;
    expect(frame.style.border).toMatch(/^1px solid/);
    expect(frame.style.border).not.toMatch(/2px|table-edge/);
  });

  it("the compact search and create buttons share one height", () => {
    open();
    const search = screen.getByLabelText("Search the plan");
    expect(search.className).toMatch(/h-9/);
    const bulk = screen.getByRole("button", { name: /Bulk Upload/ });
    expect(bulk.className).toMatch(/h-9/);
  });

  it("search still narrows the tree", () => {
    open();
    expect(screen.getByText("Alpha House")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Search the plan"), { target: { value: "beta" } });
    expect(screen.queryByText("Alpha House")).toBeNull();
    expect(screen.getByText("Beta Office")).toBeTruthy();
  });
});
