// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { AttendanceImportShell } from "@/components/hr/attendance-import-shell";

afterEach(cleanup);

describe("AttendanceImportShell (structure only)", () => {
  it("accepts only CSV selection and says it is not uploaded", () => {
    const { container } = render(<AttendanceImportShell />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input.accept).toContain(".csv");
    const file = new File(["a,b"], "march.csv", { type: "text/csv" });
    fireEvent.change(input, { target: { files: [file] } });
    expect(screen.getByText("march.csv")).toBeTruthy();
    expect(screen.getByText(/selected, not uploaded/)).toBeTruthy();
  });

  it("keeps Upload disabled and marks preview, validation and history as not built", () => {
    render(<AttendanceImportShell />);
    expect((screen.getByRole("button", { name: "Upload" }) as HTMLButtonElement).disabled).toBe(true);
    for (const t of ["File preview", "Validation results", "Upload history"]) {
      expect(screen.getByText(t)).toBeTruthy();
    }
    expect(screen.getAllByText("Not implemented yet")).toHaveLength(4);
  });
});
