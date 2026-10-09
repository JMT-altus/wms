// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup, screen } from "@testing-library/react";
import type { PlanNode } from "@/lib/queries/plan";
import type { PlanViewer } from "@/lib/plan/viewer";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
// The board imports the server action for drops; this test never drops.
vi.mock("@/app/(project)/project-plan/actions", () => ({ setPlanNodeStatus: vi.fn() }));

import { PlanKanban } from "@/components/plan/plan-kanban";

function node(over: Partial<PlanNode>): PlanNode {
  return {
    id: "n", name: "Row", kind: "action", parentId: null, sortOrder: 0,
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
const tree = [
  node({ id: "a1", name: "Unruled action" }),
  node({ id: "a2", name: "Ruled action", approvalStatus: "not_approved" as PlanNode["approvalStatus"] }),
];

afterEach(cleanup);

describe("PlanKanban — Doer / Initiator switch", () => {
  it("opens on Doer and shows only the Doer half", () => {
    render(<PlanKanban tree={tree} viewer={viewer} query="" projectId={null} />);
    expect(screen.getByRole("radio", { name: "Doer" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByLabelText("Doer status")).toBeTruthy();
    expect(screen.queryByLabelText("Initiator status")).toBeNull();
  });

  it("switches to the Initiator half and back, without losing the cards", () => {
    render(<PlanKanban tree={tree} viewer={viewer} query="" projectId={null} />);
    fireEvent.click(screen.getByRole("radio", { name: "Initiator" }));
    expect(screen.getByRole("radio", { name: "Initiator" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByLabelText("Initiator status")).toBeTruthy();
    expect(screen.queryByLabelText("Doer status")).toBeNull();
    // The ruling stands on one row, so that row is on the Initiator board.
    expect(screen.getAllByText("Ruled action").length).toBeGreaterThan(0);
    expect(screen.queryByText("Unruled action")).toBeNull();

    fireEvent.click(screen.getByRole("radio", { name: "Doer" }));
    expect(screen.getByLabelText("Doer status")).toBeTruthy();
    // On the Doer board BOTH rows appear (each row has a doer answer).
    expect(screen.getAllByText("Ruled action").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Unruled action").length).toBeGreaterThan(0);
  });
});
