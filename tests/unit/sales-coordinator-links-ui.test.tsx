// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";

// Admin Panel → Sales Coordinators: controls only for a super-admin and never on their own row; labels already linked to
// someone else can't be chosen; Save sends the state the admin saw; refusals are shown. The server's rules are tested in
// tests/integration/collection-coordinator-links.db.test.ts.
const h = vi.hoisted(() => ({ set: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: h.refresh }) }));
vi.mock("@/app/(admin)/admin/sales-coordinators/actions", () => ({ setCoordinatorLink: h.set }));

import { SalesCoordinatorLinks } from "@/components/admin/sales-coordinator-links";
import type { CoordinatorLinkRow } from "@/lib/queries/coordinator-links";

afterEach(cleanup);
beforeEach(() => {
  h.set.mockReset();
  h.refresh.mockReset();
});

const ROWS: CoordinatorLinkRow[] = [
  { employeeId: "e-me", name: "Me Super", email: "me@example.test", isAdmin: true, state: { kind: "unconfigured" } },
  { employeeId: "e-g", name: "GR", email: "g@example.test", isAdmin: true, state: { kind: "label", label: "Gauri" } },
  { employeeId: "e-s", name: "SV", email: "s@example.test", isAdmin: false, state: { kind: "unconfigured" } },
  { employeeId: "e-sys", name: "System", email: "sys@example.test", isAdmin: true, state: { kind: "none" } },
];
const LABELS = ["Gauri", "Savita"];
const view = (canEdit: boolean) => render(<SalesCoordinatorLinks storageReady rows={ROWS} labels={LABELS} canEdit={canEdit} myId="e-me" />);

describe("Sales Coordinators admin table", () => {
  it("a super-admin gets a control on every row except their own", () => {
    view(true);
    expect(screen.queryByRole("combobox", { name: "Sales Coordinator for Me Super" })).toBeNull();
    for (const n of ["GR", "SV", "System"]) expect(screen.getByRole("combobox", { name: `Sales Coordinator for ${n}` })).toBeTruthy();
  });

  it("an ordinary admin sees the links read-only", () => {
    view(false);
    expect(screen.queryAllByRole("combobox")).toHaveLength(0);
    expect(screen.getByText("Only a super-admin can change these links.")).toBeTruthy();
    expect(screen.getByText("Gauri")).toBeTruthy();
    expect(screen.getByText("Not a Sales Coordinator")).toBeTruthy();
  });

  it("a label linked to someone else can't be chosen; options are 'Not configured', 'Not a Sales Coordinator' and the master's labels", () => {
    view(true);
    const sel = screen.getByRole("combobox", { name: "Sales Coordinator for SV" }) as HTMLSelectElement;
    expect([...sel.options].map((o) => [o.textContent, o.disabled])).toEqual([
      ["Not configured", false], ["Not a Sales Coordinator", false], ["Gauri (linked to GR)", true], ["Savita", false],
    ]);
    const own = screen.getByRole("combobox", { name: "Sales Coordinator for GR" }) as HTMLSelectElement;
    expect([...own.options].find((o) => o.textContent === "Gauri")!.disabled).toBe(false);
  });

  it("Save sends the choice and the state the admin saw; success refreshes; a refusal is shown", async () => {
    view(true);
    const row = screen.getByRole("combobox", { name: "Sales Coordinator for SV" }).closest("tr")!;
    expect((within(row).getByRole("button", { name: "Save" }) as HTMLButtonElement).disabled).toBe(true); // unchanged
    fireEvent.change(within(row).getByRole("combobox"), { target: { value: "label:Savita" } });
    h.set.mockResolvedValueOnce({ ok: true, changed: true });
    await act(async () => fireEvent.click(within(row).getByRole("button", { name: "Save" })));
    expect(h.set).toHaveBeenCalledWith({ employeeId: "e-s", choice: { kind: "label", label: "Savita" }, expected: { kind: "unconfigured" } });
    expect(h.refresh).toHaveBeenCalledTimes(1);
    h.set.mockResolvedValueOnce({ ok: false, error: '"Savita" is already linked to X. Unlink it there first.' });
    await act(async () => fireEvent.click(within(row).getByRole("button", { name: "Save" })));
    expect(within(row).getByRole("alert").textContent).toMatch(/already linked/);
  });

  it("before migration 0120 the page says it's not set up", () => {
    render(<SalesCoordinatorLinks storageReady={false} rows={[]} labels={[]} canEdit myId="e-me" />);
    expect(screen.getByRole("status").textContent).toMatch(/database update 0120 is needed/);
  });
});

describe("schema and migration agree", () => {
  it("db/schema.ts declares the same table, key, unique label index and check as migration 0120", () => {
    const sql = readFileSync(resolve(__dirname, "../../db/migrations/0120_collection_coordinator_links.sql"), "utf8");
    const schema = readFileSync(resolve(__dirname, "../../db/schema.ts"), "utf8");
    for (const s of ["collection_coordinator_links", "employee_id", "coordinator_label", "set_by_id", "set_at", "collection_coordinator_links_label_uq", "collection_coordinator_links_label_not_blank_check"]) {
      expect(sql, s).toContain(s);
      expect(schema, s).toContain(s);
    }
    expect(sql).toMatch(/"employee_id" uuid PRIMARY KEY REFERENCES "employees"\("id"\) ON DELETE CASCADE/);
    expect(sql).toMatch(/WHERE "coordinator_label" IS NOT NULL/);
  });

  it("nothing links logins automatically: no code outside the admin action writes the table", () => {
    const action = readFileSync(resolve(__dirname, "../../app/(admin)/admin/sales-coordinators/actions.ts"), "utf8");
    expect(action).toMatch(/isSuperAdmin\(me\.email\)/);
    expect(action).toMatch(/employeeId === me\.id/);
    const identity = readFileSync(resolve(__dirname, "../../lib/collections/salesperson-identity.ts"), "utf8");
    expect(identity).not.toMatch(/\.(insert|update|delete)\(|employees\.name|\.email/);
  });
});
