import { resolvePolicy, validatePolicyValue, type PolicyChange, type PolicyValues } from "@/lib/attendance/policy";
import type { LeavePay } from "@/lib/leave/workflow";

/**
 * Reading the attendance policy for a month, in two modes.
 *
 * - DISPLAY (strict: false): attendance pages. If the policy can't be read they
 *   fall back to the initial policy value and log it, so a policy problem never
 *   takes the page down.
 * - STRICT (strict: true): salary generation. A policy that can't be read — or
 *   that reads but holds an invalid value — throws `PolicyReadError`. Money must
 *   never be computed from a fallback the company didn't choose.
 *
 * Pure (the database read is passed in) so both modes are testable.
 */
export class PolicyReadError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "PolicyReadError";
  }
}

/**
 * Resolve the policy as of a date, refusing any applicable change whose stored
 * value fails its own validation (a hand-edited or corrupted row).
 */
export function resolvePolicyStrict(changes: PolicyChange[], asOf: string): PolicyValues {
  for (const c of changes) {
    if (c.effectiveFrom > asOf) continue;
    const checked = validatePolicyValue(c.key, c.value);
    if (!checked.ok) {
      throw new PolicyReadError(
        `Attendance policy setting "${c.key}" holds an invalid value (${checked.error}).`,
      );
    }
  }
  return resolvePolicy(changes, asOf);
}

const asLeavePay = (v: unknown): LeavePay | null => (v === "paid" || v === "unpaid" ? v : null);

/**
 * How an approved leave with no explicit pay kind is paid, for the month that
 * starts at `asOf` — the policy's `approved_leave_payment`.
 */
export async function readNullLeaveKind(
  read: () => Promise<PolicyValues>,
  asOf: string,
  opts: { strict: boolean; log?: (message: string, err: unknown) => void },
): Promise<LeavePay> {
  try {
    const pay = asLeavePay((await read()).approved_leave_payment);
    if (!pay) throw new PolicyReadError('Attendance policy "approved_leave_payment" is not paid or unpaid.');
    return pay;
  } catch (err) {
    if (opts.strict) {
      if (err instanceof PolicyReadError) throw err;
      throw new PolicyReadError(
        `The attendance policy could not be read for ${asOf}, so salary was not generated. Try again, or check the database connection.`,
        { cause: err },
      );
    }
    opts.log?.("[attendance] policy unreadable; using the initial approved-leave setting", err);
    return asLeavePay(resolvePolicy([], asOf).approved_leave_payment) ?? "paid";
  }
}
