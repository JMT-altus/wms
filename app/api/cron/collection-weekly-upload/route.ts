import { NextResponse } from "next/server";
import { sweepWeeklyUpload } from "@/lib/collections/weekly-upload/server";

/**
 * Collection Tracker weekly Bulk Upload cron.
 *
 * Daily: creates the current reporting week's compulsory task for the employee
 * configured in Admin & Master Setup (once per week, whatever the retry count),
 * completes any open week whose Bulk Upload was confirmed but whose completion
 * step failed, and sends the due-today / overdue reminders, each once.
 *
 * Authentication: same pattern as the other cron routes —
 *   Authorization: Bearer <CRON_SECRET>
 *
 * Schedule: registered in `vercel.json` for 03:45 UTC (09:15 IST) daily, so
 * Monday's run creates the week's task at the start of the working day and
 * every later run only reminds or reconciles. Idempotent: every write is
 * claimed with a conditional update, so running it twice changes nothing.
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
    const stats = await sweepWeeklyUpload();
    return NextResponse.json({ ok: true, ...stats });
  } catch (err) {
    console.error("[cron/collection-weekly-upload] failed", err);
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export async function GET(request: Request) {
  return run(request);
}
export async function POST(request: Request) {
  return run(request);
}
