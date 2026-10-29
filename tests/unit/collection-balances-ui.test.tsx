// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, configure, fireEvent, render, screen, waitFor } from "@testing-library/react";

// The first CSV/Excel read lazy-loads the large `xlsx` module, and the dialog body is itself lazy.
// Under a busy machine (e.g. the whole suite running) that can exceed the defaults of 1 s for
// findBy/waitFor and 5 s per test, so allow longer. The assertions themselves are unchanged.
configure({ asyncUtilTimeout: 10_000 });
vi.setConfig({ testTimeout: 30_000 });

// The Tracker's Bulk Upload button and dialog, with the server actions MOCKED.
const a = vi.hoisted(() => ({ preview: vi.fn(), run: vi.fn(), add: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: a.refresh }) }));
vi.mock("@/lib/toast", () => ({ fireToast: vi.fn() }));
vi.mock("@/app/(forms-module)/forms/collection/actions", () => ({ saveFollowUp: vi.fn(), setCollectionConfirmation: vi.fn(), escalateForReview: vi.fn() }));
vi.mock("@/app/(forms-module)/forms/collection/commitments/actions", () => ({ getCompanyCommitment: vi.fn(), saveCompanyCommitment: vi.fn(), closeEscalation: vi.fn() }));
vi.mock("@/app/(forms-module)/forms/collection/tracker/bulk-actions", () => ({
  previewCollectionBalances: (...x: unknown[]) => a.preview(...x),
  importCollectionBalances: (...x: unknown[]) => a.run(...x),
  addMissingBalanceCompanies: (...x: unknown[]) => a.add(...x),
}));

import { CollectionTracker } from "@/components/collections/collection-tracker";
import { TrackerBulkUpload } from "@/components/collections/tracker-bulk-upload";
import { buildRows } from "@/lib/collections/derive";

const rows = buildRows([{ partyName: "Alpha Traders", debit: 100, credit: 5, outstanding: null, collectionPerson: "MANGESH", masterId: "m1", transactions: [] }], []);

beforeEach(() => {
  for (const f of Object.values(a)) f.mockReset();
});
afterEach(cleanup);

describe("Bulk Upload button (Tracker)", () => {
  it("is visible and, without the capability, opens a dialog that explains why nothing can be uploaded", async () => {
    render(<CollectionTracker rows={rows} connected storageReady today="2026-10-19" />);
    fireEvent.click(screen.getByRole("button", { name: "Bulk Upload" }));
    expect((await screen.findByRole("status")).textContent).toMatch(/don.t have permission/);
    expect(document.querySelector('input[type="file"]')).toBeNull();
    expect(screen.queryByRole("button", { name: "Preview upload" })).toBeNull();
  });

  it("with the capability, opens the upload form", async () => {
    render(<CollectionTracker rows={rows} connected storageReady today="2026-10-19" canImportBalances />);
    fireEvent.click(screen.getByRole("button", { name: "Bulk Upload" }));
    await waitFor(() => expect(document.querySelector('input[type="file"]')).not.toBeNull());
    expect((screen.getByRole("button", { name: "Preview upload" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("says so — visibly — when the uploaded balances couldn't be read (permission / configuration), and not otherwise", () => {
    render(<CollectionTracker rows={rows} connected storageReady today="2026-10-19" balancesProblem="42501" />);
    expect(screen.getByRole("alert", { name: "Debit and Credit unavailable" }).textContent).toMatch(/42501/);
    cleanup();
    render(<CollectionTracker rows={rows} connected storageReady today="2026-10-19" />);
    expect(screen.queryByRole("alert", { name: "Debit and Credit unavailable" })).toBeNull();
  });

  it("the Debit and Credit columns show what the loader supplied", () => {
    render(<CollectionTracker rows={rows} connected storageReady today="2026-10-19" />);
    expect(screen.getAllByText("₹100").length).toBeGreaterThan(0);
    expect(screen.getAllByText("₹5").length).toBeGreaterThan(0);
  });
});

describe("TrackerBulkUpload", () => {
  it("refuses a file that isn't the Tally summary, and a wrong extension, without calling the server", async () => {
    render(<TrackerBulkUpload canImport onClose={() => {}} />);
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["x"], "notes.txt")] } });
    expect((await screen.findByRole("alert")).textContent).toMatch(/Excel .* or CSV/);
    fireEvent.change(input, { target: { files: [new File(["Name,Amount\nA,1\n"], "other.csv", { type: "text/csv" })] } });
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/Particulars/));
    expect(a.preview).not.toHaveBeenCalled();
  });

  it("reads a Tally-style CSV, previews through the server and only imports after the confirmation tick", async () => {
    const csv = ["JMT (from 1-Apr-26)", "1-Apr-26 to 19-Oct-26", "Particulars,Pending Bills,", ",Debit,Credit", "Alpha Traders,100,", "Grand Total,100,"].join("\n");
    const summary = {
      rows: 1,
      matched: 1,
      unmatched: 0,
      duplicates: 0,
      conflicts: 0,
      rejected: 0,
      negatives: 0,
      totals: {
        source: { debit: 100, credit: 0 },
        sheetRows: { debit: 100, credit: 0 },
        imported: { debit: 100, credit: 0 },
        unmatched: { debit: 0, credit: 0 },
        ignoredDuplicates: { debit: 0, credit: 0 },
        conflicting: { debit: 0, credit: 0 },
        difference: { debit: 0, credit: 0 },
      },
      verification: { status: "ok", tolerancePaise: 2, differencePaise: { debit: 0, credit: 0 }, message: null },
      fingerprint: { matched: 1, debitPaise: 10_000, creditPaise: 0 },
    };
    a.preview.mockResolvedValue({
      ok: true,
      preview: {
        storageReady: true,
        summary,
        rows: [{ rowNo: 5, name: "Alpha Traders", nameKey: "alphatraders", status: "matched", debit: 100, credit: null, debitPaise: 10_000, creditPaise: null, companyId: "m1", companyName: "Alpha Traders", negative: false, messages: [] }],
        replacement: { previous: null, wouldGoBlank: 0, sameFileAsPrevious: false },
        report: { reportTitle: "JMT (from 1-Apr-26)", periodFrom: "2026-04-01", periodTo: "2026-10-19" },
      },
    });
    a.run.mockResolvedValue({ ok: true, result: { snapshotId: "snap-1", written: 1, skipped: { unmatched: 0, duplicates: 0, conflicts: 0, rejected: 0 }, totals: { debit: 100, credit: 0 } } });

    render(<TrackerBulkUpload canImport onClose={() => {}} />);
    fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [new File([csv], "Collection.csv", { type: "text/csv" })] } });
    const previewBtn = (await screen.findByRole("button", { name: "Preview upload" })) as HTMLButtonElement;
    await waitFor(() => expect(previewBtn.disabled).toBe(false));
    fireEvent.click(previewBtn);

    await screen.findByText(/Preview \(nothing has been saved\)/);
    // The server got the sheet's RAW CELLS — nothing the browser derived (no rows, totals, period or hash).
    const sent = a.preview.mock.calls[0]![0] as Record<string, unknown> & { grid: string[][] };
    expect(Object.keys(sent).sort()).toEqual(["fileName", "grid", "sheetName"]);
    expect(sent.grid.map((r) => r[0])).toContain("Grand Total");
    expect(sent.grid.map((r) => r[0])).toContain("Alpha Traders");
    expect(sent.grid[1]![0]).toBe("1-Apr-26 to 19-Oct-26");
    expect(screen.getAllByText(/replaces/i).length).toBeGreaterThan(0);

    const importBtn = screen.getByRole("button", { name: "Upload balances" }) as HTMLButtonElement;
    expect(importBtn.disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(importBtn.disabled).toBe(false);
    fireEvent.click(importBtn);

    await waitFor(() => expect(a.run).toHaveBeenCalled());
    expect(a.run.mock.calls[0]![0]).toMatchObject({ confirm: true, previousSnapshotId: null, expected: { matched: 1, debitPaise: 10_000, creditPaise: 0 } });
    expect(Object.keys(a.run.mock.calls[0]![0] as object).sort()).toEqual(["confirm", "expected", "fileName", "grid", "previousSnapshotId", "sheetName"]);
    await screen.findByText("Balances uploaded");
    expect(a.refresh).toHaveBeenCalled();
  });

  it("keeps Upload disabled, and says why, when the server could not verify the Grand Total", async () => {
    const csv = ["Particulars,,", ",Debit,Credit", "Alpha Traders,100,"].join("\n");
    a.preview.mockResolvedValue({
      ok: true,
      preview: {
        storageReady: true,
        summary: {
          rows: 1, matched: 1, unmatched: 0, duplicates: 0, conflicts: 0, rejected: 0, negatives: 0,
          totals: {
            source: null,
            sheetRows: { debit: 100, credit: 0 }, imported: { debit: 100, credit: 0 }, unmatched: { debit: 0, credit: 0 },
            ignoredDuplicates: { debit: 0, credit: 0 }, conflicting: { debit: 0, credit: 0 }, difference: null,
          },
          verification: { status: "missing", tolerancePaise: 1, differencePaise: null, message: "The file has no Grand Total row, so the rows can't be checked for completeness. Nothing can be imported." },
          fingerprint: { matched: 1, debitPaise: 10_000, creditPaise: 0 },
        },
        rows: [],
        replacement: { previous: null, wouldGoBlank: 0, sameFileAsPrevious: false },
        report: { reportTitle: null, periodFrom: null, periodTo: null },
      },
    });
    render(<TrackerBulkUpload canImport onClose={() => {}} />);
    fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [new File([csv], "c.csv", { type: "text/csv" })] } });
    const btn = (await screen.findByRole("button", { name: "Preview upload" })) as HTMLButtonElement;
    await waitFor(() => expect(btn.disabled).toBe(false));
    fireEvent.click(btn);
    expect((await screen.findByRole("alert")).textContent).toMatch(/no Grand Total row/);
    fireEvent.click(screen.getByRole("checkbox"));
    expect((screen.getByRole("button", { name: "Upload balances" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows a server refusal and does not report success", async () => {
    const csv = ["Particulars,,", ",Debit,Credit", "Alpha Traders,100,"].join("\n");
    a.preview.mockResolvedValue({ ok: false, error: "Could not check the file against the Collection Master. Please try again." });
    render(<TrackerBulkUpload canImport onClose={() => {}} />);
    fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [new File([csv], "c.csv", { type: "text/csv" })] } });
    const btn = (await screen.findByRole("button", { name: "Preview upload" })) as HTMLButtonElement;
    await waitFor(() => expect(btn.disabled).toBe(false));
    fireEvent.click(btn);
    expect((await screen.findByRole("alert")).textContent).toMatch(/Could not check/);
    expect(screen.queryByText("Balances uploaded")).toBeNull();
  });
});

describe("TrackerBulkUpload — companies not in the Collection Master", () => {
  const csv = ["JMT (from 1-Apr-26)", "1-Apr-26 to 19-Oct-26", "Particulars,,", ",Debit,Credit", "Alpha Traders,100,", "Brand New Co,9,", "Grand Total,109,"].join("\n");
  const totals = (imported: { debit: number; credit: number }, unmatched: { debit: number; credit: number }) => ({
    source: { debit: 109, credit: 0 },
    sheetRows: { debit: 109, credit: 0 },
    imported,
    unmatched,
    ignoredDuplicates: { debit: 0, credit: 0 },
    conflicting: { debit: 0, credit: 0 },
    difference: { debit: 0, credit: 0 },
  });
  const verification = { status: "ok", tolerancePaise: 2, differencePaise: { debit: 0, credit: 0 }, message: null };
  const alpha = { rowNo: 5, name: "Alpha Traders", nameKey: "alphatraders", status: "matched", debit: 100, credit: null, debitPaise: 10_000, creditPaise: null, companyId: "m1", companyName: "Alpha Traders", negative: false, messages: [] };
  const before = {
    ok: true,
    preview: {
      storageReady: true,
      summary: { rows: 2, matched: 1, unmatched: 1, duplicates: 0, conflicts: 0, rejected: 0, negatives: 0, totals: totals({ debit: 100, credit: 0 }, { debit: 9, credit: 0 }), verification, fingerprint: { matched: 1, debitPaise: 10_000, creditPaise: 0 } },
      rows: [alpha, { rowNo: 6, name: "Brand New Co", nameKey: "brandnewco", status: "unmatched", debit: 9, credit: null, debitPaise: 900, creditPaise: null, companyId: null, companyName: null, negative: false, messages: [{ level: "warning", text: "Not in the Collection Master; skipped." }] }],
      replacement: { previous: null, wouldGoBlank: 0, sameFileAsPrevious: false },
      report: { reportTitle: "JMT (from 1-Apr-26)", periodFrom: "2026-04-01", periodTo: "2026-10-19" },
    },
  };
  const after = {
    ...before,
    preview: {
      ...before.preview,
      summary: { ...before.preview.summary, matched: 2, unmatched: 0, totals: totals({ debit: 109, credit: 0 }, { debit: 0, credit: 0 }), fingerprint: { matched: 2, debitPaise: 10_900, creditPaise: 0 } },
      rows: [alpha, { ...before.preview.rows[1]!, status: "matched", companyId: "m2", companyName: "Brand New Co", messages: [] }],
    },
  };
  const open = async (props: { canAddCompanies?: boolean } = {}) => {
    render(<TrackerBulkUpload canImport onClose={() => {}} {...props} />);
    fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [new File([csv], "Collection.csv", { type: "text/csv" })] } });
    const btn = (await screen.findByRole("button", { name: "Preview upload" })) as HTMLButtonElement;
    await waitFor(() => expect(btn.disabled).toBe(false));
    fireEvent.click(btn);
    await screen.findByText(/Preview \(nothing has been saved\)/);
  };

  it("lists the unmatched companies by name; without collection.master.import it explains who can add them and offers no button", async () => {
    a.preview.mockResolvedValue(before);
    await open();
    const list = screen.getByRole("list", { name: "Companies not in the Collection Master" });
    expect(list.textContent).toContain("Brand New Co");
    expect(list.textContent).not.toContain("Alpha Traders");
    expect(screen.queryByRole("button", { name: "Add missing companies as unassigned" })).toBeNull();
    expect(screen.getByText(/needs the .Collections — Import Collection Master. permission/).textContent).toMatch(/preview again/);
    expect(a.add).not.toHaveBeenCalled();
  });

  it("with the permission: adds only after its own tick, sends the raw cells plus the previewed count, then previews again and shows the new match count", async () => {
    a.preview.mockResolvedValueOnce(before).mockResolvedValueOnce(after);
    a.add.mockResolvedValue({ ok: true, result: { importId: "imp-1", created: 1, alreadyExisted: 0, rejected: 0, companies: [{ rowNo: 6, name: "Brand New Co", outcome: "created", clientMatch: "none", message: null }] } });
    await open({ canAddCompanies: true });
    const addBtn = screen.getByRole("button", { name: "Add missing companies as unassigned" }) as HTMLButtonElement;
    expect(addBtn.disabled).toBe(true);
    const tick = screen.getByRole("checkbox", { name: /as Unassigned/ });
    fireEvent.click(tick);
    expect(addBtn.disabled).toBe(false);
    fireEvent.click(addBtn);

    await waitFor(() => expect(a.add).toHaveBeenCalledTimes(1));
    const sent = a.add.mock.calls[0]![0] as Record<string, unknown>;
    expect(Object.keys(sent).sort()).toEqual(["confirm", "expected", "fileName", "grid", "sheetName"]);
    expect(sent).toMatchObject({ confirm: true, expected: { unmatched: 1 } });
    // No company name or id chosen in the browser is sent — the server re-derives the list from the cells.
    expect(JSON.stringify(sent.expected)).not.toMatch(/Brand New Co/);

    await waitFor(() => expect(a.preview).toHaveBeenCalledTimes(2));
    expect((await screen.findByRole("status")).textContent).toMatch(/1 company added to the Collection Master as Unassigned/);
    await waitFor(() => expect(screen.queryByRole("list", { name: "Companies not in the Collection Master" })).toBeNull());
    expect(screen.getByText("Matched", { selector: "p" }).nextElementSibling?.textContent).toBe("2"); // the Matched tile, recomputed
    expect(a.run).not.toHaveBeenCalled(); // balances are still only written by "Upload balances"
  });

  it("a server refusal of the add step is shown; nothing is re-previewed", async () => {
    a.preview.mockResolvedValue(before);
    a.add.mockResolvedValue({ ok: false, error: "The companies not in the Collection Master changed since your preview. Nothing was added — preview again." });
    await open({ canAddCompanies: true });
    fireEvent.click(screen.getByRole("checkbox", { name: /as Unassigned/ }));
    fireEvent.click(screen.getByRole("button", { name: "Add missing companies as unassigned" }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/changed since your preview/);
    expect(a.preview).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("list", { name: "Companies not in the Collection Master" })).toBeTruthy();
  });
});
