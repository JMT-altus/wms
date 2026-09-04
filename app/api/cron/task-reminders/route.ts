import { NextResponse } from "next/server";
import { runTaskReminders } from "@/lib/tasks/reminders";

/**
 * Task-reminder cron — "due tomorrow" nudges plus the forgotten-timer sweep.
 *
 * Authentication: same pattern as the other cron routes —
 *   Authorization: Bearer <CRON_SECRET>
 *
 * Schedule: registered in `vercel.json` for 12:30 UTC (18:00 IST) — end of the
 * working day, when "this is due tomorrow" is something you can still act on,
 * and late enough that a timer started in the morning has either been stopped
 * or genuinely been forgotten.
 *
 * Idempotent in the sense that matters: a second run re-sends the same
 * reminders (the inbox dedupes nothing, so don't schedule it twice) but closes
 * no extra timers, because a closed session is no longer open.
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
    const stats = await runTaskReminders();
    return NextResponse.json({ ok: true, ...stats });
  } catch (err) {
    console.error("[cron/task-reminders] failed", err);
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
