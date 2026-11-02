// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, configure, fireEvent, render, screen } from "@testing-library/react";

// The Bulk Upload dialog's template download and sample-row warning, with the server actions MOCKED.
configure({ asyncUtilTimeout: 10_000 });
vi.setConfig({ testTimeout: 30_000 });

const a = vi.hoisted(() => ({ preview: vi.fn(), run: vi.fn(), add: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/(collection-module)/collection/tracker/bulk-actions", () => ({
  previewCollectionBalances: (...x: unknown[]) => a.preview(...x),
  importCollectionBalances: (...x: unknown[]) => a.run(...x),
  addMissingBalanceCompanies: (...x: unknown[]) => a.add(...x),
}));

import { TrackerBulkUpload } from "@/components/collections/tracker-bulk-upload";
import { buildBalanceTemplateWorkbook } from "@/lib/collections/balances/template-workbook";

let template: Buffer;
beforeAll(async () => {
  template = await buildBalanceTemplateWorkbook();
});
afterEach(cleanup);

const choose = (bytes: Uint8Array | string, name: string) =>
  fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [new File([bytes as BlobPart], name)] } });

describe("Download Sample Excel Template", () => {
  it("is offered at the top of the dialog with the instruction, and points at the template route", () => {
    render(<TrackerBulkUpload canImport onClose={() => {}} />);
    const link = screen.getByRole("link", { name: /Download Sample Excel Template/ });
    expect(link.getAttribute("href")).toBe("/collection/tracker/bulk-template.xlsx");
    expect(link.getAttribute("download")).toBe("collection-tracker-bulk-upload-sample.xlsx");
    expect(
      screen.getByText("Download the sample file, fill in your collection data without changing the column headers, and upload the completed file here."),
    ).toBeTruthy();
    // The rest of the form is unchanged.
    expect(document.querySelector('input[type="file"]')).toBeTruthy();
    expect(screen.getByRole("button", { name: "Preview upload" })).toBeTruthy();
  });

  it("is not offered without the Bulk Upload permission", () => {
    render(<TrackerBulkUpload canImport={false} onClose={() => {}} />);
    expect(screen.queryByRole("link", { name: /Download Sample Excel Template/ })).toBeNull();
  });
});

describe("choosing the downloaded template", () => {
  it("reads it, warns that the sample rows are still there, and sends nothing until Preview is pressed", async () => {
    render(<TrackerBulkUpload canImport onClose={() => {}} />);
    choose(new Uint8Array(template), "collection-tracker-bulk-upload-sample.xlsx");
    expect((await screen.findByRole("status")).textContent).toMatch(/still has 3 sample rows/);
    expect(screen.getByText(/Customer rows:/).closest("p")!.textContent).toMatch(/Customer rows: 3 ·/);
    expect(screen.getByText(/Reporting period:/).closest("p")!.textContent).toMatch(/01\/04\/26 to 31\/10\/26/);
    expect(a.preview).not.toHaveBeenCalled();
    expect(a.run).not.toHaveBeenCalled();
    expect(a.add).not.toHaveBeenCalled();
  });

  it("shows no warning for an ordinary file", async () => {
    render(<TrackerBulkUpload canImport onClose={() => {}} />);
    choose("Particulars,Debit,Credit\nAlpha Traders,100,\nGrand Total,100,\n", "c.csv");
    await screen.findByText(/Customer rows:/);
    expect(screen.queryByText(/sample row/)).toBeNull();
  });
});
