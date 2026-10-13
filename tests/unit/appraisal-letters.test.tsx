// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { Award } from "lucide-react";
import { MODULES } from "@/lib/nav-modules";
import { RailGroup } from "@/components/layout/rail-group";

afterEach(cleanup);

const group = () =>
  MODULES.find((m) => m.id === "hr")!.items.find((i) => i.label === "Appraisal Letters")!;

describe("HR → Appraisal Letters", () => {
  it("lists the four entries in order, after During Employment", () => {
    expect(group().children!.map((c) => c.label)).toEqual([
      "Appraisal",
      "Promotion Letter",
      "Salary Revision Letter",
      "Appraisal + Promotion Letter",
    ]);
    const labels = MODULES.find((m) => m.id === "hr")!.items.map((i) => i.label);
    expect(labels.indexOf("Appraisal Letters")).toBe(labels.indexOf("During Employment") + 1);
  });

  it("keeps the reference numbering 14, 15, 16 and numbers Appraisal not at all", () => {
    render(<RailGroup item={group()} Icon={Award} pathname="/hr/policies" accent="#000" collapsed={false} />);
    fireEvent.click(screen.getByRole("button", { name: /Appraisal Letters/ }));
    const rows = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(rows).toEqual([
      "Appraisal",
      "14.Promotion Letter",
      "15.Salary Revision Letter",
      "16.Appraisal + Promotion Letter",
    ]);
    expect(within(screen.getAllByRole("listitem")[0]!).queryByText(/^\d+\.$/)).toBeNull();
  });
});
