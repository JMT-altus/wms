// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

let search = "";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(search),
  usePathname: () => "/tasks/kanban",
}));
vi.mock("@/app/(app)/tasks/actions", () => ({
  setTaskStatus: vi.fn(),
  setTaskApprovalStatus: vi.fn(),
  archiveTask: vi.fn(),
  unarchiveTask: vi.fn(),
}));
vi.mock("@/app/(admin)/admin/settings/actions", () => ({ setBoardColumnOrder: vi.fn() }));
vi.mock("@/lib/toast", () => ({ fireToast: vi.fn() }));
vi.mock("@/components/tasks/task-search-context", () => ({
  useTaskSearch: () => null,
}));

import { KanbanBoard } from "@/components/tasks/kanban-board";
import { DEFAULT_ADMIN_COLUMN_ORDER } from "@/lib/kanban-columns";
import { TASK_STATUSES } from "@/db/enums";
import type { BoardTask } from "@/lib/queries/tasks";

const labels = Object.fromEntries(TASK_STATUSES.map((s) => [s, s])) as never;
const tones = Object.fromEntries(TASK_STATUSES.map((s) => [s, "blue"])) as never;

const task: BoardTask = {
  id: "t1",
  taskNo: 7,
  title: "Fix the invoice",
  subject: "Billing",
  client: "PACKSOL",
  description: null,
  status: "not_started",
  approvalStatus: "approved",
  priority: "not_imp_not_urgent",
  doerId: "d1",
  doerName: "Asha Rao",
  archived: false,
  dueAt: new Date("2026-10-20T00:00:00Z"),
  updatedAt: new Date("2026-10-12T00:00:00Z"),
  completedAt: null,
};

function board() {
  return render(
    <KanbanBoard
      tasks={[task]}
      goals={[]}
      labels={labels}
      tones={tones}
      isAdmin
      today="2026-10-13"
      columnOrder={DEFAULT_ADMIN_COLUMN_ORDER}
    />,
  );
}

afterEach(() => {
  cleanup();
  search = "";
  window.history.replaceState(null, "", "/");
});

describe("Kanban Doer / Initiator switch", () => {
  it("opens on the doer's columns only, with Doer selected", () => {
    board();
    expect(screen.getByText("Doer status")).toBeTruthy();
    expect(screen.queryByText("Initiator status")).toBeNull();
    expect(screen.getByRole("tab", { name: "Doer" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tab", { name: "Initiator" }).getAttribute("aria-selected")).toBe("false");
  });

  it("switching to Initiator replaces the columns, it does not just rename them", () => {
    board();
    fireEvent.click(screen.getByRole("tab", { name: "Initiator" }));
    expect(screen.getByText("Initiator status")).toBeTruthy();
    expect(screen.queryByText("Doer status")).toBeNull();
    expect(screen.getByRole("tab", { name: "Initiator" }).getAttribute("aria-selected")).toBe("true");
    // The same task is still on the board, now under its ruling (approved).
    const ruled = screen.getByLabelText("Initiator status");
    expect(within(ruled).getAllByText("Fix the invoice").length).toBe(1);
    fireEvent.click(screen.getByRole("tab", { name: "Doer" }));
    expect(screen.getByText("Doer status")).toBeTruthy();
    expect(screen.queryByText("Initiator status")).toBeNull();
  });

  it("keeps the choice in the URL without disturbing other parameters", () => {
    window.history.replaceState(null, "", "/tasks/kanban?start=2026-01-01&view=doer");
    board();
    fireEvent.click(screen.getByRole("tab", { name: "Initiator" }));
    const sp = new URLSearchParams(window.location.search);
    expect(sp.get("side")).toBe("initiator");
    expect(sp.get("start")).toBe("2026-01-01");
    expect(sp.get("view")).toBe("doer");
  });

  it("opens on the initiator's columns when the URL says so", () => {
    search = "side=initiator";
    board();
    expect(screen.getByText("Initiator status")).toBeTruthy();
    expect(screen.queryByText("Doer status")).toBeNull();
  });

  it("only the selected half's columns are drop targets on screen", () => {
    board();
    const doer = screen.getByLabelText("Doer status");
    expect(within(doer).getAllByText("not_started").length).toBeGreaterThan(0);
    // The doer view buckets by the doer's status, so the card is here too.
    expect(within(doer).getAllByText("Fix the invoice").length).toBe(1);
    expect(screen.queryByLabelText("Initiator status")).toBeNull();
  });
});
