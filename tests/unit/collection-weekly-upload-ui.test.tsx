// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

// Admin & Master Setup → Weekly Bulk Upload: the settings and compliance view.
// The server action is MOCKED.
const a = vi.hoisted(() => ({ save: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: a.refresh }) }));
vi.mock("@/app/(masters)/master-setup/collection-weekly-upload/actions", () => ({ saveWeeklyUploadSettings: (...x: unknown[]) => a.save(...x) }));

import { WeeklyUploadManager } from "@/components/admin/master/weekly-upload-manager";
import type { WeeklyUploadOverview, WeeklyUploadWeekView } from "@/lib/queries/collection-weekly-upload";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const NOW = "2026-11-04T10:00:00.000Z";
const people = [
  { id: A, name: "Person A", email: "a@example.test", holdsPermission: true },
  { id: B, name: "Person B", email: "b@example.test", holdsPermission: false },
];
const week = (over: Partial<WeeklyUploadWeekView> = {}): WeeklyUploadWeekView => ({
  weekStart: "2026-11-02",
  taskId: "task-1",
  assigneeName: "Person A",
  dueAt: new Date("2026-11-06T06:30:00Z"),
  state: "pending",
  completedAt: null,
  completedSnapshotId: null,
  completedFileName: null,
  completedByName: null,
  ...over,
});
const overview = (over: Partial<WeeklyUploadOverview> = {}): WeeklyUploadOverview => ({
  storageReady: true,
  settings: { storageReady: true, assigneeId: A, dueDow: 5, setById: null, updatedAt: null },
  assignee: { ...people[0]!, isActive: true, isAdmin: true },
  people,
  currentWeek: week(),
  lastCompleted: week({ weekStart: "2026-10-26", taskId: "task-0", state: "completed", completedAt: new Date("2026-10-30T09:00:00Z"), completedFileName: "Collection 301026.xls", completedByName: "Person A" }),
  recent: [week(), week({ weekStart: "2026-10-26", taskId: "task-0", state: "completed", completedAt: new Date("2026-10-30T09:00:00Z"), completedByName: "Person A" })],
  ...over,
});

afterEach(() => {
  cleanup();
  a.save.mockReset();
});

describe("Weekly Bulk Upload — admin page", () => {
  it("shows this week's task, who it is assigned to, its due date and status, the last successful upload, and links to the task and the Tracker", () => {
    render(<WeeklyUploadManager overview={overview()} now={NOW} />);
    const thisWeek = screen.getByRole("region", { name: "This week" });
    expect(thisWeek.textContent).toContain("Person A");
    expect(thisWeek.textContent).toContain("Fri, 6 Nov 2026");
    expect(within(thisWeek).getByText("Pending")).toBeTruthy();
    expect(thisWeek.textContent).toMatch(/Last successful weekly upload:.*30 Oct 2026.*Collection 301026\.xls.*by Person A/);
    expect(within(thisWeek).getByRole("link", { name: "Open task" }).getAttribute("href")).toBe("/tasks/task-1");
    expect(within(thisWeek).getByRole("link", { name: /Open the Collection Tracker/ }).getAttribute("href")).toBe("/forms/collection/tracker");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("marks an overdue week plainly in the recent list", () => {
    render(<WeeklyUploadManager overview={overview({ currentWeek: week({ state: "overdue" }), recent: [week({ state: "overdue" })] })} now={NOW} />);
    expect(screen.getAllByText("Overdue").length).toBeGreaterThan(0);
    expect(within(screen.getByRole("region", { name: "Recent weeks" })).getByText("Overdue")).toBeTruthy();
  });

  it("warns when nobody is responsible, and when the chosen person can't do the upload", () => {
    render(<WeeklyUploadManager overview={overview({ settings: { storageReady: true, assigneeId: null, dueDow: 5, setById: null, updatedAt: null }, assignee: null, currentWeek: null })} now={NOW} />);
    expect(screen.getByRole("alert").textContent).toMatch(/No employee is responsible/);
    expect(screen.getByRole("region", { name: "This week" }).textContent).toMatch(/nobody is responsible yet/);
    cleanup();
    render(<WeeklyUploadManager overview={overview({ assignee: { ...people[0]!, holdsPermission: false, isActive: true, isAdmin: true } })} now={NOW} />);
    expect(screen.getByRole("alert").textContent).toMatch(/does not hold the "Collection Tracker — Bulk Upload" permission/);
    cleanup();
    render(<WeeklyUploadManager overview={overview({ assignee: { ...people[0]!, isActive: false, isAdmin: true } })} now={NOW} />);
    expect(screen.getByRole("alert").textContent).toMatch(/deactivated/);
  });

  it("saves the chosen person and due day through the action, and says what followed", async () => {
    a.save.mockResolvedValue({ ok: true, changed: true, taskCreated: true, reassigned: 1 });
    render(<WeeklyUploadManager overview={overview()} now={NOW} />);
    const save = screen.getByRole("button", { name: "Save" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true); // nothing changed yet
    fireEvent.change(screen.getByRole("combobox", { name: "Responsible employee" }), { target: { value: B } });
    fireEvent.change(screen.getByRole("combobox", { name: "Due weekday" }), { target: { value: "3" } });
    expect(screen.getByText(/Person B doesn.t hold the/)).toBeTruthy(); // the hint, before the server refuses
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(() => expect(a.save).toHaveBeenCalledWith({ assigneeId: B, dueDow: 3 }));
    expect((await screen.findByRole("status")).textContent).toMatch(/Saved\. This week's task has been created\. 1 open task moved/);
    expect(a.refresh).toHaveBeenCalled();
  });

  it("shows the server's refusal", async () => {
    a.save.mockResolvedValue({ ok: false, error: "The assigned employee does not hold the permission." });
    render(<WeeklyUploadManager overview={overview()} now={NOW} />);
    fireEvent.change(screen.getByRole("combobox", { name: "Responsible employee" }), { target: { value: B } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect((await screen.findByRole("status")).textContent).toContain("does not hold the permission");
  });

  it("the picker lists only the given people (active admins) and flags who lacks the permission; no names are built in", () => {
    render(<WeeklyUploadManager overview={overview()} now={NOW} />);
    const options = within(screen.getByRole("combobox", { name: "Responsible employee" })).getAllByRole("option");
    expect(options.map((o) => o.textContent)).toEqual(["— nobody (no weekly task) —", "Person A", "Person B — no Bulk Upload permission"]);
  });

  it("says what is missing while migration 0121 isn't applied", () => {
    render(<WeeklyUploadManager overview={overview({ storageReady: false, settings: { storageReady: false, assigneeId: null, dueDow: 5, setById: null, updatedAt: null } })} now={NOW} />);
    expect(screen.getByRole("status").textContent).toMatch(/database update 0121/);
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });
});
