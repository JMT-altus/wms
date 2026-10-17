import type { ParsedReport } from "./parse-report";

/**
 * The compact payload the browser sends to the server actions.
 *
 * Only what the server needs is sent: days that carry a punch time or a problem
 * (a day with neither is just counted), and no raw cell text, shift or duration.
 * The server still re-validates every field. Next.js limits a server-action
 * body to 1 MB by default, so the size is checked here first and a clear
 * message is shown instead of a failed request.
 */

export interface PayloadDay {
  rowNo: number;
  date: string | null;
  inTime: string | null;
  outTime: string | null;
  status: string | null;
  problems: string[];
}

export interface PayloadEmployee {
  key: string;
  code: string;
  name: string;
  department: string | null;
  days: PayloadDay[];
  /** Day rows with no in and no out time and no problem — counted, not sent. */
  noPunchDays: number;
}

export interface ImportPayload {
  fileName?: string;
  employees: PayloadEmployee[];
  mapping: Record<string, string>;
  declaredPeriod: { from: string; to: string } | null;
  confirmedPeriod: { from: string; to: string } | null;
  acknowledged?: { mappings: boolean; period: boolean };
}

/** Under Next's 1 MB default, with room for the rest of the request. */
export const MAX_PAYLOAD_BYTES = 900_000;

export function buildPayload(
  report: ParsedReport,
  mapping: Record<string, string>,
  opts: {
    fileName?: string;
    confirmedPeriod: { from: string; to: string } | null;
    acknowledged?: { mappings: boolean; period: boolean };
  },
): ImportPayload {
  return {
    ...(opts.fileName ? { fileName: opts.fileName } : {}),
    employees: report.employees.map((e) => {
      const days: PayloadDay[] = [];
      let noPunchDays = 0;
      for (const d of e.days) {
        if (d.inTime || d.outTime || d.problems.length) {
          days.push({
            rowNo: d.rowNo,
            date: d.date,
            inTime: d.inTime,
            outTime: d.outTime,
            status: d.status,
            problems: d.problems,
          });
        } else {
          noPunchDays++;
        }
      }
      return { key: e.key, code: e.code, name: e.name, department: e.department, days, noPunchDays };
    }),
    mapping,
    declaredPeriod: report.period,
    confirmedPeriod: opts.confirmedPeriod,
    ...(opts.acknowledged ? { acknowledged: opts.acknowledged } : {}),
  };
}

export function payloadBytes(p: ImportPayload): number {
  return new TextEncoder().encode(JSON.stringify(p)).length;
}

/** A user-facing message when the payload is too big to send, else null. */
export function payloadTooLarge(p: ImportPayload): string | null {
  const bytes = payloadBytes(p);
  if (bytes <= MAX_PAYLOAD_BYTES) return null;
  const rows = p.employees.reduce((n, e) => n + e.days.length, 0);
  return `This file is too large to import in one go (${rows} punch rows, about ${Math.round(bytes / 1024)} KB; the limit is about ${Math.round(MAX_PAYLOAD_BYTES / 1024)} KB). Split it by month or by department and import the parts one at a time.`;
}
