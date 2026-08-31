import { NextResponse } from "next/server";
import { sweepExpiredDrafts } from "@/lib/masters/draft-sweep";

/**
 * Client KYC draft sweep — moves drafts older than DRAFT_EXPIRY_DAYS into the
 * Recycle Bin.
 *
 * Authentication: same as every other cron route here —
 *   Authorization: Bearer <CRON_SECRET>
 *
 * Schedule: registered in `vercel.json` for 03:00 UTC (08:30 IST), after the
 * task auto-archive and recurrence jobs so the nightly batch stays ordered
 * and one slow job cannot delay this one into the working day.
 *
 * Idempotent — a second run in the same window recycles nothing, because
 * already-recycled rows are excluded.
 *
 * Runs on the Node runtime (postgres-js needs Node APIs).
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
    const stats = await sweepExpiredDrafts();
    return NextResponse.json({ ok: true, ...stats });
  } catch (err) {
    console.error("[cron/kyc-draft-sweep] failed", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

export async function GET(request: Request) {
  return run(request);
}
export async function POST(request: Request) {
  return run(request);
}
