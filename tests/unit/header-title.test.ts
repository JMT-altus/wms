import { describe, expect, it } from "vitest";
import { splitHeaderTitle } from "@/lib/header-title";

describe("splitHeaderTitle", () => {
  it("splits 'Module ▸ Page' and 'Module · Page' into module, separator and page", () => {
    expect(splitHeaderTitle("Employees ▸ Salary")).toEqual([
      { kind: "module", text: "Employees" },
      { kind: "separator", text: "▸" },
      { kind: "page", text: "Salary" },
    ]);
    expect(splitHeaderTitle("WMS · Archive")).toEqual([
      { kind: "module", text: "WMS" },
      { kind: "separator", text: "·" },
      { kind: "page", text: "Archive" },
    ]);
  });
  it("a title without a separator is just the module name; a dot inside a word is not a separator", () => {
    expect(splitHeaderTitle("Salary")).toEqual([{ kind: "module", text: "Salary" }]);
    expect(splitHeaderTitle("v1.2 ▸ Notes")).toEqual([
      { kind: "module", text: "v1.2" },
      { kind: "separator", text: "▸" },
      { kind: "page", text: "Notes" },
    ]);
  });
});
