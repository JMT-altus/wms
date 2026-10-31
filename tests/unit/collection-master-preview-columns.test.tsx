// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

// The Collection Master import preview shows only the three business-data
// columns (Company, Sales Coordinator, Payment Terms) plus row status — no
// Client Master mapping — and states honestly when storage isn't set up. The
// file is read in jsdom; the server preview is MOCKED.
const h = vi.hoisted(() => ({ preview: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: h.refresh }) }));
vi.mock("@/app/(collection-module)/collection/master/actions", () => ({
  previewCollectionMaster: (...a: unknown[]) => h.preview(...a),
  importCollectionMaster: vi.fn(),
}));

import { CollectionMasterImport } from "@/components/collections/master/collection-master-import";
import type { PlannedRow, PlanSummary } from "@/lib/collections/master/plan";

afterEach(cleanup);

const plannedRow = (over: Partial<PlannedRow>): PlannedRow => ({
  rowNo: 2,
  companyName: "Alpha Traders",
  nameKey: "alphatraders",
  status: "new",
  coordinatorLabel: "MANGESH",
  paymentTerms: "30 days",
  coordinatorPlaceholder: false,
  clientMatch: "none",
  clientMatchCount: 0,
  customerMasterId: null,
  existingId: null,
  changes: [],
  duplicateOf: null,
  messages: [],
  ...over,
});
const summary: PlanSummary = {
  rows: 2,
  new: 2,
  unchanged: 0,
  changed: 0,
  duplicate: 0,
  rejected: 0,
  newWithoutCoordinator: 1,
  newWithoutPaymentTerms: 0,
  placeholderCoordinators: 0,
  clientLinked: 1,
  clientAmbiguous: 1,
  conflictGroups: 0,
  invalidCoordinators: 0,
  coordinatorSpellingsUnified: 0,
  coordinatorLabels: [{ label: "MANGESH", rows: 1 }],
  newCoordinatorLabels: [],
};
const rows = [
  plannedRow({ clientMatch: "linked", clientMatchCount: 1, customerMasterId: "cm-1" }),
  plannedRow({
    rowNo: 3,
    companyName: "Beta Corp",
    nameKey: "betacorp",
    coordinatorLabel: null,
    clientMatch: "ambiguous",
    clientMatchCount: 2,
    messages: [
      { level: "warning", text: "2 Client Master records have this exact name, so it is not linked to any.", topic: "client-master" },
      { level: "warning", text: "No Sales Coordinator — imported as Unassigned." },
    ],
  }),
];

async function uploadAndPreview(storageReady: boolean) {
  h.preview.mockResolvedValue({ ok: true, preview: { storageReady, summary, rows } });
  render(<CollectionMasterImport storageReady={storageReady} />);
  const csv = "Company,Sales Coordinator,Payment Terms,Client Code\nAlpha Traders,MANGESH,30 days,C1\nBeta Corp,,Advance,C2\n";
  const file = new File([csv], "master.csv", { type: "text/csv" });
  fireEvent.change(document.getElementById("cm-input")!, { target: { files: [file] } });
  // The coordinator column always needs the admin's explicit confirmation.
  fireEvent.click(await screen.findByRole("checkbox", { name: /I confirm .* holds the Sales Coordinator/ }));
  fireEvent.click(screen.getByRole("button", { name: "Preview import" }));
  return screen.findByRole("region", { name: /Preview \(nothing has been saved\)/ });
}

describe("Collection Master import preview", () => {
  it("shows only Company, Sales Coordinator and Payment Terms as data columns, with status and notes", async () => {
    const preview = await uploadAndPreview(true);
    expect(within(preview).getAllByRole("columnheader").map((th) => th.textContent)).toEqual(["Row", "Company", "Sales Coordinator", "Payment Terms", "Status", "Notes"]);
    // The file's extra column isn't sent and isn't in the preview.
    const sent = h.preview.mock.calls[0]![0] as { mapping: Record<string, string | null>; rows: Record<string, unknown>[] };
    expect(Object.keys(sent.rows[0]!).sort()).toEqual(["company", "coordinator", "paymentTerms", "rowNo"]);
    expect(within(preview).queryByText(/C1|C2/)).toBeNull();
  });

  it("leaves out the Client Master mapping — no column, summary or note — but keeps the other warnings", async () => {
    const preview = await uploadAndPreview(true);
    expect(within(preview).queryByRole("columnheader", { name: "Client Master" })).toBeNull();
    expect(within(preview).queryByText(/linked|ambiguous|Client Master records/i)).toBeNull();
    expect(within(preview).getByText("No Sales Coordinator — imported as Unassigned.")).toBeTruthy();
    expect(within(preview).getByText("Unassigned")).toBeTruthy();
  });

  it("says why when storage isn't set up, and the import stays disabled", async () => {
    const preview = await uploadAndPreview(false);
    expect(within(preview).getByText(/migration 0112 hasn.t been applied/)).toBeTruthy();
    fireEvent.click(within(preview).getByRole("checkbox", { name: /I have reviewed the preview/ }));
    await waitFor(() => expect((within(preview).getByRole("button", { name: "Import" }) as HTMLButtonElement).disabled).toBe(true));
  });
});
