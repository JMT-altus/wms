import { NextResponse } from "next/server";
import { autoLockDueMonths } from "@/lib/queries/incentive-calc";

/**
 * Daily automatic locking of Category A months ("Locking a month: automatically, a number of days after the month
 * ends"). Only an OPEN Category A month with an adopted calculation, whose PUBLISHED configuration locks it
 * automatically and whose lock day has passed, is locked — exactly as a lock by hand, negative balances included; one
 * whose negative balance needs a second person's approval stays open (the response says why). With no Category A
 * version saying so, it does nothing. Never calculates, approves or pays anything.
 *
 * Auth: Authorization: Bearer <CRON_SECRET> (same as the other crons).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function run(request: Request): Promise<NextResponse> {
  const expected = process.env.CRON_SECRET;
  const header = request.headers.get("authorization");
  if (!expected || header !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    return NextResponse.json({ ok: true, ...(await autoLockDueMonths()) });
  } catch (err) {
    console.error("[cron/incentive-auto-lock] failed", err);
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function GET(request: Request) { return run(request); }
export async function POST(request: Request) { return run(request); }
