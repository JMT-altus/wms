// @vitest-environment jsdom
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

vi.setConfig({ testTimeout: 30_000 });

// Admin & Master Setup → Incentive Rules screens, with the server actions MOCKED. Invented data only.
const a = vi.hoisted(() => ({ save: vi.fn(), submit: vi.fn(), approve: vi.fn(), reject: vi.fn(), publish: vi.fn(), refresh: vi.fn(), push: vi.fn(), toast: vi.fn(), draft: vi.fn(), program: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: a.refresh, push: a.push }) }));
vi.mock("@/lib/toast", () => ({ fireToast: a.toast }));
vi.mock("@/app/(masters)/master-setup/incentive-rules/actions", () => ({
  saveIncentiveDraft: (...x: unknown[]) => a.save(...x),
  submitIncentiveVersion: (...x: unknown[]) => a.submit(...x),
  approveIncentiveVersion: (...x: unknown[]) => a.approve(...x),
  rejectIncentiveVersion: (...x: unknown[]) => a.reject(...x),
  publishIncentiveVersion: (...x: unknown[]) => a.publish(...x),
  withdrawIncentiveVersion: vi.fn(),
  returnIncentiveVersionToDraft: vi.fn(),
  discardIncentiveVersion: vi.fn(),
  createIncentiveDraft: (...x: unknown[]) => a.draft(...x),
  createIncentiveProgram: (...x: unknown[]) => a.program(...x),
}));

import { IncentiveVersionEditor, type EditorRights, type EditorVersion } from "@/components/admin/master/incentive-rules/version-editor";
import { IncentiveRulesHome } from "@/components/admin/master/incentive-rules/home";
import { EMPTY_CONFIG, REFERENCE_TEMPLATE, sectionsFor } from "@/lib/incentives/rules-config/spec";
import { completeConfig } from "../fixtures/incentive-config";

const VERSION: EditorVersion = { id: "11111111-1111-4111-8111-111111111111", programId: "22222222-2222-4222-8222-222222222222", programCode: "SALES-BH", programName: "Sales BH", categoryCode: "A", versionNo: 2, status: "draft", effectiveFrom: null, effectiveTo: null, rowVersion: 4, changeNote: null, rejectionReason: null, createdByName: "Sample Editor", approvedByName: null, publishedByName: null };
const ALL: EditorRights = { edit: true, submit: true, approve: true, publish: true, backdate: false, history: true };
const CHOICES = { employees: [{ id: "33333333-3333-4333-8333-333333333333", label: "Sample Rep" }], departments: [{ id: "44444444-4444-4444-8444-444444444444", label: "Sales" }], roles: ["doer", "initiator", "both"] };
const editor = (over: Partial<React.ComponentProps<typeof IncentiveVersionEditor>> = {}) =>
  render(<IncentiveVersionEditor version={VERSION} config={REFERENCE_TEMPLATE} inForce={null} published={[]} history={[]} choices={CHOICES} rights={ALL} meIsWriter={false} currentMonth="2026-11-01" {...over} />);

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("the version editor", () => {
  it("has a tab for each of the eleven sections, a preview and the history; lists what isn't configured; badges each setting's source", () => {
    editor();
    const tabs = screen.getAllByRole("tab").map((t) => t.textContent!.replace(/\d+$/, ""));
    expect(tabs).toEqual([...sectionsFor("A").map((s) => s.label), "Preview", "History"]); // a Category A version: its eleven sections
    const missing = screen.getByRole("region", { name: "Not yet configured" });
    expect(missing.textContent).toMatch(/must be chosen before it can be submitted/);
    expect(within(missing).getByText(/Sales are counted from \(General Eligibility\) isn't set\./)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Submit for Rules Approval" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Save draft" }) as HTMLButtonElement).disabled).toBe(true); // nothing changed yet
    fireEvent.click(screen.getByRole("tab", { name: /Monthly Sales Thresholds/ }));
    expect((screen.getByLabelText("Monthly sales threshold") as HTMLInputElement).value).toBe("10000000");
    expect(screen.getByText("From the PDF")).toBeTruthy();
    expect(screen.getByText("Business decision")).toBeTruthy();
  });

  it("an edit enables Save, and the whole configuration is sent with the row version it read", async () => {
    a.save.mockResolvedValue({ ok: true, rowVersion: 5, missing: 10 });
    editor();
    fireEvent.change(screen.getByLabelText("Amount counted"), { target: { value: "taxable" } });
    fireEvent.change(screen.getByLabelText("Change note"), { target: { value: "Taxable value agreed" } });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(a.save).toHaveBeenCalledTimes(1));
    const sent = a.save.mock.calls[0]![0];
    expect(sent).toMatchObject({ versionId: VERSION.id, expectedRowVersion: 4, changeNote: "Taxable value agreed" });
    expect(sent.config.settings["basis.amount"]).toBe("taxable");
    expect(sent.config.slabs).toHaveLength(3);
    await waitFor(() => expect(a.refresh).toHaveBeenCalled());
  });

  it("a wrong value is caught as you type and Save stays off", () => {
    editor();
    fireEvent.click(screen.getByRole("tab", { name: /Incentive Slabs/ }));
    fireEvent.change(screen.getByLabelText("Slab 2 from"), { target: { value: "11000000" } }); // ₹1.1 Cr: inside slab 1
    expect(screen.getByRole("region", { name: "Not yet configured" }).textContent).toMatch(/Slabs 1 and 2 overlap/);
    fireEvent.change(screen.getByLabelText("Slab 2 from"), { target: { value: "1000" } }); // below slab 1
    expect(screen.getByRole("region", { name: "Not yet configured" }).textContent).toMatch(/Slabs must be in order/);
    expect((screen.getByRole("button", { name: "Save draft" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Slab 1 rate"), { target: { value: "abc" } });
    expect(screen.getByLabelText("Slab 1 rate").getAttribute("aria-invalid")).toBe("true");
  });

  it("a complete draft can be submitted", async () => {
    a.submit.mockResolvedValue({ ok: true, rowVersion: 5 });
    editor({ config: completeConfig() });
    expect(screen.queryByRole("region", { name: "Not yet configured" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Submit for Rules Approval" }));
    await waitFor(() => expect(a.submit).toHaveBeenCalledWith({ versionId: VERSION.id, expectedRowVersion: 4 }));
  });

  it("someone who wrote the version can't approve or reject it; someone else approves with a note or rejects with a reason", async () => {
    const submitted = { ...VERSION, status: "submitted" as const };
    const { unmount } = editor({ version: submitted, config: completeConfig(), meIsWriter: true });
    expect((screen.getByRole("button", { name: "Approve rules" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "Reject rules" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/someone else must approve it/)).toBeTruthy();
    expect(screen.queryByLabelText("Change note")).toBeNull(); // a submitted version isn't editable
    unmount();
    a.reject.mockResolvedValue({ ok: true, rowVersion: 5 });
    editor({ version: submitted, config: completeConfig() });
    fireEvent.click(screen.getByRole("button", { name: "Reject rules" }));
    const dialogReject = screen.getAllByRole("button", { name: "Reject rules" }).at(-1)!;
    expect((dialogReject as HTMLButtonElement).disabled).toBe(true); // a reason is required
    fireEvent.change(screen.getByLabelText("Reason for rejecting"), { target: { value: "Use whole rupees" } });
    fireEvent.click(dialogReject);
    await waitFor(() => expect(a.reject).toHaveBeenCalledWith({ versionId: VERSION.id, expectedRowVersion: 4, note: "Use whole rupees" }));
  });

  it("publishing: from a month; an earlier month is blocked without the back-dating right", async () => {
    a.publish.mockResolvedValue({ ok: true, rowVersion: 6, superseded: null });
    editor({ version: { ...VERSION, status: "approved" }, config: completeConfig() });
    fireEvent.click(screen.getByRole("button", { name: "Publish…" }));
    fireEvent.change(screen.getByLabelText("Effective from month"), { target: { value: "2026-10" } });
    expect(screen.getByText(/needs the “Publish from an earlier month” permission/)).toBeTruthy();
    const publish = screen.getAllByRole("button", { name: "Publish" }).at(-1)! as HTMLButtonElement;
    expect(publish.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Effective from month"), { target: { value: "2026-12" } });
    fireEvent.click(publish);
    await waitFor(() => expect(a.publish).toHaveBeenCalledWith({ versionId: VERSION.id, expectedRowVersion: 4, effectiveFrom: "2026-12-01" }));
  });

  it("a published version is read-only and offers a new draft from it; without the history right there is no History tab", () => {
    editor({ version: { ...VERSION, status: "published", effectiveFrom: "2026-12-01" }, config: completeConfig(), rights: { ...ALL, history: false } });
    expect(screen.getByText(/A published version never changes/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save draft" })).toBeNull();
    expect(screen.getByRole("button", { name: "New draft from this version" })).toBeTruthy();
    expect(screen.queryByLabelText("Amount counted")).toBeNull(); // shown as text, not an input
    expect(screen.queryByRole("tab", { name: "History" })).toBeNull();
  });

  it("the preview says which version applies to a month and what differs from the one in force, calculating nothing", () => {
    editor({
      config: completeConfig(),
      inForce: { versionNo: 1, config: { ...completeConfig(), settings: { ...completeConfig().settings, "slabs.method": "flat" } } },
      published: [{ id: "a", versionNo: 1, effectiveFrom: "2026-06-01", effectiveTo: null }],
    });
    fireEvent.click(screen.getByRole("tab", { name: "Preview" }));
    expect(screen.getByRole("status").textContent).toBe("Version 1 applies to 2026-11 (2026-06-01 → open).");
    fireEvent.change(screen.getByLabelText("Preview month"), { target: { value: "2026-05" } });
    expect(screen.getByRole("status").textContent).toBe("No published version applies to 2026-05.");
    const diff = screen.getByRole("region", { name: "Differences from the version in force" });
    expect(within(diff).getByText("How slabs are applied")).toBeTruthy();
    expect(within(diff).getByText("Flat (reached slab's rate on all sales)")).toBeTruthy();
  });

  it("the history shows each step, who took it, and the settings an edit changed", () => {
    editor({
      history: [
        { eventNo: 1, action: "create", actorName: "Sample Editor", at: "2026-11-16T09:00:00.000Z", note: null, before: null, after: { status: "draft" } },
        { eventNo: 2, action: "edit", actorName: "Sample Editor", at: "2026-11-16T09:05:00.000Z", note: "Allocation chosen", before: { status: "draft", config: EMPTY_CONFIG }, after: { status: "draft", config: { ...EMPTY_CONFIG, settings: { "allocation.method": "equalPerOrder" } } } },
      ],
    });
    fireEvent.click(screen.getByRole("tab", { name: "History" }));
    const panel = screen.getByRole("tabpanel");
    expect(within(panel).getByText("Draft created")).toBeTruthy();
    expect(within(panel).getByText("Draft edited")).toBeTruthy();
    expect(within(panel).getByText("“Allocation chosen”")).toBeTruthy();
    expect(within(panel).getByText("1 setting changed")).toBeTruthy();
  });
});

describe("the programmes list", () => {
  it("shows each programme's versions and the one in force; creating needs the edit right", async () => {
    a.program.mockResolvedValue({ ok: true, programId: "p" });
    const programs = [{ id: VERSION.programId, code: "SALES-BH", name: "Sales BH", description: null, isActive: true, versions: [
      { id: "v2", categoryCode: "A", versionNo: 2, status: "draft" as const, effectiveFrom: null, effectiveTo: null, createdByName: "Sample Editor", approvedByName: null, publishedByName: null, updatedAt: "2026-11-16T00:00:00.000Z" },
      { id: "v1", categoryCode: "A", versionNo: 1, status: "published" as const, effectiveFrom: "2026-06-01", effectiveTo: null, createdByName: "Sample Editor", approvedByName: "Sample Approver", publishedByName: "Sample Publisher", updatedAt: "2026-11-16T00:00:00.000Z" },
    ] }];
    const { unmount } = render(<IncentiveRulesHome programs={programs} ready canEdit currentMonth="2026-11-01" />);
    expect(screen.getByText("In force this month: version 1")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Compare versions" }).getAttribute("href")).toBe("/master-setup/incentive-rules/compare?a=v1&b=v2");
    fireEvent.click(screen.getByRole("button", { name: /New programme/ }));
    fireEvent.change(screen.getByLabelText("Programme code"), { target: { value: "team-b" } });
    fireEvent.change(screen.getByLabelText("Programme name"), { target: { value: "Team B" } });
    fireEvent.click(screen.getByRole("button", { name: "Create programme" }));
    await waitFor(() => expect(a.program).toHaveBeenCalledWith({ code: "TEAM-B", name: "Team B", description: null }));
    unmount();
    render(<IncentiveRulesHome programs={programs} ready={false} canEdit={false} currentMonth="2026-11-01" />);
    expect(screen.getByText(/Database update 0131 needed/)).toBeTruthy();
    expect((screen.getByRole("button", { name: /New programme/ }) as HTMLButtonElement).disabled).toBe(true);
  });
});
