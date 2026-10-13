// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { TallyImportShell } from "@/components/admin/master/tally-import-shell";

afterEach(cleanup);

describe("TallyImportShell (structure only)", () => {
  it("lists all ten categories", () => {
    render(<TallyImportShell />);
    for (const name of [
      "Customer Master",
      "Vendor Master",
      "Sales Orders",
      "Sales Invoices / Tax Invoices",
      "Purchase Invoices",
      "Credit Notes",
      "Debit Notes",
      "Customer Receipts (Cash/Bank)",
      "Vendor Payments (Cash/Bank)",
      "Outstanding Balances",
    ]) {
      expect(screen.getByRole("button", { name: new RegExp(name.replace(/[()/]/g, "\\$&")) })).toBeTruthy();
    }
  });

  it("selecting a category only changes the view", () => {
    render(<TallyImportShell />);
    const card = screen.getByRole("button", { name: /Credit Notes/ });
    fireEvent.click(card);
    expect(card.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("Upload file for Credit Notes")).toBeTruthy();
  });

  it("never offers a working upload or import", () => {
    const { container } = render(<TallyImportShell />);
    expect(container.querySelector('input[type="file"]')).toBeNull();
    for (const label of ["Upload file", "Import"]) {
      const b = screen.getByRole("button", { name: label }) as HTMLButtonElement;
      expect(b.disabled).toBe(true);
    }
  });

  it("marks every placeholder section as not implemented", () => {
    render(<TallyImportShell />);
    for (const t of ["File preview", "Column mapping", "Validation summary", "Import history", "Record counts"]) {
      expect(screen.getByText(t)).toBeTruthy();
    }
    expect(screen.getAllByText("Not implemented yet").length).toBeGreaterThanOrEqual(6);
  });
});
