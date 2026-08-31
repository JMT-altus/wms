import { describe, expect, it } from "vitest";

/**
 * The selection rules `DataTable` implements, extracted so they can be checked
 * without mounting React.
 *
 * These mirror the component exactly; if one changes, both change. The point
 * of the test is the two rules that are easy to get subtly wrong: selecting a
 * page must not touch other pages, and a stale tick must never survive a
 * filter into the export.
 */

interface Row {
  id: string;
}

/** Rows the export actually writes: ticked ones, or all visible if none. */
function selectedRows(filtered: Row[], selected: Set<string>): Row[] {
  return selected.size === 0 ? filtered : filtered.filter((r) => selected.has(r.id));
}

/** Header box state for the current page. */
function pageState(pageIds: string[], selected: Set<string>) {
  const all = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const some = !all && pageIds.some((id) => selected.has(id));
  return { all, some };
}

/** Header box click: ticks or clears this page only. */
function togglePage(pageIds: string[], selected: Set<string>): Set<string> {
  const next = new Set(selected);
  const { all } = pageState(pageIds, selected);
  if (all) for (const id of pageIds) next.delete(id);
  else for (const id of pageIds) next.add(id);
  return next;
}

const rows = (...ids: string[]): Row[] => ids.map((id) => ({ id }));

describe("DataTable selection", () => {
  it("exports everything visible when nothing is ticked", () => {
    const filtered = rows("a", "b", "c");
    expect(selectedRows(filtered, new Set()).map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("exports only the ticked rows once anything is ticked", () => {
    const filtered = rows("a", "b", "c");
    expect(selectedRows(filtered, new Set(["a", "c"])).map((r) => r.id)).toEqual(["a", "c"]);
  });

  it("never exports a ticked row the current filter has hidden", () => {
    // "b" was ticked on an earlier filter, then filtered away. It must not
    // reappear in the export just because the tick outlived the filter.
    const filtered = rows("a", "c");
    expect(selectedRows(filtered, new Set(["a", "b"])).map((r) => r.id)).toEqual(["a"]);
  });

  it("select-all on page 2 leaves page 1 alone", () => {
    const page1 = ["a", "b"];
    const page2 = ["c", "d"];
    const afterPage2 = togglePage(page2, new Set());
    expect([...afterPage2].sort()).toEqual(["c", "d"]);
    expect(pageState(page1, afterPage2).all).toBe(false);
    expect(pageState(page1, afterPage2).some).toBe(false);
    expect(pageState(page2, afterPage2).all).toBe(true);
  });

  it("clicking a fully-selected page clears just that page", () => {
    const page1 = ["a", "b"];
    const page2 = ["c", "d"];
    const both = new Set(["a", "b", "c", "d"]);
    const afterClear = togglePage(page2, both);
    expect([...afterClear].sort()).toEqual(["a", "b"]);
    expect(pageState(page1, afterClear).all).toBe(true);
  });

  it("shows the indeterminate dash when only part of a page is ticked", () => {
    const page = ["a", "b", "c"];
    const s = pageState(page, new Set(["b"]));
    expect(s.all).toBe(false);
    expect(s.some).toBe(true);
  });

  it("an empty page is not reported as fully selected", () => {
    expect(pageState([], new Set()).all).toBe(false);
  });
});
