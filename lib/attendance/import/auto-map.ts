/**
 * Saved biometric-code → JMT-employee matches. Pure.
 *
 * A saved match is only ever USED when everything about it still checks out:
 *   - the biometric code matches exactly,
 *   - the name in the file matches the name HR confirmed (so a code that has
 *     been re-used for someone else is not silently trusted),
 *   - the linked JMT employee still exists and is active,
 *   - the code appears only once in the file.
 * Anything else is left UNRESOLVED with a reason, for HR to look at. A first
 * name, or an employee who merely has the same name, never produces a match.
 */

export interface SavedMapping {
  code: string;
  employeeId: string;
  /** The name the report showed when HR confirmed the match. */
  nameInFile: string;
  confirmedAt?: string;
}

export interface MappingTarget {
  id: string;
  name: string;
  email: string;
  isActive: boolean;
}

export interface SourceRef {
  key: string;
  code: string;
  name: string;
}

export type UnresolvedReason =
  | "no_code"
  | "unknown_code"
  | "name_changed"
  | "employee_inactive"
  | "employee_missing"
  | "code_listed_twice";

export type Suggestion =
  | { status: "matched"; employeeId: string; name: string; email: string; confirmedAt: string | null }
  | {
      status: "unresolved";
      reason: UnresolvedReason;
      message: string;
      /** What HR confirmed earlier, when there is a saved match worth showing. */
      saved: { employeeId: string; employeeName: string | null; nameInFile: string } | null;
    };

/** Codes are compared exactly after trimming. */
export const normalizeCode = (c: string) => c.trim();

/** Names are compared ignoring case and spacing. Empty means "no name". */
export const normalizeName = (n: string) => n.replace(/\s+/g, " ").trim().toLowerCase();

/** The code a source row carries, or null when the file has none ("—" is the placeholder). */
export const usableCode = (c: string): string | null => {
  const t = normalizeCode(c);
  return t === "" || t === "—" ? null : t;
};

export function resolveSavedMappings(
  sources: SourceRef[],
  saved: ReadonlyMap<string, SavedMapping>,
  employees: ReadonlyMap<string, MappingTarget>,
): Record<string, Suggestion> {
  const out: Record<string, Suggestion> = {};
  const seen = new Map<string, number>();
  for (const s of sources) {
    const c = usableCode(s.code);
    if (c) seen.set(c, (seen.get(c) ?? 0) + 1);
  }

  for (const s of sources) {
    const code = usableCode(s.code);
    const unresolved = (
      reason: UnresolvedReason,
      message: string,
      row: SavedMapping | undefined = undefined,
    ): Suggestion => ({
      status: "unresolved",
      reason,
      message,
      saved: row
        ? { employeeId: row.employeeId, employeeName: employees.get(row.employeeId)?.name ?? null, nameInFile: row.nameInFile }
        : null,
    });

    if (!code) {
      out[s.key] = unresolved("no_code", "This file row has no employee code, so a saved match cannot be used. Choose the person yourself.");
      continue;
    }
    if ((seen.get(code) ?? 0) > 1) {
      out[s.key] = unresolved("code_listed_twice", `Code ${code} is listed more than once in the file, so it was not matched automatically.`);
      continue;
    }
    const row = saved.get(code);
    if (!row) {
      out[s.key] = unresolved("unknown_code", `Code ${code} has no saved match yet. Choose the person, then use "Remember these matches".`);
      continue;
    }
    if (normalizeName(row.nameInFile) !== normalizeName(s.name)) {
      const was = row.nameInFile.trim() ? `"${row.nameInFile.trim()}"` : "no name";
      const now = s.name.trim() ? `"${s.name.trim()}"` : "no name";
      out[s.key] = unresolved(
        "name_changed",
        `Code ${code} was saved for ${was} but this file says ${now}. The code may now belong to someone else, so it was not matched automatically.`,
        row,
      );
      continue;
    }
    const emp = employees.get(row.employeeId);
    if (!emp) {
      out[s.key] = unresolved("employee_missing", `The employee saved for code ${code} no longer exists. Choose the person again.`, row);
      continue;
    }
    if (!emp.isActive) {
      out[s.key] = unresolved("employee_inactive", `${emp.name} (saved for code ${code}) is inactive. Choose the person yourself.`, row);
      continue;
    }
    out[s.key] = { status: "matched", employeeId: emp.id, name: emp.name, email: emp.email, confirmedAt: row.confirmedAt ?? null };
  }
  return out;
}
