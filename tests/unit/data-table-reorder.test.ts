import { describe, expect, it } from "vitest";

/**
 * The column-reorder rules `DataTable` implements, extracted so they can be
 * checked without a drag simulation. These mirror the component; if one
 * changes, both change.
 *
 * The cases that matter are the ones a naive splice gets wrong: dragging
 * rightwards (where removing the column first shifts every later index by
 * one), and reconciling a user's arrangement when the caller's column set
 * changes underneath it.
 */

/**
 * Drop `from` onto `to`, landing it where it was released. Dragging left it
 * takes the target's slot; dragging right it goes after the target.
 */
function moveColumn(order: string[], from: string, to: string): string[] {
  if (from === to) return order;
  const fromIdx = order.indexOf(from);
  const toIdx = order.indexOf(to);
  if (fromIdx === -1 || toIdx === -1) return order;
  const next = order.filter((k) => k !== from);
  const at = next.indexOf(to);
  next.splice(fromIdx < toIdx ? at + 1 : at, 0, from);
  return next;
}

/** Keep the user's arrangement across a change to the caller's columns. */
function reconcile(prev: string[], keys: string[]): string[] {
  return [...prev.filter((k) => keys.includes(k)), ...keys.filter((k) => !prev.includes(k))];
}

const ORDER = ["code", "company", "type", "email"];

describe("DataTable column reorder", () => {
  it("moves a column leftwards to the drop target's place", () => {
    expect(moveColumn(ORDER, "email", "company")).toEqual(["code", "email", "company", "type"]);
  });

  it("moves a column rightwards without the off-by-one a plain splice gives", () => {
    // "code" lands where "type" was — the index is taken AFTER removing it.
    expect(moveColumn(ORDER, "code", "type")).toEqual(["company", "type", "code", "email"]);
  });

  it("moves a column to the very front", () => {
    expect(moveColumn(ORDER, "type", "code")).toEqual(["type", "code", "company", "email"]);
  });

  it("dropping a column on itself changes nothing", () => {
    expect(moveColumn(ORDER, "type", "type")).toEqual(ORDER);
  });

  it("never loses or duplicates a column", () => {
    const moved = moveColumn(ORDER, "company", "email");
    expect([...moved].sort()).toEqual([...ORDER].sort());
    expect(new Set(moved).size).toBe(ORDER.length);
  });

  it("keeps the user's arrangement when a new column appears", () => {
    const user = ["email", "code", "company", "type"];
    // The caller added "branch" at the end of its own list.
    expect(reconcile(user, [...ORDER, "branch"])).toEqual([
      "email",
      "code",
      "company",
      "type",
      "branch",
    ]);
  });

  it("drops a column the caller removed, keeping the rest arranged", () => {
    const user = ["email", "code", "company", "type"];
    expect(reconcile(user, ["code", "company", "type"])).toEqual(["code", "company", "type"]);
  });
});
