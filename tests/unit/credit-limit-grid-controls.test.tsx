// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup, screen, waitFor } from "@testing-library/react";
import { MasterGrid, type GridCol } from "@/components/admin/master/master-grid";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

interface Row { id: string; name: string; limit: string; days: string; grade: string }
const ROWS: Row[] = [
  { id: "1", name: "Alpha Ltd", limit: "500000", days: "30", grade: "A" },
  { id: "2", name: "Beta Ltd", limit: "", days: "45", grade: "B" },
];

// The same shape the Credit Limit grid declares: frozen name, typed limit, others.
const COLS: GridCol<Row>[] = [
  { key: "name", label: "Client", width: 240, kind: "text", frozen: true, readOnly: true, get: (r) => r.name },
  { key: "creditLimit", label: "Credit Limit", width: 190, kind: "number", numericOnly: true, get: (r) => r.limit },
  { key: "creditDays", label: "Credit Days", width: 150, kind: "number", get: (r) => r.days },
  { key: "grade", label: "Grade", width: 120, kind: "select", options: ["A", "B", "C"], get: (r) => r.grade },
];

afterEach(cleanup);

function grid(save = vi.fn(async () => ({ ok: true as const }))) {
  render(
    <MasterGrid
      rows={ROWS}
      columns={COLS}
      title="Credit Limit"
      primaryKey="name"
      primarySearchLabel="Search client"
      accent="#111"
      accentSoft="#eee"
      save={save}
      noun="clients"
      searchable={false}
      columnPicker
    />,
  );
  return save;
}

describe("Credit Limit grid — controls", () => {
  it("has no +/− controls on the Credit Limit column", () => {
    grid();
    expect(screen.queryByLabelText(/increase|decrease/i)).toBeNull();
    expect(screen.queryAllByRole("button", { name: /^(\+|−|-)$/ })).toHaveLength(0);
  });

  it("has neither search box nor the column-scope select", () => {
    grid();
    expect(screen.queryByPlaceholderText("Search client")).toBeNull();
    expect(screen.queryByPlaceholderText(/search all columns/i)).toBeNull();
    expect(screen.queryByLabelText("Column to search")).toBeNull();
  });

  it("keeps the column menu, which hides and shows columns without touching data", () => {
    grid();
    const headings = () => screen.queryAllByRole("columnheader").map((h) => h.textContent);
    expect(headings()).toEqual(expect.arrayContaining(["Client", "Credit Limit", "Credit Days", "Grade"]));

    fireEvent.click(screen.getByRole("button", { name: "Choose columns" }));
    fireEvent.click(screen.getByLabelText("Credit Days"));
    expect(headings()).not.toContain("Credit Days");
    expect(headings()).toEqual(expect.arrayContaining(["Client", "Credit Limit", "Grade"]));
    // The other rows' figures are still all there.
    expect((screen.getAllByDisplayValue("500000")[0] as HTMLInputElement).value).toBe("500000");

    fireEvent.click(screen.getByLabelText("Credit Days"));
    expect(headings()).toContain("Credit Days");

    // The frozen identity column cannot be switched off.
    expect((screen.getByLabelText("Client") as HTMLInputElement).disabled).toBe(true);
  });

  it("takes a typed limit, refuses non-numeric keystrokes, and saves what was typed", async () => {
    const save = grid();
    const box = screen.getAllByDisplayValue("500000")[0] as HTMLInputElement;
    fireEvent.change(box, { target: { value: "7,50,000" } });
    expect(box.value).toBe("7,50,000");
    fireEvent.change(box, { target: { value: "7,50,000x" } });
    expect(box.value).toBe("7,50,000");
    fireEvent.blur(box);
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    const [row, cells] = save.mock.calls[0] as unknown as [Row, Record<string, string>];
    expect(row.id).toBe("1");
    // Every column rides along on the write, whatever is showing.
    expect(cells).toMatchObject({ creditLimit: "7,50,000", creditDays: "30", grade: "A" });
  });
});
