import { describe, expect, it } from "vitest";

/**
 * The table's minimum-width rule, extracted so it can be checked without
 * mounting React. Mirrors `DataTable`; if one changes, both change.
 *
 * Two things it has to get right:
 *  - a `w-full` table with a flat floor squeezes its columns to fit the
 *    container instead of overflowing, so many columns give a dozen cramped
 *    ones rather than a scrollbar;
 *  - headings do not wrap, so a column is at least as wide as its heading —
 *    counting only the declared width under-states the table and compresses
 *    the other columns.
 */

interface Col {
  key: string;
  header: string;
  width?: number;
}

const FALLBACK = 140;
const FLOOR = 720;
/** 11px bold uppercase at 0.08em tracking, plus the cell's 24px padding. */
const headerWidth = (header: string) => header.length * 8.2 + 24;

function tableMinWidth(columns: Col[], selectable: boolean, actions: boolean): number {
  const columnsWidth = columns.reduce(
    (sum, c) => sum + Math.max(c.width ?? FALLBACK, headerWidth(c.header)),
    0,
  );
  return Math.max(FLOOR, columnsWidth + (selectable ? 44 : 0) + (actions ? 56 : 0));
}

/** Client Contact Master's ten columns, as declared. */
const CONTACT_COLUMNS: Col[] = [
  { key: "code", header: "Client Code", width: 110 },
  { key: "company", header: "Company", width: 190 },
  { key: "type", header: "Type", width: 130 },
  { key: "firstName", header: "First Name", width: 130 },
  { key: "lastName", header: "Last Name", width: 130 },
  { key: "contactNo", header: "Contact No", width: 140 },
  { key: "email", header: "Email", width: 210 },
  { key: "designation", header: "Designation", width: 130 },
  { key: "department", header: "Department", width: 130 },
  { key: "notes", header: "Contact Notes", width: 220 },
];

describe("DataTable minimum width", () => {
  it("keeps the 720px floor for a narrow table", () => {
    expect(
      tableMinWidth(
        [
          { key: "a", header: "A", width: 100 },
          { key: "b", header: "B", width: 100 },
        ],
        false,
        false,
      ),
    ).toBe(720);
  });

  it("grows past the floor once the columns need it — so the wrapper scrolls", () => {
    const w = tableMinWidth(CONTACT_COLUMNS, true, false);
    expect(w).toBeGreaterThan(FLOOR);
    expect(w).toBeGreaterThan(1500);
  });

  it("widens a column whose heading is longer than its declared width", () => {
    // "Sales Co-ordinator" needs ~172px; the column asks for 130. A filler
    // column carries both cases past the 720 floor, which would otherwise
    // flatten the difference and make the comparison vacuous.
    const filler: Col = { key: "filler", header: "X", width: 900 };
    const longHeading = tableMinWidth(
      [filler, { key: "rep", header: "Sales Co-ordinator", width: 130 }],
      false,
      false,
    );
    const shortHeading = tableMinWidth(
      [filler, { key: "rep", header: "Rep", width: 130 }],
      false,
      false,
    );
    expect(longHeading).toBeGreaterThan(shortHeading);
    // The heading, not the declared 130, is what counts for that column.
    expect(Math.round(headerWidth("Sales Co-ordinator"))).toBeGreaterThan(130);
    expect(longHeading - 900).toBeCloseTo(headerWidth("Sales Co-ordinator"), 5);
  });

  it("counts the checkbox and action columns", () => {
    expect(tableMinWidth([{ key: "a", header: "A", width: 800 }], true, true)).toBe(
      800 + 44 + 56,
    );
  });

  it("gives a column with no declared width the browser's rough default", () => {
    const cols: Col[] = Array.from({ length: 6 }, (_, i) => ({ key: `c${i}`, header: "Ab" }));
    expect(tableMinWidth(cols, false, false)).toBe(6 * FALLBACK);
  });

  it("shrinks back when columns are hidden, so a trimmed table stops scrolling", () => {
    const all = tableMinWidth(CONTACT_COLUMNS, true, false);
    const trimmed = tableMinWidth(CONTACT_COLUMNS.slice(0, 3), true, false);
    expect(trimmed).toBeLessThan(all);
    expect(trimmed).toBe(720);
  });
});
