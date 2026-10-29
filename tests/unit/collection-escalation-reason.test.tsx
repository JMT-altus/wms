// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

// The "Escalate to Mihir Sir" button and its Reason for Escalation dialog, and the
// reason on the review page. The server action is MOCKED here (the real one, and the
// real SQL, are covered in collection-review-actions.test.ts and
// tests/integration/collection-escalation-reason.db.test.ts).
const a = vi.hoisted(() => ({ escalate: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: a.refresh }) }));
vi.mock("@/app/(forms-module)/forms/collection/actions", () => ({
  escalateForReview: (...x: unknown[]) => a.escalate(...x),
  setCollectionConfirmation: vi.fn(),
}));
vi.mock("@/app/(forms-module)/forms/collection/commitments/actions", () => ({ closeEscalation: vi.fn() }));

import { ESCALATE_LABEL, EscalateControl } from "@/components/collections/review-controls";
import { CommitmentsTable, type CommitmentView } from "@/components/collections/commitments-table";
import { ESCALATION_REASON_MAX } from "@/lib/collections/review";
import { PERMISSION_FIELDS } from "@/db/enums";

const CO = "11111111-1111-4111-8111-111111111111";
beforeEach(() => {
  a.escalate.mockReset();
  a.refresh.mockReset();
});
afterEach(cleanup);

const control = (over: Partial<Parameters<typeof EscalateControl>[0]> = {}) =>
  render(<EscalateControl companyId={CO} companyName="Alpha Traders" open={null} storageReady canEscalate {...over} />);
const openDialog = async () => {
  fireEvent.click(screen.getByRole("button", { name: "Escalate Alpha Traders to Mihir Sir" }));
  return screen.findByRole("dialog");
};
const field = (dialog: HTMLElement) => within(dialog).getByLabelText(/Reason for Escalation/) as HTMLTextAreaElement;
const submit = (dialog: HTMLElement) => fireEvent.click(within(dialog).getByRole("button", { name: "Submit" }));

describe("the button", () => {
  it("reads 'Escalate to Mihir Sir' (styling and permissions unchanged)", () => {
    control();
    const btn = screen.getByRole("button", { name: "Escalate Alpha Traders to Mihir Sir" });
    expect(btn.textContent).toBe("Escalate to Mihir Sir");
    expect(ESCALATE_LABEL).toBe("Escalate to Mihir Sir");
    expect(btn.className).toContain("rounded-lg border border-hairline-strong");
  });
  it("is not offered without collection.escalation.create, and is disabled while storage isn't set up", () => {
    control({ canEscalate: false });
    expect(screen.queryByRole("button", { name: /Escalate/ })).toBeNull();
    expect(screen.getByText("Not escalated")).toBeTruthy();
    cleanup();
    control({ storageReady: false });
    expect((screen.getByRole("button", { name: /Escalate Alpha Traders/ }) as HTMLButtonElement).disabled).toBe(true);
  });
  it("the permission matrix keeps its own wording — only the button label changed", () => {
    expect(PERMISSION_FIELDS.find((f) => f.key === "collection.escalation.create")?.label).toBe("Collections — Escalate for review");
  });
});

describe("the Reason for Escalation dialog", () => {
  it("opens with a required multiline Reason for Escalation field, Cancel and Submit", async () => {
    control();
    const dialog = await openDialog();
    expect(within(dialog).getByRole("heading", { name: "Escalate to Mihir Sir" })).toBeTruthy();
    const f = field(dialog);
    expect(f.tagName).toBe("TEXTAREA");
    expect(f.getAttribute("aria-required")).toBe("true");
    expect(f.maxLength).toBe(ESCALATION_REASON_MAX);
    expect(within(dialog).getByText("*")).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Submit" })).toBeTruthy();
    expect(a.escalate).not.toHaveBeenCalled(); // opening creates nothing
  });

  it("rejects an empty or whitespace-only reason with a clear message, and creates nothing", async () => {
    control();
    const dialog = await openDialog();
    submit(dialog);
    expect((await within(dialog).findByRole("alert")).textContent).toBe("Enter a reason for escalation.");
    fireEvent.change(field(dialog), { target: { value: "   \n\t  " } });
    submit(dialog);
    expect((await within(dialog).findByRole("alert")).textContent).toBe("Enter a reason for escalation.");
    expect(field(dialog).getAttribute("aria-invalid")).toBe("true");
    expect(a.escalate).not.toHaveBeenCalled();
  });

  it("rejects a reason over 1,000 characters (even if the browser's limit is bypassed), and creates nothing", async () => {
    control();
    const dialog = await openDialog();
    fireEvent.change(field(dialog), { target: { value: "x".repeat(ESCALATION_REASON_MAX + 1) } });
    submit(dialog);
    expect((await within(dialog).findByRole("alert")).textContent).toBe("The reason can be at most 1,000 characters.");
    expect(a.escalate).not.toHaveBeenCalled();
  });

  it("a valid reason is trimmed and sent once with the company; the dialog closes and success is shown only after the server accepts", async () => {
    let resolve!: (v: unknown) => void;
    a.escalate.mockImplementation(() => new Promise((r) => (resolve = r)));
    control();
    const dialog = await openDialog();
    fireEvent.change(field(dialog), { target: { value: "  Customer disputes the invoice amount.\n" } });
    submit(dialog);
    // while the request is processing: disabled controls, no second request
    await waitFor(() => expect(within(dialog).getByRole("button", { name: "Submitting…" })).toBeTruthy());
    expect((within(dialog).getByRole("button", { name: "Submitting…" }) as HTMLButtonElement).disabled).toBe(true);
    expect((within(dialog).getByRole("button", { name: "Cancel" }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.submit(field(dialog).form!);
    fireEvent.submit(field(dialog).form!);
    expect(a.escalate).toHaveBeenCalledTimes(1);
    expect(a.escalate).toHaveBeenCalledWith({ companyId: CO, reason: "Customer disputes the invoice amount." });
    expect(screen.queryByRole("status")).toBeNull();
    resolve({ ok: true });
    expect((await screen.findByRole("status")).textContent).toBe("Escalation submitted for review.");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(a.refresh).toHaveBeenCalled();
  });

  it("a server refusal keeps the dialog open with the typed reason", async () => {
    a.escalate.mockResolvedValue({ ok: false, error: "Escalation reasons can't be stored yet (migration 0118 is pending), so nothing was escalated." });
    control();
    const dialog = await openDialog();
    fireEvent.change(field(dialog), { target: { value: "Promised date missed twice." } });
    submit(dialog);
    expect((await within(dialog).findByRole("alert")).textContent).toMatch(/migration 0118 is pending/);
    expect(field(dialog).value).toBe("Promised date missed twice.");
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("Cancel closes without sending anything", async () => {
    control();
    const dialog = await openDialog();
    fireEvent.change(field(dialog), { target: { value: "Changed my mind" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(a.escalate).not.toHaveBeenCalled();
  });

  it("an open escalation shows who and when instead of the button (unchanged)", () => {
    control({ open: { escalatedAt: new Date("2026-10-19T06:00:00Z"), escalatedByName: "Asha" } });
    expect(screen.queryByRole("button", { name: /Escalate/ })).toBeNull();
    expect(screen.getByText("Escalated")).toBeTruthy();
  });
});

describe("the review page shows each escalation's own reason", () => {
  const row = (companyId: string, companyName: string, reason: string | null): CommitmentView => ({
    companyId,
    companyName,
    collectionPerson: "MANGESH",
    amount: null,
    committedDate: null,
    recordedAt: null,
    comments: [],
    confirmation: null,
    outstanding: null,
    escalation: { id: `e-${companyId}`, escalatedAt: new Date("2026-10-27T08:05:00Z"), escalatedByName: "Asha", confirmationAtEscalation: null, reason },
  });
  it("labels the reason prominently, with the company, who escalated and the date/time (IST)", () => {
    render(
      <CommitmentsTable
        rows={[row("c-alpha", "Alpha Traders", "Customer disputes the invoice amount."), row("c-beta", "Beta Corp", "Cheque bounced twice.\nNeeds a call from management.")]}
        today="2026-10-27"
        showCommitments={false}
      />,
    );
    const alpha = screen.getByText("Alpha Traders").closest("tr")!;
    const beta = screen.getByText("Beta Corp").closest("tr")!;
    const reasonOf = (tr: HTMLElement) => tr.querySelector("[data-escalation-reason]")!;
    expect(within(reasonOf(alpha) as HTMLElement).getByText("Reason for Escalation")).toBeTruthy();
    expect(reasonOf(alpha).textContent).toBe("Reason for EscalationCustomer disputes the invoice amount.");
    expect(reasonOf(beta).textContent).toBe("Reason for EscalationCheque bounced twice.\nNeeds a call from management.");
    expect(within(alpha).getByText("Escalated by: Asha · 27-Oct-2026 · 01:35 PM IST")).toBeTruthy();
  });
  it("an escalation raised before reasons existed says so honestly — nothing is invented", () => {
    render(<CommitmentsTable rows={[row("c-old", "Old Co", null)]} today="2026-10-27" showCommitments={false} />);
    const tr = screen.getByText("Old Co").closest("tr")!;
    expect(tr.querySelector("[data-escalation-reason]")!.textContent).toBe("Reason for EscalationNot recorded (escalated before a reason was required)");
  });
  it("the reason is rendered as text, not HTML", () => {
    render(<CommitmentsTable rows={[row("c-x", "X Co", "<img src=x onerror=alert(1)>")]} today="2026-10-27" showCommitments={false} />);
    const tr = screen.getByText("X Co").closest("tr")!;
    expect(tr.querySelector("img")).toBeNull();
    expect(tr.textContent).toContain("<img src=x onerror=alert(1)>");
  });
});

describe("no person is hard-coded into access or routing", () => {
  it("the escalation, review and permission code never names Mihir (only the button label does)", () => {
    const read = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8");
    for (const p of [
      "app/(forms-module)/forms/collection/actions.ts",
      "app/(forms-module)/forms/collection/commitments/actions.ts",
      "app/(forms-module)/forms/collection/commitments/page.tsx",
      "lib/queries/collection-review.ts",
      "lib/collections/review.ts",
      "lib/auth/capability.ts",
      "lib/access/field-permissions.ts",
      "app/(forms-module)/forms/layout.tsx",
    ]) {
      expect(read(p), p).not.toMatch(/mihir/i);
    }
    const controls = read("components/collections/review-controls.tsx");
    const mentions = controls.split(/\r?\n/).filter((l) => /mihir/i.test(l) && !/^\s*(\/\/|\*|\/\*\*)/.test(l));
    expect(mentions.every((l) => /ESCALATE_LABEL = "Escalate to Mihir Sir"|aria-label=\{`Escalate \$\{companyName\} to Mihir Sir`\}/.test(l))).toBe(true);
  });
});
