import { describe, expect, it } from "vitest";

/**
 * The column-visibility rules `DataTable` implements, extracted so they can be
 * checked without mounting React. These mirror the component; if one changes,
 * both change.
 *
 * The rule worth pinning down is that hiding a column hides it *everywhere* —
 * header, rows, search and export. A hidden column that still matched the
 * search would return rows with no visible match; one that still exported
 * would hand you a file that doesn't look like the table you were reading.
 */

interface Col {
  key: string;
  header: string;
}

const COLUMNS: Col[] = [
  { key: "code", header: "Client Code" },
  { key: "company", header: "Company" },
  { key: "email", header: "Email" },
];

const visibleColumns = (hidden: Set<string>) => COLUMNS.filter((c) => !hidden.has(c.key));

interface Row {
  id: string;
  code: string;
  company: string;
  email: string;
}

const ROWS: Row[] = [
  { id: "1", code: "C-1", company: "Acme", email: "a@acme.com" },
  { id: "2", code: "C-2", company: "Borex", email: "b@borex.com" },
];

/** Search matches only what is on screen. */
function search(rows: Row[], q: string, hidden: Set<string>): Row[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return rows;
  const cols = visibleColumns(hidden);
  return rows.filter((r) =>
    cols.some((c) => String(r[c.key as keyof Row]).toLowerCase().includes(needle)),
  );
}

/** The CSV header line, from the visible columns. */
function csvHeader(hidden: Set<string>): string {
  return visibleColumns(hidden)
    .map((c) => c.header)
    .join(",");
}

/** The last visible column can't be unticked. */
function canHide(key: string, hidden: Set<string>): boolean {
  const shown = COLUMNS.length - hidden.size;
  return hidden.has(key) || shown > 1;
}

describe("DataTable column visibility", () => {
  it("shows every column by default", () => {
    expect(visibleColumns(new Set()).map((c) => c.key)).toEqual(["code", "company", "email"]);
  });

  it("drops a hidden column from the export header", () => {
    expect(csvHeader(new Set())).toBe("Client Code,Company,Email");
    expect(csvHeader(new Set(["email"]))).toBe("Client Code,Company");
  });

  it("stops searching a column once it is hidden", () => {
    // "acme.com" only appears in the email column.
    expect(search(ROWS, "acme.com", new Set()).map((r) => r.id)).toEqual(["1"]);
    expect(search(ROWS, "acme.com", new Set(["email"]))).toEqual([]);
    // The company column still matches, so the row is still findable by name.
    expect(search(ROWS, "acme", new Set(["email"])).map((r) => r.id)).toEqual(["1"]);
  });

  it("refuses to hide the last visible column", () => {
    const hidden = new Set(["code", "company"]);
    expect(canHide("email", hidden)).toBe(false);
    // But un-hiding one of the others is always allowed.
    expect(canHide("code", hidden)).toBe(true);
  });

  it("allows hiding down to exactly one column", () => {
    expect(canHide("company", new Set(["code"]))).toBe(true);
    expect(visibleColumns(new Set(["code", "company"])).map((c) => c.key)).toEqual(["email"]);
  });
});
