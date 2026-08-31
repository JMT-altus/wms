import { NextResponse } from "next/server";
import { autoArchiveApprovedTasks } from "@/lib/tasks/auto-archive";

/**
 * Auto-archive cron — moves approved tasks to the Archive once they are past
 * the window set in Admin → Settings.
 *
 * Authentication: same pattern as the other cron routes —
 *   Authorization: Bearer <CRON_SECRET>
 *
 * Schedule: registered in `vercel.json` for 01:00 UTC (06:30 IST), ahead of
 * the recurrence materializer at 02:00 so a freshly materialized instance is
 * never swept in the same pass it was created.
 *
 * Idempotent — a second run in the same window archives nothing, because the
 * sweep skips rows already archived.
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
    const stats = await autoArchiveApprovedTasks();
    return NextResponse.json({ ok: true, ...stats });
  } catch (err) {
    console.error("[cron/auto-archive] failed", err);
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
