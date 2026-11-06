// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));
const a = vi.hoisted(() => ({ preview: vi.fn(), apply: vi.fn() }));
vi.mock("@/app/(app)/dcc/actions", () => ({
  previewDccBulkImport: (...x: unknown[]) => a.preview(...x),
  applyDccBulkImport: (...x: unknown[]) => a.apply(...x),
}));

import { DccBulkImportDialog } from "@/components/dcc/dcc-bulk-import-dialog";
import { DCC_BULK_SAMPLE } from "@/lib/dcc/bulk-sample";

afterEach(cleanup);

describe("Bulk KPI setup — Download sample", () => {
  it("downloads the sample as dcc-bulk-kpi-sample.txt, and the downloaded text pasted into Checklist Text reads as 2 tabs and 8 KPIs", async () => {
    const blobs: Blob[] = [];
    const createObjectURL = vi.fn((b: Blob) => {
      blobs.push(b);
      return "blob:sample";
    });
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    const clicked: { download: string; href: string }[] = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push({ download: this.download, href: this.href });
    });

    render(<DccBulkImportDialog open onClose={() => {}} people={[]} />);
    fireEvent.click(screen.getByRole("button", { name: /Download sample/ }));
    expect(clicked).toEqual([{ download: "dcc-bulk-kpi-sample.txt", href: "blob:sample" }]);
    const text = await blobs[0]!.text();
    expect(text).toBe(DCC_BULK_SAMPLE);
    expect(blobs[0]!.type).toMatch(/^text\/plain/);

    // Paste it: the dialog's own live count (the same parser) sees every tab and KPI, none with problems.
    fireEvent.change(screen.getByLabelText(/Checklist text/i), { target: { value: text } });
    expect(screen.getByText(/2 groups, 8 lines/).textContent).not.toMatch(/problems/);
    expect(a.preview).not.toHaveBeenCalled(); // downloading previews nothing; Preview is still the admin's click
    click.mockRestore();
  });

  it("shows the format guide with the parser's rules", () => {
    render(<DccBulkImportDialog open onClose={() => {}} people={[]} />);
    expect(screen.getByText("Format guide")).toBeTruthy();
    expect(screen.getByText(/Every # line is a tab/)).toBeTruthy();
  });
});
