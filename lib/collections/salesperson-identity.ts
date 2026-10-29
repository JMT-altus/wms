import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { collectionCoordinatorLinks, type Employee } from "@/db/schema";

/**
 * Which Sales Coordinator (the Collection Master's `coordinator_label`) the
 * signed-in employee IS — the only place the Collection Tracker decides whose
 * scorecard to show. The employee always comes from the verified session
 * (getCurrentEmployee); nothing from the browser is used.
 *
 * The answer comes ONLY from the trusted link a super-admin keeps in the Admin
 * Panel (table collection_coordinator_links, migration 0120), keyed by the
 * employee's id:
 *   - "linked"          → that label;
 *   - "not-salesperson" → the login was explicitly marked as not a Sales
 *                         Coordinator (an admin or system account);
 *   - "unconfigured"    → no link yet (also while 0120 isn't installed).
 * Never guessed from names, initials or email addresses: labels are first names
 * ("Gauri") while WMS names are often initials ("GR"), and a wrong guess would
 * show one person another person's clients.
 */
export type SalespersonIdentity =
  | { status: "linked"; label: string }
  | { status: "not-salesperson" }
  | { status: "unconfigured" };

const isMissingTable = (err: unknown) => {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code === "42P01" || e?.cause?.code === "42P01";
};

export async function salespersonIdentityFor(employee: Pick<Employee, "id"> | null): Promise<SalespersonIdentity> {
  if (!employee) return { status: "unconfigured" };
  try {
    const [link] = await db
      .select({ label: collectionCoordinatorLinks.coordinatorLabel })
      .from(collectionCoordinatorLinks)
      .where(eq(collectionCoordinatorLinks.employeeId, employee.id))
      .limit(1);
    if (!link) return { status: "unconfigured" };
    return link.label ? { status: "linked", label: link.label } : { status: "not-salesperson" };
  } catch (err) {
    if (isMissingTable(err)) return { status: "unconfigured" };
    throw err;
  }
}
