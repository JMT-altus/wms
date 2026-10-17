import { describe, it, expect } from "vitest";
import { parseTaskFilters, taskFiltersToSearchString } from "@/lib/task-filters";

describe("Tasks list: Initiator Status and Due Dates params", () => {
  it("parses valid approval verdicts and a due bucket", () => {
    const f = parseTaskFilters({ approval: "approved,not_approved,bogus", due: "o8" }, false);
    expect(f.approvals).toEqual(["approved", "not_approved"]);
    expect(f.dueBucket).toBe("o8");
  });

  it("ignores unknown values and defaults to no filter", () => {
    const f = parseTaskFilters({ approval: "nope", due: "someday" }, false);
    expect(f.approvals).toEqual([]);
    expect(f.dueBucket).toBeNull();
  });

  it("round-trips through the search string", () => {
    const f = parseTaskFilters({ approval: "cancelled", due: "today" }, false);
    const sp = new URLSearchParams(taskFiltersToSearchString(f));
    expect(sp.get("approval")).toBe("cancelled");
    expect(sp.get("due")).toBe("today");
  });
});
