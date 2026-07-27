import { NextResponse } from "next/server";
import { currentPeriodIST } from "@/lib/queries/incentives";
import { recomputeOpenPeriod } from "@/lib/incentives/load";

/**
 * Daily incentive recompute. Collection-decay advances with the calendar
 * (an invoice crosses the 45/75/100-day step at a day boundary), so without
 * this the stored earnings would drift from the live decay shown on deal pages.
 * Recomputes the current + previous two months; locked/paid periods are skipped
 * inside computePeriodForEmployee, so finalized payouts are never disturbed.
 *
 * Auth: Authorization: Bearer <CRON_SECRET> (same as the other crons).
 *   curl -X POST http://localhost:3000/api/cron/incentive-recompute -H "Authorization: Bearer $CRON_SECRET"
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function recentPeriods(n = 3): string[] {
  const [y, m] = currentPeriodIST().split("-").map(Number);
  return Array.from({ length: n }, (_, i) => new Date(Date.UTC(y!, m! - 1 - i, 1)).toISOString().slice(0, 7));
}

async function run(request: Request): Promise<NextResponse> {
  const expected = process.env.CRON_SECRET;
  const header = request.headers.get("authorization");
  if (!expected || header !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const results = [];
    for (const p of recentPeriods(3)) results.push({ period: p, ...(await recomputeOpenPeriod(p)) });
    return NextResponse.json({ ok: true, results });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[cron/incentive-recompute] failed", err);
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function GET(request: Request) { return run(request); }
export async function POST(request: Request) { return run(request); }
