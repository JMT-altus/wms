// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Archive } from "lucide-react";
import { MODULES } from "@/lib/nav-modules";
import { RailGroup } from "@/components/layout/rail-group";

afterEach(cleanup);

const group = () => MODULES.find((m) => m.id === "hr")!.items.find((i) => i.label === "Exit")!;

describe("HR → Exit", () => {
  it("lists the six entries in order, after Appraisal Letters", () => {
    expect(group().children!.map((c) => c.label)).toEqual([
      "Exit Interview & Handover",
      "FFS",
      "FFS Acknowledgement Letter",
      "Relieving Letter",
      "Letter of Recommendation",
      "Experience Letter",
    ]);
    const labels = MODULES.find((m) => m.id === "hr")!.items.map((i) => i.label);
    expect(labels.indexOf("Exit")).toBe(labels.indexOf("Appraisal Letters") + 1);
  });

  it("keeps the numbering 17–21 and leaves the first entry unnumbered", () => {
    render(<RailGroup item={group()} Icon={Archive} pathname="/hr/policies" accent="#000" collapsed={false} />);
    fireEvent.click(screen.getByRole("button", { name: /Exit/ }));
    expect(screen.getAllByRole("listitem").map((li) => li.textContent)).toEqual([
      "Exit Interview & Handover",
      "17.FFS",
      "18.FFS Acknowledgement Letter",
      "19.Relieving Letter",
      "20.Letter of Recommendation",
      "21.Experience Letter",
    ]);
  });
});
