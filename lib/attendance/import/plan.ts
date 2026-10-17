import { formatHHmmInTz, zonedWallClockToUtc } from "@/lib/attendance/zoned-time";
import { inPeriod, summarizeDates, type DateSummary } from "./period";
import type { PayloadEmployee } from "./payload";

/**
 * Turns parsed source rows + the admin's employee mapping into the list of
 * punches that would be written. Pure: the server action feeds it the target
 * employees' timezones and the punches that already exist, so duplicate
 * detection, validation and timestamp conversion are testable without a DB.
 *
 * Only punch times are planned. Absent / weekly-off / half-day statuses, shift
 * and duration are never turned into attendance, leave, overtime or pay.
 */

/** Mapping value meaning "deliberately do not import this person". */
export const SKIP_EMPLOYEE = "skip";

export type PlanEmployee = Omit<PayloadEmployee, "noPunchDays"> & { noPunchDays?: number };

export interface PlanInput {
  employees: PlanEmployee[];
  /** source employee key → JMT employee id, or SKIP_EMPLOYEE. Missing = undecided. */
  mapping: Record<string, string | undefined>;
  /** JMT employee id → IANA timezone, for every ACTIVE employee that exists. */
  employeeTz: ReadonlyMap<string, string>;
  /** Existing punches: `${employeeId}|${yyyy-mm-dd}|${in|out}` → stored time. */
  existing: ReadonlyMap<string, Date>;
  /** Today's date (yyyy-mm-dd) — future dates are rejected. */
  today: string;
  /** The period the file itself declares — rows outside it only warn. */
  declaredPeriod?: { from: string; to: string } | null;
  /** The period the admin confirmed — punches outside it are rejected. */
  confirmedPeriod?: { from: string; to: string } | null;
}

export type IssueLevel = "error" | "warning" | "info";

export interface RowIssue {
  sourceKey: string;
  name: string;
  rowNo: number | null;
  date: string | null;
  level: IssueLevel;
  message: string;
}

export type PunchStatus = "ready" | "duplicate" | "mismatch";

export interface PlannedPunch {
  sourceKey: string;
  employeeId: string;
  date: string;
  kind: "in" | "out";
  time: string;
  /** UTC instant, ISO string. */
  loggedAt: string;
  /** ready = will be inserted; duplicate = same time already stored;
   *  mismatch = a punch is stored with a DIFFERENT time (kept, never overwritten). */
  status: PunchStatus;
  /** HH:mm of the stored punch, when one exists. */
  existingTime?: string;
}

export interface PlanSummary {
  sourceEmployees: number;
  mappedEmployees: number;
  skippedEmployees: number;
  /** Source employees with no mapping decision — import is blocked while > 0. */
  undecidedEmployees: number;
  dayRows: number;
  /** Rows with no in and no out time (absent, weekly off, …) — nothing to import. */
  noPunchDays: number;
  /** Days with only one of in / out. Imported as that single punch. */
  singlePunchDays: number;
  invalidRows: number;
  readyPunches: number;
  /** Stored punch has the same time. */
  duplicatePunches: number;
  /** Stored punch has a different time — kept, flagged. */
  mismatchPunches: number;
  /** Rows dated outside the file's own declared period (warning only). */
  outsideDeclaredRows: number;
}

export interface EmployeePlanStats {
  sourceKey: string;
  employeeId: string;
  /** Dates of this person's valid punches. */
  firstDate: string | null;
  lastDate: string | null;
  ready: number;
  duplicate: number;
  mismatch: number;
  /** ready + duplicate + mismatch */
  planned: number;
}

export interface Plan {
  punches: PlannedPunch[];
  issues: RowIssue[];
  summary: PlanSummary;
  perEmployee: EmployeePlanStats[];
  /** Dates of the valid punches (what the import would touch). */
  punchDates: DateSummary;
  /** Reasons the import cannot run at all (undecided / double-mapped / unknown employee). */
  blockers: string[];
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export const punchKey = (employeeId: string, date: string, kind: "in" | "out") => `${employeeId}|${date}|${kind}`;

export function buildPlan(input: PlanInput): Plan {
  const punches: PlannedPunch[] = [];
  const issues: RowIssue[] = [];
  const blockers: string[] = [];
  const s: PlanSummary = {
    sourceEmployees: input.employees.length,
    mappedEmployees: 0,
    skippedEmployees: 0,
    undecidedEmployees: 0,
    dayRows: 0,
    noPunchDays: 0,
    singlePunchDays: 0,
    invalidRows: 0,
    readyPunches: 0,
    duplicatePunches: 0,
    mismatchPunches: 0,
    outsideDeclaredRows: 0,
  };

  // The same employee code in two places of the file cannot be mapped twice —
  // the mapping is by code — so the file must be fixed rather than guessed at.
  const byKey = new Map<string, PlanEmployee[]>();
  for (const e of input.employees) byKey.set(e.key, [...(byKey.get(e.key) ?? []), e]);
  const repeated = new Set<string>();
  for (const [key, list] of byKey) {
    if (list.length > 1) {
      repeated.add(key);
      const names = [...new Set(list.map((e) => e.name || "no name"))].join(", ");
      blockers.push(
        `Employee code ${key} appears ${list.length} times in the file (${names}). Fix the file so each code is listed once, then load it again.`,
      );
    }
  }

  // One JMT employee may stand for only ONE source employee: two biometric
  // codes mapped to the same person would race for the same in/out slots.
  const used = new Map<string, string>();
  for (const e of input.employees) {
    if (repeated.has(e.key)) continue;
    const m = input.mapping[e.key];
    if (m && m !== SKIP_EMPLOYEE) {
      const other = used.get(m);
      if (other) {
        blockers.push(`Source employees ${other} and ${e.code} are mapped to the same JMT employee.`);
      } else {
        used.set(m, e.code);
      }
    }
  }

  const stats = new Map<string, EmployeePlanStats>();
  const seenInFile = new Set<string>();
  for (const e of input.employees) {
    if (repeated.has(e.key)) continue;
    const m = input.mapping[e.key];
    const label = e.name ? `${e.code} · ${e.name}` : e.code;
    if (m === undefined || m === "") {
      s.undecidedEmployees++;
      blockers.push(`${label} has not been mapped to a JMT employee (or marked "Don't import").`);
      continue;
    }
    if (m === SKIP_EMPLOYEE) {
      s.skippedEmployees++;
      continue;
    }
    const tz = input.employeeTz.get(m);
    if (!tz) {
      s.undecidedEmployees++;
      blockers.push(`${label} is mapped to an employee who no longer exists or is not active.`);
      continue;
    }
    s.mappedEmployees++;
    s.noPunchDays += e.noPunchDays ?? 0;
    s.dayRows += e.noPunchDays ?? 0;
    const st: EmployeePlanStats = {
      sourceKey: e.key, employeeId: m, firstDate: null, lastDate: null, ready: 0, duplicate: 0, mismatch: 0, planned: 0,
    };
    stats.set(e.key, st);

    for (const d of e.days) {
      s.dayRows++;
      const at = (level: IssueLevel, message: string) =>
        issues.push({ sourceKey: e.key, name: e.name, rowNo: d.rowNo, date: d.date, level, message });

      const problems = [...d.problems];
      // The server re-checks every field: the client's parse is not trusted.
      if (!d.date || !DATE_RE.test(d.date)) {
        if (!problems.length) problems.push("Date is missing or invalid.");
      } else if (d.date > input.today) {
        problems.push(`Date ${d.date} is in the future.`);
      } else if (input.confirmedPeriod && !inPeriod(d.date, input.confirmedPeriod)) {
        problems.push(`Date ${d.date} is outside the period you confirmed (${input.confirmedPeriod.from} to ${input.confirmedPeriod.to}).`);
      }
      if (d.inTime && !TIME_RE.test(d.inTime)) problems.push(`In time "${d.inTime}" is not HH:mm.`);
      if (d.outTime && !TIME_RE.test(d.outTime)) problems.push(`Out time "${d.outTime}" is not HH:mm.`);
      if (!problems.length && d.inTime && d.outTime && d.outTime < d.inTime) {
        problems.push(`Out time ${d.outTime} is earlier than in time ${d.inTime} (overnight?) — not imported, please check.`);
      }
      if (!problems.length && d.date) {
        const dupKey = `${e.key}|${d.date}`;
        if (seenInFile.has(dupKey)) problems.push(`More than one row for ${d.date} in the file.`);
        seenInFile.add(dupKey);
      }
      if (problems.length) {
        s.invalidRows++;
        for (const p of problems) at("error", p);
        continue;
      }

      const date = d.date!;
      if (input.declaredPeriod && !inPeriod(date, input.declaredPeriod)) {
        s.outsideDeclaredRows++;
        at("warning", `Date ${date} is outside the file's own reporting period (${input.declaredPeriod.from} to ${input.declaredPeriod.to}).`);
      }
      if (!d.inTime && !d.outTime) {
        s.noPunchDays++;
        continue;
      }
      if (!d.inTime || !d.outTime) {
        s.singlePunchDays++;
        at(
          "warning",
          d.inTime
            ? `No OUT time in the file (${d.status ?? "no status"}). Only the IN punch is imported; OUT is not made up.`
            : `No IN time in the file (${d.status ?? "no status"}). Only the OUT punch is imported; IN is not made up.`,
        );
      } else if (d.inTime === d.outTime) {
        at("warning", `In and out times are both ${d.inTime} — imported as given, please check the source.`);
      }
      for (const [kind, time] of [
        ["in", d.inTime],
        ["out", d.outTime],
      ] as const) {
        if (!time) continue;
        const loggedAt = zonedWallClockToUtc(date, time, tz);
        const stored = input.existing.get(punchKey(m, date, kind));
        let status: PunchStatus = "ready";
        let existingTime: string | undefined;
        if (stored) {
          existingTime = formatHHmmInTz(stored, tz);
          // Minute precision: live punches carry seconds, the report does not.
          status = Math.floor(stored.getTime() / 60000) === Math.floor(loggedAt.getTime() / 60000) ? "duplicate" : "mismatch";
        }
        punches.push({
          sourceKey: e.key, employeeId: m, date, kind, time, loggedAt: loggedAt.toISOString(), status, existingTime,
        });
        st.planned++;
        if (!st.firstDate || date < st.firstDate) st.firstDate = date;
        if (!st.lastDate || date > st.lastDate) st.lastDate = date;
        const label2 = kind === "in" ? "IN" : "OUT";
        if (status === "ready") {
          s.readyPunches++;
          st.ready++;
        } else if (status === "duplicate") {
          s.duplicatePunches++;
          st.duplicate++;
          at("info", `${label2} ${existingTime} already exists for this day — skipped.`);
        } else {
          s.mismatchPunches++;
          st.mismatch++;
          at(
            "warning",
            `${label2} mismatch: ${existingTime} is already stored, the file says ${time}. The stored punch is kept; nothing is overwritten.`,
          );
        }
      }
    }
  }

  return {
    punches,
    issues,
    summary: s,
    perEmployee: [...stats.values()],
    punchDates: summarizeDates(punches.map((p) => p.date)),
    blockers,
  };
}
