import { redirect, notFound } from "next/navigation";
import type { Route } from "next";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { tasks } from "@/db/schema";
import { visibleTaskCondition } from "@/lib/auth/task-visibility";

export const runtime = "nodejs"; // postgres-js needs Node APIs

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ shortId: string }> },
) {
  const { shortId } = await params;
  if (!/^[0-9a-f]{10}$/.test(shortId)) notFound();
  const [row] = await db
    .select({ id: tasks.id })
    .from(tasks)
    // 404 here rather than redirecting into a detail page that would itself
    // 404 — a share link shouldn't confirm that a hidden task exists.
    .where(and(eq(tasks.shortId, shortId), await visibleTaskCondition()))
    .limit(1);
  if (!row) notFound();
  redirect(`/tasks/${row.id}` as Route);
}
