// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, fireEvent, cleanup, screen, waitFor } from "@testing-library/react";
import { RecordEditDialog, type EditField } from "@/components/forms/kyc/record-edit-dialog";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// The two number fields the Client Master edit dialog carries, as it declares them.
const FIELDS: EditField[] = [
  { key: "creditDays", label: "Credit Days", type: "number", span: 2, step: 15, placeholder: "0" },
  { key: "creditLimit", label: "Credit Limit", type: "number", span: 2, stepper: false, format: "inr", placeholder: "0" },
];

afterEach(cleanup);

function open(initial: Record<string, string>) {
  const onSave = vi.fn(async () => ({ ok: true as const }));
  render(<RecordEditDialog title="Edit client" fields={FIELDS} initial={initial} onSave={onSave} onClose={() => {}} />);
  return onSave;
}

describe("Client Master edit dialog — Credit Limit", () => {
  it("has no −/+ buttons for Credit Limit (only Credit Days keeps its pair)", () => {
    open({ creditDays: "30", creditLimit: "1000000" });
    expect(screen.getAllByLabelText("Decrease")).toHaveLength(1);
    expect(screen.getAllByLabelText("Increase")).toHaveLength(1);
  });

  it("shows an existing limit as it was stored", () => {
    open({ creditDays: "30", creditLimit: "1000000" });
    const boxes = screen.getAllByRole("textbox") as HTMLInputElement[];
    expect(boxes.map((b) => b.value)).toContain("1000000");
  });

  it("takes a typed figure and saves exactly that value", async () => {
    const onSave = open({ creditDays: "30", creditLimit: "" });
    const [, limit] = screen.getAllByRole("textbox") as HTMLInputElement[];
    fireEvent.change(limit!, { target: { value: "2,50,000" } });
    expect(limit!.value).toBe("2,50,000");
    fireEvent.change(limit!, { target: { value: "abc" } }); // non-numeric is ignored
    expect(limit!.value).toBe("2,50,000");
    fireEvent.click(screen.getByText("Save changes"));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect((onSave.mock.calls[0] as unknown[])[0]).toMatchObject({ creditLimit: "2,50,000", creditDays: "30" });
  });
});
