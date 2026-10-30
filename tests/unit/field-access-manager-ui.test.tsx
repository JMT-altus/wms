// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

// The permission matrix (/master-setup/access-control) with the Collection
// capabilities: grouped, sensitive rows marked, and those rows changeable only
// by a super-admin (the server action enforces it too). Actions MOCKED.
const a = vi.hoisted(() => ({ set: vi.fn(), clear: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
vi.mock("@/app/(masters)/master-setup/actions", () => ({
  setFieldPermission: (...x: unknown[]) => a.set(...x),
  clearFieldSubject: (...x: unknown[]) => a.clear(...x),
}));

import { FieldAccessManager } from "@/components/admin/master/field-access-manager";
import type { FieldMatrix } from "@/lib/queries/master-data";

const matrix: FieldMatrix = {
  people: [
    { id: "11111111-1111-4111-8111-111111111111", name: "Asha", email: "asha@example.test", isAdmin: true, isSuperAdmin: false },
    { id: "22222222-2222-4222-8222-222222222222", name: "Sam", email: "sam@example.test", isAdmin: true, isSuperAdmin: true },
  ],
  departments: [],
  grants: [],
  legacyDepartmentSensitiveGrants: [],
};
const row = (label: string) => within(screen.getByRole("table")).getByText(label).closest("tr")!;
const button = (label: string, level: "Inherit" | "Allow" | "Deny") =>
  within(row(label)).getByRole("button", { name: `${level}: ${label}` }) as HTMLButtonElement;

afterEach(() => {
  cleanup();
  a.set.mockReset();
});

describe("permission matrix — Collections", () => {
  it("lists the Collection capabilities under their own heading, marking the six sensitive ones", () => {
    render(<FieldAccessManager matrix={matrix} />);
    expect(screen.getByRole("rowheader", { name: "Collections" })).toBeTruthy();
    // 6 Collection capabilities (incl. the Tracker's Bulk Upload) + the 3 Leave approvals ones, all explicit-grant-only.
    expect(within(screen.getByRole("table")).getAllByText("Sensitive")).toHaveLength(9);
    for (const l of ["Collections — Assign Sales Coordinator", "Collections — View commitments", "Collections — Record commitments", "Collections — Review escalations", "Collections — Close escalations", "Collection Tracker — Bulk Upload"]) {
      expect(within(row(l)).getByText("Sensitive")).toBeTruthy();
    }
    expect(within(row("Collections — Escalate for review")).queryByText("Sensitive")).toBeNull();
  });

  it("Collection Tracker — Bulk Upload: a super-admin grants and revokes it per person through the matrix; nobody else can", async () => {
    const LABEL = "Collection Tracker — Bulk Upload";
    const asha = matrix.people[0]!; // an admin, not a super-admin
    // A plain admin sees the row but cannot change it — not even for themselves.
    render(<FieldAccessManager matrix={matrix} canManageSensitive={false} />);
    fireEvent.click(screen.getByRole("button", { name: "One person" }));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: asha.id } });
    expect(within(row(LABEL)).getByText(/Bulk Upload in the Collection Tracker/)).toBeTruthy();
    expect(button(LABEL, "Allow").disabled).toBe(true);
    expect(within(row(LABEL)).getByText("Not allowed")).toBeTruthy();
    cleanup();

    // A super-admin: pick the person, Allow → the grant is saved for that person by the registry key.
    a.set.mockResolvedValue({ ok: true });
    render(<FieldAccessManager matrix={matrix} canManageSensitive />);
    fireEvent.click(screen.getByRole("button", { name: "One person" }));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: asha.id } });
    expect(within(row(LABEL)).getByText("Not allowed")).toBeTruthy(); // admin status implies nothing
    // The buttons are disabled while a save is in flight, so wait for each one to settle.
    const settled = () => waitFor(() => expect(button(LABEL, "Inherit").disabled).toBe(false));
    fireEvent.click(button(LABEL, "Allow"));
    expect(a.set).toHaveBeenLastCalledWith("collection.balances.import", "employee", asha.id, true);
    expect(within(row(LABEL)).getByText("Allowed")).toBeTruthy();
    await settled();
    // Revoke: Inherit clears the row (back to the default, denied) …
    fireEvent.click(button(LABEL, "Inherit"));
    expect(a.set).toHaveBeenLastCalledWith("collection.balances.import", "employee", asha.id, null);
    expect(within(row(LABEL)).getByText("Not allowed")).toBeTruthy();
    await settled();
    // … and Deny records an explicit refusal.
    fireEvent.click(button(LABEL, "Deny"));
    expect(a.set).toHaveBeenLastCalledWith("collection.balances.import", "employee", asha.id, false);
    expect(within(row(LABEL)).getByText("Not allowed")).toBeTruthy();
  });

  it("lists the Leave approvals capabilities under their own heading, all sensitive, and not for departments", () => {
    render(<FieldAccessManager matrix={matrix} canManageSensitive />);
    expect(screen.getByRole("rowheader", { name: "Leave approvals" })).toBeTruthy();
    for (const l of ["Leave approvals — View queue", "Leave approvals — Approve or reject", "Leave approvals — Act on any request"]) {
      expect(within(row(l)).getByText("Sensitive")).toBeTruthy();
      expect(button(l, "Allow").disabled).toBe(false); // a super-admin may grant them to a person
    }
    cleanup();
    const DEPT = "33333333-3333-4333-8333-333333333333";
    render(<FieldAccessManager matrix={{ ...matrix, departments: [{ id: DEPT, name: "Ops" }] }} canManageSensitive />);
    fireEvent.click(screen.getByRole("button", { name: "A department" }));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: DEPT } });
    expect(within(row("Leave approvals — View queue")).getByText(/Not available for departments/)).toBeTruthy();
    expect(button("Leave approvals — View queue", "Allow").disabled).toBe(true);
  });

  it("for a non-super-admin, sensitive rows are locked (and say why); ordinary rows stay editable", () => {
    render(<FieldAccessManager matrix={matrix} canManageSensitive={false} />);
    expect(button("Collections — View commitments", "Allow").disabled).toBe(true);
    expect(within(row("Collections — View commitments")).getByText("Only a super-admin can change this.")).toBeTruthy();
    expect(button("Collections — Escalate for review", "Allow").disabled).toBe(false);
    expect(button("Enquiry — Average Rate", "Allow").disabled).toBe(false);
  });

  it("a super-admin can set them; the preview never shows admin or super-admin as automatically allowed", () => {
    render(<FieldAccessManager matrix={matrix} canManageSensitive />);
    fireEvent.click(screen.getByRole("button", { name: "One person" }));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: matrix.people[1]!.id } }); // a super-admin
    expect(within(row("Collections — View commitments")).getByText("Not allowed")).toBeTruthy();
    expect(within(row("Collections — Escalate for review")).getByText("Allowed")).toBeTruthy();
    expect(within(row("Enquiry — Average Rate")).getByText("Can edit")).toBeTruthy(); // original rows keep their wording
    a.set.mockResolvedValue({ ok: true });
    fireEvent.click(button("Collections — View commitments", "Allow"));
    expect(a.set).toHaveBeenCalledWith("collection.commitments.view", "employee", matrix.people[1]!.id, true);
    expect(within(row("Collections — View commitments")).getByText("Allowed")).toBeTruthy();
  });
});

describe("permission matrix — sensitive permissions have no department layer", () => {
  const DEPT = "33333333-3333-4333-8333-333333333333";
  const withLegacy: FieldMatrix = {
    ...matrix,
    departments: [{ id: DEPT, name: "Accounts" }],
    grants: [
      { fieldKey: "collection.commitments.view", subjectType: "department", subjectId: DEPT, allowed: true },
      { fieldKey: "collection.followup.write", subjectType: "department", subjectId: DEPT, allowed: false },
    ],
    legacyDepartmentSensitiveGrants: [{ fieldKey: "collection.commitments.view", departmentId: DEPT, departmentName: "Accounts", allowed: true }],
  };
  const pickDepartment = () => {
    fireEvent.click(screen.getByRole("button", { name: "A department" }));
    fireEvent.change(screen.getByRole("combobox"), { target: { value: DEPT } });
  };
  const SENSITIVE_LABELS = [
    "Collections — Assign Sales Coordinator",
    "Collections — View commitments",
    "Collections — Record commitments",
    "Collections — Review escalations",
    "Collections — Close escalations",
  ];

  it("lists legacy department grants as ignored, for every admin", () => {
    render(<FieldAccessManager matrix={withLegacy} />);
    const note = screen.getByRole("note", { name: "Legacy department grants" });
    expect(within(note).getByText(/1 department grant for sensitive permissions is ignored/)).toBeTruthy();
    expect(within(note).getByText(/Accounts · Allow \(ignored\)/)).toBeTruthy();
  });

  it("for a department, every sensitive row is locked for Allow/Deny — for super-admins too — and explains why", () => {
    render(<FieldAccessManager matrix={withLegacy} canManageSensitive />);
    pickDepartment();
    for (const l of SENSITIVE_LABELS) {
      expect(button(l, "Allow").disabled).toBe(true);
      expect(button(l, "Deny").disabled).toBe(true);
      expect(within(row(l)).getByText(/Not available for departments/)).toBeTruthy();
    }
    // Ordinary rows stay editable for a department.
    expect(button("Collections — Follow-ups", "Allow").disabled).toBe(false);
    expect(button("Enquiry — Average Rate", "Deny").disabled).toBe(false);
  });

  it("only a super-admin can clear a legacy sensitive department row (Inherit); nobody can set a new one", () => {
    a.set.mockResolvedValue({ ok: true });
    render(<FieldAccessManager matrix={withLegacy} canManageSensitive />);
    pickDepartment();
    expect(button("Collections — View commitments", "Inherit").disabled).toBe(false); // legacy row here
    expect(button("Collections — Record commitments", "Inherit").disabled).toBe(true); // nothing to clear
    expect(within(row("Collections — View commitments")).getByText(/legacy Allow that is ignored until you clear it/)).toBeTruthy();
    fireEvent.click(button("Collections — View commitments", "Inherit"));
    expect(a.set).toHaveBeenCalledWith("collection.commitments.view", "department", DEPT, null);
    cleanup();
    render(<FieldAccessManager matrix={withLegacy} canManageSensitive={false} />);
    pickDepartment();
    expect(button("Collections — View commitments", "Inherit").disabled).toBe(true);
    expect(within(row("Collections — View commitments")).getByText(/until a super-admin clears it/)).toBeTruthy();
  });

  it("the live preview ignores the legacy department Allow but still applies an ordinary department Deny", () => {
    render(<FieldAccessManager matrix={withLegacy} />);
    pickDepartment();
    expect(within(row("Collections — View commitments")).getByText("Not allowed")).toBeTruthy();
    expect(within(row("Collections — Follow-ups")).getByText("Not allowed")).toBeTruthy();
    expect(within(row("Collections — Follow-ups")).getByText("From their department")).toBeTruthy();
  });
});
