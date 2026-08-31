import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import type { Route } from "next";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { withDbRetry } from "@/lib/db/retry";
import { employees, type Employee } from "@/db/schema";
import { readSession } from "@/lib/auth/session";

/**
 * Resolves the signed-in employee row, or null if not signed in.
 * Looks up by Firebase UID.  Used inside Server Components / Server Actions.
 *
 * Retried, because this is the one read every guarded page makes before it
 * renders anything: a single dropped connection here does not degrade a
 * screen, it takes the whole screen down with "Failed query". The pooler
 * resets sockets from time to time and the transient codes that come back —
 * ECONNRESET, and 57014 when a queued statement hits the pooler's own
 * two-minute timeout — are exactly the ones `withDbRetry` already knows to
 * try again. Everything else still surfaces on the first attempt.
 *
 * Inside `cache()`, so the retry runs at most once per request no matter how
 * many components ask who is signed in.
 */
export const getCurrentEmployee = cache(async (): Promise<Employee | null> => {
  const claims = await readSession();
  if (!claims) return null;
  const row = await withDbRetry("current employee", () =>
    db.query.employees.findFirst({
      where: eq(employees.firebaseUid, claims.uid),
    }),
  );
  return row ?? null;
});

/**
 * Like getCurrentEmployee but redirects to /login if absent or deactivated.
 * Throws via redirect (Next renders the redirect on the server).
 */
export async function requireUser(): Promise<Employee> {
  const e = await getCurrentEmployee();
  if (!e || !e.isActive) redirect("/login" as Route);
  return e;
}

/**
 * Like requireUser but additionally throws 403 if not admin.
 * Throws an Error so Next renders error.tsx.
 */
export async function requireAdmin(): Promise<Employee> {
  const e = await requireUser();
  if (!e.isAdmin) throw new Error("Forbidden");
  return e;
}
